import { type ClarificationQuestion, NotFoundError, ValidationError } from '@agentforge/contract';
import { type Db, parseJsonColumn, schema, toJsonColumn } from '@agentforge/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from './ids.ts';
import type { Actor } from './types.ts';

/**
 * Clarification rounds.
 *
 * The Requirement Agent may ask questions instead of guessing. Rounds are capped (two
 * by convention, enforced by the caller) so a spec cannot sit in an interrogation loop;
 * answers are recorded with their author and timestamp, which the audit timeline shows.
 */

const OptionsSchema = z.array(z.string());

/** The next round number for a spec: 1 if none have been asked. */
export function nextRound(db: Db, specId: string): number {
  const row = db
    .select({ maxRound: sql<number | null>`max(${schema.clarifications.round})` })
    .from(schema.clarifications)
    .where(eq(schema.clarifications.specId, specId))
    .all()[0];

  return (row?.maxRound ?? 0) + 1;
}

/** Records a round of questions and returns the stored rows. */
export function askClarifications(
  db: Db,
  specId: string,
  questions: readonly ClarificationQuestion[],
): readonly (typeof schema.clarifications.$inferSelect)[] {
  if (questions.length === 0) {
    throw new ValidationError('a clarification round must contain at least one question', {
      spec_id: specId,
    });
  }

  return db.transaction(
    (tx) => {
      const round = nextRound(db, specId);
      const now = new Date().toISOString();
      const rows = questions.map((q) => ({
        id: newId('clr'),
        specId,
        round,
        question: q.question,
        whyItMatters: q.why_it_matters,
        options: toJsonColumn(q.options),
        answer: null,
        answeredBy: null,
        answeredAt: null,
        createdAt: now,
      }));

      for (const row of rows) {
        tx.insert(schema.clarifications).values(row).run();
      }
      return rows;
    },
    { behavior: 'immediate' },
  );
}

export interface ClarificationAnswer {
  readonly clarificationId: string;
  readonly answer: string;
}

/**
 * Records answers.
 *
 * Answering is idempotent in the sense that re-answering overwrites, but the
 * clarification row is the only place in the schema that is deliberately mutable:
 * a reviewer correcting their own answer before redrafting is normal, and the audit
 * trail of the redraft captures what the agent actually consumed.
 */
export function answerClarifications(
  db: Db,
  specId: string,
  answers: readonly ClarificationAnswer[],
  actor: Actor,
): number {
  if (answers.length === 0) {
    throw new ValidationError('no answers supplied', { spec_id: specId });
  }

  return db.transaction(
    (tx) => {
      const now = new Date().toISOString();
      let updated = 0;

      for (const { clarificationId, answer } of answers) {
        const existing = tx
          .select({ id: schema.clarifications.id })
          .from(schema.clarifications)
          .where(
            and(
              eq(schema.clarifications.id, clarificationId),
              eq(schema.clarifications.specId, specId),
            ),
          )
          .limit(1)
          .all()[0];

        if (existing === undefined) {
          throw new NotFoundError(
            `clarification ${clarificationId} does not belong to spec ${specId}`,
            { spec_id: specId, clarification_id: clarificationId },
          );
        }

        const result = tx
          .update(schema.clarifications)
          .set({ answer, answeredBy: actor.id, answeredAt: now })
          .where(eq(schema.clarifications.id, clarificationId))
          .run();

        updated += result.changes;
      }

      return updated;
    },
    { behavior: 'immediate' },
  );
}

export interface ClarificationView {
  readonly id: string;
  readonly spec_id: string;
  readonly round: number;
  readonly question: string;
  readonly why_it_matters: string;
  readonly options: readonly string[];
  readonly answer: string | null;
  readonly answered_by: string | null;
  readonly answered_at: string | null;
  readonly created_at: string;
}

function toView(row: typeof schema.clarifications.$inferSelect): ClarificationView {
  return {
    id: row.id,
    spec_id: row.specId,
    round: row.round,
    question: row.question,
    why_it_matters: row.whyItMatters,
    options: parseJsonColumn(OptionsSchema, row.options, `clarifications.options (${row.id})`),
    answer: row.answer,
    answered_by: row.answeredBy,
    answered_at: row.answeredAt,
    created_at: row.createdAt,
  };
}

/** Every clarification for a spec, oldest round first. */
export function listClarifications(db: Db, specId: string): readonly ClarificationView[] {
  return db
    .select()
    .from(schema.clarifications)
    .where(eq(schema.clarifications.specId, specId))
    .orderBy(asc(schema.clarifications.round), asc(schema.clarifications.createdAt))
    .all()
    .map(toView);
}

/** Only the unanswered ones — what the UI prompts the reviewer to resolve. */
export function listOpenClarifications(db: Db, specId: string): readonly ClarificationView[] {
  return db
    .select()
    .from(schema.clarifications)
    .where(and(eq(schema.clarifications.specId, specId), isNull(schema.clarifications.answer)))
    .orderBy(asc(schema.clarifications.round), asc(schema.clarifications.createdAt))
    .all()
    .map(toView);
}

/** The answered questions of the latest round, for inclusion in the redraft prompt. */
export function latestAnsweredRound(db: Db, specId: string): readonly ClarificationView[] {
  const latest = db
    .select({ round: schema.clarifications.round })
    .from(schema.clarifications)
    .where(eq(schema.clarifications.specId, specId))
    .orderBy(desc(schema.clarifications.round))
    .limit(1)
    .all()[0];

  if (latest === undefined) return [];

  return db
    .select()
    .from(schema.clarifications)
    .where(
      and(eq(schema.clarifications.specId, specId), eq(schema.clarifications.round, latest.round)),
    )
    .orderBy(asc(schema.clarifications.createdAt))
    .all()
    .map(toView);
}
