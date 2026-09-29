"use strict";

// Safety-pinned product shims over the readable source page. Each replacement
// asserts its source contract so drift fails in CI instead of silently hiding
// an operator action.
const base = require("./operator-workspace-page");
const swaps = [
  [
    "if(key==='source')return b&&['pending','picking'].indexOf(b.pickState)>=0;",
    "if(key==='source')return b&&(['pending','picking'].indexOf(b.pickState)>=0||((b.rows||[]).length===0&&['queued','building','running'].indexOf(b.status)>=0));",
  ],
  [
    '<a href="/replies"><svg',
    '<a href="/campaigns"><span style="width:18px;text-align:center;color:var(--violet)">✉</span>Outreach</a>\n      <a href="/replies"><svg',
  ],
  [
    '<div class="prod-actions"><a href="/gallery">Open finished websites</a>',
    '<div class="prod-actions">'+"'+(waiting?'<a href=\"/campaigns\">Review outreach</a>':'')+'"+'<a href="/gallery">Open finished websites</a>',
  ],
  [
    "host.innerHTML=active.slice(0,3).map(productionCard).join('<div style=\"height:10px\"></div>')+(active.length>3?'<div class=\"form-msg\">'+(active.length-3)+' more active runs are visible in Engine Room.</div>':'');",
    "host.innerHTML=productionCard(active[0])+(active.length>1?'<div class=\"form-msg\">Older practice runs are being retired automatically. Factory details keeps the technical history.</div>':'');",
  ],
  [
    "'+(waiting?'Needs your review':'Production live')+'",
    "'+(waiting?'Needs your review':c.working>0?'Production live':'Queued for worker')+'",
  ],
  [
    "live-badge '+(waiting?'wait':'')+'",
    "live-badge '+((waiting||c.working===0)?'wait':'')+'",
  ],
  // BADGE-TRUTH (2026-09-02): the old stageCounts shim was absorbed into the
  // readable source page — lib/operator-workspace-page.js now derives every
  // stage badge from the SAME b.rows array the "What the factory is doing
  // now" feed lists, through one rowStage mapping, with rejected/gate_failed/
  // error attempts counted only as rejected attempts (never as goal slots).
  // The identical pair below is a drift alarm pinning that single-source
  // implementation: if the base page loses it, this module fails loudly.
  [
    "function stageCounts(b){var rows=Array.isArray(b&&b.rows)?b.rows:[],goal=goalOf(b),f=b&&b.mineFunnel||{};var c={source:0,qualify:0,build:0,inspect:0,ready:0,sent:0,failed:0,working:0,maxStage:0,goal:goal,sourceAttempts:Math.max(rows.length,int(f.selected||f.contactable||f.eligible||f.withEmail||0)),qualifyAttempts:0,buildAttempts:0,inspectAttempts:0};rows.forEach(function(r){var st=rowStage(r);if(st>=2)c.qualifyAttempts+=1;if(st>=3)c.buildAttempts+=1;if(st>=4)c.inspectAttempts+=1;if(st===0){c.failed+=1;return;}c.source+=1;if(st>=2)c.qualify+=1;if(st>=3)c.build+=1;if(st>=4)c.inspect+=1;if(st>=5)c.ready+=1;if(st===6){c.sent+=1;}else if(st<=4){c.working+=1;}if(st>c.maxStage)c.maxStage=st;});['source','qualify','build','inspect','ready'].forEach(function(k){c[k]=Math.min(c[k],goal);});return c;}",
    "function stageCounts(b){var rows=Array.isArray(b&&b.rows)?b.rows:[],goal=goalOf(b),f=b&&b.mineFunnel||{};var c={source:0,qualify:0,build:0,inspect:0,ready:0,sent:0,failed:0,working:0,maxStage:0,goal:goal,sourceAttempts:Math.max(rows.length,int(f.selected||f.contactable||f.eligible||f.withEmail||0)),qualifyAttempts:0,buildAttempts:0,inspectAttempts:0};rows.forEach(function(r){var st=rowStage(r);if(st>=2)c.qualifyAttempts+=1;if(st>=3)c.buildAttempts+=1;if(st>=4)c.inspectAttempts+=1;if(st===0){c.failed+=1;return;}c.source+=1;if(st>=2)c.qualify+=1;if(st>=3)c.build+=1;if(st>=4)c.inspect+=1;if(st>=5)c.ready+=1;if(st===6){c.sent+=1;}else if(st<=4){c.working+=1;}if(st>c.maxStage)c.maxStage=st;});['source','qualify','build','inspect','ready'].forEach(function(k){c[k]=Math.min(c[k],goal);});return c;}",
  ],
  [
    "'Websites built','Mirror + business DNA'",
    "'Builds cleared','Deployed + release proven'",
  ],
  [
    "ready+' of '+c.goal+' finished slots are complete. Replacements never reduce the requested total.",
    "ready+' of '+c.goal+' finished slots are complete. '+c.failed+' replacement candidate'+(c.failed===1?' has':'s have')+' been rejected without consuming the '+c.goal+'-site goal.",
  ],
  [
    "function stageForRow(r){",
    "function failureReason(r){var x=String(r&&r.reason||'').toLowerCase();if(!x)return 'did not meet the quality bar';if(x.indexOf('timed_out')>=0||x.indexOf('deadline')>=0)return 'website build ran out of time';if(x.indexOf('mirror_build_not_revealable')>=0||x.indexOf('not_revealable')>=0)return 'built site did not pass live verification';if(x.indexOf('brand')>=0||x.indexOf('logo')>=0)return 'brand or logo proof did not pass';if(x.indexOf('render')>=0)return 'live site did not render cleanly';if(x.indexOf('contract')>=0)return 'business packet was incomplete';if(x.indexOf('multi-trade')>=0)return 'business spans multiple trades';return 'did not meet the quality bar';}function stageForRow(r){",
  ],
  [
    "if(failed(r))return {label:'Replaced — did not meet the quality bar',p:100,fail:true};",
    "if(failed(r))return {label:'Replaced — '+failureReason(r),p:100,fail:true};",
  ],
  [
    "function stageForRow(r){",
    "function stageForRow(r){if(failed(r))return {label:'Replaced — '+failureReason(r),p:100,fail:true};var s=String(r&&r.status||'picked'),order=['picked','qualified','mirrored','gate_passed','ready','queued','sent'],i=order.indexOf(s),labels=['Researched','Built','Inspected','Ready','Sent'],done=s==='sent'?5:(s==='queued'||s==='ready'?4:s==='gate_passed'?3:s==='mirrored'?2:s==='qualified'?1:0),stages=labels.map(function(x,n){return {t:x,k:n<done?'done':(n===done&&done<5?'on':'todo')};}),parts=labels.map(function(x,n){return n<done?x+' ✓':n===done&&done<5?x+' …':x;});return {label:parts.join('  ›  '),stages:stages,p:[20,20,40,60,80,80,100][Math.max(0,i)]||20,fail:false};}function stageForRowLegacy(r){",
  ],
  [
    '<button class="smallbtn" id="signOut" type="button">Sign out</button>',
    '<button class="smallbtn" id="changePassword" type="button">Change password</button><button class="smallbtn" id="signOut" type="button">Sign out</button>',
  ],
  [
    '<div class="gate" id="gate"><form class="gate-card" id="gateForm"><div class="eyebrow">Private workspace</div><h1>Open Command Center</h1><p>Enter the operator token. It stays in this browser and is sent only as the WSS admin header.</p><input id="tokenInput" type="password" autocomplete="off" placeholder="Operator token"><button class="primary" id="gateButton" type="submit">Open workspace</button><div class="gate-msg" id="gateMsg"></div></form></div>',
    '<div class="gate" id="gate"><form class="gate-card" id="gateForm"><div class="eyebrow">Private workspace</div><h1>Open Command Center</h1><p>Enter your owner password. The password is never stored in this browser; a signed session keeps you logged in.</p><input id="tokenInput" type="password" autocomplete="current-password" placeholder="Owner password"><button class="primary" id="gateButton" type="submit">Open workspace</button><div class="gate-msg" id="gateMsg"></div></form></div>',
  ],
  [
    "function askClear(){$('clearModal').hidden=false;$('clearConfirm').focus();}",
    "function openPassword(){$('passwordModal').hidden=false;$('currentPassword').value='';$('newPassword').value='';$('confirmPassword').value='';$('passwordMsg').textContent='';$('currentPassword').focus();}function closePassword(){$('passwordModal').hidden=true;$('passwordMsg').textContent='';}function changePassword(){var current=$('currentPassword').value,newPass=$('newPassword').value,confirmPass=$('confirmPassword').value;if(newPass.length<12){$('passwordMsg').className='form-msg bad';$('passwordMsg').textContent='Use at least 12 characters.';return;}if(newPass!==confirmPass){$('passwordMsg').className='form-msg bad';$('passwordMsg').textContent='New passwords do not match.';return;}var b=$('passwordConfirm');b.disabled=true;b.textContent='Saving…';api('/api/admin/password',{method:'POST',body:JSON.stringify({currentPassword:current,newPassword:newPass})}).then(function(out){if(out&&out.token)saveToken(out.token);$('passwordMsg').className='form-msg ok';$('passwordMsg').textContent='Password changed. Your browser session has been refreshed.';setTimeout(closePassword,700);}).catch(function(e){$('passwordMsg').className='form-msg bad';$('passwordMsg').textContent=(e.payload&&e.payload.error)||e.message||'Could not change password.';}).finally(function(){b.disabled=false;b.textContent='Change password';});}function askClear(){$('clearModal').hidden=false;$('clearConfirm').focus();}",
  ],
  [
    "$('gateForm').addEventListener('submit',function(e){e.preventDefault();var v=$('tokenInput').value.trim();if(!v)return;saveToken(v);$('gateButton').disabled=true;$('gateMsg').textContent='Checking…';load().then(startPolling).finally(function(){$('gateButton').disabled=false;});});",
    "$('gateForm').addEventListener('submit',function(e){e.preventDefault();var v=$('tokenInput').value;if(!v)return;$('gateButton').disabled=true;$('gateMsg').textContent='Checking…';fetch('/api/admin/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:v})}).then(function(res){return res.json().catch(function(){return {};}).then(function(body){if(!res.ok){var err=new Error(body.error||('HTTP '+res.status));err.payload=body;throw err;}return body;});}).then(function(out){saveToken(out.token);$('tokenInput').value='';return load();}).then(startPolling).catch(function(e){dropToken();openGate((e.payload&&e.payload.error)==='invalid_password'?'Password not recognized.':'Could not open the workspace.');}).finally(function(){$('gateButton').disabled=false;});});",
  ],
  [
    "$('newBuild').addEventListener('click',openBuilder);$('closeBuilder').addEventListener('click',closeBuilder);$('launch').addEventListener('click',launch);$('clearCancel').addEventListener('click',closeClear);$('clearConfirm').addEventListener('click',clearCurrent);$('sendSwitch').addEventListener('click',toggleSends);$('signOut').addEventListener('click',function(){dropToken();location.reload();});",
    "$('newBuild').addEventListener('click',openBuilder);$('closeBuilder').addEventListener('click',closeBuilder);$('launch').addEventListener('click',launch);$('clearCancel').addEventListener('click',closeClear);$('clearConfirm').addEventListener('click',clearCurrent);$('sendSwitch').addEventListener('click',toggleSends);$('changePassword').addEventListener('click',openPassword);$('passwordCancel').addEventListener('click',closePassword);$('passwordConfirm').addEventListener('click',changePassword);$('signOut').addEventListener('click',function(){dropToken();location.reload();});",
  ],
];
// STAGE WORDS THAT CANNOT LIE (owner, 2026-08-20: "the checkbox is willing to
// lie — say Sent — make the stages more representative, with colors or
// movement"). stageForRow v2 above now also returns stages[{t,k}]; the
// activity template renders them as colored tokens: done=green with its check,
// the ACTIVE stage pulses violet with an animated ellipsis, future stages sit
// dim — so "Sent …" can never read as finished again.
const STAGE_TEMPLATE_SWAP = [
  "'</b><span>'+esc(st.label)+(r.city? ' · '+esc([r.city,r.state].filter(Boolean).join(', ')):'')+'</span>",
  "'</b><span>'+(st.stages?st.stages.map(function(pp){return '<i class=\"stg '+pp.k+'\">'+(({Researched:'<svg class=\"stg-i\" viewBox=\"0 0 16 16\"><circle cx=\"7\" cy=\"7\" r=\"4.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"></circle><path d=\"M10.2 10.2L14 14\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"></path></svg>',Built:'<svg class=\"stg-i\" viewBox=\"0 0 16 16\"><path d=\"M3 6.5L8.5 2l4 3-2 2.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linejoin=\"round\"></path><path d=\"M6.2 7.8L13 13\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"></path></svg>',Inspected:'<svg class=\"stg-i\" viewBox=\"0 0 16 16\"><path d=\"M8 1.8l5 1.9v3.9c0 3.4-2.2 5.2-5 6-2.8-.8-5-2.6-5-6V3.7z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linejoin=\"round\"></path><path d=\"M5.7 8l1.7 1.7 3-3.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"></path></svg>',Ready:'<svg class=\"stg-i\" viewBox=\"0 0 16 16\"><path d=\"M4 2v12\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"></path><path d=\"M4.9 3h6.6L9.8 5.4l1.7 2.4H4.9z\" fill=\"currentColor\"></path></svg>',Sent:'<svg class=\"stg-i\" viewBox=\"0 0 16 16\"><path d=\"M2 8.2l12-5.4-4.2 11-2.4-4.4z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linejoin=\"round\"></path></svg>'})[pp.t]||'')+esc(pp.t)+(pp.k==='done'?' ✓':'')+(pp.k==='on'?'<i class=\"stg-dots\"></i>':'')+'</i>';}).join('<em class=\"stg-sep\">›</em>'):esc(st.label))+(r.city? ' <i class=\"stg-city\">· '+esc([r.city,r.state].filter(Boolean).join(', '))+'</i>':'')+'</span>",
];

// THE COMPANY'S OWN MARK ON ITS ROW (owner, 2026-08-20). The rows now carry
// logoUrl — the same verified mark the build uses. With a mark present the
// status glyph becomes a corner badge over it; with none, the glyph stays
// centered exactly as before (.act-state:only-child). A dead image URL simply
// removes itself and the badge remains — never a broken-image square.
const LOGO_AVATAR_SWAP = [
  "<i class=\"act-icon\">'+(st.fail?'↻':st.p===100?'✓':'●')+'</i>",
  "<i class=\"act-icon'+(r.logoUrl?' has-logo':'')+'\">'+(r.logoUrl?'<img class=\"act-logo\" src=\"'+esc(r.logoUrl)+'\" alt=\"\" loading=\"lazy\" onerror=\"this.remove()\">':'')+'<b class=\"act-state\">'+(st.fail?'↻':st.p===100?'✓':'●')+'</b></i>",
];
swaps.push(LOGO_AVATAR_SWAP);

swaps.push(STAGE_TEMPLATE_SWAP);
// THE BRAND MARK DRAWS ITSELF IN — same inline animated W as the customer
// dashboard, so both surfaces share one living mark and neither can 404.
swaps.push([
  '<span class="mark">W</span>',
  '<span class="mark"><svg viewBox="0 0 64 64" role="img" aria-label="WSS" style="width:100%;height:100%;display:block"><defs><linearGradient id="cwg" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8ea0ff"></stop><stop offset="1" stop-color="#c4b5fd"></stop></linearGradient></defs><path class="mark-w" d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#cwg)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path><circle class="mark-dot" cx="50" cy="20" r="4.5" fill="#34d399"></circle></svg></span>',
]);

let page = base;
for (const [from, to] of swaps) {
  if (!page.includes(from)) throw new Error("operator_workspace_final_contract_missing");
  page = page.replace(from, to);
}

const passwordModal = '<div class="modal" id="passwordModal" hidden role="dialog" aria-modal="true" aria-labelledby="passwordTitle"><div class="modal-card"><div class="eyebrow">Owner access</div><h2 id="passwordTitle">Change Command Center password</h2><p>Your password is stored only as a salted verifier. Changing it does not expose or replace the server admin secret.</p><label>Current password<input id="currentPassword" type="password" autocomplete="current-password"></label><label>New password<input id="newPassword" type="password" autocomplete="new-password" minlength="12"></label><label>Confirm new password<input id="confirmPassword" type="password" autocomplete="new-password" minlength="12"></label><div class="modal-actions"><button class="secondary" id="passwordCancel" type="button">Cancel</button><button class="primary" id="passwordConfirm" type="button">Change password</button></div><div class="form-msg" id="passwordMsg"></div></div></div>';
if (!page.includes('id="passwordModal"')) page = page.replace('<div class="gate" id="gate">', passwordModal + '<div class="gate" id="gate">');

// Operator-facing language: the technical page still exists at /line, but its
// navigation name should explain what a business operator will find there.
page = page.replace(/Engine Room/g, "Factory details").replace(/Engine room/g, "Factory details");

// RAZZLE V2 — the mosaic layer. Owner, 2026-08-20: "repurpose the design code
// that's already existing… more intuitive, clean, pop and flavor… I like to
// see steps and stages taking place, really cool animations and meters and
// bars, floating little verbiage pockets saying what is happening in that very
// moment." Composed entirely from the page's existing hooks (.mile, .metric,
// .activity, .overall-num, .live-badge, .primary…): CSS only, zero controller
// JS, so the inline-script parse guard and every pinned behavior stay intact.
// The floating pockets are the controller's own live per-row copy (.act-copy),
// restyled as speech bubbles docked to their moving progress tracks.
const razzle = `<style id="wss-razzle-v2">
:root{--rz-violet:#7c8cff;--rz-purple:#a78bfa;--rz-cyan:#67e8f9;--rz-green:#34d399;--rz-amber:#fbbf24}
/* AURORA GROUND — depth behind everything, fixed so scroll feels dimensional */
body::before{content:"";position:fixed;inset:-20%;z-index:-1;pointer-events:none;
background:radial-gradient(42% 34% at 12% 8%,rgba(124,140,255,.14),transparent 60%),
radial-gradient(38% 30% at 88% 12%,rgba(167,139,250,.10),transparent 60%),
radial-gradient(50% 40% at 70% 95%,rgba(103,232,249,.07),transparent 60%)}
/* BRAND MARK + NAV — the rail reads alive */
.mark{background:linear-gradient(135deg,var(--rz-violet),var(--rz-purple))!important;
box-shadow:0 0 18px rgba(124,140,255,.55),inset 0 1px 0 rgba(255,255,255,.35)}
.nav a{transition:background .18s ease,transform .18s ease}
.nav a:hover{transform:translateX(2px)}
.nav a[aria-current],.nav a.on{background:linear-gradient(90deg,rgba(124,140,255,.22),rgba(167,139,250,.08));
box-shadow:inset 2px 0 0 var(--rz-violet)}
/* HERO — gradient ring, headline glow */
.hero{position:relative;border:1px solid transparent;border-radius:20px;
background:linear-gradient(180deg,rgba(20,23,32,.92),rgba(14,16,23,.96)) padding-box,
linear-gradient(120deg,rgba(124,140,255,.55),rgba(167,139,250,.25) 40%,rgba(103,232,249,.35)) border-box}
.hero h2{text-shadow:0 0 32px rgba(124,140,255,.35)}
/* METRIC TILES — jewel numbers, per-tile hue hairline, gentle rise on load */
.metric{border-radius:16px;overflow:hidden;position:relative;animation:rz-rise .5s ease both}
.metric:nth-child(1){animation-delay:.02s}.metric:nth-child(2){animation-delay:.06s}
.metric:nth-child(3){animation-delay:.10s}.metric:nth-child(4){animation-delay:.14s}
.metric:nth-child(5){animation-delay:.18s}.metric:nth-child(6){animation-delay:.22s}
.metric::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;
background:linear-gradient(90deg,var(--rz-violet),var(--rz-cyan))}
.metric:nth-child(2)::before{background:linear-gradient(90deg,var(--rz-green),var(--rz-cyan))}
.metric:nth-child(3)::before{background:linear-gradient(90deg,var(--rz-amber),var(--rz-violet))}
.metric b,.metric .count{font-variant-numeric:tabular-nums;
background:linear-gradient(180deg,#fff,rgba(255,255,255,.72));-webkit-background-clip:text;background-clip:text;color:transparent}
/* MILESTONE TILES — the stages, visibly ALIVE. Active dot pulses; active track
   carries a moving sheen (the bar-going-by effect the owner asked back). */
.mile{border-radius:16px;transition:transform .18s ease,box-shadow .18s ease}
.mile:hover{transform:translateY(-2px)}
.mile-dot{box-shadow:0 0 0 3px rgba(124,140,255,.15)}
.mile.on .mile-dot,.mile .mile-dot.on{background:var(--rz-violet)!important;
animation:rz-pulse 1.6s ease-in-out infinite}
.mile-track{position:relative;overflow:hidden;border-radius:99px}
.mile-track>i,.mile-track>span,.mile-track>div{border-radius:99px;
background:linear-gradient(90deg,var(--rz-violet),var(--rz-purple),var(--rz-cyan))!important;
background-size:200% 100%!important;animation:rz-flow 2.6s linear infinite}
/* PRODUCTION CARD — the big number is the room's heartbeat */
.production{border:1px solid transparent;border-radius:20px;
background:linear-gradient(180deg,rgba(19,22,31,.94),rgba(13,15,22,.97)) padding-box,
linear-gradient(140deg,rgba(124,140,255,.5),rgba(52,211,153,.25) 55%,rgba(167,139,250,.35)) border-box}
.overall-num{font-variant-numeric:tabular-nums;
background:linear-gradient(135deg,#fff 20%,var(--rz-violet) 65%,var(--rz-cyan));
-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 0 18px rgba(124,140,255,.35))}
.live-badge{position:relative;overflow:visible}
.live-badge::before{content:"";position:absolute;inset:-3px;border-radius:inherit;
border:1px solid rgba(52,211,153,.5);animation:rz-ring 2s ease-out infinite}
/* ACTIVITY ROWS — floating verbiage pockets over living stripes */
.activity{border-radius:14px;transition:background .18s ease}
.activity:hover{background:rgba(124,140,255,.06)}
.activity-progress,.act-progress,.activity-track{position:relative;overflow:hidden;border-radius:99px}
.activity-progress::after{content:"";position:absolute;inset:0;border-radius:inherit;
background:linear-gradient(110deg,transparent 20%,rgba(255,255,255,.16) 45%,transparent 70%);
background-size:220% 100%;animation:rz-flow 2.2s linear infinite}
.act-copy span{display:inline-block;background:rgba(17,20,29,.92);
border:1px solid rgba(124,140,255,.28);border-radius:10px;padding:3px 10px;
box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.03) inset;
position:relative}
.act-copy span::after{content:"";position:absolute;left:14px;bottom:-5px;width:8px;height:8px;
background:inherit;border-right:1px solid rgba(124,140,255,.28);border-bottom:1px solid rgba(124,140,255,.28);
transform:rotate(45deg)}
.act-icon{background:linear-gradient(135deg,rgba(124,140,255,.30),rgba(167,139,250,.12))!important;
box-shadow:0 0 12px rgba(124,140,255,.25);position:relative}
/* THE COMPANY'S OWN MARK ON ITS ROW — owner, 2026-08-20: "I feel like I'm
   seeing the companies that are working, not lines of code." The row carries
   the same verified logo the build uses; the status glyph shrinks to a corner
   badge when a mark is present and stays centered when it is the only child. */
.act-icon.has-logo{background:rgba(255,255,255,.92)!important;padding:3px}
.act-logo{width:100%;height:100%;object-fit:contain;border-radius:8px;display:block}
.act-state{position:absolute;right:-4px;bottom:-4px;width:15px;height:15px;border-radius:50%;
background:#161a24;border:1px solid rgba(124,140,255,.4);display:flex;align-items:center;justify-content:center;
font-size:9px;font-style:normal;line-height:1}
.act-state:only-child{position:static;width:auto;height:auto;background:none;border:none;font-size:inherit}
/* STAGE GLYPHS — the five little boxes each carry their stage's icon, tinted
   by state (green done / pulsing violet active / dim upcoming). */
.stg-i{width:11px;height:11px;margin-right:4px;vertical-align:-1.5px;display:inline-block}
/* FACTORY LIST + SIDE LIVE CARD */
.factory-row{border-radius:12px;transition:background .16s ease}
.factory-row:hover{background:rgba(255,255,255,.04)}
.side-live{border:1px solid transparent;border-radius:14px;
background:linear-gradient(180deg,rgba(19,22,31,.94),rgba(13,15,22,.97)) padding-box,
linear-gradient(120deg,rgba(52,211,153,.5),rgba(124,140,255,.3)) border-box}
.side-live-dot{animation:rz-pulse 1.6s ease-in-out infinite}
/* STATUS CHIPS + PRIMARY BUTTON SHINE */
.status.ok{box-shadow:0 0 14px rgba(52,211,153,.25)}
.status.ok span{color:var(--rz-green)}
.primary{position:relative;overflow:hidden}
.primary::after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:40%;
background:linear-gradient(105deg,transparent,rgba(255,255,255,.35),transparent);
transform:skewX(-18deg);transition:left .5s ease}
.primary:hover::after{left:120%}
/* V2.1 (owner review of the live board) ------------------------------- */
/* Tile text was struck through by the absolute bottom bar; the track now
   flows below the copy and can never overlap it at any tile height. */
.mile{display:flex;flex-direction:column}
.mile-track{position:static!important;left:auto!important;right:auto!important;bottom:auto!important;margin-top:auto;padding-top:0}
.mile-desc{margin-bottom:12px}
/* Stage words that cannot lie: done=green check, ACTIVE pulses violet with a
   typing ellipsis, future sits dim. */
.stg{font-style:normal;white-space:nowrap}
.stg.done{color:#4ade80}
.stg.on{color:#b6c2ff;font-weight:800;animation:rz-stagepulse 1.4s ease-in-out infinite}
.stg.todo{opacity:.42}
.stg-sep{font-style:normal;opacity:.3;margin:0 5px}
.stg-city{font-style:normal;opacity:.55}
.stg-dots::after{content:"";display:inline-block;width:1.1em;text-align:left;animation:rz-dots 1.2s steps(4) infinite}
@keyframes rz-dots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}
@keyframes rz-stagepulse{0%,100%{opacity:1}50%{opacity:.55}}
/* The mark draws itself in, the status dot breathes. */
.mark{background:linear-gradient(135deg,#1b1e2b,#232741)!important;padding:6px}
.mark-w{stroke-dasharray:96;stroke-dashoffset:96;animation:rz-markdraw 1.1s .2s ease-out forwards}
.mark-dot{transform-origin:50px 20px;animation:rz-pulse 2.2s 1.3s ease-in-out infinite}
@keyframes rz-markdraw{to{stroke-dashoffset:0}}
/* Tighter hero, buttons with real presence. */
.hero{padding:26px 28px!important}
.hero h2{font-size:clamp(26px,3.4vw,38px)!important;margin-bottom:8px!important}
.hero p{max-width:64ch}
.prod-actions{gap:10px!important;margin-top:16px!important}
.prod-actions a,.prod-actions button,.hero .primary,.hero .secondary{min-height:46px;padding:12px 20px!important;font-size:14px!important;font-weight:800!important;border-radius:12px!important}
.hero .primary{box-shadow:0 10px 30px rgba(124,140,255,.35),inset 0 1px 0 rgba(255,255,255,.25)!important}
.hero .secondary:hover,.prod-actions a:hover{border-color:rgba(124,140,255,.5)!important}
/* MOTION VOCABULARY */
@keyframes rz-flow{from{background-position:200% 0}to{background-position:-200% 0}}
@keyframes rz-pulse{0%,100%{box-shadow:0 0 0 0 rgba(124,140,255,.45)}50%{box-shadow:0 0 0 7px rgba(124,140,255,0)}}
@keyframes rz-ring{0%{opacity:.8;transform:scale(.9)}100%{opacity:0;transform:scale(1.25)}}
@keyframes rz-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){#wss-razzle-v2 *,.metric,.mile-track>*,.activity-progress::after,.primary::after{animation:none!important;transition:none!important}}
</style>`;

const liquidGlass = `<style id="wss-liquid-glass-command-center">
:root{--glass-edge:rgba(255,255,255,.145);--glass-top:rgba(255,255,255,.075);--glass-shadow:0 18px 48px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.10)}
.hero,.production,.panel,.metric,.mile,.feed,.factory,.side-live,.status,.smallbtn,.secondary,.primary,.prod-actions a{backdrop-filter:blur(18px) saturate(145%);-webkit-backdrop-filter:blur(18px) saturate(145%);box-shadow:var(--glass-shadow)}
.hero,.production,.panel,.feed,.factory{background-image:linear-gradient(145deg,var(--glass-top),rgba(255,255,255,.018) 38%,rgba(93,124,255,.035));border-color:var(--glass-edge)}
.primary,.secondary,.smallbtn,.prod-actions a{position:relative;overflow:hidden;border:1px solid var(--glass-edge);background-image:linear-gradient(145deg,rgba(255,255,255,.13),rgba(255,255,255,.025) 46%,rgba(93,124,255,.12));box-shadow:0 10px 28px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.16);transition:transform .18s ease,filter .18s ease,border-color .18s ease,box-shadow .18s ease}
.primary{background-image:linear-gradient(135deg,rgba(112,137,255,.95),rgba(139,117,255,.88));border-color:rgba(255,255,255,.20)}
.primary:before,.secondary:before,.smallbtn:before,.prod-actions a:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 85% at 18% -18%,rgba(255,255,255,.28),transparent 45%);opacity:.68}
.primary:hover,.secondary:hover,.smallbtn:hover,.prod-actions a:hover{transform:translateY(-2px);filter:brightness(1.07);border-color:rgba(255,255,255,.24);box-shadow:0 15px 34px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.2)}
.mile,.metric{background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.014));border-color:rgba(255,255,255,.105);box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}
.activity .act-copy span{white-space:normal;line-height:1.5}.activity-progress,.act-progress,.activity-track{background:repeating-linear-gradient(90deg,#262b35 0,#262b35 calc(20% - 4px),transparent calc(20% - 4px),transparent 20%)!important}
#passwordModal label{display:block;margin-top:12px;color:var(--muted);font-size:12px;font-weight:700}#passwordModal input{display:block;width:100%;margin-top:6px;min-height:46px;border:1px solid var(--line2);border-radius:10px;background:#0d1016;color:var(--text);padding:10px 12px}
@media(prefers-reduced-motion:reduce){.primary,.secondary,.smallbtn,.prod-actions a{transition:none!important;transform:none!important}}
</style>`;
if (!page.includes("wss-liquid-glass-command-center")) page = page.replace("</head>", `${liquidGlass}</head>`);
if (!page.includes("wss-razzle-v2")) page = page.replace("</head>", `${razzle}</head>`);

// HUMAN WORDS, not operator jargon (owner: "made for humans to read and
// comprehend"). None of these strings is test-pinned; the pinned vocabulary
// ("Build, watch, and ship…", "Factory details", nav names) is untouched.
page = page
  .replace("Live operator workspace", "Your website factory")
  .replace("Real milestones from the factory — not timer-based animation.", "Watch each website move through its real stages — researched, built, inspected, ready.")
  .replace("The operational detail stays here; old campaign inventory stays out.", "Everything you need is one tap away.")
  .replace(/Practice lane/g, "Practice mode");

module.exports = page;
