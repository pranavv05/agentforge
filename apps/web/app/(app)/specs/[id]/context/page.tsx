import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@agentforge/db';
import { evidenceStats, getSpec, listEvidence } from '@agentforge/orchestrator';
import type { GroundingFailure } from '@agentforge/contract';

/**
 * The evidence view.
 *
 * Where the hallucination metric stops being a number on a landing page and becomes a
 * list a reviewer can check. Failed claims are shown, not hidden, and each one says *why*
 * it failed — the verifier's own verdict, not a generic "unverified".
 *
 * Verified claims come first because they are what the design is allowed to build on;
 * failures are grouped below with their reasons, where they read as a measurement rather
 * than as an error list.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const spec = getSpec(getDb(), id);
  return { title: spec === undefined ? 'Context' : `Context · ${spec.title}` };
}

/** A reviewer-facing explanation per failure kind. */
const FAILURE_REASON: Record<GroundingFailure, string> = {
  file_not_found: 'No such file in the repository.',
  not_a_file: 'The path exists but is not a file.',
  path_escapes_repo: 'The path resolved outside the repository root.',
  line_range_invalid: 'The line range is not a valid range.',
  line_range_past_eof: 'The range extends past the end of the file.',
  symbol_not_in_range: 'The symbol does not appear inside the cited lines.',
  file_unreadable: 'The file could not be read.',
};

export default async function ContextPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const spec = getSpec(db, id);
  if (spec === undefined) notFound();

  const evidence = listEvidence(db, id);
  const stats = evidenceStats(db, id);

  const verified = evidence.filter((item) => item.verified);
  const failed = evidence.filter((item) => !item.verified);

  return (
    <>
      <div className="page__head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/specs">Specs</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/specs/${id}`}>{spec.title}</Link>
          <span aria-hidden="true">/</span>
          <span>context</span>
        </nav>

        <h1 className="page__title">Codebase evidence</h1>
        <p className="page__lede">
          Every claim the Context Agent made about existing code, with the verifier&apos;s verdict.
          Verification is deterministic: it reads the file, checks the range is real, and confirms
          the symbol appears inside it.
        </p>
      </div>

      {evidence.length === 0 ? (
        <div className="empty">
          <h2 className="empty__title">No evidence yet</h2>
          <p className="empty__body">
            {spec.mode === 'greenfield'
              ? 'This is a greenfield spec, so there is no existing code to cite.'
              : 'Run a context scan to explore the repository and produce verifiable claims.'}
          </p>
        </div>
      ) : (
        <>
          <div className="scoreStrip">
            <div className="scoreStrip__big">
              <span className="tabular">{(stats.unverifiedClaimRate * 100).toFixed(1)}%</span>
              <span className="scoreStrip__label">unverified-claim rate</span>
            </div>
            <dl className="scoreStrip__rows">
              <div>
                <dt>claims</dt>
                <dd className="tabular">{stats.total}</dd>
              </div>
              <div>
                <dt>verified</dt>
                <dd className="tabular">{stats.verified}</dd>
              </div>
              <div>
                <dt>unverified</dt>
                <dd className="tabular">{stats.unverified}</dd>
              </div>
            </dl>
          </div>

          {failed.length > 0 && (
            <section aria-label="Unverified claims">
              <h2 className="hub__heading">Unverified ({failed.length})</h2>
              <p className="page__lede">
                Kept rather than discarded: the rate above needs its denominator, and a reviewer
                should see what the agent asserted and why it did not hold up. Nothing downstream is
                allowed to cite these.
              </p>
              <ul className="evidenceList">
                {failed.map((item) => (
                  <li className="evidenceItem evidenceItem--failed" key={item.id}>
                    <div className="evidenceItem__head">
                      <span className="badge badge--warn">unverified</span>
                      <code className="evidenceItem__ref">
                        {item.file}:{item.line_start}-{item.line_end}
                      </code>
                      {item.symbol !== null && (
                        <span className="evidenceItem__symbol mono">{item.symbol}</span>
                      )}
                    </div>
                    <p className="evidenceItem__claim">{item.claim}</p>
                    <p className="evidenceItem__why">
                      {item.failure_reason === null
                        ? 'Verification failed.'
                        : FAILURE_REASON[item.failure_reason]}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Verified claims">
            <h2 className="hub__heading">Verified ({verified.length})</h2>
            <ul className="evidenceList">
              {verified.map((item) => (
                <li className="evidenceItem" key={item.id}>
                  <div className="evidenceItem__head">
                    <span className="badge badge--ok">verified</span>
                    <code className="evidenceItem__ref">
                      {item.file}:{item.line_start}-{item.line_end}
                    </code>
                    {item.symbol !== null && (
                      <span className="evidenceItem__symbol mono">{item.symbol}</span>
                    )}
                  </div>
                  <p className="evidenceItem__claim">{item.claim}</p>
                  <p className="evidenceItem__why">{item.relevance}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
