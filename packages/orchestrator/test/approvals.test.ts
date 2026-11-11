import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentForgeError } from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import { contentHashOf } from '@agentforge/db';
import {
  decideArtifact,
  getHeadArtifact,
  getSpec,
  listApprovals,
  listArtifactVersions,
  listAuditEntries,
  transition,
  writeArtifact,
} from '../src/index.ts';
import {
  AGENT,
  HUMAN,
  ORCHESTRATOR,
  driveTo,
  makeSpec,
  makeTestDb,
  putArtifact,
  samplePayload,
  type TestDb,
} from './helpers.ts';

/**
 * Hash-bound approval: the governance proof.
 *
 * The claim this project is defended on is that an approval applies to the exact bytes
 * a reviewer saw, and that nothing — not an agent, not a retry, not a direct SQL
 * UPDATE — can make an approval cover content nobody reviewed. These tests are that
 * claim stated executably.
 */

let ctx: TestDb;
let db: Db;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
});

afterEach(() => {
  ctx.cleanup();
});

/** Reads the spec, failing loudly rather than returning undefined into an assertion. */
function current(specId: string) {
  const spec = getSpec(db, specId);
  if (spec === undefined) throw new Error(`spec ${specId} not found`);
  return spec;
}

function headOf(specId: string, kind: 'requirements' | 'design') {
  const head = getHeadArtifact(db, specId, kind);
  if (head === undefined) throw new Error(`no ${kind} artifact`);
  return head;
}

describe('approving an artifact', () => {
  it('records the decision and advances the spec', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');
    const head = headOf(spec.id, 'requirements');

    const result = decideArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      contentHash: head.contentHash,
      decision: 'approve',
      comment: 'Looks right.',
      actor: HUMAN,
      expectedVersion: current(spec.id).version,
    });

    expect(result.spec.status).toBe('REQ_APPROVED');

    const approvals = listApprovals(db, spec.id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.decision).toBe('approve');
    // The hash is copied onto the decision, not referenced indirectly.
    expect(approvals[0]?.contentHash).toBe(head.contentHash);
    expect(approvals[0]?.artifactVersionId).toBe(head.id);
    expect(approvals[0]?.actor).toBe(HUMAN.id);
  });

  it('records the approved hash in the audit payload', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');
    const head = headOf(spec.id, 'requirements');

    decideArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      contentHash: head.contentHash,
      decision: 'approve',
      actor: HUMAN,
      expectedVersion: current(spec.id).version,
    });

    const entry = listAuditEntries(db, spec.id).at(-1);
    expect(entry?.toState).toBe('REQ_APPROVED');
    expect(entry?.actorType).toBe('human');
    expect(JSON.parse(entry?.payload ?? 'null')).toMatchObject({
      decision: 'approve',
      artifact_kind: 'requirements',
      content_hash: head.contentHash,
    });
  });
});

describe('a stale content hash is refused', () => {
  it('rejects a hash that does not match the head version', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');

    const bogus = 'f'.repeat(64);
    try {
      decideArtifact(db, {
        specId: spec.id,
        kind: 'requirements',
        contentHash: bogus,
        decision: 'approve',
        actor: HUMAN,
        expectedVersion: current(spec.id).version,
      });
      throw new Error('expected HASH_MISMATCH');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('HASH_MISMATCH');
      expect(e.status).toBe(409);
    }

    // Nothing was recorded and nothing moved.
    expect(listApprovals(db, spec.id)).toHaveLength(0);
    expect(current(spec.id).status).toBe('REQ_AWAITING_APPROVAL');
  });

  it('rejects the hash of a superseded version', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');
    const v1 = headOf(spec.id, 'requirements');

    // A reviewer asks for changes, the agent redrafts, and the reviewer's old tab
    // submits the hash it still has.
    decideArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      contentHash: v1.contentHash,
      decision: 'request_changes',
      comment: 'Add the TDS case.',
      actor: HUMAN,
      expectedVersion: current(spec.id).version,
    });
    expect(current(spec.id).status).toBe('REQ_DRAFTING');

    const revised = samplePayload('requirements') as Record<string, unknown>;
    revised['feature_summary'] = 'Export invoices, including the TDS case.';
    writeArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      payload: revised,
      contentMd: '# requirements v2\n',
      actor: AGENT,
    });
    transition(db, {
      specId: spec.id,
      from: 'REQ_DRAFTING',
      to: 'REQ_AWAITING_APPROVAL',
      actor: ORCHESTRATOR,
      expectedVersion: current(spec.id).version,
    });

    const v2 = headOf(spec.id, 'requirements');
    expect(v2.version).toBe(2);
    expect(v2.contentHash).not.toBe(v1.contentHash);

    try {
      decideArtifact(db, {
        specId: spec.id,
        kind: 'requirements',
        contentHash: v1.contentHash,
        decision: 'approve',
        actor: HUMAN,
        expectedVersion: current(spec.id).version,
      });
      throw new Error('expected HASH_MISMATCH on the stale version');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('HASH_MISMATCH');
    }

    expect(current(spec.id).status).toBe('REQ_AWAITING_APPROVAL');
  });
});

describe('design drafting refuses to start on changed requirements', () => {
  it('blocks the transition once requirements move past the approved hash', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_APPROVED');
    const approvedHash = headOf(spec.id, 'requirements').contentHash;

    // Requirements are revised after approval. The only legal way back into drafting is
    // a human decision, so go round the loop properly and redraft.
    transition(db, {
      specId: spec.id,
      from: 'REQ_APPROVED',
      to: 'DESIGN_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: current(spec.id).version,
    });
    transition(db, {
      specId: spec.id,
      from: 'DESIGN_DRAFTING',
      to: 'FAILED',
      actor: HUMAN,
      expectedVersion: current(spec.id).version,
      reason: 'parking this run; the requirements were wrong',
    });

    // Now prove the guard itself on a second spec, with a hand-built divergence.
    const other = makeSpec(db);
    driveTo(db, other.id, 'REQ_AWAITING_APPROVAL');
    const head = headOf(other.id, 'requirements');
    decideArtifact(db, {
      specId: other.id,
      kind: 'requirements',
      contentHash: head.contentHash,
      decision: 'approve',
      actor: HUMAN,
      expectedVersion: current(other.id).version,
    });
    expect(current(other.id).status).toBe('REQ_APPROVED');

    // Simulate a new requirements version landing while the spec sits in REQ_APPROVED.
    // writeArtifact refuses this, so insert directly: the point is that even a row that
    // bypasses the orchestrator cannot smuggle itself past the hash guard.
    const forged = samplePayload('requirements') as Record<string, unknown>;
    forged['feature_summary'] = 'Something nobody approved.';
    db.$client
      .prepare(
        `INSERT INTO artifact_versions
           (id, spec_id, kind, version, content_json, content_md, content_hash,
            idempotency_key, created_by, created_at)
         VALUES (?, ?, 'requirements', 2, ?, '# forged', ?, NULL, 'attacker', ?)`,
      )
      .run(
        'art_forged',
        other.id,
        JSON.stringify(forged),
        contentHashOf(forged),
        new Date().toISOString(),
      );

    try {
      transition(db, {
        specId: other.id,
        from: 'REQ_APPROVED',
        to: 'DESIGN_DRAFTING',
        actor: ORCHESTRATOR,
        expectedVersion: current(other.id).version,
      });
      throw new Error('expected the guard to block design drafting');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('HASH_MISMATCH');
      expect(e.message).toContain('changed after approval');
    }

    expect(current(other.id).status).toBe('REQ_APPROVED');
    expect(approvedHash).not.toBe(contentHashOf(forged));
  });
});

describe('rejection paths', () => {
  it.each(['reject', 'request_changes'] as const)('returns to drafting on %s', (decision) => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');
    const head = headOf(spec.id, 'requirements');

    const result = decideArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      contentHash: head.contentHash,
      decision,
      comment: 'Not yet.',
      actor: HUMAN,
      expectedVersion: current(spec.id).version,
    });

    expect(result.spec.status).toBe('REQ_DRAFTING');
    expect(listApprovals(db, spec.id)[0]?.decision).toBe(decision);
  });

  it('refuses to advance to design after a rejection', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');
    const head = headOf(spec.id, 'requirements');

    decideArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      contentHash: head.contentHash,
      decision: 'reject',
      actor: HUMAN,
      expectedVersion: current(spec.id).version,
    });

    // REQ_DRAFTING -> DESIGN_DRAFTING is not an edge at all.
    expect(() =>
      transition(db, {
        specId: spec.id,
        from: 'REQ_DRAFTING',
        to: 'DESIGN_DRAFTING',
        actor: ORCHESTRATOR,
        expectedVersion: current(spec.id).version,
      }),
    ).toThrow(/not a legal transition/);
  });
});

describe('agents cannot approve', () => {
  it('refuses decideArtifact from an agent actor', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');
    const head = headOf(spec.id, 'requirements');

    try {
      decideArtifact(db, {
        specId: spec.id,
        kind: 'requirements',
        contentHash: head.contentHash,
        decision: 'approve',
        actor: AGENT,
        expectedVersion: current(spec.id).version,
      });
      throw new Error('expected the approval to be refused');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('ILLEGAL_TRANSITION');
    }

    // The whole decision rolled back: no approval row survives the failed transition.
    expect(listApprovals(db, spec.id)).toHaveLength(0);
    expect(current(spec.id).status).toBe('REQ_AWAITING_APPROVAL');
  });
});

describe('decisions are only accepted at the gate', () => {
  it('refuses a decision while the spec is still drafting', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_DRAFTING');
    putArtifact(db, spec.id, 'requirements');
    const head = headOf(spec.id, 'requirements');

    try {
      decideArtifact(db, {
        specId: spec.id,
        kind: 'requirements',
        contentHash: head.contentHash,
        decision: 'approve',
        actor: HUMAN,
        expectedVersion: current(spec.id).version,
      });
      throw new Error('expected PRECONDITION_FAILED');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('REQ_AWAITING_APPROVAL');
    }
  });

  it('refuses a decision on an artifact kind that has no gate', () => {
    // `context`, not `tasks`. Tasks gained a real gate: approving them is what releases
    // the spec for implementation, and that edge is where the PreToolUse hook starts
    // permitting file edits. Context has no gate — it is evidence the later stages build
    // on, and its trustworthiness comes from the verifier rather than from a signature.
    const spec = makeSpec(db, 'brownfield');
    expect(() =>
      decideArtifact(db, {
        specId: spec.id,
        kind: 'context',
        contentHash: 'a'.repeat(64),
        decision: 'approve',
        actor: HUMAN,
        expectedVersion: 0,
      }),
    ).toThrow(/not subject to human approval/);
  });
});

describe('approval rows are append-only', () => {
  it('blocks UPDATE and DELETE even via direct SQL', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');
    const head = headOf(spec.id, 'requirements');
    decideArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      contentHash: head.contentHash,
      decision: 'reject',
      actor: HUMAN,
      expectedVersion: current(spec.id).version,
    });

    const row = listApprovals(db, spec.id)[0];
    if (row === undefined) throw new Error('expected a decision row');

    expect(() =>
      db.$client.prepare("UPDATE approvals SET decision = 'approve' WHERE id = ?").run(row.id),
    ).toThrow(/append-only/);
    expect(() => db.$client.prepare('DELETE FROM approvals WHERE id = ?').run(row.id)).toThrow(
      /append-only/,
    );
  });
});

describe('artifact versioning', () => {
  it('refuses to write an artifact kind outside its drafting state', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_DRAFTING');

    try {
      writeArtifact(db, {
        specId: spec.id,
        kind: 'design',
        payload: samplePayload('design'),
        contentMd: '# design\n',
        actor: AGENT,
      });
      throw new Error('expected the write to be refused');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('DESIGN_DRAFTING');
    }

    expect(listArtifactVersions(db, spec.id, 'design')).toHaveLength(0);
  });

  it('increments versions and changes the hash when content changes', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_DRAFTING');

    const first = putArtifact(db, spec.id, 'requirements');
    const changed = samplePayload('requirements') as Record<string, unknown>;
    changed['feature_summary'] = 'Different summary.';
    const second = writeArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      payload: changed,
      contentMd: '# requirements v2\n',
      actor: AGENT,
    });

    expect(first.artifact.version).toBe(1);
    expect(second.artifact.version).toBe(2);
    expect(second.artifact.contentHash).not.toBe(first.artifact.contentHash);
    expect(listArtifactVersions(db, spec.id, 'requirements')).toHaveLength(2);
  });

  it('hashes canonically, so key order does not change the hash', () => {
    const a = { b: 1, a: { d: [1, 2], c: 'x' } };
    const b = { a: { c: 'x', d: [1, 2] }, b: 1 };
    expect(contentHashOf(a)).toBe(contentHashOf(b));

    // Array order, by contrast, is significant.
    expect(contentHashOf({ a: [1, 2] })).not.toBe(contentHashOf({ a: [2, 1] }));
  });

  it('replays an idempotent write instead of creating a duplicate version', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_DRAFTING');

    const key = 'draft-req-attempt-1';
    const first = writeArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      payload: samplePayload('requirements'),
      contentMd: '# requirements\n',
      actor: AGENT,
      idempotencyKey: key,
    });
    const retry = writeArtifact(db, {
      specId: spec.id,
      kind: 'requirements',
      payload: samplePayload('requirements'),
      contentMd: '# requirements\n',
      actor: AGENT,
      idempotencyKey: key,
    });

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.artifact.id).toBe(first.artifact.id);
    expect(listArtifactVersions(db, spec.id, 'requirements')).toHaveLength(1);
  });

  it('makes artifact versions immutable at the database level', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_DRAFTING');
    const written = putArtifact(db, spec.id, 'requirements');

    expect(() =>
      db.$client
        .prepare('UPDATE artifact_versions SET content_md = ? WHERE id = ?')
        .run('tampered', written.artifact.id),
    ).toThrow(/immutable/);
  });

  it('rejects an empty markdown render', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_DRAFTING');

    expect(() =>
      writeArtifact(db, {
        specId: spec.id,
        kind: 'requirements',
        payload: samplePayload('requirements'),
        contentMd: '',
        actor: AGENT,
      }),
    ).toThrow(/must not be empty/);
  });
});
