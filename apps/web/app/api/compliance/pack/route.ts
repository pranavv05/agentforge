import {
  CompliancePackSchema,
  GetCompliancePackResponseSchema,
  NotFoundError,
} from '@agentforge/contract';
import { getDb, parseJsonColumn, schema } from '@agentforge/db';
import { ComplianceRuleSchema } from '@agentforge/contract';
import { desc } from 'drizzle-orm';
import { handle } from '@/lib/handler';

/**
 * `GET /api/compliance/pack` — the active compliance pack.
 *
 * Reads whichever pack version is loaded in `compliance_rules`. Until a pack is
 * loaded this returns 404 with a clear message rather than an empty pack: an empty
 * rule set would look like "nothing to comply with", which is the opposite of true.
 */
export function GET(request: Request): Promise<Response> {
  return handle(request, () => {
    const db = getDb();

    const rows = db
      .select()
      .from(schema.complianceRules)
      .orderBy(desc(schema.complianceRules.packVersion), schema.complianceRules.ruleKey)
      .all();

    const latest = rows[0]?.packVersion;
    if (latest === undefined) {
      throw new NotFoundError(
        'no compliance pack has been loaded; run the pack loader to install one',
      );
    }

    const rules = rows
      .filter((r) => r.packVersion === latest)
      .map((r) =>
        parseJsonColumn(
          ComplianceRuleSchema,
          r.ruleJson,
          `compliance_rules.rule_json (${r.ruleKey})`,
        ),
      );

    return GetCompliancePackResponseSchema.parse({
      pack: CompliancePackSchema.parse({
        version: latest,
        reviewed_on: new Date().toISOString().slice(0, 10),
        rules,
      }),
    });
  });
}
