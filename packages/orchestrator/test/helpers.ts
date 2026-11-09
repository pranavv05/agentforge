import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type Db } from '@agentforge/db';
import type { ArtifactKind, SpecState } from '@agentforge/contract';
import {
  createSpec,
  decideArtifact,
  getHeadArtifact,
  getSpec,
  transition,
  writeArtifact,
} from '../src/index.ts';
import type { Actor } from '../src/types.ts';

/**
 * Test fixtures.
 *
 * Every suite gets a real temp database file rather than `:memory:`, because
 * `:memory:` is per-connection and the concurrency tests need two handles that can
 * actually see each other.
 */

export const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };
export const AGENT: Actor = { id: 'requirement-agent', type: 'agent' };
export const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

export interface TestDb {
  readonly db: Db;
  readonly path: string;
  readonly cleanup: () => void;
}

export function makeTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'agentforge-test-'));
  const path = join(dir, 'test.db');
  const db = createDb(path);

  return {
    db,
    path,
    cleanup: () => {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function makeSpec(db: Db, mode: 'greenfield' | 'brownfield' = 'greenfield') {
  return createSpec(db, {
    title: 'Add GST-compliant invoice export',
    description: 'Let an SMB export invoices in the GST e-invoice JSON shape.',
    mode,
    repo_path: mode === 'brownfield' ? process.cwd() : null,
    actor: HUMAN,
  });
}

/** A minimal valid payload for each artifact kind. Shape detail belongs in agent tests. */
export function samplePayload(kind: ArtifactKind): unknown {
  switch (kind) {
    case 'context':
      return { summary: 'ctx', claims: [], touched_modules: [], open_questions: [] };
    case 'requirements':
      return {
        feature_summary: 'Export invoices.',
        requirements: [
          {
            id: 'REQ-001',
            ears_pattern: 'event_driven',
            ears_statement: 'When a user exports an invoice, the system shall emit GST JSON.',
            rationale: 'Required for e-invoice upload.',
            priority: 'must',
            acceptance_criteria: [
              {
                id: 'AC-001',
                given: 'a finalised invoice',
                when: 'the user exports it',
                then: 'the payload contains every mandatory GST field',
                compliance_rule_key: null,
              },
            ],
            source_refs: [],
            compliance_refs: [],
          },
        ],
        clarification_questions: [],
        non_goals: [],
      };
    case 'design':
      return {
        overview: 'A serialiser plus a validator.',
        sections: [
          {
            id: 'DES-001',
            heading: 'Serialiser',
            body: 'Map the internal invoice to the GST schema.',
            source_refs: [],
            requirement_ids: ['REQ-001'],
          },
        ],
        decisions: [],
        risks: [],
      };
    case 'tasks':
      return {
        implementation_order_rationale: 'Validator first so the serialiser can be tested.',
        tasks: [
          {
            id: 'TASK-001',
            title: 'Add GST field validator',
            description: 'Validate mandatory GST fields.',
            status: 'pending',
            requirement_ids: ['REQ-001'],
            design_section_ids: ['DES-001'],
            source_refs: [],
            verifies: ['AC-001'],
            depends_on: [],
          },
        ],
      };
  }
}

/** Writes an artifact of `kind` with a stub markdown render. */
export function putArtifact(db: Db, specId: string, kind: ArtifactKind, actor: Actor = AGENT) {
  return writeArtifact(db, {
    specId,
    kind,
    payload: samplePayload(kind),
    contentMd: `# ${kind}\n\nrendered deterministically in tests\n`,
    actor,
  });
}

/**
 * Drives a spec to `target` through the real state machine.
 *
 * Deliberately uses only public transitions and real approvals, so a helper can never
 * manufacture a state the production code could not reach.
 */
export function driveTo(db: Db, specId: string, target: SpecState): void {
  const current = () => {
    const spec = getSpec(db, specId);
    if (spec === undefined) throw new Error(`spec ${specId} vanished`);
    return spec;
  };

  const step = (to: SpecState, actor: Actor = ORCHESTRATOR): void => {
    const spec = current();
    transition(db, { specId, from: spec.status, to, actor, expectedVersion: spec.version });
  };

  const approve = (kind: 'requirements' | 'design'): void => {
    const spec = current();
    const head = getHeadArtifact(db, specId, kind);
    if (head === undefined) throw new Error(`no ${kind} artifact to approve`);
    decideArtifact(db, {
      specId,
      kind,
      contentHash: head.contentHash,
      decision: 'approve',
      actor: HUMAN,
      expectedVersion: spec.version,
    });
  };

  const path: readonly (() => void)[] = [
    () => {
      step('REQ_DRAFTING');
    },
    () => {
      putArtifact(db, specId, 'requirements');
      step('REQ_AWAITING_APPROVAL');
    },
    () => {
      approve('requirements');
    },
    () => {
      step('DESIGN_DRAFTING');
    },
    () => {
      putArtifact(db, specId, 'design');
      step('DESIGN_AWAITING_APPROVAL');
    },
    () => {
      approve('design');
    },
    () => {
      putArtifact(db, specId, 'tasks');
      step('TASKS_GENERATED');
    },
    () => {
      step('READY_FOR_IMPLEMENTATION');
    },
    () => {
      step('IMPLEMENTING');
    },
    () => {
      step('DONE');
    },
  ];

  for (const advance of path) {
    if (current().status === target) return;
    advance();
  }

  if (current().status !== target) {
    throw new Error(`could not drive spec to ${target}; stopped at ${current().status}`);
  }
}
