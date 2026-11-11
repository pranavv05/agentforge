import { type LlmStage, ValidationError } from '@agentforge/contract';
import { MODEL_PRICING } from '@agentforge/orchestrator';

/**
 * Model and request configuration.
 *
 * Models are configuration, never literals in call sites: the project runs everything
 * on Haiku 5.5 during development and switches the Requirement and Design agents to
 * Sonnet 5.5 for demo runs, which has to be a single environment change rather than a
 * code edit.
 */

/** Effort levels accepted by `output_config.effort`. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type Effort = (typeof EFFORT_LEVELS)[number];

/** Which env var selects the model for each stage. */
const STAGE_MODEL_ENV: Record<LlmStage, string> = {
  context_scan: 'SDD_MODEL_CONTEXT',
  module_summary: 'SDD_MODEL_CONTEXT',
  context_loop: 'SDD_MODEL_CONTEXT',
  requirements: 'SDD_MODEL_REQUIREMENTS',
  clarification: 'SDD_MODEL_REQUIREMENTS',
  design: 'SDD_MODEL_DESIGN',
  tasks: 'SDD_MODEL_TASKS',
  compliance: 'SDD_MODEL_TASKS',
  eval: 'SDD_MODEL_CONTEXT',
};

/**
 * Default effort per stage.
 *
 * Effort is the first quality/cost lever, so it is set deliberately rather than left
 * to each model's default (which differs: Haiku 5.5 defaults to `medium`, Sonnet 5.5
 * to `high`). Exploration and summarisation are routine and run `low`; the judgement
 * stages that a human will review run `high`.
 */
const STAGE_EFFORT: Record<LlmStage, Effort> = {
  context_scan: 'low',
  module_summary: 'low',
  // The agentic loop is reasoning over search results, so it earns a middle setting.
  context_loop: 'medium',
  requirements: 'high',
  clarification: 'medium',
  design: 'high',
  tasks: 'medium',
  compliance: 'medium',
  eval: 'low',
};

export const DEFAULT_MODEL = 'claude-haiku-5-5';

/** Resolves the model for a stage, validating that we know how to price it. */
export function modelForStage(stage: LlmStage): string {
  const envVar = STAGE_MODEL_ENV[stage];
  const model = process.env[envVar] ?? DEFAULT_MODEL;

  if (!(model in MODEL_PRICING)) {
    throw new ValidationError(
      `${envVar} is set to "${model}", which has no entry in MODEL_PRICING; ` +
        'add its list prices before using it so spend is still measured',
      { stage, env_var: envVar, model, known: Object.keys(MODEL_PRICING) },
    );
  }

  return model;
}

export function effortForStage(stage: LlmStage): Effort {
  const override = process.env['SDD_EFFORT_OVERRIDE'];
  if (override !== undefined) {
    if (!(EFFORT_LEVELS as readonly string[]).includes(override)) {
      throw new ValidationError(
        `SDD_EFFORT_OVERRIDE must be one of ${EFFORT_LEVELS.join(', ')}, received "${override}"`,
        { value: override },
      );
    }
    return override as Effort;
  }
  return STAGE_EFFORT[stage];
}

/** Default output ceiling, for stages whose output is small and bounded. */
export const MAX_TOKENS = 16_000;

/**
 * Output ceiling per stage.
 *
 * Raised for design and tasks after the first live run hit the 16K ceiling mid-document.
 * Two things make those stages hungrier than they look:
 *
 * - the compliance pack injects criteria, so a single feature legitimately produced 13
 *   requirements and 21 acceptance criteria, and the design must cover every one;
 * - **adaptive thinking tokens count towards `output_tokens`**, so a stage running at
 *   `high` effort spends part of this budget reasoning before it writes anything.
 *
 * These stay within what the TypeScript SDK will do non-streaming — it scales its own
 * timeout up for a large `max_tokens` on a non-streaming request — so no streaming path
 * is needed to make them safe.
 */
const STAGE_MAX_TOKENS: Partial<Record<LlmStage, number>> = {
  design: 48_000,
  tasks: 32_000,
  requirements: 32_000,
};

export function maxTokensForStage(stage: LlmStage): number {
  const override = process.env['SDD_MAX_OUTPUT_TOKENS'];
  if (override !== undefined) {
    const parsed = Number(override);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ValidationError(
        `SDD_MAX_OUTPUT_TOKENS must be a positive integer, received "${override}"`,
        { value: override },
      );
    }
    return parsed;
  }
  return STAGE_MAX_TOKENS[stage] ?? MAX_TOKENS;
}

/**
 * The prompt-size ceiling for the agentic loop.
 *
 * Not arbitrary: Haiku 5.5 prices prompts above 100K tokens five times higher, so
 * staying under it is what keeps the context step cheap. `cost.test.ts` pins the
 * arithmetic behind this.
 */
export function maxPromptTokens(): number {
  const raw = process.env['SDD_MAX_PROMPT_TOKENS'] ?? '100000';
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(
      `SDD_MAX_PROMPT_TOKENS must be a positive integer, received "${raw}"`,
      { value: raw },
    );
  }
  return parsed;
}

/** Hard ceiling on tool calls in one agentic loop. */
export function maxToolCalls(): number {
  const raw = process.env['SDD_MAX_TOOL_CALLS'] ?? '25';
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`SDD_MAX_TOOL_CALLS must be a positive integer, received "${raw}"`, {
      value: raw,
    });
  }
  return parsed;
}

export const CASSETTE_MODES = ['off', 'record', 'replay'] as const;

export type CassetteMode = (typeof CASSETTE_MODES)[number];

/**
 * How to treat recorded responses.
 *
 * `replay` is what CI uses: the agent suite runs offline and deterministically, so a
 * green build never depends on a live model call or costs anything.
 */
export function cassetteMode(): CassetteMode {
  const raw = process.env['SDD_CASSETTE_MODE'] ?? 'off';
  if (!(CASSETTE_MODES as readonly string[]).includes(raw)) {
    throw new ValidationError(
      `SDD_CASSETTE_MODE must be one of ${CASSETTE_MODES.join(', ')}, received "${raw}"`,
      { value: raw },
    );
  }
  return raw as CassetteMode;
}
