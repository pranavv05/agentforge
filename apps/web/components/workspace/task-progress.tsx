import type { TaskRow } from '@agentforge/contract';

/**
 * Where implementation has actually got to.
 *
 * `tasks.md` is a rendered document and therefore frozen at the hash it was approved
 * under — it cannot show that TASK-003 is in progress, because saying so would change
 * its bytes and invalidate the approval. The live status lives in the task rows, so it
 * is shown here instead of being baked into the document.
 *
 * This is also the only view of the phase AgentForge does not perform itself: past the
 * release gate the work is Claude Code's, over MCP.
 */
export function TaskProgress({ tasks }: { tasks: readonly TaskRow[] }) {
  if (tasks.length === 0) return null;

  const done = tasks.filter((task) => task.status === 'completed').length;
  const blocked = new Set(
    tasks
      .filter((task) => task.status !== 'completed')
      .filter((task) =>
        task.depends_on.some(
          (key) => tasks.find((other) => other.task_key === key)?.status !== 'completed',
        ),
      )
      .map((task) => task.task_key),
  );

  return (
    <section className="prog" aria-label="Implementation progress">
      <div className="prog__top">
        <span className="prog__count">
          {done}
          <span className="prog__of"> / {tasks.length}</span>
        </span>
        <span className="prog__label">tasks complete</span>
      </div>

      <div
        className="prog__bar"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={tasks.length}
        aria-label={`${String(done)} of ${String(tasks.length)} tasks complete`}
      >
        <span
          className="prog__fill"
          style={{ inlineSize: `${String((done / tasks.length) * 100)}%` }}
        />
      </div>

      <ul className="prog__list">
        {tasks.map((task) => (
          <li className={`prog__task is-${task.status}`} key={task.id}>
            <code className="prog__key">{task.task_key}</code>
            <span className="prog__title">{task.title}</span>
            <span className="prog__state">
              {blocked.has(task.task_key) && task.status === 'pending'
                ? `waiting on ${task.depends_on.join(', ')}`
                : task.status.replace('_', ' ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
