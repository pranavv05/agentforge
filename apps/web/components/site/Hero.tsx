'use client';
import { useEffect, useRef } from 'react';
import { LogoMark, BRAND } from './Logo';
import { Split } from './Split';
import { useSignedIn } from './use-signed-in';

const Marquee = ({
  items,
  cls = '',
  link = false,
}: {
  items: string[];
  cls?: string;
  link?: boolean;
}) => (
  <div className={'mq ' + cls} data-copies="2">
    <div className="mq-track">
      {[0, 1].map((c) =>
        items.map((w) =>
          link ? (
            <a
              key={String(c) + w}
              href="/#compare"
              aria-hidden={c ? 'true' : undefined}
              tabIndex={c ? -1 : undefined}
            >
              {w}
            </a>
          ) : (
            <span key={String(c) + w} aria-hidden={c ? 'true' : undefined}>
              {w}
            </span>
          ),
        ),
      )}
    </div>
  </div>
);
export { Marquee };

/** Hero background: a constellation of agents with message packets that reacts to the pointer. */
function AgentField({ host }: { host: React.RefObject<HTMLElement | null> }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const hero = host.current,
      c = cv.current;
    if (!hero || !c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = c.getContext('2d');
    // Null when the canvas already has a context of another type, or when the
    // browser refuses one. The decoration simply does not run.
    if (ctx === null) return;
    let W = 0,
      H = 0,
      mx = -999,
      my = -999,
      vis = true,
      last = 0,
      spawn = 0,
      raf = 0;
    interface P {
      x: number;
      y: number;
      vx: number;
      vy: number;
      c: string;
      r: number;
    }
    interface Pk {
      a: P;
      b: P;
      t: number;
      c: string;
    }
    let pts: P[] = [];
    const pks: Pk[] = [];
    const COLS = ['122,177,254', '122,177,254', '139,123,255', '52,211,153'] as const;
    // Indexing by a computed number is `| undefined` under noUncheckedIndexedAccess.
    // COLS is a tuple, so element 0 is known to exist and closes the gap honestly.
    const colour = (i: number): string => COLS[i % COLS.length] ?? COLS[0];
    const LINK = 130;
    const size = () => {
      const r = hero.getBoundingClientRect(),
        dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      c.width = W * dpr;
      c.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.max(14, Math.min(48, W / 28)));
      pts = Array.from({ length: n }, (_, i) => ({
        x: Math.random() * W,
        y: Math.random() * H * 0.85,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        c: colour(i),
        r: 1.6 + Math.random() * 2.2,
      }));
    };
    size();
    const onMove = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
    };
    const onLeave = () => {
      mx = my = -999;
    };
    addEventListener('resize', size);
    hero.addEventListener('pointermove', onMove, { passive: true });
    hero.addEventListener('pointerleave', onLeave);
    const io = new IntersectionObserver((es) => {
      vis = es[0]?.isIntersecting ?? false;
    });
    io.observe(hero);
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (!vis || document.hidden) return;
      const dt = Math.min(40, t - last || 16);
      last = t;
      const k = dt / 16;
      ctx.clearRect(0, 0, W, H);
      for (const p of pts) {
        p.x += p.vx * k;
        p.y += p.vy * k;
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H * 0.85;
        if (p.y > H * 0.85 + 10) p.y = -10;
        const dx = mx - p.x,
          dy = my - p.y,
          d2 = dx * dx + dy * dy;
        if (d2 < 22000) {
          const f = (1 - d2 / 22000) * 0.02 * k;
          p.x += dx * f;
          p.y += dy * f;
        }
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p === undefined) continue;
        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j];
          if (q === undefined) continue;
          const ax = p.x - q.x,
            ay = p.y - q.y,
            d = ax * ax + ay * ay;
          if (d < LINK * LINK) {
            ctx.strokeStyle = `rgba(${p.c},${(0.3 * (1 - Math.sqrt(d) / LINK)).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
        const cx = mx - p.x,
          cy = my - p.y,
          cd = Math.sqrt(cx * cx + cy * cy);
        if (cd < 170) {
          ctx.strokeStyle = `rgba(47,111,228,${(0.45 * (1 - cd / 170)).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mx, my);
          ctx.stroke();
        }
      }
      for (const p of pts) {
        ctx.fillStyle = `rgba(${p.c},.9)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }
      spawn -= dt;
      if (spawn <= 0 && pks.length < 7) {
        spawn = 260 + Math.random() * 380;
        for (let tries = 0; tries < 12; tries++) {
          const a = pts[(Math.random() * pts.length) | 0],
            b = pts[(Math.random() * pts.length) | 0];
          if (a === undefined || b === undefined || a === b) continue;
          const ex = a.x - b.x,
            ey = a.y - b.y;
          if (ex * ex + ey * ey < LINK * LINK) {
            pks.push({ a, b, t: 0, c: a.c });
            break;
          }
        }
      }
      for (let i = pks.length - 1; i >= 0; i--) {
        const pk = pks[i];
        if (pk === undefined) continue;
        pk.t += dt / 700;
        if (pk.t >= 1) {
          pks.splice(i, 1);
          continue;
        }
        const x = pk.a.x + (pk.b.x - pk.a.x) * pk.t,
          y = pk.a.y + (pk.b.y - pk.a.y) * pk.t;
        ctx.fillStyle = `rgba(${pk.c},.28)`;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.95)';
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, 6.2832);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', size);
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerleave', onLeave);
      io.disconnect();
    };
  }, [host]);
  return <canvas id="agent-field" ref={cv} aria-hidden="true" />;
}

/** An AI cursor that roams the hero dashboard and "clicks" through it. */
function AgentCursor({ stage }: { stage: React.RefObject<HTMLElement | null> }) {
  const cur = useRef<HTMLDivElement>(null);
  const lab = useRef<HTMLElement>(null);
  const lb = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const st = stage.current,
      c = cur.current;
    if (!st || !c || matchMedia('(prefers-reduced-motion: reduce)').matches || innerWidth < 700) {
      return;
    }
    const plan = [
      {
        sel: '.hs-win .side a:nth-of-type(3)',
        who: 'Context agent',
        say: 'reading acme-erp\u2026',
      },
      { sel: '.hs-kpis a:nth-child(2)', who: 'Verifier', say: '92% of claims verified' },
      { sel: '.fchip.c1', who: 'Verifier', say: 'tds.ts:L9-17 \u2713' },
      {
        sel: '.hs-win tr[data-href]:nth-of-type(1)',
        who: 'Requirements agent',
        say: 'draft ready for review',
      },
      { sel: '.fchip.c2', who: 'Orchestrator', say: 'holding the edit at the gate' },
      {
        sel: '.hs-win tr[data-href]:nth-of-type(2)',
        who: 'Tasks agent',
        say: '6 tasks, all traced',
      },
      { sel: '.fchip.c3', who: 'Orchestrator', say: 'approval bound to a hash' },
    ];
    let i = 0,
      vis = true,
      hot: Element | null = null,
      timer: ReturnType<typeof setTimeout>;
    /**
     * Whether this effect is still mounted.
     *
     * Read through a function rather than as a variable or a property: once the first
     * `if` narrows it, TypeScript keeps that narrowing across the `await`s below and
     * decides the later checks can never fire. They can — the cleanup runs on unmount
     * while this loop is sleeping — and a call's result is not narrowed that way.
     */
    let stopped = false;
    const isStopped = (): boolean => stopped;
    const io = new IntersectionObserver((es) => {
      vis = es[0]?.isIntersecting ?? false;
    });
    io.observe(st);
    const sleep = (ms: number) =>
      new Promise<void>((r) => {
        timer = setTimeout(r, ms);
      });
    const step = async () => {
      if (isStopped()) return;
      if (!vis || document.hidden) {
        timer = setTimeout(() => void step(), 700);
        return;
      }
      const p = plan[i++ % plan.length];
      if (p === undefined) {
        timer = setTimeout(() => void step(), 400);
        return;
      }
      const t = st.querySelector(p.sel) ?? document.querySelector(p.sel);
      if (!t) {
        timer = setTimeout(() => void step(), 400);
        return;
      }
      const s = st.getBoundingClientRect(),
        r = t.getBoundingClientRect();
      c.style.transform = `translate(${(r.left - s.left + Math.min(r.width * 0.55, r.width - 14)).toFixed(1)}px,${(r.top - s.top + r.height * 0.55).toFixed(1)}px)`;
      if (lab.current) lab.current.textContent = p.who;
      lb.current?.classList.remove('say');
      await sleep(1250);
      if (isStopped()) return;
      hot?.classList.remove('hot');
      t.classList.add('hot');
      hot = t;
      c.classList.remove('click');
      // Forces a reflow, so removing and re-adding the class restarts the animation
      // instead of the two being coalesced into no change at all.
      void c.getBoundingClientRect();
      c.classList.add('click');
      if (lab.current) lab.current.textContent = p.say;
      lb.current?.classList.add('say');
      await sleep(1900);
      void step();
    };
    c.style.transform = 'translate(40px,30px)';
    timer = setTimeout(() => void step(), 1600);
    return () => {
      stopped = true;
      clearTimeout(timer);
      io.disconnect();
      hot?.classList.remove('hot');
    };
  }, [stage]);
  return (
    <div className="agent-cursor" ref={cur} aria-hidden="true">
      <span className="rp" />
      <svg width="24" height="24" viewBox="0 0 24 24">
        <path
          d="M3.5 2.5l7.2 19 3.1-8.1 8.1-3.1z"
          fill="#0b1220"
          stroke="#fff"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
      <span className="lb" ref={lb}>
        <i />
        <em ref={lab}>Context agent</em>
      </span>
    </div>
  );
}

export function Hero() {
  const signedIn = useSignedIn();
  const hero = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  return (
    <>
      <div id="sp" aria-hidden="true" />
      <div className="cursor-glow" aria-hidden="true" />
      <section className="hero" id="hero" ref={hero}>
        <AgentField host={hero} />
        <i className="orb o1" data-speed="-0.22" aria-hidden="true" />
        <i className="orb o2" data-speed="-0.38" aria-hidden="true" />
        <div className="wrap">
          <div className="hero-copy">
            <a className="badge" href="/docs/concepts">
              <em>New</em> Verifiable grounding + compliance traceability{' '}
              <i className="fa-solid fa-arrow-right" style={{ fontSize: 11 }} />
            </a>
            <Split
              as="h1"
              className="display"
              now
              lines={[['A spec pipeline'], ['that ', { hl: 'proves its claims.' }]]}
            />
            <p className="lead">
              {BRAND} turns a feature request into requirements, design and tasks. Every statement
              about your codebase is checked against a real <code>file:line</code>. Every approval
              is enforced by the server, not by trust.
            </p>
            <div className="cta-row">
              {signedIn ? (
                <a className="btn dark mag" href="/workspace">
                  Open dashboard <i className="fa-solid fa-arrow-right" />
                </a>
              ) : (
                <a className="btn dark mag" href="/sign-up">
                  <i className="fa-solid fa-user-plus" /> Get started free
                </a>
              )}
              <a className="btn mag" href="/docs">
                <i className="fa-solid fa-book-open" /> Read the docs
              </a>
            </div>
          </div>

          <div className="hero-stage" id="hero-stage" ref={stage}>
            <a className="fchip c1" href="#modes" data-speed="-0.14">
              <i className="fa-solid fa-circle-check" /> Claim verified <code>tds.ts:L9-17</code>
            </a>
            <a className="fchip c2 bad" href="/docs/concepts#edit-hook" data-speed="-0.3">
              <i className="fa-solid fa-hand" /> Edit held at the gate &middot;{' '}
              <code>REQ_AWAITING_APPROVAL</code>
            </a>
            <a className="fchip c3" href="/docs/concepts#approvals" data-speed="-0.2">
              <i className="fa-solid fa-fingerprint" /> Approved &middot; sha256{' '}
              <code>9f3a1c7e</code>
            </a>
            <div className="win hs-win">
              <div className="win-bar">
                <i className="dot" />
                <i className="dot" />
                <i className="dot" />
              </div>
              <div className="win-body">
                <aside className="side">
                  <div className="brand">
                    <LogoMark size={20} />
                    {BRAND}
                  </div>
                  <a className="on" href="/sign-up">
                    Overview
                  </a>
                  <a href="/sign-up">Specs</a>
                  <a href="/sign-up">New spec</a>
                  <small>Evidence</small>
                  <a href="/docs/grounding-compliance#grounding-verifier">Grounding</a>
                  <a href="/product/compliance">Compliance pack</a>
                  <small>Help</small>
                  <a href="/docs">Documentation</a>
                </aside>
                <div className="pane">
                  <div className="row">
                    <h4 style={{ margin: 0 }}>Welcome back, Asha</h4>
                    <span className="sp" />
                    <a className="tag acc" href="/sign-up">
                      2 waiting on you
                    </a>
                  </div>
                  <div className="hs-kpis">
                    <a href="/docs/quickstart">
                      <small>Specs</small>
                      <b data-count="3">3</b>
                    </a>
                    <a href="/docs/grounding-compliance#grounding-verifier">
                      <small>Claims verified</small>
                      <b data-count="92" data-suffix="%">
                        92%
                      </b>
                    </a>
                    <a href="/product/compliance">
                      <small>Rules traced</small>
                      <b data-count="5" data-suffix=" of 5">
                        5 of 5
                      </b>
                    </a>
                    <a href="/docs/development#measured-not-estimated">
                      <small>Spend</small>
                      <b>$0.0186</b>
                    </a>
                  </div>
                  <table className="tbl-m">
                    <tbody>
                      <tr>
                        <th>Spec</th>
                        <th>Mode</th>
                        <th>Status</th>
                      </tr>
                      <tr data-href="/sign-up">
                        <td>
                          <b>TDS on vendor payments</b>
                          <br />
                          <code>SPEC-A41F</code>
                        </td>
                        <td>Brownfield</td>
                        <td>
                          <span className="tag warn">Requirements: approve?</span>
                        </td>
                      </tr>
                      <tr data-href="/sign-up">
                        <td>
                          <b>GST e-invoice IRN capture</b>
                          <br />
                          <code>SPEC-7C20</code>
                        </td>
                        <td>Brownfield</td>
                        <td>
                          <span className="tag ok">Ready to implement</span>
                        </td>
                      </tr>
                      <tr data-href="/sign-up">
                        <td>
                          <b>Monthly ledger export</b>
                          <br />
                          <code>SPEC-19BD</code>
                        </td>
                        <td>Greenfield</td>
                        <td>
                          <span className="tag acc">Drafting design</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <AgentCursor stage={stage} />
          </div>

          <p className="trust">Borrows the best of</p>
          <Marquee
            items={['Spec Kit', 'OpenSpec', 'Kiro', 'Claude Code', 'MCP', 'Aider repo map']}
            cls="logos-mq"
            link
          />
        </div>
      </section>
    </>
  );
}
