/**
 * `@agentforge/llm` — the only path to the Claude API.
 *
 * Centralising model calls here is what makes the project's cost and reliability
 * claims checkable: budget enforcement, prompt-cache placement, structured-output
 * validation and usage recording all happen on one code path, so no call site can skip
 * them.
 */

export {
  anthropic,
  complete,
  setAnthropicClient,
  type CompleteRequest,
  type CompleteResult,
} from './client.ts';

export {
  DEFAULT_CASSETTE_DIR,
  cassetteDir,
  CassetteSchema,
  cassetteKey,
  listCassettes,
  readCassette,
  writeCassette,
  type Cassette,
  type CassetteKeyParts,
} from './cassette.ts';

export {
  CASSETTE_MODES,
  DEFAULT_MODEL,
  EFFORT_LEVELS,
  MAX_TOKENS,
  cassetteMode,
  effortForStage,
  maxPromptTokens,
  maxTokensForStage,
  maxToolCalls,
  modelForStage,
  type CassetteMode,
  type Effort,
} from './config.ts';

export {
  PROVIDERS,
  hasCredentials,
  loadEnvFile,
  resolveProvider,
  toBatchModel,
  toProviderModel,
  type Provider,
  type ProviderName,
} from './provider.ts';

export {
  assertStable,
  buildSystem,
  estimateTokens,
  systemText,
  type PromptSection,
} from './prompt.ts';
