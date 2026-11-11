import { UpstreamError, ValidationError } from '@agentforge/contract';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '@agentforge/db';

/**
 * Which gateway we talk to.
 *
 * Two are supported, and the distinction is deliberately confined to this file so the
 * rest of the system never knows which one is in use:
 *
 * - **anthropic** — the first-party API, keyed by `ANTHROPIC_API_KEY`.
 * - **openrouter** — keyed by `OPENROUTER_API_KEY`. OpenRouter exposes an
 *   Anthropic-format `/v1/messages` endpoint, so the same SDK, the same
 *   `output_config.format` structured outputs and the same `cache_control` breakpoints
 *   all work unchanged. Verified against the live API before this was written:
 *   structured outputs return schema-valid JSON, `effort` and `format` combine, and a
 *   cached prefix reported 6003 creation tokens on the first call and 6003 *read*
 *   tokens on the second.
 *
 * Model ids stay canonical everywhere inside the system (`claude-haiku-5-5`) and are
 * translated to the gateway's slug at the edge. That keeps one pricing table, one set
 * of `llm_calls.model` values, and cost analysis that does not depend on which gateway
 * happened to serve a run.
 */

export const PROVIDERS = ['anthropic', 'openrouter'] as const;

export type ProviderName = (typeof PROVIDERS)[number];

export interface Provider {
  readonly name: ProviderName;
  /** Passed to the SDK. `undefined` means the SDK's own default. */
  readonly baseURL: string | undefined;
  /** Set for bearer-token gateways; mutually exclusive with `apiKey`. */
  readonly authToken: string | null;
  readonly apiKey: string | null;
}

/**
 * Loads `.env` once, if present.
 *
 * Node reads no env file by default, and requiring every entry point — CLI scripts, the
 * Next server, the eval harness — to remember a flag is how a key ends up mysteriously
 * missing in one of them. Called from `resolveProvider`, so any path that needs a key
 * has already loaded it.
 */
let envLoaded = false;

export function loadEnvFile(path = '.env'): void {
  if (envLoaded) return;
  envLoaded = true;

  // Hermetic by construction: the test runner sets this, so a suite can never pick up a
  // developer's real key and start making live, billable calls. Without it, simply
  // having a working .env on the machine would turn an offline test run into a paid one.
  if (process.env['SDD_NO_ENV_FILE'] === '1') return;

  // Anchored to the repository root, not `process.cwd()`.
  //
  // The Next dev server runs with its working directory set to `apps/web`, so a
  // cwd-relative lookup searched `apps/web/.env` — which does not exist — and the
  // application started with no API key while the key sat in the root `.env` all along.
  // The failure surfaced as "no ANTHROPIC_API_KEY or OPENROUTER_API_KEY is set" from a
  // button press, which is a confusing way to learn where a file was being looked for.
  // The database path had exactly this bug and is anchored the same way.
  //
  // `turbopackIgnore` because the path is still dynamic to the bundler's static
  // analysis, which would otherwise trace the whole project into the server bundle.
  const file = resolve(/* turbopackIgnore: true */ REPO_ROOT, path);
  if (!existsSync(file)) return;

  try {
    process.loadEnvFile(file);
  } catch {
    // A malformed .env should not be fatal: the variables may already be in the
    // environment, which is the normal case in CI.
  }
}

function trimmed(name: string): string | null {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * Picks the gateway from whichever key is present.
 *
 * An explicit `SDD_PROVIDER` wins, so a machine holding both keys can choose. Otherwise
 * the first-party API is preferred when its key exists, because it is the one the
 * project's cost figures were modelled on.
 */
export function resolveProvider(): Provider {
  loadEnvFile();

  const requested = trimmed('SDD_PROVIDER');
  if (requested !== null && !(PROVIDERS as readonly string[]).includes(requested)) {
    throw new ValidationError(
      `SDD_PROVIDER must be one of ${PROVIDERS.join(', ')}, received "${requested}"`,
      { value: requested },
    );
  }

  const anthropicKey = trimmed('ANTHROPIC_API_KEY');
  const openrouterKey = trimmed('OPENROUTER_API_KEY');

  const choose = (): ProviderName => {
    if (requested !== null) return requested as ProviderName;
    if (anthropicKey !== null) return 'anthropic';
    if (openrouterKey !== null) return 'openrouter';
    // No key at all. Reported as `anthropic` so the error message names the
    // first-party variable first; the caller checks `hasCredentials()` before using it.
    return 'anthropic';
  };

  const name = choose();

  if (name === 'openrouter') {
    if (openrouterKey === null) {
      throw new UpstreamError('SDD_PROVIDER is openrouter but OPENROUTER_API_KEY is not set', {
        details: { provider: name },
      });
    }
    return {
      name,
      // Stops at /api: the SDK appends /v1/messages itself, and including /v1 here
      // produces a doubled path and a 404.
      baseURL: 'https://openrouter.ai/api',
      authToken: openrouterKey,
      apiKey: null,
    };
  }

  return { name, baseURL: undefined, authToken: null, apiKey: anthropicKey };
}

/** Whether a usable key exists for the selected gateway. */
export function hasCredentials(): boolean {
  loadEnvFile();
  const requested = trimmed('SDD_PROVIDER');

  if (requested === 'openrouter') return trimmed('OPENROUTER_API_KEY') !== null;
  if (requested === 'anthropic') return trimmed('ANTHROPIC_API_KEY') !== null;
  return trimmed('ANTHROPIC_API_KEY') !== null || trimmed('OPENROUTER_API_KEY') !== null;
}

/**
 * Canonical model id to the gateway's slug.
 *
 * OpenRouter namespaces by vendor and uses dotted versions, so `claude-haiku-5-5`
 * becomes `anthropic/claude-haiku-5.5`. Derived rather than table-driven so a model
 * added to `MODEL_PRICING` works on both gateways without a second edit — the
 * translation is asserted against the live slug list by the provider tests.
 */
export function toProviderModel(canonical: string, provider: ProviderName): string {
  if (provider !== 'openrouter') return canonical;

  // claude-haiku-5-5 -> claude-haiku-5.5 (only the trailing version segments).
  const dotted = canonical.replace(/-(\d+)-(\d+)$/, '-$1.$2');
  return `anthropic/${dotted}`;
}

/**
 * The Batch API slug, where the gateway distinguishes it.
 *
 * OpenRouter exposes batch as a separate `:batch` model rather than a separate
 * endpoint, so module-summary generation has to name it explicitly.
 */
export function toBatchModel(canonical: string, provider: ProviderName): string {
  const base = toProviderModel(canonical, provider);
  return provider === 'openrouter' ? `${base}:batch` : base;
}
