/**
 * Scroll-driven motion engine (TypeScript port of the original scroll.js).
 * One rAF loop, passive listeners, no dependencies. Markup is rendered by React; this only toggles
 * classes / CSS variables, so React never has to reconcile what it changes.
 * Everything is opt-in via the `sj` class on <html>; skipped entirely under prefers-reduced-motion.
 */
type El = HTMLElement

export function initMotion(): () => void {
  const root = document.documentElement
  const cleanups: Array<() => void> = []
  const $ = <T extends El = El>(s: string, r: ParentNode = document) => r.querySelector<T>(s)
  const $$ = <T extends El = El>(s: string, r: ParentNode = document) => Array.from(r.querySelectorAll<T>(s))
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

  /* ---------- simple reveals (always on, even for reduced motion: CSS shows them) ---------- */
  const rvIo = new IntersectionObserver(
    (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rvIo.unobserve(e.target) } }),
    { threshold: 0.12 },
  )
  $$('.rv').forEach((el) => rvIo.observe(el))
  cleanups.push(() => rvIo.disconnect())

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => cleanups.forEach((f) => f())
  root.classList.add('sj')
  cleanups.push(() => root.classList.remove('sj'))

  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches
  let vh = innerHeight
  let vw = innerWidth

  /* ---------- reveal observers for split headings and staggered grids ---------- */
  const io = new IntersectionObserver(
    (es) => es.forEach((e) => {
      if (!e.isIntersecting) return
      const t = e.target as El
      t.classList.add('in'); io.unobserve(t)
      if (t.classList.contains('stg')) setTimeout(() => t.classList.add('done'), 1500)
    }),
    { threshold: 0.15, rootMargin: '0px 0px -6% 0px' },
  )
  cleanups.push(() => io.disconnect())
  $$('[data-split]').forEach((el) => {
    if (el.hasAttribute('data-now')) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')))
    else io.observe(el)
  })
  $$('[data-stg]').forEach((el) => {
    Array.from(el.children).forEach((c, i) => (c as El).style.setProperty('--i', String(i)))
    io.observe(el)
  })

  /* ---------- count-up numbers ---------- */
  const fmt = (el: El, v: number) => {
    el.textContent = (el.dataset.prefix || '') + v.toFixed(+(el.dataset.dec || 0)) + (el.dataset.suffix || '')
  }
  const countUp = (el: El, delay: number) => {
    const to = +(el.dataset.count || 0), dur = 1500
    setTimeout(() => {
      const t0 = performance.now()
      const f = (t: number) => {
        let k = clamp((t - t0) / dur, 0, 1); k = 1 - Math.pow(1 - k, 4)
        fmt(el, to * k); if (k < 1) requestAnimationFrame(f)
      }
      f(t0)
    }, delay)
  }
  const cio = new IntersectionObserver(
    (es) => es.forEach((e) => { if (e.isIntersecting) { countUp(e.target as El, 250); cio.unobserve(e.target) } }),
    { threshold: 0.6 },
  )
  cleanups.push(() => cio.disconnect())
  $$('[data-count]').forEach((el) => { fmt(el, 0); cio.observe(el) })

  /* ---------- marquees that speed up with scroll velocity ---------- */
  type Mq = { m: El; t: El; copies: number; off: number; period: number; vis: boolean; dir: number; base: number }
  const mqs: Mq[] = $$('.mq').map((m) => {
    const t = m.firstElementChild as El
    return {
      m, t, copies: +(m.dataset.copies || 1), off: 0, period: 0, vis: true,
      dir: m.classList.contains('rev') ? -1 : 1, base: m.classList.contains('big') ? 1.1 : 0.45,
    }
  })
  const buildMq = () => mqs.forEach((o) => {
    const gap = parseFloat(getComputedStyle(o.t).columnGap) || 0
    o.period = (o.t.scrollWidth + gap) / o.copies
  })
  buildMq()
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(buildMq)
  const mio = new IntersectionObserver((es) => es.forEach((e) => mqs.forEach((o) => { if (o.m === e.target) o.vis = e.isIntersecting })))
  mqs.forEach((o) => mio.observe(o.m))
  cleanups.push(() => mio.disconnect())

  /* ---------- manifesto words ---------- */
  const mani = $('[data-words]')
  const mw = mani ? $$('.mw', mani) : []

  /* ---------- pinned pipeline ---------- */
  const pin = $('#pipeline'), pipe = $('#pipe'), pnodes = $$('#pipe .pnode'), pgates = $$('#pipe .pgate'),
    fill = $('#pipe-fill'), cap = $('#pipe-cap')
  let capIdx = -1
  const caps = [
    'Context. A repo map and a budgeted search build a bundle of claims. The verifier drops anything it cannot prove. Brownfield specs only.',
    'Requirements. The agent asks its questions, then proposes EARS requirements. A human approves the exact content hash.',
    'Design. Drafting refuses to start unless the approved requirements hash still matches the current document.',
    'Tasks. Every task maps to a requirement and a test id. Approving the design is what unlocks them.',
    'Implement. The PreToolUse hook flips from deny to allow. Edit and Write are finally permitted.',
  ]
  const pinMq = matchMedia('(min-width:901px) and (min-height:680px)')

  /* ---------- scroll scrubbing ---------- */
  const sp = $('#sp'), hwin = $('.hs-win'), scrubs = $$('[data-scrub]'), par = $$('[data-speed]')
  let lastY = scrollY, vel = 0, dirty = true
  const onScroll = () => { dirty = true }
  const onResize = () => { vh = innerHeight; vw = innerWidth; buildMq(); dirty = true }
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', onResize)
  cleanups.push(() => { removeEventListener('scroll', onScroll); removeEventListener('resize', onResize) })

  function scrub() {
    const y = scrollY, max = root.scrollHeight - vh
    if (sp) sp.style.transform = 'scaleX(' + (max > 0 ? clamp(y / max, 0, 1) : 0) + ')'

    if (hwin && y < vh * 1.6) {
      const t = clamp(y / (vh * 0.6), 0, 1)
      hwin.style.setProperty('--hrx', (16 * (1 - t)).toFixed(2) + 'deg')
      hwin.style.setProperty('--hsc', (0.94 + 0.06 * t).toFixed(3))
    }
    if (vw > 900) par.forEach((el) => { el.style.translate = '0 ' + (y * parseFloat(el.dataset.speed || '0')).toFixed(1) + 'px' })

    if (mw.length && mani) {
      const r = mani.getBoundingClientRect(), p = clamp((vh * 0.82 - r.top) / (vh * 0.55 + r.height * 0.4), 0, 1), k = p * mw.length
      mw.forEach((w, i) => w.classList.toggle('on', i < k))
    }

    if (pin && pipe) {
      const active = pinMq.matches
      pipe.classList.toggle('all', !active)
      if (active) {
        const pr = pin.getBoundingClientRect(), total = pin.offsetHeight - vh, pp = clamp(-pr.top / total, 0, 1)
        const idx = clamp(Math.floor(pp * 5), 0, 4)
        if (fill) fill.style.transform = 'scaleX(' + pp.toFixed(3) + ')'
        pnodes.forEach((n, i) => { n.classList.toggle('lit', i <= idx); n.classList.toggle('cur', i === idx) })
        pgates.forEach((g, i) => g.classList.toggle('lit', i < idx))
        if (idx !== capIdx && cap) {
          capIdx = idx; cap.classList.remove('swap'); void cap.offsetWidth; cap.textContent = caps[idx]; cap.classList.add('swap')
        }
      }
    }

    scrubs.forEach((el) => {
      const r2 = el.getBoundingClientRect(), mid = r2.top + r2.height / 2
      if (r2.bottom < -200 || r2.top > vh + 200) return
      if (el.dataset.scrub === 'tilt') {
        const d = clamp((mid - vh / 2) / (vh / 2), -1, 1)
        el.style.setProperty('--rx', (d * 9).toFixed(2) + 'deg'); el.style.setProperty('--ry', (-d * 5).toFixed(2) + 'deg')
      } else if (el.dataset.scrub === 'grow') {
        const g = clamp((vh - r2.top) / (vh * 0.75), 0, 1)
        el.style.setProperty('--g', (0.88 + 0.12 * g).toFixed(3)); el.style.setProperty('--gr', (56 - 24 * g).toFixed(1) + 'px')
      }
    })
  }

  /* ---------- pointer effects (fine pointers only) ---------- */
  const glow = $('.cursor-glow')
  let gx = 0, gy = 0, tx = 0, ty = 0, seen = false
  if (fine) {
    const onMove = (e: PointerEvent) => {
      tx = e.clientX; ty = e.clientY
      if (!seen) { seen = true; gx = tx; gy = ty; if (glow) glow.style.opacity = '1' }
      const s = (e.target as El).closest?.('.spot') as El | null
      if (s) {
        const r = s.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5
        s.style.setProperty('--mx', e.clientX - r.left + 'px'); s.style.setProperty('--my', e.clientY - r.top + 'px')
        if (s.classList.contains('tilt')) { s.style.setProperty('--ty', (px * 9).toFixed(2) + 'deg'); s.style.setProperty('--tx', (-py * 9).toFixed(2) + 'deg') }
      }
    }
    addEventListener('pointermove', onMove, { passive: true })
    cleanups.push(() => removeEventListener('pointermove', onMove))
    $$('.tilt').forEach((el) => {
      const f = () => { el.style.setProperty('--tx', '0deg'); el.style.setProperty('--ty', '0deg') }
      el.addEventListener('pointerleave', f)
    })
    $$('.mag').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect(), pe = e as PointerEvent
        el.style.translate = ((pe.clientX - r.left - r.width / 2) * 0.22).toFixed(1) + 'px ' + ((pe.clientY - r.top - r.height / 2) * 0.32).toFixed(1) + 'px'
      })
      el.addEventListener('pointerleave', () => { el.style.translate = '0 0' })
    })
  }

  /* ---------- the loop ---------- */
  let raf = 0
  const tick = () => {
    const y = scrollY; vel += ((y - lastY) - vel) * 0.14; lastY = y
    if (dirty) { dirty = false; scrub() }
    if (Math.abs(vel) > 0.05) dirty = true
    if (!document.hidden) {
      for (const o of mqs) {
        if (!o.vis || !o.period) continue
        o.off += o.dir * (o.base + vel * 0.55)
        o.off = ((o.off % o.period) + o.period) % o.period
        o.t.style.transform = 'translate3d(' + (-o.off).toFixed(1) + 'px,0,0)'
      }
      if (glow && seen) {
        gx += (tx - gx) * 0.14; gy += (ty - gy) * 0.14
        glow.style.transform = 'translate3d(' + gx.toFixed(1) + 'px,' + gy.toFixed(1) + 'px,0) translate(-50%,-50%)'
      }
    }
    raf = requestAnimationFrame(tick)
  }
  scrub()
  raf = requestAnimationFrame(tick)
  cleanups.push(() => cancelAnimationFrame(raf))

  return () => cleanups.forEach((f) => f())
}
