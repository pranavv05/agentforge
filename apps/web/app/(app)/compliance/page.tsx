import type { Metadata } from 'next';
import { getDb, parseJsonColumn, schema } from '@agentforge/db';
import { ComplianceRuleSchema } from '@agentforge/contract';
import { desc } from 'drizzle-orm';

/**
 * The compliance pack.
 *
 * Shows the rules as they are stored, including the parts that are least flattering:
 * every citation, and every recorded source conflict. Those conflicts exist because
 * sources genuinely disagree on some thresholds and payment codes, and the pack records
 * the disagreement rather than silently picking a side — so the screen that displays the
 * pack has to show them too, or the disclosure only exists in the database.
 *
 * The caveat at the top is not boilerplate. This pack has not been reviewed by a tax
 * professional, and anyone reading these rules needs to know that before they rely on
 * one.
 */

export const metadata: Metadata = {
  title: 'Compliance pack',
};

export const dynamic = 'force-dynamic';

export default function CompliancePackPage() {
  const db = getDb();

  const rows = db
    .select()
    .from(schema.complianceRules)
    .orderBy(desc(schema.complianceRules.packVersion), schema.complianceRules.ruleKey)
    .all();

  const rules = rows.map((row) =>
    parseJsonColumn(
      ComplianceRuleSchema,
      row.ruleJson,
      `compliance_rules.rule_json (${row.ruleKey})`,
    ),
  );

  const version = rows[0]?.packVersion ?? null;
  const conflicts = rules.filter(
    (rule) => rule.source_conflict_note !== null && rule.source_conflict_note.length > 0,
  );

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Compliance pack</h1>
        <p className="page__lede">
          {version === null
            ? 'No pack is loaded.'
            : `Version ${version} · ${String(rules.length)} rules.`}{' '}
          Rules inject testable acceptance criteria into requirements and are traced through to
          tasks and tests.
        </p>
      </div>

      {rules.length === 0 ? (
        <div className="empty">
          <h2 className="empty__title">No pack loaded</h2>
          <p className="empty__body">
            An empty rule set would read as &ldquo;nothing to comply with&rdquo;, which is the
            opposite of the truth — so nothing is shown rather than an empty list.
          </p>
        </div>
      ) : (
        <>
          <div className="callout">
            <h2 className="callout__title">Not reviewed by a tax professional</h2>
            <p className="callout__body">
              Rates and payment codes are encoded only where the research source states them;
              everything else is a structural obligation rather than an invented number. Confirm
              every rate, threshold and code against the CBDT portal and the current NIC e-invoice
              schema before relying on any of it.
              {conflicts.length > 0 && (
                <>
                  {' '}
                  {conflicts.length} rule{conflicts.length === 1 ? ' has' : 's have'} a recorded
                  source disagreement, shown below.
                </>
              )}
            </p>
          </div>

          <ul className="ruleList">
            {rules.map((rule) => (
              <li className="rule" key={rule.key}>
                <div className="rule__head">
                  <code className="rule__key">{rule.key}</code>
                  <span className="badge badge--plain">{rule.domain}</span>
                  <span
                    className={`badge badge--${
                      rule.severity === 'blocking'
                        ? 'danger'
                        : rule.severity === 'warning'
                          ? 'warn'
                          : 'plain'
                    }`}
                  >
                    {rule.severity}
                  </span>
                </div>

                <h2 className="rule__title">{rule.title}</h2>
                <p className="rule__text">{rule.requirement_text}</p>

                {rule.acceptance_criteria.length > 0 && (
                  <ul className="rule__criteria">
                    {rule.acceptance_criteria.map((criterion, index) => (
                      <li key={`${rule.key}-ac${String(index)}`}>
                        <strong>Given</strong> {criterion.given} <strong>when</strong>{' '}
                        {criterion.when} <strong>then</strong> {criterion.then}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="rule__citation">{rule.citation}</p>

                {rule.source_conflict_note !== null && rule.source_conflict_note.length > 0 && (
                  <p className="rule__conflict">
                    <strong>Sources disagree.</strong> {rule.source_conflict_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
