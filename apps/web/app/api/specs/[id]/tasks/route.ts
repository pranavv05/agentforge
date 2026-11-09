import { ListTasksResponseSchema } from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { listTasks, requireSpecById } from '@agentforge/orchestrator';
import { handle } from '@/lib/handler';

/** `GET /api/specs/:id/tasks` — the working copy of tasks, with implementation status. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const { id } = await params;
    const db = getDb();
    requireSpecById(db, id);

    return ListTasksResponseSchema.parse({ tasks: listTasks(db, id) });
  });
}
