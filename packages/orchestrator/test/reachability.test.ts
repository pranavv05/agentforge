import { describe, expect, it } from 'vitest';
import { TRANSITION_RULES } from '../src/index.ts';

/**
 * Who actually drives each edge.
 *
 * Three bugs reached a user in one session and all three were the same shape: an edge
 * that is legal in the transition table and that *nothing in the product ever takes*.
 * The worst of them — `TASKS_GENERATED -> READY_FOR_IMPLEMENTATION` — had exactly one
 * caller in the entire repository, `scripts/seed.ts`, so every spec a real person
 * created stopped dead after tasks were generated and the whole implementation phase was
 * unreachable. Nothing failed. Every suite stayed green.
 *
 * A table of legal moves says what the state machine *permits*. It says nothing about
 * what the product can *do*, and the gap between those two is invisible until someone
 * clicks. This test closes it: every edge must name its driver, so adding a rule without
 * wiring it up fails here, and an edge nobody drives has to be written down as such
 * rather than silently rotting.
 *
 * It deliberately records a name rather than proving reachability by analysis. A string
 * can go stale, but a stale string is still a question somebody has to answer when they
 * touch the table — which is more than the previous arrangement offered.
 */

/** How an edge is caused in the shipped product. */
type Driver =
  /** A route handler under apps/web/app/api. */
  | { readonly by: 'route'; readonly where: string }
  /** An agent completing its work and the orchestrator recording it. */
  | { readonly by: 'agent'; readonly where: string }
  /** A human decision through the approvals API. */
  | { readonly by: 'approval'; readonly where: string }
  /** An MCP tool used by the implementing agent. */
  | { readonly by: 'mcp'; readonly where: string }
  /**
   * Nothing drives it yet.
   *
   * Allowed, but it must say so out loud and say why. An entry here is a known gap, not
   * an oversight — that distinction is the entire point of this file.
   */
  | { readonly by: 'nothing'; readonly why: string };

const DRIVERS: Readonly<Record<string, Driver>> = {
  // --- getting started ---------------------------------------------------
  'CREATED>CONTEXT_SCANNING': { by: 'route', where: 'context/scan (advanceTo)' },
  'CREATED>REQ_DRAFTING': { by: 'route', where: 'requirements/draft (advanceTo)' },
  'CONTEXT_SCANNING>CONTEXT_READY': { by: 'agent', where: 'scanContext' },
  'CONTEXT_READY>CONTEXT_SCANNING': { by: 'route', where: 'context/scan (advanceTo), re-scan' },
  'CONTEXT_READY>REQ_DRAFTING': { by: 'route', where: 'requirements/draft (advanceTo)' },

  // --- requirements ------------------------------------------------------
  'REQ_DRAFTING>REQ_AWAITING_CLARIFICATION': { by: 'agent', where: 'draftRequirements asks' },
  'REQ_AWAITING_CLARIFICATION>REQ_DRAFTING': {
    by: 'route',
    where: 'requirements/draft (advanceTo), after answers',
  },
  'REQ_DRAFTING>REQ_AWAITING_APPROVAL': { by: 'agent', where: 'draftRequirements proposes' },
  'REQ_AWAITING_APPROVAL>REQ_APPROVED': { by: 'approval', where: 'approve requirements' },
  'REQ_AWAITING_APPROVAL>REQ_DRAFTING': {
    by: 'approval',
    where: 'reject or request_changes on requirements',
  },

  // --- design ------------------------------------------------------------
  'REQ_APPROVED>DESIGN_DRAFTING': { by: 'route', where: 'design/draft (advanceTo)' },
  'DESIGN_DRAFTING>DESIGN_AWAITING_APPROVAL': { by: 'agent', where: 'draftDesign' },
  'DESIGN_AWAITING_APPROVAL>DESIGN_APPROVED': { by: 'approval', where: 'approve design' },
  'DESIGN_AWAITING_APPROVAL>DESIGN_DRAFTING': {
    by: 'approval',
    where: 'reject or request_changes on design',
  },

  // --- tasks and implementation -----------------------------------------
  'DESIGN_APPROVED>TASKS_GENERATED': { by: 'agent', where: 'generateTasks writes and moves' },
  'TASKS_GENERATED>READY_FOR_IMPLEMENTATION': {
    by: 'approval',
    where: 'approve tasks — releases for implementation',
  },
  'TASKS_GENERATED>DESIGN_APPROVED': {
    by: 'approval',
    where: 'reject or request_changes on tasks',
  },
  'READY_FOR_IMPLEMENTATION>IMPLEMENTING': { by: 'mcp', where: 'start_task' },
  'IMPLEMENTING>DONE': { by: 'mcp', where: 'complete_task, last task' },

  'IMPLEMENTING>READY_FOR_IMPLEMENTATION': {
    by: 'nothing',
    why:
      'Pausing implementation. No tool releases a claimed task without completing or ' +
      'blocking it, so a spec cannot currently return to READY_FOR_IMPLEMENTATION. ' +
      'Harmless today because the MCP server is single-task, but an abandoned claim ' +
      'leaves the spec in IMPLEMENTING with nothing in progress.',
  },
};

/** `FAILED` is reachable from every non-terminal state by construction. */
const edges = TRANSITION_RULES.filter((rule) => rule.to !== 'FAILED');

describe('every legal edge names who drives it', () => {
  it('has an entry for each rule in the table', () => {
    const missing = edges
      .map((rule) => `${rule.from}>${rule.to}`)
      .filter((key) => !(key in DRIVERS));

    expect(
      missing,
      'edges with no driver recorded — add one to DRIVERS, and wire it up or say why not',
    ).toEqual([]);
  });

  it('records no driver for an edge the table does not have', () => {
    const live = new Set(edges.map((rule) => `${rule.from}>${rule.to}`));
    const stale = Object.keys(DRIVERS).filter((key) => !live.has(key));

    expect(stale, 'DRIVERS entries for edges that no longer exist').toEqual([]);
  });

  it('keeps the list of undriven edges small and explained', () => {
    const undriven = Object.entries(DRIVERS).filter(([, driver]) => driver.by === 'nothing');

    // Not zero — one genuine gap is recorded above. The assertion is that it stays
    // deliberate: a number that creeps upwards means edges are being added faster than
    // they are being wired, which is exactly how the implementation phase became
    // unreachable without anyone noticing.
    expect(undriven.length, undriven.map(([key]) => key).join(', ')).toBeLessThanOrEqual(1);

    for (const [key, driver] of undriven) {
      if (driver.by !== 'nothing') continue;
      expect(driver.why.length, `${key} needs a real explanation`).toBeGreaterThan(40);
    }
  });

  it('drives every gate by a human decision', () => {
    // The governance claim, read off the table rather than asserted separately: if an
    // edge admits only humans, something a human does has to cause it.
    const humanOnly = edges.filter(
      (rule) => rule.allowedActors.length === 1 && rule.allowedActors[0] === 'human',
    );
    expect(humanOnly.length).toBeGreaterThan(0);

    for (const rule of humanOnly) {
      const driver = DRIVERS[`${rule.from}>${rule.to}`];
      expect(driver?.by, `${rule.from} -> ${rule.to}`).toBe('approval');
    }
  });
});
