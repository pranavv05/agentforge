import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb, parseJsonColumn } from '@agentforge/db';
import { getHeadArtifact, getSpec } from '@agentforge/orchestrator';
import {
  PACK_VERSION,
  applicableRules,
  buildTraceMatrix,
  describeViolation,
  detectSupersededTerms,
} from '@agentforge/compliance';
import {
  DesignProposalSchema,
  RequirementsProposalSchema,
  TasksProposalSchema,
} from '@agentforge/contract';

/**
 * The compliance trace matrix.
 *
 * Reads rule → requirement → design → task → test as a chain, and shows where each one
 * stops. A rule that reaches a requirement and no further has been *written down*, not
 * built, and the coverage figure counts only rules that reach a task for exactly that
 * reason.
 *
 * Gaps are therefore the point of the screen, not an embarrassment on it: the broken
 * links are listed as prominently as the complete ones.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const spec = getSpec(getDb(), id);
  return { title: spec === undefined ? 'Compliance' : `Compliance · ${spec.title}` };
}

export default async function CompliancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const spec = getSpec(db, id);
  if (spec === undefined) notFound();

  // Each artifact is validated on read: a JSON column is a trust boundary like any other.
  const reqArtifact = getHeadArtifact(db, id, 'requirements');
  const designArtifact = getHeadArtifact(db, id, 'design');
  const tasksArtifact = getHeadArtifact(db, id, 'tasks');

  const requirements =
    reqArtifact === undefined
      ? null
      : parseJsonColumn(
          RequirementsProposalSchema,
          reqArtifact.contentJson,
          'artifact_versions.content_json (requirements)',
        );

  const design =
    designArtifact === undefined
      ? null
      : parseJsonColumn(
          DesignProposalSchema,
          designArtifact.contentJson,
          'artifact_versions.content_json (design)',
        );

  const tasksProposal =
    tasksArtifact === undefined
      ? null
      : parseJsonColumn(
          TasksProposalSchema,
          tasksArtifact.contentJson,
          'artifact_versions.content_json (tasks)',
        );

  const rules = applicableRules({
    title: spec.title,
    description: spec.description,
    requirementText: (requirements?.requirements ?? []).map(
      (req) => `${req.ears_statement} ${req.rationale}`,
    ),
  });

  const coverage = buildTraceMatrix({
    packVersion: PACK_VERSION,
    applicableRules: rules,
    requirements,
    design,
    tasks: tasksProposal,
    // Superseded-term detection runs over the design prose, which is where a citation to
    // a dissolved section would actually appear.
    violations:
      design === null
        ? []
        : detectSupersededTerms([
            { location: 'design.overview', text: design.overview },
            ...design.sections.map((section, index) => ({
              location: `design.sections[${String(index)}]`,
              text: section.body,
            })),
          ]),
  });

  const complete = coverage.traces.filter((trace) => trace.task_id !== null);
  const gaps = coverage.traces.filter((trace) => trace.task_id === null);

  return (
    <>
      <div className="page__head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/specs">Specs</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/specs/${id}`}>{spec.title}</Link>
          <span aria-hidden="true">/</span>
          <span>compliance</span>
        </nav>

        <h1 className="page__title">Compliance trace</h1>
        <p className="page__lede">
          Pack {coverage.pack_version}. Coverage counts only rules traced all the way to a task,
          because a rule that stops at a requirement has been written down rather than built.
        </p>
      </div>

      {coverage.applicable_rules === 0 ? (
        <div className="empty">
          <h2 className="empty__title">No rules apply</h2>
          <p className="empty__body">Nothing in this spec matched a rule in the GST or TDS pack.</p>
        </div>
      ) : (
        <>
          <div className="scoreStrip">
            <div className="scoreStrip__big">
              <span className="tabular">{(coverage.coverage_rate * 100).toFixed(0)}%</span>
              <span className="scoreStrip__label">traced to a task</span>
            </div>
            <dl className="scoreStrip__rows">
              <div>
                <dt>applicable rules</dt>
                <dd className="tabular">{coverage.applicable_rules}</dd>
              </div>
              <div>
                <dt>reached a requirement</dt>
                <dd className="tabular">{coverage.traced_to_requirement}</dd>
              </div>
              <div>
                <dt>reached a design section</dt>
                <dd className="tabular">{coverage.traced_to_design}</dd>
              </div>
              <div>
                <dt>reached a task</dt>
                <dd className="tabular">{coverage.traced_to_task}</dd>
              </div>
            </dl>
          </div>

          {coverage.violations.length > 0 && (
            <div className="callout callout--accent">
              <h2 className="callout__title">
                {coverage.violations.length} violation
                {coverage.violations.length === 1 ? '' : 's'}
              </h2>
              <ul className="sideCard__list">
                {coverage.violations.map((violation, index) => (
                  <li key={`${violation.rule_key}-${String(index)}`}>
                    <code>{violation.rule_key}</code> — {describeViolation(violation)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h2 className="hub__heading">Chains</h2>
          <div className="doc__tableWrap">
            <table className="doc__table">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Requirement</th>
                  <th scope="col">Design</th>
                  <th scope="col">Task</th>
                  <th scope="col">Test</th>
                </tr>
              </thead>
              <tbody>
                {[...gaps, ...complete].map((trace, index) => (
                  <tr key={`${trace.rule_key}-${String(index)}`}>
                    <th scope="row">
                      <code>{trace.rule_key}</code>
                    </th>
                    <td className="traceCell">
                      {trace.requirement_id ?? <span className="traceCell__gap">—</span>}
                    </td>
                    <td className="traceCell">
                      {trace.design_section_id ?? <span className="traceCell__gap">—</span>}
                    </td>
                    <td className="traceCell">
                      {trace.task_id ?? <span className="traceCell__gap">not built</span>}
                    </td>
                    <td className="traceCell">
                      {trace.test_ref ?? <span className="traceCell__gap">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
