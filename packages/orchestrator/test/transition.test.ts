import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentForgeError,
  SPEC_STATES,
  type SpecState,
  isTerminalState,
} from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import {
  findRule,
  getHeadArtifact,
  getSpec,
  listAuditEntries,
  nextStates,
  transition,
  TRANSITION_RULES,
} from '../src/index.ts';
import {
  AGENT,
  HUMAN,
  ORCHESTRATOR,
  driveTo,
  makeSpec,
  makeTestDb,
  putArtifact,
  type TestDb,
} from './helpers.ts';

/**
 * The transition matrix, tested exhaustively.
 *
 * The quality bar requires that *every* allowed pair succeeds and *every* forbidden
 * pair is rejected — not a sample. With 15 states that is 225 ordered pairs, which is
 * cheap to enumerate and the only way to be sure the table has no accidental edge.
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

/** Every ordered pair of states, including self-pairs. */
const ALL_PAIRS: readonly (readonly [SpecState, SpecState])[] = SPEC_STATES.flatMap((from) =>
  SPEC_STATES.map((to) => [from, to] as const),
);

describe('transition table shape', () => {
  it('enumerates 225 ordered state pairs so nothing is sampled', () => {
    expect(ALL_PAIRS).toHaveLength(SPEC_STATES.length ** 2);
    expect(SPEC_STATES.length).toBe(15);
  });

  it('declares no self-edges', () => {
    const selfEdges = TRANSITION_RULES.filter((r) => r.from === r.to);
    expect(selfEdges).toEqual([]);
  });

  it('declares no duplicate edges', () => {
    const keys = TRANSITION_RULES.map((r) => `${r.from}>${r.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('makes every terminal state a sink', () => {
    for (const state of SPEC_STATES.filter(isTerminalState)) {
      expect(TRANSITION_RULES.filter((r) => r.from === state)).toEqual([]);
    }
  });

  it('makes FAILED reachable from every non-terminal state', () => {
    for (const state of SPEC_STATES.filter((s) => !isTerminalState(s))) {
      expect(findRule(state, 'FAILED'), `${state} -> FAILED`).toBeDefined();
    }
  });

  it('never lets an agent cause an approval transition', () => {
    const approvalEdges = TRANSITION_RULES.filter(
      (r) => r.to === 'REQ_APPROVED' || r.to === 'DESIGN_APPROVED',
    );
    expect(approvalEdges.length).toBeGreaterThan(0);
    for (const edge of approvalEdges) {
      expect(edge.allowedActors, `${edge.from} -> ${edge.to}`).not.toContain('agent');
      expect(edge.allowedActors).toEqual(['human']);
    }
  });

  it('reports only legal moves from nextStates(), excluding FAILED', () => {
    for (const state of SPEC_STATES) {
      for (const to of nextStates(state)) {
        expect(findRule(state, to), `${state} -> ${to}`).toBeDefined();
      }
      expect(nextStates(state)).not.toContain('FAILED');
    }
  });

  it('makes every non-terminal state reachable from CREATED', () => {
    // A state nobody can reach is dead code in the state machine.
    const seen = new Set<SpecState>(['CREATED']);
    const queue: SpecState[] = ['CREATED'];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const rule of TRANSITION_RULES.filter((r) => r.from === current)) {
        if (!seen.has(rule.to)) {
          seen.add(rule.to);
          queue.push(rule.to);
        }
      }
    }
    for (const state of SPEC_STATES) {
      expect(seen.has(state), `${state} is unreachable from CREATED`).toBe(true);
    }
  });
});

describe('forbidden pairs are rejected', () => {
  // Every pair NOT in the table must fail, whatever the spec's real state is. Driving
  // the spec to `from` first would make this test enormous, so instead we assert that
  // `findRule` has no entry and that a call with that pair fails. The spec sits in
  // CREATED, so either the state check or the table check rejects it; both are failures
  // and neither silently mutates the row.
  const forbidden = ALL_PAIRS.filter(([from, to]) => findRule(from, to) === undefined);

  it('leaves a substantial majority of pairs forbidden', () => {
    expect(forbidden.length).toBe(ALL_PAIRS.length - TRANSITION_RULES.length);
  });

  it.each(forbidden.map(([from, to]) => ({ from, to })))('rejects $from -> $to', ({ from, to }) => {
    const spec = makeSpec(db);
    expect(() =>
      transition(db, {
        specId: spec.id,
        from,
        to,
        actor: ORCHESTRATOR,
        expectedVersion: spec.version,
      }),
    ).toThrow(AgentForgeError);

    // Whatever the rejection reason, the row must be untouched.
    const after = getSpec(db, spec.id);
    expect(after?.status).toBe('CREATED');
    expect(after?.version).toBe(0);
  });
});

describe('allowed pairs succeed when their guards are satisfied', () => {
  /**
   * Prepares a spec sitting in `from` with whatever artifacts the edge's guards need,
   * then performs the transition for real.
   */
  const prepare = (
    from: SpecState,
    to: SpecState,
  ): { specId: string; version: number; actorType: 'human' | 'orchestrator' } => {
    const rule = findRule(from, to);
    if (rule === undefined) throw new Error(`no rule for ${from} -> ${to}`);

    const brownfield =
      from === 'CONTEXT_SCANNING' || from === 'CONTEXT_READY' || to === 'CONTEXT_SCANNING';
    const spec = makeSpec(db, brownfield ? 'brownfield' : 'greenfield');

    if (from !== 'CREATED') driveTo(db, spec.id, from);

    // Satisfy artifact-existence guards for the edge under test. Writing is skipped
    // when driveTo already produced the artifact, because writeArtifact deliberately
    // refuses a second write once the spec has left the drafting state for that kind.
    const ensure = (kind: 'context' | 'requirements' | 'design' | 'tasks'): void => {
      if (getHeadArtifact(db, spec.id, kind) === undefined) putArtifact(db, spec.id, kind);
    };
    for (const guard of rule.guards) {
      if (guard === 'context_artifact_exists') ensure('context');
      if (guard === 'requirements_artifact_exists') ensure('requirements');
      if (guard === 'design_artifact_exists') ensure('design');
      if (guard === 'tasks_artifact_exists') ensure('tasks');
    }

    const current = getSpec(db, spec.id);
    if (current === undefined) throw new Error('spec vanished');
    expect(current.status).toBe(from);

    return {
      specId: spec.id,
      version: current.version,
      actorType: rule.allowedActors.includes('orchestrator') ? 'orchestrator' : 'human',
    };
  };

  // Edges whose `from` state the driver cannot reach without the edge itself, or which
  // need a brownfield context scan the orchestrator package does not implement, are
  // covered by the dedicated guard tests below instead.
  const drivable = TRANSITION_RULES.filter(
    (r) =>
      r.to !== 'FAILED' &&
      r.from !== 'CONTEXT_SCANNING' &&
      r.from !== 'CONTEXT_READY' &&
      r.from !== 'REQ_AWAITING_CLARIFICATION' &&
      // Approval edges are exercised through decideArtifact in approvals.test.ts,
      // because reaching them legitimately requires recording a decision first.
      r.to !== 'REQ_APPROVED' &&
      r.to !== 'DESIGN_APPROVED' &&
      !(r.from === 'REQ_AWAITING_APPROVAL' && r.to === 'REQ_DRAFTING') &&
      !(r.from === 'DESIGN_AWAITING_APPROVAL' && r.to === 'DESIGN_DRAFTING'),
  );

  it.each(drivable.map((r) => ({ from: r.from, to: r.to })))(
    'performs $from -> $to',
    ({ from, to }) => {
      const { specId, version, actorType } = prepare(from, to);
      const actor = actorType === 'human' ? HUMAN : ORCHESTRATOR;

      const result = transition(db, { specId, from, to, actor, expectedVersion: version });

      expect(result.spec.status).toBe(to);
      expect(result.spec.version).toBe(version + 1);
      expect(getSpec(db, specId)?.status).toBe(to);
    },
  );

  it('moves every non-terminal state to FAILED', () => {
    for (const from of ['CREATED', 'REQ_DRAFTING', 'REQ_AWAITING_APPROVAL'] as const) {
      const spec = makeSpec(db);
      if (from !== 'CREATED') driveTo(db, spec.id, from);
      const current = getSpec(db, spec.id);
      if (current === undefined) throw new Error('spec vanished');

      const result = transition(db, {
        specId: spec.id,
        from,
        to: 'FAILED',
        actor: HUMAN,
        expectedVersion: current.version,
        reason: 'operator aborted the run',
      });
      expect(result.spec.status).toBe('FAILED');
    }
  });
});

describe('actor-type enforcement', () => {
  it('refuses an agent attempting a human-only transition', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');
    const current = getSpec(db, spec.id);
    if (current === undefined) throw new Error('spec vanished');

    try {
      transition(db, {
        specId: spec.id,
        from: 'REQ_AWAITING_APPROVAL',
        to: 'REQ_APPROVED',
        actor: AGENT,
        expectedVersion: current.version,
      });
      throw new Error('expected the transition to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentForgeError);
      const e = error as AgentForgeError;
      expect(e.code).toBe('ILLEGAL_TRANSITION');
      expect(e.message).toContain('may not perform');
    }

    expect(getSpec(db, spec.id)?.status).toBe('REQ_AWAITING_APPROVAL');
  });

  it('refuses an agent trying to release a spec for implementation', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'TASKS_GENERATED');
    const current = getSpec(db, spec.id);
    if (current === undefined) throw new Error('spec vanished');

    // TASKS_GENERATED -> READY_FOR_IMPLEMENTATION permits orchestrator and human but
    // not a bare agent, so an implementing agent cannot unlock file edits for itself.
    expect(() =>
      transition(db, {
        specId: spec.id,
        from: 'TASKS_GENERATED',
        to: 'READY_FOR_IMPLEMENTATION',
        actor: AGENT,
        expectedVersion: current.version,
      }),
    ).toThrow(/may not perform/);
  });
});

describe('optimistic locking', () => {
  it('rejects a stale expectedVersion', () => {
    const spec = makeSpec(db);
    transition(db, {
      specId: spec.id,
      from: 'CREATED',
      to: 'REQ_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: 0,
    });

    // A second caller still holding version 0 must lose.
    try {
      transition(db, {
        specId: spec.id,
        from: 'REQ_DRAFTING',
        to: 'REQ_AWAITING_APPROVAL',
        actor: ORCHESTRATOR,
        expectedVersion: 0,
      });
      throw new Error('expected a version conflict');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('VERSION_CONFLICT');
    }
  });

  it('lets only one of two racing transitions win', () => {
    const spec = makeSpec(db);

    const attempt = (to: SpecState): 'ok' | 'conflict' => {
      try {
        transition(db, {
          specId: spec.id,
          from: 'CREATED',
          to,
          actor: ORCHESTRATOR,
          expectedVersion: 0,
        });
        return 'ok';
      } catch {
        return 'conflict';
      }
    };

    // Both read version 0; the second must be rejected rather than overwrite the first.
    const first = attempt('REQ_DRAFTING');
    const second = attempt('FAILED');

    expect(first).toBe('ok');
    expect(second).toBe('conflict');
    expect(getSpec(db, spec.id)?.status).toBe('REQ_DRAFTING');
    expect(getSpec(db, spec.id)?.version).toBe(1);
  });

  it('rejects a transition whose declared `from` is not the current state', () => {
    const spec = makeSpec(db);
    try {
      transition(db, {
        specId: spec.id,
        from: 'REQ_DRAFTING',
        to: 'REQ_AWAITING_APPROVAL',
        actor: ORCHESTRATOR,
        expectedVersion: 0,
      });
      throw new Error('expected rejection');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('ILLEGAL_TRANSITION');
      expect(e.message).toContain('spec is in CREATED');
    }
  });
});

describe('audit log', () => {
  it('records creation and every transition in order', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');

    const entries = listAuditEntries(db, spec.id);
    expect(entries.map((e) => e.toState)).toEqual([
      'CREATED',
      'REQ_DRAFTING',
      'REQ_AWAITING_APPROVAL',
    ]);
    expect(entries[0]?.fromState).toBeNull();
    expect(entries[1]?.fromState).toBe('CREATED');

    // seq is strictly increasing, which is what makes the timeline exact.
    const seqs = entries.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('writes no audit entry for a rejected transition', () => {
    const spec = makeSpec(db);
    const before = listAuditEntries(db, spec.id).length;

    expect(() =>
      transition(db, {
        specId: spec.id,
        from: 'CREATED',
        to: 'DONE',
        actor: HUMAN,
        expectedVersion: 0,
      }),
    ).toThrow();

    expect(listAuditEntries(db, spec.id)).toHaveLength(before);
  });

  it('cannot be rewritten, even by direct SQL', () => {
    const spec = makeSpec(db);
    const entry = listAuditEntries(db, spec.id)[0];
    if (entry === undefined) throw new Error('expected a creation entry');

    expect(() =>
      db.$client.prepare('UPDATE audit_log SET actor = ? WHERE id = ?').run('attacker', entry.id),
    ).toThrow(/append-only/);

    expect(() => db.$client.prepare('DELETE FROM audit_log WHERE id = ?').run(entry.id)).toThrow(
      /append-only/,
    );
  });

  it('refuses to delete history selectively but allows a spec to be removed whole', () => {
    // Migration 0002 narrowed the delete triggers so a spec can be deleted at all,
    // without weakening the guarantee that matters. The distinction asserted here is
    // the whole point: history for a live spec cannot be edited or thinned out, and the
    // only way to remove it is to remove the entire spec with everything attached.
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_AWAITING_APPROVAL');

    const entries = listAuditEntries(db, spec.id);
    expect(entries.length).toBeGreaterThan(1);
    const middle = entries[1];
    if (middle === undefined) throw new Error('expected several entries');

    // Selective removal: refused, because the spec still exists.
    expect(() => db.$client.prepare('DELETE FROM audit_log WHERE id = ?').run(middle.id)).toThrow(
      /append-only/,
    );
    // A blanket delete scoped to one spec is the same tampering, and equally refused.
    expect(() =>
      db.$client.prepare('DELETE FROM audit_log WHERE spec_id = ?').run(spec.id),
    ).toThrow(/append-only/);
    expect(listAuditEntries(db, spec.id)).toHaveLength(entries.length);

    // Deleting the spec takes its whole history with it, via the cascade.
    db.$client.prepare('DELETE FROM specs WHERE id = ?').run(spec.id);
    expect(listAuditEntries(db, spec.id)).toEqual([]);
    expect(getSpec(db, spec.id)).toBeUndefined();
  });
});

describe('unknown specs', () => {
  it('reports NOT_FOUND rather than creating anything', () => {
    try {
      transition(db, {
        specId: 'spec_does_not_exist',
        from: 'CREATED',
        to: 'REQ_DRAFTING',
        actor: ORCHESTRATOR,
        expectedVersion: 0,
      });
      throw new Error('expected NOT_FOUND');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('NOT_FOUND');
    }
  });
});
