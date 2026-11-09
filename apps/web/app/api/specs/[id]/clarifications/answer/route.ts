import {
  AnswerClarificationsRequestSchema,
  ListClarificationsResponseSchema,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import {
  answerClarifications,
  listClarifications,
  requireSpecById,
} from '@agentforge/orchestrator';
import { requestActor } from '@/lib/actor';
import { handle, parseBody } from '@/lib/handler';

/**
 * `POST /api/specs/:id/clarifications/answer`
 *
 * Records answers only. It deliberately does *not* transition the spec: moving back to
 * drafting is a separate call whose guard checks that every clarification is answered,
 * so a partially answered round cannot advance the spec by accident.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const { id } = await params;
    const body = await parseBody(request, AnswerClarificationsRequestSchema);
    const db = getDb();
    requireSpecById(db, id);

    answerClarifications(
      db,
      id,
      body.answers.map((a) => ({ clarificationId: a.clarification_id, answer: a.answer })),
      requestActor(request),
    );

    return ListClarificationsResponseSchema.parse({
      clarifications: listClarifications(db, id),
    });
  });
}
