import type { Task, TasksProposal } from '@agentforge/contract';
import { bullets, finalise, inlineList, joinBlocks, sourceRef, table } from './format.ts';

/**
 * `tasks.md` renderer.
 *
 * Each task names the requirements it implements and the acceptance criteria it must
 * make pass. That `verifies` list is the last hop of the traceability chain: rule ->
 * requirement -> design -> task -> test.
 */

function renderTask(task: Task): string {
  const parts = [`### ${task.id} — ${task.title}`, task.description];

  parts.push(
    bullets([
      `**Status.** ${task.status}`,
      `**Implements.** ${inlineList(task.requirement_ids)}`,
      `**Design sections.** ${inlineList(task.design_section_ids)}`,
      `**Verifies.** ${inlineList(task.verifies)}`,
      `**Depends on.** ${inlineList(task.depends_on)}`,
    ]),
  );

  if (task.source_refs.length > 0) {
    parts.push(`**Evidence.**\n\n${bullets(task.source_refs.map(sourceRef))}`);
  }

  return joinBlocks(parts);
}

export function renderTasks(title: string, proposal: TasksProposal): string {
  const blocks: string[] = [
    `# Tasks: ${title}`,
    `**Implementation order.** ${proposal.implementation_order_rationale}`,
    '## Tasks',
  ];

  for (const task of proposal.tasks) {
    blocks.push(renderTask(task));
  }

  blocks.push(
    `## Task index\n\n${table(
      ['Task', 'Title', 'Status', 'Implements', 'Verifies', 'Depends on'],
      proposal.tasks.map((t) => [
        t.id,
        t.title,
        t.status,
        inlineList(t.requirement_ids),
        inlineList(t.verifies),
        inlineList(t.depends_on),
      ]),
    )}`,
  );

  return finalise(joinBlocks(blocks));
}
