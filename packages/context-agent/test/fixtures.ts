import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRepoRoot, type RepoRoot } from '../src/paths.ts';

/**
 * A throwaway repository on disk.
 *
 * The verifier checks claims against real bytes, so its tests need real files. A
 * fixture builder keeps each test's setup to the one or two files it actually cares
 * about.
 */

export interface Fixture {
  readonly dir: string;
  readonly root: RepoRoot;
  readonly write: (relativePath: string, contents: string) => void;
  readonly mkdir: (relativePath: string) => void;
  /** Returns false when the platform refuses symlinks (unprivileged Windows). */
  readonly link: (linkPath: string, target: string) => boolean;
  readonly cleanup: () => void;
}

export function makeFixture(files: Readonly<Record<string, string>> = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'agentforge-repo-'));

  const write = (relativePath: string, contents: string): void => {
    const full = join(dir, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  };

  for (const [path, contents] of Object.entries(files)) write(path, contents);

  // A repository root must exist before it can be validated, so ensure at least one
  // file is present for the empty case.
  if (Object.keys(files).length === 0) write('.keep', '');

  return {
    dir,
    root: createRepoRoot(dir),
    write,
    mkdir: (relativePath: string) => {
      mkdirSync(join(dir, relativePath), { recursive: true });
    },
    link: (linkPath: string, target: string): boolean => {
      try {
        const full = join(dir, linkPath);
        mkdirSync(dirname(full), { recursive: true });
        symlinkSync(target, full);
        return true;
      } catch {
        // Windows needs developer mode or elevation for symlinks. Reported rather than
        // silently skipped, so a green run cannot hide an unexercised check.
        return false;
      }
    },
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A directory outside the fixture, for testing escapes. */
export function makeOutsideDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'agentforge-outside-'));
  writeFileSync(join(dir, 'secret.txt'), 'this must never be readable from the repo\n', 'utf8');
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The TypeScript sample used by the repo-map and index tests. */
export const SAMPLE_REPO: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify(
    {
      name: 'sample',
      dependencies: { zod: '^4.0.0', 'better-sqlite3': '^12.0.0' },
      devDependencies: { vitest: '^5.0.0' },
    },
    null,
    2,
  ),
  '.gitignore': 'node_modules/\ndist/\nsecret.env\n',
  'secret.env': 'API_KEY=should-never-be-indexed\n',
  'dist/bundle.js': 'console.log("generated output, ignored");\n',
  'src/orchestrator.ts': [
    '// The orchestrator owns every state change for a spec.',
    'export function transitionSpec(id: string, to: string): void {',
    '  recordAudit(id, to);',
    '}',
    '',
    'export function recordAudit(id: string, to: string): void {',
    '  void id;',
    '  void to;',
    '}',
    '',
    'export class Orchestrator {',
    '  run(id: string): void {',
    "    transitionSpec(id, 'DONE');",
    '  }',
    '}',
    '',
  ].join('\n'),
  'src/billing/invoice.ts': [
    '// Invoice finalisation and GST payload generation.',
    "import { transitionSpec } from '../orchestrator.ts';",
    '',
    'export interface Invoice {',
    '  readonly id: string;',
    '  readonly total: number;',
    '}',
    '',
    'export function finaliseInvoice(invoice: Invoice): void {',
    "  transitionSpec(invoice.id, 'FINAL');",
    '}',
    '',
    'export function exportGstPayload(invoice: Invoice): string {',
    '  return JSON.stringify(invoice);',
    '}',
    '',
  ].join('\n'),
  'src/util/helpers.py': [
    '# Shared helpers used across the Python tooling.',
    'def normalise_gstin(value):',
    '    return value.strip().upper()',
    '',
    'class GstValidator:',
    '    def validate(self, invoice):',
    '        return normalise_gstin(invoice)',
    '',
  ].join('\n'),
  'requirements.txt': '# runtime deps\nrequests>=2.31\npydantic==2.7.0\n-e .\n',
};
