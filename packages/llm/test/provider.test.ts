import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentForgeError } from '@agentforge/contract';
import { MODEL_PRICING } from '@agentforge/orchestrator';
import { hasCredentials, resolveProvider, toBatchModel, toProviderModel } from '../src/index.ts';

/**
 * Gateway selection and model-id translation.
 *
 * Two gateways are supported and the rest of the system is meant not to know which is
 * in use. These tests pin that: canonical ids in, gateway slugs out, and credentials
 * resolved from whichever key exists.
 *
 * The OpenRouter slugs asserted here were checked against its live model list, so a
 * translation bug shows up as a test failure rather than a 404 mid-run.
 */

// Saved and restored explicitly rather than in a loop: a dynamic delete on process.env
// is both a lint error and easy to get silently wrong.
let savedAnthropic: string | undefined;
let savedOpenRouter: string | undefined;
let savedProvider: string | undefined;

beforeEach(() => {
  savedAnthropic = process.env['ANTHROPIC_API_KEY'];
  savedOpenRouter = process.env['OPENROUTER_API_KEY'];
  savedProvider = process.env['SDD_PROVIDER'];

  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['OPENROUTER_API_KEY'];
  delete process.env['SDD_PROVIDER'];
});

afterEach(() => {
  if (savedAnthropic === undefined) delete process.env['ANTHROPIC_API_KEY'];
  else process.env['ANTHROPIC_API_KEY'] = savedAnthropic;

  if (savedOpenRouter === undefined) delete process.env['OPENROUTER_API_KEY'];
  else process.env['OPENROUTER_API_KEY'] = savedOpenRouter;

  if (savedProvider === undefined) delete process.env['SDD_PROVIDER'];
  else process.env['SDD_PROVIDER'] = savedProvider;
});

describe('choosing a gateway', () => {
  it('uses the first-party API when its key is present', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';

    const provider = resolveProvider();
    expect(provider.name).toBe('anthropic');
    // The SDK's own default base URL, not an override.
    expect(provider.baseURL).toBeUndefined();
    expect(provider.apiKey).toBe('sk-ant-test');
    expect(provider.authToken).toBeNull();
  });

  it('uses OpenRouter when only its key is present', () => {
    process.env['OPENROUTER_API_KEY'] = 'sk-or-test';

    const provider = resolveProvider();
    expect(provider.name).toBe('openrouter');
    // Stops at /api: the SDK appends /v1/messages itself, and including /v1 here
    // produces a doubled path and a 404. Found the hard way on the first live call.
    expect(provider.baseURL).toBe('https://openrouter.ai/api');
    expect(provider.authToken).toBe('sk-or-test');
    expect(provider.apiKey).toBeNull();
  });

  it('prefers the first-party API when both keys exist', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    process.env['OPENROUTER_API_KEY'] = 'sk-or-test';
    expect(resolveProvider().name).toBe('anthropic');
  });

  it('honours an explicit override', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    process.env['OPENROUTER_API_KEY'] = 'sk-or-test';
    process.env['SDD_PROVIDER'] = 'openrouter';

    expect(resolveProvider().name).toBe('openrouter');
  });

  it('rejects an unknown provider rather than silently defaulting', () => {
    process.env['SDD_PROVIDER'] = 'openai';
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';

    try {
      resolveProvider();
      throw new Error('expected the provider to be rejected');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('reports a missing key for the requested gateway', () => {
    process.env['SDD_PROVIDER'] = 'openrouter';
    expect(() => resolveProvider()).toThrow(/OPENROUTER_API_KEY is not set/);
  });
});

describe('hasCredentials', () => {
  it('is false with no key at all', () => {
    expect(hasCredentials()).toBe(false);
  });

  it('is true with either key', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    expect(hasCredentials()).toBe(true);

    delete process.env['ANTHROPIC_API_KEY'];
    process.env['OPENROUTER_API_KEY'] = 'sk-or-test';
    expect(hasCredentials()).toBe(true);
  });

  it('checks only the requested gateway when one is pinned', () => {
    process.env['SDD_PROVIDER'] = 'openrouter';
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    // The wrong key is not a usable credential for the pinned gateway.
    expect(hasCredentials()).toBe(false);

    process.env['OPENROUTER_API_KEY'] = 'sk-or-test';
    expect(hasCredentials()).toBe(true);
  });
});

describe('model id translation', () => {
  it('leaves canonical ids alone for the first-party API', () => {
    for (const model of Object.keys(MODEL_PRICING)) {
      expect(toProviderModel(model, 'anthropic')).toBe(model);
    }
  });

  it('maps canonical ids to OpenRouter slugs', () => {
    // These were checked against OpenRouter's live model list.
    expect(toProviderModel('claude-haiku-5-5', 'openrouter')).toBe('anthropic/claude-haiku-5.5');
    expect(toProviderModel('claude-sonnet-5-5', 'openrouter')).toBe('anthropic/claude-sonnet-5.5');
    expect(toProviderModel('claude-opus-5-5', 'openrouter')).toBe('anthropic/claude-opus-5.5');
    expect(toProviderModel('claude-haiku-4-5', 'openrouter')).toBe('anthropic/claude-haiku-4.5');
  });

  it('produces a well-formed slug for every priced model', () => {
    // Derived rather than table-driven, so a model added to MODEL_PRICING works on both
    // gateways without a second edit. This pins the shape of what it derives.
    for (const model of Object.keys(MODEL_PRICING)) {
      const slug = toProviderModel(model, 'openrouter');
      expect(slug, model).toMatch(/^anthropic\/claude-[a-z]+-\d+\.\d+$/);
    }
  });

  it('names the batch variant, which OpenRouter exposes as a separate model', () => {
    expect(toBatchModel('claude-haiku-5-5', 'openrouter')).toBe('anthropic/claude-haiku-5.5:batch');
    // The first-party API uses a separate endpoint rather than a separate model id.
    expect(toBatchModel('claude-haiku-5-5', 'anthropic')).toBe('claude-haiku-5-5');
  });
});
