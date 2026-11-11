(function(){
'use strict';
var $=function(s,r){return (r||document).querySelector(s)};
var view=$('#view');
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var money=function(n){n=Number(n)||0;return '$'+(n<0.01&&n>0?n.toFixed(4):n.toFixed(n<10?3:2))};
var ago=function(s){if(!s)return '';var d=new Date(String(s).replace(' ','T')+'Z');var m=Math.round((Date.now()-d)/60000);if(m<1)return 'just now';if(m<60)return m+'m ago';var h=Math.round(m/60);if(h<24)return h+'h ago';return Math.round(h/24)+'d ago'};
function md(src){try{return DOMPurify.sanitize(marked.parse(String(src||''),{gfm:true,breaks:false}))}catch(e){return '<pre>'+esc(src)+'</pre>'}}

function api(path,opts){
  opts=opts||{};var o={method:opts.method||'GET',headers:{},credentials:'same-origin'};
  if(opts.body!==undefined){o.method=opts.method||'POST';o.headers['content-type']='application/json';o.body=JSON.stringify(opts.body)}
  return fetch(path,o).then(function(r){
    if(r.status===401){location.href='/login?next=/app';throw new Error('unauthorized')}
    return r.json().catch(function(){return {}}).then(function(j){if(!r.ok){var e=new Error(j.message||'Request failed');e.code=(j.error&&j.error.code)||j.error;e.status=r.status;throw e}return j})
  });
}
function toast(msg,bad){var box=$('#toasts');if(!box){box=document.createElement('div');box.id='toasts';box.setAttribute('aria-live','polite');document.body.appendChild(box)}var t=document.createElement('div');t.className='toast'+(bad?' bad':'');t.setAttribute('role','status');t.textContent=msg;box.appendChild(t);setTimeout(function(){t.remove()},bad?6000:3200)}

var STATUS={
 CREATED:['Created','tag'],CONTEXT_SCANNING:['Scanning context','tag acc'],CONTEXT_READY:['Context ready','tag ok'],
 REQ_DRAFTING:['Drafting requirements','tag acc'],REQ_AWAITING_CLARIFICATION:['Needs your answers','tag warn'],REQ_AWAITING_APPROVAL:['Requirements: approve?','tag warn'],REQ_APPROVED:['Requirements approved','tag ok'],
 DESIGN_DRAFTING:['Drafting design','tag acc'],DESIGN_AWAITING_APPROVAL:['Design: approve?','tag warn'],DESIGN_APPROVED:['Design approved','tag ok'],
 FAILED:['Failed','tag bad'],TASKS_GENERATED:['Tasks generated','tag acc'],READY_FOR_IMPLEMENTATION:['Ready to implement','tag ok'],IMPLEMENTING:['Implementing','tag v'],DONE:['Done','tag ok']
};
var ACT={spec_created:'Spec created',context_ready:'Code context scanned',questions_asked:'Questions asked',answers_submitted:'Answers submitted',requirements_drafted:'Requirements drafted',requirements_approved:'Requirements approved',design_drafted:'Design drafted',design_approved:'Design approved',changes_requested:'Changes requested',requirements_rejected:'Requirements rejected',design_rejected:'Design rejected',requirements_changes_requested:'Requirements: changes requested',design_changes_requested:'Design: changes requested',tasks_generated:'Tasks generated',task_completed:'Task completed',transition:'Status changed'};
function act(a){a=String(a||'');return ACT[a]||(a.replace(/_/g,' ').replace(/^./,function(c){return c.toUpperCase()}))}
function stl(x){return (STATUS[x]||[String(x||'').replace(/_/g,' ').toLowerCase()])[0]}
function who(t){return t==='human'?'You':t==='agent'?'Agent':'System'}
function st(s){var x=STATUS[s]||[s,'tag'];return '<span class="'+x[1]+'">'+esc(x[0])+'</span>'}

/* ---------- shell ---------- */
var sb=$('#sb'),scrim=$('#scrim');
function closeSb(){sb.classList.remove('open');scrim.classList.remove('show')}
$('#sb-open').addEventListener('click',function(){sb.classList.add('open');scrim.classList.add('show')});
scrim.addEventListener('click',closeSb);
$('#logout').addEventListener('click',function(){api('/api/auth/logout',{method:'POST',body:{}}).catch(function(){}).then(function(){location.href='/'})});

function setActive(r){document.querySelectorAll('.sb nav a').forEach(function(a){a.classList.toggle('on',a.dataset.r===r)});closeSb()}
function loading(){view.innerHTML='<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i>Loading…</div>'}
function fail(e){view.innerHTML='<div class="card empty"><i class="fa-solid fa-triangle-exclamation"></i><b>'+esc(e.message||'Something went wrong')+'</b><p><a class="btn sm" href="#/">Back to overview</a></p></div>'}

function refreshPending(){
  api('/api/stats').then(function(s){var n=$('#pend-n');n.textContent=s.pending.length;n.hidden=!s.pending.length}).catch(function(){});
}


/* ---------- entrance motion: stagger blocks + count up numbers on every render ---------- */
var REDUCE=matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el){
  var m=/^([^0-9\u2014-]*)(\d+(?:\.\d+)?)(.*)$/.exec(el.textContent.trim());if(!m)return;
  var pre=m[1],to=parseFloat(m[2]),post=m[3],dec=(m[2].split('.')[1]||'').length,t0=performance.now(),dur=1100;
  (function f(t){var k=Math.min(1,(t-t0)/dur);k=1-Math.pow(1-k,4);el.textContent=pre+(to*k).toFixed(dec)+post;if(k<1)requestAnimationFrame(f)})(t0);
}
var animQ=false;
function animateView(){
  if(REDUCE||animQ)return;animQ=true;
  requestAnimationFrame(function(){animQ=false;
    var els=view.querySelectorAll('.top,.kpi,.card,.act,.step,.tabs,.stepper');var i=0;
    els.forEach(function(e){if(e.dataset.a)return;e.dataset.a=1;e.style.setProperty('--i',Math.min(i++,12));e.classList.add('a-in')});
    view.querySelectorAll('.kpi .v').forEach(function(e){if(e.dataset.c)return;e.dataset.c=1;countUp(e)});
    view.querySelectorAll('.tbl tbody tr,.tl li,.gs li').forEach(function(e,n){if(e.dataset.a)return;e.dataset.a=1;e.style.setProperty('--i',Math.min(n,14)+3);e.classList.add('a-in')});
  });
}
new MutationObserver(animateView).observe(view,{childList:true,subtree:true});

/* ---------- router ---------- */
var routes=[
 [/^#\/?$/,home,'home'],[/^#\/specs$/,specs,'specs'],[/^#\/new$/,newSpec,'new'],[/^#\/spec\/([A-Za-z0-9-]+)(?:\/(\w+))?$/,specDetail,'specs'],
 [/^#\/lab$/,lab,'lab'],[/^#\/compliance$/,compliance,'compliance']
];
function route(){
  var h=location.hash||'#/';
  for(var i=0;i<routes.length;i++){var m=routes[i][0].exec(h);if(m){setActive(routes[i][2]);loading();window.scrollTo(0,0);try{routes[i][1].apply(null,m.slice(1))}catch(e){fail(e)}refreshPending();return}}
  location.hash='#/';
}
window.addEventListener('hashchange',route);

/* ---------- overview ---------- */
function home(){
  Promise.all([api('/api/stats'),api('/api/specs')]).then(function(r){
    var s=r[0],specs=r[1].specs,first=(window.__USER.name||'there').split(' ')[0];
    var g=s.grounding,c=s.compliance;
    var h='<div class="top"><div><div class="crumb">Workspace</div><h1>Welcome back, '+esc(first)+'</h1></div><span style="flex:1"></span><a class="btn dark" href="#/new"><i class="fa-solid fa-plus"></i> New spec</a></div>';
    if(window.__USER.demo)h+='<div class="act ok"><h4><i class="fa-solid fa-circle-info"></i> You are in a demo workspace</h4><span style="font-size:14px">A sample spec is waiting for your answers. Open it, answer the questions, then approve requirements and design to unlock implementation.</span></div>';
    h+='<div class="cards">'+
      kpi('Specs',s.total_specs,'<i class="fa-solid fa-file-lines"></i>',s.pending.length?s.pending.length+' waiting on you':'Nothing waiting on you','#/specs')+
      kpi('Claims verified',g.claims?(100-Math.round(g.rate*100))+'%':'\u2014','<i class="fa-solid fa-shield-halved"></i>',g.claims?(g.claims-g.unverified)+' of '+g.claims+' design claims checked out':'Appears after your first design','#/lab')+
      kpi('Compliance covered',c.required?c.traced+' of '+c.required:'\u2014','<i class="fa-solid fa-scale-balanced"></i>',c.required?'rules traced to tasks':'Appears when a rule applies','#/compliance')+
      kpi('Spend (simulated)',money(s.cost.total),'<i class="fa-solid fa-coins"></i>',s.cost.calls?s.cost.calls+' model calls':'No calls yet',specs[0]?'#/spec/'+specs[0].id+'/cost':'#/specs')+'</div>';
    var by=s.by_status||{};
    var has=function(list){return Object.keys(by).some(function(k){return list.indexOf(k)>-1})};
    var anyReq=has(['REQ_APPROVED','DESIGN_DRAFTING','DESIGN_AWAITING_APPROVAL','DESIGN_APPROVED','TASKS_GENERATED','READY_FOR_IMPLEMENTATION','IMPLEMENTING','DONE']);
    var anyDes=has(['DESIGN_APPROVED','TASKS_GENERATED','READY_FOR_IMPLEMENTATION','IMPLEMENTING','DONE']);
    var anyDone=!!by.DONE,sid=specs[0]?specs[0].id:'';
    var steps=[[s.total_specs>0,'Create a spec','Describe a feature and let the agents draft it.','#/new'],[anyReq,'Approve the requirements','Review the draft and approve it, or request changes.',sid?'#/spec/'+sid:'#/specs'],[anyDes,'Approve the design','Check the claim verification before you approve.',sid?'#/spec/'+sid:'#/specs'],[anyDone,'Complete the tasks','Implementation unlocks after both approvals.',sid?'#/spec/'+sid+'/tasks':'#/specs']];
    var left=steps.filter(function(x){return !x[0]}).length;
    if(left)h+='<div class="card" style="margin-bottom:16px"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Getting started</h3><span class="sp"></span><span class="tag acc">'+(steps.length-left)+' of '+steps.length+' done</span></div><ul class="gs" style="padding:0;margin:0">'+steps.map(function(x,i){return '<li class="'+(x[0]?'done':'')+'"><span class="n">'+(x[0]?'<i class="fa-solid fa-check"></i>':(i+1))+'</span><div style="flex:1"><b>'+esc(x[1])+'</b><span>'+esc(x[2])+'</span></div>'+(x[0]?'':'<a class="btn sm" href="'+x[3]+'">Go</a>')+'</li>'}).join('')+'</ul></div>';
    h+='<div class="grid2"><div class="card"><h3>Needs your attention</h3><p class="hint">Steps only you can complete. Agents cannot approve their own work.</p>';
    if(!s.pending.length)h+='<div class="empty" style="padding:22px"><i class="fa-solid fa-circle-check"></i>Nothing is waiting on you.</div>';
    else h+='<table class="tbl"><tbody>'+s.pending.map(function(p){return '<tr class="click" data-go="#/spec/'+esc(p.id)+'"><td><b>'+esc(p.title)+'</b><br><span style="color:var(--mute2);font-size:12.5px">'+esc(p.id)+' \u00b7 '+(p.case_type==='B'?'Brownfield':'Greenfield')+'</span></td><td style="text-align:right">'+st(p.status)+'</td></tr>'}).join('')+'</tbody></table>';
    h+='<h3 style="margin-top:22px">Recent activity</h3><p class="hint">From the tamper-proof audit log.</p>';
    if(!s.recent.length)h+='<div class="empty" style="padding:18px">No activity yet.</div>';
    else h+='<ul class="tl">'+s.recent.map(function(a){return '<li class="click '+esc(a.actor_type)+'" data-go="#/spec/'+esc(a.spec_id)+'/audit" tabindex="0"><b>'+esc(act(a.action))+'</b> \u00b7 '+esc(a.title)+'<div class="t">'+who(a.actor_type)+' \u00b7 '+esc(stl(a.from_status))+' &rarr; '+esc(stl(a.to_status))+' \u00b7 '+ago(a.created_at)+'</div></li>'}).join('')+'</ul>';
    h+='</div><div style="display:flex;flex-direction:column;gap:16px">'+
      '<div class="card"><h3>Where your specs are</h3><p class="hint">Number of specs at each stage.</p>'+pipeMix(s.by_status)+'</div>'+
      '<div class="card doc-card"><span class="tag" style="background:rgba(255,255,255,.14);color:#fff">Docs</span><h3 style="margin-top:12px;font-size:20px">New to AgentForge?</h3><p>The quickstart walks through your first spec in five minutes.</p><a class="btn acc" href="/docs/quickstart" target="_blank" rel="noopener">Open quickstart <i class="fa-solid fa-arrow-right"></i></a></div></div></div>';
    view.innerHTML=h;wireGo();
  }).catch(fail);
}
function kpi(l,v,i,d,go){return '<div class="kpi'+(go?' click':'')+'"'+(go?' data-go="'+go+'" tabindex="0" role="link"':'')+'><div class="l">'+i+' '+esc(l)+'</div><div class="v">'+esc(v)+'</div><div class="d">'+esc(d)+'</div></div>'}
function pipeMix(by){var keys=Object.keys(by);if(!keys.length)return '<div class="empty" style="padding:18px">Create your first spec.</div>';return keys.map(function(k){return '<div class="row click" data-go="#/specs" tabindex="0" style="padding:7px 0;border-bottom:1px dashed var(--line)">'+st(k)+'<span class="sp"></span><b>'+by[k]+'</b></div>'}).join('')}
function wireGo(){view.querySelectorAll('[data-go]').forEach(function(e){e.addEventListener('click',function(){location.hash=e.dataset.go});e.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();location.hash=e.dataset.go}})})}

/* ---------- specs list ---------- */
function specs(){
  api('/api/specs').then(function(r){
    var all=r.specs,flt='all',q='';
    var head='<div class="top"><div><div class="crumb">Workspace</div><h1>Specs</h1></div><span style="flex:1"></span><a class="btn dark" href="#/new"><i class="fa-solid fa-plus"></i> New spec</a></div>';
    if(!all.length){view.innerHTML=head+'<div class="card"><div class="empty"><i class="fa-solid fa-file-circle-plus"></i><b>No specs yet</b><p>Describe a feature and watch the pipeline run.</p><a class="btn dark sm" href="#/new">Create a spec</a></div></div>';return}
    var WAIT=['REQ_AWAITING_CLARIFICATION','REQ_AWAITING_APPROVAL','DESIGN_AWAITING_APPROVAL'],DONE=['DONE'],READY=['READY_FOR_IMPLEMENTATION','IMPLEMENTING','TASKS_GENERATED'];
    var F=[['all','All'],['wait','Needs you'],['ready','Ready to build'],['done','Done']];
    view.innerHTML=head+'<div class="card"><div class="sc"><input class="in" id="sq" type="search" placeholder="Search by title or ID" aria-label="Search specs"><div class="chips" id="sf" role="group" aria-label="Filter by status">'+F.map(function(f){return '<button type="button" data-f="'+f[0]+'" class="'+(f[0]==='all'?'on':'')+'">'+f[1]+'</button>'}).join('')+'</div></div><div id="slist"></div></div>';
    function draw(){
      var rows=all.filter(function(x){
        if(flt==='wait'&&WAIT.indexOf(x.status)<0)return false;if(flt==='ready'&&READY.indexOf(x.status)<0)return false;if(flt==='done'&&DONE.indexOf(x.status)<0)return false;
        return !q||(x.title+' '+x.id).toLowerCase().indexOf(q)>-1});
      $('#slist').innerHTML=rows.length?'<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Spec</th><th>Type</th><th>Status</th><th>Spend</th><th>Updated</th></tr></thead><tbody>'+rows.map(function(s){return '<tr class="click" data-go="#/spec/'+esc(s.id)+'"><td><b>'+esc(s.title)+'</b><br><span style="color:var(--mute2);font-size:12.5px">'+esc(s.id)+'</span></td><td><span class="tag '+(s.case_type==='B'?'v':'')+'">'+(s.case_type==='B'?'Brownfield':'Greenfield')+'</span></td><td>'+st(s.status)+'</td><td>'+money(s.cost)+' <span style="color:var(--mute2)">/ $'+Number(s.cap_usd).toFixed(2)+'</span></td><td style="color:var(--mute)">'+ago(s.updated_at)+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty" style="padding:28px"><i class="fa-solid fa-filter-circle-xmark"></i>No specs match.</div>';
      wireGo()}
    $('#sq').addEventListener('input',function(){q=this.value.trim().toLowerCase();draw()});
    $('#sf').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;flt=b.dataset.f;this.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});draw()});
    draw();
  }).catch(fail);
}

/* ---------- new spec ---------- */
function newSpec(){
  view.innerHTML='<div class="top"><div><div class="crumb"><a href="#/specs">Specs</a> / New</div><h1>New spec</h1></div></div>'+
  '<div class="row2" style="align-items:start"><form class="card" id="nf" novalidate>'+
  '<div class="field"><label for="n-title">Feature title</label><input class="in" id="n-title" maxlength="120" placeholder="e.g. Auto TDS on vendor payments" required></div>'+
  '<div class="field"><label for="n-desc">Describe the feature</label><textarea class="in" id="n-desc" maxlength="4000" style="min-height:140px" placeholder="What should it do? Hindi or Hinglish is welcome; the spec will be written in English."></textarea><small>Short sentences become separate requirements. Mentioning GST, e-invoice, TDS or vendor payments adds the matching compliance rules automatically.</small></div>'+
  '<div class="field"><label>Project type</label><div class="choice"><label><input type="radio" name="case" value="A"> New project<small>No existing code. Skips the code-scan step.</small></label><label><input type="radio" name="case" value="B" checked> Existing codebase<small>Scans the sample repo and verifies claims.</small></label></div></div>'+
  '<div class="field"><label>Model profile</label><div class="choice"><label><input type="radio" name="prof" value="dev" checked> Development<small>Fastest and cheapest. Good for drafts.</small></label><label><input type="radio" name="prof" value="demo"> Demo<small>Higher-quality writing. Costs more.</small></label></div></div>'+
  '<div class="field"><label for="n-cap">Per-run cost cap (USD)</label><input class="in" id="n-cap" type="number" min="0.1" max="10" step="0.1" value="2"><small>The orchestrator refuses a model call that would exceed this.</small></div>'+
  '<div class="field"><label class="chk" style="border:0;padding:0"><input type="checkbox" id="n-flaw" checked><span>Show the checks catching mistakes<br><small style="color:var(--mute2)">Existing codebase only. Adds a few deliberate errors so you can see the verifier and compliance lint flag them.</small></span></label></div>'+
  '<div class="err" id="n-err" role="alert"></div><button class="btn dark" id="n-go" type="submit">Create spec <i class="fa-solid fa-arrow-right"></i></button></form>'+
  '<div class="card"><h3>Try an example</h3><p class="hint">Click one to fill the form.</p>'+
  ex('TDS on vendor payments (Section 393)','Deduct TDS automatically on contractor and professional vendor payments. Show the deducted amount on each payment. Reject any reference to the legacy 194-series sections.','B')+
  ex('GST e-invoice IRN capture','Generate the e-invoice payload for every B2B invoice. Store the IRN returned by the portal against the invoice and lock the invoice afterwards.','B')+
  ex('Monthly ledger export (Hinglish)','Har mahine ka ledger report CSV mein export karna hai. Finance team ko email se bhejna hai.','A')+'</div></div>';
  var f=$('#nf');
  view.querySelectorAll('[data-ex]').forEach(function(b){b.addEventListener('click',function(){var d=JSON.parse(b.dataset.ex);$('#n-title').value=d.t;$('#n-desc').value=d.d;f.querySelector('input[name=case][value='+d.c+']').checked=true})});
  f.addEventListener('submit',function(e){e.preventDefault();var err=$('#n-err');err.classList.remove('show');
    var body={title:$('#n-title').value.trim(),description:$('#n-desc').value.trim(),mode:f.querySelector('input[name=case]:checked').value==='B'?'brownfield':'greenfield',profile:f.querySelector('input[name=prof]:checked').value,cap_usd:+$('#n-cap').value,inject_flaws:$('#n-flaw').checked};
    if(body.title.length<3){err.textContent='Please enter a title (3+ characters).';err.classList.add('show');return}
    if(body.description.length<10){err.textContent='Please describe the feature (10+ characters).';err.classList.add('show');return}
    var b=$('#n-go');b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Running agents…';
    api('/api/specs',{body:body}).then(function(r){if(r.warning)toast(r.warning,true);else toast('Spec created. Answer the clarifying questions.');location.hash='#/spec/'+r.id}).catch(function(x){err.textContent=x.message;err.classList.add('show');b.disabled=false;b.innerHTML='Create spec <i class="fa-solid fa-arrow-right"></i>'});
  });
}
function ex(t,d,c){return '<button type="button" class="sample" style="width:100%;margin-bottom:8px" data-ex=\''+esc(JSON.stringify({t:t,d:d,c:c}))+'\'><i class="fa-solid fa-wand-magic-sparkles" style="color:var(--acc2)"></i><span><b>'+esc(t)+'</b><br><code>'+(c==='B'?'Brownfield':'Greenfield')+'</code></span></button>'}


/* ---------- spec detail ---------- */
var PIPE=[['context','Context',['CONTEXT_SCANNING','CONTEXT_READY']],['req','Requirements',['REQ_DRAFTING','REQ_AWAITING_CLARIFICATION','REQ_AWAITING_APPROVAL','REQ_APPROVED']],['design','Design',['DESIGN_DRAFTING','DESIGN_AWAITING_APPROVAL','DESIGN_APPROVED']],['tasks','Tasks',['TASKS_GENERATED','READY_FOR_IMPLEMENTATION']],['impl','Implement',['IMPLEMENTING','DONE']]];
var ORDER=['CREATED','CONTEXT_SCANNING','CONTEXT_READY','REQ_DRAFTING','REQ_AWAITING_CLARIFICATION','REQ_AWAITING_APPROVAL','REQ_APPROVED','DESIGN_DRAFTING','DESIGN_AWAITING_APPROVAL','DESIGN_APPROVED','TASKS_GENERATED','READY_FOR_IMPLEMENTATION','IMPLEMENTING','DONE'];

function stepper(d){
  var s=d.spec,idx=ORDER.indexOf(s.status);if(s.status==='FAILED')idx=-1;
  return '<div class="stepper">'+PIPE.map(function(p){
    var skip=p[0]==='context'&&s.case_type==='A';
    var first=ORDER.indexOf(p[2][0]),last=ORDER.indexOf(p[2][p[2].length-1]);
    var cls=skip?'skip':(idx>last?'done':(idx>=first?'now':''));
    var sub=skip?'Existing codebase only':(cls==='done'?'Complete':(cls==='now'?(STATUS[s.status]||[s.status])[0]:'Pending'));
    var tgt={context:'context',req:'requirements',design:'design',tasks:'tasks',impl:'tasks'}[p[0]];
    return '<div class="step '+cls+(skip?'':' click')+'"'+(skip?'':' data-jump="'+tgt+'" tabindex="0" role="button" title="Open the '+tgt+' tab"')+'><b>'+(cls==='done'?'<i class="fa-solid fa-check"></i> ':'')+p[1]+'</b><span>'+esc(sub)+'</span></div>'}).join('')+'</div>';
}

function specDetail(id,tab){
  api('/api/specs/'+encodeURIComponent(id)).then(function(d){
    var s=d.spec,L=d.latest;
    var tabs=[['overview','Overview']];
    if(L.context)tabs.push(['context','Context']);
    if(L.requirements||L.questions)tabs.push(['requirements','Requirements']);
    if(L.design)tabs.push(['design','Design']);
    if(d.tasks.length)tabs.push(['tasks','Tasks']);
    tabs.push(['audit','Audit']);tabs.push(['cost','Cost']);
    if(!tab||!tabs.some(function(t){return t[0]===tab}))tab='overview';
    var h='<div class="top"><div><div class="crumb"><a href="#/specs">Specs</a> / '+esc(s.id)+'</div><h1>'+esc(s.title)+'</h1></div><span style="flex:1"></span>'+st(s.status)+'</div>'+stepper(d);
    h+=actionBox(d);
    h+='<div class="tabs" role="tablist">'+tabs.map(function(t){return '<button class="'+(t[0]===tab?'on':'')+'" data-tab="'+t[0]+'" role="tab">'+t[1]+'</button>'}).join('')+'</div><div id="tab-body"></div>';
    view.innerHTML=h;
    view.querySelectorAll('[data-tab]').forEach(function(b){b.addEventListener('click',function(){history.replaceState(null,'','#/spec/'+id+'/'+b.dataset.tab);view.querySelectorAll('[data-tab]').forEach(function(x){x.classList.toggle('on',x===b)});renderTab(d,b.dataset.tab)})});
    view.querySelectorAll('[data-jump]').forEach(function(e){var go=function(){var b=view.querySelector('[data-tab="'+e.dataset.jump+'"]');if(b){b.click();b.scrollIntoView({block:'center',behavior:'smooth'})}else toast('Nothing to show here yet. This stage has not produced a document.',false)};e.addEventListener('click',go);e.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();go()}})});
    renderTab(d,tab);wireActions(d);
  }).catch(fail);
}

function actionBox(d){
  var s=d.spec,L=d.latest,h='';
  if(s.status==='REQ_AWAITING_CLARIFICATION'&&L.questions){
    var qs=L.questions.data.questions;
    h+='<form class="act" id="qa-form"><h4><i class="fa-solid fa-circle-question"></i> The requirements agent needs your answers</h4><div style="font-size:13.5px;color:var(--mute)">Drafting is paused until you answer.</div>'+
      qs.map(function(q,i){return '<div class="qa"><label for="qa'+i+'">'+(i+1)+'. '+esc(q)+'</label><textarea class="in" id="qa'+i+'" style="min-height:64px" maxlength="1000" placeholder="Your answer"></textarea></div>'}).join('')+
      '<button class="btn dark" type="submit">Submit answers &amp; draft requirements</button></form>';
  } else if(s.status==='REQ_AWAITING_APPROVAL'||s.status==='DESIGN_AWAITING_APPROVAL'){
    var t=s.status==='REQ_AWAITING_APPROVAL'?'requirements':'design',a=L[t];
    h+='<div class="act"><h4><i class="fa-solid fa-user-check"></i> Your approval is required: '+t+' v'+a.version+'</h4><div style="font-size:13.5px;color:var(--mute);margin-bottom:10px">Your decision is tied to this exact version, fingerprint <span class="hash">'+esc(a.hash.slice(0,16))+'</span>. If the document changes before you submit, the decision is refused.</div>'+
      '<div class="field" style="margin-bottom:10px"><label for="dec-c" class="sr">Comment</label><textarea class="in" id="dec-c" style="min-height:60px" maxlength="2000" placeholder="Comment (required when requesting changes)"></textarea></div>'+
      '<div class="row" style="flex-wrap:wrap"><button class="btn dark" id="d-ok"><i class="fa-solid fa-check"></i> Approve '+t+'</button><button class="btn" id="d-chg"><i class="fa-solid fa-rotate-left"></i> Request changes</button><button class="btn danger" id="d-rej"><i class="fa-solid fa-ban"></i> Reject</button><span class="sp"></span><span style="font-size:12.5px;color:var(--mute2)">Review the '+t+' tab first</span></div></div>';
  } else if(s.status==='READY_FOR_IMPLEMENTATION'||s.status==='IMPLEMENTING'){
    h+='<div class="act ok"><h4><i class="fa-solid fa-lock-open"></i> Implementation unlocked</h4><div style="font-size:13.5px">Both approvals are recorded. Your coding agent is now allowed to edit. Mark tasks complete in the Tasks tab.</div></div>';
  } else if(s.status==='DONE'){
    h+='<div class="act ok"><h4><i class="fa-solid fa-flag-checkered"></i> All tasks complete</h4><div style="font-size:13.5px">Every task has evidence attached. See the Audit tab for the full trail.</div></div>';
  }
  return h;
}

function wireActions(d){
  var s=d.spec,L=d.latest;
  var qf=$('#qa-form');
  if(qf)qf.addEventListener('submit',function(e){e.preventDefault();var n=L.questions.data.questions.length,ans=[];for(var i=0;i<n;i++)ans.push($('#qa'+i).value.trim());
    if(ans.some(function(a){return !a})){toast('Please answer every question.',true);return}
    var b=qf.querySelector('button');b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Drafting…';
    api('/api/specs/'+s.id+'/answers',{body:{answers:ans,version:s.version}}).then(function(){toast('Requirements drafted. Review and approve.');route()}).catch(function(x){toast(x.message,true);b.disabled=false;b.textContent='Submit answers & draft requirements'})});
  var t=s.status==='REQ_AWAITING_APPROVAL'?'requirements':s.status==='DESIGN_AWAITING_APPROVAL'?'design':null;
  if(t){
    var send=function(decision){var c=($('#dec-c').value||'').trim();
      if(decision!=='approve'&&!c){toast('Add a comment explaining what to change.',true);$('#dec-c').focus();return}
      $('#d-ok').disabled=true;$('#d-chg').disabled=true;$('#d-rej').disabled=true;
      api('/api/specs/'+s.id+'/decision',{body:{decision:decision,comment:c,expected_version:s.version,content_hash:L[t].hash}}).then(function(){toast(decision==='approve'?'Approved. Next stage ran.':decision==='reject'?'Rejected. A new draft was produced.':'Changes requested. A revision was drafted.');route()}).catch(function(x){toast(x.message,true);$('#d-ok').disabled=false;$('#d-chg').disabled=false;$('#d-rej').disabled=false;if(x.code==='VERSION_CONFLICT'||x.code==='HASH_MISMATCH')setTimeout(route,1200)})};
    $('#d-ok').addEventListener('click',function(){send('approve')});$('#d-chg').addEventListener('click',function(){send('request_changes')});$('#d-rej').addEventListener('click',function(){send('reject')});
  }
}

function renderTab(d,tab){
  var b=$('#tab-body'),s=d.spec,L=d.latest;
  if(tab==='overview'){
    var apr=d.approvals;
    b.innerHTML='<div class="row2"><div class="card"><h3>Feature request</h3><p style="margin:8px 0 14px;white-space:pre-wrap">'+esc(s.description)+'</p>'+
      '<div class="row" style="flex-wrap:wrap;gap:8px"><span class="tag '+(s.case_type==='B'?'v':'')+'">'+(s.case_type==='B'?'Brownfield':'Greenfield')+'</span><span class="tag">Profile: '+(s.profile==='dev'?'Development':'Demo')+'</span>'+(s.repo_url?'<span class="tag">'+esc(s.repo_url)+'</span>':'')+'</div></div>'+
      '<div class="card"><h3>Governance</h3><p class="hint">Enforced by the server. Agents cannot change status.</p>'+
      '<div class="row" style="padding:8px 0;border-bottom:1px dashed var(--line)"><span>State version</span><span class="sp"></span><b>'+s.version+'</b></div>'+
      '<div class="row" style="padding:8px 0;border-bottom:1px dashed var(--line)"><span>Coding agent may edit</span><span class="sp"></span>'+(d.hook.write_allowed?'<span class="tag ok">Allowed</span>':'<span class="tag bad">Blocked</span>')+'</div>'+
      '<div class="row" style="padding:8px 0;border-bottom:1px dashed var(--line)"><span>Approvals recorded</span><span class="sp"></span><b>'+apr.filter(function(a){return a.decision==='approve'}).length+'</b></div>'+
      '<div class="row" style="padding:8px 0"><span>Possible next steps</span><span class="sp"></span><span style="font-size:12.5px;text-align:right">'+(d.allowed_transitions.length?d.allowed_transitions.map(function(t){return '<span class="tag">'+esc(stl(t.to))+' \u00b7 '+(t.by==='human'?'you':'system')+'</span>'}).join(' '):'none')+'</span></div>'+
      '<div style="margin-top:14px"><button class="btn sm" id="try-hook"><i class="fa-solid fa-hand"></i> Test the edit check</button><div id="hook-out" style="margin-top:10px"></div></div></div></div>'+
      (apr.length?'<div class="card" style="margin-top:16px"><h3>Approval ledger</h3><table class="tbl"><thead><tr><th>Artifact</th><th>Decision</th><th>Hash</th><th>By</th><th>When</th></tr></thead><tbody>'+apr.map(function(a){return '<tr><td>'+esc(a.artifact_type)+' v'+a.artifact_version+'</td><td>'+(a.decision==='approve'?'<span class="tag ok">approved</span>':a.decision==='reject'?'<span class="tag bad">rejected</span>':'<span class="tag warn">changes requested</span>')+(a.comment?'<br><span style="font-size:12.5px;color:var(--mute)">'+esc(a.comment)+'</span>':'')+'</td><td><span class="hash">'+esc(a.hash.slice(0,12))+'</span></td><td>'+esc(a.approver)+'</td><td style="color:var(--mute)">'+ago(a.created_at)+'</td></tr>'}).join('')+'</tbody></table></div>':'');
    $('#try-hook').addEventListener('click',function(){api('/api/specs/'+s.id+'/hook',{body:{tool:'Edit'}}).then(function(r){$('#hook-out').innerHTML='<div class="verdict '+(r.decision==='allow'?'ok':'bad')+'" style="margin:0"><b>Edit check: '+(r.decision==='allow'?'allowed':'blocked')+'</b><br>'+esc(r.reason)+'</div>'}).catch(function(x){toast(x.message,true)})});
  }
  else if(tab==='context'){
    var c=L.context,claims=c.data.claims,okN=claims.filter(function(x){return x.verdict.ok}).length;
    b.innerHTML='<div class="card"><div class="row" style="flex-wrap:wrap"><h3 style="margin:0">Code context v'+c.version+'</h3><span class="sp"></span><span class="tag ok">'+okN+'/'+claims.length+' claims verified</span><span class="hash">'+esc(c.hash.slice(0,12))+'</span></div><div class="md" style="margin-top:14px">'+md(c.markdown)+'</div></div>';
  }
  else if(tab==='requirements'){
    var r=L.requirements,q=L.questions;
    b.innerHTML=(r?'<div class="card"><div class="row" style="flex-wrap:wrap"><h3 style="margin:0">requirements.md</h3><span class="tag">v'+r.version+'</span><span class="sp"></span><span class="hash">sha256 '+esc(r.hash.slice(0,16))+'</span></div><div class="md" style="margin-top:14px">'+md(r.markdown)+'</div></div>':'')+
      (q?'<div class="card" style="margin-top:16px"><h3>Clarifying questions</h3><div class="md">'+md(q.markdown)+'</div></div>':'')+versions(d,'requirements');
    wireVersions(d);
  }
  else if(tab==='design'){
    var g=L.design,gd=g.data;
    b.innerHTML='<div class="row2" style="margin-bottom:16px"><div class="kpi"><div class="l"><i class="fa-solid fa-shield-halved"></i> Claims that failed checks</div><div class="v">'+Math.round(gd.unverified_rate*100)+'%</div><div class="d">'+gd.claims.filter(function(x){return !x.verdict.ok}).length+' of '+gd.claims.length+' flagged before you approve</div></div>'+
      '<div class="kpi"><div class="l"><i class="fa-solid fa-scale-balanced"></i> Compliance lint</div><div class="v">'+gd.lint.length+'</div><div class="d">'+(gd.lint.length?'legacy references rejected':'no legacy references')+'</div></div></div>'+
      '<div class="card"><div class="row" style="flex-wrap:wrap"><h3 style="margin:0">design.md</h3><span class="tag">v'+g.version+'</span><span class="sp"></span><span class="hash">sha256 '+esc(g.hash.slice(0,16))+'</span></div><div class="md" style="margin-top:14px">'+md(g.markdown)+'</div></div>'+versions(d,'design');
    wireVersions(d);
  }
  else if(tab==='tasks'){
    var canDo=d.hook.write_allowed;
    b.innerHTML='<div class="card"><h3>Tasks</h3><p class="hint">'+(canDo?'Implementation is unlocked. Mark each task complete with evidence.':'Locked until both approvals are recorded.')+'</p><table class="tbl"><thead><tr><th>Task</th><th>Requirement</th><th>Test</th><th>Status</th><th></th></tr></thead><tbody>'+d.tasks.map(function(t){return '<tr><td><b>'+esc(t.key)+'</b> '+esc(t.title)+(t.evidence?'<br><span style="font-size:12.5px;color:var(--mute)">'+esc(t.evidence)+'</span>':'')+'</td><td>'+esc(t.req_ids)+'</td><td><code>'+esc(t.test_id)+'</code></td><td>'+(t.status==='completed'?'<span class="tag ok">done</span>':'<span class="tag">todo</span>')+'</td><td style="text-align:right">'+(t.status!=='completed'&&canDo?'<button class="btn sm" data-done="'+esc(t.key)+'">Mark complete</button>':'')+'</td></tr>'}).join('')+'</tbody></table></div>';
    b.querySelectorAll('[data-done]').forEach(function(x){x.addEventListener('click',function(){x.disabled=true;api('/api/specs/'+s.id+'/tasks/'+x.dataset.done+'/complete',{body:{evidence:'Tests '+x.dataset.done.replace('TASK','T')+' passing (simulated)'}}).then(function(){toast('Task completed.');route()}).catch(function(e){toast(e.message,true);x.disabled=false})})});
  }
  else if(tab==='audit'){
    b.innerHTML='<div class="card"><h3>Audit log</h3><p class="hint">Every step is recorded and cannot be edited or deleted.</p><ul class="tl">'+d.audit.slice().reverse().map(function(a){return '<li class="'+esc(a.actor_type)+'"><b>'+esc(act(a.action))+'</b>'+(a.detail?' <span style="color:var(--mute)">\u00b7 '+esc(a.detail)+'</span>':'')+'<div class="t">'+who(a.actor_type)+' \u00b7 '+esc(stl(a.from_status))+' &rarr; '+esc(stl(a.to_status))+' \u00b7 '+ago(a.created_at)+'</div></li>'}).join('')+'</ul></div>';
  }
  else if(tab==='cost'){
    var pct=Math.min(100,d.cost.total/d.cost.cap*100),save=d.cost.uncached?Math.round((1-d.cost.total/d.cost.uncached)*100):0;
    b.innerHTML='<div class="cards" style="grid-template-columns:repeat(3,1fr)">'+kpi('Spent (simulated)',money(d.cost.total),'<i class="fa-solid fa-coins"></i>','of $'+Number(d.cost.cap).toFixed(2)+' cap')+kpi('Without savings',money(d.cost.uncached),'<i class="fa-solid fa-ban"></i>','same tokens at list price')+kpi('Saved',save+'%','<i class="fa-solid fa-piggy-bank"></i>','from caching and batching')+'</div>'+
      '<div class="card" style="margin-bottom:16px"><div class="row"><b>Budget used</b><span class="sp"></span><b>'+Math.round(pct)+'%</b></div><div class="meter '+(pct>80?'hot':'')+'" style="margin:8px 0 14px"><i style="width:'+pct+'%"></i></div>'+
      '<div class="row" style="flex-wrap:wrap;gap:8px"><input class="in" id="cap-in" type="number" min="0.1" max="10" step="0.1" value="'+d.cost.cap+'" style="width:140px" aria-label="Cost cap in USD"><button class="btn sm" id="cap-set">Update cap</button></div></div>'+
      '<div class="card"><h3>Model call ledger</h3><p class="hint">Tokens and cost for every call. Figures are simulated estimates priced with real model rates.</p><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Stage</th><th>Model</th><th>Input</th><th>Cache read</th><th>Cache write</th><th>Output</th><th>Cost</th></tr></thead><tbody>'+d.calls.map(function(c){return '<tr><td>'+esc(c.stage)+'</td><td>'+esc(c.model)+'</td><td>'+c.input_tokens.toLocaleString()+'</td><td>'+c.cache_read_tokens.toLocaleString()+'</td><td>'+c.cache_write_tokens.toLocaleString()+'</td><td>'+c.output_tokens.toLocaleString()+'</td><td><b>'+money(c.cost_usd)+'</b></td></tr>'}).join('')+'</tbody></table></div></div>';
    $('#cap-set').addEventListener('click',function(){api('/api/specs/'+s.id+'/cap',{body:{cap_usd:+$('#cap-in').value}}).then(function(){toast('Cap updated.');route()}).catch(function(e){toast(e.message,true)})});
  }
}

function versions(d,type){
  var vs=d.history.filter(function(h){return h.type===type});
  if(vs.length<2)return '';
  return '<div class="card" style="margin-top:16px"><h3>Version history</h3><p class="hint">Compare any two versions line by line.</p><div class="row" style="flex-wrap:wrap;gap:8px"><select class="in" id="v-a" style="width:auto" aria-label="From version">'+vs.map(function(v){return '<option value="'+v.version+'">v'+v.version+'</option>'}).join('')+'</select><span>&rarr;</span><select class="in" id="v-b" style="width:auto" aria-label="To version">'+vs.map(function(v,i){return '<option value="'+v.version+'"'+(i===vs.length-1?' selected':'')+'>v'+v.version+'</option>'}).join('')+'</select><button class="btn sm" id="v-go" data-type="'+type+'">Show diff</button></div><div id="v-out" style="margin-top:14px"></div></div>';
}
function wireVersions(d){
  var go=$('#v-go');if(!go)return;
  go.addEventListener('click',function(){var t=go.dataset.type,a=$('#v-a').value,bv=$('#v-b').value,id=d.spec.id;
    Promise.all([api('/api/specs/'+id+'/artifact/'+t+'/'+a),api('/api/specs/'+id+'/artifact/'+t+'/'+bv)]).then(function(r){
      var A=r[0].markdown.split('\n'),B=r[1].markdown.split('\n'),sa={},sb2={};A.forEach(function(l){sa[l]=1});B.forEach(function(l){sb2[l]=1});
      var out=[];A.forEach(function(l){if(!sb2[l]&&l.trim())out.push('<div style="background:var(--bad-bg);padding:2px 10px;border-radius:6px;margin:1px 0"><span style="color:var(--bad)">&minus;</span> '+esc(l)+'</div>')});
      B.forEach(function(l){if(!sa[l]&&l.trim())out.push('<div style="background:var(--ok-bg);padding:2px 10px;border-radius:6px;margin:1px 0"><span style="color:var(--ok)">+</span> '+esc(l)+'</div>')});
      $('#v-out').innerHTML=out.length?'<div style="font-family:var(--mono);font-size:12.5px;line-height:1.6">'+out.join('')+'</div>':'<div class="empty" style="padding:14px">No differences.</div>'}).catch(function(e){toast(e.message,true)})});
}

/* ---------- grounding lab ---------- */
function lab(){
  api('/api/lab/repo').then(function(repo){
    var mapRows=repo.symbols;
    view.innerHTML='<div class="top"><div><div class="crumb">Evidence</div><h1>Grounding lab</h1></div></div>'+
    '<div class="row2 eq"><div class="card"><h3>1. Search the code</h3><p class="hint">Find the files a feature touches in <b>'+esc(repo.name)+'</b>.</p>'+
      '<label class="sr" for="lab-q">Feature</label><textarea class="in" id="lab-q" style="min-height:80px">Add TDS to vendor payments and store the IRN on e-invoices</textarea>'+
      '<div style="margin-top:10px"><button class="btn dark sm" id="lab-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button></div><div id="lab-out" style="margin-top:14px"></div></div>'+
      '<div class="card"><h3>2. Check a claim</h3><p class="hint">Test any <code>file:line</code> claim yourself. Try a made-up path or an out-of-range line.</p>'+
      '<div class="field"><label for="c-file">File</label><select class="in" id="c-file">'+repo.files.map(function(f){return '<option value="'+esc(f.path)+'">'+esc(f.path)+' ('+f.lines+' lines)</option>'}).join('')+'<option value="src/tax/tds393.ts">src/tax/tds393.ts (does not exist)</option></select></div>'+
      '<div class="row" style="gap:10px"><div class="field" style="flex:1"><label for="c-s">Line start</label><input class="in" id="c-s" type="number" min="1" value="1"></div><div class="field" style="flex:1"><label for="c-e">Line end</label><input class="in" id="c-e" type="number" min="1" value="10"></div></div>'+
      '<div class="field"><label for="c-sym">Symbol claimed in that range</label><input class="in" id="c-sym" value="computeTds"></div>'+
      '<button class="btn dark sm" id="c-go"><i class="fa-solid fa-shield-halved"></i> Check claim</button><div id="c-out" style="margin-top:12px"></div></div></div>'+
    '<div class="card" style="margin-top:16px"><h3>Code index</h3><p class="hint">'+mapRows.length+' definitions across '+repo.files.length+' files in the sample repository.</p><div class="scroll-y"><table class="tbl"><thead><tr><th>Name</th><th>Kind</th><th>File</th><th>Lines</th></tr></thead><tbody>'+mapRows.map(function(m){return '<tr><td><code>'+esc(m.name)+'</code></td><td>'+esc(m.kind)+'</td><td>'+esc(m.file)+'</td><td>'+m.line+'&ndash;'+m.end+'</td></tr>'}).join('')+'</tbody></table></div></div>';
    $('#lab-go').addEventListener('click',function(){var q=$('#lab-q').value.trim();var o=$('#lab-out');o.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
      api('/api/lab/search',{body:{q:q}}).then(function(r){
        o.innerHTML='<b style="font-size:13px">Search steps</b><div class="mini" style="margin:6px 0 12px">'+r.toolCalls.map(function(t,i){return (i+1)+'. <span class="k">'+esc(t.tool)+'</span>('+esc(t.args)+') <span class="m">&rarr; '+t.hits+' hit'+(t.hits===1?'':'s')+'</span>'}).join('<br>')+'<br><span class="m">limit: 25 steps</span></div>'+
        '<b style="font-size:13px">Candidate files</b><div style="margin:6px 0 12px">'+(r.files.length?r.files.map(function(f){return '<div class="row" style="padding:5px 0"><code style="font-size:12.5px">'+esc(f.file)+'</code><span class="sp"></span><span class="tag">score '+f.score+'</span></div>'}).join(''):'<span style="color:var(--mute)">No matches.</span>')+'</div>'+
        '<b style="font-size:13px">Claims and verdicts</b><div style="margin-top:6px">'+(r.claims.length?r.claims.map(function(c){return '<div class="verdict '+(c.verdict.ok?'ok':'bad')+'" style="margin:6px 0;padding:10px 12px;font-size:13px"><b>'+(c.verdict.ok?'verified':'unverified: '+esc(c.verdict.reason))+'</b> <code>'+esc(c.file)+':L'+c.line_start+'-L'+c.line_end+'</code><br>'+esc(c.claim)+'</div>'}).join(''):'<span style="color:var(--mute)">No claims.</span>')+'</div>'}).catch(function(e){o.innerHTML='<div class="verdict bad">'+esc(e.message)+'</div>'})});
    $('#c-go').addEventListener('click',function(){var o=$('#c-out');
      api('/api/lab/verify',{body:{claims:[{file:$('#c-file').value,line_start:+$('#c-s').value,line_end:+$('#c-e').value,symbol:$('#c-sym').value}]}}).then(function(r){var v=r.results[0].verdict;
        o.innerHTML='<div class="verdict '+(v.ok?'ok':'bad')+'" style="margin:0"><b>'+(v.ok?'Verified':'Unverified: '+esc(v.reason))+'</b><br>'+(v.ok?'Path exists, range valid, symbol present.':({file_not_found:'No such file in the repo.',range_invalid:'Line range is outside the file or inverted.',symbol_not_in_range:'File and range exist but the symbol is not in those lines.'})[v.reason])+'</div>'}).catch(function(e){toast(e.message,true)})});
  }).catch(fail);
}

/* ---------- compliance ---------- */
function compliance(){
  api('/api/compliance').then(function(c){
    view.innerHTML='<div class="top"><div><div class="crumb">Evidence</div><h1>Compliance pack</h1></div><span style="flex:1"></span><span class="tag v">Rule set '+esc(c.version.replace('-demo',''))+'</span></div>'+
    '<div class="act"><h4><i class="fa-solid fa-triangle-exclamation"></i> Illustrative rates</h4><span style="font-size:14px">Rates and thresholds here are examples. Check them against the official CBDT and Income Tax portals before using them in a real system.</span></div>'+
    '<div class="row2 eq"><div class="card"><h3>Check a sentence</h3><p class="hint">Flags references to the old 194-series tax sections.</p><label class="sr" for="l-t">Text</label><textarea class="in" id="l-t" style="min-height:96px">Deduct TDS under Section 194J for professional fees.</textarea><div style="margin-top:10px"><button class="btn dark sm" id="l-go">Check sentence</button></div><div id="l-out" style="margin-top:12px"></div></div>'+
    '<div class="card"><h3>Section 393 quick reference</h3><p class="hint">Example rates for FY 2026-27.</p>'+[['Technical-service fees','2% · code 1026'],['Professional fees','10% · code 1027'],['Contractor (individual / HUF)','1%'],['Contractor (others)','2%']].map(function(r){return '<div class="row" style="padding:8px 0;border-bottom:1px dashed var(--line)"><span>'+r[0]+'</span><span class="sp"></span><b>'+r[1]+'</b></div>'}).join('')+'</div></div>'+
    '<div class="card" style="margin-top:16px"><h3>Rules ('+c.rules.length+')</h3><p class="hint">When a rule applies to your spec it becomes a requirement with a testable acceptance criterion. Select a rule to read it.</p>'+
    c.rules.map(function(r){return '<details style="border-bottom:1px solid var(--line);padding:10px 0"><summary style="cursor:pointer;font-weight:650;list-style:none"><span class="tag '+(r.family==='GST'?'acc':'v')+'">'+esc(r.id)+'</span> '+esc(r.title)+'</summary><div style="margin:10px 0 0 4px;font-size:14px"><p style="margin:0 0 6px"><b>Requirement:</b> '+esc(r.ears)+'</p><p style="margin:0 0 6px"><b>Acceptance:</b> '+esc(r.criterion)+'</p><p style="margin:0;color:var(--mute2);font-size:12.5px">Applies when the spec mentions: '+r.triggers.map(function(t){return '<code>'+esc(t)+'</code>'}).join(' ')+'</p>'+(r.note?'<p style="margin:8px 0 0;color:#a85a05;font-size:13px"><i class="fa-solid fa-circle-info"></i> '+esc(r.note)+'</p>':'')+'</div></details>'}).join('')+'</div>';
    $('#l-go').addEventListener('click',function(){api('/api/compliance/lint',{body:{text:$('#l-t').value}}).then(function(r){$('#l-out').innerHTML=r.ok?'<div class="verdict ok" style="margin:0"><b>No legacy sections found.</b></div>':'<div class="verdict bad" style="margin:0"><b>Rejected: '+r.hits.map(function(h){return '<mark class="bad">Section '+esc(h.match)+'</mark>'}).join(' ')+'</b><br>'+esc(r.hits[0].fix)+'</div>'}).catch(function(e){toast(e.message,true)})});
  }).catch(fail);
}

/* ---------- boot ---------- */
route();
})();
