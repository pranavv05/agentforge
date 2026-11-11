import type { SpecMode, SpecState } from '@agentforge/contract';

/**
 * The lifecycle, as a progress rail.
 *
 * Collapses the 17 states into the six stages a reviewer thinks in. A spec is only ever
 * in one state, but "REQ_DRAFTING" and "REQ_AWAITING_APPROVAL" and "REQ_APPROVED" are
 * the same *stage* at different moments, and showing seventeen steps would bury the one
 * fact being looked for: how far along is this, and is it stuck on me.
 *
 * The exact state is always shown as well, next to the title — this is an index, not a
 * replacement for it.
 *
 * A greenfield spec never scans a repository, so the Context stage is dropped for one
 * rather than drawn as completed. Showing a stage as done that never ran is a small lie,
 * and on a page whose subject is verifiable provenance it is the wrong kind of small.
 */

interface Stage {
  readonly key: string;
  readonly label: string;
  readonly states: readonly SpecState[];
}

const STAGES: readonly Stage[] = [
  { key: 'created', label: 'Created', states: ['CREATED'] },
  {
    key: 'context',
    label: 'Context',
    states: ['CONTEXT_SCANNING', 'CONTEXT_READY'],
  },
  {
    key: 'requirements',
    label: 'Requirements',
    states: ['REQ_DRAFTING', 'REQ_AWAITING_CLARIFICATION', 'REQ_AWAITING_APPROVAL', 'REQ_APPROVED'],
  },
  {
    key: 'design',
    label: 'Design',
    states: ['DESIGN_DRAFTING', 'DESIGN_AWAITING_APPROVAL', 'DESIGN_APPROVED'],
  },
  { key: 'tasks', label: 'Tasks', states: ['TASKS_GENERATED'] },
  {
    key: 'build',
    label: 'Implementation',
    states: ['READY_FOR_IMPLEMENTATION', 'IMPLEMENTING', 'DONE'],
  },
];

export function Pipeline({ status, mode }: { status: SpecState; mode: SpecMode }) {
  const stages = STAGES.filter((stage) => mode === 'brownfield' || stage.key !== 'context');
  const current = stages.findIndex((stage) => stage.states.includes(status));

  // CHANGES_REQUESTED and FAILED sit outside the sequence. Rather than guess where to
  // put them, the rail renders as not-started and the state badge beside the title
  // carries the real story.
  const isOffPath = current === -1;

  return (
    <ol className="pipeline" aria-label="Lifecycle stage">
      {stages.map((stage, index) => {
        const state = isOffPath || index > current ? 'todo' : index < current ? 'done' : 'current';

        return (
          <li className={`pipeline__step pipeline__step--${state}`} key={stage.key}>
            <span className="pipeline__dot" aria-hidden="true" />
            <span className="pipeline__label">{stage.label}</span>
            {state === 'current' && <span className="visually-hidden">(current stage)</span>}
          </li>
        );
      })}
    </ol>
  );
}
