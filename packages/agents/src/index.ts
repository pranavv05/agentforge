/**
 * `@agentforge/agents` — the Requirement, Design and Task agents.
 *
 * Each agent proposes a structured artifact through strict tool use; the markdown is
 * rendered deterministically from that JSON. Agents never transition a spec and never
 * approve their own output — they call the orchestrator, which decides.
 */

export * from './render/index.ts';
