"use strict";

/**
 * WSS Reply Desk — "What businesses said".
 *
 * This is an operator-reviewed delivery surface. It may mutate state only by
 * calling the existing reply approval/rejection endpoint and the existing
 * held-draft approval endpoint. The browser never invents a successful send:
 * every result shown below is read back from the server response.
 *
 * Plain-words pass 2026-08-16: the page is titled "What businesses said",
 * each business's own words read as a big readable quote, machine statuses
 * and refusal codes ("stopped", "suppressed", "opt_out") translate through
 * the shared voice in lib/operator-voice.js plus a page-level code table,
 * and the empty state tells the owner the truth: nothing yet.
 */
const { operatorNav } = require("./operator-nav");
const { STATUS: VOICE_STATUS, PLAIN: VOICE_PLAIN } = require("./operator-voice");

module.exports = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#08080B">
  <meta name="description" content="What businesses wrote back, in their own words — read it, review the answer, and only then send.">
  <title>What businesses said · WSS Command Center</title>
  <style>
    :root{
      color-scheme:dark;
      --void:#08080B;--carbon:#131318;--carbon-2:#17171d;--ice:#F2F2F5;--slate:#9B9AA4;
      --graphite:#6F6E79;--signal:#7C6CF6;--circuit:#4A6CF7;--pulse:#34D399;
      --sky:#6E8BFF;--ember:#E0A44A;--rose:#F26D6D;--hair:rgba(255,255,255,.07);
      --grad-signal:linear-gradient(135deg,#4A6CF7 0%,#8B5CF6 100%);
      --sans:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
      --mono:'IBM Plex Mono','SFMono-Regular',Consolas,Menlo,monospace;
    }
    *{box-sizing:border-box;min-width:0}
    html{min-height:100%;overflow-x:hidden;background:var(--void)}
    body{min-height:100vh;margin:0;overflow-x:hidden;background:var(--void);color:var(--ice);font-family:var(--sans);font-synthesis:none;-webkit-font-smoothing:antialiased}
    button,input,textarea{font:inherit}
    button,a,input,textarea{touch-action:manipulation}
    button{color:inherit}
    [hidden]{display:none!important}
    .skip-link{position:fixed;z-index:100;top:10px;left:10px;transform:translateY(-160%);padding:9px 12px;border-radius:8px;background:var(--ice);color:var(--void);font:700 12px/1 var(--mono);text-decoration:none}
    .skip-link:focus{transform:translateY(0)}
    :focus-visible{outline:2px solid var(--sky);outline-offset:3px}
    .shell{width:100%;max-width:1280px;margin:0 auto;padding:28px 22px 72px;transition:filter .18s ease}
    .shell.locked{filter:blur(8px);pointer-events:none;user-select:none}

    .masthead{display:flex;align-items:center;gap:15px;padding-bottom:22px;border-bottom:1px solid var(--hair)}
    .mark{width:58px;height:58px;flex:none;display:grid;place-items:center;border:1px solid var(--hair);border-radius:15px;background:var(--carbon)}
    .eyebrow{margin:0 0 6px;color:var(--slate);font:500 10px/1 var(--mono);letter-spacing:.28em;text-transform:uppercase}
    h1{margin:0;font-size:clamp(26px,4vw,36px);font-weight:800;line-height:1;letter-spacing:-.03em}
    .masthead-nav{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .nav-link{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 12px;border:1px solid var(--hair);border-radius:9px;background:var(--carbon);color:var(--slate);font:600 10px/1 var(--mono);letter-spacing:.1em;text-decoration:none;text-transform:uppercase}
    .nav-link:hover{border-color:rgba(124,108,246,.48);color:var(--ice)}

    .intro{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:24px;padding:34px 0 22px}
    .intro h2{margin:0;font-size:clamp(25px,4.5vw,44px);line-height:1.03;letter-spacing:-.035em}
    .intro p{max-width:680px;margin:10px 0 0;color:var(--slate);font-size:14px;line-height:1.65}
    .queue-count{display:flex;align-items:baseline;gap:9px;color:var(--slate);font:600 10px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}
    .queue-count strong{color:var(--ice);font:800 30px/1 var(--sans);letter-spacing:-.04em}

    /* The pause rail is a read-only mirror of durable server state. */
    .pause-rail{position:sticky;z-index:12;top:0;display:grid;grid-template-columns:16px minmax(0,1fr) auto;align-items:center;gap:13px;padding:14px 16px;border:1px solid var(--hair);border-radius:13px;background:linear-gradient(180deg,#17171d,#101014);box-shadow:0 14px 34px rgba(0,0,0,.24)}
    .pause-rail[data-state="live"]{border-color:rgba(52,211,153,.3)}
    .pause-rail[data-state="halted"]{border-color:rgba(242,109,109,.48);background:linear-gradient(180deg,#3b1519,#220d10)}
    .pause-rail[data-state="unknown"],.pause-rail[data-state="error"]{border-color:rgba(224,164,74,.45);background:linear-gradient(180deg,#2c2411,#1a1509)}
    .pause-lamp{width:13px;height:13px;border-radius:50%;background:var(--ember);box-shadow:0 0 0 4px rgba(224,164,74,.16)}
    .pause-rail[data-state="live"] .pause-lamp{background:var(--pulse);box-shadow:0 0 0 4px rgba(52,211,153,.14)}
    .pause-rail[data-state="halted"] .pause-lamp{background:var(--rose);box-shadow:0 0 0 4px rgba(242,109,109,.18)}
    .pause-title{font-size:15px;font-weight:800;letter-spacing:-.01em}
    .pause-rail[data-state="live"] .pause-title{color:var(--pulse)}
    .pause-rail[data-state="halted"] .pause-title{color:var(--rose)}
    .pause-rail[data-state="unknown"] .pause-title,.pause-rail[data-state="error"] .pause-title{color:var(--ember)}
    .pause-sub{margin-top:3px;color:var(--slate);font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
    .pause-stamp{color:var(--graphite);font:500 9px/1.35 var(--mono);letter-spacing:.1em;text-align:right;text-transform:uppercase}

    main{display:flex;flex-direction:column;gap:42px;padding-top:34px}
    .section-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:14px}
    .section-head h2{margin:0;font-size:21px;line-height:1.1;letter-spacing:-.025em}
    .section-head p{max-width:650px;margin:6px 0 0;color:var(--slate);font-size:12.5px;line-height:1.55}
    .section-kicker{display:inline-flex;align-items:center;gap:7px;color:var(--signal);font:600 9px/1 var(--mono);letter-spacing:.15em;text-transform:uppercase}
    .section-kicker svg{width:14px;height:14px}

    .reply-list,.held-list{display:flex;flex-direction:column;gap:14px}
    .reply-card,.held-card{position:relative;overflow:hidden;border:1px solid var(--hair);border-radius:15px;background:var(--carbon)}
    .reply-card::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--signal)}
    .reply-card.resolved::before{background:var(--pulse)}
    .card-head{display:flex;align-items:center;gap:12px;padding:15px 17px;border-bottom:1px solid var(--hair);background:rgba(255,255,255,.012)}
    .initial{width:38px;height:38px;flex:none;display:grid;place-items:center;border:1px solid rgba(124,108,246,.35);border-radius:11px;background:rgba(124,108,246,.09);color:#c9c3ff;font:800 13px/1 var(--mono);text-transform:uppercase}
    .identity{flex:1}
    .identity strong{display:block;font-size:15px;line-height:1.25;overflow-wrap:anywhere}
    .identity small{display:block;margin-top:3px;color:var(--graphite);font:500 10px/1.4 var(--mono);overflow-wrap:anywhere}
    .intent{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid rgba(124,108,246,.3);border-radius:999px;color:#c9c3ff;font:600 9px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
    .intent svg{width:13px;height:13px}
    .reply-grid{display:grid;grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr)}
    .message-pane{display:flex;flex-direction:column;gap:10px;padding:17px}
    .message-pane+.message-pane{border-left:1px solid var(--hair);background:rgba(255,255,255,.012)}
    .pane-label{display:flex;align-items:center;gap:7px;color:var(--slate);font:600 9px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase}
    .pane-label svg{width:14px;height:14px}
    .subject{color:var(--ice);font-size:13px;font-weight:700;line-height:1.4;overflow-wrap:anywhere}
    .letter{margin:0;padding:13px 14px;border:1px solid var(--hair);border-radius:10px;background:var(--void);color:#d8d8de;font:400 13px/1.65 var(--sans);white-space:pre-wrap;overflow-wrap:anywhere}
    .letter.unavailable{color:var(--graphite);font-style:italic}
    /* THEIR OWN WORDS, big and readable — the point of this page. A fresh
       class name so the shared nav readability floor cannot shrink it, and
       quote marks only when there are actually words to quote. */
    .reply-quote{margin:0;padding:16px 18px;border:1px solid var(--hair);border-left:3px solid rgba(124,108,246,.6);border-radius:6px 12px 12px 6px;background:rgba(124,108,246,.06);color:#E7E7ED;font:400 17px/1.7 var(--sans);white-space:pre-wrap;overflow-wrap:anywhere}
    .reply-quote.quoted::before{content:"\\201C";color:#c9c3ff;font-weight:800}
    .reply-quote.quoted::after{content:"\\201D";color:#c9c3ff;font-weight:800}
    .reply-quote.unavailable{border-left-color:rgba(111,110,121,.5);background:transparent;color:var(--graphite);font-style:italic;font-size:15.5px}
    .draft-body{display:block;width:100%;min-height:176px;resize:vertical;overflow-y:hidden;padding:13px 14px;border:1px solid rgba(124,108,246,.28);border-radius:10px;background:var(--void);color:var(--ice);font:400 13px/1.65 var(--sans);white-space:pre-wrap}
    .draft-body:focus{border-color:var(--signal)}
    .draft-body:disabled{color:var(--slate);opacity:.76}
    .card-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:0 17px 17px}
    .action{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 14px;border:1px solid var(--hair);border-radius:9px;background:var(--carbon-2);color:var(--ice);font:750 12px/1 var(--sans);cursor:pointer}
    .action svg{width:16px;height:16px;flex:none}
    .action:hover:not(:disabled){transform:translateY(-1px);border-color:rgba(124,108,246,.55)}
    .action.primary{border-color:transparent;background:var(--grad-signal)}
    .action.danger{color:#ffcaca;border-color:rgba(242,109,109,.32);background:rgba(242,109,109,.07)}
    .action.armed{border-color:var(--rose);background:#fff;color:#7f1d1d;outline:3px solid var(--rose);outline-offset:2px}
    .action:disabled{cursor:not-allowed;opacity:.42;transform:none}
    .action.busy{cursor:wait;opacity:.64}
    .result{flex:1;min-width:min(100%,260px);padding:9px 11px;border:1px solid var(--hair);border-radius:9px;background:rgba(255,255,255,.025);color:var(--slate);font:500 11px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}
    .result[hidden]{display:none!important}
    .result.ok{border-color:rgba(52,211,153,.36);background:rgba(52,211,153,.08);color:#cdf5e6}
    .result.bad{border-color:rgba(242,109,109,.4);background:rgba(242,109,109,.08);color:#ffd9d9}
    .result.warn{border-color:rgba(224,164,74,.42);background:rgba(224,164,74,.08);color:#f5dba9}

    .state-panel{display:grid;grid-template-columns:42px minmax(0,1fr);gap:13px;align-items:start;padding:20px;border:1px dashed rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.018)}
    .state-icon{width:42px;height:42px;display:grid;place-items:center;border:1px solid var(--hair);border-radius:12px;background:var(--carbon-2);color:var(--signal)}
    .state-icon svg{width:19px;height:19px}
    .state-panel h3{margin:1px 0 5px;font-size:15px}
    .state-panel p{margin:0;color:var(--slate);font-size:12.5px;line-height:1.55;overflow-wrap:anywhere}
    .state-panel.error{border-color:rgba(242,109,109,.32)}
    .state-panel.error .state-icon{color:var(--rose)}

    .held-dock{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:17px;border:1px solid var(--hair);border-radius:14px;background:linear-gradient(120deg,var(--carbon),rgba(124,108,246,.055))}
    .held-dock strong{display:block;font-size:14px}
    .held-dock p{margin:5px 0 0;color:var(--slate);font-size:12px;line-height:1.55}
    .load-held{min-width:168px}
    .load-held.loading svg{animation:spin 1s linear infinite}
    .held-progress{margin:10px 0 0;color:var(--slate);font:500 10px/1.5 var(--mono);overflow-wrap:anywhere}
    .held-counts{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
    .count-chip{padding:7px 9px;border:1px solid var(--hair);border-radius:8px;background:var(--carbon);color:var(--slate);font:500 9px/1.35 var(--mono);letter-spacing:.06em;text-transform:uppercase}
    .count-chip strong{color:var(--ice);font-size:11px}
    .held-card{padding:16px 17px}
    .held-card-head{display:flex;align-items:start;gap:12px}
    .held-card h3{margin:0;font-size:15px;line-height:1.3;overflow-wrap:anywhere}
    .held-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;color:var(--graphite);font:500 9px/1.4 var(--mono)}
    .held-copy{margin:13px 0 0;max-height:none}
    .held-card .card-actions{padding:14px 0 0}

    .access{position:fixed;z-index:80;inset:0;display:grid;place-items:center;padding:20px;background:rgba(8,8,11,.76);backdrop-filter:blur(10px)}
    .access-card{width:min(410px,100%);padding:24px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:var(--carbon);box-shadow:0 30px 80px rgba(0,0,0,.45)}
    .access-card h2{margin:0 0 8px;font-size:22px;letter-spacing:-.02em}
    .access-card p{margin:0 0 16px;color:var(--slate);font-size:13px;line-height:1.5}
    .access-card input{width:100%;height:44px;margin-bottom:10px;padding:0 13px;border:1px solid var(--hair);border-radius:9px;background:var(--void);color:var(--ice);font:500 13px var(--mono)}
    .access-card button{width:100%;min-height:44px;padding:0 16px;border:0;border-radius:9px;background:var(--grad-signal);color:var(--ice);font:750 14px var(--sans);cursor:pointer}
    .access-card button:disabled{cursor:wait;opacity:.62}
    .access-status{min-height:18px;margin:10px 0 0!important;color:var(--rose)!important}
    @keyframes spin{to{transform:rotate(360deg)}}

    @media(max-width:760px){
      .shell{padding:20px 16px 56px}.masthead{align-items:flex-start;flex-wrap:wrap}.masthead-nav{width:100%;margin-left:73px;justify-content:flex-start}
      .intro{grid-template-columns:1fr;gap:14px;padding-top:28px}.queue-count{justify-self:start}
      .reply-quote{font-size:16px}
      .pause-rail{grid-template-columns:14px minmax(0,1fr);margin:0 -4px;padding:13px}.pause-stamp{grid-column:2;text-align:left}
      main{gap:36px;padding-top:28px}.section-head{align-items:start;flex-direction:column}.reply-grid{grid-template-columns:1fr}
      .message-pane+.message-pane{border-top:1px solid var(--hair);border-left:0}.card-head{align-items:flex-start;flex-wrap:wrap}.intent{margin-left:50px}
      .card-actions{align-items:stretch}.action{flex:1 1 145px}.result{flex-basis:100%}.held-dock{grid-template-columns:1fr}.load-held{width:100%}
    }
    @media(max-width:410px){
      .masthead-nav{margin-left:0}.nav-link{flex:1;justify-content:center}.card-head,.message-pane,.card-actions,.held-card{padding-left:14px;padding-right:14px}
      .intent{margin-left:0}.action{flex-basis:100%}
    }
    @media(prefers-reduced-motion:reduce){
      *,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
      .action:hover:not(:disabled){transform:none}.load-held.loading svg{animation:none}
    }
    @media print{
      .access,.masthead-nav,.pause-rail,.held-dock,.card-actions,.skip-link{display:none!important}
      .shell{max-width:none;padding:0}.reply-card,.held-card{break-inside:avoid}.reply-grid{grid-template-columns:1fr 1fr}
    }
  </style>
</head>
<body>
  ${operatorNav("replies")}
  <a class="skip-link" href="#mainContent">Skip to the replies</a>
  <div class="shell" id="replyShell">
    <header class="masthead">
      <div class="mark" aria-label="WSS Labs mark">
        <svg width="44" height="44" viewBox="8 14 48 34" fill="none" aria-hidden="true">
          <defs><linearGradient id="wssReplyMark" x1="12" y1="42" x2="50" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="#4A6CF7"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs>
          <path d="M12 24 L21 42 L30 26 L39 42 L50 20" stroke="url(#wssReplyMark)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="50" cy="20" r="3.4" fill="#34D399"/>
        </svg>
      </div>
      <div><p class="eyebrow">WSS Command Center</p><h1>What businesses said</h1></div>
      <!-- The page-local Console/Gallery links moved into the shared operator
           bar at the top of every page (lib/operator-nav.js). Two navigations
           40px apart, naming the same places differently, was the confusion. -->
    </header>

    <div class="intro">
      <div><h2>The moment a business says yes.</h2><p>Read what they wrote in their own words, look over the answer we drafted, and send it only when you say so. The server still makes the final call on every send.</p></div>
      <div class="queue-count" aria-live="polite"><strong id="pendingCount">—</strong><span>waiting on you</span></div>
    </div>

    <aside class="pause-rail" id="pauseRail" data-state="unknown" aria-labelledby="pauseTitle" aria-live="polite">
      <span class="pause-lamp" aria-hidden="true"></span>
      <div><div class="pause-title" id="pauseTitle">Reading the stop switch…</div><div class="pause-sub" id="pauseSub">Send buttons stay off until the server says sending is on.</div></div>
      <div class="pause-stamp" id="pauseStamp">checking now</div>
    </aside>

    <main id="mainContent" tabindex="-1">
      <section aria-labelledby="queueTitle">
        <div class="section-head">
          <div><span class="section-kicker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v16H4zM4 13h4l2 3h4l2-3h4"/></svg>Replies</span><h2 id="queueTitle">Drafts waiting on you</h2><p>Nothing leaves on one click. Edit the full answer, then press twice within 20 seconds.</p></div>
        </div>
        <div class="reply-list" id="replyList" aria-busy="true">
          <div class="state-panel" id="replyState"><div class="state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/></svg></div><div><h3>Reading the replies</h3><p>Loading the replies from the server.</p></div></div>
        </div>
      </section>

      <section aria-labelledby="heldTitle">
        <div class="section-head">
          <div><span class="section-kicker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v4l-4 5 4 5v4H6v-4l4-5-4-5z"/></svg>Held back for a closer look</span><h2 id="heldTitle">Held drafts</h2><p>This check is done by hand on purpose. It can look at 500 businesses and ask CallPrep for evidence, so the page never starts it by itself.</p></div>
        </div>
        <div class="held-dock">
          <div><strong>The careful check</strong><p>One check at a time. Taking more than five seconds is normal; pressing the button again will not start a second one.</p><div class="held-progress" id="heldProgress" role="status" aria-live="polite">Not loaded. No held-draft request has been made.</div></div>
          <button class="action load-held" id="loadHeldBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>Load held drafts</button>
        </div>
        <div id="heldCounts" class="held-counts" hidden></div>
        <div class="held-list" id="heldList"></div>
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
    var KEY="wsl_admin_token";
    var ARM_WINDOW_MS=20000;
    var HELD_SEND_CONFIRMATION="SEND_APPROVED_HELD_DRAFTS";
    var state={pause:{active:null,known:false,reason:"",at:"",error:""},drafts:[],heldRows:[],heldBusy:false};
    var armTimers=new Map();
    var armTicks=new Map();
    var pausePoll=null;
    var replyShell=document.getElementById("replyShell");
    var accessGate=document.getElementById("accessGate");
    var accessForm=document.getElementById("accessForm");
    var accessButton=document.getElementById("accessButton");
    var tokenInput=document.getElementById("tokenInput");
    var accessStatus=document.getElementById("accessStatus");
    var replyList=document.getElementById("replyList");
    var heldList=document.getElementById("heldList");
    var heldProgress=document.getElementById("heldProgress");
    var loadHeldBtn=document.getElementById("loadHeldBtn");

    function token(){try{return localStorage.getItem(KEY)||"";}catch(_){return "";}}
    function setToken(value){try{localStorage.setItem(KEY,value);}catch(_){}}
    function clearToken(){try{localStorage.removeItem(KEY);}catch(_){}}
    function errorWithStatus(message,status,payload){var error=new Error(message);error.status=status;error.payload=payload;return error;}
    function text(value,fallback){var found=String(value==null?"":value).trim();return found||fallback||"";}
    function first(row,names,fallback){for(var i=0;i<names.length;i+=1){var value=row&&row[names[i]];if(value!==undefined&&value!==null&&String(value).trim())return value;}return fallback||"";}

    function api(path,opts){
      opts=opts||{};
      if(!token())return Promise.reject(errorWithStatus("Access code required",401));
      opts.headers=Object.assign({},opts.headers||{});
      opts.headers["x-admin-token"]=token();
      opts.cache="no-store";
      return fetch(path,opts).then(function(response){
        return response.text().then(function(raw){
          var payload={};
          try{payload=raw?JSON.parse(raw):{};}catch(_){payload={message:raw};}
          if(!response.ok)throw errorWithStatus(payload.message||payload.error||payload.reason||("Request failed ("+response.status+")"),response.status,payload);
          return payload;
        });
      });
    }

    function post(path,body){return api(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});}

    function showGate(message){
      accessGate.hidden=false;
      replyShell.classList.add("locked");
      replyShell.inert=true;
      replyShell.setAttribute("inert","");
      accessStatus.textContent=message||"";
      accessButton.disabled=false;
      accessButton.textContent="Open the page";
      window.setTimeout(function(){tokenInput.focus();},0);
    }

    function hideGate(){
      accessGate.hidden=true;
      replyShell.classList.remove("locked");
      replyShell.inert=false;
      replyShell.removeAttribute("inert");
      accessStatus.textContent="";
      tokenInput.value="";
    }

    function authFailure(error){
      if(!error||(error.status!==401&&error.status!==403))return false;
      clearToken();
      showGate("That code was rejected. Paste a current access code.");
      return true;
    }

    function icon(path){
      var svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width","1.8");svg.setAttribute("stroke-linecap","round");svg.setAttribute("stroke-linejoin","round");svg.setAttribute("aria-hidden","true");
      var node=document.createElementNS("http://www.w3.org/2000/svg","path");node.setAttribute("d",path);svg.appendChild(node);return svg;
    }

    function relativeTime(value){
      var instant=Date.parse(String(value||""));
      if(!Number.isFinite(instant))return "time unavailable";
      var seconds=Math.round((instant-Date.now())/1000);var abs=Math.abs(seconds);var unit="second",amount=seconds;
      if(abs>=31536000){unit="year";amount=Math.round(seconds/31536000);}
      else if(abs>=2592000){unit="month";amount=Math.round(seconds/2592000);}
      else if(abs>=86400){unit="day";amount=Math.round(seconds/86400);}
      else if(abs>=3600){unit="hour";amount=Math.round(seconds/3600);}
      else if(abs>=60){unit="minute";amount=Math.round(seconds/60);}
      try{return new Intl.RelativeTimeFormat("en",{numeric:"auto",style:"short"}).format(amount,unit);}
      catch(_){return seconds<=0?Math.max(0,Math.round(abs/60))+"m ago":"in "+Math.max(0,Math.round(abs/60))+"m";}
    }

    function exactTime(value){
      var instant=Date.parse(String(value||""));
      if(!Number.isFinite(instant))return "Exact time unavailable";
      return new Date(instant).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
    }

    function humanWords(value,fallback){
      var raw=text(value,fallback||"");
      return raw.replace(/[_-]+/g," ").replace(/\\b\\w/g,function(letter){return letter.toUpperCase();});
    }

    // ---- the shared plain-words voice (lib/operator-voice.js) ---------------
    // Serialised in at render time; the tiny lookups are mirrored from the
    // module so one status never reads two ways on two pages.
    var VOICE_PLAIN_TABLE=${JSON.stringify(VOICE_PLAIN)};
    var VOICE_STATUS_TABLE=${JSON.stringify(VOICE_STATUS)};
    function voiceNormalize(v){return String(v==null?"":v).trim().toLowerCase().replace(/[\\s-]+/g,"_");}
    function titleCaseWords(v){return String(v==null?"":v).replace(/[_-]+/g," ").replace(/\\s+/g," ").trim().replace(/\\b([a-z])/g,function(l){return l.toUpperCase();});}
    function explain(term){
      var raw=text(term,"");
      if(!raw)return "";
      if(Object.prototype.hasOwnProperty.call(VOICE_PLAIN_TABLE,raw))return VOICE_PLAIN_TABLE[raw];
      var hit=VOICE_STATUS_TABLE[voiceNormalize(raw)];
      if(hit)return hit[0];
      return titleCaseWords(raw);
    }
    function statusChip(status){
      var key=voiceNormalize(status);
      var hit=VOICE_STATUS_TABLE[key];
      if(hit)return {label:hit[0],tone:hit[1]};
      if(!key)return {label:"Not reported",tone:"neutral"};
      return {label:titleCaseWords(String(status)),tone:"neutral"};
    }
    // Reply-specific intents the shared table does not carry yet. Integration
    // point: when lib/operator-voice.js grows these keys, drop them here.
    var INTENT_PLAIN={
      opt_out:"Asked us to stop",
      interested:"Interested",
      question:"Asked a question",
      report_viewed:"Looked at their report"
    };
    function intentLabel(value){
      var raw=text(value,"");
      return INTENT_PLAIN[raw]||explain(raw)||"Replied";
    }

    // Machine refusal codes, translated to the owner's language. "suppressed"
    // and "stopped" are exactly the words he should never have to parse.
    // Unknown codes pass through raw — a raw truth beats a wrong translation.
    var SAY_PLAIN={
      reply_recipient_suppressed:"this business asked us not to email them — we stopped",
      outreach_delivery_paused:"you asked us to stop sending — we stopped. Turn sending back on from the Command Center",
      owner_stop_button:"you pressed the stop button — we stopped. Turn sending back on from the Command Center",
      reply_suppression_check_unavailable:"the do-not-email list could not be checked, so nothing was sent",
      delivery_pause_status_unavailable:"the server could not say whether sending is on or off, so nothing was sent",
      sending_halted_or_pause_unreadable:"sending is switched off or unreadable right now — nothing was sent",
      reply_body_required:"the answer is empty — write it before sending",
      reply_recipient_missing:"this reply has nowhere to go — the business left no email address"
    };
    function plainSay(code){
      return SAY_PLAIN[String(code||"").trim()]||"";
    }

    function maskEmail(value){
      var raw=text(value,"");var at=raw.indexOf("@");if(at<1)return "";
      var local=raw.slice(0,at);var domain=raw.slice(at+1);return local.slice(0,Math.min(2,local.length))+"…@"+domain;
    }

    function initials(value){
      var parts=text(value,"Prospect").split(/\\s+/).filter(Boolean);return parts.slice(0,2).map(function(part){return part.charAt(0);}).join("").slice(0,2)||"P";
    }

    function statePanel(title,body,tone){
      var panel=document.createElement("div");panel.className="state-panel"+(tone?" "+tone:"");
      var visual=document.createElement("div");visual.className="state-icon";visual.appendChild(icon(tone==="error"?"M12 8v5M12 17h.01M4.9 19h14.2a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.17 16A2 2 0 0 0 4.9 19":"M4 5h16v14H4zM4 7l8 6 8-6"));
      var copy=document.createElement("div");var heading=document.createElement("h3");heading.textContent=title;var paragraph=document.createElement("p");paragraph.textContent=body;copy.appendChild(heading);copy.appendChild(paragraph);panel.appendChild(visual);panel.appendChild(copy);return panel;
    }

    function setResult(node,message,tone){node.hidden=false;node.className="result"+(tone?" "+tone:"");node.textContent=message;}

    function serverReason(source){
      var payload=source&&source.payload?source.payload:source||{};
      var direct=payload.error||payload.reason||payload.blocked||payload.message;
      if(direct){var said=plainSay(direct);return said||text(direct,"server_refused");}
      var skipped=Array.isArray(payload.skipped)?payload.skipped:[];
      if(skipped.length)return skipped.map(function(item){
        var skippedWhy=plainSay(item.reason||item.blocked);
        return skippedWhy||text(item.reason||item.blocked,"refused");
      }).join(" · ");
      if(source&&source.message){var msg=plainSay(source.message);return msg||text(source.message,"server_refused");}
      return "The server did not provide a reason.";
    }

    function pauseState(){if(state.pause.error)return "error";if(state.pause.active===true)return state.pause.known?"halted":"unknown";if(state.pause.active===false)return state.pause.known?"live":"unknown";return "unknown";}
    function sendingLive(){return pauseState()==="live";}

    function updateSendAvailability(){
      var live=sendingLive();
      document.querySelectorAll("[data-send-action]").forEach(function(button){
        var blocked=button.dataset.busy==="true"||button.dataset.resolved==="true";
        button.disabled=!live||blocked;
        button.title=live?"Requires two clicks within 20 seconds":(pauseState()==="halted"?"Sending is halted on the server":"Send disabled until the server pause state is readable");
      });
      if(!live)disarmAll("Confirmation cleared because the server does not report sending as live.");
    }

    function renderPause(){
      var rail=document.getElementById("pauseRail");var title=document.getElementById("pauseTitle");var sub=document.getElementById("pauseSub");var stamp=document.getElementById("pauseStamp");var current=pauseState();
      rail.setAttribute("data-state",current);
      if(current==="halted"){
        title.textContent="ALL SENDING IS STOPPED";
        sub.textContent="You asked us to stop — we stopped. Recorded"+(state.pause.at?" at "+exactTime(state.pause.at):"")+(state.pause.reason?" — "+state.pause.reason:"")+". Sending stays off until you switch it back on.";
      }else if(current==="live"){
        title.textContent="SENDING IS ON";
        sub.textContent="No stop is set"+(state.pause.reason?" — last change: "+state.pause.reason:"")+". The server still checks every email before it goes out.";
      }else if(current==="error"){
        title.textContent="THE STOP SWITCH DID NOT ANSWER — SENDS DISABLED";
        sub.textContent=state.pause.error+". We will not offer a send while this state is unknown.";
      }else{
        title.textContent="WE CANNOT TELL IF SENDING IS ON OR OFF — SENDS DISABLED";
        sub.textContent=state.pause.active===false&&!state.pause.known
          ?"The server has no record of a stop yet. Sending stays off until the server gives a clear answer."
          :"The server did not give a usable answer. Nothing can be confirmed from this page.";
      }
      stamp.textContent="checked "+new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
      updateSendAvailability();
    }

    function readPausePayload(payload){
      var pause=payload&&payload.deliveryPause;
      if(!pause||typeof pause.active!=="boolean"){
        state.pause={active:null,known:false,reason:"",at:"",error:text(payload&&(payload.error||payload.message),"The pause endpoint answered without a state")};return false;
      }
      state.pause={active:pause.active===true,known:pause.known===true,reason:text(pause.reason,""),at:text(pause.at,""),error:""};return true;
    }

    function refreshPause(){
      if(!token())return Promise.resolve(false);
      return api("/api/admin/outreach-pause").then(function(payload){var readable=readPausePayload(payload);renderPause();return readable;}).catch(function(error){
        if(authFailure(error))throw error;
        state.pause={active:null,known:false,reason:"",at:"",error:text(error.message,"The pause endpoint did not answer")};renderPause();return false;
      });
    }

    function autoGrow(area){area.style.height="auto";area.style.height=Math.max(176,area.scrollHeight+2)+"px";}

    function disarm(key,message){
      if(armTimers.has(key)){window.clearTimeout(armTimers.get(key));armTimers.delete(key);}
      if(armTicks.has(key)){window.clearInterval(armTicks.get(key));armTicks.delete(key);}
      var button=Array.from(document.querySelectorAll("[data-arm-key]")).find(function(candidate){return candidate.dataset.armKey===key;});
      if(button){button.classList.remove("armed");button.dataset.armed="false";button.replaceChildren(icon("M4 12h13M13 6l6 6-6 6"),document.createTextNode(button.dataset.baseLabel||"Send"));}
      if(message&&button){var result=button.closest(".reply-card,.held-card").querySelector(".result");if(result)setResult(result,message,"warn");}
    }

    function disarmAll(message){Array.from(armTimers.keys()).forEach(function(key){disarm(key,message);});}

    function arm(button,key,result){
      disarm(key);
      var started=Date.now();button.dataset.armed="true";button.classList.add("armed");
      function paint(){var left=Math.max(0,Math.ceil((ARM_WINDOW_MS-(Date.now()-started))/1000));button.replaceChildren(icon("M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"),document.createTextNode("CONFIRM SEND — click again · "+left+"s"));}
      paint();
      setResult(result,"Send armed for 20 seconds. Review the full message, then click the same button again. Nothing has been sent.","warn");
      // 20s, not 6: the operator needs enough time to read the explicit
      // confirmation after the first click. Expiry is announced, never silent.
      armTicks.set(key,window.setInterval(paint,1000));
      armTimers.set(key,window.setTimeout(function(){disarm(key);setResult(result,"Confirmation window expired — nothing was sent. Press Send twice within 20 seconds to try again.","bad");},ARM_WINDOW_MS));
    }

    function sendButton(label,key,onConfirmed){
      var button=document.createElement("button");button.type="button";button.className="action primary";button.dataset.sendAction="true";button.dataset.armKey=key;button.dataset.baseLabel=label;button.dataset.armed="false";button.appendChild(icon("M4 12h13M13 6l6 6-6 6"));button.appendChild(document.createTextNode(label));
      button.addEventListener("click",function(){
        var card=button.closest(".reply-card,.held-card");var result=card.querySelector(".result");
        if(!sendingLive()){setResult(result,"Send refused in the browser: the server does not report sending as live.","bad");return;}
        if(button.dataset.armed!=="true"){arm(button,key,result);return;}
        disarm(key);onConfirmed(button,result);
      });
      return button;
    }

    function setButtonBusy(button,busy,label){button.dataset.busy=busy?"true":"false";button.classList.toggle("busy",busy);if(label){button.replaceChildren(icon("M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"),document.createTextNode(label));}updateSendAvailability();}

    function replyName(row){return text(first(row,["businessName","business_name","prospectName","prospect_name","fromName","senderName"]),"Prospect reply");}
    function originalReply(row){return text(first(row,["originalReply","original_reply","inboundText","inbound_text","inboundBody","inbound_body","replyText","reply_text","whatTheyWrote","preview"]),"");}

    function resolveReply(row,button,result,card,area){
      setButtonBusy(button,true,"Checking pause…");
      refreshPause().then(function(readable){
        if(!readable||!sendingLive())throw errorWithStatus("sending_halted_or_pause_unreadable",409,{error:"sending_halted_or_pause_unreadable"});
        var body=text(area.value,"");
        if(!body)throw errorWithStatus("reply_body_required",422,{error:"reply_body_required"});
        setButtonBusy(button,true,"Sending through gates…");
        return post("/api/admin/reply-queue",{draftId:text(row.draftId,""),action:"approve",body:body});
      }).then(function(payload){
        if(payload&&payload.ok===true&&payload.action==="sent"){
          setResult(result,"Server confirmed: sent through "+text(payload.provider,"the configured provider")+".","ok");button.dataset.resolved="true";button.replaceChildren(icon("M5 12l4 4L19 6"),document.createTextNode("Sent"));area.disabled=true;card.classList.add("resolved");var reject=card.querySelector("[data-reject-action]");if(reject)reject.disabled=true;
        }else{setResult(result,"Server response did not confirm a send: "+serverReason(payload),"bad");}
      }).catch(function(error){if(!authFailure(error))setResult(result,"Server refused: "+serverReason(error),"bad");}).finally(function(){setButtonBusy(button,false);if(button.dataset.resolved!=="true")button.replaceChildren(icon("M4 12h13M13 6l6 6-6 6"),document.createTextNode(button.dataset.baseLabel));refreshPause().catch(function(){});});
    }

    function rejectReply(row,button,result,card){
      if(!window.confirm("Reject this drafted reply? It will leave the pending queue, and no email will be sent."))return;
      button.disabled=true;button.classList.add("busy");button.textContent="Rejecting…";
      post("/api/admin/reply-queue",{draftId:text(row.draftId,""),action:"reject"}).then(function(payload){
        if(payload&&payload.ok===true&&payload.action==="rejected"){
          setResult(result,"Server confirmed: rejected. No email was sent.","ok");card.classList.add("resolved");var send=card.querySelector("[data-send-action]");if(send)send.dataset.resolved="true";card.querySelectorAll("button,textarea").forEach(function(control){control.disabled=true;});
        }else{setResult(result,"Server response did not confirm rejection: "+serverReason(payload),"bad");button.disabled=false;}
      }).catch(function(error){if(!authFailure(error)){setResult(result,"Server refused: "+serverReason(error),"bad");button.disabled=false;}}).finally(function(){button.classList.remove("busy");if(!button.disabled){button.replaceChildren(icon("M6 6l12 12M18 6L6 18"),document.createTextNode("Reject"));}});
    }

    function renderReplyCard(row,index){
      var card=document.createElement("article");card.className="reply-card";card.dataset.draftId=text(row.draftId,"");
      var head=document.createElement("header");head.className="card-head";
      var badge=document.createElement("span");badge.className="initial";badge.setAttribute("aria-hidden","true");var name=replyName(row);badge.textContent=initials(name);
      var identity=document.createElement("div");identity.className="identity";var strong=document.createElement("strong");strong.textContent=name;var timestamp=document.createElement("small");var created=first(row,["createdAt","created_at"]);timestamp.textContent=(maskEmail(first(row,["fromEmail","from_email"]))||"Sender address withheld")+" · "+relativeTime(created);timestamp.title=exactTime(created);identity.appendChild(strong);identity.appendChild(timestamp);
      var intent=document.createElement("span");intent.className="intent";intent.appendChild(icon("M4 5h16v14H4zM4 7l8 6 8-6"));intent.appendChild(document.createTextNode(intentLabel(row.intent)));
      head.appendChild(badge);head.appendChild(identity);head.appendChild(intent);card.appendChild(head);

      var grid=document.createElement("div");grid.className="reply-grid";
      var originalPane=document.createElement("div");originalPane.className="message-pane";var originalLabel=document.createElement("div");originalLabel.className="pane-label";originalLabel.appendChild(icon("M4 5h16v14H4zM4 7l8 6 8-6"));originalLabel.appendChild(document.createTextNode("What they wrote"));var subject=document.createElement("div");subject.className="subject";subject.textContent=text(row.subject,"No subject line was kept");var original=document.createElement("p");var originalText=originalReply(row);original.className="reply-quote"+(originalText?" quoted":" unavailable");original.textContent=originalText||"We no longer have the exact words they sent.";originalPane.appendChild(originalLabel);originalPane.appendChild(subject);originalPane.appendChild(original);
      var draftPane=document.createElement("div");draftPane.className="message-pane";var draftLabel=document.createElement("label");var areaId="replyDraft"+index;draftLabel.className="pane-label";draftLabel.htmlFor=areaId;draftLabel.appendChild(icon("M4 20h4L19 9l-4-4L4 16v4M13.5 6.5l4 4"));draftLabel.appendChild(document.createTextNode("Drafted answer · edit before sending"));var area=document.createElement("textarea");area.className="draft-body";area.id=areaId;area.value=text(row.body,"");area.setAttribute("spellcheck","true");area.setAttribute("aria-label","Full drafted reply for "+name);area.addEventListener("input",function(){autoGrow(area);});draftPane.appendChild(draftLabel);draftPane.appendChild(area);grid.appendChild(originalPane);grid.appendChild(draftPane);card.appendChild(grid);

      var actions=document.createElement("div");actions.className="card-actions";var result=document.createElement("div");result.className="result";result.hidden=true;result.setAttribute("role","status");result.setAttribute("aria-live","assertive");
      var key="reply:"+text(row.draftId,String(index));var send=sendButton("Send reply",key,function(button,node){resolveReply(row,button,node,card,area);});var reject=document.createElement("button");reject.type="button";reject.className="action danger";reject.dataset.rejectAction="true";reject.appendChild(icon("M6 6l12 12M18 6L6 18"));reject.appendChild(document.createTextNode("Reject"));reject.addEventListener("click",function(){disarm(key);rejectReply(row,reject,result,card);});actions.appendChild(send);actions.appendChild(reject);actions.appendChild(result);card.appendChild(actions);
      window.setTimeout(function(){autoGrow(area);},0);return card;
    }

    function renderReplies(payload){
      var rows=Array.isArray(payload&&payload.drafts)?payload.drafts:[];state.drafts=rows;replyList.replaceChildren();document.getElementById("pendingCount").textContent=String(Number.isFinite(Number(payload&&payload.pending))?Number(payload.pending):rows.length);replyList.setAttribute("aria-busy","false");
      if(!rows.length){replyList.appendChild(statePanel("No replies yet.","The moment a business owner answers, it lands here."));updateSendAvailability();return;}
      rows.forEach(function(row,index){replyList.appendChild(renderReplyCard(row,index));});updateSendAvailability();
    }

    function loadReplies(){
      replyList.setAttribute("aria-busy","true");
      return api("/api/admin/reply-queue").then(function(payload){renderReplies(payload);return true;}).catch(function(error){
        if(authFailure(error))throw error;
        replyList.replaceChildren(statePanel("Reply queue unavailable",text(error.message,"The protected queue could not be read."),"error"));replyList.setAttribute("aria-busy","false");document.getElementById("pendingCount").textContent="—";return false;
      });
    }

    function heldRows(payload){
      var options=[payload&&payload.drafts,payload&&payload.heldDrafts,payload&&payload.held_drafts,payload&&payload.rows,payload&&payload.items];
      for(var i=0;i<options.length;i+=1)if(Array.isArray(options[i]))return options[i];return [];
    }

    function renderHeldCounts(payload){
      var holder=document.getElementById("heldCounts");var counts=payload&&payload.counts&&typeof payload.counts==="object"?payload.counts:{};holder.replaceChildren();
      Object.keys(counts).forEach(function(key){var chip=document.createElement("span");chip.className="count-chip";var strong=document.createElement("strong");strong.textContent=String(counts[key]);chip.appendChild(strong);chip.appendChild(document.createTextNode(" "+humanWords(key,key)));holder.appendChild(chip);});holder.hidden=!holder.childElementCount;
    }

    function resolveHeld(row,button,result,card){
      var id=text(first(row,["prospectId","prospect_id"]),"");
      setButtonBusy(button,true,"Checking pause…");
      refreshPause().then(function(readable){
        if(!readable||!sendingLive())throw errorWithStatus("sending_halted_or_pause_unreadable",409,{error:"sending_halted_or_pause_unreadable"});
        setButtonBusy(button,true,"Sending through gates…");
        return post("/api/admin/approve-held-drafts",{prospectIds:[id],dryRun:false,confirmation:HELD_SEND_CONFIRMATION});
      }).then(function(payload){
        var sent=Number(payload&&payload.sendsPerformed||0);
        if(payload&&payload.ok===true&&sent>0){setResult(result,"Server confirmed: "+sent+" held draft sent. Every release gate passed.","ok");button.dataset.resolved="true";button.replaceChildren(icon("M5 12l4 4L19 6"),document.createTextNode("Sent"));card.classList.add("resolved");}
        else{setResult(result,"Server refused: "+serverReason(payload),"bad");}
      }).catch(function(error){if(!authFailure(error))setResult(result,"Server refused: "+serverReason(error),"bad");}).finally(function(){setButtonBusy(button,false);if(button.dataset.resolved!=="true")button.replaceChildren(icon("M4 12h13M13 6l6 6-6 6"),document.createTextNode(button.dataset.baseLabel));refreshPause().catch(function(){});});
    }

    function renderHeldCard(row,index){
      var card=document.createElement("article");card.className="held-card";var head=document.createElement("div");head.className="held-card-head";var badge=document.createElement("span");badge.className="initial";badge.setAttribute("aria-hidden","true");var name=text(first(row,["businessName","business_name","prospectName","prospect_name"]),"Held prospect");badge.textContent=initials(name);var identity=document.createElement("div");identity.className="identity";var title=document.createElement("h3");title.textContent=name;var meta=document.createElement("div");meta.className="held-meta";var created=first(row,["createdAt","created_at"]);var bits=[];var grade=text(first(row,["getfoundGrade","getfound_grade"]),"");if(grade)bits.push("grade "+grade);bits.push(relativeTime(created));var recipient=maskEmail(first(row,["recipientEmail","recipient_email","email"]));if(recipient)bits.push(recipient);meta.textContent=bits.join(" · ");meta.title=exactTime(created);identity.appendChild(title);identity.appendChild(meta);head.appendChild(badge);head.appendChild(identity);card.appendChild(head);
      var subject=text(row.subject,"");if(subject){var subjectNode=document.createElement("div");subjectNode.className="subject";subjectNode.style.marginTop="13px";subjectNode.textContent=subject;card.appendChild(subjectNode);}var body=text(first(row,["body","draftBody","draft_body"]),"");var copy=document.createElement("p");copy.className="letter held-copy"+(body?"":" unavailable");copy.textContent=body||"We could not load the words for this one.";card.appendChild(copy);
      var actions=document.createElement("div");actions.className="card-actions";var result=document.createElement("div");result.className="result";result.hidden=true;result.setAttribute("role","status");result.setAttribute("aria-live","assertive");var id=text(first(row,["prospectId","prospect_id"]),"");if(id){var send=sendButton("Release and send", "held:"+id+":"+index,function(button,node){resolveHeld(row,button,node,card);});actions.appendChild(send);}else{setResult(result,"We cannot send this one — the server gave no business to send to.","bad");}actions.appendChild(result);card.appendChild(actions);return card;
    }

    function renderHeld(payload){
      var rows=heldRows(payload);state.heldRows=rows;heldList.replaceChildren();renderHeldCounts(payload);
      if(rows.length){rows.forEach(function(row,index){heldList.appendChild(renderHeldCard(row,index));});heldProgress.textContent="Release check complete. "+rows.length+" held draft"+(rows.length===1?"":"s")+" returned by the server.";}
      else{
        var counts=payload&&payload.counts&&typeof payload.counts==="object"?payload.counts:null;
        var detail=counts?"The release check returned evidence totals but no individual held-draft rows. No send controls are shown.":"No held drafts were returned by the server.";
        heldList.appendChild(statePanel("No held rows returned",detail));heldProgress.textContent="Release check complete. "+detail;
      }
      updateSendAvailability();
    }

    function loadHeldDrafts(){
      if(state.heldBusy)return;
      state.heldBusy=true;loadHeldBtn.disabled=true;loadHeldBtn.classList.add("loading");loadHeldBtn.replaceChildren(icon("M12 3a9 9 0 1 0 9 9"),document.createTextNode("Checking release gates…"));heldProgress.textContent="Checking up to 500 prospects and CallPrep. One request is running; no second request will start.";heldList.replaceChildren();document.getElementById("heldCounts").hidden=true;
      var slow=window.setTimeout(function(){heldProgress.textContent="Still checking release evidence. More than five seconds is normal for this endpoint; the single request is still running.";},5000);
      // Deliberately the only GET of /held-drafts on this page. It is bound to
      // this button and never runs during initial page load or polling.
      api("/api/admin/held-drafts").then(function(payload){renderHeld(payload);}).catch(function(error){
        if(!authFailure(error)){heldList.replaceChildren(statePanel("Held-draft check failed",text(error.message,"The release check did not complete."),"error"));heldProgress.textContent="The server refused or failed the one release-check request: "+serverReason(error);}
      }).finally(function(){window.clearTimeout(slow);state.heldBusy=false;loadHeldBtn.disabled=false;loadHeldBtn.classList.remove("loading");loadHeldBtn.replaceChildren(icon("M12 3v12M7 10l5 5 5-5M5 21h14"),document.createTextNode("Reload held drafts"));});
    }

    function initialLoad(){
      accessButton.disabled=true;accessButton.textContent="Checking access…";accessStatus.textContent="Checking access…";
      return Promise.all([refreshPause(),loadReplies()]).then(function(){hideGate();if(!pausePoll)pausePoll=window.setInterval(function(){if(token()&&!document.hidden)refreshPause().catch(function(){});},30000);}).catch(function(error){if(!authFailure(error)){hideGate();}});
    }

    accessForm.addEventListener("submit",function(event){event.preventDefault();var value=tokenInput.value.trim();if(!value){showGate("Paste the access code first.");return;}setToken(value);initialLoad();});
    loadHeldBtn.addEventListener("click",loadHeldDrafts);
    document.addEventListener("visibilitychange",function(){if(!document.hidden&&token())refreshPause().catch(function(){});});
    window.addEventListener("beforeunload",function(){disarmAll();if(pausePoll)window.clearInterval(pausePoll);});
    if(token())initialLoad();else showGate("");
  })();
  </script>
</body>
</html>`;
