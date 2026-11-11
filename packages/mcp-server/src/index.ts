/**
 * `@agentforge/mcp-server` — the implementation-phase MCP surface.
 *
 * The implementing agent reaches the orchestrator only through these tools, so the
 * state machine's guards apply to it exactly as they apply to the web API. No tool here
 * can approve an artifact, move a stage directly, or write to any table.
 */

export { createSddServer, type ServerOptions } from './server.ts';
export { CURRENT_SPEC_FILE, requireSpecId, resolveSpecId } from './spec-context.ts';
