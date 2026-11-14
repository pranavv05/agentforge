/* AgentForge destination pages: playgrounds for /product/*, /resources/*, /compare. No dependencies. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var page = document.body.getAttribute('data-page') || '';

  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || 'Request failed'); e.status = r.status; throw e; } return j; }); });
  }
  function get(url) { return fetch(url, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('Request failed'); return r.json(); }); }
  var money = function (n) { return '$' + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(n < 10 ? 3 : 2)); };

  /* =========================================================== pipeline */
  function pipeline() {
    var S = null, from = $('#pl-from'), to = $('#pl-to'), map = $('#pl-map'), out = $('#pl-out'), log = $('#pl-log'), cnt = $('#pl-count'), n = 0;
    var actor = function () { return ($('input[name=pl-actor]:checked') || {}).value || 'orchestrator'; };
    var setActor = function (v) { var r = $('input[name=pl-actor][value=' + v + ']'); if (r) r.checked = true; };
    get('/api/public/states').then(function (d) {
      S = d;
      var opts = d.states.map(function (s) { return '<option>' + s + '</option>'; }).join('');
      from.innerHTML = opts; to.innerHTML = opts;
      from.value = 'REQ_AWAITING_APPROVAL'; to.value = 'REQ_APPROVED';
      draw();
    }).catch(function () { map.innerHTML = '<div class="verdict caught">Could not load the states. Reload the page.</div>'; });

    function legal(cur) { return S.edges.filter(function (e) { return e.from === cur; }).map(function (e) { return e.to; }); }
    function draw() {
      var cur = from.value, nx = legal(cur);
      map.innerHTML = S.pipeline.map(function (g) {
        return '<div class="scol"><h6>' + esc(g.label) + '</h6>' + g.states.map(function (s) {
          var cls = 'schip' + (s === cur ? ' cur' : nx.indexOf(s) >= 0 ? ' nx' : '') + (S.terminal.indexOf(s) >= 0 ? ' term' : '');
          return '<button type="button" class="' + cls + '" data-s="' + s + '">' + s + '</button>';
        }).join('') + '</div>';
      }).join('');
      var pre = ['CREATED', 'FAILED'];
      map.insertAdjacentHTML('afterbegin', '<div class="scol"><h6>Start / end</h6>' + pre.map(function (s) {
        var cls = 'schip' + (s === cur ? ' cur' : nx.indexOf(s) >= 0 ? ' nx' : '') + (S.terminal.indexOf(s) >= 0 ? ' term' : '');
        return '<button type="button" class="' + cls + '" data-s="' + s + '">' + s + '</button>';
      }).join('') + '</div>');
      $$('.schip', map).forEach(function (b) { b.addEventListener('click', function () { from.value = b.dataset.s; draw(); }); });
    }
    from.addEventListener('change', draw);

    function attempt() {
      var a = actor(), f = from.value, t = to.value;
      out.innerHTML = '<div class="verdict idle">Checking…</div>';
      return post('/api/public/transition', { from: f, to: t, actor: a }).then(function (r) {
        var h;
        if (r.ok) {
          h = '<div class="verdict ok"><b class="ct"><i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> Allowed</b><p class="why" style="margin:6px 0 0;font-size:13.5px">' + esc(r.message) + '</p></div>';
        } else {
          var fix = r.next && r.next.length ? 'From <code>' + esc(f) + '</code> the legal moves are: ' + r.next.map(function (x) { return '<code>' + esc(x.to) + '</code> (by ' + esc(x.by) + ')'; }).join(', ') + '.' : '<code>' + esc(f) + '</code> has no outgoing moves.';
          h = '<div class="verdict caught"><b class="ct"><i class="fa-solid fa-shield-halved"></i> Refused by the orchestrator <span class="tag caught" style="margin-left:4px">HTTP ' + r.http + ' · ' + esc(r.code) + '</span></b><p class="why">' + esc(r.message) + '</p><p class="fix"><b>Why this is good:</b> ' + (a === 'agent' ? 'agents can only propose artifacts, so a model can never approve its own work.' : 'only edges in the table exist, and each names who may take it.') + '<br>' + fix + '</p></div>';
        }
        out.innerHTML = h;
        n++; cnt.textContent = n + ' attempt' + (n === 1 ? '' : 's');
        if (n === 1) log.innerHTML = '';
        log.insertAdjacentHTML('afterbegin', '<li><span class="tag ' + (r.ok ? 'ok' : 'caught') + '">' + (r.ok ? 'allowed' : '<i class="fa-solid fa-shield-halved"></i> refused') + '</span><div><b style="font-size:12.5px">' + esc(a) + '</b> <code>' + esc(f) + ' → ' + esc(t) + '</code></div></li>');
        if (r.ok) { from.value = t; draw(); var nx = legal(t); if (nx[0]) to.value = nx[0]; }
      }).catch(function (e) { out.innerHTML = '<div class="verdict caught">' + esc(e.message) + '</div>'; });
    }
    $('#pl-go').addEventListener('click', attempt);
    var P = {
      'agent-approve': function () { from.value = 'REQ_AWAITING_APPROVAL'; to.value = 'REQ_APPROVED'; setActor('agent'); },
      'skip': function () { from.value = 'REQ_APPROVED'; to.value = 'TASKS_GENERATED'; setActor('orchestrator'); },
      'reopen': function () { from.value = 'DONE'; to.value = 'IMPLEMENTING'; setActor('human'); },
      'human-approve': function () { from.value = 'REQ_AWAITING_APPROVAL'; to.value = 'REQ_APPROVED'; setActor('human'); }
    };
    $$('#pl-presets .pbtn').forEach(function (b) { b.addEventListener('click', function () { if (!S) return; P[b.dataset.p](); draw(); attempt(); }); });
  }

  /* =========================================================== grounding */
  function grounding() {
    var F = $('#gv-file'), S = $('#gv-s'), E = $('#gv-e'), Y = $('#gv-sym'), out = $('#gv-out'), code = $('#gv-code'), flist = $('#gv-flist'), dl = $('#gv-files'), tally = $('#gv-tally');
    var files = [], shown = '', cache = {}, t = { ok: 0, caught: 0 };
    var PRE = {
      1: { f: 'src/tax/tds.ts', s: 9, e: 17, y: 'computeTds' },
      2: { f: 'src/tax/tds393.ts', s: 12, e: 30, y: 'computeSection393' },
      3: { f: 'src/payments/vendorPayments.ts', s: 400, e: 420, y: 'payVendor' },
      4: { f: 'src/invoices/invoiceService.ts', s: 1, e: 5, y: 'submitInvoice' }
    };
    get('/api/public/files').then(function (d) {
      files = d.files; $('#gv-repo').textContent = d.name + ' · ' + files.length + ' files';
      dl.innerHTML = files.map(function (f) { return '<option value="' + esc(f.path) + '">'; }).join('');
      flist.innerHTML = files.map(function (f) { return '<button type="button" data-f="' + esc(f.path) + '">' + esc(f.path.split('/').pop()) + '</button>'; }).join('');
      $$('button', flist).forEach(function (b) { b.addEventListener('click', function () { F.value = b.dataset.f; showFile(F.value); }); });
      F.value = PRE[1].f; showFile(F.value);
    });
    function showFile(p, hi, miss) {
      shown = p;
      $$('button', flist).forEach(function (b) { b.classList.toggle('on', b.dataset.f === p); });
      var render = function (txt) {
        var L = txt.split('\n'); if (L[L.length - 1] === '') L.pop();
        code.innerHTML = L.map(function (l, i) {
          var no = i + 1, c = hi && no >= hi[0] && no <= hi[1] ? ' hit' : '';
          return '<span class="r' + c + '"><span class="n">' + no + '</span>' + esc(l) + '</span>';
        }).join('') + (miss ? '<span class="r miss"><span class="n">!</span>Lines ' + miss[0] + '-' + miss[1] + ' do not exist: this file ends at line ' + L.length + '.</span>' : '');
        var h = $('.r.hit', code); if (h) code.scrollTop = Math.max(0, h.offsetTop - 60);
      };
      if (cache[p]) return render(cache[p]);
      if (!files.some(function (f) { return f.path === p; })) { code.innerHTML = '<span class="r"><span class="n">!</span>No file named ' + esc(p) + ' exists in this repository.</span>'; return; }
      get('/api/public/file?path=' + encodeURIComponent(p)).then(function (d) { cache[p] = d.content; render(d.content); });
    }
    function run() {
      var body = { file: F.value.trim(), line_start: +S.value, line_end: +E.value, symbol: Y.value.trim() };
      out.innerHTML = '<div class="verdict idle">Checking…</div>';
      post('/api/public/claim', body).then(function (r) {
        var v = r.verdict;
        if (v.ok) {
          t.ok++;
          out.innerHTML = '<div class="verdict ok"><b class="ct"><i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> Verified</b><p class="why" style="margin:6px 0 0;font-size:13.5px">The file exists, lines ' + body.line_start + '–' + body.line_end + ' are real and <code>' + esc(body.symbol) + '</code> appears inside them. This claim is safe to keep in the design.</p></div>';
          showFile(body.file, [body.line_start, body.line_end]);
        } else {
          t.caught++;
          var x = r.explain;
          out.innerHTML = '<div class="verdict caught"><b class="ct"><i class="fa-solid fa-shield-halved"></i> ' + esc(x.title) + ' <span class="tag caught" style="margin-left:4px">' + esc(v.reason) + '</span></b><p class="why">' + esc(x.why) + '</p><p class="fix"><b>Fix:</b> ' + esc(x.fix) + '</p>' + (x.alt ? '<button class="btn sm" type="button" id="gv-apply"><i class="fa-solid fa-wand-magic-sparkles"></i> Apply the fix and re-verify</button>' : '') + '</div>';
          if (x.alt) $('#gv-apply').addEventListener('click', function () { F.value = x.alt.file; S.value = x.alt.line_start; E.value = x.alt.line_end; run(); });
          if (v.reason === 'file_not_found') showFile(body.file);
          else if (v.reason === 'range_invalid') showFile(body.file, null, r.file_lines && body.line_end > r.file_lines ? [Math.max(body.line_start, r.file_lines + 1), body.line_end] : null);
          else showFile(body.file, [body.line_start, body.line_end]);
        }
        tally.innerHTML = '<span><b>' + t.ok + '</b> verified</span><span><b>' + t.caught + '</b> caught before approval</span>';
      }).catch(function (e) { out.innerHTML = '<div class="verdict caught">' + esc(e.message) + '</div>'; });
    }
    $('#gv-go').addEventListener('click', run);
    $$('#gv-presets .pbtn').forEach(function (b) { b.addEventListener('click', function () { var p = PRE[b.dataset.p]; F.value = p.f; S.value = p.s; E.value = p.e; Y.value = p.y; run(); }); });
    F.addEventListener('change', function () { showFile(F.value.trim()); });
  }

  /* =========================================================== compliance */
  function compliance() {
    var li = $('#lt-in'), lo = $('#lt-out'), debounce;
    function lint() {
      var t = li.value;
      if (!t.trim()) { lo.innerHTML = '<div class="verdict idle">Type a design sentence.</div>'; return; }
      post('/api/public/lint', { text: t }).then(function (r) {
        if (r.ok) { lo.innerHTML = '<div class="verdict ok"><b class="ct"><i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> No legacy sections found</b></div>'; return; }
        var seen = {}, hits = r.hits.filter(function (h) { if (seen[h.match]) return false; seen[h.match] = 1; return true; });
        lo.innerHTML = '<div class="verdict caught"><b class="ct"><i class="fa-solid fa-shield-halved"></i> Caught ' + hits.map(function (h) { return '<mark class="bad">Section ' + esc(h.match) + '</mark>'; }).join(' ') + '</b><p class="why">These sections no longer exist in the Income-tax Act 2025.</p><p class="fix"><b>Fix:</b> map each to a Section 393 row: technical fees 2% (code 1026), professional fees 10% (code 1027), contractors 1% (individual) or 2% (other).</p><button class="btn sm" type="button" id="lt-fix"><i class="fa-solid fa-wand-magic-sparkles"></i> Rewrite using Section 393</button></div>';
        $('#lt-fix').addEventListener('click', function () {
          li.value = li.value.replace(/\bSection\s+194J\b/g, 'Section 393 (code 1027, 10%)').replace(/\bSection\s+194C\b/g, 'Section 393 (contractor, 1% or 2%)').replace(/\bSection\s+194I\b/g, 'Section 393 (rent)').replace(/\b194[A-Z]{0,2}\b/g, 'Section 393');
          lint();
        });
      }).catch(function () { lo.innerHTML = '<div class="verdict caught">Could not reach the linter.</div>'; });
    }
    li.addEventListener('input', function () { clearTimeout(debounce); debounce = setTimeout(lint, 220); });
    $('#lt-bad').addEventListener('click', function () { li.value = 'Deduct TDS under Section 194J for professional fees and Section 194C for contractors.'; lint(); });
    $('#lt-good').addEventListener('click', function () { li.value = 'Deduct TDS under Section 393: professional fees at 10% (code 1027) and contractors at 1% or 2%.'; lint(); });
    lint();

    var R = window.__RULES || [], ri = $('#rf-in'), ro = $('#rf-out');
    function fire() {
      var low = ri.value.toLowerCase(), hit = R.filter(function (r) { return r.triggers.some(function (t) { return low.indexOf(t) >= 0; }); });
      if (!ri.value.trim()) { ro.innerHTML = '<div class="verdict idle">Describe a feature.</div>'; return; }
      ro.innerHTML = hit.length ? '<div class="verdict ok"><b class="ct"><i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> ' + hit.length + ' rule' + (hit.length === 1 ? '' : 's') + ' fire</b></div><div style="margin-top:10px;display:grid;gap:6px">' + hit.map(function (r) { return '<div class="row" style="padding:7px 10px;border:1px solid var(--line);border-radius:10px;font-size:13px"><span class="tag ' + (r.family === 'GST' ? 'acc' : 'v') + '">' + r.id + '</span><span>' + esc(r.title) + '</span></div>'; }).join('') + '</div>' : '<div class="verdict idle">No compliance rules match this description.</div>';
    }
    ri.addEventListener('input', fire); fire();

    var cat = $('#td-cat'), amt = $('#td-amt'), tout = $('#td-out'), tdeb;
    function calc() {
      var payee = ($('input[name=td-payee]:checked') || {}).value;
      post('/api/public/tds', { category: cat.value, payee: payee, amount: +amt.value }).then(function (r) {
        tout.innerHTML = '<div class="bigout">₹' + r.tds.toLocaleString('en-IN') + ' <small>TDS deducted</small></div><dl class="kv2" style="margin-top:14px"><dt>Category</dt><dd>' + esc(r.category) + '</dd><dt>Payee</dt><dd>' + esc(r.payee) + '</dd><dt>Rate</dt><dd>' + r.rate + '%' + (r.code ? ' · code ' + r.code : '') + '</dd><dt>Gross</dt><dd>₹' + r.amount.toLocaleString('en-IN') + '</dd><dt>Net paid</dt><dd>₹' + r.net.toLocaleString('en-IN') + '</dd><dt>Basis</dt><dd>' + esc(r.section) + '</dd></dl><p class="hint-r">' + esc(r.note) + '</p>';
      }).catch(function (e) { tout.innerHTML = '<div class="verdict caught">' + esc(e.message) + '</div>'; });
    }
    cat.addEventListener('change', calc); $$('input[name=td-payee]').forEach(function (x) { x.addEventListener('change', calc); });
    amt.addEventListener('input', function () { clearTimeout(tdeb); tdeb = setTimeout(calc, 200); }); calc();
  }

  /* =========================================================== bring your own key (client-side only; nothing is sent or stored) */
  function byok() {
    var inp = $('#bk-in'), out = $('#bk-out'), eye = $('#bk-eye'), field = $('#bk-field');
    function set(kind, icon, msg) {
      out.className = 'kb-status ' + kind; field.className = 'kb-field ' + kind;
      out.innerHTML = '<i class="fa-solid ' + icon + '"></i> ' + esc(msg);
    }
    function check() {
      var k = inp.value.trim();
      if (!k) set('idle', 'fa-lock', 'Checked in your browser only. Never sent from this page.');
      else if (/^sk-ant-/.test(k)) set('ok', 'fa-circle-check', 'Looks like a valid Claude key.');
      else if (/^sk-/.test(k) || /^AIza/.test(k) || /^gsk_/.test(k)) set('bad', 'fa-circle-exclamation', 'That looks like a different provider\u2019s key. Only Claude keys work for now.');
      else set('bad', 'fa-circle-exclamation', 'That does not look like an API key. Claude keys start with sk-ant-.');
    }
    inp.addEventListener('input', check);
    eye.addEventListener('click', function () {
      var h = inp.type === 'password'; inp.type = h ? 'text' : 'password';
      eye.innerHTML = '<i class="fa-solid ' + (h ? 'fa-eye-slash' : 'fa-eye') + '"></i>';
    });
    check();
  }

  /* =========================================================== edit hook */
  function edithook() {
    var st = $('#eh-st'), tool = $('#eh-tool'), out = $('#eh-out'), walk = $('#eh-walk');
    var order = [];
    get('/api/public/states').then(function (d) {
      order = d.states; st.innerHTML = order.map(function (s) { return '<option>' + s + '</option>'; }).join(''); st.value = 'REQ_AWAITING_APPROVAL'; ask(); drawWalk();
    });
    function ask() {
      post('/api/public/hook', { status: st.value, tool: tool.value }).then(function (r) {
        var ok = r.decision === 'allow';
        out.innerHTML = '<div class="verdict ' + (ok ? 'ok' : 'caught') + '"><b class="ct"><i class="fa-solid ' + (ok ? 'fa-circle-check' : 'fa-shield-halved') + '" style="' + (ok ? 'color:var(--ok)' : '') + '"></i> ' + (ok ? 'Allowed' : 'Denied') + ' <span class="tag ' + (ok ? 'ok' : 'caught') + '" style="margin-left:4px">exit ' + r.exit_code + '</span></b><p class="why" style="margin:6px 0 0;font-size:13.5px">' + esc(r.reason) + '</p>' +
          (r.output ? '<pre class="hookout">' + esc(JSON.stringify(r.output, null, 2)) + '</pre>' : '<pre class="hookout">(no output, exit 0: normal permission flow continues)</pre>') + '</div>';
      }).catch(function (e) { out.innerHTML = '<div class="verdict caught">' + esc(e.message) + '</div>'; });
    }
    function drawWalk() {
      $('#eh-walk-h').textContent = 'What the hook says for ' + tool.value + ' in each state.';
      Promise.all(order.map(function (s) { return post('/api/public/hook', { status: s, tool: tool.value }); })).then(function (rs) {
        walk.innerHTML = rs.map(function (r, i) { return '<div class="' + r.decision + '"><span>' + order[i] + '</span><span class="sp"></span><b>' + r.decision + '</b></div>'; }).join('');
      });
    }
    $('#eh-go').addEventListener('click', ask);
    st.addEventListener('change', ask); tool.addEventListener('change', function () { ask(); drawWalk(); });
  }

  /* =========================================================== errors */
  function errors() {
    var E = window.__ERR || [], rows = $$('#er-t tr.er'), q = $('#er-q'), n = $('#er-n');
    function toggle(r) { var ex = $('#ex-' + r.dataset.i), open = ex.hidden; ex.hidden = !open; r.setAttribute('aria-expanded', open); }
    rows.forEach(function (r) { r.addEventListener('click', function () { toggle(r); }); r.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(r); } }); });
    q.addEventListener('input', function () {
      var v = q.value.trim().toLowerCase(), c = 0;
      rows.forEach(function (r) { var e = E[+r.dataset.i], m = !v || (e.code + ' ' + e.http + ' ' + e.meaning + ' ' + e.cause + ' ' + e.fix).toLowerCase().indexOf(v) >= 0; r.hidden = !m; if (!m) $('#ex-' + r.dataset.i).hidden = true; if (m) c++; });
      n.textContent = c + ' code' + (c === 1 ? '' : 's');
    });
    var pa = $('#er-paste'), dec = $('#er-dec');
    pa.addEventListener('input', function () {
      var t = pa.value.trim(); if (!t) { dec.innerHTML = ''; return; }
      var code = null; try { var j = JSON.parse(t); code = (j.error && (j.error.code || j.error)) || j.code; } catch (e) { var m = /[A-Z_]{5,}/.exec(t); code = m && m[0]; }
      var hit = E.filter(function (x) { return x.code === String(code || '').toUpperCase(); })[0];
      dec.innerHTML = hit ? '<div class="verdict ok" style="margin:0"><b class="ct"><i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> ' + hit.code + ' · HTTP ' + hit.http + '</b><p class="why" style="margin:6px 0 0;font-size:13.5px">' + esc(hit.meaning) + ' ' + esc(hit.cause) + '</p><p class="fix" style="margin:8px 0 0;font-size:13px"><b>Fix:</b> ' + esc(hit.fix) + '</p></div>' : '<div class="verdict idle" style="margin:0">No known code found in that text.</div>';
    });
  }

  /* =========================================================== templates */
  function templates() {
    $$('.tpl').forEach(function (a) {
      var pre = $('pre', a), file = a.dataset.file;
      a.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'copy') {
          var done = function () { var o = b.innerHTML; b.innerHTML = '<i class="fa-solid fa-check"></i> Copied'; setTimeout(function () { b.innerHTML = o; }, 1400); };
          if (navigator.clipboard) navigator.clipboard.writeText(pre.textContent).then(done, done); else done();
        } else {
          var u = URL.createObjectURL(new Blob([pre.textContent], { type: 'text/markdown' })), l = document.createElement('a');
          l.href = u; l.download = file; document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 500);
        }
      });
    });
  }

  /* =========================================================== compare fit quiz */
  function fit() {
    var out = $('#fit-out'); if (!out) return;
    function link(h, t) { return '<a class="btn acc" href="' + h + '">' + t + ' <i class="fa-solid fa-arrow-right"></i></a>'; }
    function rec() {
      var a = {}; ['q1', 'q2', 'q3', 'q4'].forEach(function (k) { var r = $('input[name=' + k + ']:checked'); a[k] = r && r.value; });
      if (!a.q1 || !a.q2 || !a.q3 || !a.q4) return;
      var r;
      if (a.q3 === 'kiro') r = { t: 'Kiro', tag: 'Best fit', p: 'You already live in the Kiro IDE, and it enforces gates inside that editor.', b: ['Smooth, integrated experience', 'Student plan with free credits'], h: '/compare/kiro', n: 'Read AgentForge vs Kiro', warn: a.q2 === 'audit' ? 'Because you need to prove what happened to an auditor, also see what AgentForge adds: a hash-bound approval record that does not depend on the editor.' : '' };
      else if (a.q2 === 'audit' || (a.q2 === 'lead' && a.q4 === 'gates')) r = { t: 'AgentForge', tag: 'Best fit', p: 'You need approvals that cannot be skipped and a record of exactly what was approved.', b: ['Server-enforced stage order, agents can never approve', 'Approvals bound to a document hash, append-only audit log', a.q1 === 'existing' ? 'Every codebase claim checked against a real file and line' : 'Cost cap and compliance rules from the first spec'], h: '/product/pipeline', n: 'Try to break the pipeline', warn: a.q3 === 'many' ? 'Honest limit: AgentForge ships a Claude Code plugin and MCP server, not integrations for dozens of agents. If agent coverage matters more than enforcement, see Spec Kit.' : '' };
      else if (a.q4 === 'full') r = { t: 'BMAD-METHOD', tag: 'Best fit', p: 'You want a complete agile planning method with agent personas.', b: ['21 personas and 50+ workflows', 'PRD, architecture and stories'], h: '/compare/bmad', n: 'Read AgentForge vs BMAD', warn: 'It is heavy for a single feature and its review steps are a convention rather than a gate.' };
      else if (a.q1 === 'existing' && a.q4 === 'min') r = { t: 'OpenSpec', tag: 'Best fit', p: 'You want the lowest-friction way to keep specs and changes tidy on an existing project.', b: ['Delta-spec model: current versus change', 'Very little ceremony, MIT'], h: '/compare/openspec', n: 'Read AgentForge vs OpenSpec', warn: '' };
      else if (a.q3 === 'many') r = { t: 'GitHub Spec Kit', tag: 'Best fit', p: 'You use several coding agents and want shared, well-tested templates with no server to run.', b: ['Works across 41 coding agents', 'MIT, stable 1.0, large community'], h: '/compare/spec-kit', n: 'Read AgentForge vs Spec Kit', warn: 'Its gates rely on a human reading the output. If you later need a provable refusal, that is where AgentForge differs.' };
      else r = { t: 'AgentForge', tag: 'Good fit', p: 'A short pipeline with a few real gates, and Claude Code as your agent.', b: ['Requirements, design, tasks with two real approval gates', 'Edit hook blocks code changes until both are approved'], h: '/product/pipeline', n: 'Explore the pipeline', warn: '' };
      out.innerHTML = '<div class="rec"><span class="tag acc">' + r.tag + '</span><h3>' + esc(r.t) + '</h3><p>' + esc(r.p) + '</p><ul>' + r.b.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' + (r.warn ? '<p style="font-size:13px">' + esc(r.warn) + '</p>' : '') + link(r.h, r.n) + '</div>';
    }
    $$('#fit input').forEach(function (i) { i.addEventListener('change', rec); });
  }

  /* error table rows share the .etbl tr.ex hidden attr */
  var map = { pipeline: pipeline, grounding: grounding, compliance: compliance, byok: byok, edithook: edithook, errors: errors, templates: templates, compare: fit };
  if (map[page]) map[page]();
})();
