/**
 * CLI: run the deterministic scan against a repository.
 *
 *   npm run sdd:scan -- <path-to-repo> [focus terms...]
 *
 * Stage 0 and stage 3 need no API key, so this is the whole Context Agent minus the
 * model: the inventory, the dependency list, the ranked repo map, the lexical index,
 * and a demonstration of the grounding verifier on both a true and a fabricated claim.
 *
 * It writes nothing to the database. It is a tool for looking at what the agent would
 * be given, which is the cheapest way to tell whether the retrieval is any good before
 * spending tokens on it.
 */
import { createRepoRoot } from '../packages/context-agent/src/paths.ts';
import {
  buildIndexEntries,
  buildRepoMap,
  renderRepoMap,
  scanRepository,
  search,
  verifyClaims,
} from '../packages/context-agent/src/index.ts';

const [, , target, ...focus] = process.argv;

if (target === undefined) {
  console.error('usage: npm run sdd:scan -- <path-to-repo> [focus terms...]');
  process.exit(1);
}

const started = Date.now();
const root = createRepoRoot(target);

console.log(`# Scan of ${root.real}\n`);

// --- Stage 0a: inventory and dependencies -------------------------------
const scan = scanRepository(root);

console.log('## Inventory\n');
console.log(`- files: ${String(scan.stats.fileCount)}`);
console.log(`- bytes: ${scan.stats.totalBytes.toLocaleString('en')}`);
console.log(`- inventory source: ${scan.stats.usedGit ? 'git ls-files' : 'directory walk'}`);
console.log(
  `- languages: ${Object.entries(scan.stats.byLanguage)
    .sort((a, b) => b[1] - a[1])
    .map(([language, count]) => `${language} ${String(count)}`)
    .join(', ')}`,
);

const runtime = scan.dependencies.filter((d) => !d.dev);
console.log(`\n## Dependencies (${String(scan.dependencies.length)} declared)\n`);
for (const dependency of runtime.slice(0, 15)) {
  console.log(`- ${dependency.name}${dependency.version === null ? '' : ` ${dependency.version}`}`);
}
if (runtime.length > 15) console.log(`- ...and ${String(runtime.length - 15)} more`);

// --- Stage 0b: the repo map ---------------------------------------------
const map = await buildRepoMap(root, scan.files, { focus, limit: 40 });

console.log(`\n## Repo map\n`);
console.log(`- files parsed: ${String(map.stats.filesParsed)}`);
console.log(`- files skipped: ${String(map.stats.filesSkipped)}`);
console.log(`- definitions: ${String(map.stats.definitionCount)}`);
console.log(`- cross-file references: ${String(map.stats.referenceCount)}`);
if (map.stats.unparsedLanguages.length > 0) {
  console.log(`- no grammar for: ${map.stats.unparsedLanguages.join(', ')}`);
}
if (focus.length > 0) console.log(`- focus: ${focus.join(', ')}`);

console.log('\n### Top-ranked symbols\n');
for (const entry of map.entries.slice(0, 12)) {
  console.log(
    `- \`${entry.name}\` (${entry.kind}) ${entry.file}:${String(entry.lineStart)} ` +
      `— referenced from ${String(entry.referencedByFiles)} file(s)`,
  );
}

const rendered = renderRepoMap(map, 1_500);
console.log(`\n### Rendered for the prompt\n`);
console.log(
  `${String(rendered.length)} characters, roughly ${String(Math.ceil((rendered.length / 4) * 1.3))} tokens`,
);

// --- Stage 0c: the lexical index ----------------------------------------
const entries = buildIndexEntries(root, scan.files, map.definitions);
console.log(`\n## Lexical index\n`);
console.log(`- rows that would be indexed: ${String(entries.length)}`);

// --- Stage 3: the grounding verifier ------------------------------------
// Demonstrated on a claim taken from the map (which must verify) and a fabricated one
// (which must not). This is the metric the project is defended on, so it is worth
// seeing it work on a real repository rather than only in tests.
const top = map.entries[0];
if (top !== undefined) {
  const result = verifyClaims(root, [
    {
      file: top.file,
      line_start: top.lineStart,
      line_end: top.lineEnd,
      symbol: top.name,
      claim: 'A real citation, taken from the repo map.',
      relevance: 'Demonstrates a claim that verifies.',
    },
    {
      file: 'src/totally/invented/module.ts',
      line_start: 1,
      line_end: 10,
      symbol: 'neverExisted',
      claim: 'A fabricated citation of the kind a guessing model produces.',
      relevance: 'Demonstrates a claim that is caught.',
    },
  ]);

  console.log(`\n## Grounding verifier\n`);
  console.log(`- claims checked: ${String(result.total)}`);
  console.log(`- verified: ${String(result.verified)}`);
  console.log(`- unverified: ${String(result.unverified)}`);
  console.log(`- unverified-claim rate: ${(result.unverifiedClaimRate * 100).toFixed(1)}%`);
  for (const checked of result.claims) {
    console.log(
      `  - ${checked.verified ? 'VERIFIED  ' : 'UNVERIFIED'} ${checked.claim.file}:` +
        `${String(checked.claim.line_start)}-${String(checked.claim.line_end)}` +
        (checked.failureReason === null ? '' : ` (${checked.failureReason})`),
    );
  }
}

// --- A sample search ----------------------------------------------------
if (focus.length > 0) {
  const term = focus[0];
  if (term !== undefined) {
    const matches = search(root, term, { files: scan.files, maxMatches: 5, literal: true });
    console.log(`\n## Search for "${term}"\n`);
    for (const match of matches) {
      console.log(`- ${match.path}:${String(match.line)} ${match.text.trim().slice(0, 100)}`);
    }
    if (matches.length === 0) console.log('- no matches');
  }
}

console.log(`\n---\nScan completed in ${String(Date.now() - started)}ms, no model calls, $0.00.`);
