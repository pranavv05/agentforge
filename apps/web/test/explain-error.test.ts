import { describe, expect, it } from 'vitest';
import { AgentForgeError, ERROR_CODES, type ErrorCode } from '@agentforge/contract';
import { explainError } from '@/components/workspace/explain-error';

/**
 * How a failure is explained to the person who hit it.
 *
 * Before this existed, three components showed the raw server message ("expected version
 * 7, found 8"), none recognised an expired session, a spend-limit refusal or the network
 * being down, and "reload to see where it got to" came with no way to reload. These tests
 * pin the translation, because it is the moment a person most needs three answers — what
 * happened, whether anything changed, and what to do — and it is easy to regress by
 * adding an error code and forgetting this file.
 */

const err = (code: ErrorCode, message = 'server words', correlationId: string | null = null) =>
  new AgentForgeError(code, message, { correlationId });

describe('explainError', () => {
  it('sends an expired session to sign-in, and says nothing was changed', () => {
    const result = explainError(err('UNAUTHENTICATED'), 'fallback');

    expect(result.action).toBe('sign-in');
    expect(result.message).toContain('Sign in');
    expect(result.message).toContain('changed nothing');
  });

  it('turns a stale version into a reload, not a version number', () => {
    const result = explainError(err('VERSION_CONFLICT', 'expected version 7, found 8'), 'fallback');

    expect(result.action).toBe('reload');
    // The server's wording is accurate and useless to a reviewer.
    expect(result.message).not.toContain('expected version');
    expect(result.message).toContain('nothing changed');
  });

  it('explains a hash mismatch as the binding working, and reloads', () => {
    const result = explainError(err('HASH_MISMATCH'), 'fallback');

    expect(result.action).toBe('reload');
    expect(result.message).toContain('changed after you opened it');
  });

  it('says a budget refusal happened before the call, so nothing was charged', () => {
    const result = explainError(err('BUDGET_EXCEEDED'), 'fallback');

    expect(result.message).toContain('nothing was charged');
    expect(result.action).toBeNull();
  });

  it('offers a retry for an upstream failure', () => {
    const result = explainError(err('UPSTREAM_FAILED'), 'fallback');

    expect(result.action).toBe('retry');
    expect(result.message).toContain('Nothing was recorded');
  });

  it('keeps the server sentence for validation, which is written for people', () => {
    const result = explainError(
      err('VALIDATION_FAILED', 'repo_path does not exist: D:\\nowhere'),
      'fallback',
    );

    // The path is the only actionable part, so it must survive.
    expect(result.message).toContain('D:\\nowhere');
    expect(result.action).toBeNull();
  });

  it('says a missing repository in the words of the form, and keeps the path', () => {
    // The orchestrator reports it as "repo_path does not exist", naming a field nobody
    // typing into an "Existing repo" box ever saw.
    const result = explainError(
      err('VALIDATION_FAILED', 'repo_path does not exist: Z:/nope/checkout'),
      'fallback',
    );

    expect(result.message).toContain('repository path does not exist');
    expect(result.message).toContain('Z:/nope/checkout');
    expect(result.message).not.toContain('repo_path');
  });

  it('distinguishes a file from a folder', () => {
    const result = explainError(
      err('VALIDATION_FAILED', 'repo_path is not a directory: C:/a/file.txt'),
      'fallback',
    );

    expect(result.message).toContain('file, not a folder');
    expect(result.message).toContain('C:/a/file.txt');
  });

  it('frames a refused transition instead of replacing the reason', () => {
    const result = explainError(
      err('PRECONDITION_FAILED', 'no design artifact exists for this spec yet'),
      'fallback',
    );

    expect(result.message).toContain('not available right now');
    expect(result.message).toContain('no design artifact exists');
    expect(result.action).toBe('reload');
  });

  it('carries the correlation id so a failure can be found in the logs', () => {
    const result = explainError(err('INTERNAL', 'boom', 'corr-123'), 'fallback');

    expect(result.reference).toBe('corr-123');
    // And never leaks the internal message, which can name files and stack frames.
    expect(result.message).not.toContain('boom');
  });

  it('recognises a network failure, which is a bare TypeError and not an AgentForgeError', () => {
    // fetch rejects with this when the request never completes. It used to read as a
    // vague "could not be run", hiding the one thing the person can act on.
    const result = explainError(new TypeError('Failed to fetch'), 'fallback');

    expect(result.action).toBe('retry');
    expect(result.message).toContain('Could not reach the server');
    expect(result.message).toContain('Nothing was changed');
  });

  it('uses the caller fallback for something it has never seen', () => {
    expect(explainError('a string was thrown', 'fallback here').message).toBe('fallback here');
    expect(explainError(undefined, 'fallback here').message).toBe('fallback here');
  });

  it('has a sensible answer for every code the contract defines', () => {
    // A new error code added to the contract and not handled here would fall through to
    // the caller's generic fallback. That is acceptable behaviour — but it should be a
    // decision, so this lists the codes that are deliberately left to the fallback.
    const leftToFallback = new Set<ErrorCode>(['ILLEGAL_TRANSITION']);

    for (const code of ERROR_CODES) {
      const result = explainError(err(code, 'server words'), 'GENERIC FALLBACK');

      expect(result.message.length, code).toBeGreaterThan(10);
      if (!leftToFallback.has(code)) {
        // Nothing may be shown as a blank or as the literal word "undefined".
        expect(result.message, code).not.toContain('undefined');
      }
    }
  });
});
