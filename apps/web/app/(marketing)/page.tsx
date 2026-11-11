import Link from 'next/link';
import { Counter } from '@/components/motion/counter';
import { Reveal } from '@/components/motion/reveal';
import { SplitHeadline } from '@/components/motion/split-headline';

/**
 * The landing page.
 *
 * Every figure on this page is measured, and the page says where from. That is a
 * deliberate choice about how to sell a governance tool: the product's entire claim is
 * that it replaces trust with verification, so a landing page full of unverifiable
 * superlatives would undercut the thing it is selling. Where a number comes from a
 * single run, it says so.
 *
 * The structure follows the three claims in order, because they are what makes this
 * different from the half-dozen tools that also emit requirements, design and tasks.
 */

export default function LandingPage() {
  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="hero">
        <div className="shell hero__inner">
          <div className="hero__copy">
            <Reveal className="hero__eyebrow" y={12}>
              <span className="eyebrow">Spec-driven development, enforced</span>
            </Reveal>

            <SplitHeadline as="h1" className="hero__title">
              Governance that holds.
            </SplitHeadline>

            <Reveal delay={0.35} y={20}>
              <p className="lede hero__lede">
                Most spec tools ask a model to respect a gate. This one takes the decision away from
                it. Stage transitions belong to a deterministic orchestrator, approvals bind to a
                content hash, and a Claude Code hook refuses file edits outside an approved state.
              </p>
            </Reveal>

            <Reveal className="hero__actions" delay={0.5} y={16}>
              <Link className="btn btn--accent" href="/sign-up">
                Start a spec
              </Link>
              <a className="btn btn--ghost" href="#governance">
                See how the gate works
              </a>
            </Reveal>
          </div>

          {/*
            The hero visual is a real artifact, not an abstraction: an approval bound to
            an actual content hash, and a verified citation with the file and line range
            the verifier checked. Showing the thing beats illustrating it.
          */}
          <Reveal className="hero__panel" delay={0.6} y={34}>
            <figure className="artifact">
              <figcaption className="artifact__head">
                <span className="artifact__kind">requirements.md</span>
                <span className="badge badge--ok">approved</span>
              </figcaption>

              <dl className="artifact__rows">
                <div className="artifact__row">
                  <dt>content hash</dt>
                  <dd className="mono">edc324ed24f2…</dd>
                </div>
                <div className="artifact__row">
                  <dt>approved by</dt>
                  <dd>reviewer@acme.com</dd>
                </div>
                <div className="artifact__row">
                  <dt>state</dt>
                  <dd className="mono">REQ_APPROVED</dd>
                </div>
              </dl>

              <div className="artifact__evidence">
                <div className="evidence">
                  <span className="badge badge--ok">verified</span>
                  <code>src/billing/invoice.ts:9-12</code>
                  <span className="evidence__symbol mono">finaliseInvoice</span>
                </div>
                <div className="evidence">
                  <span className="badge badge--warn">unverified</span>
                  <code>src/billing/eInvoiceGateway.ts:1-20</code>
                  <span className="evidence__symbol muted">file not found</span>
                </div>
              </div>

              <p className="artifact__foot">
                Edit the artifact and this approval is invalidated. Design drafting then refuses to
                start.
              </p>
            </figure>
          </Reveal>
        </div>
      </section>

      {/* -------------------------------------------------------- marquee */}
      {/*
        The state machine, as a device. Not decoration: these are the real state names
        from `packages/contract/src/states.ts`, and all 225 ordered pairs are tested.
      */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee__track">
          {[0, 1].map((copy) => (
            <span className="marquee__group" key={copy}>
              {[
                'CREATED',
                'CONTEXT_SCANNING',
                'CONTEXT_READY',
                'REQ_DRAFTING',
                'REQ_AWAITING_APPROVAL',
                'REQ_APPROVED',
                'DESIGN_DRAFTING',
                'DESIGN_AWAITING_APPROVAL',
                'DESIGN_APPROVED',
                'TASKS_GENERATED',
                'READY_FOR_IMPLEMENTATION',
                'IMPLEMENTING',
                'DONE',
              ].map((state) => (
                <span className="marquee__item mono" key={state}>
                  {state}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* -------------------------------------------------------- problem */}
      <section className="section section--tight">
        <div className="shell">
          <Reveal className="stack" stagger={0.12}>
            <span className="eyebrow">The gap</span>
            <h2 className="section__title">
              Several tools generate the three documents. None of them stop you skipping a gate.
            </h2>
            <p className="lede">
              Spec Kit, OpenSpec, BMAD, Kiro and Spec Workflow MCP all produce requirements, design
              and tasks. In each of them the gate is a convention a model or a human is trusted to
              follow. Nothing refuses. Nothing records who decided what, bound to the bytes they
              decided on.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------- claim 1: gates */}
      <section className="section" id="governance">
        <div className="shell claim">
          <div className="claim__copy">
            <span className="eyebrow">01 — Server-enforced governance</span>
            <SplitHeadline as="h2" className="section__title" onScroll>
              The orchestrator decides, not the agent.
            </SplitHeadline>

            <Reveal delay={0.1}>
              <p className="lede">
                One function writes <code>specs.status</code>, and a lint rule fails the build if
                anything else tries. Agents write proposal artifacts. Humans record decisions.
                Neither moves a spec.
              </p>
            </Reveal>

            <Reveal className="points" stagger={0.1} delay={0.15}>
              <div className="point">
                <h3 className="point__title">Approvals bind to bytes</h3>
                <p className="point__body">
                  An approval references a SHA-256 of the artifact. Artifact versions are immutable
                  at the database level, so editing one produces a new version with a new hash — and
                  the stale approval no longer matches.
                </p>
              </div>
              <div className="point">
                <h3 className="point__title">No agent may approve</h3>
                <p className="point__body">
                  Approval edges in the transition table admit only{' '}
                  <code>actor.type === &apos;human&apos;</code>, and the HTTP layer hard-codes
                  callers to human. An agent cannot reach the edge, and a caller cannot claim to be
                  one.
                </p>
              </div>
              <div className="point">
                <h3 className="point__title">History is append-only</h3>
                <p className="point__body">
                  Database triggers refuse <code>UPDATE</code> on the audit log unconditionally, and
                  refuse <code>DELETE</code> while the spec exists. History cannot be edited or
                  thinned — only removed wholesale with the spec.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal className="claim__visual" y={30}>
            <div className="terminal">
              <div className="terminal__bar">
                <span className="terminal__dot" />
                <span className="terminal__title mono">approve a stale hash</span>
              </div>
              <pre className="terminal__body">
                <code>
                  {`$ curl -XPOST .../artifacts/design/approve \\
    -d '{"content_hash":"edc324ed24f2"}'

HTTP/1.1 409 Conflict
{
  "error": {
    "code": "HASH_MISMATCH",
    "message": "the approved hash no longer
      matches the latest artifact version",
    "correlation_id": "corr_7Kp2…"
  }
}

# state unchanged. no audit row written.`}
                </code>
              </pre>
            </div>

            <div className="terminal terminal--deny">
              <div className="terminal__bar">
                <span className="terminal__dot terminal__dot--warn" />
                <span className="terminal__title mono">PreToolUse hook</span>
              </div>
              <pre className="terminal__body">
                <code>
                  {`$ claude -p "edit invoice.ts"

{ "permissionDecision": "deny",
  "reason": "spec is in DESIGN_DRAFTING;
    edits need READY_FOR_IMPLEMENTATION
    or IMPLEMENTING, and a claimed task" }`}
                </code>
              </pre>
              <p className="terminal__note">
                Denied in all eight pre-release states, and fails closed on any internal error.
                Tested as a real subprocess, not in-process.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------- claim 2: evidence */}
      <section className="section section--inverse" id="evidence">
        <div className="shell claim claim--reverse">
          <div className="claim__copy">
            <span className="eyebrow">02 — Evidence-checked brownfield specs</span>
            <SplitHeadline as="h2" className="section__title" onScroll>
              Every claim about your code gets checked.
            </SplitHeadline>

            <Reveal delay={0.1}>
              <p className="lede">
                A model exploring an unfamiliar repository will describe code that is not there. So
                each claim must cite a file and an inclusive line range, and deterministic code then
                reads the file, checks the range is real, and confirms the symbol actually appears
                inside it.
              </p>
            </Reveal>

            <Reveal className="points" stagger={0.1} delay={0.15}>
              <div className="point">
                <h3 className="point__title">Failures are kept, not dropped</h3>
                <p className="point__body">
                  An unverified claim stays in the record with its failure reason, because the{' '}
                  <em>unverified-claim rate</em> needs its denominator. Discarding failures would
                  turn a hallucination metric into a flattering one.
                </p>
              </div>
              <div className="point">
                <h3 className="point__title">The verifier cannot be argued with</h3>
                <p className="point__body">
                  It is plain code with no model in it. Repository content is treated as data, file
                  tools are confined to the repo root, and a hostile <code>CLAUDE.md</code> inside a
                  scanned repo has no authority.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal className="claim__visual" y={30}>
            <div className="scoreboard">
              <div className="scoreboard__head">
                <span className="eyebrow">One live scan, this repository</span>
              </div>
              <div className="scoreboard__big">
                <Counter className="tabular" value={11.1} decimals={1} suffix="%" />
                <span className="scoreboard__label">unverified-claim rate</span>
              </div>
              <dl className="scoreboard__rows">
                <div>
                  <dt>claims made</dt>
                  <dd className="tabular">9</dd>
                </div>
                <div>
                  <dt>verified</dt>
                  <dd className="tabular">8</dd>
                </div>
                <div>
                  <dt>tool calls used</dt>
                  <dd className="tabular">15 of 25</dd>
                </div>
                <div>
                  <dt>cost</dt>
                  <dd className="tabular">$0.0133</dd>
                </div>
              </dl>
              <p className="scoreboard__note">
                A single run against one repository, not an average. The adversarial verifier suite
                — invented files, off-by-one ranges, symlink escapes, CRLF, binaries — is what holds
                the mechanism to its claim.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* -------------------------------------------- claim 3: compliance */}
      <section className="section" id="compliance">
        <div className="shell claim">
          <div className="claim__copy">
            <span className="eyebrow">03 — Compliance as acceptance criteria</span>
            <SplitHeadline as="h2" className="section__title" onScroll>
              Rules that arrive as tests, not as a PDF.
            </SplitHeadline>

            <Reveal delay={0.1}>
              <p className="lede">
                A versioned GST and TDS rule pack injects testable Given/When/Then criteria into the
                requirements, then traces each one through to a task and a test. Coverage is
                reported as a number, and a rule that stops at a requirement counts as a gap.
              </p>
            </Reveal>

            <Reveal className="points" stagger={0.1} delay={0.15}>
              <div className="point">
                <h3 className="point__title">Superseded law is caught</h3>
                <p className="point__body">
                  A design citing Section 194J reads perfectly and would pass any human skim — but
                  the 194-series was dissolved on 1 April 2026. The pack rejects it and maps it to
                  Section 393.
                </p>
              </div>
              <div className="point">
                <h3 className="point__title">Disagreements stay disclosed</h3>
                <p className="point__body">
                  Where sources conflict on a threshold or a payment code, the conflict is recorded
                  on the rule and asserted by a test, so it cannot be quietly tidied away.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal className="claim__visual" y={30}>
            <ol className="trace">
              {[
                { tag: 'rule', value: 'GST-003', note: 'Invoice numbering, CGST Rule 46(b)' },
                {
                  tag: 'requirement',
                  value: 'REQ-007',
                  note: 'Gap-free series per financial year',
                },
                { tag: 'criterion', value: 'AC-013', note: 'Two concurrent finalisations' },
                { tag: 'design', value: 'DES-003', note: 'Counter row locked in transaction' },
                { tag: 'task', value: 'TASK-004', note: 'Allocate from per-year counter' },
                { tag: 'test', value: 'numbering.test.ts', note: 'Asserts no gap, no reuse' },
              ].map((step) => (
                <li className="trace__step" key={step.value}>
                  <span className="trace__tag">{step.tag}</span>
                  <span className="trace__value mono">{step.value}</span>
                  <span className="trace__note">{step.note}</span>
                </li>
              ))}
            </ol>
            <p className="trace__foot">
              Fifteen rules, versioned. Not reviewed by a tax professional — confirm every rate and
              code against the CBDT portal before real use.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------- measured */}
      <section className="section section--measured" id="measured">
        <div className="shell">
          <Reveal className="stack" stagger={0.1}>
            <span className="eyebrow">Measured, not estimated</span>
            <h2 className="section__title">
              Every figure here comes from the database, not a projection.
            </h2>
            <p className="lede">
              Each model call is recorded with its token and cache counters. The cost model is
              itself re-verified on every smoke run against the gateway&apos;s own reported figure —
              currently a 0.00% difference.
            </p>
          </Reveal>

          <Reveal className="stats" stagger={0.08} delay={0.1}>
            <div className="stat">
              <span className="stat__value tabular">
                $<Counter value={0.0186} decimals={4} />
              </span>
              <span className="stat__label">per greenfield feature</span>
              <span className="stat__note">16 requirements, 11 design sections, 2 calls</span>
            </div>
            <div className="stat">
              <span className="stat__value tabular">
                <Counter value={817} />
              </span>
              <span className="stat__label">tests, CI green</span>
              <span className="stat__note">
                including all 225 ordered state pairs, legal and illegal
              </span>
            </div>
            <div className="stat">
              <span className="stat__value tabular">
                <Counter value={15} /> of <Counter value={25} />
              </span>
              <span className="stat__label">tool calls on a real scan</span>
              <span className="stat__note">budget enforced server-side, not suggested</span>
            </div>
            <div className="stat">
              <span className="stat__value tabular">
                <Counter value={0.344} decimals={3} />
              </span>
              <span className="stat__label">recall@10, lexical index</span>
              <span className="stat__note">
                against 0.022 for grep — 15 commits, TypeScript repo
              </span>
            </div>
          </Reveal>

          <Reveal className="ablation" y={24} delay={0.15}>
            <table className="table">
              <caption className="table__caption">
                Retrieval ablation. Recall@10 against the files 15 mined feature commits actually
                modified, scored against the parent commit so the feature&apos;s own files do not
                exist yet.
              </caption>
              <thead>
                <tr>
                  <th scope="col">arm</th>
                  <th scope="col">execa (TypeScript)</th>
                  <th scope="col">requests (Python)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { arm: 'grep', ts: '0.022', py: '0.556' },
                  { arm: 'repo map', ts: '0.117', py: '0.565' },
                  { arm: 'FTS5', ts: '0.344', py: '0.474', best: 'ts' },
                  { arm: 'FTS5 + repo map', ts: '0.233', py: '0.598', best: 'py' },
                ].map((row) => (
                  <tr key={row.arm}>
                    <th scope="row" className="mono">
                      {row.arm}
                    </th>
                    <td className={`tabular${row.best === 'ts' ? ' is-best' : ''}`}>{row.ts}</td>
                    <td className={`tabular${row.best === 'py' ? ' is-best' : ''}`}>{row.py}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ablation__note">
              The lexical index is worth 15× grep on one repository and less than grep on the other,
              and the fused arm wins on one and loses on the other. Reported as found — the most
              elaborate arm is not the best arm everywhere.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------ cta */}
      <section className="cta">
        <div className="shell cta__inner">
          <SplitHeadline as="h2" className="cta__title" onScroll>
            Start with a feature request.
          </SplitHeadline>
          <Reveal delay={0.15} y={18}>
            <p className="lede cta__lede">
              Point it at a repository, or start from nothing. The gates are the same either way.
            </p>
          </Reveal>
          <Reveal className="cta__actions" delay={0.25} y={14}>
            <Link className="btn btn--accent" href="/sign-up">
              Create an account
            </Link>
            <Link className="btn btn--ghost" href="/sign-in">
              Sign in
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  );
}
