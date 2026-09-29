"use strict";

// Public HTML shell for the standalone campaign status page (/campaign-status).
// Same safety shape as the gallery shell: this page contains NO sensitive
// data — the admin token is entered in-browser, kept in localStorage, and sent
// only as an x-admin-token header when this page fetches its own JSON flavor
// (?format=json). All real data stays behind the admin gate.
//
// The brand frame (ink banner, inline W mark, gradient shelf, table recipe) is
// copied inline from the operator deck treatment (lib/dashboard-html.js, PR
// #609) on purpose: no linked assets, so the page cannot 404 its own identity
// during a deploy gap.

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="15" />
  <meta name="robots" content="noindex" />
  <title>Woodward Campaign Status</title>
  <style>
    :root{
      color-scheme:dark;
      --bg:#08080B; --ink:#F2F2F5; --muted:#9B9AA4; --faint:#6F6E79;
      --line:rgba(255,255,255,.07); --line2:rgba(255,255,255,.14);
      --cyan:#4A6CF7; --volt:#DFFF5A; --violet:#8B5CF6;
      --go:#34D399; --hold:#E0A44A; --stop:#F26D6D;
      --panel:linear-gradient(150deg,rgba(255,255,255,.09),rgba(255,255,255,.028));
      --display:'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif;
      --body:'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif;
      --mono:'IBM Plex Mono',ui-monospace,monospace;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      min-height:100vh;color:var(--ink);font:15px/1.55 var(--body);
      background:
        radial-gradient(60rem 28rem at 85% -8%,rgba(124,108,246,.20),transparent 62%),
        radial-gradient(50rem 30rem at -12% 108%,rgba(74,108,247,.10),transparent 58%),
        var(--bg);
    }
    ::selection{background:rgba(124,108,246,.3)}
    a{color:var(--cyan)}
    main{width:min(980px,calc(100% - 36px));margin:0 auto;padding:40px 0 90px}
    .brandshelf{height:3px;border-radius:3px;background:linear-gradient(90deg,#4A6CF7 0%,#7C6CF6 55%,#34D399 100%);margin-bottom:26px}
    .deckfoot{width:min(980px,calc(100% - 36px));margin:0 auto;padding:0 0 34px;color:var(--faint);font:12px var(--mono);display:flex;align-items:center;gap:10px}
    .deckfoot .wmark{width:20px;height:20px;border-radius:6px;flex:0 0 auto;display:block}
    .deckfoot b{color:var(--muted);font-weight:600}
    .topline{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:26px}
    .eyeline{display:flex;align-items:center;gap:9px;color:var(--cyan);font:700 11px/1 var(--mono);letter-spacing:.2em;text-transform:uppercase}
    .eyeline .wmark{width:20px;height:20px;border-radius:6px;flex:0 0 auto;display:block}
    h1{font-family:var(--display);font-size:clamp(30px,4.5vw,46px);line-height:.98;letter-spacing:-.03em;margin-top:10px}
    .subline{color:var(--muted);font-size:13.5px;margin-top:10px;max-width:620px}
    .stamp{text-align:right;font:12px var(--mono);color:var(--faint);display:grid;gap:8px;justify-items:end}
    .chip{display:inline-flex;align-items:center;gap:7px;font:600 10.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:5px 11px;border-radius:999px;border:1px solid;white-space:nowrap}
    .chip i{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
    .chip.go{color:var(--go);border-color:rgba(95,230,174,.42);background:rgba(95,230,174,.08)}
    .chip.hold{color:var(--hold);border-color:rgba(255,197,85,.42);background:rgba(255,197,85,.08)}
    .chip.stop{color:var(--stop);border-color:rgba(255,138,118,.42);background:rgba(255,138,118,.08)}
    .chip.live i{animation:pulse 2.4s ease-in-out infinite}
    @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}
    h2{font-family:var(--display);font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:30px 0 12px;display:flex;align-items:center;gap:10px}
    h2::after{content:"";flex:1;height:1px;background:var(--line)}
    .panel{border:1px solid var(--line);border-radius:22px;background:var(--panel);box-shadow:0 22px 70px rgba(0,0,0,.35);backdrop-filter:blur(16px);padding:20px 22px}
    .panel>header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
    .panel h3{font-family:var(--display);font-size:16px;font-weight:500;letter-spacing:.01em;word-break:break-all}
    .meta{font:12px var(--mono);color:var(--faint);display:flex;flex-wrap:wrap;gap:14px;margin-top:4px}
    .meta b{color:var(--muted);font-weight:500}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{font:600 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--faint);text-align:left;padding:6px 10px;border-bottom:1px solid var(--line2)}
    td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
    tr:last-child td{border:0}
    td.mono,.mono{font:11.5px var(--mono);color:var(--muted);white-space:nowrap}
    td .tplus{color:var(--volt);font-weight:600}
    .tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:4px}
    .tile{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:rgba(255,255,255,.025)}
    .tile b{display:block;font-family:var(--display);font-size:26px;font-weight:600;letter-spacing:-.01em}
    .tile span{font:600 9.5px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
    .tile.go b{color:var(--go)}
    .tile.hold b{color:var(--hold)}
    .tile.stop b{color:var(--stop)}
    .drawbar{height:10px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid var(--line);overflow:hidden;display:flex;margin-top:12px}
    .drawbar .banked{background:linear-gradient(90deg,#4A6CF7,#7C6CF6);height:100%}
    .drawbar .fresh{background:linear-gradient(90deg,#2FA97A,#34D399);height:100%;margin-left:2px}
    .drawkey{display:flex;gap:16px;margin-top:9px;font:11px var(--mono);color:var(--muted)}
    .drawkey i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:-1px}
    .empty{padding:22px 8px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6}
    .empty b{display:block;font-family:var(--display);font-weight:500;color:var(--ink);font-size:14.5px;margin-bottom:5px}
    .foot-note{color:var(--faint);font:11.5px var(--mono);margin-top:14px;padding-top:11px;border-top:1px dashed var(--line)}
    /* Operator gate — the gallery's access pattern, verbatim in spirit. */
    .access{position:fixed;inset:0;z-index:40;display:grid;place-items:center;background:rgba(4,4,6,.72);backdrop-filter:blur(9px)}
    .access[hidden]{display:none}
    .access-card{width:min(460px,calc(100% - 32px));border:1px solid var(--line2);border-radius:24px;background:linear-gradient(150deg,rgba(255,255,255,.09),rgba(255,255,255,.03));padding:30px;box-shadow:0 28px 90px rgba(0,0,0,.5)}
    .access-card h2{margin:0 0 8px;font-family:var(--display);font-size:22px;text-transform:none;letter-spacing:-.01em;color:var(--ink)}
    .access-card p{color:var(--muted);font-size:13.5px;margin-bottom:14px}
    .access-card input{width:100%;font:14px var(--mono);color:var(--ink);background:rgba(0,0,0,.35);border:1px solid var(--line2);border-radius:12px;padding:12px 14px;margin-bottom:12px}
    .access-card button{width:100%;font:600 12px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#0B0B0F;background:linear-gradient(90deg,#DFFF5A,#B8E04A);border:0;border-radius:12px;padding:13px;cursor:pointer}
    .access-card button:disabled{opacity:.55;cursor:wait}
    .access-status{min-height:18px;color:var(--stop);font-size:12.5px;margin:10px 0 0}
    code{color:var(--volt);background:rgba(223,255,90,.07);border:1px solid rgba(223,255,90,.2);border-radius:6px;padding:1px 6px;font-size:12px}
    @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
    @media (max-width:760px){.tiles{grid-template-columns:repeat(2,1fr)}.stamp{text-align:left;justify-items:start}}
  </style>
</head>
<body>
  <main>
    <div class="brandshelf" role="presentation" aria-hidden="true"></div>
    <div class="topline">
      <div>
        <p class="eyeline"><svg class="wmark" viewBox="0 0 64 64" role="img" aria-label="WSS Labs"><defs><linearGradient id="wssCampEyelineG" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6CF7"></stop><stop offset="1" stop-color="#8B5CF6"></stop></linearGradient></defs><rect width="64" height="64" rx="15" fill="#131318"></rect><rect x="0.5" y="0.5" width="63" height="63" rx="14.5" fill="none" stroke="#FFFFFF" stroke-opacity="0.09"></rect><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#wssCampEyelineG)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="7" fill="#34D399" opacity="0.22"></circle><circle cx="50" cy="20" r="4" fill="#34D399"></circle></svg>WSS Labs &middot; Campaign Status</p>
        <h1>The current campaign, on the clock.</h1>
        <p class="subline">The newest non-halted Line batch &mdash; stopwatch deltas straight from the durable batch record, never dashboard impressions. The token lives in this browser and is never put in the URL.</p>
      </div>
      <div class="stamp">
        <span id="liveChip" class="chip hold"><i></i>loading</span>
        <span id="stampClock">&mdash;</span>
        <span>auto-refresh 15s</span>
      </div>
    </div>

    <div id="content" aria-live="polite">
      <section class="panel" id="summaryPanel">
        <header><h3>Loading campaign status</h3></header>
        <div class="empty">Reading the durable batch record&hellip;</div>
      </section>
    </div>
  </main>

  <div class="access" id="accessGate" role="dialog" aria-modal="true" aria-labelledby="accessTitle" hidden>
    <form class="access-card" id="accessForm">
      <h2 id="accessTitle">Operator access</h2>
      <p>Paste your admin token to open the campaign status page. It stays in this browser only.</p>
      <input id="tokenInput" type="password" autocomplete="current-password" aria-label="Admin token" required>
      <button id="accessButton" type="submit">Open campaign status</button>
      <p class="access-status" id="accessStatus" role="alert" aria-live="polite"></p>
    </form>
  </div>

  <footer class="deckfoot"><svg class="wmark" viewBox="0 0 64 64" role="img" aria-label="WSS Labs" style="background:#131318"><defs><linearGradient id="wssCampFootG" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6CF7"></stop><stop offset="1" stop-color="#8B5CF6"></stop></linearGradient></defs><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#wssCampFootG)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="4" fill="#34D399"></circle></svg><span><b>WSS Labs</b> &mdash; American AI web studio &#127482;&#127480;</span></footer>

  <script>
  (function(){
    "use strict";
    // Same browser slot as the gallery (wsl_admin_token): one operator token,
    // every operator page. The token NEVER enters the URL — the JSON flavor is
    // fetched with an x-admin-token header, exactly like the gallery's gate.
    var KEY="wsl_admin_token";
    var POLL_MS=15000;
    var content=document.getElementById("content");
    var accessGate=document.getElementById("accessGate");
    var accessForm=document.getElementById("accessForm");
    var accessButton=document.getElementById("accessButton");
    var tokenInput=document.getElementById("tokenInput");
    var accessStatus=document.getElementById("accessStatus");
    var liveChip=document.getElementById("liveChip");
    var stampClock=document.getElementById("stampClock");

    function token(){try{return localStorage.getItem(KEY)||"";}catch(_){return "";}}
    function setToken(value){try{localStorage.setItem(KEY,value);}catch(_){}}
    function clearToken(){try{localStorage.removeItem(KEY);}catch(_){}}

    function esc(value){
      return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    // T+mm:ss — the same truncating formatter the server uses, so the two can
    // never disagree about a delta.
    function tplus(ms){
      if(!isFinite(ms)||ms<0)return "&mdash;";
      var totalSeconds=Math.floor(ms/1000);
      var minutes=Math.floor(totalSeconds/60);
      var seconds=totalSeconds%60;
      return "T+"+(minutes<10?"0":"")+minutes+":"+(seconds<10?"0":"")+seconds;
    }

    function clock(iso){
      if(!iso)return "&mdash;";
      var parsed=Date.parse(String(iso));
      if(!isFinite(parsed))return "&mdash;";
      try{
        var d=new Date(parsed);
        return d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())+" "+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+":"+pad(d.getUTCSeconds())+"Z";
      }catch(_){return "&mdash;";}
    }

    function pad(n){return (n<10?"0":"")+n;}

    function fetchStatus(){
      var url=new URL(window.location.href);
      url.searchParams.set("format","json");
      return fetch(url.toString(),{
        headers:{"x-admin-token":token(),"Accept":"application/json"},
        cache:"no-store"
      }).then(function(response){
        return response.text().then(function(raw){
          var payload={};
          try{payload=raw?JSON.parse(raw):{};}catch(_){payload={message:raw};}
          if(!response.ok){
            var error=new Error(payload.error||payload.message||("Request failed ("+response.status+")"));
            error.status=response.status;
            throw error;
          }
          return payload;
        });
      });
    }

    function showGate(message){
      accessGate.hidden=false;
      accessStatus.textContent=message||"";
      accessButton.disabled=false;
      accessButton.textContent="Open campaign status";
      window.setTimeout(function(){tokenInput.focus();},0);
    }

    function statusChip(status){
      var normalized=String(status||"").toLowerCase();
      if(normalized==="done")return '<span class="chip go"><i></i>'+esc(status)+"</span>";
      if(normalized==="approved"||normalized==="sending")return '<span class="chip go live"><i></i>'+esc(status)+"</span>";
      if(normalized==="running")return '<span class="chip hold live"><i></i>'+esc(status)+"</span>";
      if(normalized==="halted")return '<span class="chip stop"><i></i>'+esc(status)+"</span>";
      return '<span class="chip hold"><i></i>'+esc(status||"unknown")+"</span>";
    }

    function timingRow(label,iso,delta){
      var cells='<td>'+esc(label)+'</td><td class="mono">'+clock(iso)+"</td>";
      if(delta&&isFinite(delta.ms)&&delta.label){
        cells+='<td class="mono"><span class="tplus">'+esc(delta.label)+"</span></td>";
      }else if(delta){
        cells+='<td class="mono"><span class="tplus">'+tplus(delta.ms===undefined?NaN:delta.ms)+"</span></td>";
      }else{
        cells+='<td class="mono">&mdash;</td>';
      }
      return "<tr>"+cells+"</tr>";
    }

    function timingTable(timing){
      if(!timing){
        return '<div class="empty"><b>No stopwatch record yet.</b>This batch predates the campaign stopwatch (PR #628) or has not persisted its first checkpoint.</div>';
      }
      var deltas=timing.deltas||{};
      return '<table><thead><tr><th>Milestone</th><th>Clock (UTC)</th><th>Since start</th></tr></thead><tbody>'
        +timingRow("Campaign start",timing.startedAt,{ms:0,label:"T+00:00"})
        +timingRow("First qualified",timing.firstQualifiedAt,deltas.firstQualified)
        +timingRow("First built (mirrored)",timing.firstBuiltAt,deltas.firstBuilt)
        +timingRow("First gate passed",timing.firstGateAt,deltas.firstGate)
        +timingRow("First sent",timing.firstSentAt,deltas.firstSent)
        +"</tbody></table>";
    }

    function bankPanel(campaign){
      var bank=campaign.bankDraw;
      var mined=Number(campaign.mined)||0;
      if(!bank){
        return '<div class="empty"><b>No bank draw on this campaign.</b>Every seat on this batch was mined fresh &mdash; '+mined+" mined.</div>";
      }
      var drawn=Number(bank.drawn)||0;
      var total=drawn+mined;
      var bankPct=total>0?Math.round((drawn/total)*100):0;
      var minedPct=total>0?Math.min(100,100-bankPct):0;
      return '<div class="drawbar" role="presentation" aria-hidden="true"><div class="banked" style="width:'+bankPct+'%"></div><div class="fresh" style="width:'+minedPct+'%"></div></div>'
        +'<div class="drawkey"><span><i style="background:#7C6CF6"></i>drawn from bank: <b>'+drawn+'</b></span><span><i style="background:#34D399"></i>mined fresh: <b>'+mined+'</b></span></div>'
        +'<div class="foot-note">bank_draw stage'+(bank.elapsed?" &middot; "+esc(bank.elapsed):"")+(bank.requested!=null?" &middot; asked the bank for "+esc(bank.requested):"")+"</div>";
    }

    function funnelTable(funnel){
      if(!funnel||!funnel.length){
        return '<div class="empty"><b>No funnel stages recorded yet.</b>Stages appear as the batch persists its mine checkpoints.</div>';
      }
      var rows=[];
      for(var i=0;i<funnel.length;i++){
        var stage=funnel[i]||{};
        rows.push("<tr><td>"+esc(stage.stage)+"</td><td>"+esc(stage.mode||"&mdash;")+"</td><td class='mono'>"+(stage.entered==null?"&mdash;":esc(stage.entered))+"</td><td class='mono'>"+(stage.survived==null?"&mdash;":esc(stage.survived))+"</td><td class='mono'>"+(stage.elapsed?'<span class="tplus">'+esc(stage.elapsed)+"</span>":"&mdash;")+"</td></tr>");
      }
      return '<table><thead><tr><th>Stage</th><th>Mode</th><th>Entered</th><th>Survived</th><th>Elapsed</th></tr></thead><tbody>'+rows.join("")+"</tbody></table>";
    }

    function render(payload){
      var campaign=payload&&payload.campaign;
      if(!campaign){
        content.innerHTML='<section class="panel"><header><h3>No active campaign</h3></header><div class="empty"><b>Nothing non-halted is on file.</b>Every recent batch is deliberately parked (halted), or none has started yet. Start one from the console; this page only watches.</div></section>';
        return;
      }
      var counts=campaign.counts||{};
      var meta='<div class="meta">'
        +"<span>lane <b>"+esc(campaign.lane||"&mdash;")+"</b></span>"
        +"<span>target <b>"+esc(campaign.target||"&mdash;")+"</b></span>"
        +"<span>requested <b>"+esc(campaign.requested)+"</b></span>"
        +(campaign.haltReason?"<span>halt <b>"+esc(campaign.haltReason)+"</b></span>":"")
        +"<span>updated <b>"+esc(campaign.updatedAt||"&mdash;")+"</b></span>"
        +"</div>";
      var timing=(campaign.campaignTiming&&campaign.campaignTiming.startedAt)?campaign.campaignTiming:null;
      content.innerHTML=
          '<section class="panel">'
        +'<header><h3 class="mono">'+esc(campaign.batchId)+"</h3>"+statusChip(campaign.status)+"</header>"
        +meta
        +'<div class="tiles" style="margin-top:16px">'
        +'<div class="tile"><b>'+esc(counts.total||0)+"</b><span>total sites</span></div>"
        +'<div class="tile hold"><b>'+esc(counts.working||0)+"</b><span>working</span></div>"
        +'<div class="tile"><b>'+esc(counts.gatePassed||0)+"</b><span>gate passed</span></div>"
        +'<div class="tile go"><b>'+esc(counts.sent||0)+"</b><span>sent</span></div>"
        +'<div class="tile stop"><b>'+esc(counts.failed||0)+"</b><span>failed</span></div>"
        +"</div>"
        +'<div class="foot-note">working = picked/qualified/mirrored &middot; gate passed = gate_passed/ready/queued (email not yet sent) &middot; failed = rejected/gate_failed/error</div>'
        +"</section>"
        +"<h2>Campaign stopwatch</h2>"
        +'<section class="panel">'+timingTable(campaign.campaignTiming)+"</section>"
        +"<h2>Prospect bank &mdash; drawn vs mined</h2>"
        +'<section class="panel">'+bankPanel(campaign)+"</section>"
        +"<h2>Mine funnel &mdash; per-stage elapsed</h2>"
        +'<section class="panel">'+funnelTable(campaign.funnel)+"</section>";
    }

    function load(){
      if(!token()){showGate("");return;}
      fetchStatus().then(function(payload){
        liveChip.className="chip go live";
        liveChip.innerHTML="<i></i>live";
        stampClock.textContent="read "+(payload.serverTime||"")+"";
        render(payload);
      }).catch(function(error){
        if(error&&error.status===401){
          clearToken();
          liveChip.className="chip stop";
          liveChip.innerHTML="<i></i>locked";
          showGate("Token rejected. Enter a current operator token.");
          return;
        }
        liveChip.className="chip stop";
        liveChip.innerHTML="<i></i>source down";
        content.innerHTML='<section class="panel"><header><h3>Status source unavailable</h3></header><div class="empty"><b>The batch store did not answer.</b>'+esc((error&&error.message)||"Unknown error")+". Retrying every 15s.</div></section>";
      });
    }

    accessForm.addEventListener("submit",function(event){
      event.preventDefault();
      var value=tokenInput.value.trim();
      if(!value){accessStatus.textContent="Paste the operator token first.";return;}
      setToken(value);
      accessButton.disabled=true;
      accessButton.textContent="Opening&hellip;";
      load();
      window.setTimeout(function(){
        if(!accessGate.hidden){
          accessButton.disabled=false;
          accessButton.textContent="Open campaign status";
          accessStatus.textContent="That token was rejected.";
        }
      },8000);
    });

    // The token arriving means the gate can close as soon as a read succeeds.
    var gateCloser=setInterval(function(){
      if(token()&&!accessGate.hidden&&liveChip.className.indexOf("go")>-1){
        accessGate.hidden=true;
        clearInterval(gateCloser);
      }
    },500);

    if(token()){
      accessGate.hidden=true;
      load();
    }else{
      showGate("");
    }
    window.setInterval(load,POLL_MS);
  })();
  </script>
</body>
</html>`;

module.exports = PAGE;
