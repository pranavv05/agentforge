import { head, logo, logoMark, BRAND } from './layout'
import { esc } from '../lib/crypto'

export function dashboardPage(user: { name: string; email: string; is_demo: number }) {
  const initials = esc(user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || 'U')
  return `${head('Dashboard · ' + BRAND)}
<body class="dash">
<script>window.__LG=${JSON.stringify(logoMark(68)).replace(/</g, '\\u003c')};window.__W=${JSON.stringify(user.name.split(/\s+/)[0]).replace(/</g, '\\u003c')}</script>
<style>
body.dash{background:var(--bg2)}
.shell{display:grid;grid-template-columns:248px 1fr;min-height:100vh}
.sb{background:#fff;border-right:1px solid var(--line);padding:18px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow:auto}
.sb .logo{padding:4px 8px 18px}
.sb nav a{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:11px;font-weight:600;font-size:14.5px;color:var(--ink2);margin-bottom:2px}
.sb nav a i{width:18px;text-align:center;color:var(--mute2)}
.sb nav a:hover{background:var(--bg2)}
.sb nav a.on{background:var(--acc-bg);color:#1d4fb8}.sb nav a.on i{color:var(--acc2)}
.sb nav small{display:block;margin:16px 12px 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--mute2);font-weight:700}
.sb .badge-n{margin-left:auto;background:var(--warn-bg);color:#a85a05;border-radius:99px;font-size:11px;padding:1px 8px;font-weight:700}
.sb-doc{margin-top:auto}
.me{display:flex;align-items:center;gap:10px;padding:12px 8px 0;border-top:1px solid var(--line);margin-top:14px}
.av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--acc),var(--violet));color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px;flex:none}
.me b{display:block;font-size:13.5px;line-height:1.2}.me span{font-size:12px;color:var(--mute)}
.main{padding:28px 34px 60px;min-width:0}
.top{display:flex;align-items:center;gap:12px;margin-bottom:22px;flex-wrap:wrap}
.top h1{margin:0;font-size:28px;letter-spacing:-.035em}
.crumb{color:var(--mute);font-size:14px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow)}
.kpi .l{font-size:12.5px;color:var(--mute);font-weight:600;display:flex;gap:8px;align-items:center}
.kpi .v{font-size:32px;font-weight:800;letter-spacing:-.04em;margin-top:6px;line-height:1.1}
.kpi .d{font-size:12.5px;color:var(--mute2);margin-top:4px}
.grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:16px}
.card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:var(--shadow)}
.card h3{margin:0 0 4px;font-size:17px;letter-spacing:-.02em}
.card .hint{color:var(--mute);font-size:13.5px;margin:0 0 14px}
.tbl{width:100%;border-collapse:collapse;font-size:14px}
.tbl th{text-align:left;font-size:12px;color:var(--mute2);font-weight:650;padding:8px 10px;border-bottom:1px solid var(--line);text-transform:uppercase;letter-spacing:.05em}
.tbl td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
.tbl tr:last-child td{border-bottom:0}
.tbl tr.click{cursor:pointer}.tbl tr.click:hover td{background:var(--bg2)}
.empty{text-align:center;padding:36px 16px;color:var(--mute)}
.empty i{font-size:28px;color:var(--line2);display:block;margin-bottom:10px}
.doc-card{background:linear-gradient(160deg,#0b1220,#1f3159);color:#fff;border:0;position:relative;overflow:hidden}
.doc-card:before{content:"";position:absolute;right:-40px;bottom:-60px;width:200px;height:200px;border-radius:50%;background:var(--acc);opacity:.3;filter:blur(10px)}
.doc-card p{color:#c9d6ee;font-size:14px}.doc-card h3{color:#fff}
.doc-card .btn{position:relative}
.stepper{display:flex;gap:6px;margin:0 0 18px;flex-wrap:wrap}
.step{flex:1;min-width:110px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:10px 12px;font-size:13px}
.step b{display:block;font-size:13.5px}.step span{color:var(--mute2);font-size:12px}
.step.done{background:var(--ok-bg);border-color:#bfe6cd}.step.done span{color:#0e7a37}
.step.now{background:var(--acc-bg);border-color:var(--acc);box-shadow:0 0 0 3px rgba(122,177,254,.2)}.step.now span{color:#1d4fb8}
.step.skip{opacity:.5}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:0 0 16px;overflow-x:auto}
.tabs button{background:none;border:0;padding:10px 14px;font-weight:650;font-size:14px;color:var(--mute);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.tabs button.on{color:var(--ink);border-color:var(--ink)}
.md{font-size:14.5px;color:var(--ink2)}
.md h1{font-size:22px;letter-spacing:-.03em;margin:0 0 10px;color:var(--ink)}.md h2{font-size:17px;margin:22px 0 8px;color:var(--ink)}.md h3{font-size:15px;margin:18px 0 6px;color:var(--ink)}
.md p{margin:0 0 10px}.md ul,.md ol{padding-left:20px;margin:0 0 12px}
.md code{background:var(--bg3);padding:1px 6px;border-radius:6px;font-size:.88em;color:#1a3a7a}
.md blockquote{margin:0 0 12px;border-left:3px solid var(--acc);padding:2px 14px;background:var(--acc-bg);border-radius:0 10px 10px 0}
.md table{border-collapse:collapse;width:100%;font-size:13px;margin:0 0 14px;display:block;overflow-x:auto}
.md th,.md td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}.md th{background:var(--bg2)}
.act{background:var(--warn-bg);border:1px solid #f4d9a6;border-radius:16px;padding:16px 18px;margin-bottom:16px}
.act.ok{background:var(--ok-bg);border-color:#bfe6cd}
.act h4{margin:0 0 4px;font-size:15px}
.qa{margin:10px 0}.qa label{display:block;font-weight:650;font-size:13.5px;margin-bottom:5px}
.hash{font-family:var(--mono);font-size:11.5px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:2px 8px;color:var(--mute)}
.tl{list-style:none;margin:0;padding:0 0 0 18px;border-left:2px solid var(--line)}
.tl li{position:relative;padding:0 0 16px 16px;font-size:13.5px}
.tl li:before{content:"";position:absolute;left:-26px;top:3px;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid var(--acc2)}
.tl li.human:before{border-color:var(--ok)}.tl li.agent:before{border-color:var(--violet)}
.tl .t{color:var(--mute2);font-size:12px}
.meter{height:10px;background:var(--bg3);border-radius:99px;overflow:hidden}.meter i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--acc2));border-radius:99px}.meter.hot i{background:linear-gradient(90deg,#f59e0b,#dc2626)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
#toasts{position:fixed;right:22px;bottom:22px;z-index:99;display:flex;flex-direction:column;gap:8px;align-items:flex-end;max-width:min(380px,calc(100vw - 44px))}
.toast{background:var(--ink);color:#fff;padding:13px 18px;border-radius:14px;font-size:14px;box-shadow:var(--shadow2);animation:rise .3s both}
.toast.bad{background:#a11d1d}
.mob-top{display:none}
.field{margin-bottom:16px}.field label{display:block;font-weight:650;font-size:13.5px;margin-bottom:6px}.field small{color:var(--mute2);font-size:12.5px;display:block;margin-top:4px}
.choice{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.choice label{border:1px solid var(--line2);border-radius:14px;padding:12px 14px;cursor:pointer;display:block;font-weight:600}
.choice input{position:absolute;opacity:0}
.choice label:has(input:checked){border-color:var(--ink);box-shadow:0 0 0 3px var(--acc-bg);background:#fff}
.choice small{display:block;color:var(--mute);font-weight:400;margin-top:2px}
.plan-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.chk{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px dashed var(--line);font-size:14px}
.chk input{margin-top:4px;accent-color:var(--ink);width:16px;height:16px}
.chk.done span{text-decoration:line-through;color:var(--mute2)}
.sc{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px}.sc .in{width:auto;flex:1;min-width:180px}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chips button{border:1px solid var(--line2);background:#fff;border-radius:99px;padding:6px 13px;font-size:13px;font-weight:600;color:var(--mute);cursor:pointer}.chips button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.gs{display:grid;gap:10px;margin:0}.gs li{list-style:none;display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:14px}
.gs .n{width:24px;height:24px;border-radius:50%;background:var(--bg3);display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--mute);flex:none}
.gs li.done .n{background:var(--ok);color:#fff}.gs li.done b{text-decoration:line-through;color:var(--mute2)}
.gs b{display:block;font-size:14px}.gs span{font-size:13px;color:var(--mute)}
.scroll-y{max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:12px}.scroll-y .tbl th{position:sticky;top:0;background:#fff;z-index:1}.scroll-y .tbl td,.scroll-y .tbl th{white-space:nowrap}
.row2.eq{align-items:stretch}
.kpi.click,.step.click,.tl li.click,.row.click{cursor:pointer}.kpi.click:hover{border-color:var(--acc2)}.step.click:hover{border-color:var(--acc2)}.tl li.click:hover b{text-decoration:underline}.row.click:hover b{color:var(--acc2)}
.kpi:focus-visible,.step:focus-visible,.tl li:focus-visible,.row.click:focus-visible{outline:2px solid var(--acc2);outline-offset:2px;border-radius:12px}
@media(max-width:1020px){
 .shell{grid-template-columns:1fr}
 .sb{position:fixed;left:0;top:0;bottom:0;width:264px;z-index:70;transform:translateX(-100%);transition:.25s;box-shadow:var(--shadow2)}
 .sb.open{transform:none}
 .mob-top{display:flex;align-items:center;gap:10px;background:#fff;border-bottom:1px solid var(--line);padding:10px 16px;position:sticky;top:0;z-index:40}
 .main{padding:20px 16px 50px}.cards{grid-template-columns:repeat(2,1fr)}.grid2,.row2,.plan-grid{grid-template-columns:1fr}
 .scrim{position:fixed;inset:0;background:rgba(11,18,32,.35);z-index:60;display:none}.scrim.show{display:block}
}
@media(max-width:520px){.cards{grid-template-columns:1fr}.choice{grid-template-columns:1fr}}

/* entrance motion (skipped for reduced motion) */
@keyframes d-rise{from{opacity:0;transform:translateY(18px) scale(.985)}to{opacity:1;transform:none}}
@keyframes d-slide{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
@keyframes d-fade{from{opacity:0}to{opacity:1}}
@keyframes d-bar{from{width:0}}
body.dash .sb{animation:d-slide .6s cubic-bezier(.16,.84,.24,1) both}
body.dash .sb nav a{animation:d-slide .5s cubic-bezier(.16,.84,.24,1) both;animation-delay:calc(var(--n,0)*45ms + 150ms)}
body.dash .me{animation:d-fade .8s .5s both}
.a-in{animation:d-rise .65s cubic-bezier(.16,.84,.24,1) both;animation-delay:calc(var(--i,0)*70ms)}
.kpi,.card{transition:transform .2s,box-shadow .2s,border-color .2s}
.kpi:hover,.card:hover{transform:translateY(-2px);box-shadow:var(--shadow2)}
.meter i,.btrack i{animation:d-bar 1s cubic-bezier(.16,.84,.24,1) both}
.step.now{animation:d-rise .65s both,glow 2.4s 1s ease-in-out infinite}
@keyframes glow{50%{box-shadow:0 0 0 7px rgba(122,177,254,.0),0 0 0 3px rgba(122,177,254,.35)}}
.welcome{position:fixed;inset:0;z-index:200;background:#0b1220;color:#fff;display:grid;place-items:center;pointer-events:none;animation:wl 1.15s cubic-bezier(.7,0,.2,1) both}
.welcome div{text-align:center;animation:wlt 1.15s both}
.welcome .logo-mark{width:54px;height:54px;border-radius:16px;margin:0 auto 16px}
.welcome b{font-size:22px;letter-spacing:-.03em}.welcome span{display:block;color:#9fb0cf;font-size:14px;margin-top:4px}
@keyframes wl{0%,55%{clip-path:inset(0 0 0 0)}100%{clip-path:inset(0 0 100% 0)}}
@keyframes wlt{0%{opacity:0;transform:translateY(12px)}25%,55%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-10px)}}
@media(max-width:1020px){body.dash .sb{animation:none}body.dash .sb nav a{animation:none}}
@media (prefers-reduced-motion:reduce){body.dash .sb,body.dash .sb nav a,body.dash .me,.a-in,.meter i,.btrack i,.step.now{animation:none}.welcome{display:none}}
</style>
<script>try{if(sessionStorage.getItem("af_welcome")){sessionStorage.removeItem("af_welcome");document.write('<div class="welcome" aria-hidden="true"><div>'+window.__LG+'<b>Welcome back, '+window.__W+'</b><span>Loading your workspace</span></div></div>')}}catch(e){}</script>
<div class="mob-top"><button class="btn sm" id="sb-open" aria-label="Open menu"><i class="fa-solid fa-bars"></i></button>${logo()}</div>
<div class="scrim" id="scrim"></div>
<div class="shell">
<aside class="sb" id="sb">
  ${logo()}
  <nav aria-label="Dashboard">
    <a style="--n:0" href="#/" data-r="home"><i class="fa-solid fa-gauge-high"></i>Overview</a>
    <a style="--n:1" href="#/specs" data-r="specs"><i class="fa-solid fa-file-lines"></i>Specs<span class="badge-n" id="pend-n" hidden>0</span></a>
    <a style="--n:2" href="#/new" data-r="new"><i class="fa-solid fa-plus"></i>New spec</a>
    <small>Evidence</small>
    <a style="--n:3" href="#/lab" data-r="lab"><i class="fa-solid fa-shield-halved"></i>Grounding lab</a>
    <a style="--n:4" href="#/compliance" data-r="compliance"><i class="fa-solid fa-scale-balanced"></i>Compliance pack</a>
    <small>Help</small>
    <a href="/docs" target="_blank" rel="noopener"><i class="fa-solid fa-book-open"></i>Documentation<i class="fa-solid fa-arrow-up-right-from-square" style="margin-left:auto;font-size:11px"></i></a>
    <a href="/docs/quickstart" target="_blank" rel="noopener"><i class="fa-solid fa-rocket"></i>Quickstart<i class="fa-solid fa-arrow-up-right-from-square" style="margin-left:auto;font-size:11px"></i></a>
  </nav>
  <div class="sb-doc"></div>
  <div class="me"><span class="av">${initials}</span><div style="min-width:0"><b>${esc(user.name)}</b><span>${user.is_demo ? 'Demo workspace' : esc(user.email)}</span></div>
    <button class="btn ghost sm" id="logout" title="Sign out" aria-label="Sign out" style="margin-left:auto;padding:8px 10px"><i class="fa-solid fa-right-from-bracket"></i></button></div>
</aside>
<main class="main" id="view" aria-live="polite"><div class="empty"><i class="fa-solid fa-spinner fa-spin"></i>Loading…</div></main>
</div>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></script>
<script>window.__USER=${JSON.stringify({ name: user.name, demo: !!user.is_demo }).replace(/</g, '\\u003c')}</script>
<script src="/static/app.js"></script>
</body></html>`
}
