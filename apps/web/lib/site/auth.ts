import { head, logo, BRAND } from './layout';

export function authPage(mode: 'login' | 'signup' | 'notfound') {
  if (mode === 'notfound') {
    return `${head('Page not found · ' + BRAND)}<body><div class="wrap" style="min-height:100vh;display:grid;place-items:center;text-align:center">
<div>${logo()}<h1 class="display" style="font-size:64px;margin-top:30px">404</h1><p class="lead">That page does not exist.</p><a class="btn dark" href="/">Back home</a></div></div></body></html>`;
  }
  const su = mode === 'signup';
  return `${head((su ? 'Create account' : 'Sign in') + ' · ' + BRAND)}
<body><div class="auth">
<main id="main" class="auth-l">
  <div>${logo()}</div>
  <div class="auth-form">
    <h1>${su ? 'Create your workspace' : 'Welcome back'}</h1>
    <p class="sub">${su ? 'Start governing your specs in under a minute.' : 'Sign in to review specs, approvals and evidence.'}</p>
    <div class="err" id="err" role="alert"></div>
    <form id="f" novalidate>
      ${su ? `<div class="fld"><label for="name">Full name</label><input class="in" id="name" name="name" autocomplete="name" required maxlength="80" placeholder="Asha Verma"></div>` : ''}
      <div class="fld"><label for="email">Work email</label><input class="in" id="email" name="email" type="email" autocomplete="email" required placeholder="you@company.com"></div>
      <div class="fld"><label for="password">Password</label>
        <div class="pw"><input class="in" id="password" name="password" type="password" autocomplete="${su ? 'new-password' : 'current-password'}" required minlength="8" placeholder="${su ? 'At least 8 characters' : 'Your password'}"><button type="button" id="tg" aria-label="Show password">Show</button></div>
        ${su ? '<div class="strength" aria-hidden="true"><i id="str"></i></div>' : ''}
      </div>
      <button class="btn dark" id="go" type="submit" style="width:100%;justify-content:center;padding:13px">${su ? 'Create account' : 'Sign in'} <i class="fa-solid fa-arrow-right"></i></button>
    </form>
    <p style="text-align:center;color:var(--mute);font-size:14px;margin-top:22px">${su ? 'Already have an account? <a href="/sign-in" style="color:var(--acc-ink);font-weight:650">Sign in</a>' : 'New here? <a href="/sign-up" style="color:var(--acc-ink);font-weight:650">Create an account</a>'}</p>
  </div>
  <p style="color:var(--mute2);font-size:12.5px;margin:0">Passwords are hashed and never stored in the clear; sessions are HttpOnly cookies.</p>
</main>
<aside class="auth-r" aria-label="Example of an evidence-checked design"><div class="auth-card">
  <div class="win"><div class="win-bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>
  <div class="pane">
    <h2 class="auth-h">Evidence-checked design</h2>
    <table class="tbl-m"><tr><th>Claim</th><th><span class="sr">Result</span></th></tr>
    <tr><td><code>computeTds</code> in tds.ts</td><td><span class="tag ok">verified</span></td></tr>
    <tr><td><code>payVendor</code> calls it</td><td><span class="tag ok">verified</span></td></tr>
    <tr><td><code>computeSection393</code></td><td><span class="tag bad">file_not_found</span></td></tr></table>
    <div class="mock-card" style="margin-top:14px"><div class="row"><b>Unverified-claim rate</b><span class="sp"></span><span class="tag warn">33%</span></div><div style="color:var(--mute);font-size:12px;margin-top:4px">Flagged before anyone approves.</div></div>
  </div></div>
  <p class="quote">"Documents are a commodity. What matters is that the server will not let an unapproved spec reach the code."<b>The differentiator, from the build plan</b></p>
</div></aside>
</div>
<script>
(function(){
  var su=${su ? 'true' : 'false'};
  var f=document.getElementById('f'),err=document.getElementById('err'),go=document.getElementById('go'),pw=document.getElementById('password');
  // Only a path on this site is an acceptable destination. An absolute URL here would
  // turn the sign-in page into an open redirect.
  var next=new URLSearchParams(location.search).get('next');
  var dest=(next&&/^\\/workspace(\\/|$|\\?)/.test(next))?next:'/workspace';
  function show(m){err.textContent=m;err.classList.add('show')}
  document.getElementById('tg').addEventListener('click',function(){var h=pw.type==='password';pw.type=h?'text':'password';this.textContent=h?'Hide':'Show'});
  if(su){var s=document.getElementById('str');pw.addEventListener('input',function(){var v=pw.value,n=0;if(v.length>=8)n++;if(v.length>=12)n++;if(/[A-Z]/.test(v)&&/[a-z]/.test(v))n++;if(/\\d/.test(v)&&/[^A-Za-z0-9]/.test(v))n++;s.style.width=(n*25)+'%';s.style.background=['#dc2626','#dc2626','#d97706','#16a34a','#16a34a'][n]})}
  function post(url,body){return fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}).catch(function(){throw new Error('Cannot reach the server. Check your connection and try again.')}).then(function(r){return r.text().then(function(t){var j=null;try{j=JSON.parse(t)}catch(e){}if(!r.ok){throw new Error((j&&(j.message||(j.error&&j.error.message)))||(r.status===401||r.status===403?'That email and password do not match an account.':r.status>=500?'The server had a problem. Please try again in a moment.':'Request failed ('+r.status+').'))}return j||{}})})}
  f.addEventListener('submit',function(e){e.preventDefault();err.classList.remove('show');
    var email=f.email.value.trim(),pass=pw.value;
    if(su&&f.name.value.trim().length<2)return show('Please enter your name.');
    if(!/^\\S+@\\S+\\.\\S+$/.test(email))return show('Please enter a valid email address.');
    if(pass.length<8)return show('Password must be at least 8 characters.');
    go.disabled=true;var old=go.innerHTML;go.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Please wait\u2026';
    // Better Auth's own REST surface, served by /api/auth/[...all]. Same endpoints the
    // React client calls, so there is one sign-in path and not two.
    post(su?'/api/auth/sign-up/email':'/api/auth/sign-in/email',su?{name:f.name.value.trim(),email:email,password:pass}:{email:email,password:pass})
      .then(function(){document.body.classList.add('leaving');setTimeout(function(){location.href=dest},260)})
      .catch(function(x){show(x.message);go.disabled=false;go.innerHTML=old});
  });
})();
</script></body></html>`;
}
