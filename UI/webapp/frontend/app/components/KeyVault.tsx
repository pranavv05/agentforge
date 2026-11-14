'use client'
import { useMemo, useState } from 'react'

/* Bring your own key: deliberately small. Paste a key, see it is recognised, continue.
   The check runs in the browser only. Nothing is sent or stored from this page. */

const STEPS = [
  ['Create a key', 'Make an API key in your Claude console. A dedicated one for AgentForge is best.'],
  ['Paste it here', 'Add it in your workspace. It is stored encrypted and never shown again.'],
  ['Start building', 'Run specs on your own account. That is all the setup there is.'],
] as const

type Verdict = { kind: 'idle' } | { kind: 'ok' } | { kind: 'bad'; msg: string }

function judge(raw: string): Verdict {
  const k = raw.trim()
  if (!k) return { kind: 'idle' }
  if (/^sk-ant-/.test(k)) return { kind: 'ok' }
  if (/^sk-/.test(k) || /^AIza/.test(k) || /^gsk_/.test(k)) return { kind: 'bad', msg: 'That looks like a different provider\u2019s key. Only Claude keys work for now.' }
  return { kind: 'bad', msg: 'That does not look like an API key. Claude keys start with sk-ant-.' }
}

export function KeyVault() {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const v = useMemo(() => judge(key), [key])

  return (
    <div className="kb rv">
      <section className="kb-card" aria-labelledby="kb-h">
        <h3 id="kb-h">Connect your API key</h3>
        <p className="kb-hint">Paste your Claude API key to get started.</p>

        <div className={'kb-field ' + v.kind}>
          <i className="fa-solid fa-key lead" aria-hidden="true" />
          <label className="sr" htmlFor="kb-in">Claude API key</label>
          <input id="kb-in" type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)}
            autoComplete="off" spellCheck={false} placeholder="sk-ant-..." aria-describedby="kb-out" />
          <button type="button" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow((s) => !s)}>
            <i className={'fa-solid ' + (show ? 'fa-eye-slash' : 'fa-eye')} />
          </button>
        </div>

        <div id="kb-out" className={'kb-status ' + v.kind} aria-live="polite">
          {v.kind === 'idle' && <><i className="fa-solid fa-lock" /> Checked in your browser only. Never sent from this page.</>}
          {v.kind === 'ok' && <><i className="fa-solid fa-circle-check" /> Looks like a valid Claude key.</>}
          {v.kind === 'bad' && <><i className="fa-solid fa-circle-exclamation" /> {v.msg}</>}
        </div>

        <a className="btn dark kb-go" href="/signup">Continue <i className="fa-solid fa-arrow-right" /></a>
      </section>

      <ol className="kb-steps">
        {STEPS.map(([t, p], i) => (
          <li key={t}><span className="kb-n">{i + 1}</span><div><b>{t}</b><p>{p}</p></div></li>
        ))}
      </ol>
    </div>
  )
}
