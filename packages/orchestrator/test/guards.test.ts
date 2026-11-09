import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentForgeError, ClarificationQuestion } from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import {
  answerClarifications,
  askClarifications,
  createSpec,
  getHeadArtifact,
  getSpec,
  latestAnsweredRound,
  listAuditEntries,
  listAuditEntriesByCorrelation,
  listClarifications,
  listOpenClarifications,
  nextRound,
  transition,
} from '../src/index.ts';
import {
  HUMAN,
  ORCHESTRATOR,
  driveTo,
  makeSpec,
  makeTestDb,
  putArtifact,
  type TestDb,
} from './helpers.ts';

/**
 * Guards and clarification rounds.
 *
 * The transition-matrix suite proves the table is right; this one proves the *guards*
 * are, by driving each precondition to failure. A guard that silently passes is worse
 * than no guard, because the governance claim then rests on nothing.
 */

let ctx: TestDb;
let db: Db;

const RAIL_QUESTION: ClarificationQuestion = {
  question: 'Which payout rail?',
  why_it_matters: 'It changes the settlement window.',
  options: ['NEFT', 'IMPS'],
};

const PARTIAL_QUESTION: ClarificationQuestion = {
  question: 'Are partial payouts allowed?',
  why_it_matters: 'It changes the reconciliation model.',
  options: ['Yes', 'No'],
};

const QUESTIONS: readonly ClarificationQuestion[] = [RAIL_QUESTION, PARTIAL_QUESTION];

function current(specId: string) {
  const spec = getSpec(db, specId);
  if (spec === undefined) throw new Error('spec vanished');
  return spec;
}

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
});

afterEach(() => {
  ctx.cleanup();
});

describe('mode guards', () => {
  it('refuses to scan context for a greenfield spec', () => {
    const spec = makeSpec(db, 'greenfield');
    try {
      transition(db, {
        specId: spec.id,
        from: 'CREATED',
        to: 'CONTEXT_SCANNING',
        actor: ORCHESTRATOR,
        expectedVersion: spec.version,
      });
      throw new Error('expected the guard to refuse');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('brownfield');
    }
  });

  it('refuses to skip context scanning for a brownfield spec', () => {
    const spec = makeSpec(db, 'brownfield');
    try {
      transition(db, {
        specId: spec.id,
        from: 'CREATED',
        to: 'REQ_DRAFTING',
        actor: ORCHESTRATOR,
        expectedVersion: spec.version,
      });
      throw new Error('expected the guard to refuse');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('must scan context first');
    }
  });
});

describe('artifact-existence guards', () => {
  it('refuses to move to approval without a requirements artifact', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_DRAFTING');

    try {
      transition(db, {
        specId: spec.id,
        from: 'REQ_DRAFTING',
        to: 'REQ_AWAITING_APPROVAL',
        actor: ORCHESTRATOR,
        expectedVersion: current(spec.id).version,
      });
      throw new Error('expected the guard to refuse');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('no requirements artifact');
    }
  });

  it('refuses to move to design approval without a design artifact', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'DESIGN_DRAFTING');

    expect(() =>
      transition(db, {
        specId: spec.id,
        from: 'DESIGN_DRAFTING',
        to: 'DESIGN_AWAITING_APPROVAL',
        actor: ORCHESTRATOR,
        expectedVersion: current(spec.id).version,
      }),
    ).toThrow(/no design artifact/);
  });

  it('refuses to generate tasks without a tasks artifact', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'DESIGN_APPROVED');

    expect(() =>
      transition(db, {
        specId: spec.id,
        from: 'DESIGN_APPROVED',
        to: 'TASKS_GENERATED',
        actor: ORCHESTRATOR,
        expectedVersion: current(spec.id).version,
      }),
    ).toThrow(/no tasks artifact/);
  });

  it('refuses to hand verified context onward when none exists', () => {
    const spec = makeSpec(db, 'brownfield');
    transition(db, {
      specId: spec.id,
      from: 'CREATED',
      to: 'CONTEXT_SCANNING',
      actor: ORCHESTRATOR,
      expectedVersion: spec.version,
    });

    expect(() =>
      transition(db, {
        specId: spec.id,
        from: 'CONTEXT_SCANNING',
        to: 'CONTEXT_READY',
        actor: ORCHESTRATOR,
        expectedVersion: current(spec.id).version,
      }),
    ).toThrow(/no context artifact/);
  });
});

describe('approval guards', () => {
  it('reports that requirements have never been reviewed', () => {
    // Reach REQ_APPROVED's guard without any decision existing, by attempting the
    // design transition from a hand-placed state is impossible — so instead assert the
    // guard fires on the design side, where no decision has been recorded.
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'DESIGN_DRAFTING');
    putArtifact(db, spec.id, 'design');
    transition(db, {
      specId: spec.id,
      from: 'DESIGN_DRAFTING',
      to: 'DESIGN_AWAITING_APPROVAL',
      actor: ORCHESTRATOR,
      expectedVersion: current(spec.id).version,
    });

    // DESIGN_AWAITING_APPROVAL -> DESIGN_APPROVED requires a recorded approval; going
    // straight there without one must fail on the guard, not succeed.
    try {
      transition(db, {
        specId: spec.id,
        from: 'DESIGN_AWAITING_APPROVAL',
        to: 'DESIGN_APPROVED',
        actor: HUMAN,
        expectedVersion: current(spec.id).version,
      });
      throw new Error('expected the guard to refuse');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('never been reviewed');
    }
  });

  it('refuses to release for implementation when the design approval is stale', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'TASKS_GENERATED');

    // Forge a newer design version so the recorded approval no longer matches head.
    const head = getHeadArtifact(db, spec.id, 'design');
    if (head === undefined) throw new Error('expected a design artifact');
    db.$client
      .prepare(
        `INSERT INTO artifact_versions
           (id, spec_id, kind, version, content_json, content_md, content_hash,
            idempotency_key, created_by, created_at)
         VALUES (?, ?, 'design', ?, '{}', '# forged', ?, NULL, 'attacker', ?)`,
      )
      .run(
        'art_forged_design',
        spec.id,
        head.version + 1,
        'b'.repeat(64),
        new Date().toISOString(),
      );

    try {
      transition(db, {
        specId: spec.id,
        from: 'TASKS_GENERATED',
        to: 'READY_FOR_IMPLEMENTATION',
        actor: HUMAN,
        expectedVersion: current(spec.id).version,
      });
      throw new Error('expected HASH_MISMATCH');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('HASH_MISMATCH');
    }

    // The spec never reaches a state in which file edits are permitted.
    expect(current(spec.id).status).toBe('TASKS_GENERATED');
  });
});

describe('clarification guard', () => {
  it('blocks the return to drafting while a question is unanswered', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_DRAFTING');
    askClarifications(db, spec.id, QUESTIONS);
    transition(db, {
      specId: spec.id,
      from: 'REQ_DRAFTING',
      to: 'REQ_AWAITING_CLARIFICATION',
      actor: ORCHESTRATOR,
      expectedVersion: current(spec.id).version,
    });

    const open = listOpenClarifications(db, spec.id);
    expect(open).toHaveLength(2);

    // Answer only one of the two.
    const first = open[0];
    if (first === undefined) throw new Error('expected a question');
    answerClarifications(db, spec.id, [{ clarificationId: first.id, answer: 'NEFT' }], HUMAN);

    try {
      transition(db, {
        specId: spec.id,
        from: 'REQ_AWAITING_CLARIFICATION',
        to: 'REQ_DRAFTING',
        actor: HUMAN,
        expectedVersion: current(spec.id).version,
      });
      throw new Error('expected the guard to refuse');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('1 clarification(s) are still unanswered');
    }
  });

  it('allows the return to drafting once every question is answered', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'REQ_DRAFTING');
    askClarifications(db, spec.id, QUESTIONS);
    transition(db, {
      specId: spec.id,
      from: 'REQ_DRAFTING',
      to: 'REQ_AWAITING_CLARIFICATION',
      actor: ORCHESTRATOR,
      expectedVersion: current(spec.id).version,
    });

    answerClarifications(
      db,
      spec.id,
      listOpenClarifications(db, spec.id).map((c) => ({
        clarificationId: c.id,
        answer: 'decided',
      })),
      HUMAN,
    );

    const result = transition(db, {
      specId: spec.id,
      from: 'REQ_AWAITING_CLARIFICATION',
      to: 'REQ_DRAFTING',
      actor: HUMAN,
      expectedVersion: current(spec.id).version,
    });

    expect(result.spec.status).toBe('REQ_DRAFTING');
    expect(listOpenClarifications(db, spec.id)).toEqual([]);
  });
});

describe('clarification rounds', () => {
  it('numbers rounds from one and increments', () => {
    const spec = makeSpec(db);
    expect(nextRound(db, spec.id)).toBe(1);

    askClarifications(db, spec.id, QUESTIONS);
    expect(nextRound(db, spec.id)).toBe(2);

    askClarifications(db, spec.id, [RAIL_QUESTION]);
    expect(nextRound(db, spec.id)).toBe(3);
    expect(listClarifications(db, spec.id)).toHaveLength(3);
  });

  it('rejects an empty round', () => {
    const spec = makeSpec(db);
    expect(() => askClarifications(db, spec.id, [])).toThrow(/at least one question/);
  });

  it('rejects an empty answer set', () => {
    const spec = makeSpec(db);
    expect(() => answerClarifications(db, spec.id, [], HUMAN)).toThrow(/no answers supplied/);
  });

  it('records who answered and when', () => {
    const spec = makeSpec(db);
    askClarifications(db, spec.id, [RAIL_QUESTION]);
    const target = listClarifications(db, spec.id)[0];
    if (target === undefined) throw new Error('expected a question');

    answerClarifications(db, spec.id, [{ clarificationId: target.id, answer: 'IMPS' }], HUMAN);

    const answered = listClarifications(db, spec.id)[0];
    expect(answered?.answer).toBe('IMPS');
    expect(answered?.answered_by).toBe(HUMAN.id);
    expect(answered?.answered_at).not.toBeNull();
  });

  it('refuses to answer a clarification belonging to another spec', () => {
    const a = makeSpec(db);
    const b = createSpec(db, {
      title: 'Other spec',
      description: 'Unrelated.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    askClarifications(db, a.id, [RAIL_QUESTION]);
    const target = listClarifications(db, a.id)[0];
    if (target === undefined) throw new Error('expected a question');

    try {
      answerClarifications(db, b.id, [{ clarificationId: target.id, answer: 'x' }], HUMAN);
      throw new Error('expected NOT_FOUND');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('NOT_FOUND');
    }

    // The cross-spec write was rejected whole: spec A's question is untouched.
    expect(listClarifications(db, a.id)[0]?.answer).toBeNull();
  });

  it('returns the latest round from latestAnsweredRound', () => {
    const spec = makeSpec(db);
    expect(latestAnsweredRound(db, spec.id)).toEqual([]);

    askClarifications(db, spec.id, QUESTIONS);
    askClarifications(db, spec.id, [RAIL_QUESTION]);

    const latest = latestAnsweredRound(db, spec.id);
    expect(latest).toHaveLength(1);
    expect(latest[0]?.round).toBe(2);
  });
});

describe('audit lookups', () => {
  it('finds every entry written under one correlation id', () => {
    const spec = makeSpec(db);
    const correlationId = 'run_fixed_for_test';

    transition(db, {
      specId: spec.id,
      from: 'CREATED',
      to: 'REQ_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: spec.version,
      correlationId,
    });
    putArtifact(db, spec.id, 'requirements');
    transition(db, {
      specId: spec.id,
      from: 'REQ_DRAFTING',
      to: 'REQ_AWAITING_APPROVAL',
      actor: ORCHESTRATOR,
      expectedVersion: current(spec.id).version,
      correlationId,
    });

    const byRun = listAuditEntriesByCorrelation(db, correlationId);
    expect(byRun.map((e) => e.toState)).toEqual(['REQ_DRAFTING', 'REQ_AWAITING_APPROVAL']);

    // The creation entry used its own correlation id, so the whole timeline is longer.
    expect(listAuditEntries(db, spec.id).length).toBe(byRun.length + 1);
  });

  it('returns nothing for an unknown correlation id', () => {
    expect(listAuditEntriesByCorrelation(db, 'run_never_happened')).toEqual([]);
  });
});
