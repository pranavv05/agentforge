'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LogoMark, BRAND } from './Logo'

const Held = ({ children }: { children: React.ReactNode }) => <span className="tag caught"><i className="fa-solid fa-shield-halved" /> {children}</span>
const Okay = ({ children }: { children: React.ReactNode }) => <span className="tag ok"><i className="fa-solid fa-check" /> {children}</span>

const PANES = [
  {
    url: 'agentforge.app/spec/SPEC-A41F',
    body: (
      <>
        <h4>Requirements <span className="tag warn" style={{ marginLeft: 6 }}>awaiting approval</span></h4>
        <div className="mock-card">
          <div className="row"><b>requirements v2</b><span className="sp" /><code style={{ fontSize: 11, color: 'var(--mute)' }}>sha256 9f3a1c7e0b42</code></div>
          <table className="tbl-m" style={{ marginTop: 8 }}><tbody>
            <tr><th>Result</th><th>Actor</th><th>Move</th></tr>
            <tr><td><Okay>allowed</Okay></td><td>orchestrator</td><td>REQ_DRAFTING &rarr; REQ_AWAITING_APPROVAL</td></tr>
            <tr><td><Okay>allowed</Okay></td><td>human</td><td>approve (hash bound)</td></tr>
            <tr><td><Held>held</Held></td><td>agent</td><td>tried REQ_APPROVED &middot; only humans approve</td></tr>
          </tbody></table>
        </div>
        <div className="agent-dock"><div className="hd"><span className="av" />Orchestrator</div><div className="bubble">The agent tried to approve its own draft. The move was held, and the attempt is now in the audit log.</div><div className="step-chip"><b><i className="fa-solid fa-shield-halved" style={{ fontSize: 9 }} /></b>guardrail working as designed</div></div>
      </>
    ),
  },
  {
    url: 'agentforge.app/spec/SPEC-A41F/design',
    body: (
      <>
        <h4>Design &middot; codebase touchpoints</h4>
        <table className="tbl-m"><tbody>
          <tr><th>Claim</th><th>Evidence</th><th>Check</th></tr>
          <tr><td>computeTds in tds.ts</td><td><code>src/tax/tds.ts:L9-17</code></td><td><Okay>verified</Okay></td></tr>
          <tr><td>payVendor calls computeTds</td><td><code>vendorPayments.ts:L13-18</code></td><td><Okay>verified</Okay></td></tr>
          <tr><td>computeSection393 exists</td><td><code>src/tax/tds393.ts</code></td><td><Held>no such file</Held></td></tr>
          <tr><td>payVendor near line 400</td><td><code>vendorPayments.ts:L400</code></td><td><Held>past end of file</Held></td></tr>
        </tbody></table>
        <div className="agent-dock"><div className="hd"><span className="av" />Verifier</div><div className="bubble">2 of 4 claims checked out. The other 2 were invented, and were stopped before anyone could approve them.</div></div>
      </>
    ),
  },
  {
    url: 'agentforge.app/spec/SPEC-A41F/trace',
    body: (
      <>
        <h4>Traceability <span className="tag v" style={{ marginLeft: 6 }}>pack 2026.11</span></h4>
        <table className="tbl-m"><tbody>
          <tr><th>Rule</th><th>Requirement</th><th>Task</th><th>Test</th></tr>
          {[['TDS-01', 'REQ-003', 'TASK-03'], ['TDS-02', 'REQ-004', 'TASK-04'], ['TDS-03', 'REQ-005', 'TASK-05']].map(([r, q, t]) => (
            <tr key={r}><td>{r}</td><td>{q}</td><td>{t}</td><td><code>T-{q}</code></td></tr>
          ))}
        </tbody></table>
        <div className="agent-dock"><div className="hd"><span className="av" />Compliance lint</div><div className="bubble">Found the retired <code>Section 194J</code> in a draft and remapped it to Section 393, code 1027 (professional fees, 10%).</div><div className="step-chip"><b>3</b>of 3 rules traced</div></div>
      </>
    ),
  },
]

const MODES = [
  { n: '01', h: 'Governed', p: 'Stage transitions are owned by a deterministic orchestrator. Approvals bind to a content hash. An append-only audit log records every step.' },
  { n: '02', h: 'Grounded', p: 'The agent emits claims as structured JSON. Deterministic code checks that the file exists, the range is valid and the symbol is really there.' },
  { n: '03', h: 'Compliant', p: 'A versioned compliance pack injects testable criteria for GST e-invoice and TDS under Section 393, and traces them to tasks and tests.' },
]

export function Modes() {
  const [cur, setCur] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const auto = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => setCur((c) => (c + 1) % 3), 6000)
  }, [])
  useEffect(() => { auto(); return () => { if (timer.current) clearInterval(timer.current) } }, [auto])
  const go = (i: number) => { setCur(i); auto() }
  const sideMap = [0, 1, 0, 2] // Specs, Context, Approvals, Audit

  return (
    <div className="modes rv">
      <div className="mode-list" role="tablist">
        {MODES.map((m, i) => (
          <button key={m.h} className={'mode' + (cur === i ? ' on' : '')} role="tab" aria-selected={cur === i} onClick={() => go(i)}>
            <span className="n">{m.n}</span><h3>{m.h}</h3><p>{m.p}</p><i className="bar" key={cur === i ? 'on' + cur : 'off'} />
          </button>
        ))}
      </div>
      <div className="win" aria-live="polite" data-scrub="tilt">
        <div className="win-bar"><i className="dot" /><i className="dot" /><i className="dot" /><span className="url">{PANES[cur].url}</span></div>
        <div className="win-body">
          <aside className="side">
            <div className="brand"><LogoMark size={20} />{BRAND}</div>
            {['Specs', 'Context', 'Approvals', 'Audit'].map((l, k) => (
              <a key={l} href="#modes" className={sideMap.indexOf(cur) === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(sideMap[k]) }}>{l}</a>
            ))}
            <small>Workspace</small><a href="/product/byok">Your key</a><a href="/docs">Docs</a>
          </aside>
          <div className="pane fade-swap" key={cur}>{PANES[cur].body}</div>
        </div>
      </div>
    </div>
  )
}
