import {
  DesignProposalSchema,
  GetComplianceTraceResponseSchema,
  RequirementsProposalSchema,
  TasksProposalSchema,
} from '@agentforge/contract';
import { getDb, parseJsonColumn } from '@agentforge/db';
import {
  applicableRules,
  buildTraceMatrix,
  detectSupersededTerms,
  ensurePackInstalled,
  installedPackVersion,
} from '@agentforge/compliance';
import { getHeadArtifact, requireSpecById } from '@agentforge/orchestrator';
import type { z } from 'zod';
import { handle } from '@/lib/handler';

/**
 * `GET /api/specs/:id/compliance/trace` — the traceability matrix.
 *
 * Recomputed from the current artifacts on each read rather than served from the stored
 * rows, so it always describes what the spec says *now*. The stored rows are the record
 * of what was computed when tasks were generated; this is the live view, and a
 * divergence between them is itself informative.
 *
 * The value is in the gaps: a rule that stops at a requirement has been written down and
 * not built, which is exactly what `coverage_rate` measures.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(request, async () => {
    const { id } = await params;
    const db = getDb();
    const spec = requireSpecById(db, id);

    // Idempotent and cheap when current. A trace over an uninstalled pack is not "no rules
    // apply", it is "nothing was checked", and returning an empty matrix as though it were
    // the former is the failure this guards against.
    ensurePackInstalled(db);
    const packVersion = installedPackVersion(db);

    /** Reads and validates one artifact payload, or null when it does not exist yet. */
    const read = <T>(kind: 'requirements' | 'design' | 'tasks', schema: z.ZodType<T>): T | null => {
      const artifact = getHeadArtifact(db, id, kind);
      if (artifact === undefined) return null;
      return parseJsonColumn(
        schema,
        artifact.contentJson,
        `artifact_versions.content_json (${kind} v${String(artifact.version)})`,
      );
    };

    const requirements = read('requirements', RequirementsProposalSchema);
    const design = read('design', DesignProposalSchema);
    const tasks = read('tasks', TasksProposalSchema);

    const rules =
      packVersion === undefined
        ? []
        : applicableRules({
            title: spec.title,
            description: spec.description,
            requirementText:
              requirements?.requirements.map((r) => `${r.ears_statement} ${r.rationale}`) ?? [],
          });

    const violations = detectSupersededTerms([
      ...(design === null
        ? []
        : [
            { location: 'design.overview', text: design.overview },
            ...design.sections.map((section, i) => ({
              location: `design.sections[${String(i)}].body`,
              text: section.body,
            })),
          ]),
      ...(requirements?.requirements.map((req, i) => ({
        location: `requirements[${String(i)}].rationale`,
        text: req.rationale,
      })) ?? []),
    ]);

    return GetComplianceTraceResponseSchema.parse({
      coverage: buildTraceMatrix({
        // Reported as the installed version, or 0.0.0 when no pack is loaded, so the
        // response shape is stable and the UI can say "no pack" rather than break.
        packVersion: packVersion ?? '0.0.0',
        applicableRules: rules,
        requirements,
        design,
        tasks,
        violations,
      }),
    });
  });
}
