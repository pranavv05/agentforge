import { esc } from './esc';

export const BRAND = 'AgentForge';
export const TAGLINE = 'Evidence-checked spec-driven development';

export function head(
  title: string,
  desc = 'An agentic spec-driven development platform with server-enforced approvals, verifiable codebase grounding and compliance traceability.',
) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#ffffff">
<link rel="icon" type="image/svg+xml" href="/static/logo.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<script>document.documentElement.classList.add("js")</script>
<link href="/static/style.css" rel="stylesheet"><link href="/static/site.css" rel="stylesheet"></head>`;
}

const chev = `<svg class="chev" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1.5 3.5L5 7l3.5-3.5"/></svg>`;

let lgN = 0;
/**
 * AgentForge mark: a rounded tile holding an "A" drawn as one agent stroke, with a green verified check
 * inside it and a pulsing agent node at the apex. Agent + proof of work, in one glyph.
 */
export function logoMark(size = 30) {
  const id = `lg${String(lgN++ % 100000)}`;
  return `<svg class="lg" viewBox="0 0 40 40" width="${String(size)}" height="${String(size)}" role="img" aria-label="${BRAND} logo">
<defs><linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6fe4"/><stop offset="1" stop-color="#8b7bff"/></linearGradient>
<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<g class="lg-tile"><rect x="1" y="1" width="38" height="38" rx="11.5" fill="url(#${id}b)"/><rect x="1" y="1" width="38" height="19" rx="11.5" fill="url(#${id}s)"/></g>
<path class="lg-a" pathLength="100" d="M11.5 29.5 20 10.5l8.5 19" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
<path class="lg-ck" pathLength="100" d="M15.6 24.6l3.4 3.2 5.6-6.4" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<circle class="lg-ring" cx="20" cy="10.5" r="3" fill="none" stroke="#fff" stroke-width="1.2"/>
<circle class="lg-dot" cx="20" cy="10.5" r="3" fill="#fff"/><circle cx="20" cy="10.5" r="1.3" fill="#2f6fe4"/></svg>`;
}

export function logo() {
  return `<a href="/" class="logo" aria-label="${BRAND} home">${logoMark(32)}<span class="logo-t">Agent<b>Forge</b></span></a>`;
}

export function nav(signedIn: boolean) {
  return `<header class="nav" id="top-nav"><div class="wrap nav-in">
${logo()}
<ul class="menu" id="menu" style="padding:0">
 <li><button type="button" aria-expanded="false">Product ${chev}</button>
  <div class="mega">
   <div><h6>Platform</h6>
    <a class="mi" href="/product/pipeline"><span class="ic"><i class="fa-solid fa-diagram-project"></i></span><div><b>Governed pipeline</b><span>Explore the state machine and try to break the rules</span></div></a>
    <a class="mi" href="/product/grounding"><span class="ic g"><i class="fa-solid fa-shield-halved"></i></span><div><b>Grounding verifier</b><span>Check any claim against a real file and line</span></div></a>
    <a class="mi" href="/product/compliance"><span class="ic v"><i class="fa-solid fa-scale-balanced"></i></span><div><b>Compliance pack</b><span>GST and TDS Section 393 rules, with a TDS calculator</span></div></a>
   </div>
   <div><h6>Under the hood</h6>
    <a class="mi" href="/docs/concepts"><span class="ic"><i class="fa-solid fa-lock"></i></span><div><b>Core concepts</b><span>Pipeline, approvals, audit log, edit hook</span></div></a>
    <a class="mi" href="/docs/grounding-compliance"><span class="ic o"><i class="fa-solid fa-magnifying-glass"></i></span><div><b>Grounding and compliance</b><span>How claims are verified, how rules apply</span></div></a>
    <a class="mi" href="/resources/edit-hook"><span class="ic g"><i class="fa-solid fa-plug"></i></span><div><b>Edit hook</b><span>See when your coding agent may write code</span></div></a>
   </div></div></li>
 <li><button type="button" aria-expanded="false">Resources ${chev}</button>
  <div class="mega">
   <div><h6>Learn</h6>
    <a class="mi" href="/docs"><span class="ic"><i class="fa-solid fa-book-open"></i></span><div><b>Documentation</b><span>Guides, concepts and reference</span></div></a>
    <a class="mi" href="/docs/quickstart"><span class="ic v"><i class="fa-solid fa-rocket"></i></span><div><b>Quickstart</b><span>Your first spec in five minutes</span></div></a>
    <a class="mi" href="/docs/api"><span class="ic o"><i class="fa-solid fa-code"></i></span><div><b>API reference</b><span>Endpoints, request bodies and examples</span></div></a>
    <a class="mi" href="/docs/changelog"><span class="ic g"><i class="fa-solid fa-clock-rotate-left"></i></span><div><b>Changelog</b><span>What changed in each release</span></div></a>
   </div>
   <div><h6>Tools</h6>
    <a class="mi" href="/resources/edit-hook"><span class="ic g"><i class="fa-solid fa-hand"></i></span><div><b>Edit-hook tester</b><span>Pick a state and a tool, get allow or deny</span></div></a>
    <a class="mi" href="/resources/errors"><span class="ic o"><i class="fa-solid fa-triangle-exclamation"></i></span><div><b>Error decoder</b><span>Look up any error code and its fix</span></div></a>
    <a class="mi" href="/resources/templates"><span class="ic v"><i class="fa-solid fa-file-arrow-down"></i></span><div><b>Spec templates</b><span>EARS requirements, grounded design, tasks</span></div></a>
    <a class="mi" href="/resources"><span class="ic"><i class="fa-solid fa-grip"></i></span><div><b>All resources</b><span>Everything in one place</span></div></a>
   </div></div></li>
 <li><button type="button" aria-expanded="false">Compare ${chev}</button>
  <div class="mega">
   <div><h6>Versus</h6>
    <a class="mi" href="/compare/spec-kit"><span class="ic"><i class="fa-solid fa-code-branch"></i></span><div><b>GitHub Spec Kit</b><span>Prompt templates inside an agent chat</span></div></a>
    <a class="mi" href="/compare/openspec"><span class="ic g"><i class="fa-solid fa-file-circle-check"></i></span><div><b>OpenSpec</b><span>Lightweight propose, apply, archive</span></div></a>
    <a class="mi" href="/compare/kiro"><span class="ic o"><i class="fa-solid fa-laptop-code"></i></span><div><b>Kiro</b><span>AWS spec-driven IDE</span></div></a>
   </div>
   <div><h6>&nbsp;</h6>
    <a class="mi" href="/compare/bmad"><span class="ic v"><i class="fa-solid fa-users-gear"></i></span><div><b>BMAD-METHOD</b><span>21 personas, 50+ workflows</span></div></a>
    <a class="mi" href="/compare/spec-workflow-mcp"><span class="ic"><i class="fa-solid fa-plug-circle-check"></i></span><div><b>Spec Workflow MCP</b><span>The closest neighbour</span></div></a>
    <a class="mi" href="/compare#fit"><span class="ic g"><i class="fa-solid fa-compass"></i></span><div><b>Which one fits you?</b><span>Four questions, one honest answer</span></div></a>
   </div></div></li>
 <li><a href="/#faq">FAQ</a></li>
</ul>
<div class="nav-r">
 ${
   signedIn
     ? `<a class="btn dark sm" href="/workspace">Open dashboard</a>`
     : `<a class="btn ghost sm hide-m" href="/sign-in">Sign in</a><a class="btn dark sm" href="/sign-up"><i class="fa-solid fa-user-plus"></i> Sign up</a>`
 }
 <button class="burger" id="burger" aria-label="Menu" aria-expanded="false"><i class="fa-solid fa-bars"></i></button>
</div></div>
<nav class="mobile" id="mobile"><a href="/product/pipeline">Governed pipeline</a><a href="/product/grounding">Grounding verifier</a><a href="/product/compliance">Compliance pack</a><a href="/resources">Resources</a><a href="/compare">Compare</a><a href="/docs">Documentation</a>${signedIn ? '<a href="/workspace">Dashboard</a>' : '<a href="/sign-in">Sign in</a><a href="/sign-up">Sign up</a>'}</nav>
</header>`;
}

export function footer() {
  return `<footer class="f"><div class="wrap">
<div class="fgrid">
 <div>${logo()}<p style="color:var(--mute);font-size:14px;max-width:260px;margin:14px 0 0">${TAGLINE}. Agents propose, the orchestrator transitions, humans approve.</p></div>
 <div><h6>Product</h6><a href="/product/pipeline">Governed pipeline</a><a href="/product/grounding">Grounding verifier</a><a href="/product/compliance">Compliance pack</a></div>
 <div><h6>Resources</h6><a href="/docs">Documentation</a><a href="/resources/edit-hook">Edit-hook tester</a><a href="/resources/errors">Error decoder</a><a href="/resources/templates">Spec templates</a></div>
 <div><h6>Compare</h6><a href="/compare">Overview</a><a href="/compare/spec-kit">Spec Kit</a><a href="/compare/kiro">Kiro</a><a href="/compare/spec-workflow-mcp">Spec Workflow MCP</a></div>
 <div><h6>Account</h6><a href="/sign-in">Sign in</a><a href="/docs/changelog">Changelog</a></div>
</div>
<div class="fbot"><span>&copy; 2026 ${BRAND}.</span><span>Open source. Agents propose; humans approve.</span></div>
</div></footer>`;
}

export const navScript = `<script>
(function(){
  var nav=document.getElementById('top-nav');
  addEventListener('scroll',function(){nav&&nav.classList.toggle('scrolled',scrollY>8)},{passive:true});
  var items=[].slice.call(document.querySelectorAll('#menu>li'));
  items.forEach(function(li){var b=li.querySelector('button');if(!b)return;
    b.addEventListener('click',function(e){e.stopPropagation();var o=li.classList.contains('open');items.forEach(function(x){x.classList.remove('open');var q=x.querySelector('button');q&&q.setAttribute('aria-expanded','false')});if(!o){li.classList.add('open');b.setAttribute('aria-expanded','true')}});
    li.addEventListener('mouseenter',function(){if(matchMedia('(hover:hover)').matches){items.forEach(function(x){x.classList.remove('open')});li.classList.add('open')}});
    li.addEventListener('mouseleave',function(){if(matchMedia('(hover:hover)').matches)li.classList.remove('open')});
  });
  document.addEventListener('click',function(){items.forEach(function(x){x.classList.remove('open')})});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')items.forEach(function(x){x.classList.remove('open')})});
  var bg=document.getElementById('burger'),mb=document.getElementById('mobile');
  bg&&bg.addEventListener('click',function(){var o=mb.classList.toggle('open');bg.setAttribute('aria-expanded',o)});
  mb&&mb.addEventListener('click',function(e){if(e.target.closest('a')){mb.classList.remove('open');bg&&bg.setAttribute('aria-expanded','false')}});
  document.addEventListener('click',function(e){if(e.target.closest('.mega a')){items.forEach(function(x){x.classList.remove('open')})}});
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
  document.querySelectorAll('.rv').forEach(function(el){io.observe(el)});
})();
</script>`;
