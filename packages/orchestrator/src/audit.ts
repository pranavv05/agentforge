import { type Db, schema } from '@agentforge/db';
import { asc, eq } from 'drizzle-orm';

/**
 * Audit log reads.
 *
 * Writes go through `appendAudit` inside a transition's transaction; this module only
 * reads. Ordering is by `seq`, never by timestamp, because several entries can share a
 * millisecond and the timeline has to be exact.
 */

export function listAuditEntries(
  db: Db,
  specId: string,
): readonly (typeof schema.auditLog.$inferSelect)[] {
  return db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.specId, specId))
    .orderBy(asc(schema.auditLog.seq))
    .all();
}

/** Every entry from one run, across specs. Used when debugging an agent run. */
export function listAuditEntriesByCorrelation(
  db: Db,
  correlationId: string,
): readonly (typeof schema.auditLog.$inferSelect)[] {
  return db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.correlationId, correlationId))
    .orderBy(asc(schema.auditLog.seq))
    .all();
}
