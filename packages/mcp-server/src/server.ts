import {
  RequirementsProposalSchema,
  TaskIdSchema,
  isAgentForgeError,
  isImplementationState,
} from '@agentforge/contract';
import { type Db, getDb, parseJsonColumn } from '@agentforge/db';
import {
  completeTask,
  getHeadArtifact,
  getTask,
  listTasks,
  nextAvailableTask,
  requireSpecById,
  startTask,
  tasksWithMissingDependencies,
  type Actor,
} from '@agentforge/orchestrator';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { requireSpecId } from './spec-context.ts';

/**
 * The implementation-phase MCP server.
 *
 * This is the only interface the implementing agent has to the orchestrator. Every tool
 * goes through orchestrator functions rather than touching the database, so the state
 * machine's guards apply to an agent exactly as they apply to the web API — the agent
 * cannot start a task out of order, cannot complete one it never started, and cannot
 * complete one without saying what it did.
 *
 * The agent is given what it needs and nothing more: no tool here can approve an
 * artifact, change a spec's stage directly, or write to any table.
 */

/** The implementing agent, as recorded in the audit log. */
const AGENT: Actor = { id: 'claude-code', type: 'agent' };

/** Wraps a handler so a thrown taxonomy error becomes a readable tool error. */
function toolResult(body: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
}

function errorResult(error: unknown): CallToolResult {
  const message = isAgentForgeError(error)
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : 'an unexpected error occurred';

  // `isError` tells the client this is a failure rather than a result, so the agent
  // sees the refusal instead of treating the text as data.
  return { content: [{ type: 'text', text: message }], isError: true };
}

function run(handler: () => unknown): CallToolResult {
  try {
    return toolResult(handler());
  } catch (error) {
    return errorResult(error);
  }
}

export interface ServerOptions {
  /** Injected by tests; defaults to the process-wide connection. */
  readonly db?: Db;
  /** Injected by tests; defaults to the resolved session spec. */
  readonly specId?: string;
  readonly cwd?: string;
}

export function createSddServer(options: ServerOptions = {}): McpServer {
  const db = (): Db => options.db ?? getDb();
  const specId = (): string => options.specId ?? requireSpecId(options.cwd);

  const server = new McpServer({
    name: 'agentforge-sdd',
    version: '0.1.0',
  });

  server.registerTool(
    'get_approved_spec',
    {
      title: 'Get the approved spec',
      description:
        'Returns the approved requirements, design and task list for the spec this session ' +
        'is implementing. Read this first: it is the contract the implementation must satisfy. ' +
        'Requirements and design have been approved by a human and must not be reinterpreted.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(() => {
        const id = specId();
        const spec = requireSpecById(db(), id);

        const requirements = getHeadArtifact(db(), id, 'requirements');
        const design = getHeadArtifact(db(), id, 'design');
        const tasks = getHeadArtifact(db(), id, 'tasks');

        return {
          spec_id: spec.id,
          title: spec.title,
          status: spec.status,
          mode: spec.mode,
          implementation_permitted: isImplementationState(spec.status),
          requirements_markdown: requirements?.contentMd ?? null,
          design_markdown: design?.contentMd ?? null,
          tasks_markdown: tasks?.contentMd ?? null,
          // Surfaced so the agent can cite the exact approved version in its evidence.
          approved_versions: {
            requirements: requirements?.version ?? null,
            design: design?.version ?? null,
            tasks: tasks?.version ?? null,
          },
        };
      }),
  );

  server.registerTool(
    'next_task',
    {
      title: 'Get the next task',
      description:
        'Returns the next task whose dependencies are all complete, or null when none is ' +
        'available. An in-progress task is returned first, so a reconnecting session resumes ' +
        'the task it already claimed rather than starting a second one. Do not pick a task ' +
        'yourself from the task list: dependency order is enforced here.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(() => {
        const id = specId();
        const spec = requireSpecById(db(), id);
        const task = nextAvailableTask(db(), id);
        const all = listTasks(db(), id);
        const broken = tasksWithMissingDependencies(db(), id);

        return {
          spec_status: spec.status,
          implementation_permitted: isImplementationState(spec.status),
          task,
          remaining: all.filter((t) => t.status !== 'completed').length,
          completed: all.filter((t) => t.status === 'completed').length,
          blocked: all.filter((t) => t.status === 'blocked').map((t) => t.task_key),
          // A task depending on something that does not exist can never start, so the
          // planning bug is surfaced rather than appearing as "no work available".
          unstartable_due_to_missing_dependencies: broken,
        };
      }),
  );

  server.registerTool(
    'start_task',
    {
      title: 'Claim a task',
      description:
        'Claims a task before editing any files. Refused if the spec is not released for ' +
        'implementation, if the task has incomplete dependencies, or if another task is ' +
        'already in progress. File edits are separately blocked until a spec is in an ' +
        'implementation state, so claiming a task is not optional.',
      inputSchema: {
        task_key: TaskIdSchema.describe('The task to claim, e.g. TASK-001.'),
      },
    },
    ({ task_key }) =>
      run(() => {
        const id = specId();
        const spec = requireSpecById(db(), id);

        const task = startTask(db(), {
          specId: id,
          taskKey: task_key,
          actor: AGENT,
          expectedVersion: spec.version,
        });

        return {
          task,
          // Repeated here so the agent has the acceptance criteria in front of it without
          // another round trip; these are what "done" means for this task.
          verifies: task.verifies,
          requirement_ids: task.requirement_ids,
        };
      }),
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete a task, with evidence',
      description:
        'Marks the claimed task complete. Evidence is mandatory and is recorded in the audit ' +
        'trail: state what you changed and how you verified it, naming the files touched and ' +
        'the tests that now pass. Completing the last task moves the spec to DONE.',
      inputSchema: {
        task_key: TaskIdSchema.describe('The task being completed, e.g. TASK-001.'),
        evidence: z
          .string()
          .min(20, 'evidence must actually describe the change')
          .max(10_000)
          .describe(
            'What changed and how it was verified. Name the files and the tests that pass.',
          ),
      },
    },
    ({ task_key, evidence }) =>
      run(() => {
        const id = specId();
        const spec = requireSpecById(db(), id);

        const result = completeTask(db(), {
          specId: id,
          taskKey: task_key,
          evidence,
          actor: AGENT,
          expectedVersion: spec.version,
        });

        return {
          task: result.task,
          remaining: result.remaining,
          spec_completed: result.specCompleted,
          next_hint:
            result.remaining > 0
              ? 'Call next_task for the next available task.'
              : 'All tasks are complete; the spec has moved to DONE.',
        };
      }),
  );

  server.registerTool(
    'get_acceptance_criteria',
    {
      title: 'Get acceptance criteria for a task',
      description:
        'Returns the full Given/When/Then acceptance criteria a task must make pass, taken ' +
        'from the approved requirements. Use this to decide whether the task is actually done ' +
        'rather than judging by eye.',
      inputSchema: {
        task_key: TaskIdSchema.describe('The task whose criteria to fetch, e.g. TASK-001.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ task_key }) =>
      run(() => {
        const id = specId();
        const task = getTask(db(), id, task_key);
        if (task === undefined) {
          return { task_key, error: 'no such task for this spec' };
        }

        const artifact = getHeadArtifact(db(), id, 'requirements');
        if (artifact === undefined) {
          return { task_key, criteria: [], note: 'no requirements artifact exists' };
        }

        const requirements = parseJsonColumn(
          RequirementsProposalSchema,
          artifact.contentJson,
          `artifact_versions.content_json (requirements v${String(artifact.version)})`,
        );

        const wanted = new Set(task.verifies);
        const criteria = requirements.requirements.flatMap((requirement) =>
          requirement.acceptance_criteria
            .filter((criterion) => wanted.has(criterion.id))
            .map((criterion) => ({ ...criterion, requirement_id: requirement.id })),
        );

        return { task_key, criteria };
      }),
  );

  return server;
}
