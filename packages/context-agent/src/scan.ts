import { UpstreamError, ValidationError } from '@agentforge/contract';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { extname, join } from 'node:path';
import { minimatch } from 'minimatch';
import ignore, { type Ignore } from 'ignore';
import { z } from 'zod';
import { isSymlink, resolveInside, toRepoRelative, type RepoRoot } from './paths.ts';

/**
 * Stage 0: the deterministic scan.
 *
 * No model, no tokens, no network. Everything here is computable from the checkout, and
 * doing it first is what keeps the agentic loop cheap: the agent starts from a file
 * inventory and a dependency list rather than paying search calls to discover them.
 *
 * ## Why not ripgrep
 *
 * The plan specified `rg` for the inventory, and it would be faster. But `rg` is not
 * reliably on PATH — it is absent on a plain Windows install, and a product must not
 * depend on a binary that happens to be present on the machine that built it. So:
 *
 * - **inventory** comes from `git ls-files --cached --others --exclude-standard`, which
 *   is precisely "tracked and untracked files, honouring .gitignore", and git is
 *   already a hard dependency (the eval mines git history for ground truth, and module
 *   ownership comes from `git log`);
 * - **non-git directories** fall back to a Node walk that still reads `.gitignore`,
 *   because a repository under analysis is not always a checkout — and a directory
 *   carrying a `.gitignore` plainly intends those exclusions. Getting this wrong would
 *   put a file like `secret.env` into a prompt, which is a real harm rather than a
 *   tidiness issue, so the matching uses a proper gitignore implementation rather than
 *   hand-rolled globs;
 * - **search** is implemented in Node over the already-enumerated file list. Slower than
 *   ripgrep, but the agent's tool-call budget caps how often it runs, and correctness
 *   everywhere beats speed on one platform.
 */

/** Languages we can parse structurally. Others are still indexed lexically. */
export const SUPPORTED_LANGUAGES = ['typescript', 'tsx', 'python', 'java', 'go'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const EXTENSION_LANGUAGE: Readonly<Record<string, SupportedLanguage>> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'typescript',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
  '.jsx': 'tsx',
  '.py': 'python',
  '.pyi': 'python',
  '.java': 'java',
  '.go': 'go',
};

export function languageFor(path: string): SupportedLanguage | null {
  return EXTENSION_LANGUAGE[extname(path).toLowerCase()] ?? null;
}

/**
 * Directories skipped by the non-git fallback.
 *
 * Only used when there is no git checkout to ask; with git, `.gitignore` decides and
 * this list is irrelevant.
 */
const FALLBACK_IGNORED_DIRS: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.gradle',
  '.idea',
  '.vscode',
];

export interface ScannedFile {
  /** Repo-relative, forward-slashed. */
  readonly path: string;
  readonly bytes: number;
  readonly language: SupportedLanguage | null;
}

/** Files large enough that parsing them costs more than they inform. */
const MAX_PARSE_BYTES = 1024 * 1024;

/** Files above this are never read for search; a generated bundle is not worth it. */
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;

/** Lists files via git, or null when this is not a usable git checkout. */
function gitListFiles(root: RepoRoot): readonly string[] | null {
  try {
    const stdout = execFileSync(
      'git',
      [
        '-C',
        root.real,
        'ls-files',
        '-z',
        '--cached',
        '--others',
        // Exactly the ignore semantics the plan asked for.
        '--exclude-standard',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    return stdout.split('\0').filter((line) => line.length > 0);
  } catch {
    // Not a repository, or git is unavailable. The caller falls back.
    return null;
  }
}

/**
 * Builds a gitignore matcher from the root's own `.gitignore`, if it has one.
 *
 * Only the root file is read. Nested `.gitignore` files exist, but handling their
 * directory-relative semantics correctly is what git itself is for — and when git is
 * available we use it. This is the fallback, and it covers the case that matters: a
 * non-checkout directory whose top-level ignore file names build output and secrets.
 */
function fallbackIgnoreMatcher(root: RepoRoot): Ignore | null {
  const gitignore = join(root.real, '.gitignore');
  if (!existsSync(gitignore)) return null;

  try {
    return ignore().add(readFileSync(gitignore, 'utf8'));
  } catch {
    return null;
  }
}

/** Walks the tree, honouring .gitignore and the default ignore set. Used without git. */
function walkFiles(root: RepoRoot): readonly string[] {
  const found: string[] = [];
  const matcher = fallbackIgnoreMatcher(root);

  const walk = (relativeDir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(relativeDir === '' ? root.real : join(root.real, relativeDir), {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relative = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;

      // Symlinks are skipped rather than followed: one inside the repo would be listed
      // twice, and one pointing outside must not be read at all.
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (FALLBACK_IGNORED_DIRS.includes(entry.name)) continue;
        // gitignore matches directories with a trailing slash.
        if (matcher?.ignores(`${relative}/`) === true) continue;
        walk(relative);
      } else if (entry.isFile()) {
        if (matcher?.ignores(relative) === true) continue;
        found.push(relative);
      }
    }
  };

  walk('');
  return found;
}

/**
 * Lists the repository's files.
 *
 * Prefers git so `.gitignore` is honoured exactly; falls back to a walk otherwise.
 * Either way, symlinks are skipped and every path is re-checked for containment before
 * it is returned.
 */
export function listFiles(root: RepoRoot): readonly ScannedFile[] {
  const raw = gitListFiles(root) ?? walkFiles(root);

  const files: ScannedFile[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const candidate = entry.trim().split('\\').join('/');
    if (candidate.length === 0) continue;

    let absolute: string;
    try {
      absolute = resolveInside(root, candidate);
    } catch {
      // A path that does not resolve inside the root is skipped, never read. git can
      // list a deleted file, and a submodule can point elsewhere.
      continue;
    }

    if (isSymlink(absolute)) continue;

    let bytes: number;
    try {
      const stat = statSync(absolute);
      if (!stat.isFile()) continue;
      bytes = stat.size;
    } catch {
      // Listed but gone, which git does for a staged deletion.
      continue;
    }

    const path = toRepoRelative(root, absolute);
    if (seen.has(path)) continue;
    seen.add(path);

    files.push({
      path,
      bytes,
      language: bytes <= MAX_PARSE_BYTES ? languageFor(path) : null,
    });
  }

  // Stable order: the inventory feeds the cached prompt prefix, so an unstable one
  // would invalidate the cache between otherwise identical scans.
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface SearchOptions {
  /** Restrict to matching paths, e.g. `*.ts` or `src/**\/*.py`. */
  readonly glob?: string;
  readonly maxMatches?: number;
  /** Treat the pattern as a literal string rather than a regular expression. */
  readonly literal?: boolean;
  /** Pre-computed inventory, to avoid re-listing on every search. */
  readonly files?: readonly ScannedFile[];
}

/** Escapes a string for use inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Searches file contents.
 *
 * The pattern comes from a model, so an invalid regex is an expected input, not a crash:
 * it is reported as an upstream failure with the engine's own message so the agent can
 * correct it.
 */
export function search(
  root: RepoRoot,
  pattern: string,
  options: SearchOptions = {},
): readonly SearchMatch[] {
  if (pattern.length === 0) {
    throw new ValidationError('a search pattern must not be empty');
  }
  if (pattern.includes('\0')) {
    throw new ValidationError('a search pattern must not contain NUL bytes');
  }

  const maxMatches = options.maxMatches ?? 200;

  let regex: RegExp;
  try {
    regex = new RegExp(options.literal === true ? escapeRegExp(pattern) : pattern, 'u');
  } catch (cause) {
    throw new UpstreamError(
      `the search pattern is not a valid regular expression: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { details: { pattern }, cause },
    );
  }

  const files = options.files ?? listFiles(root);
  const matches: SearchMatch[] = [];

  for (const file of files) {
    if (matches.length >= maxMatches) break;
    if (file.bytes > MAX_SEARCH_BYTES) continue;

    if (
      options.glob !== undefined &&
      options.glob.length > 0 &&
      !minimatch(file.path, options.glob, { dot: true, nocase: process.platform === 'win32' })
    ) {
      continue;
    }

    let contents: string;
    try {
      contents = readFileSync(resolveInside(root, file.path), 'utf8');
    } catch {
      continue;
    }

    // A binary file read as text produces noise, not matches.
    if (contents.includes('\u0000')) continue;

    const lines = contents.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (!regex.test(line)) continue;

      matches.push({
        path: file.path,
        line: i + 1,
        // Capped: one minified line could otherwise consume the whole prompt budget.
        text: line.slice(0, 500),
      });

      if (matches.length >= maxMatches) break;
    }
  }

  return matches;
}

export interface Dependency {
  readonly name: string;
  readonly version: string | null;
  /** Which manifest declared it, repo-relative. */
  readonly source: string;
  readonly dev: boolean;
}

const PackageJson = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

/**
 * Parses dependency manifests.
 *
 * Manifests are repository content, so they are untrusted: each is validated rather
 * than trusted to have the shape its filename implies, and a malformed one is skipped
 * rather than aborting the scan. A broken `package.json` in one workspace should not
 * stop the whole analysis.
 */
export function parseManifests(
  root: RepoRoot,
  files: readonly ScannedFile[],
): readonly Dependency[] {
  const dependencies: Dependency[] = [];

  for (const file of files) {
    const name = file.path.split('/').pop() ?? '';

    if (name === 'package.json') {
      dependencies.push(...parsePackageJson(root, file.path));
    } else if (name === 'requirements.txt') {
      dependencies.push(...parseRequirementsTxt(root, file.path));
    } else if (name === 'pyproject.toml') {
      dependencies.push(...parsePyprojectToml(root, file.path));
    } else if (name === 'go.mod') {
      dependencies.push(...parseGoMod(root, file.path));
    }
  }

  return dependencies;
}

function readText(root: RepoRoot, path: string): string | null {
  try {
    const absolute = resolveInside(root, path);
    if (!existsSync(absolute)) return null;
    if (statSync(absolute).size > 2 * 1024 * 1024) return null;
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

function parsePackageJson(root: RepoRoot, path: string): readonly Dependency[] {
  const text = readText(root, path);
  if (text === null) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return [];
  }

  const parsed = PackageJson.safeParse(decoded);
  if (!parsed.success) return [];

  const out: Dependency[] = [];
  for (const [name, version] of Object.entries(parsed.data.dependencies ?? {})) {
    out.push({ name, version, source: path, dev: false });
  }
  for (const [name, version] of Object.entries(parsed.data.devDependencies ?? {})) {
    out.push({ name, version, source: path, dev: true });
  }
  return out;
}

function parseRequirementsTxt(root: RepoRoot, path: string): readonly Dependency[] {
  const text = readText(root, path);
  if (text === null) return [];

  const out: Dependency[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (line.length === 0) continue;
    // Options and editable installs are not dependencies.
    if (line.startsWith('-')) continue;

    const match = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(line);
    if (match?.[1] === undefined) continue;

    const spec = (match[2] ?? '').trim();
    out.push({ name: match[1], version: spec.length > 0 ? spec : null, source: path, dev: false });
  }
  return out;
}

/**
 * Extracts dependency names from `pyproject.toml`.
 *
 * A deliberately narrow reader for the common dependency array rather than a full TOML
 * parser: a dependency list is all the Context Agent needs, and adding a TOML
 * dependency to get it would not change the answer.
 */
function parsePyprojectToml(root: RepoRoot, path: string): readonly Dependency[] {
  const text = readText(root, path);
  if (text === null) return [];

  const out: Dependency[] = [];
  const arrayMatch = /^\s*dependencies\s*=\s*\[([^\]]*)\]/ms.exec(text);
  if (arrayMatch?.[1] !== undefined) {
    for (const entry of arrayMatch[1].split(',')) {
      const value = entry
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim();
      if (value.length === 0) continue;

      const nameMatch = /^([A-Za-z0-9._-]+)\s*(.*)$/.exec(value);
      if (nameMatch?.[1] === undefined) continue;

      const spec = (nameMatch[2] ?? '').trim();
      out.push({
        name: nameMatch[1],
        version: spec.length > 0 ? spec : null,
        source: path,
        dev: false,
      });
    }
  }
  return out;
}

function parseGoMod(root: RepoRoot, path: string): readonly Dependency[] {
  const text = readText(root, path);
  if (text === null) return [];

  const out: Dependency[] = [];
  let inBlock = false;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('require (')) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }

    const body = inBlock ? line : line.startsWith('require ') ? line.slice(8) : null;
    if (body === null || body.length === 0 || body.startsWith('//')) continue;

    const parts = body.split(/\s+/);
    const name = parts[0];
    if (name === undefined || name.length === 0) continue;

    out.push({
      name,
      version: parts[1] ?? null,
      source: path,
      dev: body.includes('// indirect'),
    });
  }
  return out;
}

export interface ScanResult {
  readonly files: readonly ScannedFile[];
  readonly dependencies: readonly Dependency[];
  readonly stats: {
    readonly fileCount: number;
    readonly totalBytes: number;
    /** Files per language, with `other` for anything we cannot parse structurally. */
    readonly byLanguage: Readonly<Record<string, number>>;
    /** True when the inventory came from git rather than the fallback walk. */
    readonly usedGit: boolean;
  };
}

/** Runs the whole deterministic scan. */
export function scanRepository(root: RepoRoot): ScanResult {
  const usedGit = gitListFiles(root) !== null;
  const files = listFiles(root);
  const dependencies = parseManifests(root, files);

  const byLanguage: Record<string, number> = {};
  let totalBytes = 0;
  for (const file of files) {
    const key = file.language ?? 'other';
    byLanguage[key] = (byLanguage[key] ?? 0) + 1;
    totalBytes += file.bytes;
  }

  return {
    files,
    dependencies,
    stats: { fileCount: files.length, totalBytes, byLanguage, usedGit },
  };
}
