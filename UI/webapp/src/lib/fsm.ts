// Orchestrator state machine: "agents propose, orchestrator transitions, humans approve".
export type Status =
  | 'CREATED' | 'CONTEXT_SCANNING' | 'CONTEXT_READY'
  | 'REQ_DRAFTING' | 'REQ_AWAITING_CLARIFICATION' | 'REQ_AWAITING_APPROVAL' | 'REQ_APPROVED'
  | 'DESIGN_DRAFTING' | 'DESIGN_AWAITING_APPROVAL' | 'DESIGN_APPROVED'
  | 'TASKS_GENERATED' | 'READY_FOR_IMPLEMENTATION' | 'IMPLEMENTING' | 'DONE' | 'FAILED'

/** Mirrors @agentforge/contract ACTOR_TYPES. */
export type ActorType = 'human' | 'orchestrator' | 'agent' | 'system'
export type Actor = { type: ActorType; id: string }

type Edge = { from: Status; to: Status; by: 'human' | 'orchestrator' }

/** Terminal states: no outgoing transitions (contract TERMINAL_STATES). */
export const TERMINAL: Status[] = ['DONE', 'FAILED']
/** States where a human decision is outstanding (contract AWAITING_HUMAN_STATES). */
export const AWAITING_HUMAN: Status[] = ['REQ_AWAITING_CLARIFICATION', 'REQ_AWAITING_APPROVAL', 'DESIGN_AWAITING_APPROVAL']

export const EDGES: Edge[] = [
  { from: 'CREATED', to: 'CONTEXT_SCANNING', by: 'orchestrator' },
  { from: 'CONTEXT_SCANNING', to: 'CONTEXT_READY', by: 'orchestrator' },
  { from: 'CONTEXT_READY', to: 'CONTEXT_SCANNING', by: 'orchestrator' }, // re-scan (retrieval ablation)
  { from: 'CREATED', to: 'REQ_DRAFTING', by: 'orchestrator' },
  { from: 'CONTEXT_READY', to: 'REQ_DRAFTING', by: 'orchestrator' },
  { from: 'REQ_DRAFTING', to: 'REQ_AWAITING_CLARIFICATION', by: 'orchestrator' },
  { from: 'REQ_AWAITING_CLARIFICATION', to: 'REQ_DRAFTING', by: 'human' },
  { from: 'REQ_DRAFTING', to: 'REQ_AWAITING_APPROVAL', by: 'orchestrator' },
  { from: 'REQ_AWAITING_APPROVAL', to: 'REQ_APPROVED', by: 'human' },
  { from: 'REQ_AWAITING_APPROVAL', to: 'REQ_DRAFTING', by: 'human' }, // reject / request_changes
  { from: 'REQ_APPROVED', to: 'DESIGN_DRAFTING', by: 'orchestrator' },
  { from: 'DESIGN_DRAFTING', to: 'DESIGN_AWAITING_APPROVAL', by: 'orchestrator' },
  { from: 'DESIGN_AWAITING_APPROVAL', to: 'DESIGN_APPROVED', by: 'human' },
  { from: 'DESIGN_AWAITING_APPROVAL', to: 'DESIGN_DRAFTING', by: 'human' }, // reject / request_changes
  { from: 'DESIGN_APPROVED', to: 'TASKS_GENERATED', by: 'orchestrator' },
  { from: 'TASKS_GENERATED', to: 'READY_FOR_IMPLEMENTATION', by: 'orchestrator' },
  { from: 'READY_FOR_IMPLEMENTATION', to: 'IMPLEMENTING', by: 'orchestrator' },
  { from: 'IMPLEMENTING', to: 'READY_FOR_IMPLEMENTATION', by: 'orchestrator' }, // paused, no task in progress
  { from: 'IMPLEMENTING', to: 'DONE', by: 'orchestrator' },
]

export const PIPELINE: { key: string; label: string; states: Status[] }[] = [
  { key: 'context', label: 'Context', states: ['CONTEXT_SCANNING', 'CONTEXT_READY'] },
  { key: 'req', label: 'Requirements', states: ['REQ_DRAFTING', 'REQ_AWAITING_CLARIFICATION', 'REQ_AWAITING_APPROVAL', 'REQ_APPROVED'] },
  { key: 'design', label: 'Design', states: ['DESIGN_DRAFTING', 'DESIGN_AWAITING_APPROVAL', 'DESIGN_APPROVED'] },
  { key: 'tasks', label: 'Tasks', states: ['TASKS_GENERATED', 'READY_FOR_IMPLEMENTATION'] },
  { key: 'impl', label: 'Implement', states: ['IMPLEMENTING', 'DONE'] },
]

export class GovernanceError extends Error {
  code: string
  http: number
  constructor(code: string, message: string, http = 409) {
    super(message)
    this.code = code
    this.http = http
  }
}

export type SpecMode = 'greenfield' | 'brownfield'
export const modeOf = (caseType: 'A' | 'B'): SpecMode => (caseType === 'B' ? 'brownfield' : 'greenfield')

export type SpecRow = {
  id: string; user_id: string; title: string; description: string; case_type: 'A' | 'B'
  repo_url: string; status: Status; version: number; profile: 'dev' | 'demo'
  cap_usd: number; inject_flaws: number; created_at: string; updated_at: string
}

/**
 * The ONLY function that writes specs.status. Optimistic locking via `version`,
 * append-only audit_log row on every transition.
 */
export async function transition(
  db: D1Database,
  specId: string,
  to: Status,
  actor: Actor,
  expectedVersion: number,
  action: string,
  detail = ''
): Promise<{ status: Status; version: number }> {
  if (actor.type === 'agent') {
    throw new GovernanceError('agent_cannot_transition', 'Agents may only propose artifacts; they cannot change status.', 403)
  }
  const cur = await db.prepare('SELECT status, version FROM specs WHERE id = ?').bind(specId).first<{ status: Status; version: number }>()
  if (!cur) throw new GovernanceError('not_found', 'Spec not found', 404)
  if (cur.version !== expectedVersion) {
    throw new GovernanceError('version_conflict', `Stale version (expected ${expectedVersion}, current ${cur.version}). Reload and retry.`)
  }
  if (TERMINAL.includes(cur.status)) throw new GovernanceError('illegal_transition', `${cur.status} is terminal; create a new spec instead.`)
  // FAILED is reachable from every non-terminal state, by a human or the orchestrator, never an agent.
  const edge = to === 'FAILED' ? ({ from: cur.status, to, by: actor.type } as Edge) : EDGES.find((e) => e.from === cur.status && e.to === to)
  if (!edge) throw new GovernanceError('illegal_transition', `Transition ${cur.status} -> ${to} is not allowed.`)
  if (edge.by !== actor.type && !(actor.type === 'system' && edge.by === 'orchestrator')) {
    throw new GovernanceError('wrong_actor', `Transition ${cur.status} -> ${to} requires a ${edge.by}, got ${actor.type}.`, 403)
  }
  const res = await db
    .prepare("UPDATE specs SET status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?")
    .bind(to, specId, expectedVersion)
    .run()
  if (!res.meta.changes) throw new GovernanceError('version_conflict', 'Concurrent update detected. Reload and retry.')
  await db
    .prepare('INSERT INTO audit_log (spec_id, from_status, to_status, actor_type, actor, action, detail) VALUES (?,?,?,?,?,?,?)')
    .bind(specId, cur.status, to, actor.type, actor.id, action, detail)
    .run()
  return { status: to, version: expectedVersion + 1 }
}

export const WRITE_ALLOWED: Status[] = ['READY_FOR_IMPLEMENTATION', 'IMPLEMENTING']

/** Pure (no DB) version of the transition checks, used by the public "try to break the rules" playground. */
export function checkEdge(from: Status, to: Status, actor: ActorType): { ok: boolean; code?: string; http?: number; message: string; by?: string } {
  if (actor === 'agent') return { ok: false, code: 'ILLEGAL_TRANSITION', http: 403, message: 'Agents may only propose artifacts; they cannot change status.' }
  if (TERMINAL.includes(from)) return { ok: false, code: 'ILLEGAL_TRANSITION', http: 409, message: `${from} is terminal; create a new spec instead.` }
  const edge = to === 'FAILED' ? { by: actor } : EDGES.find((e) => e.from === from && e.to === to)
  if (!edge) return { ok: false, code: 'ILLEGAL_TRANSITION', http: 409, message: `Transition ${from} -> ${to} is not allowed.` }
  if (edge.by !== actor && !(actor === 'system' && edge.by === 'orchestrator')) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', http: 403, message: `Transition ${from} -> ${to} requires a ${edge.by}, got ${actor}.`, by: edge.by }
  }
  return { ok: true, message: `Allowed: ${from} -> ${to} by ${actor}. One audit-log row is written.`, by: edge.by }
}

export const ALL_STATUSES: Status[] = [
  'CREATED', 'CONTEXT_SCANNING', 'CONTEXT_READY', 'REQ_DRAFTING', 'REQ_AWAITING_CLARIFICATION', 'REQ_AWAITING_APPROVAL', 'REQ_APPROVED',
  'DESIGN_DRAFTING', 'DESIGN_AWAITING_APPROVAL', 'DESIGN_APPROVED', 'TASKS_GENERATED', 'READY_FOR_IMPLEMENTATION', 'IMPLEMENTING', 'DONE', 'FAILED',
]
