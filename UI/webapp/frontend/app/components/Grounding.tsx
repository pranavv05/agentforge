'use client'
import { useEffect, useState } from 'react'
import { postJson } from '../lib/api'
import { hl } from '../lib/highlight'

type Sample = { id: number; label: string; file: string; line_start: number; line_end: number; symbol: string }
type Res = { sample: Sample; verdict: { ok: boolean; reason?: string }; excerpt: string | null; explain: { why: string; fix: string } | null }

const TITLES: Record<string, string> = {
  file_not_found: 'Caught: that file does not exist',
  range_invalid: 'Caught: those lines do not exist',
  symbol_not_in_range: 'Caught: wrong place in the file',
}
const REASONS: Record<string, string> = {
  file_not_found: 'The agent cited a file that is not in the repository.',
  range_invalid: 'The agent cited lines past the end of the file (or a backwards range).',
  symbol_not_in_range: 'The file and lines are real, but the named function is not in them.',
}

export function Grounding() {
  const [samples, setSamples] = useState<Sample[] | null>(null)
  const [err, setErr] = useState(false)
  const [sel, setSel] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Res | null>(null)
  const [seen, setSeen] = useState<Record<number, boolean>>({})

  useEffect(() => {
    fetch('/api/public/samples').then((r) => r.json()).then((d) => setSamples(d.samples)).catch(() => setErr(true))
  }, [])

  const verify = async (s: Sample) => {
    setSel(s.id); setBusy(true); setRes(null)
    const d = await postJson<Res | null>('/api/public/verify', { id: s.id }, null)
    setBusy(false)
    if (!d) return setErr(true)
    setRes(d)
    setSeen((m) => (s.id in m ? m : { ...m, [s.id]: d.verdict.ok }))
  }
  const ok = Object.values(seen).filter(Boolean).length
  const cg = Object.values(seen).filter((v) => !v).length

  return (
    <div className="split rv">
      <div className="panel">
        <div className="row"><h3>Agent claims</h3><span className="sp" /><span className="live">live check</span></div>
        <p className="hint">Click a claim to check it against <code>acme-erp</code>.</p>
        <div className="samples">
          {err && !samples && <div className="verdict bad">Could not load claims.</div>}
          {!samples && !err && <div className="verdict idle">Loading claims…</div>}
          {samples?.map((s) => {
            const done = s.id in seen
            return (
              <button key={s.id} className={'sample' + (sel === s.id ? ' on' : '') + (done && !seen[s.id] ? ' caught-s' : '')} onClick={() => verify(s)}>
                <i className={done ? (seen[s.id] ? 'fa-solid fa-circle-check' : 'fa-solid fa-shield-halved') : 'fa-regular fa-circle-question'}
                  style={{ color: done ? (seen[s.id] ? 'var(--ok)' : '#0b1220') : 'var(--mute2)' }} />
                <span>{s.label}<br /><code>{s.file}:L{s.line_start}-L{s.line_end}</code></span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="panel">
        <h3>Verifier result</h3>
        <p className="hint">Path exists, line range valid, symbol present in range.</p>
        {busy && <div className="verdict idle">Checking…</div>}
        {!busy && !res && <div className="verdict idle">Select a claim on the left.</div>}
        {!busy && res && res.verdict.ok && (
          <div className="verdict ok">
            <b className="ct"><i className="fa-solid fa-circle-check" style={{ color: 'var(--ok)' }} /> Verified</b>
            <p className="why" style={{ margin: '6px 0 0', fontSize: 13.5 }}>The file exists, lines {res.sample.line_start}&ndash;{res.sample.line_end} are real and <code>{res.sample.symbol}</code> appears inside them. Safe to keep in the design.</p>
          </div>
        )}
        {!busy && res && !res.verdict.ok && (
          <div className="verdict caught">
            <b className="ct"><i className="fa-solid fa-shield-halved" /> {TITLES[res.verdict.reason || ''] || 'Caught'} <span className="tag caught" style={{ marginLeft: 4 }}>{res.verdict.reason}</span></b>
            <p className="why">{res.explain?.why || REASONS[res.verdict.reason || '']}</p>
            {res.explain && <p className="fix"><b>Fix:</b> {res.explain.fix}</p>}
            <p className="why" style={{ fontSize: 12.5, color: 'var(--mute)' }}>This claim is dropped before design approval, so nobody signs off on something false.</p>
          </div>
        )}
        {!busy && res?.excerpt && (
          <pre className="code">{res.excerpt.split('\n').map((l, i) => <div key={i}><span className="ln">{res.sample.line_start + i}</span>{hl(l)}</div>)}</pre>
        )}
        {!busy && res && !res.excerpt && !res.verdict.ok && (
          <pre className="code"><span className="ln">!</span>{res.sample.file} is not in the repository</pre>
        )}
        <div className="tally"><span><b>{ok}</b> verified</span><span><b>{cg}</b> caught before approval</span></div>
      </div>
    </div>
  )
}
