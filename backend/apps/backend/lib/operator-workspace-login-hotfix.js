"use strict";

// Independent recovery layer for the owner login gate.
// This script is intentionally injected as a separate <script> element so it
// still runs if the large dashboard controller has a browser parse/runtime
// failure. It never stores the password; only the signed session token is kept.

const page = require("./operator-workspace-page-final");

const recovery = String.raw`<script id="wss-owner-login-recovery">
(function(){
  'use strict';
  var KEY='wsl_admin_token';
  function el(id){return document.getElementById(id);}
  function getToken(){try{return localStorage.getItem(KEY)||'';}catch(_){return '';}}
  function setToken(v){try{localStorage.setItem(KEY,v);}catch(_){}}
  function clearToken(){try{localStorage.removeItem(KEY);}catch(_){}}
  function cleanUrl(){try{if(location.pathname==='/console'&&location.search==='?')history.replaceState(null,'','/console');}catch(_){}}
  function setMessage(text){var m=el('gateMsg');if(m)m.textContent=text||'';}
  function setBusy(on){var b=el('gateButton');if(!b)return;b.disabled=!!on;b.textContent=on?'Checking…':'Open workspace';}
  function unlock(){
    var gate=el('gate');if(gate)gate.hidden=true;
    var status=el('systemStatus');
    if(status){status.className='status ok';var s=status.querySelector('span');if(s)s.textContent='System ready';}
    cleanUrl();
  }
  function validate(token){
    if(!token)return Promise.reject(new Error('missing_session'));
    return fetch('/api/admin/line',{headers:{'x-admin-token':token,'Accept':'application/json'},cache:'no-store'}).then(function(r){
      if(r.status===401||r.status===403)throw new Error('invalid_session');
      if(!r.ok)throw new Error('dashboard_unavailable');
      return r.json().catch(function(){return {};});
    });
  }
  function login(password){
    return fetch('/api/admin/session',{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      cache:'no-store',
      body:JSON.stringify({password:password})
    }).then(function(r){return r.json().catch(function(){return {};}).then(function(body){
      if(!r.ok||!body||!body.token){var e=new Error(body&&body.error||('HTTP '+r.status));e.code=body&&body.error;throw e;}
      setToken(body.token);
      return validate(body.token).then(function(){return body;});
    });});
  }
  function wire(){
    cleanUrl();
    var form=el('gateForm');
    if(!form)return;
    // Prevent the browser's default GET submit that produces /console?.
    form.setAttribute('method','post');
    form.setAttribute('action','/api/admin/session');
    form.addEventListener('submit',function(ev){
      ev.preventDefault();
      ev.stopImmediatePropagation();
      var input=el('tokenInput');
      var password=input&&input.value||'';
      if(!password){setMessage('Enter your owner password.');return false;}
      setBusy(true);setMessage('Checking…');
      login(password).then(function(){
        if(input)input.value='';
        setMessage('');
        unlock();
        // Reload once with the signed session present so the normal dashboard
        // controller can initialize if its failure was only during first load.
        setTimeout(function(){try{location.replace('/console');}catch(_){}},80);
      }).catch(function(err){
        clearToken();
        setMessage(err&&err.code==='invalid_password'?'Password not recognized.':'Login reached the server, but the dashboard session could not open.');
      }).finally(function(){setBusy(false);});
      return false;
    },true);

    var existing=getToken();
    if(existing){
      validate(existing).then(unlock).catch(function(){clearToken();});
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
})();
</script>`;

if (!page.includes("</body>")) throw new Error("operator_workspace_body_missing");
module.exports = page.replace("</body>", recovery + "</body>");
