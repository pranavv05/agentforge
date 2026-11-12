import { head, nav, footer, navScript, BRAND } from './layout';
import { esc } from './esc';
import { RULES, PACK_VERSION } from './rules';

/* ------------------------------------------------------------------ shared shell */
function shell(page: string, title: string, desc: string, signedIn: boolean, body: string) {
  return `${head(`${title} · ${BRAND}`, desc)}
<body class="site" data-page="${page}">
${nav(signedIn)}
<main>
${body}
</main>
${footer()}
${navScript}
<script src="/static/pages.js"></script>
</body></html>`;
}

function hero(opts: {
  crumbs: [string, string][];
  eyebrow: string;
  title: string;
  lead: string;
  cta?: string;
}) {
  const c = opts.crumbs
    .map(
      ([h, t], i) =>
        (i ? `<i class="fa-solid fa-chevron-right"></i>` : '') +
        (h ? `<a href="${h}">${t}</a>` : `<span>${t}</span>`),
    )
    .join('');
  return `<section class="ph"><div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb">${c}</nav>
<div class="eyebrow">${opts.eyebrow}</div>
<h1>${opts.title}</h1>
<p class="lead">${opts.lead}</p>
${opts.cta ? `<div class="cta-row">${opts.cta}</div>` : ''}
</div></section>`;
}

const bottomCta = (
  signedIn: boolean,
  h = 'See it on a real spec.',
  p = 'Create an account and take a spec from request to approved tasks.',
) =>
  `<div class="cta2"><div><h3>${h}</h3><p>${p}</p></div><div class="cta-row">
<a class="btn acc" href="/sign-up"><i class="fa-solid fa-play"></i> Create an account</a>
<a class="btn" href="/docs" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.3)">Read the docs</a>${signedIn ? '<a class="btn" href="/workspace" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.3)">Open dashboard</a>' : ''}</div></div>`;

/* ------------------------------------------------------------------ PRODUCT */
interface Prod {
  slug: string;
  title: string;
  icon: string;
  blurb: string;
}
export const PRODUCT_PAGES: Prod[] = [
  {
    slug: 'pipeline',
    title: 'Governed pipeline',
    icon: 'fa-diagram-project',
    blurb: 'Fifteen states, one function allowed to move a spec. Try to break it.',
  },
  {
    slug: 'grounding',
    title: 'Grounding verifier',
    icon: 'fa-shield-halved',
    blurb: 'Check any claim about the sample repo against a real file and line.',
  },
  {
    slug: 'compliance',
    title: 'Compliance pack',
    icon: 'fa-scale-balanced',
    blurb: 'GST e-invoice and TDS Section 393 rules, a lint and a calculator.',
  },
];

export function productPage(slug: string, signedIn: boolean): string | null {
  const crumbs = (t: string): [string, string][] => [
    ['/', 'Home'],
    ['', 'Product'],
    ['', t],
  ];
  const others = PRODUCT_PAGES.filter((p) => p.slug !== slug);
  const more = `<section class="ps alt"><div class="wrap"><h2>Keep exploring</h2><div class="cards3" style="margin-top:14px">${others
    .slice(0, 3)
    .map(
      (p) =>
        `<a class="fc" href="/product/${p.slug}"><span class="ic"><i class="fa-solid ${p.icon}"></i></span><h3>${p.title}</h3><p>${p.blurb}</p><span class="go">Open &rarr;</span></a>`,
    )
    .join('')}</div>${bottomCta(signedIn)}</div></section>`;

  if (slug === 'pipeline') {
    return shell(
      'pipeline',
      'Governed pipeline',
      'Explore the AgentForge state machine and try to break its rules.',
      signedIn,
      hero({
        crumbs: crumbs('Governed pipeline'),
        eyebrow: 'Product · Governed',
        title:
          'Agents propose.<br>The orchestrator transitions.<br><span class="hl">Humans approve.</span>',
        lead: 'Every spec moves through fifteen states. Pick a state, pick who is acting, and try a move. The check is the same code the dashboard uses, so a refusal here is the product working, not an error.',
        cta: `<a class="btn dark" href="#try"><i class="fa-solid fa-hand-pointer"></i> Try to break it</a><a class="btn" href="/docs/concepts#the-pipeline"><i class="fa-solid fa-book-open"></i> Read the concept</a>`,
      }) +
        `
<section class="ps" id="try"><div class="wrap">
<div class="pg">
 <div class="panel">
  <h3>Attempt a transition</h3><p class="hint">Start from any state. The grid on the right shows where each actor may go next.</p>
  <div class="presets" id="pl-presets">
   <button class="pbtn atk" type="button" data-p="agent-approve"><i class="fa-solid fa-robot"></i> Agent approves its own requirements</button>
   <button class="pbtn atk" type="button" data-p="skip"><i class="fa-solid fa-forward"></i> Skip the design gate</button>
   <button class="pbtn atk" type="button" data-p="reopen"><i class="fa-solid fa-lock"></i> Edit a finished spec</button>
   <button class="pbtn good" type="button" data-p="human-approve"><i class="fa-solid fa-user-check"></i> Human approves</button>
  </div>
  <div class="ctl">
   <div class="two"><div class="f"><label for="pl-from">Current state</label><select id="pl-from"></select></div><div class="f"><label for="pl-to">Move to</label><select id="pl-to"></select></div></div>
   <div class="f"><label id="pl-who-l">Who is acting</label><div class="who" id="pl-who" role="radiogroup" aria-labelledby="pl-who-l">
     <label><input type="radio" name="pl-actor" value="human"> Human</label><label><input type="radio" name="pl-actor" value="orchestrator" checked> Orchestrator</label><label><input type="radio" name="pl-actor" value="agent"> Agent</label><label><input type="radio" name="pl-actor" value="system"> System</label></div></div>
   <div><button class="btn dark" id="pl-go" type="button"><i class="fa-solid fa-play"></i> Attempt transition</button></div>
  </div>
  <div class="out" id="pl-out" aria-live="polite"><div class="verdict idle">Pick a move and press <b>Attempt transition</b>.</div></div>
  <div class="log"><h5><span>Attempt log</span><span id="pl-count">0 attempts</span></h5><ol id="pl-log"><li class="empty-l">Nothing yet.</li></ol></div>
 </div>
 <div class="panel">
  <h3>State map</h3><p class="hint">Click a state to make it the current one. Highlighted states are the legal next steps.</p>
  <div class="smap" id="pl-map"><div class="verdict idle" style="grid-column:1/-1">Loading states&hellip;</div></div>
  <div class="legend2"><span>current</span><span class="l2">legal next step</span><span class="l3">terminal</span></div>
  <p class="hint-r">Three rules do all the work: only listed edges exist, each edge names who may take it, and no edge admits an agent.</p>
 </div>
</div>
${more}
</div></section>`,
    );
  }

  if (slug === 'grounding') {
    return shell(
      'grounding',
      'Grounding verifier',
      'Check any claim about a sample repo against a real file and line range.',
      signedIn,
      hero({
        crumbs: crumbs('Grounding verifier'),
        eyebrow: 'Product · Grounded',
        title: 'Every claim carries<br>a <span class="hl">file and a line.</span>',
        lead: 'An agent says a function lives somewhere. Deterministic code, with no model involved, checks the file exists, the lines are real and the symbol is inside them. When a claim fails, the verifier tells the agent exactly how to fix it.',
        cta: `<a class="btn dark" href="#verify"><i class="fa-solid fa-magnifying-glass"></i> Verify a claim</a><a class="btn" href="/docs/grounding-compliance#grounding-verifier"><i class="fa-solid fa-book-open"></i> How it works</a>`,
      }) +
        `
<section class="ps" id="verify"><div class="wrap">
<p class="note-int"><i class="fa-solid fa-circle-info"></i> A failed check is the verifier doing its job. It stops an invented citation before anyone approves it.</p>
<div class="pg">
 <div class="panel">
  <h3>Write a claim</h3><p class="hint">Start from an example, or type your own.</p>
  <div class="presets" id="gv-presets">
   <button class="pbtn good" type="button" data-p="1"><i class="fa-solid fa-circle-check"></i> A true claim</button>
   <button class="pbtn atk" type="button" data-p="2"><i class="fa-solid fa-file-circle-xmark"></i> Invented file</button>
   <button class="pbtn atk" type="button" data-p="3"><i class="fa-solid fa-arrows-up-down"></i> Lines out of range</button>
   <button class="pbtn atk" type="button" data-p="4"><i class="fa-solid fa-location-crosshairs"></i> Wrong place</button>
  </div>
  <div class="ctl">
   <div class="f"><label for="gv-file">File</label><input type="text" id="gv-file" list="gv-files" autocomplete="off" spellcheck="false"><datalist id="gv-files"></datalist></div>
   <div class="two"><div class="f"><label for="gv-s">Line start</label><input type="number" id="gv-s" min="1" value="9"></div><div class="f"><label for="gv-e">Line end</label><input type="number" id="gv-e" min="1" value="17"></div></div>
   <div class="f"><label for="gv-sym">Symbol claimed in that range</label><input type="text" id="gv-sym" autocomplete="off" spellcheck="false"></div>
   <div><button class="btn dark" id="gv-go" type="button"><i class="fa-solid fa-shield-halved"></i> Run the verifier</button></div>
  </div>
  <div class="out" id="gv-out" aria-live="polite"><div class="verdict idle">Result appears here.</div></div>
  <div class="tally" id="gv-tally"></div>
 </div>
 <div class="panel">
  <h3>The repository</h3><p class="hint" id="gv-repo">acme-erp (embedded sample repo)</p>
  <div class="flist" id="gv-flist"></div>
  <pre class="cv" id="gv-code" tabindex="0" aria-label="File contents"><span class="r">Loading&hellip;</span></pre>
  <p class="hint-r">Blue rows are the lines the claim points at. Amber rows are lines the verifier says do not exist.</p>
 </div>
</div>
${more}
</div></section>`,
    );
  }

  if (slug === 'compliance') {
    const rules = RULES.map(
      (r) =>
        `<article class="fc"><span class="tag ${r.family === 'GST' ? 'acc' : 'v'}">${r.family}</span> <code style="font-size:12px;color:var(--mute)">${esc(r.id)}</code><h3>${esc(r.title)}</h3><p>${esc(r.ears)}</p>${r.note ? `<p class="hint-r">Note: ${esc(r.note)}</p>` : ''}</article>`,
    ).join('');
    const trig = JSON.stringify(
      RULES.map((r) => ({ id: r.id, title: r.title, family: r.family, triggers: r.triggers })),
    ).replace(/</g, '\\u003c');
    return shell(
      'compliance',
      'Compliance pack',
      'GST e-invoice and TDS Section 393 rules as testable acceptance criteria, with a lint and a calculator.',
      signedIn,
      hero({
        crumbs: crumbs('Compliance pack'),
        eyebrow: 'Product · Compliant',
        title: 'Catch the old law<br><span class="hl">before it ships.</span>',
        lead: `The Income-tax Act 2025 took effect on 1 April 2026. There is no 194C, 194I or 194J any more; each is a row in Section 393. Pack ${esc(PACK_VERSION)} injects testable criteria and traces them to tasks and tests.`,
        cta: `<a class="btn dark" href="#lint"><i class="fa-solid fa-spell-check"></i> Run the lint</a><a class="btn" href="#calc"><i class="fa-solid fa-calculator"></i> TDS calculator</a>`,
      }) +
        `
<section class="ps" id="lint"><div class="wrap">
<div class="pg">
 <div class="panel"><h3>Compliance lint</h3><p class="hint">Paste a design sentence. Any legacy 194-series section is rejected and mapped.</p>
  <div class="presets"><button class="pbtn atk" type="button" id="lt-bad"><i class="fa-solid fa-triangle-exclamation"></i> Old law</button><button class="pbtn good" type="button" id="lt-good"><i class="fa-solid fa-circle-check"></i> Section 393</button></div>
  <div class="ctl"><div class="f"><label for="lt-in">Design text</label><textarea id="lt-in">Deduct TDS under Section 194J for professional fees and Section 194C for contractors.</textarea></div></div>
  <div class="out" id="lt-out" aria-live="polite"></div></div>
 <div class="panel"><h3>Which rules fire?</h3><p class="hint">Describe a feature. The pack picks the rules whose triggers match.</p>
  <div class="ctl"><div class="f"><label for="rf-in">Feature description</label><textarea id="rf-in">Deduct TDS on contractor and professional vendor payments and show it on each payment.</textarea></div></div>
  <div class="out" id="rf-out" aria-live="polite"></div></div>
</div></div></section>
<section class="ps alt" id="calc"><div class="wrap">
<div class="pg">
 <div class="panel"><h3>TDS calculator</h3><p class="hint">Rates from the demo pack, Section 393.</p>
  <div class="ctl">
   <div class="f"><label for="td-cat">Payment category</label><select id="td-cat"><option value="technical">Technical services fee</option><option value="professional">Professional fee</option><option value="contractor" selected>Contractor payment</option></select></div>
   <div class="f"><label id="td-p-l">Payee</label><div class="who" role="radiogroup" aria-labelledby="td-p-l"><label><input type="radio" name="td-payee" value="individual" checked> Individual / HUF</label><label><input type="radio" name="td-payee" value="company"> Company / other</label></div></div>
   <div class="f"><label for="td-amt">Amount (INR)</label><input type="number" id="td-amt" min="0" step="1000" value="100000"></div>
   <p class="hint-r" style="margin:0">Illustrative. Thresholds are not modelled. Verify with the official portal before real use.</p>
  </div></div>
 <div class="panel"><h3>Result</h3><div class="out" id="td-out" aria-live="polite"></div></div>
</div></div></section>
<section class="ps"><div class="wrap"><div class="eyebrow">The rule pack</div><h2>${String(RULES.length)} rules, versioned ${esc(PACK_VERSION)}</h2><p class="sub">Each rule becomes an EARS requirement with a testable acceptance criterion, traced to a task and a test id.</p>
<div class="cards3">${rules}</div></div></section>
<section class="ps alt"><div class="wrap">${more.replace('<section class="ps alt"><div class="wrap">', '').replace('</div></section>', '')}</div></section>
<script>window.__RULES=${trig}</script>`,
    );
  }

  return null;
}

/* ------------------------------------------------------------------ RESOURCES */
export interface ErrCode {
  code: string;
  http: number;
  meaning: string;
  fix: string;
  cause: string;
}
export const ERROR_CODES: ErrCode[] = [
  {
    code: 'VALIDATION_FAILED',
    http: 400,
    meaning: 'A field is missing or invalid.',
    cause:
      'The request body failed validation, for example a title shorter than three characters or a password under eight.',
    fix: 'Read the message field and correct the input.',
  },
  {
    code: 'UNAUTHORIZED',
    http: 401,
    meaning: 'No valid session.',
    cause: 'The session cookie is missing, expired or revoked.',
    fix: 'Sign in again.',
  },
  {
    code: 'INVALID_CREDENTIALS',
    http: 401,
    meaning: 'Wrong email or password.',
    cause:
      'The email is unknown or the password does not match. The response is identical for both so accounts cannot be probed.',
    fix: 'Check both, or create an account.',
  },
  {
    code: 'BUDGET_EXCEEDED',
    http: 402,
    meaning: 'The next model call would exceed the cost cap.',
    cause:
      'The orchestrator adds the next call to what the spec has already spent and refuses if the total passes the cap.',
    fix: 'Raise the cap on the spec Cost tab, then continue.',
  },
  {
    code: 'FORBIDDEN_ORIGIN',
    http: 403,
    meaning: 'A browser request came from another site.',
    cause: 'State-changing calls must be same-origin. This blocks cross-site request forgery.',
    fix: 'Call the API from the same origin as the app.',
  },
  {
    code: 'NOT_FOUND',
    http: 404,
    meaning: 'The spec or artifact does not exist, or is not yours.',
    cause: 'Wrong id, or the spec belongs to a different account.',
    fix: 'Check the id.',
  },
  {
    code: 'EMAIL_TAKEN',
    http: 409,
    meaning: 'An account with this email already exists.',
    cause: 'Signup found a user with the same email.',
    fix: 'Sign in instead.',
  },
  {
    code: 'ILLEGAL_TRANSITION',
    http: 409,
    meaning: 'That move is not in the transition table, or the actor may not make it.',
    cause:
      'The edge does not exist, or it requires a different actor. An agent attempting any transition returns 403. This is the governance rule working.',
    fix: 'Reload the spec and look at its allowed next steps.',
  },
  {
    code: 'VERSION_CONFLICT',
    http: 409,
    meaning: 'Someone else changed the spec first.',
    cause: 'Optimistic locking: the version you sent is no longer the current one.',
    fix: 'Reload and retry.',
  },
  {
    code: 'HASH_MISMATCH',
    http: 409,
    meaning: 'The hash you approved is not the current document.',
    cause:
      'A new draft was created while you were reviewing, so your approval no longer matches the bytes on the server.',
    fix: 'Reload, read the new version, decide again.',
  },
  {
    code: 'PRECONDITION_FAILED',
    http: 409,
    meaning: 'A gate precondition failed.',
    cause: 'For example nothing is awaiting approval, or an upstream artifact is missing.',
    fix: 'Check the spec status.',
  },
  {
    code: 'BAD_CONTENT_TYPE',
    http: 415,
    meaning: 'Missing Content-Type: application/json.',
    cause: 'The API only accepts JSON bodies on write calls.',
    fix: 'Add the header.',
  },
  {
    code: 'INTERNAL',
    http: 500,
    meaning: 'Unexpected server error.',
    cause: 'Something failed that the API did not anticipate.',
    fix: 'Retry. Report it if it persists.',
  },
];

export function resourcesIndexPage(signedIn: boolean) {
  const tools = [
    {
      h: '/resources/edit-hook',
      i: 'fa-hand',
      c: 'g',
      t: 'Edit-hook tester',
      p: 'Pick a spec state and a tool. See exactly what the PreToolUse hook answers, including its exit code.',
    },
    {
      h: '/resources/errors',
      i: 'fa-triangle-exclamation',
      c: 'o',
      t: 'Error decoder',
      p: 'Look up any of the thirteen error codes, or paste a response and get its meaning and fix.',
    },
    {
      h: '/resources/templates',
      i: 'fa-file-arrow-down',
      c: 'v',
      t: 'Spec templates',
      p: 'Copy or download the EARS requirements, grounded design and task templates.',
    },
  ];
  const learn = [
    {
      h: '/docs',
      i: 'fa-book-open',
      c: '',
      t: 'Documentation',
      p: 'Introduction, concepts, grounding and compliance.',
    },
    {
      h: '/docs/quickstart',
      i: 'fa-rocket',
      c: 'v',
      t: 'Quickstart',
      p: 'Create a spec and unlock implementation in five minutes.',
    },
    {
      h: '/docs/api',
      i: 'fa-code',
      c: 'o',
      t: 'API reference',
      p: 'Authentication, specs, hand-off and evidence endpoints.',
    },
    {
      h: '/docs/faq',
      i: 'fa-circle-question',
      c: 'g',
      t: 'FAQ',
      p: 'Costs, retrieval results, limits and what is not proven yet.',
    },
    {
      h: '/docs/errors',
      i: 'fa-bug',
      c: 'o',
      t: 'Troubleshooting',
      p: 'Every error code, plus fixes for common problems.',
    },
    {
      h: '/docs/changelog',
      i: 'fa-clock-rotate-left',
      c: 'g',
      t: 'Changelog',
      p: 'What changed in each release.',
    },
  ];
  const card = (x: { h: string; i: string; c: string; t: string; p: string }) =>
    `<a class="fc" href="${x.h}"><span class="ic ${x.c}"><i class="fa-solid ${x.i}"></i></span><h3>${x.t}</h3><p>${x.p}</p><span class="go">Open &rarr;</span></a>`;
  return shell(
    'resources',
    'Resources',
    'Interactive tools, templates and documentation for AgentForge.',
    signedIn,
    hero({
      crumbs: [
        ['/', 'Home'],
        ['', 'Resources'],
      ],
      eyebrow: 'Resources',
      title: 'Tools that<br><span class="hl">do the job.</span>',
      lead: 'Three working tools and the full documentation. None of them need an account.',
    }) +
      `<section class="ps"><div class="wrap"><h2>Interactive tools</h2><p class="sub">Each one runs against the real rules.</p><div class="cards3">${tools.map(card).join('')}</div></div></section>
<section class="ps alt"><div class="wrap"><h2>Learn</h2><p class="sub">Read the docs in the order that suits you.</p><div class="cards3">${learn.map(card).join('')}</div>${bottomCta(signedIn)}</div></section>`,
  );
}

const TPL_REQ = `# requirements.md  (EARS format)

## REQ-001  Deduct TDS on vendor payment
When a vendor is paid, the system shall deduct TDS under Section 393 of the
Income-tax Act 2025 and record the compliance pack version on the deduction.

### Acceptance criteria
- Given a technical fee of INR 100,000, when TDS is computed, then INR 2,000 is deducted.
- Given a professional fee of INR 100,000, then INR 10,000 is deducted.
- Given any computation, no identifier matches /194[A-Z]*/.

### Compliance refs
TDS-01, TDS-02, TDS-04

### Trace
design: DES-001   task: TASK-01   test: T-REQ-001
`;

const TPL_DESIGN = `# design.md

## Touchpoints (every claim is machine-checked)
| Claim | Evidence | Symbol |
|---|---|---|
| computeTds is defined here | src/tax/tds.ts:L9-17 | computeTds |
| payVendor calls computeTds | src/payments/vendorPayments.ts:L13-18 | computeTds |

## Rules
- Do not cite a file, line range or symbol you have not read.
- A claim that fails the verifier is dropped, or rewritten as work to be created.
- No reference to legacy 194-series sections. Map to a Section 393 row.

## Approach
Replace the legacy section keys in TDS_RULES with Section 393 rows and
load rates from a versioned table.
`;

const TPL_TASKS = `# tasks.md

| Task | Requirement | Test | Status |
|---|---|---|---|
| TASK-01 | REQ-001 | T-REQ-001 | pending |
| TASK-02 | REQ-002 | T-REQ-002 | pending |

## Rules
- Every task maps to exactly one requirement and one test id.
- A task is complete only with evidence attached.
- Editing files is only allowed once the spec is READY_FOR_IMPLEMENTATION.
`;

export function resourceToolPage(slug: string, signedIn: boolean): string | null {
  const crumbs = (t: string): [string, string][] => [
    ['/', 'Home'],
    ['/resources', 'Resources'],
    ['', t],
  ];
  if (slug === 'edit-hook') {
    return shell(
      'edithook',
      'Edit-hook tester',
      'See what the AgentForge PreToolUse hook answers for any spec state and tool.',
      signedIn,
      hero({
        crumbs: crumbs('Edit-hook tester'),
        eyebrow: 'Resources · Tool',
        title: 'When may your coding agent<br><span class="hl">write code?</span>',
        lead: 'The Claude Code plugin asks the hook before every Edit and Write. It answers deny until both approvals exist, and it fails closed: if anything goes wrong it exits 2 and refuses.',
      }) +
        `
<section class="ps"><div class="wrap"><div class="pg">
 <div class="panel"><h3>Ask the hook</h3><p class="hint">Choose the spec state and the tool the agent wants to use.</p>
  <div class="ctl"><div class="two"><div class="f"><label for="eh-st">Spec state</label><select id="eh-st"></select></div>
   <div class="f"><label for="eh-tool">Tool</label><select id="eh-tool"><option>Edit</option><option>Write</option><option>MultiEdit</option><option>NotebookEdit</option><option>Read</option><option>Grep</option><option>Bash</option></select></div></div>
   <div><button class="btn dark" id="eh-go" type="button"><i class="fa-solid fa-hand"></i> Ask the hook</button></div></div>
  <div class="out" id="eh-out" aria-live="polite"><div class="verdict idle">Pick a state and tool, then ask.</div></div>
  <p class="hint-r">Governed tools: Edit, Write, MultiEdit, NotebookEdit. Reading and searching are never blocked.</p></div>
 <div class="panel"><h3>Across the lifecycle</h3><p class="hint" id="eh-walk-h">What the hook says for the selected tool in each state.</p>
  <div class="walk" id="eh-walk"></div></div>
</div>${bottomCta(signedIn)}</div></section>`,
    );
  }
  if (slug === 'errors') {
    const rows = ERROR_CODES.map(
      (e, i) =>
        `<tr class="er" data-i="${String(i)}" tabindex="0" role="button" aria-expanded="false"><td><code>${e.code}</code></td><td class="http">${String(e.http)}</td><td>${esc(e.meaning)}</td></tr><tr class="ex" id="ex-${String(i)}" hidden><td colspan="3"><dl class="kv2"><dt>Why it happens</dt><dd style="font-weight:500">${esc(e.cause)}</dd><dt>What to do</dt><dd>${esc(e.fix)}</dd><dt>Response shape</dt><dd style="font-weight:500"><code style="font-size:12px">{ "error": { "code": "${e.code}", "message": "&hellip;", "details": null, "correlation_id": null } }</code></dd></dl></td></tr>`,
    ).join('');
    return shell(
      'errors',
      'Error decoder',
      'Look up any AgentForge error code, or paste an error response and get its meaning and fix.',
      signedIn,
      hero({
        crumbs: crumbs('Error decoder'),
        eyebrow: 'Resources · Tool',
        title: 'Every error,<br><span class="hl">decoded.</span>',
        lead: 'Thirteen typed codes, each with an HTTP status. Search, click a row for the cause and the fix, or paste a response body and let it identify itself.',
      }) +
        `
<section class="ps"><div class="wrap">
<div class="pg" style="grid-template-columns:1fr 1fr;margin-bottom:22px">
 <div class="panel"><h3>Paste a response</h3><p class="hint">Any JSON error body from the API.</p><div class="ctl"><div class="f"><label for="er-paste">Response body</label><textarea id="er-paste" spellcheck="false" placeholder='{"error":{"code":"HASH_MISMATCH","message":"..."}}'></textarea></div></div><div class="out" id="er-dec" aria-live="polite" style="min-height:0;margin-top:10px"></div></div>
 <div class="panel"><h3>Search the table</h3><p class="hint">Filter by code, status or words.</p><div class="ctl"><div class="f"><label for="er-q">Search</label><input type="text" id="er-q" placeholder="409, hash, budget&hellip;" autocomplete="off"></div></div><p class="hint-r" id="er-n">${String(ERROR_CODES.length)} codes</p></div>
</div>
<div class="etbl-w"><table class="etbl" id="er-t"><thead><tr><th>Code</th><th>HTTP</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="hint-r">Full troubleshooting guide: <a href="/docs/errors" style="text-decoration:underline">docs / errors</a>.</p>
${bottomCta(signedIn)}</div></section>
<script>window.__ERR=${JSON.stringify(ERROR_CODES).replace(/</g, '\\u003c')}</script>`,
    );
  }
  if (slug === 'templates') {
    const tpl = (id: string, t: string, file: string, body: string, blurb: string) =>
      `<article class="tpl" data-file="${file}"><div class="tpl-h"><span class="ic"><i class="fa-solid fa-file-lines"></i></span><div><h3>${t}</h3><span style="font-size:13px;color:var(--mute)">${blurb}</span></div><span class="sp" style="flex:1"></span><button class="btn sm" type="button" data-act="copy"><i class="fa-regular fa-copy"></i> Copy</button><button class="btn sm dark" type="button" data-act="dl"><i class="fa-solid fa-download"></i> Download ${file}</button></div><pre id="${id}">${esc(body)}</pre></article>`;
    return shell(
      'templates',
      'Spec templates',
      'Copy or download AgentForge requirements, design and task templates.',
      signedIn,
      hero({
        crumbs: crumbs('Spec templates'),
        eyebrow: 'Resources · Templates',
        title: 'Start from<br><span class="hl">a checked shape.</span>',
        lead: 'The three artifacts every spec produces. Each template bakes in the rules the platform enforces: EARS wording, verifiable evidence, and one test per task.',
      }) +
        `<section class="ps"><div class="wrap">
${tpl('t-req', 'requirements.md', 'requirements.md', TPL_REQ, 'EARS requirement with acceptance criteria')}
${tpl('t-des', 'design.md', 'design.md', TPL_DESIGN, 'Touchpoints with file:line evidence')}
${tpl('t-tsk', 'tasks.md', 'tasks.md', TPL_TASKS, 'One requirement and one test per task')}
${bottomCta(signedIn, 'Generate a real one.', 'Create a spec and the pipeline drafts all three, then checks every claim.')}
</div></section>`,
    );
  }
  return null;
}

/* ------------------------------------------------------------------ COMPARE */
export interface Tool {
  slug: string;
  name: string;
  by: string;
  tag: string;
  icon: string;
  what: string;
  license: string;
  activity: string;
  enforces: string;
  enforceKind: 'y' | 'n' | 'm';
  great: string[];
  gaps: string[];
  pickThem: string;
  pickUs: string;
  borrowed: string;
}
export const TOOLS: Tool[] = [
  {
    slug: 'spec-kit',
    name: 'GitHub Spec Kit',
    by: 'GitHub',
    tag: 'Prompt templates inside an agent chat',
    icon: 'fa-code-branch',
    what: 'Installs commands and skills into 41 coding agents. The flow is constitution, specify, clarify, plan, checklist, tasks, analyze, implement, converge. It writes specs/NNN-feature/spec.md, plan.md and tasks.md, plus a constitution file.',
    license: 'MIT, free',
    activity:
      'About 147K stars (Nov 2026). 1.0 shipped 21 Aug 2026; specify-cli 1.3.0 on PyPI, releases through 3 Nov 2026.',
    enforces: 'No. Its gates only work if a human actually reads what comes out of them.',
    enforceKind: 'n',
    great: [
      'Works across 41 coding agents, so you are not tied to one.',
      'A huge community and a stable 1.0.',
      'Good templates and a clear constitution idea for project principles.',
    ],
    gaps: [
      'Gates are conventions: nothing stops an agent from skipping one.',
      'Claims about your code are not machine-checked.',
      'No approval record bound to a document hash.',
    ],
    pickThem:
      'You use several coding agents and want shared, well-tested templates with no server to run.',
    pickUs:
      'You need a refusal you can prove, a record of who approved which exact version, or checked evidence for brownfield changes.',
    borrowed: 'The constitution concept, the templates, and the analyze and converge ideas (MIT).',
  },
  {
    slug: 'openspec',
    name: 'OpenSpec',
    by: 'Fission AI (YC W26)',
    tag: 'Lightweight propose, apply, archive',
    icon: 'fa-file-circle-check',
    what: 'A lightweight spec-driven workflow: propose, apply, archive. It keeps current specs in openspec/specs/ separate from proposed changes in openspec/changes/, and is built for brownfield work.',
    license: 'MIT, free',
    activity: 'About 74.1K stars. npm 1.13.0 published early Nov 2026, on a weekly cadence.',
    enforces: 'No. It is workflow guidance.',
    enforceKind: 'n',
    great: [
      'Very little ceremony, quick to adopt.',
      'The delta-spec model (current versus change) fits existing codebases well.',
      'Active weekly releases.',
    ],
    gaps: [
      'Guidance only: no server-enforced stage order.',
      'No verification that cited code exists.',
      'No audit log of approvals.',
    ],
    pickThem:
      'You want the lowest-friction way to keep specs and changes tidy on an existing project.',
    pickUs:
      'You want the same brownfield discipline plus enforced approvals, checked evidence and a cost cap.',
    borrowed:
      'The delta-spec model of current state versus proposed change, for existing-codebase specs.',
  },
  {
    slug: 'kiro',
    name: 'Kiro',
    by: 'AWS',
    tag: 'Spec-driven IDE',
    icon: 'fa-laptop-code',
    what: 'An IDE that writes .kiro/specs/<feature>/requirements.md, design.md and tasks.md and walks you through them.',
    license:
      'Proprietary. Free 50 credits a month; Pro $20 for 1,000 credits; Power $200 for 10,000; add-ons $0.04 a credit. Students get 1,000 credits a month free for 12 months.',
    activity: 'Generally available.',
    enforces: 'Yes, inside the IDE.',
    enforceKind: 'm',
    great: [
      'A polished, integrated experience with enforcement built into the IDE.',
      'A generous student plan.',
      'No setup beyond installing it.',
    ],
    gaps: [
      'Enforcement lives in the IDE, not in a server you control.',
      'Proprietary and priced in credits.',
      'Does not check that cited code is real or trace compliance rules.',
    ],
    pickThem: 'You are happy living in one IDE and want a smooth, supported experience.',
    pickUs:
      'You need enforcement that is independent of any editor, and evidence and compliance you can audit.',
    borrowed:
      'Nothing is built on it. It is the evaluation baseline: run the same features through both and compare.',
  },
  {
    slug: 'bmad',
    name: 'BMAD-METHOD',
    by: 'BMad Code, LLC',
    tag: '21 personas, 50+ workflows',
    icon: 'fa-users-gear',
    what: 'A full agile-style method: 21 agent personas, more than 50 workflows, and PRD, architecture and story documents.',
    license: 'MIT (the names are trademarked by BMad Code, LLC)',
    activity: 'About 54.2K stars. v6.12.4 on 14 Oct 2026; v7 in preview alpha.',
    enforces: 'Human in the loop by convention.',
    enforceKind: 'n',
    great: [
      'The deepest planning vocabulary of the group: personas, PRDs, architecture, stories.',
      'Good if your team already thinks in agile ceremonies.',
      'Large community.',
    ],
    gaps: [
      'Heavy for a single feature.',
      'Human review is a convention, not a gate.',
      'No machine-checked evidence.',
    ],
    pickThem: 'You want a complete agile planning method driven by agent personas.',
    pickUs: 'You want a short pipeline with real gates instead of a large method to adopt.',
    borrowed: 'Nothing built in. It is cited as related work because it is too heavy to build on.',
  },
  {
    slug: 'spec-workflow-mcp',
    name: 'Spec Workflow MCP',
    by: 'Pimzino',
    tag: 'The closest neighbour',
    icon: 'fa-plug-circle-check',
    what: 'An MCP server for Requirements, Design, Tasks with a real-time web dashboard and a VS Code extension. It offers request-approval and get-approval-status tools and supports approve, reject and revise.',
    license: 'Free and open source under GPL-3.0 (copyleft, unlike the MIT tools above).',
    activity: 'About 4.3k stars and 357 forks. Created 7 Aug 2025; last pushed 3 Jul 2026.',
    enforces:
      'The AI requests approval through MCP tools. We could not verify that the server blocks progression without it.',
    enforceKind: 'm',
    great: [
      'It already has a live approval dashboard and a VS Code extension.',
      'It is the nearest thing to this product, so it is the fairest comparison.',
      'Free and open.',
    ],
    gaps: [
      'Enforcement could not be verified, so treat it as a recorded request rather than a proven gate.',
      'No check that cited code exists.',
      'GPL-3.0: copying its code brings copyleft obligations.',
    ],
    pickThem:
      'You want an approval dashboard now, you are comfortable with GPL-3.0, and recorded approvals are enough for you.',
    pickUs:
      'You need server-enforced state, codebase grounding verification and compliance traceability.',
    borrowed:
      'Ideas only, not code, because of the licence. We studied its approval tools closely.',
  },
];

export function compareIndexPage(signedIn: boolean) {
  const cards = TOOLS.map(
    (t) =>
      `<a class="fc" href="/compare/${t.slug}"><span class="ic"><i class="fa-solid ${t.icon}"></i></span><h3>${t.name}</h3><p>${t.tag}</p><span class="go">AgentForge vs ${t.name} &rarr;</span></a>`,
  ).join('');
  const yn = (k: 'y' | 'n' | 'm', t: string) =>
    `<td class="${k === 'y' ? 'yes' : k === 'm' ? 'maybe' : 'no'}">${t}</td>`;
  const rows = TOOLS.map(
    (t) =>
      `<tr><td><a href="/compare/${t.slug}" style="font-weight:650;text-decoration:underline">${t.name}</a></td><td>${esc(t.license.split('.')[0] ?? t.license)}</td>${yn(t.enforceKind, esc(t.enforces.split('.')[0] ?? t.enforces))}</tr>`,
  ).join('');
  const q = (id: string, text: string, opts: [string, string][]) =>
    `<fieldset class="q" style="border:1px solid var(--line)"><legend style="display:none">${text}</legend><h4>${text}</h4><div class="opts">${opts.map(([v, l]) => `<label><input type="radio" name="${id}" value="${v}"> ${l}</label>`).join('')}</div></fieldset>`;
  return shell(
    'compare',
    'Compare',
    'How AgentForge differs from Spec Kit, OpenSpec, Kiro, BMAD and Spec Workflow MCP, with a fit quiz.',
    signedIn,
    hero({
      crumbs: [
        ['/', 'Home'],
        ['', 'Compare'],
      ],
      eyebrow: 'Compare',
      title: 'Documents are a commodity.<br><span class="hl">Enforcement is not.</span>',
      lead: 'Spec Kit, OpenSpec, BMAD, Kiro and Spec Workflow MCP all produce requirements, design and tasks. Read each comparison, or answer four questions and get an honest recommendation, even when it is not us.',
      cta: `<a class="btn dark" href="#fit"><i class="fa-solid fa-compass"></i> Which one fits me?</a>`,
    }) +
      `
<section class="ps"><div class="wrap"><h2>Pick a tool</h2><p class="sub">A fair side-by-side for each, based on public documentation.</p><div class="cards3">${cards}</div></div></section>
<section class="ps alt"><div class="wrap"><h2>At a glance</h2><div class="cmp-wrap"><table class="cmp" style="margin-top:14px"><thead><tr><th>Tool</th><th>Licence</th><th>Enforces approval gates?</th></tr></thead><tbody>
<tr><td class="us"><b>${BRAND}</b></td><td class="us">Your own</td><td class="us yes">Server-enforced, hash-bound, audit-logged</td></tr>${rows}</tbody></table></div>
<p class="hint-r">Based on public documentation. Where enforcement could not be confirmed we say so.</p></div></section>
<section class="ps" id="fit"><div class="wrap"><div class="pg" style="grid-template-columns:1.1fr .9fr">
 <div><h2>Which one fits you?</h2><p class="sub">Four questions. No email needed.</p>
  ${q('q1', '1. Where are you working?', [
    ['existing', 'An existing codebase'],
    ['new', 'A new project'],
  ])}
  ${q('q2', '2. Who needs to be able to prove what happened?', [
    ['none', 'Nobody, I just want speed'],
    ['lead', 'My team lead'],
    ['audit', 'An auditor or regulator'],
  ])}
  ${q('q3', '3. Which coding agent do you use?', [
    ['claude', 'Claude Code'],
    ['many', 'Several, or it varies'],
    ['kiro', 'I live in the Kiro IDE'],
  ])}
  ${q('q4', '4. How much process do you want?', [
    ['min', 'As little as possible'],
    ['gates', 'A few real approval gates'],
    ['full', 'A full agile method'],
  ])}
 </div>
 <div style="position:sticky;top:90px"><div id="fit-out" aria-live="polite"><div class="verdict idle">Answer all four to see a recommendation.</div></div></div>
</div>${bottomCta(signedIn)}</div></section>`,
  );
}

export function comparePage(slug: string, signedIn: boolean): string | null {
  const i = TOOLS.findIndex((t) => t.slug === slug);
  if (i < 0) return null;
  const t = TOOLS[i];
  // Guaranteed by findIndex, but the index signature does not say so. Guarding the
  // lookup once beats threading `?.` through the whole page body below.
  if (t === undefined) return null;
  // Wrap-around neighbours for the pager. The modulo keeps them in range, so the
  // fallback to `t` never runs; it exists because the index signature cannot say so.
  const prev = TOOLS[(i + TOOLS.length - 1) % TOOLS.length] ?? t,
    next = TOOLS[(i + 1) % TOOLS.length] ?? t;
  const ic = (k: 'y' | 'n' | 'm') =>
    `<i class="fa-solid ${k === 'y' ? 'fa-circle-check y' : k === 'm' ? 'fa-circle-half-stroke m' : 'fa-circle-minus n'}"></i>`;
  const li = (a: string[], k: 'y' | 'n' | 'm') =>
    a.map((x) => `<li>${ic(k)}<span>${esc(x)}</span></li>`).join('');
  const mine = [
    ['y', 'The orchestrator is the only function that moves a spec; no edge admits an agent.'],
    ['y', 'Approvals are bound to a sha256 of the exact document reviewed.'],
    ['y', 'Every codebase claim is checked against a real file, line range and symbol.'],
    ['y', 'GST and TDS Section 393 rules become testable acceptance criteria.'],
    [
      'm',
      'Honest limits: this build simulates model output, and ships a Claude Code plugin and MCP server rather than 41 agent integrations.',
    ],
  ] as ['y' | 'm', string][];
  return shell(
    'compare-' + t.slug,
    `${BRAND} vs ${t.name}`,
    `A fair comparison of AgentForge and ${t.name}.`,
    signedIn,
    hero({
      crumbs: [
        ['/', 'Home'],
        ['/compare', 'Compare'],
        ['', t.name],
      ],
      eyebrow: `Compare · ${t.by}`,
      title: `${BRAND} <span style="color:var(--mute2);font-weight:600">vs</span> <span class="hl">${esc(t.name)}</span>`,
      lead: esc(t.what),
    }) +
      `
<section class="ps"><div class="wrap">
<div class="fact"><div><small>Licence</small><b style="font-size:13.5px;font-weight:600">${esc(t.license)}</b></div><div><small>Activity</small><b style="font-size:13.5px;font-weight:600">${esc(t.activity)}</b></div><div><small>Enforces approval gates?</small><b style="font-size:13.5px;font-weight:600">${esc(t.enforces)}</b></div><div><small>Best described as</small><b style="font-size:13.5px;font-weight:600">${esc(t.tag)}</b></div></div>
<div class="vs" style="margin-top:22px">
 <div class="side-c"><h2>${esc(t.name)}</h2><p class="by">Where it is strong, and what it does not claim</p><ul>${li(t.great, 'y')}${li(t.gaps, 'n')}</ul></div>
 <div class="side-c us"><h2>${BRAND}</h2><p class="by">What is different, and where we are limited</p><ul>${mine.map(([k, x]) => `<li>${ic(k)}<span>${esc(x)}</span></li>`).join('')}</ul></div>
</div>
<div class="cards3" style="margin-top:22px;grid-template-columns:1fr 1fr 1fr">
 <div class="fc"><div class="rc-t"><i class="fa-solid fa-hand-point-right"></i> Pick ${esc(t.name)} when</div><p>${esc(t.pickThem)}</p></div>
 <div class="fc"><div class="rc-t"><i class="fa-solid fa-hand-point-right"></i> Pick ${BRAND} when</div><p>${esc(t.pickUs)}</p></div>
 <div class="fc"><div class="rc-t"><i class="fa-solid fa-handshake"></i> What we borrowed</div><p>${esc(t.borrowed)}</p></div>
</div>
<div class="cta2"><div><h3>See the difference on a real spec.</h3><p>Try the playgrounds, no account needed.</p></div><div class="cta-row"><a class="btn acc" href="/product/pipeline"><i class="fa-solid fa-diagram-project"></i> Try to break the pipeline</a><a class="btn" href="/compare#fit" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.3)">Which one fits me?</a></div></div>
<div class="row" style="justify-content:space-between;margin-top:26px;flex-wrap:wrap"><a class="btn sm" href="/compare/${prev.slug}"><i class="fa-solid fa-arrow-left"></i> ${esc(prev.name)}</a><a class="btn sm ghost" href="/compare">All comparisons</a><a class="btn sm" href="/compare/${next.slug}">${esc(next.name)} <i class="fa-solid fa-arrow-right"></i></a></div>
<p class="hint-r">Based on public documentation as of Nov 2026. Corrections welcome.</p>
</div></section>`,
  );
}
