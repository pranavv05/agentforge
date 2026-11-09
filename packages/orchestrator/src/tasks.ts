import {
  SourceRefSchema,
  type TaskRow as TaskRowView,
  type TasksProposal,
} from '@agentforge/contract';
import { type Db, parseJsonColumn, schema, toJsonColumn } from '@agentforge/db';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from './ids.ts';

/**
 * Task rows.
 *
 * `tasks.md` is the artifact a human approves; these rows are the *working copy* the
 * implementation phase mutates as an agent claims and completes work. Keeping them
 * separate means task progress never alters an approved artifact, so its content hash
 * stays valid for the whole implementation phase.
 */

const StringArraySchema = z.array(z.string());
const SourceRefsSchema = z.array(SourceRefSchema);

function toView(row: typeof schema.tasks.$inferSelect): TaskRowView {
  const where = (field: string): string => `tasks.${field} (${row.taskKey})`;
  return {
    id: row.id,
    spec_id: row.specId,
    task_key: row.taskKey,
    title: row.title,
    description: row.description,
    status: row.status,
    requirement_ids: parseJsonColumn(
      StringArraySchema,
      row.requirementIds,
      where('requirement_ids'),
    ),
    design_section_ids: parseJsonColumn(
      StringArraySchema,
      row.designSectionIds,
      where('design_section_ids'),
    ),
    verifies: parseJsonColumn(StringArraySchema, row.verifies, where('verifies')),
    depends_on: parseJsonColumn(StringArraySchema, row.dependsOn, where('depends_on')),
    source_refs: parseJsonColumn(SourceRefsSchema, row.sourceRefs, where('source_refs')),
    completion_evidence: row.completionEvidence,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    created_at: row.createdAt,
  };
}

/**
 * Materialises task rows from an approved tasks artifact.
 *
 * Inserts only: a task that already exists is left alone, so re-running this after an
 * agent has started work cannot reset progress. Tasks dropped from a later artifact
 * version are left in place rather than deleted, because removing a completed task
 * would erase evidence of work that really happened.
 */
export function syncTasks(db: Db, specId: string, proposal: TasksProposal): number {
  return db.transaction(
    (tx) => {
      const existing = new Set(
        tx
          .select({ taskKey: schema.tasks.taskKey })
          .from(schema.tasks)
          .where(eq(schema.tasks.specId, specId))
          .all()
          .map((r) => r.taskKey),
      );

      const now = new Date().toISOString();
      let inserted = 0;

      for (const task of proposal.tasks) {
        if (existing.has(task.id)) continue;

        tx.insert(schema.tasks)
          .values({
            id: newId('task'),
            specId,
            taskKey: task.id,
            title: task.title,
            description: task.description,
            // Always starts pending: an artifact cannot declare work already done.
            status: 'pending',
            requirementIds: toJsonColumn(task.requirement_ids),
            designSectionIds: toJsonColumn(task.design_section_ids),
            verifies: toJsonColumn(task.verifies),
            dependsOn: toJsonColumn(task.depends_on),
            sourceRefs: toJsonColumn(task.source_refs),
            completionEvidence: null,
            startedAt: null,
            completedAt: null,
            createdAt: now,
          })
          .run();
        inserted += 1;
      }

      return inserted;
    },
    { behavior: 'immediate' },
  );
}

/** Every task for a spec, in key order. */
export function listTasks(db: Db, specId: string): readonly TaskRowView[] {
  return db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.specId, specId))
    .orderBy(asc(schema.tasks.taskKey))
    .all()
    .map(toView);
}

/** Looks up one task by its `TASK-00n` key. */
export function getTask(db: Db, specId: string, taskKey: string): TaskRowView | undefined {
  return db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.specId, specId))
    .all()
    .map(toView)
    .find((t) => t.task_key === taskKey);
}

/**
 * The next task whose declared dependencies are all complete.
 *
 * Returned by the MCP `next_task` tool, so an implementing agent cannot pick up work
 * whose prerequisites have not landed. Dependencies come from the task's own
 * `depends_on` list, not from key ordering.
 */
export function nextAvailableTask(db: Db, specId: string): TaskRowView | undefined {
  const all = listTasks(db, specId);
  const completed = new Set(all.filter((t) => t.status === 'completed').map((t) => t.task_key));

  // An in-progress task is returned first: an agent that reconnects should resume the
  // task it already claimed rather than starting a second one.
  const inProgress = all.find((t) => t.status === 'in_progress');
  if (inProgress !== undefined) return inProgress;

  return all.find(
    (task) => task.status === 'pending' && task.depends_on.every((dep) => completed.has(dep)),
  );
}

/** Tasks that can never start because a dependency does not exist. A planning bug. */
export function tasksWithMissingDependencies(
  db: Db,
  specId: string,
): readonly { readonly task_key: string; readonly missing: readonly string[] }[] {
  const all = listTasks(db, specId);
  const keys = new Set(all.map((t) => t.task_key));

  return all
    .map((task) => ({
      task_key: task.task_key,
      missing: task.depends_on.filter((dep) => !keys.has(dep)),
    }))
    .filter((row) => row.missing.length > 0);
}
