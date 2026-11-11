/**
 * `@agentforge/context-agent` — brownfield code understanding.
 *
 * Stage 0 is deterministic and free: a ripgrep inventory, manifest parsing, a
 * tree-sitter repo map ranked by PageRank, and an FTS5 lexical index. Stage 3 is the
 * grounding verifier, also deterministic, which is what makes the unverified-claim rate
 * a measurement rather than an assertion.
 *
 * Every file access goes through `resolveInside`: the repositories read here are
 * untrusted, and so are the paths a model asks for.
 */

export {
  createRepoRoot,
  isSymlink,
  repoJoin,
  resolveInside,
  toRepoRelative,
  type RepoRoot,
  type ResolveOptions,
} from './paths.ts';

export {
  SUPPORTED_LANGUAGES,
  languageFor,
  listFiles,
  parseManifests,
  scanRepository,
  search,
  type Dependency,
  type ScanResult,
  type ScannedFile,
  type SearchMatch,
  type SearchOptions,
  type SupportedLanguage,
} from './scan.ts';

export {
  buildRepoMap,
  renderRepoMap,
  type RepoMap,
  type RepoMapEntry,
  type RepoMapOptions,
  type SymbolDefinition,
} from './repomap.ts';

export {
  buildIndexEntries,
  escapeFtsQuery,
  indexRepository,
  indexSize,
  searchIndex,
  type FtsHit,
  type IndexEntry,
} from './fts.ts';

export {
  containsSymbol,
  explainFailure,
  splitLines,
  verifyClaim,
  verifyClaims,
  type VerificationResult,
  type VerifiedClaim,
} from './verifier.ts';

export {
  RETRIEVAL_STRATEGIES,
  renderContext,
  scanContext,
  type RetrievalStrategy,
  type ScanContextInput,
  type ScanContextResult,
} from './agent.ts';

export { CONTEXT_TOOLS, executeContextTool, type ToolContext } from './tools.ts';

export {
  groupIntoModules,
  moduleHash,
  renderModuleSummaries,
  summariseModules,
  type ModuleSummary,
  type SummariseModulesResult,
} from './modules.ts';
