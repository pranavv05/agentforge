'use client'
import { useState } from 'react'

export function Lint() {
  const [t, setT] = useState('Deduct TDS under Section 194J for professional fees and Section 194C for contractors.')
  const hits = Array.from(t.matchAll(/\b194[A-Z]{0,2}\b/g)).map((m) => m[0])
  return (
    <div className="panel">
      <label className="sr" htmlFor="lint-in">Design text</label>
      <textarea className="in" id="lint-in" value={t} onChange={(e) => setT(e.target.value)} />
      <div style={{ marginTop: 12 }}>
        {!t.trim() ? <div className="verdict idle">Result appears here.</div>
          : !hits.length ? <div className="verdict ok"><b><i className="fa-solid fa-circle-check" style={{ color: 'var(--ok)' }} /> No legacy sections found.</b></div>
          : (
            <div className="verdict caught">
              <b className="ct"><i className="fa-solid fa-shield-halved" /> Caught: {hits.map((h, i) => <mark key={i} className="bad" style={{ marginRight: 6 }}>Section {h}</mark>)}</b><br />
              Map to a Section 393 row: technical fees 2% (code 1026), professional fees 10% (code 1027), contractors 1% or 2%.
            </div>
          )}
      </div>
    </div>
  )
}
