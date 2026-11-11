import { marked } from 'marked'
import { head, nav, footer, navScript, BRAND } from './layout'
import { esc } from '../lib/crypto'
import INTRO from '../content/docs/introduction.md?raw'
import QUICKSTART from '../content/docs/quickstart.md?raw'
import CONCEPTS from '../content/docs/concepts.md?raw'
import GROUNDING from '../content/docs/grounding-compliance.md?raw'
import API from '../content/docs/api.md?raw'
import ERRORS from '../content/docs/errors.md?raw'
import FAQ from '../content/docs/faq.md?raw'
import BYOK from '../content/docs/byok.md?raw'
import DEVELOPMENT from '../content/docs/development.md?raw'
import CHANGELOG from '../content/docs/changelog.md?raw'

type Page = { slug: string; title: string; blurb: string; icon: string; group: string; md: string }

export const DOC_GROUPS = ['Get started', 'Guides', 'Reference', 'Help']

export const DOC_PAGES: Page[] = [
  { slug: 'introduction', title: 'Introduction', blurb: 'What AgentForge is and how it differs from other spec tools.', icon: 'fa-flag', group: 'Get started', md: INTRO },
  { slug: 'quickstart', title: 'Quickstart', blurb: 'Create your first spec and unlock implementation in five minutes.', icon: 'fa-rocket', group: 'Get started', md: QUICKSTART },
  { slug: 'concepts', title: 'Core concepts', blurb: 'Pipeline, approvals, audit log, edit hook and spend caps.', icon: 'fa-cubes', group: 'Guides', md: CONCEPTS },
  { slug: 'grounding-compliance', title: 'Grounding and compliance', blurb: 'How claims are verified and how GST and TDS rules are applied.', icon: 'fa-shield-halved', group: 'Guides', md: GROUNDING },
  { slug: 'byok', title: 'Bring your own key', blurb: 'Connect your own model account. Your provider bills you directly.', icon: 'fa-key', group: 'Guides', md: BYOK },
  { slug: 'development', title: 'Development process and models', blurb: 'How AgentForge was built, which Claude models it runs on, and what is not proven yet.', icon: 'fa-code-branch', group: 'Guides', md: DEVELOPMENT },
  { slug: 'api', title: 'API reference', blurb: 'Authentication, specs, hand-off and evidence endpoints.', icon: 'fa-code', group: 'Reference', md: API },
  { slug: 'errors', title: 'Errors and troubleshooting', blurb: 'Every error code, plus fixes for common problems.', icon: 'fa-triangle-exclamation', group: 'Reference', md: ERRORS },
  { slug: 'faq', title: 'FAQ', blurb: 'What is real, what is simulated, security and limits.', icon: 'fa-circle-question', group: 'Help', md: FAQ },
  { slug: 'changelog', title: 'Changelog', blurb: 'What changed in each release.', icon: 'fa-clock-rotate-left', group: 'Help', md: CHANGELOG },
]

/* ---- markdown rendering ---- */
function slugify(s: string) {
  return s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function render(md: string): { html: string; toc: { id: string; text: string; lvl: number }[] } {
  const toc: { id: string; text: string; lvl: number }[] = []
  const used = new Set<string>()
  const r = new marked.Renderer()
  r.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens)
    let id = slugify(text) || 'section'
    while (used.has(id)) id += '-2'
    used.add(id)
    if (depth === 2 || depth === 3) toc.push({ id, text: text.replace(/<[^>]+>/g, ''), lvl: depth })
    return depth === 1
      ? `<h1 id="${id}">${text}</h1>`
      : `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${text}</h${depth}>`
  }
  r.table = function (token) {
    const hd = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('')
    const bd = token.rows.map((row) => `<tr>${row.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('')
    return `<div class="tbl"><table><thead><tr>${hd}</tr></thead><tbody>${bd}</tbody></table></div>`
  }
  r.code = function ({ text, lang }) {
    const label = lang ? `<span class="lang">${esc(lang)}</span>` : ''
    return `<div class="codebox">${label}<button type="button" class="copy" aria-label="Copy code">Copy</button><pre><code>${esc(text)}</code></pre></div>`
  }
  r.link = function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens)
    const ext = /^https?:/.test(href)
    return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`
  }
  const html = marked.parse(md, { renderer: r, gfm: true, async: false }) as string
  return { html, toc }
}

/* ---- search index (title + headings + plain text), embedded once per page ---- */
const stripMd = (s: string) => s.replace(/```[\s\S]*?```/g, ' ').replace(/[`*_>#|\-\[\]()]/g, ' ').replace(/\s+/g, ' ').trim()
const SEARCH_INDEX = JSON.stringify(
  DOC_PAGES.map((p) => ({ s: p.slug, t: p.title, g: p.group, x: stripMd(p.md).slice(0, 2500) })),
).replace(/</g, '\\u003c')

const searchBox = `<div class="dsearch" role="search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
<input id="dq" type="search" placeholder="Search docs" aria-label="Search documentation" autocomplete="off"><kbd>/</kbd>
<div class="dres" id="dres" hidden></div></div>`

const searchScript = `<script>
(function(){
  var IDX=${SEARCH_INDEX},q=document.getElementById('dq'),res=document.getElementById('dres');if(!q)return;
  function esc(s){return s.replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function run(){var v=q.value.trim().toLowerCase();if(v.length<2){res.hidden=true;return}
    var terms=v.split(/\\s+/),out=[];
    IDX.forEach(function(d){var t=d.t.toLowerCase(),x=d.x.toLowerCase(),sc=0;
      terms.forEach(function(w){if(t.indexOf(w)>-1)sc+=10;var i=x.indexOf(w);if(i>-1)sc+=3});
      if(sc){var i=x.indexOf(terms[0]);var sn=i>-1?d.x.slice(Math.max(0,i-30),i+110):d.x.slice(0,120);if(i>30){sn=sn.slice(sn.indexOf(' ')+1);sn='\u2026'+sn}if(sn.length>=110)sn=sn.slice(0,sn.lastIndexOf(' '))+'\u2026';out.push({d:d,sc:sc,sn:sn})}});
    out.sort(function(a,b){return b.sc-a.sc});
    res.innerHTML=out.length?out.slice(0,6).map(function(o){return '<a href="/docs/'+o.d.s+'"><b>'+esc(o.d.t)+'</b><span>'+esc(o.sn)+'</span></a>'}).join(''):'<div class="none">No results for &ldquo;'+esc(q.value)+'&rdquo;</div>';
    res.hidden=false}
  q.addEventListener('input',run);
  q.addEventListener('keydown',function(e){if(e.key==='Escape'){q.value='';res.hidden=true;q.blur()}if(e.key==='Enter'){var a=res.querySelector('a');if(a)location.href=a.href}});
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q&&!/input|textarea/i.test(document.activeElement.tagName)){e.preventDefault();q.focus()}});
  document.addEventListener('click',function(e){if(!e.target.closest('.dsearch'))res.hidden=true});
})();
</script>`

const copyScript = `<script>
document.addEventListener('click',function(e){var b=e.target.closest('.copy');if(!b)return;
  var t=b.parentNode.querySelector('code').textContent;
  (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1400)}).catch(function(){b.textContent='Press Ctrl+C';setTimeout(function(){b.textContent='Copy'},1400)})});
</script>`

function sidebar(active: string) {
  return DOC_GROUPS.map(
    (g) =>
      `<h6>${g}</h6>` +
      DOC_PAGES.filter((p) => p.group === g)
        .map((p) => `<a href="/docs/${p.slug}"${p.slug === active ? ' class="on" aria-current="page"' : ''}>${p.title}</a>`)
        .join(''),
  ).join('')
}

export function docsIndexPage(signedIn: boolean) {
  const quick = DOC_PAGES.slice(0, 4)
  return `${head('Documentation · ' + BRAND, 'Quickstart, concepts, API reference and troubleshooting for AgentForge.')}
<body>${nav(signedIn)}
<main>
<section class="docs-hero"><div class="wrap">
  <div class="eyebrow">Documentation</div>
  <h1 class="display" style="font-size:clamp(34px,5vw,56px)">Build with ${BRAND}</h1>
  <p class="lead">Everything you need to create governed, evidence-checked specs. Start with the quickstart or jump to the API.</p>
  <div style="max-width:520px;margin:26px auto 0;text-align:left">${searchBox}</div>
  <div class="cta-row" style="margin-top:22px"><a class="btn dark" href="/docs/quickstart">Quickstart <i class="fa-solid fa-arrow-right"></i></a><a class="btn" href="/docs/api"><i class="fa-solid fa-code"></i> API reference</a></div>
</div></section>
<section class="wrap" style="padding-bottom:30px">
  <div class="tiles">
  ${DOC_PAGES.map((p) => `<a class="tile rv" href="/docs/${p.slug}"><span class="ic"><i class="fa-solid ${p.icon}"></i></span><span class="grp">${p.group}</span><h3>${p.title}</h3><p>${p.blurb}</p></a>`).join('')}
  </div>
  <p class="center" style="color:var(--mute);font-size:14px;margin-top:30px">Stuck? Check <a href="/docs/errors" style="text-decoration:underline">Errors and troubleshooting</a> or the <a href="/docs/faq" style="text-decoration:underline">FAQ</a>.</p>
</section>
</main>${footer()}${navScript}${searchScript}</body></html>`
}

export function docsPage(slug: string, signedIn: boolean) {
  const idx = DOC_PAGES.findIndex((p) => p.slug === slug)
  if (idx < 0) return null
  const p = DOC_PAGES[idx]
  const { html, toc } = render(p.md)
  const prev = DOC_PAGES[idx - 1], next = DOC_PAGES[idx + 1]
  return `${head(p.title + ' · Docs · ' + BRAND, p.blurb)}
<body>${nav(signedIn)}
<main><div class="doc-layout">
<aside class="doc-nav" aria-label="Documentation">${searchBox}<a href="/docs" class="all"><i class="fa-solid fa-book-open"></i> All docs</a>${sidebar(slug)}</aside>
<article class="prose"><div class="crumbs"><a href="/docs">Docs</a> <span>/</span> ${esc(p.group)}</div>${html}
<div class="pager">${prev ? `<a href="/docs/${prev.slug}"><small>&larr; Previous</small><b>${prev.title}</b></a>` : '<span></span>'}${next ? `<a class="r" href="/docs/${next.slug}"><small>Next &rarr;</small><b>${next.title}</b></a>` : ''}</div>
<p class="helpful">Found a problem with this page? <a href="/docs/faq">Check the FAQ</a> or <a href="/docs/errors">troubleshooting</a>.</p>
</article>
<aside class="toc" aria-label="On this page">${toc.length ? `<h6>On this page</h6>${toc.map((t) => `<a class="${t.lvl === 3 ? 'l3' : ''}" href="#${t.id}">${esc(t.text)}</a>`).join('')}` : ''}</aside>
</div></main>${footer()}${navScript}${searchScript}${copyScript}
<script>(function(){var l=[].slice.call(document.querySelectorAll('.toc a'));if(!l.length)return;var m={};l.forEach(function(a){m[a.getAttribute('href').slice(1)]=a});var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){l.forEach(function(a){a.classList.remove('on')});var a=m[e.target.id];a&&a.classList.add('on')}})},{rootMargin:'-80px 0px -70% 0px'});document.querySelectorAll('.prose h2,.prose h3').forEach(function(h){io.observe(h)})})();</script>
</body></html>`
}
