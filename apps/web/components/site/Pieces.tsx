'use client';
import { Split } from './Split';
import { Marquee } from './Hero';
import { LogoMark } from './Logo';
export { LogoMark };

export function SectionHead({
  eyebrow,
  lines,
  sub,
  center = true,
}: {
  eyebrow?: string;
  lines: React.ComponentProps<typeof Split>['lines'];
  sub?: React.ReactNode;
  center?: boolean;
}) {
  return (
    <div className={(center ? 'center ' : '') + 'rv'}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <Split className="t" lines={lines} />
      {sub && <p className="sub">{sub}</p>}
    </div>
  );
}

const BAND = ['Propose', 'Transition', 'Approve', 'Verify', 'Trace', 'Enforce'];

export function Band() {
  return (
    <section className="band" aria-hidden="true">
      <Marquee items={BAND} cls="big" />
      <Marquee items={[...BAND].reverse()} cls="big out rev" />
    </section>
  );
}

export function Manifesto() {
  const text =
    'Documents are a commodity. Enforcement is not. Every approval is bound to a hash, every claim carries a file and a line, and exactly one function is allowed to move a spec.';
  return (
    <section className="s manifesto" id="manifesto">
      <div className="wrap">
        <p className="eyebrow center" style={{ textAlign: 'center' }}>
          The idea
        </p>
        {/* The words are real text, not decoration. They used to be aria-hidden with the
            sentence repeated in an aria-label on the <p> — but a paragraph has no role to
            carry a name, so assistive tech could be left with nothing for the headline
            message. Each word is a span only so the scroll effect can light them up. */}
        <p className="mani" data-words="">
          {text.split(/\s+/).map((w, i, a) => (
            <span key={i}>
              <span className="mw">{w}</span>
              {i < a.length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}

export function Pipeline() {
  return (
    <section className="s alt pin" id="pipeline" data-pin="5">
      <div className="pin-in">
        <div className="wrap">
          <SectionHead
            eyebrow="The pipeline"
            lines={[['Agents propose.'], ['The orchestrator transitions.'], ['Humans approve.']]}
            sub="A database-backed state machine of roughly 300 to 500 lines of TypeScript. Plain rows, optimistic locking, nothing hidden inside a framework."
          />
          <div className="pipe rv" id="pipe">
            <a className="pnode" href="/docs/grounding-compliance#grounding-verifier">
              <span className="tag v">Brownfield only</span>
              <h3>Context</h3>
              <p>Repo map, FTS5, budgeted agentic loop, grounding verifier.</p>
            </a>
            <div className="pgate">
              <i>1</i>
            </div>
            <a className="pnode" href="/docs/quickstart#4-approve-requirements">
              <span className="tag acc">Agent</span>
              <h3>Requirements</h3>
              <p>Clarifying questions, then EARS requirements with acceptance criteria.</p>
            </a>
            <div className="pgate">
              <i>
                <i className="fa-solid fa-user-check" />
              </i>
            </div>
            <a className="pnode" href="/docs/quickstart#5-approve-the-design">
              <span className="tag acc">Agent</span>
              <h3>Design</h3>
              <p>Refuses to start unless the approved requirements hash matches.</p>
            </a>
            <div className="pgate">
              <i>
                <i className="fa-solid fa-user-check" />
              </i>
            </div>
            <a className="pnode" href="/docs/quickstart#6-implement">
              <span className="tag acc">Agent</span>
              <h3>Tasks</h3>
              <p>Each task maps to a requirement and a test id.</p>
            </a>
            <div className="pgate">
              <i>
                <i className="fa-solid fa-lock-open" />
              </i>
            </div>
            <a className="pnode" href="/docs/concepts#edit-hook">
              <span className="tag ok">Claude Code</span>
              <h3>Implement</h3>
              <p>PreToolUse hook denies Edit and Write until the spec is ready.</p>
            </a>
          </div>
          <div className="pipe-prog" aria-hidden="true">
            <i id="pipe-fill" />
          </div>
          <div className="pipe-cap" id="pipe-cap" aria-live="polite" />
          <div className="legend">
            <span>
              <i className="fa-solid fa-user-check" /> Human approval gate, bound to a content hash
            </span>
            <span>
              <i className="fa-solid fa-lock-open" /> Server unlocks the edit hook
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Numbers() {
  const N = [
    [
      '/docs/concepts#the-pipeline',
      15,
      '',
      'lifecycle states',
      'From CREATED to DONE or FAILED. Anything not in the table is illegal.',
    ],
    [
      '/docs/concepts#governance-rule',
      0,
      '',
      'approvals an agent can make',
      'No approval edge admits an agent. The audit log can prove it.',
    ],
    [
      '/docs/errors',
      13,
      '',
      'typed error codes',
      'Every failure is one of a fixed set, each with an HTTP status.',
    ],
    [
      '/docs/concepts#approvals',
      256,
      '-bit',
      'hash on every approval',
      'You can only approve the exact bytes you reviewed.',
    ],
  ] as const;
  return (
    <section className="s numbers" id="numbers">
      <div className="wrap">
        <div className="nums stg" data-stg="">
          {N.map(([href, n, suf, label, p]) => (
            <a className="num spot" href={href} key={label}>
              <b data-count={n} {...(suf ? { 'data-suffix': suf } : {})}>
                {n}
                {suf}
              </b>
              <span>{label}</span>
              <p>{p}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section className="s alt" id="features">
      <div className="wrap">
        <SectionHead
          eyebrow="What is inside"
          lines={[['Everything you need to trust a spec.']]}
          sub="Grounding, approvals, your own model key and compliance, working end to end."
        />
        <div className="bento stg" data-stg="">
          <a className="bcard spot tilt c4" href="/docs/grounding-compliance#grounding-verifier">
            <span className="ic">
              <i className="fa-solid fa-magnifying-glass" />
            </span>
            <h3>Grounded in your code</h3>
            <p>
              A repo map and full-text index seed a budgeted search over your codebase. No vector
              database to keep in sync, so nothing goes stale.
            </p>
            <div className="mini">
              <span className="m">{'// stage 2 trace'}</span>
              <br />
              <span className="k">repo_map</span>(focus=*) <span className="m">→ 14 hits</span>
              <br />
              <span className="k">fts_search</span>(q=&quot;tds vendor payment&quot;){' '}
              <span className="m">→ 5 hits</span>
              <br />
              <span className="k">read</span>(src/tax/tds.ts) <span className="m">→ 1 hit</span>
              <br />
              <span className="m">cap: 25 tool calls · &lt;100K prompt</span>
            </div>
          </a>
          <a className="bcard spot tilt c2" href="/docs/development#measured-not-estimated">
            <span className="ic g">
              <i className="fa-solid fa-coins" />
            </span>
            <h3>Costs you can check</h3>
            <p>
              Every call is recorded with its cache counters. A greenfield feature measured $0.0186
              — from the ledger, not an estimate.
            </p>
          </a>
          <a className="bcard spot tilt c2" href="/docs/concepts#approvals">
            <span className="ic v">
              <i className="fa-solid fa-fingerprint" />
            </span>
            <h3>Hash-bound approvals</h3>
            <p>
              Approve version 3 and only version 3. If the artifact changes, the approval is void.
            </p>
          </a>
          <a className="bcard spot tilt c2" href="/docs/concepts#audit-log">
            <span className="ic o">
              <i className="fa-solid fa-scroll" />
            </span>
            <h3>Append-only audit</h3>
            <p>Database triggers reject any update or delete on the audit log.</p>
          </a>
          <a className="bcard spot tilt c2" href="/docs/concepts#edit-hook">
            <span className="ic">
              <i className="fa-solid fa-plug" />
            </span>
            <h3>Edit hook</h3>
            <p>
              Your coding agent asks the hook before it edits. It answers <code>deny</code> until
              both approvals exist.
            </p>
          </a>
          <a className="bcard spot tilt c3" href="/docs/grounding-compliance#compliance-pack">
            <span className="ic v">
              <i className="fa-solid fa-scale-balanced" />
            </span>
            <h3>Compliance as acceptance criteria</h3>
            <p>
              Section 393 of the Income-tax Act 2025 replaces the 194-series. A design that cites
              &quot;Section 194J&quot; is rejected and remapped.
            </p>
            <div className="mini">
              <div className="kv">
                <span>Technical fees</span>
                <b>2% · code 1026</b>
              </div>
              <div className="kv">
                <span>Professional fees</span>
                <b>10% · code 1027</b>
              </div>
              <div className="kv">
                <span>Contractor (individual)</span>
                <b>1%</b>
              </div>
              <div className="kv">
                <span>Contractor (other)</span>
                <b>2%</b>
              </div>
            </div>
          </a>
          <a className="bcard spot tilt c3" href="/docs/concepts#hindi-and-hinglish-input">
            <span className="ic g">
              <i className="fa-solid fa-language" />
            </span>
            <h3>Vernacular in, English out</h3>
            <p>
              Write requirements in Hindi or Hinglish. Specs come back in English. Input-only, by
              design.
            </p>
            <div className="mini">
              <span className="m">input</span> &quot;vendor payment par TDS kaato&quot;
              <br />
              <span className="m">output</span>{' '}
              <span className="s">REQ-001 When a vendor is paid, the system shall deduct TDS…</span>
            </div>
          </a>
        </div>
      </div>
    </section>
  );
}

export function Compare() {
  const rows: [string, string, ...[string, string][]][] = [
    [
      'Requirements, design, tasks',
      'Yes',
      ['yes', 'Yes'],
      ['yes', 'Yes'],
      ['yes', 'Yes'],
      ['yes', 'Yes'],
    ],
    [
      'Server-enforced stage transitions',
      'Yes',
      ['no', 'Convention'],
      ['no', 'Convention'],
      ['maybe', 'In the IDE'],
      ['maybe', 'Not verified'],
    ],
    [
      'Hash-bound approvals + audit log',
      'Yes',
      ['no', 'No'],
      ['no', 'No'],
      ['no', 'No'],
      ['no', 'No'],
    ],
    [
      'Machine-verified file:line evidence',
      'Yes',
      ['no', 'No'],
      ['no', 'No'],
      ['no', 'No'],
      ['no', 'No'],
    ],
    [
      'Compliance pack traced to tests',
      'Yes',
      ['no', 'No'],
      ['no', 'No'],
      ['no', 'No'],
      ['no', 'No'],
    ],
    [
      'Blocks edits outside approved state',
      'PreToolUse hook',
      ['no', 'No'],
      ['no', 'No'],
      ['maybe', 'IDE only'],
      ['no', 'No'],
    ],
  ];
  return (
    <section className="s alt" id="compare">
      <div className="wrap">
        <SectionHead
          eyebrow="Landscape"
          lines={[['Documents are a commodity.'], ['Enforcement is not.']]}
          sub="Spec Kit, OpenSpec, BMAD, Kiro and Spec Workflow MCP all produce requirements, design and tasks. Here is what none of them claims."
        />
        <div className="cmp-wrap rv">
          <table className="cmp">
            <thead>
              <tr>
                <th>
                  <span className="sr">Result</span>
                </th>
                <th className="us">AgentForge</th>
                <th>Spec Kit</th>
                <th>OpenSpec</th>
                <th>Kiro</th>
                <th>Spec Workflow MCP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, us, ...rest]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="us yes">{us}</td>
                  {rest.map(([c, t], i) => (
                    <td className={c} key={i}>
                      {t}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td>License</td>
                <td className="us">Your own</td>
                <td>MIT</td>
                <td>MIT</td>
                <td>Proprietary</td>
                <td>GPL-3.0</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="center" style={{ color: 'var(--mute2)', fontSize: 13, marginTop: 14 }}>
          Based on public documentation of each tool. &quot;Not verified&quot; means enforcement
          could not be confirmed.
        </p>
      </div>
    </section>
  );
}

export function Stats() {
  return (
    <section className="s alt">
      <div className="wrap">
        <SectionHead eyebrow="Defend it with numbers" lines={[['Three measurable claims.']]} />
        <div className="stats stg" data-stg="">
          <a className="stat spot" href="/docs/concepts">
            <div className="v">
              Recall
              <br />
              per $
            </div>
            <div className="l">Retrieval strategy ablation</div>
            <p>
              Grep-only vs repo map vs FTS5 plus repo map, scored against git-history ground truth.
            </p>
          </a>
          <a className="stat spot" href="/docs/grounding-compliance#grounding-verifier">
            <div className="v">
              Unverified
              <br />
              rate
            </div>
            <div className="l">Grounding verifier metric</div>
            <p>Share of design claims whose file, range or symbol fails the deterministic check.</p>
          </a>
          <a className="stat spot" href="/docs/grounding-compliance#compliance-pack">
            <div className="v">
              Trace
              <br />
              coverage
            </div>
            <div className="l">Compliance traceability</div>
            <p>Requirement to design to task to test, for every compliance rule that fired.</p>
          </a>
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  const U = { textDecoration: 'underline' } as const;
  return (
    <section className="s" id="faq">
      <div className="wrap">
        <SectionHead eyebrow="FAQ" lines={[['Short answers to good questions.']]} />
        <div className="faq rv">
          <details open>
            <summary>What is AgentForge?</summary>
            <p>
              An agentic spec-driven development platform. It takes a feature request and produces
              requirements, design and tasks, with human approval gates enforced by a server-side
              state machine and every codebase claim verified against real file and line references.
            </p>
          </details>
          <details>
            <summary>Why not just use Spec Kit or Kiro?</summary>
            <p>
              They generate the documents well, and we borrow their templates and ideas. What they
              do not claim is server-enforced governance, mechanically verified evidence and
              compliance traceability. That is the product.
            </p>
          </details>
          <details>
            <summary>Do I need an API key?</summary>
            <p>
              The server needs one. Keys are server configuration, not an account setting, so there
              is nothing to paste here. Two things need no key at all because they are
              deterministic: the repository scan and the retrieval ablation. See{' '}
              <a href="/docs/faq" style={U}>
                the FAQ
              </a>
              .
            </p>
          </details>
          <details>
            <summary>Is this demo calling a real model?</summary>
            <p>
              No. This build simulates agent output deterministically, so no key is needed and
              nothing is billed. The state machine, approvals, hashing, audit log, verifier and
              compliance lint are all real.
            </p>
          </details>
          <details>
            <summary>Which compliance rules are covered?</summary>
            <p>
              A demo pack: GST e-invoice fields, applicability threshold and IRN immutability, plus
              TDS under Section 393. Rates are illustrative and should be verified against the
              official portals before real use.
            </p>
          </details>
          <details>
            <summary>Where do I start?</summary>
            <p>
              Try the{' '}
              <a href="/product/grounding" style={U}>
                grounding verifier
              </a>
              , try the playgrounds under Product, or read the{' '}
              <a href="/docs/quickstart" style={U}>
                quickstart
              </a>
              . When you are ready, sign in to open a workspace.
            </p>
          </details>
        </div>
      </div>
    </section>
  );
}

/** Closing call to action. The old "Try to break the pipeline" button is intentionally gone. */
export function Cta() {
  const ghost = {
    background: 'transparent',
    color: '#fff',
    borderColor: 'rgba(255,255,255,.3)',
  } as const;
  return (
    <section style={{ padding: '0 0 20px' }}>
      <div className="wrap">
        <div className="cta" data-scrub="grow">
          <h2>See it on a real spec.</h2>
          <p>Create an account, or read how it works.</p>
          <div className="cta-row">
            <a className="btn acc mag" id="cta-demo" href="/sign-up">
              <i className="fa-solid fa-play" /> Create an account
            </a>
            <a className="btn" href="/docs" style={ghost}>
              Read the docs
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
