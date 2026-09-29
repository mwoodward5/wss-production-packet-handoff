"use strict";

/**
 * The Campaigns page — the owner's plain-language campaign manager.
 *
 * ONE JOB: get finished work OUT. The owner asked (2026-08-10, verbatim):
 * "Where do I easily approve stuff? There should just be approval as a button
 * or send emails to all … intuitive … The verbiage is not very layman … way
 * too much computer coder language, not human like me."
 *
 * Campaign-flow pass 2026-08-16: the owner's verdict after two translation
 * passes was "there is NO WORKFLOW" — so this page is now the workflow home,
 * "Your campaigns": ONE vertical list, one card per campaign, and every card
 * answers in order — the campaign's name, one big status sentence, a progress
 * bar, and three plain actions (See the websites · Email proofs to me · Stop
 * this campaign). The approve-and-send machinery underneath is untouched.
 *
 * It is a shell in the /gallery pattern: no data baked in, the token is
 * entered in-browser (same localStorage key as the console and gallery) and
 * every read and write goes through /api/admin/line — the admin-gated
 * endpoint that already owns approve and the resumable send. Approval stays
 * two presses inside an announcing 20-second window, and every result line is
 * the server's own read-back, never optimism.
 */
const { operatorNav } = require("./operator-nav");
const { PLAIN_REFUSAL } = require("./send-refusals");
// The shared plain-words dictionary (lib/operator-voice.js). The browser cannot
// require(), so the status table is serialised in and the tiny statusChip
// lookup is mirrored below — the same pattern PLAIN_REFUSAL already uses.
const { STATUS: VOICE_STATUS } = require("./operator-voice");

module.exports = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#08080B">
  <meta name="description" content="Every campaign in one list — watch them build, see the websites, and email the proofs to yourself with one OK.">
  <title>Your campaigns · WSS Command Center</title>
  <style>
    :root{
      color-scheme:dark;
      --void:#08080B; --carbon:#131318; --carbon-2:#17171d; --ice:#F2F2F5; --slate:#9B9AA4;
      --graphite:#6F6E79; --signal:#7C6CF6; --circuit:#4A6CF7; --pulse:#34D399;
      --sky:#6E8BFF; --ember:#E0A44A; --rose:#F26D6D; --hair:rgba(255,255,255,.07);
      --grad-signal:linear-gradient(135deg,#4A6CF7 0%,#8B5CF6 100%);
      --sans:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
      --mono:'IBM Plex Mono','SFMono-Regular',Consolas,Menlo,monospace;
    }
    *{box-sizing:border-box;min-width:0}
    html{min-height:100%;overflow-x:hidden;background:var(--void)}
    body{min-height:100vh;margin:0;background:var(--void);color:var(--ice);font-family:var(--sans);-webkit-font-smoothing:antialiased}
    button,input{font:inherit}
    button,a,input{touch-action:manipulation}
    button{color:inherit}
    [hidden]{display:none!important}
    :focus-visible{outline:2px solid var(--sky);outline-offset:3px}
    .shell{width:100%;max-width:1180px;margin:0 auto;padding:28px 22px 64px;transition:filter .18s ease}
    .shell.locked{filter:blur(8px);pointer-events:none;user-select:none}

    .masthead{display:flex;align-items:center;gap:15px;padding-bottom:22px;border-bottom:1px solid var(--hair)}
    .mark{width:58px;height:58px;flex:none;display:grid;place-items:center;border:1px solid var(--hair);border-radius:15px;background:var(--carbon)}
    .eyebrow{margin:0 0 6px;color:var(--slate);font:500 10px/1 var(--mono);letter-spacing:.28em;text-transform:uppercase}
    h1{margin:0;font-size:clamp(26px,4vw,36px);font-weight:800;line-height:1;letter-spacing:-.03em}
    .masthead-note{margin-left:auto;display:flex;align-items:center;gap:14px}
    .backlink{color:var(--slate);font:600 12px var(--sans);text-decoration:none;white-space:nowrap;padding:8px 12px;border:1px solid var(--hair);border-radius:9px}
    .backlink:hover{color:var(--ice);border-color:rgba(124,108,246,.5)}

    /* The one thing this page is for. */
    .hero{padding:38px 0 8px;text-align:center}
    .hero-count{font-size:clamp(46px,9vw,92px);font-weight:800;letter-spacing:-.04em;line-height:1;background:var(--grad-signal);-webkit-background-clip:text;background-clip:text;color:transparent}
    .hero-line{margin:12px auto 0;max-width:640px;font-size:clamp(18px,3vw,26px);font-weight:700;letter-spacing:-.015em;line-height:1.3}
    .hero-sub{margin:10px auto 0;max-width:560px;color:var(--slate);font-size:14px;line-height:1.6}
    .hero-warn{margin:14px auto 0;max-width:600px;padding:10px 14px;border:1px solid rgba(224,164,74,.35);border-radius:10px;color:var(--ember);font-size:13px;line-height:1.5;background:rgba(224,164,74,.07)}
    .bigsend{margin:24px auto 0;display:block;min-height:64px;padding:18px 34px;border:0;border-radius:14px;background:var(--grad-signal);color:#fff;font:800 clamp(16px,2.6vw,21px)/1.2 var(--sans);letter-spacing:.01em;cursor:pointer;box-shadow:0 18px 44px rgba(74,108,247,.28)}
    .bigsend:hover{filter:brightness(1.07)}
    .bigsend:disabled{cursor:wait;opacity:.6}
    .bigsend.armed{background:#fff;color:#3b2f8f;outline:3px solid var(--signal);outline-offset:3px}
    /* The plain-language subtitle under the big button: what pressing it
       actually does, in one sentence. New class name so the shared nav
       readability floor cannot shrink it back down. */
    .sendsub{margin:12px auto 0;max-width:600px;color:var(--ice);font-size:16px;font-weight:600;line-height:1.5}
    .sendnote{margin:12px auto 0;max-width:520px;color:var(--slate);font-size:12.5px;line-height:1.55}

    .log{margin:18px auto 0;max-width:680px;padding:14px 16px;border:1px solid var(--hair);border-radius:12px;background:var(--carbon);text-align:left;font:500 13px/1.7 var(--mono)}
    .log:empty{display:none}
    .log div{overflow-wrap:anywhere}
    .log .ok{color:var(--pulse)}
    .log .bad{color:var(--rose)}
    .log .dim{color:var(--slate)}

    .sec{margin-top:40px}
    .sec-h{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin:0 0 14px}
    .sec-h h2{margin:0;font-size:19px;letter-spacing:-.02em}
    .sec-h .label{color:var(--slate);font:500 10px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase}

    .camp{margin-bottom:18px;border:1px solid var(--hair);border-radius:16px;background:var(--carbon);overflow:hidden}
    .camp-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px;padding:16px 18px;border-bottom:1px solid var(--hair)}
    .camp-name{margin:0;font-size:17px;font-weight:800;letter-spacing:-.015em}
    .camp-when{color:var(--slate);font:500 11px var(--mono)}
    .camp-meta{margin-left:auto;color:var(--slate);font-size:12.5px}
    .camp-live{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid rgba(52,211,153,.32);border-radius:999px;background:rgba(52,211,153,.08);color:var(--pulse);font:700 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase}
    .sites{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:12px;padding:16px 18px}
    .site{border:1px solid var(--hair);border-radius:12px;background:var(--carbon-2);overflow:hidden;display:flex;flex-direction:column}
    .thumb{position:relative;aspect-ratio:16/10;background:var(--void);border-bottom:1px solid var(--hair);display:block}
    .thumb img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center;visibility:hidden}
    .thumb[data-preview-state="image"] img{visibility:visible}
    .thumb-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:
      radial-gradient(120% 90% at 50% 0%,rgba(124,108,246,.16),transparent 60%),
      repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 8px,transparent 8px 16px)}
    .thumb-empty[hidden]{display:none}
    .thumb-empty-label{color:rgba(237,237,243,.45);font:600 9px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase}
    .site-body{display:flex;flex-direction:column;gap:5px;padding:12px 13px 13px}
    .site-name{margin:0;font-size:14px;font-weight:700;line-height:1.25;letter-spacing:-.01em;overflow-wrap:anywhere}
    .site-city{color:var(--slate);font-size:12px}
    .site-state{align-self:flex-start;margin-top:4px;display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid rgba(52,211,153,.26);border-radius:999px;background:rgba(52,211,153,.07);color:var(--pulse);font:600 10.5px/1.35 var(--mono);letter-spacing:.04em;text-transform:uppercase}
    .site-state::before{content:"";width:5px;height:5px;flex:none;border-radius:50%;background:currentColor}
    .site-state.sent{border-color:rgba(124,108,246,.3);background:rgba(124,108,246,.09);color:#9b8cff}
    .site-open{margin-top:9px;align-self:flex-start;color:var(--sky);font:700 15px/1.2 var(--sans);text-decoration:none;border-bottom:1px solid rgba(110,139,255,.45);padding-bottom:2px}
    .site-open:hover{color:var(--ice);border-color:var(--ice)}
    .camp-actions{display:flex;flex-direction:column;gap:10px;padding:0 18px 16px}
    /* ---- THE CAMPAIGN-FLOW CLOTHES (owner verdict 2026-08-16: "there is
       NO WORKFLOW") — every card reads top-to-bottom: name → one big status
       sentence → progress bar → three plain actions. 18px body floor. */
    .guide{display:flex;flex-wrap:wrap;gap:10px 22px;margin:18px 0 4px;padding:14px 16px;border:1px solid var(--hair);border-radius:14px;background:var(--carbon)}
    .guide span{display:inline-flex;align-items:center;gap:9px;color:var(--slate);font-size:18px;font-weight:600;line-height:1.4}
    .guide b{display:grid;place-items:center;width:26px;height:26px;flex:none;border-radius:50%;background:var(--grad-signal);color:#fff;font-size:15px}
    .guide .done b{background:var(--grad-pulse)}
    .camp-line{margin:0;padding:14px 18px 0;color:var(--ice);font-size:19px;font-weight:700;letter-spacing:-.01em;line-height:1.45}
    .camp-line small{display:block;margin-top:3px;color:var(--slate);font-size:18px;font-weight:500}
    .camp-progress{margin:12px 18px 0;height:10px;border-radius:6px;background:var(--carbon-2);border:1px solid var(--hair);overflow:hidden}
    .camp-progress i{display:block;height:100%;background:var(--grad-pulse);transition:width .4s}
    .camp-progress.none i{display:none}
    .camp-progress-note{margin:6px 18px 0;color:var(--slate);font-size:18px}
    .actrow{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:14px 18px 16px}
    .actrow .sendone{margin:0}
    .seeBtn{min-height:46px;padding:12px 18px;border:1px solid var(--hair);border-radius:11px;background:transparent;color:var(--ice);font:700 14px/1.2 var(--sans);cursor:pointer}
    .seeBtn:hover{border-color:rgba(124,108,246,.5)}
    .camp-stop{min-height:46px;display:inline-flex;align-items:center;padding:12px 18px;border:1px solid rgba(242,109,109,.35);border-radius:11px;color:#F4A6A6;font:700 14px/1.2 var(--sans);text-decoration:none}
    .camp-stop:hover{border-color:var(--rose);color:var(--rose)}
    .actrow-note{flex-basis:100%;color:var(--slate);font-size:18px;line-height:1.55}
    .sites-empty{grid-column:1/-1;padding:14px 16px;border:1px dashed var(--hair);border-radius:12px;color:var(--slate);font-size:18px;line-height:1.55}
    /* The campaign's own state, as three short plain sentences (plus the
       honest why-line when builds failed). Body copy, so 16px. */
    .camp-facts{display:flex;flex-direction:column;gap:3px;padding:14px 18px 0}
    .camp-facts p{margin:0;color:var(--ice);font-size:16px;line-height:1.5}
    .camp-facts p.why{color:var(--slate);font-size:15px}
    .camp-note{color:var(--slate);font-size:12px;line-height:1.5}
    .sendone{align-self:start;min-height:46px;padding:12px 20px;border:0;border-radius:11px;background:var(--grad-signal);color:#fff;font:800 14px/1.2 var(--sans);cursor:pointer}
    .sendone:hover{filter:brightness(1.07)}
    .sendone:disabled{cursor:wait;opacity:.6}
    .sendone.armed{background:#fff;color:#3b2f8f;outline:3px solid var(--signal);outline-offset:2px}
    .camp .log{margin:0;max-width:none}

    .buildrow,.oldrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:12px 16px;border:1px solid var(--hair);border-radius:12px;background:var(--carbon);margin-bottom:10px}
    .batch-visual{width:56px;flex:0 0 56px;aspect-ratio:16/10;border:1px solid var(--hair);border-radius:9px;overflow:hidden}
    .batch-visual .thumb-empty-label{display:none}
    .batch-visual .thumb-empty svg{width:22px;height:22px}
    .buildrow b,.oldrow b{font-size:14px;letter-spacing:-.01em}
    .rowout{color:var(--slate);font-size:12.5px}
    .rowwhen{margin-left:auto;color:var(--graphite);font:500 10.5px var(--mono)}
    details.older summary{cursor:pointer;color:var(--slate);font:600 13px var(--sans);padding:10px 2px;list-style-position:inside}
    details.older summary:hover{color:var(--ice)}

    .idle{margin:26px auto 0;max-width:520px;padding:34px 22px;border:1px dashed var(--hair);border-radius:16px;background:var(--carbon);text-align:center}
    .idle h3{margin:12px 0 0;font-size:18px;letter-spacing:-.015em}
    .idle p{margin:8px 0 0;color:var(--slate);font-size:13.5px;line-height:1.6}

    .access{position:fixed;z-index:80;inset:0;display:grid;place-items:center;padding:20px;background:rgba(8,8,11,.76);backdrop-filter:blur(10px)}
    .access-card{width:min(410px,100%);padding:24px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:var(--carbon);box-shadow:0 30px 80px rgba(0,0,0,.45)}
    .access-card h2{margin:0 0 8px;font-size:22px;letter-spacing:-.02em}
    .access-card p{margin:0 0 16px;color:var(--slate);font-size:13px;line-height:1.5}
    .access-card input{width:100%;height:44px;margin-bottom:10px;padding:0 13px;border:1px solid var(--hair);border-radius:9px;background:var(--void);color:var(--ice);font:500 13px var(--mono)}
    .access-card button{width:100%;padding:13px 16px;border:0;border-radius:9px;background:var(--grad-signal);color:var(--ice);font:700 14px var(--sans);cursor:pointer}
    .access-card button:disabled{cursor:wait;opacity:.62}
    .access-status{min-height:18px;margin:10px 0 0!important;color:var(--rose)!important}

    @media(max-width:640px){
      .shell{padding:18px 14px 44px}
      /* The two nowrap backlinks used to poke ~11px past a 390px viewport
         (clipped by overflow-x:hidden, so it read as cut-off buttons, not a
         scrollbar). Let the masthead wrap and give the links their own row. */
      .masthead{flex-wrap:wrap;gap:12px}.mark{width:50px;height:50px;border-radius:13px}
      .masthead-note{margin-left:0;width:100%}
      .bigsend{width:100%}
      .camp-meta{margin-left:0;width:100%}
      .batch-visual{width:44px;flex-basis:44px}
      .sendone{width:100%;align-self:stretch}
    }
    @media(prefers-reduced-motion:reduce){*{transition-duration:.01ms!important;animation-duration:.01ms!important}}
  </style>
</head>
<body>
  ${operatorNav("campaigns")}
  <div class="shell locked" id="pageShell" inert>
    <header class="masthead">
      <div class="mark" aria-label="WSS Labs mark">
        <svg width="42" height="42" viewBox="8 14 48 34" fill="none" aria-hidden="true">
          <defs><linearGradient id="wssSignal" x1="12" y1="42" x2="50" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="#4A6CF7"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs>
          <path d="M12 24 L21 42 L30 26 L39 42 L50 20" stroke="url(#wssSignal)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="50" cy="20" r="3.4" fill="#34D399"/>
        </svg>
      </div>
      <div>
        <p class="eyebrow">WSS Command Center</p>
        <h1>Your campaigns</h1>
      </div>
      <!-- The page-local backlinks moved into the shared operator bar at the
           top of every page (lib/operator-nav.js). -->
    </header>

    <!-- THE WORKFLOW, IN THREE NUMBERED STEPS — the A-B-C the owner asked
         for. Every card below answers in the same order: what is this,
         what's happening, what do I do next. -->
    <div class="guide" aria-label="How this page works">
      <span class="done"><b aria-hidden="true">1</b>Start it — on the Command Center</span>
      <span class="done"><b aria-hidden="true">2</b>Watch it build — here</span>
      <span><b aria-hidden="true">3</b>Give your OK — here</span>
    </div>

    <main id="main" aria-live="polite">
      <section class="hero" id="hero"></section>
      <section class="sec" id="listSec" hidden>
        <div class="sec-h"><h2>Your campaigns</h2><span class="label">approve each campaign on its own</span></div>
        <div id="campaignList"></div>
      </section>
      <section class="sec" id="olderSec" hidden>
        <details class="older" id="olderDetails">
          <summary id="olderSummary">Earlier campaigns</summary>
          <div id="olderRows" style="margin-top:10px"></div>
        </details>
      </section>
    </main>
  </div>

  <div class="access" id="accessGate" role="dialog" aria-modal="true" aria-labelledby="accessTitle">
    <form class="access-card" id="accessForm">
      <h2 id="accessTitle">Owner access</h2>
      <p>Paste your access code to open this page. It stays in this browser only.</p>
      <input id="tokenInput" type="password" autocomplete="current-password" aria-label="Access code" required>
      <button id="accessButton" type="submit">Open the page</button>
      <p class="access-status" id="accessStatus" role="alert" aria-live="polite"></p>
    </form>
  </div>

  <script>
  (function(){
    "use strict";
    var KEY="wsl_admin_token";           // same browser key the console and gallery use
    var POLL_MS=15000;
    var state={batches:[],readiness:null,loaded:false};
    var run={active:false};
    var arm={scope:null,timer:null};
    var logs={};                          // scope -> [{text,tone}]
    var pageShell=document.getElementById("pageShell");
    var accessGate=document.getElementById("accessGate");
    var accessForm=document.getElementById("accessForm");
    var accessButton=document.getElementById("accessButton");
    var tokenInput=document.getElementById("tokenInput");
    var accessStatus=document.getElementById("accessStatus");

    function token(){try{return localStorage.getItem(KEY)||"";}catch(_){return "";}}
    function setToken(v){try{localStorage.setItem(KEY,v);}catch(_){}}
    function clearToken(){try{localStorage.removeItem(KEY);}catch(_){}}
    function text(v,fb){var s=String(v==null?"":v).trim();return s||fb||"";}

    function errorWith(message,status,payload){var e=new Error(message);e.status=status;e.payload=payload;return e;}
    function api(path,opts){
      opts=opts||{};
      if(!token())return Promise.reject(errorWith("Access code required",401));
      opts.headers=Object.assign({},opts.headers||{});
      opts.headers["x-admin-token"]=token();
      opts.cache="no-store";
      return fetch(path,opts).then(function(response){
        return response.text().then(function(raw){
          var payload={};
          try{payload=raw?JSON.parse(raw):{};}catch(_){payload={message:raw};}
          if(!response.ok)throw errorWith(payload.message||payload.error||("Request failed ("+response.status+")"),response.status,payload);
          return payload;
        });
      });
    }
    function post(path,body){
      return api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});
    }

    function showGate(message){
      accessGate.hidden=false;
      pageShell.classList.add("locked");
      pageShell.inert=true;pageShell.setAttribute("inert","");
      accessStatus.textContent=message||"";
      accessButton.disabled=false;
      accessButton.textContent="Open the page";
      window.setTimeout(function(){tokenInput.focus();},0);
    }
    function hideGate(){
      accessGate.hidden=true;
      pageShell.classList.remove("locked");
      pageShell.inert=false;pageShell.removeAttribute("inert");
      accessStatus.textContent="";
      tokenInput.value="";
    }

    // ---- reading the factory ------------------------------------------------
    function countsOf(b){return (b&&b.counts)||{total:0,queued:0,failed:0,sent:0,working:0};}
    function readyCount(b){return Number(countsOf(b).queued)||0;}
    function isReady(b){return (b.status==="awaiting_approval"||b.status==="approved")&&readyCount(b)>0;}
    function isBuilding(b){return ["running","building","sending","collecting","working"].indexOf(b&&b.status)>=0;}
    function readyBatches(){return state.batches.filter(isReady);}
    function buildingBatches(){return state.batches.filter(function(b){return !isReady(b)&&isBuilding(b);});}
    function olderBatches(){return state.batches.filter(function(b){return !isReady(b)&&!isBuilding(b);});}
    function totalReady(){return readyBatches().reduce(function(n,b){return n+readyCount(b);},0);}
    function anyLiveReady(){return readyBatches().some(function(b){return b.lane==="live";});}

    function campaignName(b){
      var t=text(b&&b.target,"");
      if(!t)return "Saved leads";
      if(t.toLowerCase()==="leadminer")return "Researched leads";
      return t.replace(/[a-z0-9][a-z0-9']*/gi,function(w){return w.charAt(0).toUpperCase()+w.slice(1);})
        .replace(/\\bIn\\b/g,"in")
        .replace(/\\bHvac\\b/g,"HVAC")
        .replace(/\\bLlc\\b/g,"LLC");
    }

    // ---- THE AUTO-NAME: trade · city · date --------------------------------
    // Campaign-flow pass 2026-08-16: every card leads with a name a layman
    // recognizes ("Plumbing · Louisville · Aug 16"), built only from what the
    // campaign actually recorded. Absent pieces drop out — nothing invented.
    var MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    function prettyTrade(s){
      return text(s,"").replace(/[a-z0-9][a-z0-9']*/gi,function(w){return w.charAt(0).toUpperCase()+w.slice(1);})
        .replace(/\\bHvac\\b/g,"HVAC")
        .replace(/\\bLlc\\b/g,"LLC");
    }
    function tradeCityOf(b){
      var t=text(b&&b.target,"");
      if(!t)return {trade:"Saved leads",city:""};
      if(t.toLowerCase()==="leadminer")return {trade:"All trades",city:""};
      var m=t.match(/^(.*?)\\s+in\\s+(.+)$/i);
      if(m)return {trade:prettyTrade(m[1]),city:m[2]};
      return {trade:prettyTrade(t),city:""};
    }
    function firstRowCity(b){
      var rows=Array.isArray(b&&b.rows)?b.rows:[];
      for(var i=0;i<rows.length;i+=1){
        var c=text(rows[i]&&rows[i].city,"");
        var s=text(rows[i]&&rows[i].state,"");
        var where=[c,s].filter(Boolean).join(", ");
        if(where)return where;
      }
      return "";
    }
    function campaignWhen(iso){
      var at=Date.parse(String(iso||""));
      if(!Number.isFinite(at))return "";
      var d=new Date(at);
      return MONTHS[d.getMonth()]+" "+d.getDate();
    }
    function campaignCardName(b){
      var tc=tradeCityOf(b);
      var city=tc.city||firstRowCity(b);
      var when=campaignWhen(b&&b.startedAt);
      return [tc.trade,city,when].filter(Boolean).join(" · ")||"Your campaign";
    }

    // ---- THE BIG STATUS SENTENCE + PROGRESS BAR ----------------------------
    // "Building 3 of 10 — Pipe Dream Plumbing, Louisville." Every number is
    // measured from the campaign's own rows; absent facts say so honestly.
    function goalOf(b){return Math.max(Number(b&&b.requested)||0,Number(countsOf(b).total)||0);}
    function finishedOf(b){var c=countsOf(b);return (Number(c.queued)||0)+(Number(c.sent)||0);}
    function workingRowOf(b){
      var rows=Array.isArray(b&&b.rows)?b.rows:[];
      var best=null,bestAt=0;
      var WORKING={picked:1,qualified:1,mirrored:1,gate_passed:1};
      rows.forEach(function(row){
        if(!WORKING[String(row&&row.status||"")])return;
        var at=Date.parse(String(row&&row.updatedAt||""));
        if(Number.isFinite(at)&&at>=bestAt){bestAt=at;best=row;}
      });
      return best;
    }
    function campaignStatusLine(b){
      var c=countsOf(b);
      if(b.status==="halted"){
        return {line:"Stopped — "+text(b&&b.haltReason,"you pressed the stop switch")+".",
          note:finishedOf(b)+" finished website"+(finishedOf(b)===1?" was":"s were")+" kept."};
      }
      if(isBuilding(b)){
        var goal=goalOf(b),done=finishedOf(b);
        var w=workingRowOf(b);
        var where=w?[text(w.city,""),text(w.state,"")].filter(Boolean).join(", "):"";
        var head="Building "+done+" of "+(goal||"?");
        if(w){
          var who=text(w.businessName,"the next business");
          return {line:head+" — "+who+(where?", "+where:"")+".",
            note:"It finishes on its own — check back in a few minutes."};
        }
        return {line:head+" — finding the next business now.",
          note:"It finishes on its own — check back in a few minutes."};
      }
      var readyN=Number(c.queued)||0;
      if(readyN>0)return {line:readyN+(readyN===1?" website is":" websites are")+" built, inspected, and waiting for your OK.",
        note:"Look them over, then email the proofs to yourself — or approve them for real."};
      return {line:outcomeText(b),note:""};
    }
    function fmtWhen(iso){
      var at=Date.parse(String(iso||""));
      if(!Number.isFinite(at))return "";
      var d=new Date(at);
      var months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      var h=d.getHours(),m=d.getMinutes(),ap=h>=12?"PM":"AM";h=h%12||12;
      return months[d.getMonth()]+" "+d.getDate()+", "+h+":"+(m<10?"0":"")+m+" "+ap;
    }
    function plural(n,one,many){return n+" "+(n===1?one:many);}

    function outcomeText(b){
      var c=countsOf(b);
      if(b.status==="halted")return "stopped by you";
      if(isBuilding(b)){
        var finished=(Number(c.queued)||0)+(Number(c.sent)||0)+(Number(c.failed)||0);
        return "still building — "+finished+" of "+(Number(c.total)||0)+" finished so far";
      }
      var parts=[];
      if(c.sent)parts.push(plural(Number(c.sent),"sent","sent"));
      if(c.queued)parts.push(Number(c.queued)+" ready to send");
      if(c.failed)parts.push(Number(c.failed)+" could not be built");
      if(!parts.length)parts.push("nothing could be built");
      return parts.join(" · ");
    }

    // Server refusal codes, translated to the owner's language. Unknown codes
    // pass through untouched — a raw truth beats a wrong translation.
    function plainError(err){
      var payload=(err&&err.payload)||{};
      var code=text(payload.error,"")||text(err&&err.message,"");
      var map={
        blocked_by_readiness:"sending is switched off right now — turn it back on from the Command Center first",
        live_lane_disabled:"live sending is switched off on the server — nothing went to any business",
        unknown_batch:"the server can't find this campaign any more — refresh the page",
        batch_still_running:"this campaign is still building",
        nothing_passed_the_render_gate:"none of these sites passed the final inspection",
        nothing_approved_to_send:"there is nothing left to send in this campaign",
        approval_confirmation_mismatch:"the approval didn't match — refresh the page and try again",
        review_hold:"a review hold is on — sends wait until it clears",
        delivery_paused:"sending is paused — resume from the Command Center first"
      };
      var say=map[code]||text(err&&err.message,String(code||"the server refused"));
      var blockers=payload.blockers;
      if(Array.isArray(blockers)&&blockers.length&&map[code]){
        var extra=text(blockers[0]&&blockers[0].message,"");
        if(extra)say+=" ("+extra+")";
      }
      return say;
    }

    // Per-site refusal reasons, in the owner's words. The first production run
    // printed the raw server code ("no_before_after_visuals") on his screen —
    // exactly the coder-speak this page exists to remove. Unknown codes still
    // pass through raw: a raw truth beats a wrong translation.
    //
    // The table is lib/send-refusals.js, shared with the gallery's send panel,
    // so the same code cannot be given two different meanings on two pages.
    var REFUSALS=${JSON.stringify(PLAIN_REFUSAL)};
    function plainReason(code){
      return REFUSALS[String(code||"").trim()]||"";
    }

    // ---- the shared plain-words voice (lib/operator-voice.js) ---------------
    // The status table is serialised in at render time; statusChip is mirrored
    // from the module verbatim so a chip never reads two ways on two pages.
    var VOICE_STATUS=${JSON.stringify(VOICE_STATUS)};
    function voiceNormalize(v){return String(v==null?"":v).trim().toLowerCase().replace(/[\\s-]+/g,"_");}
    function titleCaseWords(v){return String(v==null?"":v).replace(/[_-]+/g," ").replace(/\\s+/g," ").trim().replace(/\\b([a-z])/g,function(l){return l.toUpperCase();});}
    function statusChip(status){
      var key=voiceNormalize(status);
      var hit=VOICE_STATUS[key];
      if(hit)return {label:hit[0],tone:hit[1]==="good"||hit[1]==="wait"||hit[1]==="bad"||hit[1]==="neutral"?hit[1]:"neutral"};
      if(!key)return {label:"Not reported",tone:"neutral"};
      return {label:titleCaseWords(String(status)),tone:"neutral"};
    }

    // ---- why a website could not be built, in the owner's words -------------
    // Failed rows carry machine reasons ("render_unavailable:http_500",
    // "nap_match: ...", "no verified business email — delivery held"). These
    // tables turn the KNOWN ones into plain English; an unknown reason passes
    // through raw, because a raw truth beats a wrong translation — and a row
    // with nothing recorded says exactly that, never an invented reason.
    var BUILD_PLAIN=[
      [/^no verified business email/i,"No usable email address"],
      [/\\bfirst attempt\\b/i,"Website failed inspection — rebuilt twice"],
      [/^render_unavailable/i,"The finished site could not be inspected"],
      [/^http_\\d{3}/i,"Their current website would not load"],
      [/empty_rendered_body/i,"Their current website came back blank"],
      [/chromium_launch_failed/i,"The inspection browser could not start"],
      [/^render_error/i,"The website build kept failing"],
      [/render gate returned no verdict/i,"The final inspection gave no answer"],
      [/capture_threw/i,"The before-and-after picture could not be taken"]
    ];
    var GATE_FACT_PLAIN={
      nap_match:"the details did not match the business",
      vertical_match:"the wrong trade was showing",
      logo_own_and_unique:"the logo was not the business's own",
      entity_residue_zero:"another company's marks were left on the site",
      schema_type:"the information card search engines read was missing",
      donor_leak_zero:"another company's content was showing",
      aggregate_rating_backed:"a star rating could not be proven",
      unverified_claims_omitted:"a claim we could not prove was showing",
      place_names_plausible:"the places named did not check out",
      source_video_preserved:"their video was missing from the new site",
      owned_photos_retained:"their photos were missing from the new site",
      side_by_side_captured:"the before-and-after picture was never taken"
    };
    function plainBuildFailReason(row){
      var raws=[text(row&&row.reason,""),text(row&&row.contactHoldReason,"")];
      for(var i=0;i<raws.length;i+=1){
        var raw=raws[i];
        if(!raw)continue;
        for(var j=0;j<BUILD_PLAIN.length;j+=1){
          if(BUILD_PLAIN[j][0].test(raw))return BUILD_PLAIN[j][1];
        }
        var factKey=raw.split(":")[0];
        var fact=GATE_FACT_PLAIN[String(factKey||"").trim()];
        if(fact)return "Website failed inspection — "+fact;
        var failedFacts=raw.indexOf("failed facts:")===0?raw.slice("failed facts:".length).split(","):[];
        for(var k=0;k<failedFacts.length;k+=1){
          var piece=GATE_FACT_PLAIN[String(failedFacts[k]||"").trim()];
          if(piece)return "Website failed inspection — "+piece;
        }
        // Unknown code: pass it through raw (a raw truth beats a wrong
        // translation) — only underscores become spaces so it is readable.
        return raw.replace(/_/g," ").replace(/^./,function(ch){return ch.toUpperCase();});
      }
      return "";
    }
    // The most common honest reasons a campaign's builds failed, top first.
    function topBuildReasons(b){
      var seen={};
      (b&&b.rows||[]).forEach(function(row){
        if(["rejected","gate_failed","error"].indexOf(String(row&&row.status||""))<0)return;
        var label=plainBuildFailReason(row)||"couldn't build — reason not recorded";
        seen[label]=(seen[label]||0)+1;
      });
      return Object.keys(seen).sort(function(a,c){return seen[c]-seen[a];})
        .slice(0,3)
        .map(function(label){return label+(seen[label]>1?" ("+seen[label]+")":"");});
    }

    // ---- the log rails ------------------------------------------------------
    function logFor(scope){return logs[scope]||(logs[scope]=[]);}
    function say(scope,line,tone){logFor(scope).push({text:String(line),tone:tone||""});render();}
    function clearLog(scope){logs[scope]=[];}
    function logNode(scope){
      var wrap=document.createElement("div");
      wrap.className="log";
      wrap.setAttribute("role","status");
      logFor(scope).forEach(function(entry){
        var row=document.createElement("div");
        if(entry.tone)row.className=entry.tone;
        row.textContent=entry.text;
        wrap.appendChild(row);
      });
      return wrap;
    }

    // ---- render -------------------------------------------------------------
    function svgMark(size){
      var ns="http://www.w3.org/2000/svg";
      var svg=document.createElementNS(ns,"svg");
      svg.setAttribute("width",String(size));svg.setAttribute("height",String(size));
      svg.setAttribute("viewBox","8 14 48 34");svg.setAttribute("fill","none");svg.setAttribute("aria-hidden","true");
      var path=document.createElementNS(ns,"path");
      path.setAttribute("d","M12 24 L21 42 L30 26 L39 42 L50 20");
      path.setAttribute("stroke","rgba(124,108,246,.55)");
      path.setAttribute("stroke-width","4.5");
      path.setAttribute("stroke-linecap","round");
      path.setAttribute("stroke-linejoin","round");
      svg.appendChild(path);
      var dot=document.createElementNS(ns,"circle");
      dot.setAttribute("cx","50");dot.setAttribute("cy","20");dot.setAttribute("r","3.4");
      dot.setAttribute("fill","rgba(52,211,153,.7)");
      svg.appendChild(dot);
      return svg;
    }

    function safeHttpUrl(value){
      var raw=text(value,"");
      if(!raw)return "";
      try{var u=new URL(raw,window.location.origin);return u.protocol==="http:"||u.protocol==="https:"?u.href:"";}catch(_){return "";}
    }

    // The branded block is the first-paint state. A screenshot may replace it
    // only after the browser proves that the image is at least 50 x 50.
    function thumbNode(row,liveUrl){
      var holder=document.createElement(liveUrl?"a":"div");
      holder.className="thumb";
      holder.setAttribute("data-preview-state","fallback");
      if(liveUrl){
        holder.href=liveUrl;holder.target="_blank";holder.rel="noopener noreferrer";
        holder.setAttribute("aria-label","Open the finished site for "+text(row.businessName,"this business"));
      }
      var block=document.createElement("div");
      block.className="thumb-empty";
      block.appendChild(svgMark(40));
      var blockLabel=document.createElement("span");
      blockLabel.className="thumb-empty-label";
      blockLabel.textContent="WSS preview";
      block.appendChild(blockLabel);
      var shot=safeHttpUrl(row.shotUrl);
      if(shot){
        var img=document.createElement("img");
        img.loading="lazy";img.decoding="async";
        img.alt="Preview of the finished site for "+text(row.businessName,"this business");
        function showFallback(){
          block.hidden=false;
          holder.setAttribute("data-preview-state","fallback");
        }
        function showImage(){
          if(img.naturalWidth>=50&&img.naturalHeight>=50){
            block.hidden=true;
            holder.setAttribute("data-preview-state","image");
          }else showFallback();
        }
        img.addEventListener("error",showFallback);
        img.addEventListener("load",showImage);
        img.src=shot;
        holder.appendChild(img);
      }
      holder.appendChild(block);
      return holder;
    }

    function batchVisual(batch){
      var rows=Array.isArray(batch&&batch.rows)?batch.rows:[];
      var source=null;
      for(var i=0;i<rows.length;i+=1){
        if(safeHttpUrl(rows[i]&&rows[i].shotUrl)){source=rows[i];break;}
      }
      if(!source){
        for(var j=0;j<rows.length;j+=1){
          if(safeHttpUrl(rows[j]&&rows[j].previewUrl)){source=rows[j];break;}
        }
      }
      source=source||{};
      var visual=thumbNode(source,safeHttpUrl(source.previewUrl));
      visual.classList.add("batch-visual");
      return visual;
    }

    function siteTile(row,sentAlready){
      var tile=document.createElement("article");
      tile.className="site";
      tile.appendChild(thumbNode(row,safeHttpUrl(row.previewUrl)));
      var body=document.createElement("div");
      body.className="site-body";
      var name=document.createElement("h3");
      name.className="site-name";
      name.textContent=text(row.businessName,"Unnamed business");
      var city=document.createElement("div");
      city.className="site-city";
      city.textContent=[text(row.city,""),text(row.state,"")].filter(Boolean).join(", ")||"Location not recorded";
      // The status chip comes from the shared voice table (statusChip), so the
      // same status never reads two ways on two pages. "good" tones reuse the
      // sent styling; everything else keeps the ready green.
      var chip=statusChip(row.status);
      var stateLine=document.createElement("span");
      stateLine.className="site-state"+(chip.tone==="good"?" sent":"");
      stateLine.textContent=chip.label;
      body.appendChild(name);body.appendChild(city);body.appendChild(stateLine);
      var openUrl=safeHttpUrl(row.previewUrl);
      if(openUrl){
        var openLink=document.createElement("a");
        openLink.className="site-open";
        openLink.href=openUrl;openLink.target="_blank";openLink.rel="noopener noreferrer";
        openLink.textContent="Open website";
        body.appendChild(openLink);
      }
      tile.appendChild(body);
      return tile;
    }

    function sendButton(scope,label,big){
      var btn=document.createElement("button");
      btn.type="button";
      btn.className=big?"bigsend":"sendone";
      btn.dataset.scope=scope;
      var armed=arm.scope===scope;
      if(run.active){btn.disabled=true;btn.textContent=run.scope===scope||run.scope==="all"?"Sending…":label;}
      else if(armed){btn.classList.add("armed");btn.textContent="CONFIRM — press again to send";}
      else btn.textContent=label;
      btn.addEventListener("click",function(){pressSend(scope);});
      return btn;
    }

    // WHERE THE PROOFS GO, in one honest sentence. The /api/admin/line read
    // carries readiness.ownerAddressConfigured (a boolean) but not the address
    // itself, so the subtitle says "your own inbox" until the read actually
    // carries an address — never an invented one.
    function ownerInboxLabel(){
      var r=state.readiness||{};
      return text(r.ownerAddress,"").trim()||"your own inbox";
    }

    function renderHero(){
      var hero=document.getElementById("hero");
      hero.replaceChildren();
      if(!state.loaded)return;
      var n=totalReady();
      if(n>0){
        var count=document.createElement("div");
        count.className="hero-count";count.textContent=String(n);
        var line=document.createElement("p");
        line.className="hero-line";
        line.textContent=(n===1?"1 website is":n+" websites are")+" built, inspected, and waiting for your OK.";
        hero.appendChild(count);hero.appendChild(line);
        var ready=state.readiness;
        if(ready&&ready.ready===false){
          var warn=document.createElement("p");
          warn.className="hero-warn";
          var why=(ready.blockers&&ready.blockers[0]&&ready.blockers[0].message)||"";
          warn.textContent="Heads up: sending is switched off right now"+(why?" — "+why:"")+" You can still look around; pressing send will be refused until it is back on.";
          hero.appendChild(warn);
        }
        var live=anyLiveReady();
        hero.appendChild(sendButton("all",live?"Approve & send ALL — live campaigns go to the businesses":"Approve & send ALL to my inbox",true));
        var sub=document.createElement("p");
        sub.className="sendsub";
        sub.textContent=live
          ?"Sends all "+n+" emails. Live campaign emails go to the businesses themselves, and a copy of every one lands in your inbox."
          :"Sends all "+n+" proof emails to "+ownerInboxLabel()+" — nothing goes to a customer.";
        hero.appendChild(sub);
        var note=document.createElement("p");
        note.className="sendnote";
        note.textContent=live
          ?"This includes a LIVE campaign: those emails go to the businesses themselves, and a copy of every one lands in your inbox. Everything else goes only to you."
          :"Every email goes to your own inbox. No business owner can be reached from this page.";
        hero.appendChild(note);
        hero.appendChild(logNode("all"));
      }else{
        var idle=document.createElement("div");
        idle.className="idle";
        idle.appendChild(svgMark(46));
        var h=document.createElement("h3");
        var p=document.createElement("p");
        if(buildingBatches().length){
          h.textContent="Nothing is waiting on you right now.";
          p.textContent="The factory is still building — finished sites appear here for your approval.";
        }else{
          h.textContent="Nothing is waiting on you right now — the shelf is empty.";
          p.textContent="Start a campaign from the Command Center and the finished websites land here, ready for your OK.";
        }
        idle.appendChild(h);idle.appendChild(p);
        hero.appendChild(idle);
        if(logFor("all").length)hero.appendChild(logNode("all"));
      }
    }

    function progressBarFor(b){
      var goal=goalOf(b);
      if(!goal)return "";
      var done=finishedOf(b);
      var pct=Math.max(0,Math.min(100,Math.round(done/goal*100)));
      return '<div class="camp-progress'+(pct?"":" none")+'" role="progressbar" aria-valuemin="0" aria-valuemax="'
        +goal+'" aria-valuenow="'+done+'" aria-label="Finished websites">'
        +'<i style="width:'+pct+'%"></i></div>'
        +'<p class="camp-progress-note">'+done+" of "+goal+" websites finished so far.</p>";
    }

    function seeSitesButton(grid){
      var btn=document.createElement("button");
      btn.type="button";
      btn.className="seeBtn";
      btn.setAttribute("aria-expanded","false");
      btn.setAttribute("aria-controls",grid.id);
      btn.textContent="See the websites";
      btn.addEventListener("click",function(){
        var open=grid.hidden;
        grid.hidden=!open;
        btn.setAttribute("aria-expanded",String(open));
        btn.textContent=open?"Hide the websites":"See the websites";
      });
      return btn;
    }

    function campaignCard(b,opts){
      opts=opts||{};
      var ready=isReady(b);
      var card=document.createElement("article");
      card.className="camp";
      card.id="camp-"+text(b.batchId,"").slice(-8);
      var head=document.createElement("div");
      head.className="camp-head";
      var name=document.createElement("h3");
      name.className="camp-name";name.textContent=campaignCardName(b);
      head.appendChild(name);
      if(b.lane==="live"){
        var live=document.createElement("span");
        live.className="camp-live";live.textContent="LIVE";
        head.appendChild(live);
      }
      var when=document.createElement("span");
      when.className="camp-when";when.textContent="started "+fmtWhen(b.startedAt);
      head.appendChild(when);
      card.appendChild(head);

      // THE BIG STATUS SENTENCE — one line that says exactly where this
      // campaign stands, then the progress bar under it.
      var status=campaignStatusLine(b);
      var line=document.createElement("p");
      line.className="camp-line";
      line.textContent=status.line;
      if(status.note){
        var note0=document.createElement("small");
        note0.textContent=status.note;
        line.appendChild(note0);
      }
      card.appendChild(line);
      card.insertAdjacentHTML("beforeend",progressBarFor(b));

      // The campaign's facts as short plain sentences — one fact per line, no
      // dot-separated counters. Failure reasons only when the data carries
      // them; absent reasons say so honestly, never an invented one.
      var c=countsOf(b);
      var facts=document.createElement("div");
      facts.className="camp-facts";
      function factLine(txt,cls){
        var p=document.createElement("p");
        if(cls)p.className=cls;
        p.textContent=txt;
        facts.appendChild(p);
      }
      factLine("We found "+plural(Number(c.total)||0,"business","businesses")+".");
      var readyN=Number(c.queued)||0;
      if(readyN>0)factLine(readyN+(readyN===1?" website is":" websites are")+" built, inspected, and ready to email.");
      var failedN=Number(c.failed)||0;
      if(failedN>0){
        factLine("We could not build "+failedN+(failedN===1?" of them.":" of them."));
        var reasons=topBuildReasons(b);
        factLine("Why: "+(reasons.length?reasons.join(" · ")+".":"couldn't build — reason not recorded."),"why");
      }
      var sentN=Number(c.sent)||0;
      if(sentN>0)factLine("We already emailed "+sentN+(sentN===1?" of them.":" of them."));
      card.appendChild(facts);

      // The websites, behind the card's first plain action.
      var grid=document.createElement("div");
      grid.className="sites";
      grid.id="sites-"+text(b.batchId,"").slice(-8);
      var sites=0;
      (b.rows||[]).forEach(function(row){
        if(row.status==="queued"){grid.appendChild(siteTile(row,false));sites+=1;}
      });
      if(!sites){
        var empty=document.createElement("p");
        empty.className="sites-empty";
        empty.textContent=isBuilding(b)
          ?"No finished websites yet — the run is still building. Check back in a few minutes."
          :"No finished websites are waiting in this campaign.";
        grid.appendChild(empty);
      }
      grid.hidden=true;
      card.appendChild(grid);

      // THREE PLAIN ACTIONS, in the owner's order: see the work, email it,
      // stop it. The send keeps its armed two-press and the server read-back.
      var actions=document.createElement("div");
      actions.className="actrow";
      actions.appendChild(seeSitesButton(grid));
      var n=readyCount(b);
      if(ready){
        actions.appendChild(sendButton(b.batchId,
          b.lane==="live"
            ?("Approve & send "+plural(n,"site","sites")+" to the businesses")
            :"Email proofs to me"));
      }
      var stop=document.createElement("a");
      stop.className="camp-stop";
      stop.href="/console";
      stop.textContent="Stop this campaign";
      stop.title="Opens the one-press stop switch on the Command Center. It stops every campaign at once — there is no stop for one campaign alone.";
      actions.appendChild(stop);
      var note=document.createElement("span");
      note.className="actrow-note";
      note.textContent=ready
        ?(b.lane==="live"
          ?"Live campaign: the businesses get the email; a copy of every one lands in your inbox."
          :"These go to your own inbox only. The stop switch halts every campaign at once.")
        :"The stop switch halts every campaign at once — it lives at the top of the Command Center.";
      actions.appendChild(note);
      if(logFor(b.batchId).length)actions.appendChild(logNode(b.batchId));
      card.appendChild(actions);
      return card;
    }

    function render(){
      renderHero();
      var ready=readyBatches();
      var building=buildingBatches();
      var listSec=document.getElementById("listSec");
      var list=document.getElementById("campaignList");
      listSec.hidden=!(ready.length||building.length);
      list.replaceChildren();
      ready.forEach(function(b){list.appendChild(campaignCard(b));});
      building.forEach(function(b){list.appendChild(campaignCard(b));});

      var older=olderBatches();
      var olderSec=document.getElementById("olderSec");
      olderSec.hidden=!older.length;
      document.getElementById("olderSummary").textContent="Earlier campaigns ("+older.length+")";
      var olderRows=document.getElementById("olderRows");
      olderRows.replaceChildren();
      older.forEach(function(b){
        var row=document.createElement("div");
        row.className="oldrow";
        var name=document.createElement("b");name.textContent=campaignCardName(b);
        var out=document.createElement("span");out.className="rowout";out.textContent=outcomeText(b);
        var when=document.createElement("span");when.className="rowwhen";when.textContent=fmtWhen(b.startedAt);
        row.appendChild(batchVisual(b));row.appendChild(name);row.appendChild(out);row.appendChild(when);
        olderRows.appendChild(row);
      });
    }

    // ---- approve & send: two presses, then the server's own read-back -------
    function disarm(){
      if(arm.timer){window.clearTimeout(arm.timer);arm.timer=null;}
      arm.scope=null;
    }
    function pressSend(scope){
      if(run.active)return;
      if(arm.scope===scope){disarm();startRun(scope);return;}
      disarm();
      arm.scope=scope;
      clearLog(scope);
      var live=scope==="all"?anyLiveReady():(state.batches.some(function(b){return b.batchId===scope&&b.lane==="live";}));
      say(scope,(live
        ?"This will send real email to the businesses (with copies to you)."
        :"This will send every finished site to YOUR inbox.")
        +" That was press one of two — press the button again within 20 seconds to confirm.","dim");
      arm.timer=window.setTimeout(function(){
        disarm();
        say(scope,"Confirmation window expired — nothing was approved and nothing was sent. Press twice within 20 seconds to confirm.","bad");
      },20000);
      render();
    }

    function namesById(b){
      var map={};
      (b.rows||[]).forEach(function(row){map[row.prospectId]=text(row.businessName,row.prospectId);});
      return map;
    }

    // One campaign, driven to the end: approve if needed, then the resumable
    // send until the server says remaining 0 (or refuses / stops moving).
    function runCampaign(b,scope){
      var id=b.batchId;
      var names=namesById(b);
      var already={};
      (b.rows||[]).forEach(function(row){if(row.status==="sent")already[row.prospectId]=true;});
      var suffix=b.lane==="live"?"sent to the business ✓ (copy in your inbox)":"sent to your inbox ✓";
      var totals={sent:0,refused:0,remaining:null};

      function sendPass(){
        return post("/api/admin/line",{action:"send",batchId:id}).then(function(pass){
          var after=(pass&&pass.batch)||{};
          (after.rows||[]).forEach(function(row){
            if(row.status==="sent"&&!already[row.prospectId]){
              already[row.prospectId]=true;
              say(scope,text(names[row.prospectId],row.prospectId)+" — "+suffix,"ok");
            }
          });
          totals.sent+=Number(pass&&pass.sent)||0;
          ((pass&&pass.failures)||[]).forEach(function(f){
            totals.refused+=1;
            var raw=text(f&&f.reason,"");
            say(scope,text(names[f&&f.prospectId],(f&&f.prospectId)||"one site")+" — could not send: "+(plainReason(raw)||raw||"no reason given"),"bad");
          });
          totals.remaining=Number(pass&&pass.remaining);
          if(pass&&pass.halted===true){
            say(scope,text(pass.haltReason,"Stopped by the stop switch."),"bad");
            return totals;
          }
          if(Number.isFinite(totals.remaining)&&totals.remaining>0){
            if((Number(pass&&pass.sent)||0)>0)return sendPass();
            say(scope,totals.remaining+" still ready but the server made no progress this pass — the lines above say why. Nothing else was sent.","bad");
          }
          return totals;
        });
      }

      var needsApproval=b.status!=="approved";
      return (needsApproval
        ?post("/api/admin/line",{action:"approve",batchId:id,typedBatchId:id,actor:"campaigns-owner"}).then(function(){
          say(scope,campaignName(b)+" — approved. Sending…","dim");
        })
        :Promise.resolve(say(scope,campaignName(b)+" — already approved. Sending the rest…","dim"))
      ).then(sendPass).then(function(){return totals;});
    }

    function startRun(scope){
      run.active=true;run.scope=scope;
      clearLog(scope);
      var targets=scope==="all"?readyBatches():state.batches.filter(function(b){return b.batchId===scope&&isReady(b);});
      if(!targets.length){
        run.active=false;run.scope=null;
        say(scope,"Nothing here is ready any more — refreshing the page view.","bad");
        load().catch(function(){});
        return;
      }
      var grand={sent:0,refused:0,remaining:0};
      var chain=Promise.resolve();
      targets.forEach(function(b){
        chain=chain.then(function(){
          return runCampaign(b,scope).then(function(t){
            grand.sent+=t.sent;grand.refused+=t.refused;
            if(Number.isFinite(t.remaining))grand.remaining+=t.remaining;
          }).catch(function(e){
            grand.refused+=readyCount(b);
            var why=plainError(e);
            if(!/[.!?]$/.test(why))why+=".";
            say(scope,campaignName(b)+" — refused: "+why+" Nothing from this campaign was sent beyond the lines above.","bad");
          });
        });
      });
      chain.then(function(){
        say(scope,"Server totals: "+plural(grand.sent,"email","emails")+" sent · "
          +grand.refused+" could not be sent · "+grand.remaining+" still waiting.",grand.refused||grand.remaining?"bad":"ok");
      }).finally(function(){
        run.active=false;run.scope=null;
        load().catch(function(){});
      });
    }

    // ---- load + poll --------------------------------------------------------
    var loadInFlight=null;
    function load(){
      if(loadInFlight)return loadInFlight;
      loadInFlight=api("/api/admin/line").then(function(payload){
        state.batches=Array.isArray(payload&&payload.batches)?payload.batches:[];
        state.readiness=(payload&&payload.readiness)||null;
        state.loaded=true;
        hideGate();
        render();
        return payload;
      }).catch(function(error){
        if(error.status===401||error.status===403){
          clearToken();
          showGate("That code was rejected. Paste a current access code.");
        }else if(!state.loaded){
          hideGate();
          var hero=document.getElementById("hero");
          hero.replaceChildren();
          var idle=document.createElement("div");
          idle.className="idle";
          var h=document.createElement("h3");h.textContent="Could not reach the factory.";
          var p=document.createElement("p");p.textContent=text(error.message,"The server did not answer.")+" — reload to try again.";
          idle.appendChild(h);idle.appendChild(p);
          hero.appendChild(idle);
        }
        throw error;
      }).finally(function(){loadInFlight=null;});
      return loadInFlight;
    }

    window.setInterval(function(){
      if(run.active||document.hidden||!token()||!state.loaded)return;
      load().catch(function(){});
    },POLL_MS);

    accessForm.addEventListener("submit",function(event){
      event.preventDefault();
      var value=tokenInput.value.trim();
      if(!value){showGate("Paste the access code first.");return;}
      setToken(value);
      accessButton.disabled=true;
      accessButton.textContent="Checking…";
      accessStatus.textContent="Checking…";
      load().catch(function(){});
    });

    if(token())load().catch(function(){});else showGate("");
  })();
  </script>
</body>
</html>`;
