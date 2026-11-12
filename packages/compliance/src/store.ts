import {
  type CompliancePack,
  CompliancePackSchema,
  type ComplianceRule,
  ComplianceRuleSchema,
  type ComplianceTrace,
  NotFoundError,
} from '@agentforge/contract';
import { type Db, parseJsonColumn, schema, toJsonColumn } from '@agentforge/db';
import { and, desc, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { COMPLIANCE_PACK } from './pack.ts';

/**
 * Pack and trace persistence.
 *
 * The pack is stored, not just imported, for one reason: an approval records the pack
 * version it was granted under, so the exact rule text that was in force at that moment
 * has to be recoverable later. Reading the rules back out of the code would give you
 * whatever the current release says, which is precisely the mistake that versioning the
 * pack is meant to prevent.
 */

/** Installs a pack into the database. Idempotent per (version, rule). */
export function loadPack(db: Db, pack: CompliancePack = COMPLIANCE_PACK): number {
  const validated = CompliancePackSchema.parse(pack);

  return db.transaction(
    (tx) => {
      const existing = new Set(
        tx
          .select({ ruleKey: schema.complianceRules.ruleKey })
          .from(schema.complianceRules)
          .where(eq(schema.complianceRules.packVersion, validated.version))
          .all()
          .map((r) => r.ruleKey),
      );

      const now = new Date().toISOString();
      let inserted = 0;

      for (const rule of validated.rules) {
        if (existing.has(rule.key)) continue;

        tx.insert(schema.complianceRules)
          .values({
            packVersion: validated.version,
            ruleKey: rule.key,
            domain: rule.domain,
            jurisdiction: rule.jurisdiction,
            severity: rule.severity,
            ruleJson: toJsonColumn(rule),
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

/**
 * Makes sure the pack the code ships is the pack the database holds.
 *
 * `loadPack` had exactly one caller outside the tests: `scripts/seed.ts`. A deployment
 * that ran `db:migrate` and never `db:seed` — which is what a real install does, because
 * the seed loads *fixtures* — therefore had no pack in its database. Nothing failed.
 * The Task Agent skips the trace when no pack is installed, and the trace route returns an
 * empty rule list, so compliance traceability, the third headline claim of the product,
 * silently did not exist. It was found by running the Task Agent against a scratch
 * database that, like a real install, had never been seeded.
 *
 * Cheap when current (one indexed read) and idempotent when not, so it is safe to call
 * wherever the pack is consumed. It is not a migration on purpose: migrations here are
 * checksum-guarded and applied once, and seeding data from one is the wrong tool for
 * something that must track the code's pack version.
 */
export function ensurePackInstalled(db: Db, pack: CompliancePack = COMPLIANCE_PACK): void {
  if (installedPackVersion(db) === pack.version) return;
  loadPack(db, pack);
}

/** The highest pack version installed, or undefined when none is. */
export function installedPackVersion(db: Db): string | undefined {
  return db
    .select({ packVersion: schema.complianceRules.packVersion })
    .from(schema.complianceRules)
    .orderBy(desc(schema.complianceRules.packVersion))
    .limit(1)
    .all()[0]?.packVersion;
}

/** Reads a stored pack back, validating every rule on the way out. */
export function readPack(db: Db, version?: string): CompliancePack {
  const packVersion = version ?? installedPackVersion(db);
  if (packVersion === undefined) {
    throw new NotFoundError(
      'no compliance pack has been loaded; run the pack loader to install one',
    );
  }

  const rows = db
    .select()
    .from(schema.complianceRules)
    .where(eq(schema.complianceRules.packVersion, packVersion))
    .orderBy(schema.complianceRules.ruleKey)
    .all();

  if (rows.length === 0) {
    throw new NotFoundError(`compliance pack version ${packVersion} is not installed`, {
      pack_version: packVersion,
    });
  }

  const rules: ComplianceRule[] = rows.map((row) =>
    parseJsonColumn(
      ComplianceRuleSchema,
      row.ruleJson,
      `compliance_rules.rule_json (${row.ruleKey})`,
    ),
  );

  return CompliancePackSchema.parse({
    version: packVersion,
    // The reviewed date belongs to the pack content, which the stored rules came from.
    reviewed_on: COMPLIANCE_PACK.reviewed_on,
    rules,
  });
}

/** Replaces a spec's trace rows with a freshly computed matrix. */
export function saveTraces(
  db: Db,
  specId: string,
  packVersion: string,
  traces: readonly ComplianceTrace[],
): number {
  return db.transaction(
    (tx) => {
      tx.delete(schema.complianceTraces).where(eq(schema.complianceTraces.specId, specId)).run();

      const now = new Date().toISOString();
      for (const trace of traces) {
        tx.insert(schema.complianceTraces)
          .values({
            id: `trc_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`,
            specId,
            packVersion,
            ruleKey: trace.rule_key,
            requirementId: trace.requirement_id,
            acceptanceCriterionId: trace.acceptance_criterion_id,
            designSectionId: trace.design_section_id,
            taskId: trace.task_id,
            testRef: trace.test_ref,
            createdAt: now,
          })
          .run();
      }

      return traces.length;
    },
    { behavior: 'immediate' },
  );
}

/** A spec's stored trace rows. */
export function readTraces(db: Db, specId: string): readonly ComplianceTrace[] {
  return db
    .select()
    .from(schema.complianceTraces)
    .where(eq(schema.complianceTraces.specId, specId))
    .orderBy(schema.complianceTraces.ruleKey)
    .all()
    .map((row) => ({
      rule_key: row.ruleKey,
      requirement_id: row.requirementId,
      acceptance_criterion_id: row.acceptanceCriterionId,
      design_section_id: row.designSectionId,
      task_id: row.taskId,
      test_ref: row.testRef,
    }));
}

/** Records the test that implements one acceptance criterion. */
export function recordTestRef(
  db: Db,
  specId: string,
  acceptanceCriterionId: string,
  testRef: string,
): number {
  return db
    .update(schema.complianceTraces)
    .set({ testRef })
    .where(
      and(
        eq(schema.complianceTraces.specId, specId),
        eq(schema.complianceTraces.acceptanceCriterionId, acceptanceCriterionId),
      ),
    )
    .run().changes;
}
