"use strict";

/**
 * lib/line-console-page.js — THE operator control surface.
 *
 * One screen, one flow, nothing decorative:
 *
 *   pick/mine -> qualify -> mirror -> RENDER-GATE -> write preview_url
 *             -> queue email -> operator approves batch -> send
 *
 * Design rules this page obeys, each one earned:
 *   · Every control on this page calls a real endpoint. If a button renders,
 *     it does something. (The previous console shipped five handlers whose
 *     markup had been deleted — dead buttons that could never have run.)
 *   · A row's verdict is shown as EIGHT named facts with PASS/FAIL and the
 *     reason. "Blocked" without the fact is what let brand pass on logoImgs=0.
 *   · A send starts only after the operator confirms the exact batch id. There
 *     is no auto-send and no loop that reaches a prospect without that click.
 *
 * Contains no secrets: the token is entered in-browser and only ever leaves as
 * an x-admin-token header.
 */

const { operatorNav } = require("./operator-nav");

module.exports = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Ghost Line · operator control</title>
<style>
  :root{
    --bg:#0b0e14; --panel:#131823; --panel2:#1a2030; --line:#242c3d;
    --ink:#e8edf7; --dim:#8b97ad; --accent:#4f8cff; --ok:#31c48d; --bad:#f05252; --warn:#e3a008;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em}
  header.top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
  header.top h1{font-size:17px;margin:0;letter-spacing:.2px}
  .wrap{max-width:1180px;margin:0 auto;padding:20px}
  .card{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
  .card h2{font-size:14px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim)}
  .hint{color:var(--dim);font-size:13px;margin-bottom:12px}
  .btn{min-height:44px;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;font-size:14px}
  .btn:disabled{opacity:.45;cursor:not-allowed}
  .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--ink)}
  .btn.go{background:var(--ok)}
  .btn.danger{background:var(--bad)}
  .launch{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
  .launch .btn{min-width:120px;font-size:15px;padding:14px 18px}
  input,select{min-height:44px;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:9px 11px;font-size:14px}
  input{min-width:230px}
  .chips{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:12px;background:var(--panel2)}
  .chip.ok{border-color:var(--ok);color:var(--ok)}
  .chip.bad{border-color:var(--bad);color:var(--bad)}
  .chip.warn{border-color:var(--warn);color:var(--warn)}
  .stage-strip{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 4px}
  .stage{flex:1 1 120px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;text-align:center}
  .stage b{display:block;font-size:19px}
  .stage span{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
  .rows{width:100%;border-collapse:collapse;font-size:13px}
  .rows a,.rows .hint,.fact .m{overflow-wrap:anywhere}
  .rows th{text-align:left;color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:8px 8px;border-bottom:1px solid var(--line)}
  .rows td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  .rows tr[data-status="queued"] td:first-child{border-left:3px solid var(--ok)}
  .rows tr[data-status="gate_failed"] td:first-child,.rows tr[data-status="error"] td:first-child,.rows tr[data-status="rejected"] td:first-child{border-left:3px solid var(--bad)}
  .verdict{font-weight:700}
  .verdict.pass{color:var(--ok)}
  .verdict.fail{color:var(--bad)}
  .verdict.work{color:var(--warn)}
  .facts{margin-top:6px;display:none}
  tr.open .facts{display:block}
  .facts-btn{min-width:64px;padding:8px 10px;font-size:12px}
  .fact{display:flex;gap:8px;padding:3px 0;font-size:12px;align-items:baseline}
  .fact .n{width:190px;flex:0 0 190px;color:var(--dim)}
  .fact.pass .m{color:var(--ok)}
  .fact.fail .m{color:var(--bad)}
  .empty{color:var(--dim);padding:18px;text-align:center;border:1px dashed var(--line);border-radius:8px}
  /* The mine funnel: how many candidates each stage kept, and what killed the
     rest. /api/admin/line has always carried it; this page dropped it, so a
     zero-yield run read as a blank screen. */
  .mfun{margin:10px 0 14px;border:1px solid var(--line);border-radius:10px;padding:11px 12px;background:var(--panel2)}
  .mcap{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--dim);margin-bottom:8px}
  .mrow{display:grid;grid-template-columns:190px 1fr 44px;gap:10px;align-items:center;margin-bottom:2px}
  .mlab{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dim);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mbar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.05)}
  .mbar i{display:block;height:100%;background:var(--ok)}
  .mbar u{display:block;height:100%;background:rgba(240,82,82,.45)}
  .mnum{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;text-align:right;color:var(--ink)}
  .mkill{grid-column:2/-1;display:flex;flex-wrap:wrap;gap:5px;margin:1px 0 6px}
  .kchip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;padding:1px 7px;border-radius:6px;
        border:1px solid rgba(240,82,82,.32);background:rgba(240,82,82,.07);color:var(--dim);white-space:nowrap}
  .kchip b{color:var(--bad);margin-left:5px}
  .approve{border:1px solid var(--warn);border-radius:10px;padding:14px;background:rgba(227,160,8,.07)}
  .approve.armed{border-color:var(--ok);background:rgba(49,196,141,.08)}
  .gate-banner{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:10px 12px;color:var(--dim);font-size:13px;margin-bottom:12px}
  .out{background:#0a0d13;border:1px solid var(--line);border-radius:8px;padding:10px;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;max-height:230px;overflow:auto;margin-top:10px}
  .gate{position:fixed;inset:0;background:rgba(6,9,14,.96);display:none;place-items:center;z-index:40}
  .gate.show{display:grid}
  .gate .card{max-width:400px;width:92%}
  .row-detail{position:fixed;inset:0;background:rgba(6,9,14,.88);display:none;place-items:center;z-index:45;padding:14px}
  .row-detail.show{display:grid}
  .row-detail .card{width:min(760px,100%);max-height:88vh;overflow:auto}
  .row-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .row-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
  .row-detail-grid .cell{border:1px solid var(--line);border-radius:8px;background:var(--panel2);padding:8px}
  .row-detail-grid .cell span{display:block;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  .row-detail-grid .cell b{display:block;margin-top:5px;font-size:13px;overflow-wrap:anywhere}
  .row-detail pre{margin:10px 0 0;border:1px solid var(--line);border-radius:8px;background:#0a0d13;padding:10px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}

  /* ---- THE STOP SWITCH ---------------------------------------------------
     An emergency control, not a settings toggle: full bleed, above every other
     card, its own colour, and it never scrolls out of reach. It reads its state
     from the SERVER on every refresh, so a reload cannot make it lie. */
  .halt{position:sticky;top:0;z-index:30;display:grid;
        grid-template-columns:14px 1fr auto;gap:10px 12px;align-items:center;
        padding:12px 20px;border-bottom:1px solid var(--line);
        background:linear-gradient(180deg,#161d2b,#111726)}
  .halt[data-halt="halted"]{background:linear-gradient(180deg,#3a1416,#260f12);border-bottom-color:var(--bad)}
  .halt[data-halt="unknown"],.halt[data-halt="error"]{background:linear-gradient(180deg,#2e2410,#1d1809);border-bottom-color:var(--warn)}
  .halt-lamp{width:14px;height:14px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(49,196,141,.16)}
  .halt[data-halt="halted"] .halt-lamp{background:var(--bad);box-shadow:0 0 0 3px rgba(240,82,82,.2)}
  .halt[data-halt="unknown"] .halt-lamp,.halt[data-halt="error"] .halt-lamp{background:var(--warn);box-shadow:0 0 0 3px rgba(227,160,8,.2)}
  .halt-title{font-size:15px;font-weight:800;letter-spacing:.3px}
  .halt[data-halt="halted"] .halt-title{color:var(--bad)}
  .halt[data-halt="unknown"] .halt-title,.halt[data-halt="error"] .halt-title{color:var(--warn)}
  .halt-sub{font-size:12.5px;color:var(--dim);margin-top:2px}
  .halt-btn{min-height:44px;background:var(--bad);color:#fff;border:0;border-radius:8px;padding:13px 20px;
            font-weight:800;font-size:14px;letter-spacing:.4px;cursor:pointer;white-space:nowrap}
  .halt-btn:disabled{opacity:.45;cursor:not-allowed}
  .halt-btn.armed{background:#fff;color:#7f1d1d;outline:3px solid var(--bad);outline-offset:2px}
  .halt-btn.resume{background:transparent;border:1px solid var(--ok);color:var(--ok)}
  .halt-scope{grid-column:2/-1;font-size:12px;color:var(--dim);line-height:1.45}
  .halt-scope b{color:var(--ink);font-weight:700}
  .halt-out{grid-column:2/-1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
            border-radius:8px;padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid var(--line);
            white-space:pre-wrap;display:none}
  .halt-out.show{display:block}
  .halt-out.bad{border-color:var(--bad);color:#ffd7d7;background:rgba(240,82,82,.1)}
  .halt-out.ok{border-color:var(--ok);color:#c9f5e4;background:rgba(49,196,141,.09)}
  @media(max-width:720px){.halt{grid-template-columns:14px 1fr;padding:10px 12px}
    .halt-btn{grid-column:1/-1;width:100%}}
  @media(max-width:720px){.wrap{padding:12px}.fact .n{width:120px;flex:0 0 120px}
    .mrow{grid-template-columns:110px 1fr 34px;gap:7px}
    .mkill{grid-column:1/-1;min-width:0}.kchip{max-width:100%;overflow:hidden;text-overflow:ellipsis}}
  @media(max-width:420px){
    header.top{padding:12px}.wrap{padding:10px}.card{padding:13px;margin-bottom:12px}
    .launch{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
    .launch .btn{min-width:0;padding:11px 6px}
    .chips>*{max-width:100%}input{width:100%;min-width:0}.mono{overflow-wrap:anywhere}
    .rows,.rows tbody,.rows tr,.rows td{display:block;width:100%}
    .rows thead{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    .rows tr{border:1px solid var(--line);border-radius:10px;margin:0 0 10px;padding:7px 9px;background:var(--panel2);overflow:hidden}
    .rows tr[data-status="queued"]{border-left:3px solid var(--ok)}
    .rows tr[data-status="gate_failed"],.rows tr[data-status="error"],.rows tr[data-status="rejected"]{border-left:3px solid var(--bad)}
    .rows tr[data-status] td:first-child{border-left:0}
    .rows td{display:grid;grid-template-columns:minmax(82px,30%) minmax(0,1fr);gap:8px;padding:8px 2px;border-bottom:1px solid var(--line);min-width:0}
    .rows td:last-child{border-bottom:0}.rows td::before{content:attr(data-label);color:var(--dim);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
    .rows td[data-label="Business"]{display:block}.rows td[data-label="Business"]::before{display:block;margin-bottom:4px}
    .rows td[data-label="Actions"]{grid-template-columns:1fr}.rows td[data-label="Actions"]::before{margin-bottom:2px}
    .facts-btn{width:100%}.fact{display:grid;grid-template-columns:1fr;gap:1px;padding:5px 0}.fact .n{width:auto;flex:auto}
  }
</style>
</head>
<body>
${operatorNav("line")}
<div class="gate" id="authGate" role="dialog" aria-modal="true" aria-labelledby="authTitle" aria-describedby="authHelp" aria-hidden="true">
  <div class="card">
    <h2 id="authTitle">Operator token</h2>
    <div class="hint" id="authHelp">Paste the admin token. It is stored in this browser only.</div>
    <input id="tok" type="password" placeholder="admin token" style="width:100%">
    <div id="gateErr" class="hint" role="alert" aria-live="assertive" style="color:var(--bad);min-height:18px"></div>
    <button class="btn" id="gateGo" type="button" style="width:100%">Open the line</button>
  </div>
</div>
<div class="row-detail" id="rowDetail" role="dialog" aria-modal="true" aria-labelledby="rowDetailTitle" aria-hidden="true">
  <div class="card">
    <div class="row-detail-head">
      <div>
        <h2 id="rowDetailTitle">Row detail</h2>
        <div class="hint" id="rowDetailSub">Debug truth from the latest server row.</div>
      </div>
      <button class="btn ghost" id="rowDetailClose" type="button">Close</button>
    </div>
    <div class="row-detail-grid" id="rowDetailGrid"></div>
    <pre id="rowDetailRaw"></pre>
  </div>
</div>

<header class="top">
  <h1>⚙️ Ghost Line <span class="hint" style="margin:0">operator control</span></h1>
  <div class="chips" id="stateChips"><span class="chip" id="chipReady">connecting…</span></div>
</header>

<div class="halt" id="haltBar" data-halt="unknown">
  <span class="halt-lamp" aria-hidden="true"></span>
  <div>
    <div class="halt-title" id="haltTitle">Reading the stop switch…</div>
    <div class="halt-sub" id="haltSub">Asking the server whether outreach is paused.</div>
  </div>
  <button class="halt-btn" id="haltBtn" type="button" disabled>STOP ALL SENDS</button>
  <div class="halt-scope">
    <b>Stop halts:</b> every prospect email at the moment of send · the hourly drip · a running batch before it starts the next site · a running send pass before its next email.
    <b>Stop cannot recall:</b> the one site or the one email already in flight when you press it — and it does not block a proof addressed to your own inbox.
  </div>
  <div class="halt-out" id="haltOut" role="status" aria-live="polite" aria-atomic="true"></div>
</div>

<div class="wrap">

  <div class="card">
    <h2>1 · Launch the line</h2>
    <div class="hint">One press runs the whole flow: pick or mine → qualify → mirror → render gate → write preview URL → queue email. Nothing is sent here.</div>
    <div class="launch">
      <button class="btn" type="button" data-launch="50" id="mine50">Mine 50</button>
      <button class="btn" type="button" data-launch="100" id="mine100">Mine 100</button>
      <button class="btn" type="button" data-launch="500" id="mine500">Mine 500</button>
    </div>
    <div class="chips" style="margin-bottom:10px">
      <input id="target" placeholder="roofing in Austin, TX (blank = use stored leads)">
      <select id="lane">
        <option value="sandbox">Sandbox — every email routes to me</option>
        <option value="live">Live prospects</option>
      </select>
    </div>
    <div class="gate-banner" id="gateBanner">The render gate runs on every row and cannot be switched off from this screen.</div>
    <div class="out" id="launchOut" role="status" aria-live="polite" aria-atomic="true" style="display:none"></div>
  </div>

  <div class="card">
    <h2>2 · The line</h2>
    <div class="hint" id="batchLine" role="status" aria-live="polite" aria-atomic="true">No batch running.</div>
    <div class="stage-strip" id="stages"></div>
    <div id="mineFunnel"></div>
    <div id="rowsHost"><div class="empty">Press a launch button to start a batch.</div></div>
  </div>

  <div class="card" id="approveCard" style="display:none">
    <h2>3 · Approve &amp; send</h2>
    <div class="hint">One click approves this exact batch and sends it. The confirm names the batch id first, so nothing goes out by accident.</div>
    <div class="approve" id="approveBox">
      <div class="chips" style="margin-bottom:10px">
        <span class="mono" id="approveBatchId">—</span>
        <button class="btn go" id="sendBtn" type="button" disabled>Approve &amp; send this batch</button>
      </div>
      <div class="hint" id="approveHint" style="margin:0">This appears only when a batch has sites past the render gate.</div>
    </div>
    <div class="out" id="sendOut" role="status" aria-live="polite" aria-atomic="true" style="display:none"></div>
  </div>

  <div class="card">
    <h2>Readiness · holds · spend</h2>
    <div class="chips" id="readyChips"></div>
    <div class="stage-strip" id="spend"></div>
  </div>

</div>

<script>
(function(){
  var KEY="wsl_admin_token";
  var BUILD_LIVE={queued:true,building:true,running:true};
  var SEND_PASS_DELAY_MS=1200;
  var MAX_SEND_PASSES=20;
  var state={
    batch:null,readiness:null,spend:null,facts:[],pollTimer:null,
    buildWatching:false,launchPending:false,activeBatchId:"",openFacts:{},gateReturnFocus:null,startRetry:null,detailReturnFocus:null,
    send:{running:false,retry:false,batchId:"",passes:0,attempted:0,sent:0,failed:0,remaining:null},
  };
  function token(){try{return localStorage.getItem(KEY)||"";}catch(e){return "";}}
  function setToken(v){try{localStorage.setItem(KEY,v);}catch(e){}}
  function clearToken(){try{localStorage.removeItem(KEY);}catch(e){}}
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function el(id){return document.getElementById(id);}
  function showGate(msg){
    var gate=el("authGate");
    if(!gate.classList.contains("show")){
      state.gateReturnFocus=document.activeElement&&document.activeElement!==document.body?document.activeElement:null;
      gate.classList.add("show");gate.setAttribute("aria-hidden","false");
    }
    if(msg)el("gateErr").textContent=msg;
    setTimeout(function(){el("tok").focus();},0);
  }
  function hideGate(){
    var gate=el("authGate");
    if(!gate.classList.contains("show"))return;
    gate.classList.remove("show");gate.setAttribute("aria-hidden","true");
    var restore=state.gateReturnFocus;state.gateReturnFocus=null;
    if(restore&&document.contains(restore)&&typeof restore.focus==="function")restore.focus();
  }
  function text(v,fb){var s=String(v==null?"":v).trim();return s||String(fb==null?"":fb);}
  function detailCell(label,value){
    return '<div class="cell"><span>'+esc(label)+'</span><b>'+esc(value==null?"":String(value))+'</b></div>';
  }
  function closeRowDetail(){
    var card=el("rowDetail");
    if(!card.classList.contains("show"))return;
    card.classList.remove("show");
    card.setAttribute("aria-hidden","true");
    var restore=state.detailReturnFocus;state.detailReturnFocus=null;
    if(restore&&document.contains(restore)&&typeof restore.focus==="function")restore.focus();
  }
  function mirrorHint(r){
    if(!r) return "";
    var md=r.mirrorDispatch;
    var hr=r.heroRemaster;
    if(md&&md.status==="failed_before_build"){
      return "Mirror build was not requested: "+(md.cause||md.reason||"dispatch failed before a build existed");
    }
    if(md&&md.status==="dispatching"){
      return "Mirror dispatch in progress; no build result yet.";
    }
    if(md&&md.status==="failed"){
      return "Mirror provider rejected the build request"+(md.cause?": "+esc(md.cause):"")+".";
    }
    if(hr&&hr.status==="blocked"){
      return "Hero work blocked: no durable job identity — a phantom pending marker was cleared to prevent an invalid resume.";
    }
    if(md&&md.hasPreview){
      return "Mirror build exists; render inspection is pending.";
    }
    // No dispatch record at all. Distinguish a row that is still waiting to
    // enter the build phase from one that already failed or rejected before
    // a Mirror dispatch was ever staged — the old generic "render gate has not
    // run" string was wrong for both and hid the real phase.
    var s=r.status||"";
    if(s==="error"||s==="rejected"||s==="gate_failed"){
      return "Mirror dispatch never started; the row failed before the build phase.";
    }
    if(s==="mirrored"||s==="gate_passed"){
      return "Mirror build exists; render inspection is pending.";
    }
    return "Mirror dispatch has not started yet; the row is waiting to enter the build phase.";
  }
  function mirrorDispatchText(row){
    var md=row&&row.mirrorDispatch;
    if(!md) return "none recorded";
    var parts=["status: "+esc(md.status||"unknown")];
    if(md.attemptId) parts.push("attempt "+esc(String(md.attemptId).slice(0,24)));
    if(md.cause) parts.push("cause "+esc(md.cause));
    if(md.beforeBuild) parts.push("before build");
    if(md.hasDurableBuildIdentity) parts.push("durable build identity");
    if(md.priorAttemptId) parts.push("prior "+esc(String(md.priorAttemptId).slice(0,24)));
    return parts.join(" · ");
  }
  function openRowDetail(row,batch,trigger){
    var card=el("rowDetail");
    state.detailReturnFocus=trigger&&typeof trigger.focus==="function"?trigger:document.activeElement;
    el("rowDetailSub").textContent=(row&&row.businessName)||row&&row.prospectId||"Row";
    el("rowDetailGrid").innerHTML=[
      detailCell("Run ID",text(batch&&batch.batchId,"unknown")),
      detailCell("Prospect ID",text(row&&row.prospectId,"unknown")),
      detailCell("Stage",text(row&&row.status,"unknown")),
      detailCell("Gate result",text(row&&row.gateResult,"unknown")),
      detailCell("Failure reason",text(row&&row.reason,"none recorded")),
      detailCell("Updated at",text(row&&row.updatedAt,"unknown")),
      detailCell("Preview URL",text(row&&row.previewUrl,"—")),
      detailCell("Mirror dispatch",mirrorDispatchText(row)),
      detailCell("Deploy/report URL",text((row&&row.deployUrl)||"", "—")),
      detailCell("Send job ID",text((row&&row.sendJobId)||"", "—")),
      detailCell("Reached",Array.isArray(row&&row.reached)&&row.reached.length?row.reached.join(" > "):"none"),
    ].join("");
    el("rowDetailRaw").textContent=JSON.stringify({ runId:text(batch&&batch.batchId,""), row:row||{} },null,2);
    card.classList.add("show");
    card.setAttribute("aria-hidden","false");
    setTimeout(function(){el("rowDetailClose").focus();},0);
  }
  function out(id,value){var n=el(id);n.style.display="block";n.textContent=typeof value==="string"?value:JSON.stringify(value,null,2);}

  function api(path,opts){
    opts=opts||{};
    opts.headers=Object.assign({},opts.headers||{},{"x-admin-token":token()});
    opts.cache="no-store";
    return fetch(path,opts).then(function(r){
      if(r.status===401){clearToken();showGate("Token rejected. Enter a current operator token.");throw new Error("401");}
      return r.json().catch(function(){return {ok:false,error:"bad_json",status:r.status};});
    });
  }
  function post(body){
    if(body&&body.action==="start"&&!body.idempotencyKey){
      var signature=startSignature(body.count,body.target,body.lane);
      body=Object.assign({},body,{idempotencyKey:startKeyFor(signature)});
    }
    return api("/api/admin/line",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});
  }
  function newStartIdempotencyKey(){
    var source=window.crypto;
    if(!source||typeof source.getRandomValues!=="function")throw new Error("Secure random launch keys are unavailable in this browser");
    var bytes=new Uint8Array(16);
    source.getRandomValues(bytes);
    return "launch-"+Array.prototype.map.call(bytes,function(value){return value.toString(16).padStart(2,"0");}).join("");
  }
  function startSignature(count,target,lane){
    return JSON.stringify([String(lane||""),String(target||""),Number(count)||0]);
  }
  function startKeyFor(signature){
    if(!state.startRetry||state.startRetry.signature!==signature){
      state.startRetry={signature:signature,key:newStartIdempotencyKey()};
    }
    return state.startRetry.key;
  }
  function clearStartRetry(signature,key){
    if(!state.startRetry)return;
    if(signature&&state.startRetry.signature!==signature)return;
    if(key&&state.startRetry.key!==key)return;
    state.startRetry=null;
  }
  function retainStartRetryBatch(signature,key,payload){
    if(!state.startRetry||state.startRetry.signature!==signature||state.startRetry.key!==key)return;
    var batch=payload&&payload.batch;
    state.startRetry.batchId=String(payload&&(payload.batchId||(batch&&batch.batchId))||"");
  }
  function startResponseRetryable(payload){return !!(payload&&payload.ok===false&&payload.retryable===true);}
  function isBuildLive(batch){return !!(batch&&BUILD_LIVE[String(batch.status||"")]);}
  function nonNegative(value,fallback){
    if(value===null||value===""||typeof value==="undefined")return fallback;
    var n=Number(value);
    return Number.isFinite(n)&&n>=0?Math.floor(n):fallback;
  }
  function delay(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function syncLaunchControls(){
    var disabled=state.launchPending||state.buildWatching||isBuildLive(state.batch);
    document.querySelectorAll("[data-launch]").forEach(function(b){b.disabled=disabled;});
  }
  function renderBuildProgress(batch){
    syncLaunchControls();
    if(!batch)return;
    var live=isBuildLive(batch);
    var c=batch.counts||{};
    var complete=nonNegative(c.queued,0)+nonNegative(c.failed,0)+nonNegative(c.sent,0);
    var total=nonNegative(c.total,nonNegative(batch.requested,"?"));
    if(live){
      state.buildWatching=true;
      var verb=batch.status==="queued"?"Queued":"Building";
      out("launchOut",verb+" "+complete+" of "+total+"… (batch "+batch.batchId+", server-owned continuation; this page is only polling status)");
      return;
    }
    if(!state.buildWatching)return;
    state.buildWatching=false;
    syncLaunchControls();
    if(batch.status==="awaiting_approval")out("launchOut","Batch "+batch.batchId+" finished the build phase. Nothing has been sent.");
    else if(batch.status==="done")out("launchOut","Batch "+batch.batchId+" is done.");
    else if(batch.status==="halted")out("launchOut","Batch "+batch.batchId+" halted. Nothing restarts from this browser.");
  }

  // ---- rendering ----------------------------------------------------------
  var STAGES=[["picked","picked"],["qualified","qualified"],["mirrored","mirrored"],["gate_passed","gate passed"],["queued","queued"],["sent","sent"]];
  function renderStages(batch){
    var host=el("stages");
    if(!batch){host.innerHTML="";return;}
    // Count the stages a row actually REACHED, from its own history — not from
    // its current status. A row that failed the gate has status "gate_failed",
    // which is in no progress order, so counting by status alone reported
    // "2 picked" for a batch of three and made the strip disagree with the row
    // count directly beneath it.
    var seen={};
    var order=["picked","qualified","mirrored","gate_passed","queued","sent"];
    (batch.rows||[]).forEach(function(r){
      var reached=(r.reached||[]).slice();
      if(!reached.length)reached=[r.status];
      order.forEach(function(stage){if(reached.indexOf(stage)>=0)seen[stage]=(seen[stage]||0)+1;});
    });
    var blocked=(batch.rows||[]).filter(function(r){return r.status==="gate_failed"||r.status==="error"||r.status==="rejected";}).length;
    host.innerHTML=STAGES.map(function(s){
      return '<div class="stage"><b>'+(seen[s[0]]||0)+'</b><span>'+esc(s[1])+'</span></div>';
    }).join("")+'<div class="stage"><b style="color:var(--bad)">'+blocked+'</b><span>blocked</span></div>';
  }

  // WHERE THE RUN DIED. The miner counts every elimination by stage AND by
  // reason; the reasons are the operator's whole answer to "was that the market
  // or was that our grader?" — seven leads killed for "no own domain logo" is a
  // grading decision to argue with, one killed by "http 403" is not.
  function renderFunnel(batch){
    var host=el("mineFunnel");
    var rows=batch&&batch.mineFunnel;
    if(!rows||!rows.length){host.innerHTML="";return;}
    var top=0;
    rows.forEach(function(s){top=Math.max(top,Number(s&&s.entered)||0);});
    if(!top){host.innerHTML="";return;}
    var html='<div class="mfun"><div class="mcap">Mine funnel — candidates kept vs killed, and what killed them</div>';
    rows.forEach(function(s){
      var entered=Number(s&&s.entered)||0,survived=Number(s&&s.survived)||0;
      var killed=Math.max(0,entered-survived);
      var counts=(s&&s.rejected)||{};
      var keys=Object.keys(counts).sort(function(a,b){
        return (Number(counts[b])||0)-(Number(counts[a])||0)||a.localeCompare(b);
      });
      var chips="";
      keys.forEach(function(k){
        // Reason keys can carry the offending URL inline (the store holds a
        // real 78-character one). Untruncated, one chip pushed the page into
        // horizontal scroll at 390px. The count is never truncated and the
        // full reason stays on hover.
        var full=String(k).replace(/_/g," ");
        var label=full.length>46?full.slice(0,45)+"\\u2026":full;
        chips+='<span class="kchip" title="'+esc(full)+'">'+esc(label)+'<b>'+(Number(counts[k])||0)+'</b></span>';
      });
      html+='<div class="mrow"><span class="mlab">'+esc(String(s&&s.stage||"").replace(/_/g," "))+'</span>'
        +'<span class="mbar"><i style="width:'+(survived/top*100)+'%"></i><u style="width:'+(killed/top*100)+'%"></u></span>'
        +'<span class="mnum">'+survived+'</span>'
        +(chips?'<span class="mkill">'+chips+'</span>':"")+'</div>';
    });
    host.innerHTML=html+'</div>';
  }

  function verdictFor(row,batch){
    if(batch&&batch.status==="halted"&&row.status==="queued")return {cls:"fail",text:"BUILD PASS · DELIVERY BLOCKED"};
    if(row.status==="queued"||row.status==="sent")return {cls:"pass",text:"PASS"};
    if(row.status==="gate_failed"||row.status==="error"||row.status==="rejected")return {cls:"fail",text:"FAIL"};
    return {cls:"work",text:row.status.replace(/_/g," ")};
  }

  function renderRows(batch){
    var host=el("rowsHost");
    if(!batch||!(batch.rows||[]).length){host.innerHTML='<div class="empty">Press a launch button to start a batch.</div>';return;}
    var body=batch.rows.map(function(r,i){
      var v=verdictFor(r,batch);
      var factKey=String(r.prospectId||i);
      var open=state.openFacts[factKey]===true;
      var facts=(r.facts||[]).map(function(f){
        return '<div class="fact '+(f.pass?"pass":"fail")+'"><span class="n">'+esc(f.fact)+'</span><span class="m">'+(f.pass?"PASS":"FAIL")+' — '+esc(f.reason)+'</span></div>';
      }).join("");
      var why=batch.status==="halted"&&r.status==="queued"
        ?'<div class="hint" style="margin:4px 0 0">Build passed. Delivery is blocked because this run is HALTED.</div>'
        :(r.reason?'<div class="hint" style="margin:4px 0 0">'+esc(r.reason)+'</div>':"");
      return '<tr class="'+(open?"open":"")+'" data-status="'+esc(r.status)+'" data-row="'+i+'">'
        +'<td data-label="Business"><b>'+esc(r.businessName||r.prospectId)+'</b><div class="hint" style="margin:0">'+esc([r.city,r.state].filter(Boolean).join(", "))+(r.vertical?" · "+esc(r.vertical):"")+'</div>'
        +why
        +'<div class="facts" id="facts-'+i+'">'+(facts||'<div class="hint" style="margin:0">'+esc(mirrorHint(r))+'</div>')+'</div></td>'
        +'<td data-label="Stage" class="mono">'+esc(r.status)+'</td>'
        +'<td data-label="Gate"><span class="verdict '+v.cls+'">'+esc(v.text)+'</span>'+((r.failedFacts||[]).length?'<div class="hint" style="margin:0">'+esc(r.failedFacts.join(", "))+'</div>':"")+'</td>'
        +'<td data-label="Preview URL">'+(r.previewUrl?'<a href="'+esc(r.previewUrl)+'" target="_blank" rel="noopener" class="mono">preview</a>':'<span class="hint">not written</span>')+'</td>'
        +'<td data-label="Actions"><button class="btn ghost facts-btn" type="button" data-facts="'+i+'" aria-expanded="'+(open?"true":"false")+'" aria-controls="facts-'+i+'" aria-label="Facts for '+esc(r.businessName||r.prospectId)+'">Facts</button><button class="btn ghost facts-btn" type="button" data-detail="'+i+'" aria-label="Row detail for '+esc(r.businessName||r.prospectId)+'">Details</button></td></tr>';
    }).join("");
    host.innerHTML='<table class="rows"><thead><tr><th>Business</th><th>Stage</th><th>Gate</th><th>Preview URL</th><th></th></tr></thead><tbody>'+body+'</tbody></table>';
    host.querySelectorAll("[data-facts]").forEach(function(b){
      b.onclick=function(){
        var row=b.closest("tr");
        var open=!row.classList.contains("open");
        row.classList.toggle("open",open);b.setAttribute("aria-expanded",open?"true":"false");
        var i=Number(b.getAttribute("data-facts"));
        var item=state.batch&&state.batch.rows&&state.batch.rows[i];
        if(item)state.openFacts[String(item.prospectId||i)]=open;
      };
    });
    host.querySelectorAll("[data-detail]").forEach(function(b){
      b.onclick=function(){
        var i=Number(b.getAttribute("data-detail"));
        var item=state.batch&&state.batch.rows&&state.batch.rows[i];
        if(item)openRowDetail(item,state.batch,b);
      };
    });
  }

  function renderApproval(batch){
    var card=el("approveCard");
    var box=el("approveBox");
    var sendBtn=el("sendBtn");
    var queued=(batch&&batch.counts&&batch.counts.queued)||0;
    var approved=!!batch&&(batch.status==="approved"||batch.status==="sending"||batch.status==="done");
    var settled=!!batch&&(batch.status==="awaiting_approval"||approved);
    // HIDE the whole section unless a real send is possible. An empty or
    // gate-blocked batch used to render a live approve/send box with nothing
    // behind it — the confusing "makes no sense" state, because zero rows had
    // passed the render gate. Now the panel simply isn't there until it is.
    var show=settled&&queued>0;
    card.style.display=show?"":"none";
    el("approveBatchId").textContent=batch?batch.batchId:"—";
    if(!show){ sendBtn.disabled=true; box.classList.remove("armed"); return; }
    // A partial pass returns the batch to "approved". That is already a durable
    // approval, so the next explicit click resumes it without approving twice.
    var sending=state.send.running||batch.status==="sending"||batch.status==="done";
    sendBtn.disabled=sending;
    box.classList.toggle("armed",approved);
    if(state.send.running){
      sendBtn.textContent="Sending… pass "+state.send.passes;
      el("approveHint").textContent=queued+" site(s) remain in this approved batch.";
    }else if(batch.status==="approved"){
      sendBtn.textContent=state.send.retry?"Retry remaining "+queued:"Resume sending this batch";
      el("approveHint").textContent=queued+" site(s) are already approved. Resume does not ask the server to approve them again.";
    }else if(batch.status==="sending"){
      sendBtn.textContent="Send pass in progress…";
      el("approveHint").textContent=queued+" site(s) remain; wait for the server pass to finish.";
    }else{
      sendBtn.textContent="Approve & send this batch";
      el("approveHint").textContent=queued+" site(s) passed the render gate — one click approves and sends them.";
    }
  }

  function renderReadiness(r,spend){
    var chips=[];
    if(r){
      chips.push('<span class="chip '+(r.ready?"ok":"bad")+'">'+(r.ready?"ready":"blocked")+'</span>');
      chips.push('<span class="chip '+(r.deliveryPause.active?"bad":"ok")+'">delivery '+(r.deliveryPause.active?"paused":"live")+'</span>');
      chips.push('<span class="chip '+(r.reviewHold.active?"warn":"ok")+'">review hold '+(r.reviewHold.active?"ON":"off")+'</span>');
      chips.push('<span class="chip '+(r.liveSendsEnabled?"warn":"ok")+'">live lane '+(r.liveSendsEnabled?"enabled":"disabled")+'</span>');
      (r.blockers||[]).forEach(function(b){chips.push('<span class="chip bad">'+esc(b.message||b.code)+'</span>');});
    }
    el("readyChips").innerHTML=chips.join("");
    el("chipReady").className="chip "+(r&&r.ready?"ok":"bad");
    el("chipReady").textContent=r?(r.ready?"ready":(r.blockers||[]).length+" blocker(s)"):"connecting…";
    var s=spend||{};
    el("spend").innerHTML=[
      ["batches",s.batches],["mirrors built",s.mirrorsAttempted],["gate passed",s.mirrorsGated],
      ["gate failed",s.gateFailures],["queued",s.queued],["sent",s.sent]
    ].map(function(p){return '<div class="stage"><b>'+(p[1]||0)+'</b><span>'+p[0]+'</span></div>';}).join("");
  }

  // ---- THE STOP SWITCH ----------------------------------------------------
  // SERVER STATE, ALWAYS. Several controls on the older consoles recorded their
  // state in localStorage and quietly reverted on reload; a stop button that
  // forgets it was pressed is worse than no stop button, because the operator
  // believes the line is halted. Nothing about this control is stored in this
  // browser. It is read from /api/admin/outreach-pause on open, on every poll,
  // and again immediately after every write — and what it prints afterwards is
  // that read-back, not the click.
  var halt={active:null,known:false,reason:"",at:"",error:"",armed:false,timer:null,busy:false,readAt:0};

  function haltState(){
    if(halt.error)return "error";
    if(halt.active===true)return halt.known?"halted":"unknown";
    if(halt.active===false)return "live";
    return "unknown";
  }
  function haltNote(text,tone){
    var n=el("haltOut");
    n.className="halt-out show"+(tone?" "+tone:"");
    n.textContent=text;
  }
  function disarmHalt(){
    halt.armed=false;
    if(halt.timer){clearTimeout(halt.timer);halt.timer=null;}
  }
  function armHalt(){
    halt.armed=true;renderHalt();
    // 20s, not 6: a human reading "CONFIRM — click again" for the first
    // time takes longer than 6 seconds, and the silent disarm made the
    // second click feel like a dead button — the owner hit exactly that.
    // Expiry now SAYS it expired instead of quietly resetting.
    halt.timer=setTimeout(function(){
      disarmHalt();renderHalt();
      haltNote("Confirmation window expired — nothing was changed. Press the button twice within 20 seconds to confirm.","bad");
    },20000);
  }
  function renderHalt(){
    var bar=el("haltBar"),btn=el("haltBtn"),s=haltState();
    bar.setAttribute("data-halt",s);
    btn.disabled=halt.busy===true;
    btn.classList.toggle("armed",halt.armed);
    btn.classList.toggle("resume",s==="halted"&&!halt.armed);
    if(s==="halted"){
      el("haltTitle").textContent="ALL SENDING IS HALTED";
      el("haltSub").textContent="Recorded on the server"+(halt.at?" at "+halt.at:"")+(halt.reason?" — "+halt.reason:"")+". Nothing new goes out until you resume.";
      btn.textContent=halt.armed?"CONFIRM RESUME — click again":"Resume sending";
      // The header chip rides a 5s poll, so it could read "ready" beside this
      // bar for a tick. Forced, and only ever in the blocking direction.
      el("chipReady").className="chip bad";
      el("chipReady").textContent="sending halted";
      return;
    }
    if(s==="live"){
      el("haltTitle").textContent="SENDING IS LIVE";
      el("haltSub").textContent=halt.known
        ?("No pause is set"+(halt.reason?" — last change: "+halt.reason:"")+".")
        :"No pause has ever been set on this server.";
    }else if(s==="unknown"){
      el("haltTitle").textContent="PAUSE STATE UNREADABLE — SENDS ARE ALREADY REFUSING";
      el("haltSub").textContent="The server cannot read the pause record"+(halt.reason?" ("+halt.reason+")":"")+", so every send gate is failing closed. Press stop to write a real halt.";
    }else{
      el("haltTitle").textContent="THE STOP SWITCH DID NOT ANSWER";
      el("haltSub").textContent=halt.error+" — do not assume anything is stopped.";
    }
    btn.textContent=halt.armed?"CONFIRM STOP — click again":"STOP ALL SENDS";
  }
  function readHaltPayload(d){
    var p=d&&d.deliveryPause;
    if(!p||typeof p.active!=="boolean"){
      halt.error=(d&&(d.error||d.message))||"the pause endpoint answered without a state";
      return false;
    }
    halt.error="";halt.active=p.active===true;halt.known=p.known===true;
    halt.reason=String(p.reason||"");halt.at=String(p.at||"");
    return true;
  }
  function refreshHalt(force){
    var at=Date.now();
    if(!force&&at-halt.readAt<10000)return Promise.resolve(false);
    halt.readAt=at;
    return api("/api/admin/outreach-pause").then(function(d){
      var ok=readHaltPayload(d);renderHalt();return ok;
    }).catch(function(e){
      if(String(e.message)==="401")return false;
      halt.error=e.message;renderHalt();return false;
    });
  }
  function setHalt(wanted){
    halt.busy=true;renderHalt();
    return api("/api/admin/outreach-pause",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({active:wanted,reason:wanted?"operator_stop_button":"operator_resume"}),
    }).then(function(d){
      if(!readHaltPayload(d)){
        haltNote("THE WRITE DID NOT REPORT A STATE, so nothing here is proven. Server said: "+JSON.stringify(d),"bad");
        return;
      }
      if(halt.active===wanted){
        haltNote(wanted
          ?("STOPPED"+(halt.at?" at "+halt.at:"")+". The server now refuses sends. One site and one email may already have been in flight when you pressed it; those finish.")
          :("RESUMED"+(halt.at?" at "+halt.at:"")+". Sends are live again. Nothing restarts by itself — start or approve a batch to send."),"ok");
      }else{
        haltNote("THE CHANGE DID NOT TAKE. The server still reports "+(halt.active?"HALTED":"LIVE")+". Do not assume anything changed.","bad");
      }
    }).catch(function(e){
      halt.error=e.message;
      haltNote("THE REQUEST FAILED: "+e.message+" — the pause was NOT changed. Sending is still whatever it was before you clicked.","bad");
    }).finally(function(){
      halt.busy=false;disarmHalt();renderHalt();refreshHalt(true);
    });
  }
  el("haltBtn").onclick=function(){
    if(halt.busy)return;
    if(haltState()==="halted"){
      // RESUMING is the dangerous direction, so it asks twice AND out loud.
      if(!halt.armed){armHalt();return;}
      disarmHalt();
      if(!window.confirm("Resume sending? Prospect email, the hourly drip and approved batches can go out again from the moment you confirm.")){renderHalt();return;}
      setHalt(false);
      return;
    }
    // STOPPING takes two deliberate presses and no modal: an emergency control
    // must not be one stray click away, and must not be behind a dialog either.
    if(!halt.armed){armHalt();return;}
    disarmHalt();setHalt(true);
  };

  function paint(){
    renderStages(state.batch);
    renderFunnel(state.batch);
    renderRows(state.batch);
    renderApproval(state.batch);
    renderReadiness(state.readiness,state.spend);
    var b=state.batch;
    el("batchLine").textContent=b
      ? (b.batchId+" · "+b.lane+" lane · "+(b.status==="halted"?"HALTED":b.status)+" · "+(b.status==="halted"?"0 actionable · automatic recovery disabled · "+esc(b.haltReason||"halt reason unavailable"):(b.counts.queued||0)+" queued / "+(b.counts.failed||0)+" blocked / "+(b.counts.total||0)+" rows"))
      : "No batch running.";
    renderBuildProgress(b);
  }

  function refresh(){
    // The stop switch re-reads on its own throttle (10s) rather than on every
    // 5s tick — one indexed single-row query, and never a second timer.
    refreshHalt(false);
    var watchId=(state.batch&&state.batch.batchId)||state.activeBatchId;
    var q=watchId?("?batchId="+encodeURIComponent(watchId)):"";
    return api("/api/admin/line"+q).then(function(d){
      if(d.ok===false&&d.error==="unknown_batch"){state.batch=null;state.activeBatchId="";state.buildWatching=false;}
      state.readiness=d.readiness||state.readiness;
      state.spend=d.spend||state.spend;
      state.facts=d.facts||state.facts;
      if(d.batch){state.batch=d.batch;state.activeBatchId=d.batch.batchId||state.activeBatchId;}
      else if(d.batches&&d.batches.length&&!state.batch){state.batch=d.batches[0];state.activeBatchId=state.batch.batchId||"";}
      if(state.startRetry&&state.startRetry.batchId&&state.batch&&state.batch.batchId===state.startRetry.batchId&&!isBuildLive(state.batch))clearStartRetry();
      hideGate();paint();
    }).catch(function(e){
      if(String(e.message)!=="401"){el("chipReady").className="chip bad";el("chipReady").textContent="server: "+e.message;}
    });
  }

  // SERVER-OWNED BUILD. A launch is one POST. Durable workers own every resume;
  // the browser only GET-polls the named queued/building/running batch. Closing
  // this tab cannot stop or strand the work, and reopening it cannot duplicate
  // a start request.
  function afterStart(d){
    state.launchPending=false;
    if(d.batch)state.batch=d.batch;
    if(d.batchId)state.activeBatchId=d.batchId;
    if(d.readiness)state.readiness=d.readiness;
    if(d.spend)state.spend=d.spend;
    if(d.ok===false){
      state.buildWatching=false;
      out("launchOut","Refused: "+(d.message||d.error));
    }else if(isBuildLive(state.batch)||d.queued===true||d.building===true){
      state.buildWatching=true;
      out("launchOut","Batch "+d.batchId+" accepted. The server owns continuation; this page will poll its status.");
    }else if(d.autoSent){
      out("launchOut","Batch "+d.batchId+" built and auto-sent to your inbox — "+(d.sent||0)+" of "+(d.attempted||0)+" sent.");
    }else if(d.halted){
      out("launchOut","STOPPED MID-RUN. "+(d.haltReason||"The operator stop switch is set.")+"\\nBatch "+d.batchId+" — nothing has been sent.");
    }else{
      out("launchOut","Batch "+d.batchId+" finished the build phase. Nothing has been sent.");
    }
    refreshHalt(true);
    paint();
    return d;
  }

  function launch(count){
    // The disabled state is visual; this guard is the actual double-click lock.
    // It closes the same-tick gap and protects programmatic activation too.
    if(state.launchPending||state.buildWatching||isBuildLive(state.batch))return;
    var lane=el("lane").value;
    var target=el("target").value.trim();
    var signature=startSignature(count,target,lane);
    var idempotencyKey;
    try{idempotencyKey=startKeyFor(signature);}catch(e){out("launchOut","Refused: "+e.message+". Nothing started.");return;}
    state.launchPending=true;syncLaunchControls();
    out("launchOut","Starting "+count+" rows on the "+lane+" lane…\\nThe render gate runs on every row; blocked rows will name the fact that failed.");
    post({action:"start",count:count,target:target,lane:lane}).then(function(d){
      // A retryable response may have committed the batch before queue
      // publication failed. Preserve the key so an explicit retry can only
      // address that same batch. Any definitive answer releases it.
      if(startResponseRetryable(d))retainStartRetryBatch(signature,idempotencyKey,d);
      else clearStartRetry(signature,idempotencyKey);
      return afterStart(d);
    })
    .catch(function(e){
      state.launchPending=false;
      // Authentication was rejected before the start handler. A transport
      // failure is uncertain, so the next identical click must reuse its key.
      if(String(e.message)==="401")clearStartRetry(signature,idempotencyKey);
      out("launchOut","Error: "+e.message+". Retry the same request safely, or change an input to start a new request.");
    })
    .finally(function(){syncLaunchControls();});
  }

  el("target").addEventListener("input",function(){clearStartRetry();});
  el("lane").addEventListener("change",function(){clearStartRetry();});

  document.querySelectorAll("[data-launch]").forEach(function(b){
    b.onclick=function(){launch(Number(b.getAttribute("data-launch")));};
  });

  el("sendBtn").onclick=function(){
    if(!state.batch||state.send.running)return;
    var b=state.batch;
    var n=(b.counts&&b.counts.queued)||0;
    var alreadyApproved=b.status==="approved";
    var verb=alreadyApproved?"Resume sending approved batch ":"Approve and send batch ";
    var msg=b.lane==="live"
      ? (verb+b.batchId+" to "+n+" REAL prospect(s)? Real email cannot be unsent.")
      : (verb+b.batchId+" ("+n+" site(s))? Every email routes to your own inbox.");
    // ONE deliberate confirm IS the operator approval: it names the exact batch,
    // so a send is never blind and never accidental. It then approves and sends
    // in a single flow — the separate button and type-the-id step were pure
    // friction, since the operator already sees and confirms the id right here.
    if(!window.confirm(msg))return;
    var run={
      batchId:b.batchId,passes:0,attempted:0,sent:0,failed:0,
      remaining:nonNegative(n,0),previousRemaining:nonNegative(n,0),failures:[],running:true,
    };
    state.send={running:true,retry:false,batchId:run.batchId,passes:0,attempted:0,sent:0,failed:0,remaining:run.remaining};

    function syncSendState(){
      state.send.running=run.running;state.send.batchId=run.batchId;state.send.passes=run.passes;
      state.send.attempted=run.attempted;state.send.sent=run.sent;state.send.failed=run.failed;state.send.remaining=run.remaining;
    }
    function sendReport(note){
      syncSendState();
      var detail=run.failures.length
        ?("\\nLatest failure details (up to 20):\\n"+JSON.stringify(run.failures.slice(-20),null,2))
        :"";
      out("sendOut","Batch "+run.batchId+"\\nAttempted: "+run.attempted+"\\nSent: "+run.sent+"\\nFailed: "+run.failed+"\\nRemaining: "+run.remaining+"\\nPasses: "+run.passes+" / "+MAX_SEND_PASSES+"\\n"+note+detail);
      paint();
    }
    function finishSend(note,retry){
      run.running=false;syncSendState();state.send.retry=retry===true;
      sendReport(note+(retry?"\\nNo automatic retry was made. Use the explicit Retry button.":""));
      refreshHalt(true);
    }
    function sendPass(){
      if(run.passes>=MAX_SEND_PASSES){finishSend("Paused at the "+MAX_SEND_PASSES+"-pass safety cap.",run.remaining>0);return Promise.resolve();}
      run.passes+=1;sendReport("Sending pass "+run.passes+"…");
      return post({action:"send",batchId:run.batchId}).then(function(d){
        if(d.batch)state.batch=d.batch;
        if(d.spend)state.spend=d.spend;
        var failures=Array.isArray(d.failures)?d.failures:[];
        var attempted=nonNegative(d.attempted,0);
        var sent=nonNegative(d.sent,0);
        var failed=nonNegative(d.failed,failures.length);
        var batchRemaining=d.batch&&d.batch.counts?nonNegative(d.batch.counts.queued,run.remaining):run.remaining;
        var remaining=nonNegative(d.remaining,batchRemaining);
        run.attempted+=attempted;run.sent+=sent;run.failed+=failed;run.remaining=remaining;
        run.failures=run.failures.concat(failures);
        if(d.ok===false){
          finishSend("Send refused: "+(d.error||"unknown_error")+(d.blockers?"\\n"+JSON.stringify(d.blockers,null,2):""),remaining>0);
          return d;
        }
        if(d.halted){finishSend("STOPPED MID-SEND. "+(d.haltReason||""),remaining>0);return d;}
        if(remaining===0){finishSend("Complete. The server reports no queued rows remaining.",false);return d;}
        // Automatic continuation is allowed only while the server's durable
        // remaining count strictly falls. Equal or higher could duplicate work
        // or spin forever, so it stops for an explicit operator retry.
        if(remaining>=run.previousRemaining){
          finishSend("Paused: remaining did not fall ("+run.previousRemaining+" → "+remaining+").",true);
          return d;
        }
        run.previousRemaining=remaining;
        if(run.passes>=MAX_SEND_PASSES){finishSend("Paused at the "+MAX_SEND_PASSES+"-pass safety cap.",true);return d;}
        sendReport("Pass complete. Continuing in "+SEND_PASS_DELAY_MS+" ms while remaining keeps falling.");
        return delay(SEND_PASS_DELAY_MS).then(sendPass);
      }).catch(function(e){
        finishSend("Request error: "+e.message+". Refreshing server truth before any retry.",true);
        return refresh();
      });
    }

    sendReport(alreadyApproved?"Resuming the existing approval.":"Approving this exact batch…");
    var approval=alreadyApproved
      ? Promise.resolve({ok:true,batch:b,resumed:true})
      : post({action:"approve",batchId:b.batchId,typedBatchId:b.batchId});
    approval.then(function(a){
      if(a.batch)state.batch=a.batch;
      // A concurrent tab may have approved between the last poll and this click.
      // Treat that durable server state as resumable instead of asking again.
      if(a.ok===false&&!(a.batch&&a.batch.status==="approved")){
        finishSend("Approval refused: "+(a.error||"unknown_error"),false);return null;
      }
      sendReport(alreadyApproved?"Approved earlier. Starting the next send pass.":"Approved. Starting the first send pass.");
      return sendPass();
    }).catch(function(e){finishSend("Error: "+e.message,true);});
  };

  el("gateGo").onclick=function(){
    var t=el("tok").value.trim();
    if(!t){el("gateErr").textContent="Enter a token.";return;}
    setToken(t);el("gateErr").textContent="Checking…";start();
  };
  el("tok").addEventListener("keydown",function(e){if(e.key==="Enter")el("gateGo").click();});
  el("authGate").addEventListener("keydown",function(e){
    if(e.key!=="Tab")return;
    var first=el("tok"),last=el("gateGo");
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  el("rowDetailClose").onclick=closeRowDetail;
  el("rowDetail").addEventListener("click",function(e){if(e.target===el("rowDetail"))closeRowDetail();});
  document.addEventListener("keydown",function(e){if(e.key==="Escape")closeRowDetail();});

  function start(){
    refreshHalt(true);
    refresh();
    if(state.pollTimer)clearInterval(state.pollTimer);
    // Poll only while the tab is visible: a background console polling forever
    // is what exhausted the project's disk I/O budget on 2026-07-29.
    state.pollTimer=setInterval(function(){if(!document.hidden)refresh();},5000);
  }
  (function(){try{var m=(location.hash||"").match(/[#&]t=([^&]+)/);if(m&&m[1]){setToken(decodeURIComponent(m[1]));history.replaceState(null,"",location.pathname);}}catch(e){}})();
  if(token())start();else showGate();
})();
</script>
</body>
</html>`;
