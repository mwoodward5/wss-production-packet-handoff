"use strict";

const { operatorNav } = require("./operator-nav");
const { consoleOrbitHtml } = require("./console-orbit");
// THE OPERATOR'S PLAIN WORDS. Every machine term this page prints for the
// owner resolves through lib/operator-voice so the same status never wears
// two different names on two screens. The data tables are inlined into the
// browser controller below (VOICE_PLAIN / VOICE_STATUS / VOICE_TIPS) so the
// client-side renderers speak the identical dictionary with zero new requests.
const { PLAIN, STATUS, TIPS } = require("./operator-voice");

module.exports = `<!doctype html>
<html lang="en"><head>
<meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WSS Command Center — approved redesign</title>
<style>
  :root{
    --void:#08080B; --carbon:#131318; --carbon-2:#17171d; --ice:#F2F2F5; --slate:#9B9AA4;
    --graphite:#6F6E79; --signal:#7C6CF6; --circuit:#4A6CF7; --pulse:#34D399;
    --sky:#6E8BFF; --ember:#E0A44A; --rose:#F26D6D; --hair:rgba(255,255,255,.07);
    --grad-signal:linear-gradient(135deg,#4A6CF7 0%,#8B5CF6 100%);
    --grad-pulse:linear-gradient(135deg,#0E6B52 0%,#34D399 100%);
    --sans:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    --mono:'IBM Plex Mono','SFMono-Regular',Consolas,Menlo,monospace;
  }
  html{background:var(--void)}
  body{margin:0;background:var(--void);color:var(--ice);font-family:var(--sans);-webkit-font-smoothing:antialiased}
  .wrap{max-width:1180px;margin:0 auto;padding:28px 22px 64px}
  .label{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--graphite)}
  .num{font-variant-numeric:tabular-nums}
  a{color:var(--sky)}
  /* ------- masthead ------- */
  header{display:flex;align-items:center;gap:15px;padding-bottom:22px;border-bottom:1px solid var(--hair)}
  .mark{width:64px;height:64px;border-radius:15px;background:var(--carbon);border:1px solid rgba(255,255,255,.09);flex:none;display:grid;place-items:center}
  .lockup .t{font-size:29px;font-weight:800;letter-spacing:-.025em;line-height:1}
  .lockup .s{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:.4em;color:#8A8994;margin-top:5px}
  .head-right{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
  .pill{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:6px 11px;border-radius:999px;border:1px solid var(--hair);color:var(--slate);white-space:nowrap}
  .pill.live{color:var(--pulse);border-color:rgba(52,211,153,.35)}
  .pill.live::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--pulse);margin-right:7px;vertical-align:1px;animation:beat 2.4s infinite}
  .pill.warn{color:var(--ember);border-color:rgba(224,164,74,.35)}
  .pill.off{color:var(--graphite)}
  @keyframes beat{0%,100%{opacity:1}50%{opacity:.35}}
  @media (prefers-reduced-motion:reduce){.pill.live::before{animation:none}}
  /* ------- sections ------- */
  section{margin-top:34px}
  .sec-head{display:flex;align-items:baseline;gap:14px;margin-bottom:14px}
  .sec-head h2{font-size:21px;font-weight:700;letter-spacing:-.02em;margin:0}
  .sec-head .label{position:relative;top:-1px}
  /* ------- assembly line (hero) ------- */
  .line{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
  @media(max-width:900px){.line{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:560px){.line{grid-template-columns:repeat(2,1fr)}}
  .stage{background:var(--carbon);border:1px solid var(--hair);border-radius:16px;padding:18px 16px;position:relative}
  .stage .metric{font-size:30px;font-weight:700;margin:8px 0 2px}
  .stage .sub{font-size:12.5px;color:var(--slate);line-height:1.45}
  .stage.gate{border-color:rgba(124,108,246,.4)}
  .stage.gate::after{content:"RENDER GATE";position:absolute;top:-9px;right:12px;font-family:var(--mono);font-size:9px;letter-spacing:.14em;color:var(--signal);background:var(--void);padding:0 6px}
  .flow{height:3px;border-radius:2px;background:var(--grad-pulse);margin:14px 0 0;opacity:.55}
  /* ------- launch ------- */
  .launch{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px;align-items:stretch;min-width:0}
  .launch>*{min-width:0;max-width:100%;box-sizing:border-box}
  .launch #laneMode{grid-column:span 3}
  .launch #mineVertical{grid-column:span 3}
  .launch #mineLocation{grid-column:span 6}
  .launch .launchBtn{grid-column:span 3;width:100%}
  .btn{font-family:var(--sans);font-weight:700;font-size:15px;letter-spacing:-.01em;color:#fff;background:var(--grad-signal);border:none;border-radius:10px;padding:14px 26px;cursor:pointer}
  .btn:hover{filter:brightness(1.08)}
  .btn:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
  .btn.ghost{background:transparent;border:1px solid var(--hair);color:var(--slate);font-weight:600}
  .launch-note{grid-column:1/-1;background:var(--carbon);border:1px solid var(--hair);border-radius:12px;padding:12px 16px;font-size:13px;color:var(--slate);min-width:0;line-height:1.55;overflow-wrap:anywhere}
  .launch-note b{color:var(--ice);font-weight:600}
  code{font-family:var(--mono);font-size:12px;color:var(--sky);background:rgba(110,139,255,.09);padding:1px 6px;border-radius:6px}
  /* ------- panel grid ------- */
  .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}
  .card{background:var(--carbon);border:1px solid var(--hair);border-radius:16px;padding:22px}
  .c4{grid-column:span 4}.c6{grid-column:span 6}.c8{grid-column:span 8}.c12{grid-column:span 12}
  @media(max-width:900px){.c4,.c6,.c8{grid-column:span 12}}
  .card h3{margin:0 0 4px;font-size:16.5px;font-weight:700;letter-spacing:-.015em}
  .card .why{font-size:12.5px;color:var(--graphite);margin:0 0 14px;line-height:1.5}
  .row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--hair);font-size:13.5px}
  .row:first-of-type{border-top:none}
  .row .k{color:var(--slate)}
  .row .v{font-family:var(--mono);font-size:12px;text-align:right}
  .ok{color:var(--pulse)} .warn{color:var(--ember)} .bad{color:var(--rose)} .mut{color:var(--graphite)}
  .bar{height:6px;border-radius:3px;background:var(--carbon-2);overflow:hidden;margin-top:6px}
  .bar i{display:block;height:100%;border-radius:3px;background:var(--grad-pulse)}
  /* funnel rows */
  .fr{display:grid;grid-template-columns:150px 1fr 64px;gap:12px;align-items:center;padding:6px 0;font-size:13px}
  .fr .fb{height:10px;border-radius:5px;background:var(--grad-signal);opacity:.9}
  .fr .fk{color:var(--slate)} .fr .fv{font-family:var(--mono);font-size:12px;text-align:right;color:var(--ice)}
  footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--hair);display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between;font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--graphite)}
</style>
<style>
  [hidden]{display:none!important}
  .wrap.locked{filter:blur(8px);pointer-events:none;user-select:none}
  .access{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:rgba(8,8,11,.76);backdrop-filter:blur(10px)}
  .access-card{width:min(410px,100%);box-sizing:border-box;background:var(--carbon);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
  .access-card h1{font-size:22px;letter-spacing:-.02em;margin:0 0 8px}
  .access-card p{color:var(--slate);font-size:13px;line-height:1.5;margin:0 0 16px}
  .access-card input{width:100%;box-sizing:border-box;border:1px solid var(--hair);border-radius:10px;background:var(--void);color:var(--ice);padding:13px 14px;font-family:var(--mono);font-size:13px;margin-bottom:10px}
  .access-card .btn{width:100%}
  .access-status{min-height:18px;margin-top:10px!important;color:var(--rose)!important}
  .btn:disabled{cursor:wait;filter:saturate(.45);opacity:.62}
  .btn:disabled:not(.busy){cursor:not-allowed}
  /* ---- living map ---- */
  .map-h{display:flex;align-items:baseline;gap:14px;margin:4px 0 18px}
  .map-h h2{font-size:21px;font-weight:700;letter-spacing:-.02em;margin:0}
  /* The tile grid and its three floating grey dashes are retired — see THE
     CIRCUIT below, which wires the same six systems together for real. */
  .map-drill{margin-top:18px;background:var(--carbon);border:1px solid var(--hair);border-radius:16px;padding:20px}
  .map-drill h3{margin:0 0 3px;font-size:16.5px;font-weight:700;letter-spacing:-.015em}
  .map-drill .why{font-size:12.5px;color:var(--graphite);margin:0 0 14px;line-height:1.5}
  .mine-field{font-family:var(--sans);font-size:14px;color:var(--ice);background:var(--carbon);border:1px solid var(--hair);border-radius:10px;padding:12px 14px;min-width:150px}
  .mine-field:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
  /* Blended ops tabs (owner instruction 2026-08-04) — reuses .label's mono/
     uppercase/.16em-tracking language rather than inventing a new type style. */
  .tabbar{display:flex;gap:26px;margin-top:20px;border-bottom:1px solid var(--hair);overflow-x:auto}
  a.tab{text-decoration:none;display:inline-block}
  .tab{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--slate);background:transparent;border:none;border-bottom:2px solid transparent;padding:0 0 12px;margin:0;cursor:pointer;white-space:nowrap}
  .tab:hover{color:var(--ice)}
  .tab.active{color:var(--ice);border-bottom-color:var(--signal)}
  .tab:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
  .tabframe{padding:0;overflow:hidden}
  .tabframe iframe{display:block;width:100%;height:82vh;border:0;background:var(--void)}
  .tabframe .why{padding:22px;margin:0}
  /* ---- THE STOP SWITCH --------------------------------------------------
     An emergency control, not a settings row. It is full-bleed, it sits above
     the tab bar so it is on EVERY tab, and it is sticky so it cannot scroll
     out of reach mid-run. Its state comes from the server on every poll — no
     localStorage, nothing this page could invent. */
  .halt{position:sticky;top:0;z-index:15;display:grid;grid-template-columns:16px 1fr auto;
        gap:10px 14px;align-items:center;margin:0 -22px;padding:14px 22px;
        background:var(--carbon);border-bottom:1px solid var(--hair)}
  .halt[data-halt="halted"]{background:linear-gradient(180deg,#3b1519,#220d10);border-bottom-color:var(--rose)}
  .halt[data-halt="unknown"],.halt[data-halt="error"]{background:linear-gradient(180deg,#2c2411,#1a1509);border-bottom-color:var(--ember)}
  .halt-lamp{width:16px;height:16px;border-radius:50%;background:var(--pulse);box-shadow:0 0 0 4px rgba(52,211,153,.14)}
  .halt[data-halt="halted"] .halt-lamp{background:var(--rose);box-shadow:0 0 0 4px rgba(242,109,109,.2)}
  .halt[data-halt="unknown"] .halt-lamp,.halt[data-halt="error"] .halt-lamp{background:var(--ember);box-shadow:0 0 0 4px rgba(224,164,74,.2)}
  .halt-title{font-size:16px;font-weight:800;letter-spacing:-.01em}
  .halt[data-halt="halted"] .halt-title{color:var(--rose)}
  .halt[data-halt="unknown"] .halt-title,.halt[data-halt="error"] .halt-title{color:var(--ember)}
  .halt-sub{font-size:12.5px;color:var(--slate);margin-top:3px;line-height:1.45}
  .halt-btn{font-family:var(--sans);font-weight:800;font-size:14px;letter-spacing:.04em;color:#fff;
            background:var(--rose);border:none;border-radius:10px;padding:14px 22px;cursor:pointer;white-space:nowrap}
  .halt-btn:disabled{cursor:wait;opacity:.55}
  .halt-btn:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
  .halt-btn.armed{background:#fff;color:#7f1d1d;outline:3px solid var(--rose);outline-offset:2px}
  .halt-btn.resume{background:transparent;border:1px solid var(--pulse);color:var(--pulse)}
  .halt-scope{grid-column:2/-1;font-size:12px;color:var(--graphite);line-height:1.5}
  .halt-scope b{color:var(--slate);font-weight:700}
  .halt-out{grid-column:2/-1;font-family:var(--mono);font-size:12px;line-height:1.5;border-radius:10px;
            padding:9px 12px;border:1px solid var(--hair);background:rgba(255,255,255,.03);white-space:pre-wrap}
  .halt-out[hidden]{display:none!important}
  .halt-out.bad{border-color:var(--rose);background:rgba(242,109,109,.1);color:#ffd9d9}
  .halt-out.ok{border-color:var(--pulse);background:rgba(52,211,153,.09);color:#cdf5e6}
  /* One line under the halt bar when finished sites wait on the owner. */
  .ready-banner{display:flex;align-items:center;gap:10px;margin:12px 0 0;padding:12px 16px;border:1px solid rgba(52,211,153,.35);border-radius:12px;background:rgba(52,211,153,.08);color:var(--pulse);font:700 14px var(--sans);text-decoration:none}
  .ready-banner:hover{border-color:var(--pulse)}
  .ready-banner::after{content:"\\2192";margin-left:auto}
  @media(max-width:640px){.halt{grid-template-columns:16px 1fr;margin:0 -16px;padding:12px 16px}
    .halt-btn{grid-column:1/-1;width:100%}}
  .tabframe .retry{margin:0 22px 22px}
  /* ---- Morning Report: measured digest at the top of Operations -------- */
  .morning-report,.morning-report *{box-sizing:border-box;min-width:0}
  .morning-report{margin:0 0 12px;overflow:hidden}
  .mr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}
  .mr-head h2{font-size:21px;font-weight:700;letter-spacing:-.02em;margin:4px 0 3px}
  .mr-window{font-family:var(--mono);font-size:10px;line-height:1.55;color:var(--graphite);margin:0;overflow-wrap:anywhere}
  .mr-refresh{flex:none;padding:9px 14px;font-size:12px}
  .mr-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:14px}
  .mr-metric{background:var(--carbon-2);border:1px solid var(--hair);border-radius:12px;padding:13px}
  .mr-metric b{display:block;font-size:24px;line-height:1;font-weight:750;font-variant-numeric:tabular-nums}
  .mr-metric span{display:block;margin-top:7px;font-size:11px;line-height:1.35;color:var(--slate)}
  .mr-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .mr-block{margin:0;border:1px solid var(--hair);border-radius:12px;padding:14px;background:var(--carbon-2)}
  .mr-block h3{font-size:14px;margin:0 0 10px}
  .mr-kv{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--hair);font-size:12px;line-height:1.45}
  .mr-kv:first-of-type{border-top:0;padding-top:0}
  .mr-kv .mr-key{color:var(--slate)}
  .mr-kv .mr-value{font-family:var(--mono);font-size:11px;text-align:right;overflow-wrap:anywhere}
  .mr-list{list-style:none;padding:0;margin:0}
  .mr-list li{padding:7px 0;border-top:1px solid var(--hair);font-size:12px;line-height:1.45;overflow-wrap:anywhere}
  .mr-list li:first-child{border-top:0;padding-top:0}
  .mr-item-count{font-family:var(--mono);font-size:10px;color:var(--slate);margin-left:7px}
  .mr-reasons{display:block;color:var(--graphite);font-size:11px;margin-top:3px}
  .mr-empty,.mr-status{font-size:12.5px;line-height:1.5;color:var(--graphite)}
  .mr-status{padding:4px 0}
  .mr-notes{grid-column:1/-1}
  @media(max-width:700px){.mr-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.mr-detail-grid{grid-template-columns:1fr}}
  @media(max-width:480px){.morning-report{padding:16px}.mr-head{display:grid}.mr-refresh{width:100%}}
</style>
<style>
  /* ============ THE LINE, AS A PICTURE =============================
     Owner instruction 2026-08-06: "visually make this better showing
     less words and more graphic design and visual motion." Additive
     only — the approved sheet at the top of this file is byte-pinned
     by console-operability.test.js and is not touched. Tokens are
     reused rather than reinvented: --pulse moved, --ember waiting on
     you or stopped moving, --rose refused, --signal the render gate.

     MOTION LAW. Nothing here animates on its own initiative. A
     segment travels only while the SERVER reports the batch running
     AND that row is the one the runner last touched AND that touch is
     inside STALL_MS. When a row stops moving the animation STOPS and
     the segment turns ember — a stalled build looks stalled, which is
     the whole point, because the known failure mode of this line is a
     build that parks at capture_mobile and never errors. The one-shot
     .gain flare marks a stage a row actually gained between two
     polls: observed motion, never decorative. */

  .bstack{display:flex;flex-direction:column;gap:12px;margin:2px 0 4px}
  .bcard{border:1px solid var(--hair);border-radius:14px;background:var(--carbon-2);overflow:hidden}
  .bcard.stalled{border-color:rgba(224,164,74,.32)}
  .bcard.halted{border-color:rgba(242,109,109,.34)}
  .bempty{padding:24px 6px;color:var(--graphite);font-size:13px}

  /* batch head — the target in plain words, the machine's id in small mono */
  .bhead{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px 11px}
  .btarget{font-size:17px;font-weight:700;letter-spacing:-.02em}
  .bid{font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--graphite)}
  .bchips{margin-left:auto;display:flex;gap:7px;align-items:center;flex-wrap:wrap}
  .chip{font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;
        padding:5px 9px;border-radius:999px;border:1px solid var(--hair);color:var(--slate);white-space:nowrap}
  .chip.go{color:var(--pulse);border-color:rgba(52,211,153,.35)}
  .chip.go::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;
        background:var(--pulse);margin-right:6px;vertical-align:1px;animation:beat 1.6s infinite}
  .chip.hold{color:var(--ember);border-color:rgba(224,164,74,.4)}
  .chip.stop{color:var(--rose);border-color:rgba(242,109,109,.4)}
  .chip.lane{color:var(--rose);border-color:rgba(242,109,109,.5)}
  /* the campaign clock — the batch's own stamped stopwatch as one monospace
     line under the head. Only a batch carrying a timing record earns it. */
  .bclock{padding:0 16px 10px;color:var(--slate);font:500 10.5px/1.6 var(--mono);letter-spacing:.03em;font-variant-numeric:tabular-nums}
  .bbody{padding:0 16px 14px}

  /* the rail — the pipeline drawn as a pipeline */
  .railrow{display:flex;align-items:stretch}
  .rail{flex:1;display:grid;align-items:stretch;
        grid-template-columns:1fr 18px 1fr 18px 1fr 18px 1fr 18px 1fr 18px 1fr}
  .rnode{background:rgba(255,255,255,.022);border:1px solid var(--hair);border-radius:10px;padding:9px 6px;text-align:center}
  .rnode.hot{border-color:rgba(52,211,153,.34);background:rgba(52,211,153,.055)}
  .rnode.gate{border-color:rgba(124,108,246,.4)}
  .rnode.gate.hot{background:rgba(124,108,246,.1)}
  .rlab{display:block;font-family:var(--mono);font-size:9px;letter-spacing:.14em;color:var(--graphite)}
  .rnum{display:block;font-size:19px;font-weight:700;margin-top:2px;line-height:1.1}
  .rnode.hot .rnum{color:var(--pulse)}
  .rnode.gate.hot .rnum{color:var(--signal)}
  .rdead{flex:none;min-width:84px;margin-left:9px}
  .rdead.hot{border-color:rgba(242,109,109,.4);background:rgba(242,109,109,.07)}
  .rdead.hot .rnum{color:var(--rose)}
  .rlink{display:flex;align-items:center;justify-content:center;overflow:hidden}
  .rlink i{display:block;width:9px;height:2px;border-radius:2px;background:var(--graphite);opacity:.3}
  .rlink.on i{background:var(--pulse);opacity:1;animation:hop 1.05s ease-in-out infinite}
  .rlink.stall i{background:var(--ember);opacity:.85}
  @keyframes hop{0%{transform:translateX(-6px);opacity:0}35%{opacity:1}100%{transform:translateX(6px);opacity:0}}

  /* one lead = one card. The name is the only thing set in big type. */
  .lead{display:flex;gap:14px;align-items:center;padding:11px 13px;margin-top:8px;border-radius:11px;
        background:rgba(255,255,255,.018);border:1px solid var(--hair);transition:border-color .15s}
  .lead:hover{border-color:rgba(255,255,255,.14)}
  .lead.act{box-shadow:inset 3px 0 0 var(--signal)}
  .lead.hold{box-shadow:inset 3px 0 0 var(--ember)}
  .lead.done{box-shadow:inset 3px 0 0 var(--pulse)}
  .lead.stall{box-shadow:inset 3px 0 0 var(--ember);border-color:rgba(224,164,74,.3)}
  /* FAILURE READS DIFFERENTLY WITHOUT BEING READ: rose edge, rose wash,
     hatched thumbnail, broken track. No word is required to see it. */
  .lead.dead{box-shadow:inset 3px 0 0 var(--rose);border-color:rgba(242,109,109,.22);
        background:linear-gradient(90deg,rgba(242,109,109,.085),rgba(255,255,255,.012) 45%)}
  .lbody{flex:1;min-width:0}
  .lhead{display:flex;align-items:center;gap:12px}
  .lname{flex:1;min-width:0;font-size:15px;font-weight:700;letter-spacing:-.012em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lwhere{font-size:11.5px;color:var(--graphite);margin:2px 0 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lmark{flex:none;font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;
        padding:5px 9px;border-radius:999px;border:1px solid var(--hair);color:var(--slate);white-space:nowrap}
  .lmark.ok{border-color:rgba(52,211,153,.4)}
  .lmark.warn{border-color:rgba(224,164,74,.4)}
  .lmark.bad{border-color:rgba(242,109,109,.42)}

  /* the six-stage track: picked · qualified · mirrored · gated · queued · sent */
  .track{display:flex;gap:3px;align-items:center;max-width:560px}
  .seg{flex:1;height:8px;border-radius:2px;background:rgba(255,255,255,.06);position:relative;overflow:hidden}
  .seg.on{background:linear-gradient(90deg,#1C7A5C,#34D399)}
  .seg.now{background:rgba(52,211,153,.14)}
  .seg.now::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
        background:linear-gradient(90deg,transparent,rgba(52,211,153,.95),transparent);animation:travel 1.15s linear infinite}
  .seg.now.stall{background:repeating-linear-gradient(45deg,rgba(224,164,74,.34) 0 4px,rgba(224,164,74,.06) 4px 8px)}
  .seg.now.stall::after{display:none}
  .seg.broke{background:repeating-linear-gradient(45deg,rgba(242,109,109,.5) 0 4px,rgba(242,109,109,.1) 4px 8px)}
  .seg.gain{animation:flare .9s ease-out 1}
  @keyframes travel{to{transform:translateX(100%)}}
  @keyframes flare{0%{filter:brightness(2.4);box-shadow:0 0 0 0 rgba(52,211,153,.7)}
                   100%{filter:brightness(1);box-shadow:0 0 0 8px rgba(52,211,153,0)}}
  .stallnote{display:inline-block;margin-top:7px;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--ember)}
  .waitnote{display:inline-block;margin-top:7px;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--graphite)}
  .shotimg{display:block;width:100%;height:100%;object-fit:cover;object-position:top;background:#0C0C10}
  .kebab{position:relative;margin-left:auto;flex:none}
  .kbtn{background:transparent;border:1px solid var(--hair);border-radius:7px;color:var(--slate);
    width:26px;height:26px;line-height:1;font-size:15px;cursor:pointer}
  .kbtn:hover{color:var(--ice);border-color:rgba(255,255,255,.2)}
  .kebab.open .kbtn{color:var(--ice);border-color:var(--signal)}
  .kmenu{display:none;position:absolute;right:0;top:30px;z-index:40;min-width:172px;
    background:var(--carbon);border:1px solid rgba(255,255,255,.12);border-radius:9px;
    padding:5px;box-shadow:0 10px 28px rgba(0,0,0,.55)}
  .kebab.open .kmenu{display:block}
  .kmenu a,.kmenu button{display:block;width:100%;text-align:left;background:transparent;border:0;
    color:var(--ice);font:500 12px var(--sans);padding:7px 9px;border-radius:6px;cursor:pointer;text-decoration:none}
  .kmenu a:hover,.kmenu button:hover{background:rgba(124,108,246,.14)}

  /* THE PRODUCT. A finished mirror shows the mirror, live, from our own
     host — not a URL and not a third-party screenshot service. */
  .shot{position:relative;display:block;width:180px;height:116px;border-radius:9px;overflow:hidden;
        border:1px solid var(--hair);flex:none;
        background:repeating-linear-gradient(45deg,rgba(255,255,255,.035) 0 6px,transparent 6px 12px)}
  /* A frame that has not painted yet must not read as "your finished site is
     black". It stays the same hatch as a lead with no site at all until its
     own load event fires, and only then does the mirror appear. */
  .shotframe{width:1260px;height:812px;border:0;background:#0C0C10;pointer-events:none;
        transform:scale(.1428);transform-origin:0 0;opacity:0;transition:opacity .25s}
  .shot.on{background:#0C0C10}
  .shot.on .shotframe{opacity:1}
  .shot .veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 58%,rgba(0,0,0,.4));
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
  .shot:hover .veil{background:linear-gradient(180deg,rgba(124,108,246,.12),rgba(0,0,0,.45))}
  .shot:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
  .shotnone{position:relative;display:block;width:180px;height:116px;border-radius:9px;flex:none;overflow:hidden;
        border:1px solid var(--hair);background:repeating-linear-gradient(45deg,rgba(255,255,255,.035) 0 6px,transparent 6px 12px)}
  .shotnone.act::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
        background:linear-gradient(105deg,transparent,rgba(124,108,246,.26),transparent);animation:travel 1.7s linear infinite}
  .shotnone.stall{border-color:rgba(224,164,74,.35);
        background:repeating-linear-gradient(45deg,rgba(224,164,74,.18) 0 6px,transparent 6px 12px)}
  .shotnone.bad{border-color:rgba(242,109,109,.3);
        background:repeating-linear-gradient(45deg,rgba(242,109,109,.16) 0 6px,transparent 6px 12px)}

  /* the machine's own vocabulary — reachable, never the headline */
  .dx{margin-top:9px}
  .dx summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;
        font-family:var(--mono);font-size:10px;letter-spacing:.13em;color:var(--graphite)}
  .dx summary::-webkit-details-marker{display:none}
  .dx summary::before{content:"\\203A";display:inline-block;transition:transform .15s}
  .dx[open] summary::before{transform:rotate(90deg)}
  .dx summary:hover{color:var(--ice)}
  .dx summary:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
  .dxb{margin-top:8px;padding:10px 12px;border-radius:9px;border:1px solid var(--hair);
        background:rgba(255,255,255,.03);font-family:var(--mono);font-size:11px;line-height:1.65;color:var(--slate);overflow-x:auto}
  .fchip{display:inline-block;font-family:var(--mono);font-size:10px;padding:2px 7px;border-radius:6px;
        margin:3px 5px 0 0;border:1px solid var(--hair);color:var(--slate)}
  .fchip.bad{border-color:rgba(242,109,109,.38)}

  /* where the candidates died, as bars instead of a sentence */
  .mfun{margin-top:13px;display:flex;flex-direction:column;gap:3px}
  .mcap{font-family:var(--mono);font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--graphite);margin-bottom:5px}
  .mrow{display:grid;grid-template-columns:158px 1fr 46px;gap:10px;align-items:center}
  .mlab{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--graphite);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mbar{display:flex;height:7px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.04)}
  .mbar i{display:block;height:100%;background:var(--grad-signal)}
  .mbar u{display:block;height:100%;background:rgba(242,109,109,.42)}
  .mnum{font-family:var(--mono);font-size:10.5px;text-align:right;color:var(--slate)}
  /* WHY they died. The bar says how many; these say what killed them. Second
     grid row of the same .mrow, aligned under the bar. */
  .mkill{grid-column:2/-1;display:flex;flex-wrap:wrap;gap:4px;margin:0 0 5px}
  .kchip{font-family:var(--mono);font-size:9px;letter-spacing:.05em;padding:1px 6px;border-radius:5px;
        border:1px solid rgba(242,109,109,.28);background:rgba(242,109,109,.06);color:var(--graphite);white-space:nowrap}
  .kchip b{font-weight:600;color:var(--rose);margin-left:5px}

  /* the hero flow bar under the assembly line, driven by real batch state */
  .flow.live{opacity:1;background:linear-gradient(90deg,#0E6B52,#34D399,#0E6B52);background-size:220% 100%;
        animation:sweep 2.6s linear infinite}
  .flow.stall{opacity:.55;background:linear-gradient(90deg,#5A4526,#E0A44A,#5A4526)}
  @keyframes sweep{to{background-position:-220% 0}}

  @media(max-width:760px){
    .rail{grid-template-columns:repeat(3,1fr);gap:6px}
    .rlink{display:none}
    .railrow{flex-direction:column}
    .rdead{margin-left:0;margin-top:6px;min-width:0}
  }
  @media(max-width:620px){
    .lead{gap:11px;padding:11px;align-items:flex-start}
    .shot,.shotnone{width:98px;height:63px}
    .shotframe{transform:scale(.0778)}
    /* The business name gets the whole body width and wraps to two lines
       rather than truncating; the state chip drops beneath it. */
    .lhead{display:block}
    .lname{font-size:13.5px;line-height:1.28;white-space:normal;overflow:hidden;
           display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .lmark{display:inline-block;margin-top:6px}
    .lwhere{margin:6px 0 9px}
    .mrow{grid-template-columns:96px 1fr 34px;gap:7px}
    /* Narrow: the reasons get the full width rather than a 96px stub. */
    .mkill{grid-column:1/-1}
    .btarget{font-size:15.5px}
    .bhead{padding:13px 13px 11px}
    .bbody{padding:0 13px 13px}
  }
  /* Reduced motion: every travelling/one-shot animation is replaced by a
     STATIC state that still distinguishes moving from stalled. */
  @media (prefers-reduced-motion:reduce){
    .seg.now::after{animation:none;transform:none;opacity:.45}
    .seg.gain{animation:none}
    .rlink.on i{animation:none;opacity:1}
    .chip.go::before{animation:none}
    .shotnone.act::after{animation:none;transform:none;opacity:.35}
    .flow.live{animation:none;background:var(--grad-pulse)}
  }
</style>
<style>
  /* ============ THE CREW ==========================================
     Owner request 2026-08-06: "I like seeing what the agents were
     doing and the calls happening." Restores the agents view removed
     in f0ac628, on one condition — it shows only what is true.

     WHY THERE IS NO RADAR HERE. The retired bridge drew a sweeping
     radar with orbiting blips, and the blips were the SAME roster
     whether or not anything was running. Thirteen of those fourteen
     agents have never emitted a single event; nine have never run
     even once. Animating them was the dashboard equivalent of a
     spinner over a dead build, so the sweep, the pulse and the blips
     do not come back.

     THE ONE MOTION RULE. Only .st-active carries the shared "beat"
     keyframe, and an agent earns .st-active only by having emitted
     an event in the last 24h — server-measured, never a client
     guess. Dormant and never-run are deliberately flat and dim: a
     stopped agent must LOOK stopped from across the room. */

  .crew-note{background:var(--carbon);border:1px solid var(--hair);border-radius:12px;padding:13px 16px;
        font-size:12.5px;color:var(--slate);line-height:1.55;margin-bottom:16px}
  .crew-note b{color:var(--ice);font-weight:600}

  /* state dot + word, one vocabulary shared by voice crew and pipeline */
  .st{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10px;
        letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;color:var(--graphite)}
  .st::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
  .st-active{color:var(--pulse)}
  .st-active::before{animation:beat 2.4s infinite}
  .st-recent{color:var(--sky)}
  .st-dormant{color:var(--ember)}
  .st-never{color:var(--graphite);opacity:.7}
  .st-unknown{color:var(--rose)}
  @media (prefers-reduced-motion:reduce){.st-active::before{animation:none}}

  /* --- Riley's calls: one glance first, private artifacts on demand --- */
  .callstack{display:flex;flex-direction:column;gap:10px;min-width:0;max-width:100%;overflow-x:hidden}
  .callstack *{box-sizing:border-box}
  body:has(#tabPanelAgents:not([hidden])) .halt{box-sizing:border-box}
  .call{border:1px solid var(--hair);border-radius:14px;background:var(--carbon-2);overflow:hidden;min-width:0}
  .call-glance{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px 16px}
  .call-avatar{position:relative;display:grid;place-items:center;width:48px;height:48px;border-radius:13px;
        overflow:hidden;background:var(--carbon);border:1px solid var(--hair);color:var(--signal);font-weight:800}
  .call-avatar img{display:block;width:100%;height:100%;object-fit:cover}
  .call-avatar-fallback{display:none;width:100%;height:100%;place-items:center;font-size:16px}
  .call-avatar.is-broken img{display:none}.call-avatar.is-broken .call-avatar-fallback{display:grid}
  .call-identity{min-width:0}
  .call-name{margin:0;color:var(--ice);font-size:15px;font-weight:700;line-height:1.25;overflow-wrap:anywhere}
  .call-facts{display:flex;align-items:center;gap:7px 10px;flex-wrap:wrap;margin-top:5px;color:var(--slate);
        font-family:var(--mono);font-size:10.5px;letter-spacing:.035em}
  .call-fact{display:inline-flex;align-items:center;gap:5px;min-width:0}
  .call-when{color:var(--ice);font-weight:600}
  .call-icon{display:block;width:15px;height:15px;flex:none;stroke:currentColor;stroke-width:1.8;fill:none;
        stroke-linecap:round;stroke-linejoin:round}
  .call-direction{color:var(--sky)}
  .call-outcome{display:inline-flex;align-items:center;gap:7px;max-width:210px;padding:7px 10px;border-radius:999px;
        border:1px solid var(--hair);font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.06em;
        line-height:1.2;color:var(--slate);text-align:left}
  .call-outcome.applied{color:var(--pulse)}
  .call-outcome.refused{color:var(--rose)}
  .call-outcome.queued{color:var(--sky)}
  .call-summary{grid-column:2/-1;margin:-3px 16px 13px 0;color:var(--slate);font-size:12.5px;line-height:1.5;
        display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
  .call-details{border-top:1px solid var(--hair)}
  .call-details>summary{display:flex;align-items:center;gap:9px;min-height:44px;box-sizing:border-box;padding:8px 16px;
        color:var(--slate);font-family:var(--sans);font-size:12.5px;font-weight:650;cursor:pointer;list-style:none}
  .call-details>summary::-webkit-details-marker{display:none}
  .call-details>summary:hover{color:var(--ice);background:var(--carbon)}
  .call-details>summary:focus-visible{outline:2px solid var(--sky);outline-offset:-3px}
  .call-detail-hint{margin-left:auto;color:var(--graphite);font-family:var(--mono);font-size:9.5px;font-weight:500;
        letter-spacing:.055em;text-align:right}
  .call-chevron{width:8px;height:8px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
        transform:rotate(45deg);transition:transform .16s ease;flex:none;margin:-4px 3px 0 4px}
  .call-details[open] .call-chevron{transform:rotate(225deg);margin-top:4px}
  .call-detail-body{padding:14px 16px 16px;background:var(--carbon);min-width:0}
  .call-detail-status,.call-caller-id,.call-artifact-note{margin:0;color:var(--graphite);font-size:12px;line-height:1.5}
  .call-caller-id{margin-bottom:12px}.call-caller-id b{color:var(--slate);font-family:var(--mono)}
  .call-artifact-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(230px,.72fr);gap:12px;align-items:start}
  .call-artifact{min-width:0;border:1px solid var(--hair);border-radius:11px;padding:12px;background:var(--carbon-2)}
  .call-artifact h5{display:flex;align-items:center;gap:7px;margin:0 0 8px;color:var(--ice);font-size:12.5px;font-weight:700}
  .call-transcript{max-height:360px;overflow:auto;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--slate);
        font-family:var(--sans);font-size:12.5px;line-height:1.65}
  .call-audio{display:block;width:100%;max-width:100%;height:40px;margin-top:5px;color-scheme:dark}
  .call-audio-status{min-height:18px;margin-top:7px;color:var(--graphite);font-size:11.5px;line-height:1.45}
  .call-audio-status.expired{color:var(--ember)}
  .call-audio-status.failed{color:var(--rose)}
  .call-sr{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;
        overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
  .asks{margin-top:11px;display:flex;flex-direction:column;gap:7px}
  .ask{display:flex;gap:11px;align-items:flex-start;padding:9px 11px;border-radius:10px;
        background:rgba(255,255,255,.02);border:1px solid var(--hair)}
  .ask.applied{border-color:rgba(52,211,153,.34);background:rgba(52,211,153,.055)}
  .ask.refused{border-color:rgba(242,109,109,.3);background:rgba(242,109,109,.05)}
  .ask.queued{border-color:rgba(110,139,255,.3)}
  .ask-body{flex:1;min-width:0}
  .ask-what{font-size:13px;line-height:1.45}
  .ask-why{margin-top:4px;font-size:11.5px;color:var(--graphite)}
  .ask-out{display:inline-flex;align-items:center;gap:5px;flex:none;font-family:var(--mono);font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;
        padding:5px 9px;border-radius:999px;border:1px solid var(--hair);color:var(--slate);white-space:nowrap}
  .ask.applied .ask-out{color:var(--pulse);border-color:rgba(52,211,153,.42)}
  .ask.refused .ask-out{color:var(--rose);border-color:rgba(242,109,109,.42)}
  .ask.queued .ask-out{color:var(--sky);border-color:rgba(110,139,255,.42)}

  /* --- rosters --- */
  .crew-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:9px}
  .crew-row{display:flex;align-items:center;gap:12px;padding:12px 13px;border-radius:11px;
        background:rgba(255,255,255,.018);border:1px solid var(--hair)}
  .crew-row.is-never{opacity:.62}
  .crew-row .cr-main{flex:1;min-width:0}
  .crew-row .cr-name{font-size:13.5px;font-weight:600;line-height:1.3}
  /* The role is the one line that says what the agent is FOR. Let it wrap:
     "harvests businesses (Goog…" told the operator nothing. */
  .crew-row .cr-role{margin-top:2px;font-size:11.5px;color:var(--graphite);line-height:1.4}
  .crew-row .cr-when{margin-top:5px;font-family:var(--mono);font-size:10px;letter-spacing:.07em;color:var(--slate)}
  .crew-row .cr-state{flex:none;align-self:flex-start}
  .crew-lead{box-shadow:inset 3px 0 0 var(--pulse)}
  .crew-empty{padding:22px 4px;color:var(--graphite);font-size:13px}

  @media(max-width:560px){
    .crew-grid{grid-template-columns:1fr}
    .call-glance{grid-template-columns:44px minmax(0,1fr);padding:12px;gap:10px}
    .call-avatar{width:44px;height:44px;border-radius:12px}
    .call-outcome{grid-column:2;justify-self:start;max-width:100%;box-sizing:border-box}
    .call-summary{grid-column:1/-1;margin:0 0 12px}
    .call-details>summary{padding-left:12px;padding-right:12px}
    .call-detail-hint{font-size:9px}
    .call-detail-body{padding:12px}
    .call-artifact-grid{grid-template-columns:minmax(0,1fr)}
    .ask{flex-direction:column;gap:7px}
    .ask-out{align-self:flex-start}
  }
  @media (prefers-reduced-motion:reduce){.call-chevron{transition:none}}
</style>
<style>
  /* ============ THE CIRCUIT =======================================
     Owner instruction 2026-08-07: "I don't like the street symbols as
     much as the old dashboard with the lines and lasers connecting
     everything and showing numbers." He is asking for something back,
     so it was found before anything new was drawn. The visual he means
     is the flow map from b2838d4 (#opsSvg): node discs WIRED to each
     other, edge weight carrying real volume, a count badge riding ON
     the wire, and a travelling spark. f0ac628 cut that to a grid of
     tiles with three grey dashes floating between them — which is
     what he is looking at now, and it does not even connect.

     Restored, then taken further. Six hexagon nodes, each carrying a
     drawn glyph for what it IS — a funnel that qualifies, two mirrored
     frames, a shield, an inbox, a plane, a handset — the real number
     under it, and a laser that runs the wire between them.

     MOTION LAW, inherited from the batch rail above and not
     negotiable. A laser runs on wire i ONLY because a row inside a
     RUNNING batch is the one the runner last touched, sits at that
     boundary, and moved within STALL_MS. rowMotion() is the single
     source of that verdict — the same function the rail uses, not a
     second opinion. The moment the held row stops moving the laser
     STOPS and the wire turns ember-hatched; when nothing is running
     every wire is flat graphite and the strip underneath says so in
     words. A wire glowing over a parked build is the same lie as a
     spinner over a dead one, and this line's known failure is a build
     that parks at capture_mobile and never errors.

     Nothing here owns a clock and nothing here polls. Every class is
     decided at render time from the snapshot that already arrived. */

  .cq{position:relative;margin:2px 0 0;padding:20px 14px 12px;border-radius:18px;
      border:1px solid var(--hair);overflow:hidden;background:
        radial-gradient(760px 250px at 10% -12%,rgba(74,108,247,.17),transparent 62%),
        radial-gradient(620px 240px at 94% 112%,rgba(52,211,153,.12),transparent 60%),
        var(--carbon)}
  /* Static circuit-board grid. Decoration is allowed to be still; it is
     never allowed to move, because movement here means work. */
  .cq::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.55;
      background-image:linear-gradient(rgba(124,108,246,.07) 1px,transparent 1px),
                       linear-gradient(90deg,rgba(124,108,246,.07) 1px,transparent 1px);
      background-size:34px 34px;
      -webkit-mask-image:linear-gradient(180deg,#000,transparent 76%);
              mask-image:linear-gradient(180deg,#000,transparent 76%)}
  .cqsvg{position:relative;display:block;width:100%;height:auto;overflow:visible}

  /* ---- nodes: a shape, a glyph, a real number ---- */
  .cqnode{cursor:pointer}
  .cqnode:focus-visible{outline:2px solid var(--sky);outline-offset:3px}
  .cqhex{fill:url(#cqface);stroke:rgba(150,160,210,.24);stroke-width:1.7;transition:stroke .2s}
  .cqnode:hover .cqhex{stroke:rgba(124,108,246,.75)}
  .cqnode.sel .cqhex{stroke:var(--signal);stroke-width:2.8;filter:drop-shadow(0 0 9px rgba(124,108,246,.55))}
  .cqhex.gate{stroke:rgba(124,108,246,.62);filter:drop-shadow(0 0 7px rgba(124,108,246,.3))}
  .cqhex.on{stroke:rgba(52,211,153,.8);filter:drop-shadow(0 0 9px rgba(52,211,153,.5))}
  .cqhex.warn{stroke:rgba(224,164,74,.78);filter:drop-shadow(0 0 8px rgba(224,164,74,.34))}
  .cqhex.bad{stroke:rgba(242,109,109,.82);filter:drop-shadow(0 0 9px rgba(242,109,109,.4))}
  .cqg{fill:none;stroke:#8E8D98;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .cqg.on{stroke:var(--pulse)} .cqg.warn{stroke:var(--ember)} .cqg.bad{stroke:var(--rose)}
  .cqg.gate{stroke:#9F92F8}
  .cqval{fill:var(--ice);font:700 27px var(--sans);text-anchor:middle}
  .cqval.on{fill:var(--pulse)} .cqval.warn{fill:var(--ember)} .cqval.bad{fill:var(--rose)}
  .cqlab{fill:var(--graphite);font:500 10px var(--mono);letter-spacing:.16em;text-anchor:middle}
  .cqsub{fill:var(--slate);font:400 10.5px var(--sans);text-anchor:middle}
  .cqsvg.vert .cqval,.cqsvg.vert .cqlab,.cqsvg.vert .cqsub{text-anchor:start}
  .cqsvg.vert .cqval{font-size:23px}

  /* A one-shot ring, fired only for an event this client had not seen on the
     previous poll — observed, never scheduled. */
  .cqping{fill:none;stroke:var(--pulse);stroke-width:2.4;opacity:0;
      transform-box:fill-box;transform-origin:center}
  .cqping.fire{animation:cqping 1.15s ease-out 1}
  @keyframes cqping{0%{opacity:.95;transform:scale(.9)}100%{opacity:0;transform:scale(1.62)}}

  /* ---- wires: weight is lifetime volume, colour is current state ---- */
  .cqwire{fill:none;stroke:rgba(155,154,164,.2);stroke-width:2;stroke-linecap:round}
  .cqwire.v1{stroke:rgba(110,139,255,.34);stroke-width:2.6}
  .cqwire.v2{stroke:rgba(52,211,153,.32);stroke-width:4.2}
  .cqwire.v3{stroke:rgba(52,211,153,.44);stroke-width:6.2}
  .cqwire.stall{stroke:rgba(224,164,74,.78);stroke-width:3.4;stroke-dasharray:3 7}
  .cqwire.blocked{stroke:rgba(242,109,109,.82);stroke-width:3.4;stroke-dasharray:8 6}
  .cqlaser{fill:none;stroke:var(--pulse);stroke-width:3.2;stroke-linecap:round;
      filter:drop-shadow(0 0 6px rgba(52,211,153,.95))}
  /* The dash pattern and the keyframe distance are the WIRE LENGTHS from
     CQ_H and CQ_V. Change the geometry there and these four numbers move
     with it, or the laser jumps at the loop point. */
  .cqlaser.h{stroke-dasharray:22 126;animation:cqrunh 1.35s linear infinite}
  .cqlaser.v{stroke-dasharray:18 84;animation:cqrunv 1.35s linear infinite}
  .cqlaser.trail{opacity:.42;stroke-width:6.4;animation-delay:-.42s}
  @keyframes cqrunh{from{stroke-dashoffset:0}to{stroke-dashoffset:-148}}
  @keyframes cqrunv{from{stroke-dashoffset:0}to{stroke-dashoffset:-102}}

  /* ---- the number riding on the wire ---- */
  .cqbg{fill:#0E0E13;stroke:rgba(255,255,255,.14);stroke-width:1}
  .cqbg.on{stroke:rgba(52,211,153,.58)}
  .cqbg.bad{stroke:rgba(242,109,109,.6)}
  .cqnum{fill:#EAF1FF;font:600 12.5px var(--mono);text-anchor:middle}
  .cqlost{fill:rgba(242,109,109,.82);font:500 10px var(--mono);text-anchor:middle}
  .cqmark{font-size:13px;text-anchor:middle}

  /* ---- what the wires are carrying, in words and counts ---- */
  .cqbar{display:flex;flex-wrap:wrap;align-items:center;gap:9px 20px;margin:15px 2px 0}
  .cqstat{display:inline-flex;align-items:baseline;gap:7px;font-family:var(--mono);
      font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--graphite)}
  .cqstat b{font-size:17px;font-weight:700;letter-spacing:0;color:var(--slate);font-variant-numeric:tabular-nums}
  .cqstat.on b{color:var(--pulse)}
  .cqstat.warn b{color:var(--ember)}
  .cqsay{flex:1;min-width:230px;text-align:right;font-size:12.5px;color:var(--slate);line-height:1.45}
  .cqleg{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:13px 2px 2px;
      font-size:11px;color:var(--graphite)}
  .cqleg span{display:inline-flex;align-items:center;gap:7px}
  .cqleg i{width:22px;height:0;flex:none}
  .cqleg i.live{border-top:3px solid var(--pulse);box-shadow:0 0 8px rgba(52,211,153,.85)}
  .cqleg i.stall{border-top:3px dashed rgba(224,164,74,.9)}
  .cqleg i.blocked{border-top:3px dashed rgba(242,109,109,.9)}
  .cqleg i.idle{border-top:2px solid rgba(155,154,164,.35)}

  .cqsvg.vert .cqlost{text-anchor:start}
  @media(max-width:900px){
    .cq{padding:16px 10px 10px}
    /* On one column the sentence gets its own row instead of being crushed
       into a four-word-wide column beside the counters. */
    .cqsay{flex:1 0 100%;text-align:left;min-width:0;margin-top:2px}
    .cqbar{gap:9px 16px}
  }
  /* Reduced motion. The laser does not travel — it becomes a SOLID lit wire,
     which still reads as "this segment is live" against the dim, ember and
     rose statics. Selectors are two classes deep so they beat .cqlaser.h. */
  @media (prefers-reduced-motion:reduce){
    .cqlaser.h,.cqlaser.v{animation:none;stroke-dasharray:none}
    .cqlaser.trail{display:none}
    .cqping.fire{animation:none;opacity:0}
    .cqhex{transition:none}
  }
</style>
<style>
  /* ============ LINE DETAIL: THE WORKSHOP FLOOR ====================
     Read-only and fed by the same authenticated batch snapshots as the
     Command Center. The worker cards never invent an internal sub-step:
     Extractor, Compiler and Designer share one observed mirror-build state
     because that is the finest timing the line records. */
  #tabPanelLine{min-width:0;max-width:100%}
  .lw{min-width:0;max-width:100%;overflow-x:hidden;margin-top:22px}
  .lw *{box-sizing:border-box;min-width:0}
  .lw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:14px}
  .lw-head h2{margin:3px 0 5px;font-size:22px;letter-spacing:-.025em}
  .lw-head p{max-width:720px;margin:0;color:var(--slate);font-size:12.5px;line-height:1.55}
  .lw-readonly{flex:none;font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;
    color:var(--signal);border:1px solid rgba(124,108,246,.4);border-radius:999px;padding:6px 9px;white-space:nowrap}
  .lw-empty{padding:26px;border:1px solid var(--hair);border-radius:14px;background:var(--carbon);
    color:var(--slate);font-size:13px;line-height:1.55}
  .lw-stack{display:flex;flex-direction:column;gap:14px}
  .lw-batch{min-width:0;max-width:100%;overflow:hidden;border:1px solid var(--hair);border-radius:16px;background:var(--carbon)}
  .lw-batch[data-state="running"],.lw-batch[data-state="sending"]{border-color:rgba(52,211,153,.3)}
  .lw-batch[data-state="halted"]{border-color:rgba(242,109,109,.34)}
  .lw-batchhead{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;padding:16px;border-bottom:1px solid var(--hair)}
  .lw-batchtitle{flex:1}
  .lw-batchtitle h3{margin:0;font-size:17px;letter-spacing:-.02em;overflow-wrap:anywhere}
  .lw-batchtitle p{margin:4px 0 0;color:var(--graphite);font-size:11.5px;line-height:1.45}
  .lw-batchmeta{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}
  .lw-state,.lw-clock,.lw-pace{font-family:var(--mono);font-size:9.5px;letter-spacing:.09em;color:var(--slate);
    border:1px solid var(--hair);border-radius:999px;padding:6px 9px;white-space:nowrap}
  .lw-state.running,.lw-state.sending{color:var(--pulse);border-color:rgba(52,211,153,.35)}
  .lw-state.halted{color:var(--rose);border-color:rgba(242,109,109,.38)}
  .lw-clock b,.lw-pace b{color:var(--ice);font-weight:650}
  .lw-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;padding:12px 16px;border-bottom:1px solid var(--hair)}
  .lw-count{padding:10px;border-radius:10px;background:var(--carbon-2);color:var(--graphite);font-size:11px;line-height:1.35}
  .lw-count b{display:block;color:var(--ice);font:650 17px var(--mono);margin-top:2px}
  .lw-workers{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;padding:14px 16px}
  .line-worker{display:flex;flex-direction:column;min-width:0;min-height:176px;padding:12px;border:1px solid var(--hair);
    border-radius:12px;background:var(--carbon-2);overflow:hidden}
  .line-worker.is-idle{opacity:.52}
  .line-worker[data-state="done"]{opacity:.76}
  .line-worker[data-state="shared"]{border-color:rgba(124,108,246,.34);background:rgba(124,108,246,.055)}
  .line-worker[data-state="working"]{border-color:rgba(52,211,153,.38);background:rgba(52,211,153,.05)}
  .line-worker[data-state="stalled"]{border-color:rgba(224,164,74,.42);background:rgba(224,164,74,.055)}
  .lw-worker-top{display:flex;align-items:center;gap:8px}
  .line-worker-icon{display:block;width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7;
    stroke-linecap:round;stroke-linejoin:round;color:var(--signal)}
  .lw-worker-name{font-size:13px;font-weight:750;line-height:1.2}
  .lw-worker-state{margin-left:auto;font-family:var(--mono);font-size:8.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--graphite)}
  .lw-lamp{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:currentColor;vertical-align:1px}
  .line-worker[data-state="working"] .lw-worker-state{color:var(--pulse)}
  .line-worker[data-state="working"] .lw-lamp{animation:beat 2.2s infinite}
  .line-worker[data-state="stalled"] .lw-worker-state{color:var(--ember)}
  .line-worker[data-state="shared"] .lw-worker-state{color:var(--signal)}
  .lw-worker-role{margin:10px 0 0;color:var(--graphite);font-size:10.5px;line-height:1.45}
  .lw-worker-now{margin:auto 0 0;padding-top:12px;color:var(--slate);font-size:11.5px;line-height:1.45;overflow-wrap:anywhere}
  .lw-rows{padding:0 16px 14px}
  .lw-rows-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:2px 0 8px}
  .lw-rows-head h4,.lw-reasons h4{margin:0;font-size:13px}
  .lw-rows-head span{font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--graphite)}
  .lw-row{display:grid;grid-template-columns:46px minmax(150px,.8fr) minmax(240px,1.4fr) auto;gap:10px;align-items:center;
    min-width:0;max-width:100%;padding:10px 11px;margin-top:6px;border:1px solid var(--hair);border-radius:10px;background:rgba(255,255,255,.018)}
  .lw-row[data-state="working"]{box-shadow:inset 3px 0 0 var(--pulse)}
  .lw-row[data-state="stalled"]{box-shadow:inset 3px 0 0 var(--ember)}
  .lw-row[data-state="failed"]{box-shadow:inset 3px 0 0 var(--rose)}
  .lw-row[data-state="done"]{box-shadow:inset 3px 0 0 var(--signal)}
  .lw-rowno{font:650 11px var(--mono);color:var(--graphite)}
  .lw-business{font-size:12.5px;font-weight:650;line-height:1.35;overflow-wrap:anywhere}
  .lw-place{margin-top:2px;color:var(--graphite);font-size:10.5px;line-height:1.35}
  .lw-stage{color:var(--slate);font-size:11.5px;line-height:1.45;overflow-wrap:anywhere}
  .lw-stage b{display:block;color:var(--ice);font-size:11.5px}
  .lw-age{font-family:var(--mono);font-size:9.5px;color:var(--graphite);text-align:right;white-space:nowrap}
  .lw-row .dx{grid-column:3/-1;margin:0}
  .lw-reasons{margin:0 16px 16px;padding:13px;border:1px solid var(--hair);border-radius:11px;background:var(--carbon-2)}
  .lw-reasons>p{margin:4px 0 9px;color:var(--graphite);font-size:10.5px;line-height:1.45}
  .lw-reasons .mfun{margin-top:0}
  @media(max-width:980px){
    .lw-workers{grid-template-columns:repeat(3,minmax(0,1fr))}
    .lw-summary{grid-template-columns:repeat(3,minmax(0,1fr))}
    .lw-row{grid-template-columns:40px minmax(130px,.8fr) minmax(190px,1.2fr)}
    .lw-age{grid-column:2/-1;text-align:left}
  }
  @media(max-width:560px){
    .lw{margin-top:16px}
    .lw-head{display:block}.lw-readonly{display:inline-block;margin-top:10px}
    .lw-batchhead{padding:13px}.lw-batchmeta{justify-content:flex-start;width:100%}
    .lw-summary{grid-template-columns:repeat(2,minmax(0,1fr));padding:10px 13px}
    .lw-workers{grid-template-columns:minmax(0,1fr);padding:12px 13px}
    .line-worker{min-height:0}
    .lw-worker-now{margin-top:10px}
    .lw-rows{padding:0 13px 12px}
    .lw-row{grid-template-columns:32px minmax(0,1fr);gap:7px;padding:10px}
    .lw-stage,.lw-age,.lw-row .dx{grid-column:2}
    .lw-age{text-align:left;white-space:normal}
    .lw-reasons{margin:0 13px 13px;padding:11px}
  }
  @media (prefers-reduced-motion:reduce){.line-worker[data-state="working"] .lw-lamp{animation:none}}
</style>
<style>
  /* ============ THE LAUNCH DECK ====================================
     Owner instruction 2026-08-06: "I pressed the run ten sites button,
     and now nothing is happening… have it be functional and easy to
     understand and use in a heartbeat." Three failures, one sheet:
     the button answered with silence, the finished batches gave him
     no approve control, and every old run kept its six boxes open.

     Everything below is additive — the approved sheet at the top of
     this file stays byte-pinned. Type, spacing and chips reuse the
     design board's KPI-card language in the existing tokens. */

  /* ---- KPI clothes for the six assembly-line numbers. Same six boxes,
     same ids, same measured values — better clothes. A delta chip
     renders ONLY when a real prior value exists (the first snapshot
     this session) and the number actually moved. ---- */
  .line{gap:12px}
  .stage{background:linear-gradient(180deg,#16161C,#101015);border-radius:18px;padding:19px 18px 17px}
  .stage .metric{font-size:34px;font-weight:750;letter-spacing:-.02em;margin:10px 0 4px;
    display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;line-height:1}
  .stage .sub{font-size:11.5px;color:var(--graphite);line-height:1.45}
  .kdelta{font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;padding:3px 7px;border-radius:999px;
    border:1px solid rgba(52,211,153,.35);color:var(--pulse);white-space:nowrap;font-weight:500}

  /* ---- THE LIVE CAMPAIGN CARD: the answer to a pressed Run button.
     Pinned above every batch, born the moment the button is pressed,
     resolves IN PLACE into its outcome when the run settles. ---- */
  .lc-card{border:1px solid rgba(124,108,246,.42);border-radius:16px;margin:2px 0 12px;padding:16px 18px;
    background:radial-gradient(620px 210px at 8% -30%,rgba(74,108,247,.16),transparent 62%),var(--carbon)}
  .lc-head{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap}
  .lc-kicker{font-family:var(--mono);font-size:9.5px;letter-spacing:.2em;color:var(--signal);white-space:nowrap}
  .lc-name{font-size:17px;font-weight:750;letter-spacing:-.02em;flex:1;min-width:150px}
  .lc-clock{font-family:var(--mono);font-size:12px;color:var(--slate);border:1px solid var(--hair);
    border-radius:999px;padding:5px 11px;white-space:nowrap}
  .lc-line{margin-top:10px;font-size:13px;color:var(--slate);line-height:1.5}
  .lc-track{height:7px;border-radius:4px;background:rgba(255,255,255,.05);overflow:hidden;margin-top:10px}
  .lc-track i{display:block;height:100%;border-radius:4px;background:var(--grad-pulse);transition:width .4s}
  .lc-out{margin-top:10px;font-size:13.5px;line-height:1.55;color:var(--ice);border:1px solid var(--hair);
    border-radius:11px;padding:11px 13px;background:rgba(255,255,255,.03)}
  .lc-out.ok{border-color:rgba(52,211,153,.32)}
  .lc-out.bad{border-color:rgba(242,109,109,.34);color:#ffd9d9}

  /* ---- APPROVE & SEND: the primary control a waiting batch earns.
     Armed state mirrors the stop bar: two presses, 20s window, and the
     window announces its own expiry. The read-back rail prints only
     what the server answered — never the click. ---- */
  .bact{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;padding:12px 16px;
    border-top:1px solid var(--hair);background:rgba(124,108,246,.05)}
  .bact .btn{font-size:14.5px;padding:13px 22px}
  .bact .btn.armed2{background:#fff;color:#3b2f8f;outline:3px solid var(--signal);outline-offset:2px}
  .bact-sub{font-size:12px;color:var(--slate);line-height:1.5;flex:1;min-width:220px}
  .bact-out{flex-basis:100%;font-family:var(--mono);font-size:11.5px;line-height:1.6;white-space:pre-wrap;
    border:1px solid var(--hair);border-radius:10px;padding:9px 12px;background:rgba(255,255,255,.03);color:var(--slate)}
  .bact-out.ok{border-color:rgba(52,211,153,.32);color:#cdf5e6}
  .bact-out.bad{border-color:rgba(242,109,109,.34);color:#ffd9d9}

  /* ---- DECLUTTER: one batch open, the rest one line each. ---- */
  .boutcome{padding:15px 3px 6px;font-size:13.5px;line-height:1.55;color:var(--ice)}
  .hist{margin-top:10px}
  .hist-cap{margin:0 2px 8px}
  .histrow{display:flex;align-items:center;gap:10px 12px;width:100%;text-align:left;box-sizing:border-box;
    background:var(--carbon-2);border:1px solid var(--hair);border-radius:11px;padding:11px 14px;margin-top:6px;
    color:var(--ice);font-family:var(--sans);font-size:13px;cursor:pointer}
  .histrow:hover{border-color:rgba(255,255,255,.16)}
  .histrow:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
  .histrow .hname{font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
  .histrow .hwhen{font-family:var(--mono);font-size:10px;color:var(--graphite);white-space:nowrap}
  .histrow .hout{flex:1;min-width:140px;color:var(--slate);font-size:12px;line-height:1.4;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .histrow .hchips{display:flex;gap:6px;flex:none}
  .hchip{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;padding:3px 8px;border-radius:999px;
    border:1px solid var(--hair);color:var(--slate);white-space:nowrap}
  .hchip.q{color:var(--ember);border-color:rgba(224,164,74,.4)}
  .hchip.s{color:var(--pulse);border-color:rgba(52,211,153,.35)}
  .hchip.f{color:var(--rose);border-color:rgba(242,109,109,.38)}
  .histopen{margin-top:6px}
  .histopen .histrow{border-color:rgba(124,108,246,.45);border-bottom-left-radius:0;border-bottom-right-radius:0}
  .histopen .bcard{border-top-left-radius:0;border-top-right-radius:0;border-top:0}
  @media(max-width:620px){
    .histrow{flex-wrap:wrap}
    .histrow .hout{white-space:normal;flex-basis:100%;min-width:0}
    .bact .btn{width:100%}
  }

  /* ---- GARNISH (Mystic Well, distilled): a slow water-ripple sheen on
     the Run buttons and a breathing border on the live-campaign card —
     pure CSS, and ONLY while a run is actually working. .busy lives
     exactly as long as the wave loop; .lc-live exactly as long as
     campaign.state === "working". No WebGL, no clock of its own. ---- */
  .btn.busy{position:relative;overflow:hidden}
  .btn.busy::after{content:"";position:absolute;inset:-45%;pointer-events:none;
    background:radial-gradient(circle at 32% 38%,rgba(255,255,255,.2),transparent 44%);
    animation:wellripple 2.8s ease-in-out infinite}
  @keyframes wellripple{0%,100%{transform:translate(-6%,-4%) scale(1);opacity:.45}
    50%{transform:translate(7%,5%) scale(1.14);opacity:.85}}
  .lc-card.lc-live{border-color:rgba(52,211,153,.42);animation:lcglow 3.2s ease-in-out infinite}
  @keyframes lcglow{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}50%{box-shadow:0 0 24px 0 rgba(52,211,153,.16)}}
  @media (prefers-reduced-motion:reduce){
    .btn.busy::after{animation:none;opacity:.35}
    .lc-card.lc-live{animation:none;box-shadow:0 0 14px rgba(52,211,153,.12)}
    .lc-track i{transition:none}
  }
</style>
<style id="boardAlignment">
  /* Design-board alignment. The first stylesheet remains byte-pinned; these
     rules only re-clothe the live console and preserve every behavior id. */
  body{background:
    radial-gradient(1100px 460px at 50% -160px,rgba(124,108,246,.13),transparent 62%),
    var(--void)}
  .wrap,.wrap *{box-sizing:border-box;min-width:0}
  .wrap{max-width:1180px;padding:26px 24px 60px}
  .board-masthead{padding:0 0 14px;border:0;border-bottom:3px solid #4A6CF7;gap:20px;justify-content:space-between;
    border-image:linear-gradient(90deg,#4A6CF7 0%,#7C6CF6 55%,#34D399 100%) 1}
  /* Brand shelf: the customer dashboard and the emails carry the same
     blue-violet-green rule under their masthead, so every surface reads as
     one company. Degrades to the brand-blue solid line without border-image. */
  .brand-cluster{display:flex;align-items:center;gap:13px}
  .board-masthead .mark{width:42px;height:42px;border:0;border-radius:0;background:transparent}
  .board-masthead .mark svg{display:block;width:42px;height:42px}
  .board-masthead .lockup .t{font-size:19px;font-weight:700;letter-spacing:-.015em;line-height:1.1}
  .board-masthead .lockup .s{margin-top:4px;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--graphite)}
  .board-masthead .head-right{gap:8px}
  .board-masthead .pill{background:#15151A;border-color:rgba(255,255,255,.09);padding:7px 12px;
    font-size:11px;letter-spacing:.06em;text-transform:none}
  #readyPill.live{color:#D8F8EC;border-color:rgba(52,211,153,.2)}
  #readyPill.warn{color:#F2D29B;border-color:rgba(224,164,74,.24)}

  .console-nav-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px}
  #consoleTabs,.console-links{display:flex;align-items:center;gap:2px;width:max-content;max-width:100%;
    padding:4px;margin:0;border:1px solid var(--hair);border-radius:12px;background:rgba(255,255,255,.05)}
  #consoleTabs{overflow-x:auto;scrollbar-width:none}
  #consoleTabs::-webkit-scrollbar{display:none}
  .console-links{flex:none}
  .tab{flex:0 0 auto;padding:8px 16px;border:0;border-radius:9px;margin:0;color:#84838E;
    font-family:var(--sans);font-size:13.5px;font-weight:600;letter-spacing:0;text-transform:none;line-height:1.15}
  .tab:hover{color:#C9C8D0;background:rgba(255,255,255,.055);text-decoration:none}
  .tab.active{color:var(--ice);border:0;background:rgba(255,255,255,.10);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
  .console-links .tab{font-family:var(--mono);font-size:10.5px;color:var(--slate);padding:8px 11px}

  #tabPanelMap:not([hidden]),#tabPanelCommand:not([hidden]){display:block;margin-top:16px}
  #tabPanelCommand>section{margin-top:16px}
  #tabPanelCommand>.grid{margin-top:16px!important;gap:14px}
  .sec-head{margin-bottom:12px}
  .sec-head h2,.map-h h2{font-size:16px;font-weight:600;letter-spacing:0}
  .map-h{align-items:center;margin:0 0 12px}
  .map-h .label,.sec-head .label{letter-spacing:.08em}

  .line{grid-template-columns:repeat(auto-fit,minmax(176px,1fr));gap:12px}
  .stage{isolation:isolate;overflow:hidden;background:#131318;border:1px solid var(--hair);border-radius:16px;
    padding:18px;min-height:168px;transition:transform .2s ease,border-color .2s ease}
  .stage::before{content:"";position:absolute;z-index:-1;inset:-1px;pointer-events:none;background:
    radial-gradient(170px 110px at 100% 0,rgba(124,108,246,.13),transparent 65%)}
  .stage:nth-child(2n)::before{background:radial-gradient(170px 110px at 100% 0,rgba(52,211,153,.10),transparent 65%)}
  .stage:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.14)}
  .stage.gate{border-color:rgba(124,108,246,.28)}
  .stage.gate::after{top:10px;right:12px;background:transparent}
  .stage>.label{display:block;max-width:calc(100% - 46px);font-size:11px;letter-spacing:.04em;color:var(--graphite)}
  .stage .metric{font-size:30px;font-weight:700;letter-spacing:0;margin:18px 0 7px}
  .stage .sub{font-size:12px;line-height:1.45;color:#7C7B86}
  .kdelta{font-size:10px;border:0;background:rgba(52,211,153,.13);color:#4ADCA6}
  .kpi-spark{display:block;width:100%;height:30px;margin-top:13px;overflow:visible}
  .kpi-spark[hidden]{display:none}
  .spark-caption{display:block;margin-top:4px;font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;color:#5F5E68}
  .spark-caption[hidden]{display:none}
  .flow{margin-top:12px;height:2px;opacity:.42}

  .cq{margin:0;padding:20px;border-radius:16px;border-color:var(--hair);background:
    radial-gradient(760px 250px at 10% -12%,rgba(74,108,247,.13),transparent 62%),
    radial-gradient(620px 240px at 94% 112%,rgba(52,211,153,.09),transparent 60%),#131318}
  .cqbar{margin:14px 0 0;padding:13px 14px;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:rgba(255,255,255,.03)}
  .cqstat{letter-spacing:.05em}
  .cqstat b{color:#ECECEF}
  .map-drill,.card{background:#131318;border-color:var(--hair);border-radius:16px;padding:20px}
  .map-drill{margin-top:14px}
  .btn,.halt-btn,.mine-field,.access-card input{font-family:var(--sans);letter-spacing:0}
  :where(button,a,input,select,[tabindex]):focus-visible{outline:2px solid var(--sky);outline-offset:3px}

  @media(max-width:760px){
    .console-nav-row{display:block}
    #consoleTabs,.console-links{width:100%;overflow-x:auto;scrollbar-width:none}
    .console-links{margin-top:8px}
    .console-links::-webkit-scrollbar{display:none}
    .tab{padding:8px 12px}
  }
  @media(max-width:640px){
    .wrap{padding:18px 14px 44px}
    .board-masthead{align-items:flex-start;flex-wrap:wrap}
    .board-masthead .head-right{width:100%;margin-left:55px;justify-content:flex-start}
    .halt{margin-left:-14px;margin-right:-14px;padding-left:14px;padding-right:14px}
    .map-h{align-items:flex-start;flex-direction:column;gap:4px}
    .cq{padding:16px 12px}
    .cqbar{padding:12px;gap:10px}
    .cqstat{flex:1 1 calc(50% - 10px)}
    .launch #laneMode,.launch #mineVertical,.launch #mineLocation{grid-column:1/-1}
    .launch .launchBtn{grid-column:span 6}
    .launch-note{grid-column:1/-1}
  }
  @media(max-width:420px){
    .line{grid-template-columns:1fr}
    .board-masthead .head-right{margin-left:0}
    .stage{min-height:152px}
    .launch .btn,.launch .mine-field,.halt-btn,.tab,.pipetab,.approveBtn,.histrow,.kbtn{min-height:44px}
    .launch .btn,.launch .mine-field{width:100%;box-sizing:border-box}
    .launch .launchBtn{grid-column:1/-1}
    .launch-note,.btarget,.bid,.bact-out,.ph-status,.ph-send{overflow-wrap:anywhere}
    .bcard,.bbody,.lead,.lbody,.tabpanel{min-width:0;max-width:100%}
    .tabframe iframe{height:70vh;min-height:420px}
  }
  @media(prefers-reduced-motion:reduce){
    .stage{transition:none}
    .stage:hover{transform:none}
  }
</style>
<style id="pipelineView">
  /* ============ WHERE ARE MY TEN — the campaign rebuild ================
     Owner instruction 2026-08-12. Watching a live run he could not find the
     numbers: "the numbering and understanding how many are being built …
     is completely lost once the campaign starts." So the command screen now
     leads with ONE dominant tally of the batch he launched, then the sites
     themselves, one row each. (The 2026-08-16 campaign-flow pass retired the
     old sub-nav that hid the mine numbers behind this view — the internals
     now live in the Engine room and the owner face is one flow.)

     ADDITIVE ONLY. The first stylesheet, every heading, both section counts
     and the outer tab bar are byte-pinned by tests and untouched — this
     toggles VISIBILITY and adds the hero. Tokens are reused, not reinvented:
     --pulse = built/ready/sent motion, --signal = building, --rose refused,
     --ember stalled. */

  /* the split he asked for, in the page's own tab language (a sub-nav inside
     the Command Center tab, not a sixth outer tab) */
  .pipenav{display:flex;gap:6px;margin-top:16px;padding:4px;border:1px solid var(--hair);
    border-radius:12px;background:rgba(255,255,255,.05);width:max-content;max-width:100%}
  .pipetab{flex:0 0 auto;padding:9px 18px;border:0;border-radius:9px;margin:0;cursor:pointer;
    color:#84838E;background:transparent;font:600 13.5px var(--sans);letter-spacing:0}
  .pipetab:hover{color:#C9C8D0;background:rgba(255,255,255,.055)}
  .pipetab.active{color:var(--ice);background:rgba(255,255,255,.10);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
  .pipetab:focus-visible{outline:2px solid var(--sky);outline-offset:2px}

  /* view toggle — SOURCE ORDER of headings is untouched (the design pin),
     only visibility flips between the two sub-views */
  #tabPanelCommand>.pv{margin-top:16px}
  #tabPanelCommand[data-pv="pipe"] .pv-funnel{display:none}
  #tabPanelCommand[data-pv="funnel"] .pv-pipe{display:none}
  /* re-add the spacing the wrapped sections lost from #tabPanelCommand>section */
  .pv>section{margin-top:0}

  /* THE HERO — the count that dominates, the first thing the eye hits */
  .pipe-hero{background:linear-gradient(180deg,#15151B,#111116);border:1px solid var(--hair);
    border-radius:18px;padding:22px 24px}
  .pipe-hero[data-state="working"]{border-color:rgba(52,211,153,.30)}
  .pipe-hero[data-state="ready"]{border-color:rgba(52,211,153,.42)}
  .pipe-hero[data-state="stalled"]{border-color:rgba(224,164,74,.40)}
  .ph-top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
  .ph-count{font-size:46px;font-weight:800;letter-spacing:-.03em;line-height:1;
    font-variant-numeric:tabular-nums;color:var(--ice)}
  .ph-count b{color:var(--pulse)}
  .ph-of{font-size:20px;font-weight:700;color:var(--slate);letter-spacing:-.01em}
  .ph-word{font-size:20px;font-weight:700;color:var(--slate);letter-spacing:-.01em;align-self:flex-end;padding-bottom:4px}
  .ph-live{margin-left:auto;align-self:center;font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;
    text-transform:uppercase;color:var(--graphite);display:inline-flex;align-items:center;gap:7px}
  .ph-live.on{color:var(--pulse)}
  .ph-live.on::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--pulse);animation:beat 1.6s infinite}
  .ph-live.warn{color:var(--ember)}
  .ph-tally{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:15px}
  .ph-stat{display:inline-flex;align-items:center;gap:8px;font-size:14px;color:var(--slate)}
  .ph-stat b{font-size:18px;font-weight:750;color:var(--ice);font-variant-numeric:tabular-nums}
  .ph-stat i{width:9px;height:9px;border-radius:50%;background:var(--graphite);flex:none}
  .ph-stat.building i{background:var(--signal)} .ph-stat.building b{color:#B9AEFB}
  .ph-stat.ready i{background:var(--pulse)} .ph-stat.ready b{color:#8FE9C9}
  .ph-stat.sent i{background:var(--sky)} .ph-stat.sent b{color:#AFC0FF}
  .ph-stat.refused i{background:var(--rose)} .ph-stat.refused b{color:#F4A6A6}
  .ph-bar{height:8px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:16px;display:flex}
  .ph-bar i{height:100%;display:block}
  .ph-bar .b-sent{background:var(--sky)} .ph-bar .b-ready{background:var(--grad-pulse)}
  .ph-bar .b-build{background:rgba(124,108,246,.62)} .ph-bar .b-fail{background:rgba(242,109,109,.5)}
  .ph-status{margin-top:15px;font-size:13.5px;line-height:1.5;color:var(--slate)}
  .ph-phasegrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:15px}
  .ph-phase{padding:10px 11px;border:1px solid var(--hair);border-radius:10px;background:rgba(255,255,255,.025);font-size:11px;color:var(--graphite);line-height:1.35}
  .ph-phase b{display:block;margin-bottom:4px;color:var(--ice);font-size:16px;font-variant-numeric:tabular-nums}
  .ph-phase span{display:block;color:var(--slate)}
  .ph-perf{display:flex;flex-wrap:wrap;gap:7px 16px;margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(124,108,246,.055);border:1px solid rgba(124,108,246,.18);font:500 10.5px/1.5 var(--mono);color:var(--slate)}
  .ph-perf b{color:var(--ice);font-weight:650}
  .ph-perf .slow{color:var(--ember)}
  .ph-send{margin-top:14px;display:flex;align-items:center;gap:12px;padding:13px 16px;border-radius:12px;
    border:1px solid var(--hair);background:rgba(255,255,255,.03);font-size:13.5px;line-height:1.45;color:var(--slate)}
  .ph-send b{color:var(--ice);font-weight:600}
  .ph-send.ready{border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.08);color:#CDF5E6}
  .ph-send.ready b{color:#EAFFF6}
  .ph-send-ic{flex:none;font-size:17px;line-height:1}
  .ph-send-arrow{margin-left:auto;font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;color:var(--pulse);white-space:nowrap}
  .ph-empty{padding:4px 0}
  .ph-empty-k{font-size:22px;font-weight:750;letter-spacing:-.02em;color:var(--ice)}
  .ph-empty-s{margin-top:9px;font-size:13.5px;line-height:1.6;color:var(--slate);max-width:660px}
  .ph-empty-s b{color:var(--ice);font-weight:600}

  /* building thumbnail: a real green bar on HOW FAR the build is (his words:
     "green bars on what part is actually happening in the build") */
  .lbuildfill{position:absolute;left:0;bottom:0;height:6px;background:var(--grad-pulse);
    border-radius:0 3px 0 0;transition:width .4s ease}
  .lbuildpct{position:absolute;left:8px;bottom:10px;font-family:var(--mono);font-size:11px;font-weight:600;
    color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.85)}
  /* the one row actually moving breathes, so the eye finds it at a glance */
  .lead.act{animation:leadpulse 2.4s ease-in-out infinite}
  @keyframes leadpulse{0%,100%{box-shadow:inset 3px 0 0 var(--signal)}
    50%{box-shadow:inset 3px 0 0 var(--signal),0 0 0 1px rgba(124,108,246,.22)}}

  @media(max-width:640px){
    .pipenav{width:100%}
    .pipetab{flex:1 1 0;text-align:center;padding:9px 10px}
    .pipe-hero{padding:18px 16px}
    .ph-count{font-size:38px}
    .ph-of,.ph-word{font-size:17px}
    .ph-live{margin-left:0;width:100%;margin-top:6px}
    .ph-phasegrid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .ph-send{flex-wrap:wrap}
    .ph-send-arrow{margin-left:0;width:100%}
  }
  /* Unspaced on purpose: a test slices the stylesheet from the LAST spaced
     reduced-motion query to prove the .btn.busy / .lc-card garnish is disabled
     there, so this block must not become that last match. Matches the board
     skin's own unspaced form. */
  @media(prefers-reduced-motion:reduce){
    .lead.act{animation:none;box-shadow:inset 3px 0 0 var(--signal)}
    .ph-live.on::before{animation:none}
    .lbuildfill{transition:none}
  }
</style>

<style id="campaignControlTower">
  .ct{border:1px solid rgba(124,108,246,.28);border-radius:18px;background:linear-gradient(180deg,#15151c,#101014);padding:22px}
  .ct-head{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
  .ct-title{flex:1;min-width:260px}.ct-title h2{margin:3px 0 7px;font-size:24px;letter-spacing:-.025em}
  .ct-title p{margin:0;color:var(--slate);font-size:14px;line-height:1.6;max-width:800px}
  .ct-state{font:650 10px var(--mono);letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--hair);border-radius:999px;padding:7px 10px}
  .ct-state.work{color:var(--signal);border-color:rgba(124,108,246,.42)}
  .ct-state.ready{color:var(--pulse);border-color:rgba(52,211,153,.42)}
  .ct-state.warn{color:var(--ember);border-color:rgba(224,164,74,.42)}
  .ct-big{display:flex;align-items:baseline;gap:9px;margin-top:18px}.ct-big b{font-size:48px;line-height:1;color:var(--pulse)}.ct-big span{font-size:20px;color:var(--slate)}
  .ct-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:16px}
  .ct-metric{padding:12px;border:1px solid var(--hair);border-radius:11px;background:rgba(255,255,255,.025);font-size:11px;color:var(--graphite);line-height:1.4}
  .ct-metric b{display:block;font-size:20px;color:var(--ice);font-variant-numeric:tabular-nums;margin-bottom:3px}
  .ct-slots{display:grid;grid-template-columns:repeat(10,minmax(12px,1fr));gap:5px;margin-top:17px}
  .ct-slot{height:22px;border-radius:5px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.045);font:600 8px/20px var(--mono);text-align:center;color:#65646d}
  .ct-slot.review{background:rgba(110,139,255,.18);border-color:rgba(110,139,255,.35);color:#bfcaff}
  .ct-slot.build{background:rgba(124,108,246,.25);border-color:rgba(124,108,246,.5);color:#d5ceff}
  .ct-slot.check{background:rgba(74,108,247,.27);border-color:rgba(74,108,247,.55);color:#dbe3ff}
  .ct-slot.email{background:rgba(224,164,74,.18);border-color:rgba(224,164,74,.42);color:#f2d29b}
  .ct-slot.ready{background:rgba(52,211,153,.24);border-color:rgba(52,211,153,.52);color:#d9fff0}
  .ct-slot.sent{background:rgba(110,139,255,.3);border-color:rgba(110,139,255,.62);color:#eef2ff}
  .ct-foot{display:grid;grid-template-columns:1.2fr .8fr;gap:10px;margin-top:14px}
  .ct-note{border:1px solid var(--hair);border-radius:11px;padding:12px 14px;color:var(--slate);font-size:12.5px;line-height:1.55;background:rgba(255,255,255,.02)}
  .ct-note b{color:var(--ice)}.ct-note.action{border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.06)}
  .ct-curve{margin-top:14px;padding:12px;border:1px solid var(--hair);border-radius:11px;background:rgba(255,255,255,.018)}
  .ct-curve svg{display:block;width:100%;height:74px}.ct-curve p{margin:6px 0 0;color:var(--graphite);font:500 10px/1.45 var(--mono)}
  #launchSection.campaign-active .launch>:not(#launchOut){display:none}
  #launchSection.campaign-active #launchOut{min-width:0;flex-basis:100%;border-color:rgba(124,108,246,.25)}
  @media(max-width:760px){.ct-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ct-foot{grid-template-columns:1fr}.ct-slots{grid-template-columns:repeat(10,minmax(8px,1fr));gap:3px}.ct-slot{height:18px;line-height:16px;font-size:7px}}
</style>

<style id="plainVoice">
  /* ============ PLAIN WORDS, BIG TYPE =================================
     Owner instruction 2026-08-16: the console reads as jargon to a layman.
     This sheet re-clothes the Command Center in plain English and bigger
     type WITHOUT touching the byte-pinned sheets above it — every behavior
     id, endpoint contract and safety string survives; only the words the
     owner reads change. Type floor: 16px wherever a human reads status,
     28–34px for the numbers the business runs on. Tokens reused as-is. */

  #cockpit .launch-note,#cockpit .fstep-hint,#cockpit .send-law,
  #cockpit .glance-sub,#cockpit .happening-item,#cockpit .happening-empty,
  #cockpit .bact-sub,#cockpit .boutcome,#cockpit .lc-line,#cockpit .ph-status,
  #cockpit .stage .sub,#cockpit .why{font-size:16px;line-height:1.6}
  section{margin-top:30px}

  /* the little "?" on every section heading — the glyph is a ::after so the
     heading's own text (design-pinned by tests) stays byte-clean; hover the
     circle and the one-sentence explanation appears */
  .qhint{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;
    margin-left:8px;border-radius:50%;border:1px solid var(--hair);color:var(--graphite);
    font:600 11px/1 var(--sans);vertical-align:2px;cursor:help;background:transparent}
  .qhint::after{content:"?"}
  .qhint:hover{color:var(--ice);border-color:rgba(255,255,255,.3)}

  /* ---- YOUR STUDIO AT A GLANCE: four big honest numbers, nothing else --- */
  .glance{margin-top:18px}
  .glance-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:14px}
  .glance-head h2{font-size:22px;font-weight:750;letter-spacing:-.02em;margin:0}
  .glance-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .glance-card{background:linear-gradient(180deg,#15151B,#111116);border:1px solid var(--hair);
    border-radius:16px;padding:20px 18px 18px;min-width:0;transition:border-color .2s ease}
  .glance-card:hover{border-color:rgba(255,255,255,.16)}
  .glance-card.waiting{border-color:rgba(224,164,74,.4)}
  .glance-k{font-size:16px;font-weight:700;letter-spacing:-.01em}
  .glance-num{font-size:clamp(30px,3vw,34px);font-weight:800;letter-spacing:-.02em;line-height:1;
    margin:10px 0 8px;font-variant-numeric:tabular-nums;color:var(--ice)}
  .glance-card.waiting .glance-num{color:var(--ember)}
  .glance-sub{display:block;color:var(--slate);min-width:0}
  .glance-sub b{color:var(--ice);font-weight:600}
  .glance-sub a{color:var(--pulse);font-weight:600}
  .glance-none{color:var(--graphite)}
  .glance-tip{display:flex;align-items:center;gap:10px;margin-top:14px;padding:12px 16px;
    border:1px solid var(--hair);border-radius:12px;background:rgba(124,108,246,.055);
    color:var(--slate);font-size:16px;line-height:1.55}
  .glance-tip .tip-k{flex:none;font-family:var(--mono);font-size:10px;letter-spacing:.14em;
    text-transform:uppercase;color:var(--signal)}

  /* ---- FIND NEW CUSTOMERS: the 3-step stepper -------------------------- */
  #launchSection .launch{grid-template-columns:1fr 1fr 1.25fr;gap:14px}
  #launchSection .launch #laneMode{grid-column:1/-1;width:100%;box-sizing:border-box}
  .fstep{border:1px solid var(--hair);border-radius:14px;padding:14px 16px 15px;background:rgba(255,255,255,.018);
    display:flex;flex-direction:column;gap:9px;min-width:0}
  .fstep .fnum{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;
    border-radius:50%;background:var(--grad-signal);color:#fff;font:700 13px/1 var(--sans);flex:none}
  .fstep .frow{display:flex;align-items:center;gap:10px}
  .fstep .flabel{font-size:16.5px;font-weight:750;letter-spacing:-.01em}
  .fstep .mine-field{width:100%;box-sizing:border-box;min-height:46px;font-size:16px}
  .fstep-hint{color:var(--graphite)}
  .fbtns{display:flex;gap:9px;flex-wrap:wrap}
  .fbtns .launchBtn{flex:1 1 0;min-height:46px;padding:13px 10px;font-size:15.5px;min-width:0}
  #launchSection .send-law{grid-column:1/-1;margin:0}
  #launchSection .launch-note{grid-column:1/-1}
  .send-law{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;
    border:1px solid rgba(52,211,153,.3);background:rgba(52,211,153,.07);color:#CDF5E6;font-weight:600}
  .send-law::before{content:"\\2713";flex:none;font-weight:800;color:var(--pulse)}
  .bact .send-law{flex-basis:100%;margin:0;padding:10px 14px}
  @media(max-width:900px){#launchSection .launch{grid-template-columns:1fr 1fr}
    #launchSection .launch .fstep:nth-of-type(3){grid-column:1/-1}}
  @media(max-width:640px){#launchSection .launch{grid-template-columns:1fr}
    .fstep,.fbtns .launchBtn{grid-column:1/-1}
    .glance-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:420px){.glance-grid{grid-template-columns:1fr}
    .fbtns{flex-direction:column}.fbtns .launchBtn{width:100%}}
  @media(prefers-reduced-motion:reduce){.glance-card{transition:none}}

  /* ---- HAPPENING NOW: plain sentences, one per line -------------------- */
  .happening{margin-top:18px}
  .happening-card{background:linear-gradient(180deg,#15151B,#111116);border:1px solid var(--hair);
    border-radius:16px;padding:18px 20px}
  .happening-list{list-style:none;margin:12px 0 0;padding:0}
  .happening-item{display:flex;gap:11px;align-items:baseline;padding:8px 0;border-top:1px solid var(--hair)}
  .happening-item:first-child{border-top:none}
  .happening-mark{flex:none;width:1.4em;font-weight:700;text-align:center}
  .happening-item.good .happening-mark{color:var(--pulse)}
  .happening-item.bad .happening-mark{color:var(--rose)}
  .happening-item.wait .happening-mark{color:var(--ember)}
  .happening-item.move .happening-mark{color:var(--signal)}
  .happening-item .happening-say b{color:var(--ice);font-weight:650}
  .happening-item .happening-when{margin-left:auto;flex:none;font-family:var(--mono);
    font-size:11px;color:var(--graphite)}
  .happening-empty{color:var(--graphite);margin:10px 0 0}
</style>

<style id="campaignFlow">
  /* ============ THE CAMPAIGN WORKFLOW ==================================
     Owner verdict 2026-08-16, after two translation passes: "there is NO
     WORKFLOW. No A, B, C, 1, 2, 3 feel. I'm bombarded by the tool. Make it
     like LeadMiner, which has a FLOW." So the Command Center is a workflow,
     not a dashboard: four glance numbers, ONE big Start-a-new-campaign card
     with a numbered 1-2-3 wizard and ONE huge GO button, then the run.

     THE TYPE LAW. One column, generous whitespace, an 18px body floor,
     headlines 22px+, card numbers 32px+. Selectors carry #cockpit so they
     beat the shared operator layers that render after the head. */

  #launchSection{margin-top:30px}
  #cockpit .sec-head h2{font-size:24px!important;letter-spacing:-.02em}
  #cockpit .wz-rail{display:flex;gap:10px 26px;flex-wrap:wrap;list-style:none;margin:0 0 16px;padding:0}
  #cockpit .wz-ri{display:flex;align-items:center;gap:10px;color:var(--graphite)}
  #cockpit .wz-dot{display:grid;place-items:center;width:34px;height:34px;flex:none;
    border:1px solid var(--hair);border-radius:50%;background:rgba(255,255,255,.03);
    font-size:18px;font-weight:750;color:var(--graphite)}
  #cockpit .wz-ri[aria-current="step"]{color:var(--ice)}
  #cockpit .wz-ri[aria-current="step"] .wz-dot{border-color:transparent;background:var(--grad-signal);color:#fff}
  #cockpit .wz-ri[data-done] .wz-dot{border-color:rgba(52,211,153,.45);color:var(--pulse)}
  #cockpit .wz-rt{font-size:18px;font-weight:650;line-height:1.3}
  #cockpit .wz-rt small{display:block;font-size:18px;font-weight:500;color:var(--graphite)}

  /* ONE STEP AT A TIME. The .launch container keeps its id contract but stops
     being a 12-column grid: the wizard is a single calm column. */
  #launchSection .launch{display:block!important}
  #cockpit .wz-step{border:1px solid var(--hair);border-radius:16px;padding:20px 22px 22px;
    background:linear-gradient(180deg,#15151B,#111116);margin:0 0 14px}
  #cockpit .wz-q{margin:0 0 14px;font-size:24px;font-weight:750;letter-spacing:-.02em}
  #cockpit .wz-step .fstep{margin-bottom:12px}
  #cockpit .fstep .flabel,#cockpit .fstep-hint,#cockpit .wz-choice span,#cockpit .wz-gohint{font-size:18px;line-height:1.6}
  #cockpit .wz-nav{display:flex;gap:10px;margin-top:16px}
  #cockpit .wz-next,#cockpit .wz-back{min-height:48px;padding:13px 22px;font-size:16.5px}
  /* The four Build-N buttons keep their compact-deck clothes; inside the
     wizard they just stop pretending to sit in a 12-column grid. */
  #launchSection .fbtns{display:flex;gap:10px;flex-wrap:wrap}
  #launchSection .fbtns .launchBtn{grid-column:auto!important;flex:1 1 0;min-height:52px;font-size:16.5px}
  #launchSection .fbtns .launchBtn.picked{border-color:transparent!important;background:var(--grad-pulse)!important;
    color:#fff!important;outline:3px solid rgba(52,211,153,.55);outline-offset:2px}
  /* THE CHOICES in step 3 — practice vs real, in the owner's own promise. */
  #cockpit .wz-choices{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
  #cockpit .wz-choice{display:flex;flex-direction:column;gap:8px;text-align:left;cursor:pointer;
    min-height:118px;padding:16px 18px;border:1px solid var(--hair);border-radius:14px;
    background:rgba(255,255,255,.018);color:var(--ice);font-family:var(--sans)}
  #cockpit .wz-choice b{font-size:18.5px;font-weight:750;letter-spacing:-.01em}
  #cockpit .wz-choice span{color:var(--slate)}
  #cockpit .wz-choice.picked{border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.07)}
  #cockpit .wz-choice[data-lane="live"].picked{border-color:rgba(242,109,109,.5);background:rgba(242,109,109,.06)}
  #cockpit .wz-choice.picked b{color:var(--pulse)}
  #cockpit .wz-choice[data-lane="live"].picked b{color:var(--rose)}
  /* THE ONE HUGE GO BUTTON. */
  #cockpit .wz-go{display:block;width:100%;min-height:72px;margin-top:4px;padding:22px 32px;
    border-radius:16px;font-size:22px;font-weight:800;letter-spacing:.01em;
    box-shadow:0 18px 44px rgba(74,108,247,.28)}
  #cockpit .wz-go:not(:disabled):hover{filter:brightness(1.07)}
  #cockpit .wz-go:disabled{cursor:not-allowed}

  /* The glance deck, compressed: same four honest numbers, less height. */
  #cockpit .glance-grid{gap:10px}
  #cockpit .glance-card{padding:14px 16px 14px}
  #cockpit .glance-k{font-size:17px}
  #cockpit .glance-num{font-size:clamp(32px,3vw,38px);margin:7px 0 6px}
  #cockpit .glance-sub{font-size:18px}
  #cockpit .glance-tip{font-size:18px}

  /* THE RUN, in plain order: what is this → what's happening → what do I do
     next. The control tower leads its sentence with the count, and every
     card number on the flow reads at 32px+. */
  #cockpit .ct-big b{font-size:52px}
  #cockpit .ct-big span{font-size:21px}
  #cockpit .ct-title h2{font-size:26px}
  #cockpit .ct-title p{font-size:18px;line-height:1.6}
  #cockpit .ct-note{font-size:18px;line-height:1.6}
  #cockpit .happening-say,#cockpit .happening-empty{font-size:18px}

  @media(max-width:760px){
    #cockpit .wz-choices{grid-template-columns:1fr}
    #cockpit .wz-rt{font-size:18px}
    #cockpit .wz-q{font-size:22px}
    #cockpit .wz-go{font-size:20px;min-height:64px}
    #cockpit .fbtns .launchBtn{flex:1 1 40%}
  }
  @media(max-width:420px){
    #cockpit .fbtns .launchBtn{flex:1 1 100%}
    #cockpit .wz-next,#cockpit .wz-back{width:100%}
  }
  @media(prefers-reduced-motion:reduce){
    #cockpit .wz-choice,#cockpit .wz-dot{transition:none}
  }
  /* Arcade hero host — the module owns its own colors and motion; the page only
     gives it breathing room and, in demo, one quiet violet frame (no glass). */
  #wssArcadeHero{margin:0 0 18px}
  #cockpit[data-demo="1"] #wssArcadeHero{box-shadow:0 0 0 1px rgba(124,108,246,.35),0 18px 70px rgba(124,108,246,.14)}
</style>

</head><body>
${operatorNav("console")}

<div class="wrap locked" id="cockpit" inert aria-hidden="true">
  <header class="board-masthead">
    <div class="brand-cluster">
    <div class="mark">
      <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 64 64" role="img" aria-labelledby="wssMarkTitle"><title id="wssMarkTitle">WSS Labs</title><defs><linearGradient id="boardWssMark" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6CF7"></stop><stop offset="1" stop-color="#8B5CF6"></stop></linearGradient></defs><rect width="64" height="64" rx="15" fill="#131318"></rect><rect x="0.5" y="0.5" width="63" height="63" rx="14.5" fill="none" stroke="#FFFFFF" stroke-opacity="0.09"></rect><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#boardWssMark)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="7" fill="#34D399" opacity="0.22"></circle><circle cx="50" cy="20" r="4" fill="#34D399"></circle></svg>
    </div>
    <div class="lockup"><div class="t">Command Center</div><div class="s">WSS Labs</div></div>
    </div>
    <div class="head-right">
      <button class="pill off" id="changePasswordBtn" type="button" hidden>Change password</button>
      <button class="pill off" id="signOutBtn" type="button" hidden>Sign out</button>
      <span class="pill off" id="readyPill" role="status" aria-live="polite">Checking readiness</span>
    </div>
  </header>

  <!-- THE STOP SWITCH. Above the tabs on purpose: it belongs to every screen,
       not to one panel. State is read from /api/admin/outreach-pause, never
       from this browser, so a reload cannot make it claim a halt that is not
       set. -->
  <div class="halt" id="haltBar" data-halt="unknown">
    <span class="halt-lamp" aria-hidden="true"></span>
    <div>
      <div class="halt-title" id="haltTitle">Reading the stop switch…</div>
      <div class="halt-sub" id="haltSub">Asking the server whether outreach is paused.</div>
    </div>
    <button class="halt-btn" id="haltBtn" type="button" disabled>STOP ALL SENDS</button>
    <div class="halt-scope">
      <b>Stop halts:</b> every email heading to a business owner at the moment of send · the hourly drip · a running batch before it starts the next site · a running send pass before its next email · the mining waves this page fires.
      <b>Stop cannot recall:</b> the one site or the one email already in flight when you press it — and it does not block a proof addressed to your own inbox.
    </div>
    <div class="halt-out" id="haltOut" role="status" aria-live="assertive" hidden></div>
  </div>

  <!-- Filled by loadBatches from the same server snapshot the batch panel
       reads — never asserted. Points at the page built for approvals. -->
  <a class="ready-banner" id="readyBanner" href="/campaigns" hidden></a>

  <!-- Blended ops nav (owner instruction 2026-08-04): Command Center stays the
       default, one-screen view; Operations and Line Detail load the older
       pages in place instead of sending the operator to a new tab. -->
  <div class="console-nav-row">
  <nav class="tabbar" id="consoleTabs" role="tablist" aria-label="Console sections">
    <button class="tab" type="button" role="tab" tabindex="-1" aria-selected="false" aria-controls="tabPanelMap" id="tabBtnMap" data-tabid="map">Live Map</button>
    <button class="tab active" type="button" role="tab" tabindex="0" aria-selected="true" aria-controls="tabPanelCommand" id="tabBtnCommand" data-tabid="command">Command Center</button>
    <button class="tab" type="button" role="tab" tabindex="-1" aria-selected="false" aria-controls="tabPanelAgents" id="tabBtnAgents" data-tabid="agents">Agents &amp; Calls</button>
    <button class="tab" type="button" role="tab" tabindex="-1" aria-selected="false" aria-controls="tabPanelOperations" id="tabBtnOperations" data-tabid="operations">Operations</button>
    <button class="tab" type="button" role="tab" tabindex="-1" aria-selected="false" aria-controls="tabPanelLine" id="tabBtnLine" data-tabid="line">Engine room</button>
  </nav>
  <!-- Gallery and Campaigns moved into the shared operator bar at the top of
       every page (lib/operator-nav.js), so this row is only the console's own
       sections. Two navigations that named the same places differently was the
       thing that left the owner "stranded" on the pages without one. -->
  </div>

  <div class="tabpanel" id="tabPanelMap" role="tabpanel" aria-labelledby="tabBtnMap" hidden>
    <!-- Rendered entirely by JS from the live snapshot, so the approved static
         markup (and its design pins) stay byte-identical. -->
    <div id="liveMap"></div>
  </div>

  <div class="tabpanel active" id="tabPanelCommand" role="tabpanel" aria-labelledby="tabBtnCommand">

  <!-- ============ WSS GHOST ARCADE — THE OVERVIEW HERO ============ -->
  <!-- The living factory map + run theater, mounted by lib/console-arcade-layer
       (inlined below the markup so there is no second request). It is a WATCHING
       SURFACE ONLY: it owns no controls and starts no work. Everything it shows
       is fed from the same polls the console already runs (console-data, line)
       plus the visible-only vapi/gallery/revenue reads in the arcade block —
       and ?demo=arcade swaps it to the clearly-banned synthetic loop with zero
       fetches. The glance deck, wizard, pipeline and feed below stay exactly as
       approved; this layer is additive. Ambient motion never implies work: real
       animations come only from real observed transitions. -->
  <div id="wssArcadeHero" role="region" aria-label="Factory arcade overview"></div>

  <!-- WHAT IS THIS? — the four numbers the studio runs on, then THE FRONT DOOR:
       one campaign wizard. Owner verdict 2026-08-16: "there is NO WORKFLOW. No
       A, B, C, 1, 2, 3 feel." This tab now answers, in order: What is this?
       (the glance deck) → What do I do next? (Start a new campaign) → What's
       happening? (the control tower, the live feed, the sites). While a run is
       working the wizard collapses and the run leads. Rendered by JS
       (renderGlance) from the same console-data snapshot — no new endpoint. -->
  <div class="glance" id="glanceDeck" role="region" aria-label="Your studio at a glance"></div>

  <!-- ============ START A NEW CAMPAIGN — the front door ============ -->
  <!-- Owner verdict 2026-08-16: "there is NO WORKFLOW. No A, B, C, 1, 2, 3
       feel. I'm bombarded by the tool." So the launcher is now ONE big card:
       a numbered 1-2-3 wizard with one step visible at a time, ending in ONE
       huge GO button. The ids, the payload and the safety copy are the
       launch deck's own — #mineVertical, #mineLocation, the four .launchBtn
       Build-N buttons, #laneMode and #launchOut all survive so the pinned
       contracts (and the server) see the exact same launch. -->
  <section id="launchSection">
    <div class="sec-head"><h2 title="Answer three quick questions and press one button. We find the businesses, build the websites and get them ready for your OK.">Start a new campaign<span class="qhint" aria-hidden="true" title="Answer three quick questions and press one button. We find the businesses, build the websites and get them ready for your OK."></span></h2><span class="label" title="One step at a time: who to reach, how many websites, practice or real — then one button.">1 reach · 2 how many · 3 practice or real</span></div>
    <div class="launch" id="campaignWizard">
      <!-- THE NUMBERED RAIL — always visible, so the 1-2-3 never gets lost. -->
      <ol class="wz-rail" id="wzRail" aria-label="Campaign setup — three steps">
        <li class="wz-ri" data-wstep="1" aria-current="step"><span class="wz-dot num" aria-hidden="true">1</span><span class="wz-rt">Who are we reaching?</span></li>
        <li class="wz-ri" data-wstep="2"><span class="wz-dot num" aria-hidden="true">2</span><span class="wz-rt">How many websites?</span></li>
        <li class="wz-ri" data-wstep="3"><span class="wz-dot num" aria-hidden="true">3</span><span class="wz-rt">Practice or real?</span></li>
      </ol>

      <!-- STEP 1 — who are we reaching? -->
      <section class="wz-step" id="wzStep1" data-wstep="1" aria-labelledby="wzQ1">
        <h3 class="wz-q" id="wzQ1">1 · Who are we reaching?</h3>
        <!-- Without a target, /api/admin/line reuses STORED prospects — a find
             button that doesn't find. A target ("fencing in Tulsa OK") makes
             pickProspects run real LeadMiner discovery with build-ready
             contracts, so the picker gates the buttons. Trades listed are the
             OPEN ones (clean starter design + not outreach-retired). -->
        <div class="fstep" id="stepTrade">
          <div class="frow"><span class="fnum" aria-hidden="true">1</span><span class="flabel" id="stepTradeLabel">Their trade — the kind of business you want as a customer</span></div>
          <select id="mineVertical" class="mine-field" aria-label="What trade? Pick the kind of business you want as customers.">
            <option value="">Pick the kind of business…</option>
            <option value="leadminer">All trades — from our finished research</option>
          </select>
          <span class="fstep-hint" id="donorCatalogStatus" role="status">Checking donor catalog…</span>
        </div>
        <div class="fstep" id="stepWhere">
          <div class="frow"><span class="fnum" aria-hidden="true">1</span><span class="flabel">Their city — or all of America</span></div>
          <input id="mineLocation" class="mine-field" type="text" placeholder="City, ST — or leave blank for anywhere in America" aria-label="Where? City and state, or leave blank for anywhere in America.">
          <span class="fstep-hint">Leave it blank and each run picks a new part of America on its own.</span>
        </div>
        <div class="wz-nav">
          <button type="button" class="btn wz-next" id="wzNext1" data-next="2" disabled>Next — how many websites?</button>
        </div>
      </section>

      <!-- STEP 2 — how many websites? The four pinned Build-N buttons live
           here unchanged (same classes, same data-n, same disabled law). -->
      <section class="wz-step" id="wzStep2" data-wstep="2" aria-labelledby="wzQ2" hidden>
        <h3 class="wz-q" id="wzQ2">2 · How many websites?</h3>
        <div class="fstep" id="stepCount">
          <div class="frow"><span class="fnum" aria-hidden="true">2</span><span class="flabel">Pick one number</span></div>
          <div class="fbtns">
            <button class="btn launchBtn" data-n="10" disabled>Build 10</button>
            <button class="btn launchBtn" data-n="50" disabled>Build 50</button>
            <button class="btn launchBtn" data-n="100" disabled>Build 100</button>
            <button class="btn ghost launchBtn" data-n="500" disabled>Build 500</button>
          </div>
          <span class="fstep-hint">That number means finished, email-ready websites. Start with 10, look, then scale up.</span>
        </div>
        <div class="wz-nav">
          <button type="button" class="btn ghost wz-back" data-back="1">Back</button>
          <button type="button" class="btn wz-next" id="wzNext2" data-next="3" disabled>Next — practice or real?</button>
        </div>
      </section>

      <!-- STEP 3 — practice or real, then THE ONE BIG BUTTON.
           #laneMode stays the single source of truth for the lane (its
           data-lane is what currentLane() reads and what the pinned launch
           contract carries); the two visible choices just set it. -->
      <section class="wz-step" id="wzStep3" data-wstep="3" aria-labelledby="wzQ3" hidden>
        <h3 class="wz-q" id="wzQ3">3 · Practice or real?</h3>
        <div class="wz-choices">
          <button type="button" class="wz-choice picked" data-lane="sandbox" aria-pressed="true">
            <b>Practice — emails come only to you</b>
            <span>Every email lands in your own inbox and nowhere else. Sandbox may auto-send proof only to your inbox when enabled server-side.</span>
          </button>
          <button type="button" class="wz-choice" data-lane="live" aria-pressed="false">
            <b>Real — business owners get emails after your OK</b>
            <span>Nothing goes out until you approve it, and you get a copy of every one. If the server-side safety switch is off, the run will refuse and say so.</span>
          </button>
        </div>
        <button id="laneMode" class="btn ghost" type="button" data-lane="sandbox" hidden>Practice mode — every email comes only to you</button>
        <button id="goButton" class="btn wz-go" type="button" disabled>Start my campaign</button>
        <span class="fstep-hint wz-gohint">Press it and the run starts here on this screen — watch it build live below.</span>
      </section>

      <div class="send-law" role="note">Every email still needs your OK. Nothing reaches a business owner without you.</div>
      <div class="launch-note" id="launchOut" role="status" aria-live="polite">
        <b>Build N means N finished websites and N finished email banners.</b>
        The server first finds a business with a usable published email, then builds and checks its site.
        Rejected, duplicate, uncontactable or failed businesses are replaced automatically and do not consume your requested total.
        Live waits for approval. Sandbox routes every approved proof only to your inbox.
      </div>
    </div>
  </section>

  <!-- THE DOMINANT COUNT — WHAT'S HAPPENING. Filled by renderPipelineHead
       from the same server batch snapshot the rows below read — "6 of 10
       built", the tally, and the plain answer to "where do I push the emails
       through". Never a literal, never asserts a number the row list does
       not show. -->
  <div class="pipe-hero" id="pipeHero" role="status" aria-live="polite">
    <div class="ph-empty"><div class="ph-empty-k">Reading your run…</div></div>
  </div>

  <!-- ============ HAPPENING NOW ============ -->
  <!-- WHAT'S HAPPENING? Plain sentences built by renderHappeningNow from the
       same /api/admin/line rows the campaign list renders — no new endpoint,
       no invented steps. -->
  <div class="happening" id="happeningNow" role="region" aria-label="Happening now"></div>

  <!-- ============ SITES IN THIS CAMPAIGN ============ -->
  <section>
    <div class="sec-head"><h2 title="Every website in the run you started, with its live status — building, waiting for your OK, sent, or refused.">Sites in this campaign<span class="qhint" aria-hidden="true" title="Every website in the run you started, with its live status — building, waiting for your OK, sent, or refused."></span></h2><span class="label" title="You asked for N websites; this list is those exact websites, one line each.">one slot = one finished, email-ready website</span></div>
    <div class="card c12" id="batchPanel" role="region" aria-label="Live batches" aria-live="polite" aria-atomic="false" style="padding:14px 18px">
      <div class="row"><span class="k">Nothing built yet this visit — answer the three questions above, press Start my campaign, and this fills in live.</span></div>
    </div>
  </section>

  <!-- The owner-facing console ends at the workflow. The readiness detail the
       old card grid carried (model capacity, gate rows, the qualification
       funnel, last-car evidence, provider keys) lives one tab over in the
       Engine room, and the masthead pill above still says, in one honest
       word-group, whether everything is ready. -->

  <footer>
    <span>NOTHING SENDS WITHOUT YOUR APPROVAL</span>
  </footer>
  </div>

  <!-- Agents & Calls (owner request 2026-08-06). Rendered by JS from
       /api/admin/console-data?view=agents on first open — one fetch, no
       second poll loop. -->
  <div class="tabpanel" id="tabPanelAgents" role="tabpanel" aria-labelledby="tabBtnAgents" hidden>
    <div id="agentsView"><p class="why">Open the command center with your operator token first.</p></div>
  </div>

  <div class="tabpanel" id="tabPanelOperations" role="tabpanel" aria-labelledby="tabBtnOperations" hidden>
    <!-- MORNING_REPORT_PANEL_BEGIN -->
    <div class="card c12 morning-report" id="morningReportCard">
      <div class="mr-head">
        <div>
          <span class="label">Daily digest</span>
          <h2>Morning Report</h2>
          <p class="mr-window" id="morningReportWindow">Measured from the durable operations ledger.</p>
        </div>
        <button class="btn ghost mr-refresh" id="morningReportRefresh" type="button">Refresh</button>
      </div>
      <div class="mr-status" id="morningReportBody" role="status" aria-live="polite">Open Operations to load the latest measured window.</div>
    </div>
    <!-- MORNING_REPORT_PANEL_END -->
    <div class="card c12 tabframe" id="opsFrameCard">
      <p class="why">Operations loads the systems &amp; agents deck on first open — same operator token, no re-entry.</p>
    </div>
  </div>

  <div class="tabpanel" id="tabPanelLine" role="tabpanel" aria-labelledby="tabBtnLine" hidden>
    <div class="lw" id="lineWorkshop" aria-live="polite">
      <div class="lw-empty">Open the command center with your operator token first.</div>
    </div>
  </div>
</div>

<div class="access" id="accessGate" role="dialog" aria-modal="true" aria-labelledby="accessTitle">
  <form class="access-card" id="accessForm">
    <h1 id="accessTitle">Operator access</h1>
    <p>Enter your owner password to open the live command center. The password is never stored in this browser; it is exchanged server-side for a signed session, and only that signed session token stays here.</p>
    <input id="tokenInput" type="password" autocomplete="current-password" aria-label="Owner password" required>
    <button class="btn" id="accessButton" type="submit">Open command center</button>
    <p class="access-status" id="accessStatus" role="alert" aria-live="polite"></p>
  </form>
</div>

<div class="access" id="passwordGate" role="dialog" aria-modal="true" aria-labelledby="passwordTitle" hidden>
  <form class="access-card" id="passwordForm">
    <h1 id="passwordTitle">Change owner password</h1>
    <p>The password is stored only as a salted verifier. Changing it signs every other browser out and refreshes this browser's session.</p>
    <input id="currentPassword" type="password" autocomplete="current-password" aria-label="Current password" required placeholder="Current password">
    <input id="newPassword" type="password" autocomplete="new-password" minlength="12" aria-label="New password, at least 12 characters" required placeholder="New password — at least 12 characters">
    <input id="confirmPassword" type="password" autocomplete="new-password" aria-label="Confirm new password" required placeholder="Confirm new password">
    <button class="btn" id="passwordGo" type="submit">Change password</button>
    <button class="btn" id="passwordCancel" type="button">Cancel</button>
    <p class="access-status" id="passwordStatus" role="alert" aria-live="polite"></p>
  </form>
</div>

<!-- WSS GHOST ARCADE module — self-contained, zero network calls, zero new
     requests (inlined; the same string-serving pattern as this page). Loaded
     BEFORE the controller so window.WSSArcade exists when the hero mounts. -->
<script>
${require("./console-arcade-layer")}
</script>
<script>
(function(){
  "use strict";
  var KEY="wsl_admin_token";
  var pollTimer=null;
  var loadInFlight=null;
  var cockpit=document.getElementById("cockpit");
  var accessGate=document.getElementById("accessGate");
  var accessForm=document.getElementById("accessForm");
  var accessButton=document.getElementById("accessButton");
  var tokenInput=document.getElementById("tokenInput");
  var accessStatus=document.getElementById("accessStatus");
  var signOutBtn=document.getElementById("signOutBtn");
  var changePasswordBtn=document.getElementById("changePasswordBtn");
  var passwordGate=document.getElementById("passwordGate");
  var passwordForm=document.getElementById("passwordForm");
  var passwordGo=document.getElementById("passwordGo");
  var passwordCancel=document.getElementById("passwordCancel");
  var passwordStatus=document.getElementById("passwordStatus");
  var launchOut=document.getElementById("launchOut");
  var gateReturnFocus=null;
  var launchBusy=false;
  var startRetryKeys=Object.create(null);

  // ---- THE OPERATOR'S PLAIN WORDS (lib/operator-voice, inlined) -----------
  // Same dictionary the server renders the static markup with, handed to the
  // browser as data — one source of truth, zero extra requests.
  var VOICE_PLAIN=${JSON.stringify(PLAIN)};
  var VOICE_STATUS=${JSON.stringify(STATUS)};
  var VOICE_TIPS=${JSON.stringify(TIPS)};
  function voiceNormalize(s){return String(s==null?"":s).trim().toLowerCase().replace(/[\\s-]+/g,"_");}
  function voiceChip(status){
    var hit=VOICE_STATUS[voiceNormalize(status)];
    if(hit)return {label:hit[0],tone:hit[1]};
    if(!voiceNormalize(status))return {label:"Not reported",tone:"neutral"};
    var words=String(status).replace(/[_-]+/g," ").trim().replace(/\\b([a-z])/g,function(c){return c.toUpperCase();});
    return {label:words,tone:"neutral"};
  }
  function voiceTip(){
    var minute=Math.floor(Date.now()/60000);
    return VOICE_TIPS.length?VOICE_TIPS[minute%VOICE_TIPS.length]:"";
  }

  function token(){try{return localStorage.getItem(KEY)||"";}catch(_){return "";}}
  function setToken(value){try{localStorage.setItem(KEY,value);}catch(_){}}
  function clearToken(){try{localStorage.removeItem(KEY);}catch(_){}}
  function byId(id){return document.getElementById(id);}
  function finite(value){var number=Number(value);return Number.isFinite(number)&&number>=0?Math.round(number):null;}
  function shown(value){var number=finite(value);return number===null?"—":number.toLocaleString();}
  function setValue(id,text,tone){var node=byId(id);if(!node)return;node.textContent=text;node.classList.remove("ok","warn","bad","mut");if(tone)node.classList.add(tone);}
  function errorWithStatus(message,status,payload){var error=new Error(message);error.status=status;error.payload=payload;return error;}

  function api(path,opts){
    opts=opts||{};
    if(!token())return Promise.reject(errorWithStatus("Operator token required",401));
    opts.headers=Object.assign({},opts.headers||{});
    opts.headers["x-admin-token"]=token();
    return fetch(path,opts).then(function(response){
      return response.text().then(function(raw){
        var payload={};
        try{payload=raw?JSON.parse(raw):{};}catch(_){payload={message:raw};}
        if(!response.ok)throw errorWithStatus(payload.message||payload.error||("Request failed ("+response.status+")"),response.status,payload);
        return payload;
      });
    });
  }

  function post(path,body){
    if(path==="/api/admin/line"&&body&&body.action==="start"&&!body.idempotencyKey){
      var signature=startSignature(body.lane,body.target,body.count);
      body=Object.assign({},body,{idempotencyKey:startKeyFor(signature)});
    }
    return api(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  }

  // Owner login: the password is exchanged server-side for a signed session
  // (POST /api/admin/session). The password itself is never stored in this
  // browser — only the signed session token (the same contract the
  // 2026-08-19 login-recovery hotfix protected). load() then validates the
  // fresh session against /api/admin/line before the gate opens.
  function loginWithPassword(password){
    return fetch("/api/admin/session",{
      method:"POST",
      headers:{"content-type":"application/json",accept:"application/json"},
      cache:"no-store",
      body:JSON.stringify({password:password})
    }).then(function(response){
      return response.text().then(function(raw){
        var payload={};
        try{payload=raw?JSON.parse(raw):{};}catch(_){payload={message:raw};}
        if(!response.ok||!payload||!payload.token){
          throw errorWithStatus(payload.error||payload.message||("Request failed ("+response.status+")"),response.status,payload);
        }
        return payload;
      });
    });
  }

  function newStartIdempotencyKey(){
    var source=window.crypto;
    if(!source||typeof source.getRandomValues!=="function")throw new Error("Secure random launch keys are unavailable in this browser");
    var bytes=new Uint8Array(16);
    source.getRandomValues(bytes);
    return "launch-"+Array.prototype.map.call(bytes,function(value){return value.toString(16).padStart(2,"0");}).join("");
  }
  function startSignature(lane,target,count){
    return JSON.stringify([String(lane||""),String(target||""),Number(count)||0]);
  }
  function startKeyFor(signature){
    if(!startRetryKeys[signature])startRetryKeys[signature]=newStartIdempotencyKey();
    return startRetryKeys[signature];
  }
  function clearStartRetryKey(signature,key){
    if(!signature){startRetryKeys=Object.create(null);return;}
    if(!key||startRetryKeys[signature]===key)delete startRetryKeys[signature];
  }
  function startFailureRetryable(error){
    var status=Number(error&&error.status)||0;
    var payload=error&&error.payload;
    if(payload&&payload.retryable===true)return true;
    return !status||status===408||status===425||status===429||status>=500;
  }

  function showGate(message){
    var active=document.activeElement;
    if(active&&active!==document.body&&!accessGate.contains(active))gateReturnFocus=active;
    accessGate.hidden=false;
    cockpit.classList.add("locked");
    cockpit.setAttribute("inert","");
    cockpit.setAttribute("aria-hidden","true");
    accessStatus.textContent=message||"";
    accessButton.disabled=false;
    accessButton.textContent="Open command center";
    signOutBtn.hidden=true;
    changePasswordBtn.hidden=true;
    window.setTimeout(function(){tokenInput.focus();},0);
  }

  function hideGate(){
    var wasOpen=!accessGate.hidden;
    accessGate.hidden=true;
    cockpit.classList.remove("locked");
    cockpit.removeAttribute("inert");
    cockpit.removeAttribute("aria-hidden");
    accessStatus.textContent="";
    tokenInput.value="";
    signOutBtn.hidden=false;
    changePasswordBtn.hidden=false;
    if(wasOpen)window.setTimeout(function(){
      var fallback=document.querySelector('#consoleTabs [role="tab"][aria-selected="true"]');
      var target=gateReturnFocus&&document.contains(gateReturnFocus)?gateReturnFocus:fallback;
      gateReturnFocus=null;
      if(target&&typeof target.focus==="function")target.focus();
    },0);
  }

  accessGate.addEventListener("keydown",function(event){
    if(event.key!=="Tab"||accessGate.hidden)return;
    var focusable=[tokenInput,accessButton].filter(function(node){return node&&!node.disabled;});
    if(!focusable.length)return;
    var first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });

  function statusCount(snapshot,names){
    var wanted=names.map(function(name){return String(name).toLowerCase();});
    return (Array.isArray(snapshot.funnel)?snapshot.funnel:[]).reduce(function(total,row){
      return wanted.indexOf(String(row&&row.status||"").toLowerCase())>=0?total+(finite(row&&row.count)||0):total;
    },0);
  }

  // The masthead's one honest readiness pill. The gate rows it used to sit
  // beside moved to the Engine room tab; what stays on the owner's front door
  // is a single plain verdict, driven by the same snapshot (and the same
  // fail-closed halt read) as before.
  function renderReadiness(snapshot){
    var hardStops=Array.isArray(snapshot.hardStops)?snapshot.hardStops:[];
    // A halt is a blocker by definition, and this snapshot is served from a
    // short cache — so "All systems ready" could sit next to a red ALL SENDING
    // IS HALTED bar for a poll or two. It never does now.
    var haltedNow=Boolean(halt&&halt.active===true);
    var ready=snapshot.ready===true&&!haltedNow;
    var pill=byId("readyPill");
    pill.textContent=ready?"All systems ready":(haltedNow?"Sending halted":(hardStops.length?(hardStops.length+" system blocker"+(hardStops.length===1?"":"s")):"System not ready"));
    pill.className="pill "+(ready?"live":"warn");
  }

  function humanStatus(value){
    return String(value||"No additional stage").replace(/[_-]+/g," ").replace(/\b\w/g,function(letter){return letter.toUpperCase();});
  }

  function safeHttpUrl(value){
    // An EMPTY value resolves against the page origin and comes back as THIS
    // console's own URL — which is how a lead with no preview_url ended up
    // rendering the command center as if it were the client's finished site.
    // Absent is absent.
    if(!String(value==null?"":value).trim())return "";
    try{var parsed=new URL(String(value||""),window.location.origin);return /^https?:$/.test(parsed.protocol)?parsed.href:"";}catch(_){return "";}
  }

  // =================================================================
  // YOUR STUDIO AT A GLANCE
  // -----------------------------------------------------------------
  // Owner instruction 2026-08-16: four big readable numbers at the top —
  // what each counts, and what to do next, in one plain line. Sources are
  // the SAME snapshot and batch list the panels below already read; no new
  // endpoint. TRUTH LAW: an absent number renders 0 beside an honest
  // "none yet" line — never a placeholder, never a guess. "Built this
  // week" is measured from the recorded line batches (console-data carries
  // no weekly build field); before that list has answered, the card says
  // it is still reading rather than claiming zero.
  // =================================================================
  var glanceSnap=null,glanceBatchesSeen=false;
  function glanceNum(value){return value===null?"—":value.toLocaleString();}
  function renderGlance(snapshot){
    if(snapshot)glanceSnap=snapshot;
    var host=byId("glanceDeck");
    if(!host)return;
    var snap=glanceSnap||{};
    var totals=snap.totals||{},engagement=snap.engagement||{};
    var live=finite(engagement.previews);
    var ready=finite(totals.sendable);
    var waiting=statusCount(snap,["line_queued"]);
    var week=null,weekNote="";
    if(mapBatches&&mapBatches.length){
      glanceBatchesSeen=true;
      var weekAgo=Date.now()-7*24*60*60*1000,weekCount=0;
      (mapBatches||[]).forEach(function(b){
        (b.rows||[]).forEach(function(r){
          if(rowDead(r))return;
          if(r.status!=="queued"&&r.status!=="sent")return;
          var at=Date.parse(String(r.updatedAt||""));
          if(Number.isFinite(at)&&at>=weekAgo)weekCount+=1;
        });
      });
      week=weekCount;
    }
    var generated=snap.generatedAt?new Date(snap.generatedAt):null;
    var stamp=generated&&!Number.isNaN(generated.getTime())?("updated "+generated.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})):"live numbers";
    function card(cls,key,num,sub){
      return '<div class="glance-card'+(cls?" "+cls:"")+'"><div class="glance-k">'+key+'</div>'
        +'<div class="glance-num num">'+glanceNum(num)+'</div><span class="glance-sub">'+sub+'</span></div>';
    }
    var liveSub=live>0
      ?'Finished websites, built and ready to show a business owner. <b>Open them from your campaign below.</b>'
      :'Finished websites we built for business owners. <span class="glance-none">None yet — build your first below.</span>';
    var readySub=ready>0
      ?'Businesses with a good email address, ready when you are. <b>Every email still needs your OK.</b>'
      :'Businesses with a good email address we could email today. <span class="glance-none">None yet — start your first campaign below.</span>';
    var waitSub=waiting>0
      ?'<a href="/campaigns">Finished websites parked for your OK — give the word on Your campaigns.</a>'
      :'Finished websites parked until you say go. <span class="glance-none">Nothing is waiting — nice.</span>';
    var weekSub;
    if(week===null)weekSub='Websites finished in the last 7 days. <span class="glance-none">Still reading your recent runs…</span>';
    else if(week>0)weekSub='Websites finished in the last 7 days, from your recorded runs. <b>Keep it up — or start another below.</b>';
    else weekSub='Websites finished in the last 7 days. <span class="glance-none">None yet this week — start one below.</span>';
    host.innerHTML='<div class="glance-head">'
      +'<h2 title="The four numbers your studio runs on, and what to do next for each.">Your studio at a glance<span class="qhint" aria-hidden="true" title="The four numbers your studio runs on, and what to do next for each."></span></h2>'
      +'<span class="label" title="Every number is measured from the live server snapshot — nothing here is a guess.">'+esc(stamp)+'</span></div>'
      +'<div class="glance-grid">'
      +card("","Live websites",live,liveSub)
      +card("","Ready to email",ready,readySub)
      +card("waiting","Waiting on you",waiting,waitSub)
      +card("","Built this week",week,weekSub)
      +'</div>'
      +'<div class="glance-tip"><span class="tip-k">Riley tip</span><span>'+esc(voiceTip())+'</span></div>';
  }

  // =================================================================
  // HAPPENING NOW — the same batch/row state, as plain sentences
  // -----------------------------------------------------------------
  // Mission 2026-08-16: the owner reads sentences, not state machines.
  // Every line below is derived from the SAME /api/admin/line rows the
  // campaign list renders (rowDead/rowMotion/batchRunning), so the feed can
  // never claim a step the picture does not show. Failure reasons are the
  // machine's own recorded words, lower-cased into a sentence.
  // =================================================================
  function plainFailReason(r){
    var why=String(r&&r.reason||"").trim();
    if(!why&&Array.isArray(r&&r.failedFacts)&&r.failedFacts.length)why=r.failedFacts.join(", ");
    if(!why){
      if(r&&r.status==="rejected")why="didn't meet our quality bar";
      else if(r&&r.status==="gate_failed")why="failed final inspection";
      else if(r&&r.status==="error")why="something went wrong";
      else why="we couldn't use it";
    }
    return trunc(why.toLowerCase(),90);
  }
  function happeningSentence(b,r,index,goal){
    var name=esc(r.businessName||r.prospectId||"a business");
    var where=[r.city,r.state].filter(Boolean).join(", ");
    var at=index+" of "+(goal||"?");
    if(rowDead(r))return {tone:"bad",mark:"✗",say:"Couldn't build "+at+" — "+esc(plainFailReason(r))+(batchRunning(b)?", skipping to the next business":"")};
    if(r.status==="sent")return {tone:"good",mark:"✓",say:"Email sent — <b>"+name+"</b>"};
    if(r.status==="queued")return {tone:"wait",mark:"✓",say:"<b>"+name+"</b> passed final inspection — waiting for your OK"};
    if(r.status==="gate_passed")return {tone:"good",mark:"✓",say:"Final inspection passed for <b>"+name+"</b>"+" — preparing its email"};
    if(r.status==="mirrored")return {tone:"move",mark:"•",say:"Checking <b>"+name+"</b>'s new website top to bottom"};
    if(r.status==="qualified")return {tone:"move",mark:"•",say:"Building website "+at+" — <b>"+name+"</b>"+(where?", "+esc(where):"")};
    if(r.status==="picked")return {tone:"move",mark:"•",say:"Checking business "+at+" — <b>"+name+"</b>"+(where?", "+esc(where):"")};
    var chip=voiceChip(r.status);
    return {tone:"neutral",mark:"•",say:esc(chip.label)+" — <b>"+name+"</b>"};
  }
  function renderHappeningNow(){
    var host=byId("happeningNow");
    if(!host)return;
    var items=[];
    function push(tone,mark,say,at){
      items.push({tone:tone,mark:mark,say:say,at:Number.isFinite(at)?at:0});
    }
    if(campaign&&campaign.state==="working"&&campaign.note){
      push("move","•",esc(campaign.note),campaign.startedAt?Date.now():0);
    }
    (mapBatches||[]).forEach(function(b){
      var counts=b.counts||{};
      var goal=Number(b.requested)||Number(counts.total)||0;
      var running=batchRunning(b);
      if(b.status==="awaiting_approval"&&counts.queued>0){
        push("wait","!",counts.queued+" website"+(counts.queued===1?" is":"s are")+" finished and waiting for your OK — approve them below",0);
        return;
      }
      if(b.status==="halted"){
        push("bad","✗","Stopped — "+esc(trunc(String(b.haltReason||"you pressed the stop switch"),100)),0);
        return;
      }
      if(!running)return;
      var active=activeKey(b);
      var rows=(b.rows||[]).slice().sort(function(a,c){return (Number(a.rowIndex)||0)-(Number(c.rowIndex)||0);});
      var queuedShown=0,deadShown=0;
      rows.forEach(function(r,i){
        var motion=rowMotion(b,r,active);
        var at=Date.parse(String(r.updatedAt||""));
        if(motion==="act"||motion==="stall"){
          var s=motion==="stall"
            ?{tone:"wait",mark:"!",say:sayStall(b,r,i+1,goal)}
            :happeningSentence(b,r,i+1,goal);
          push(s.tone,s.mark,s.say,at);
        }else if(r.status==="queued"&&queuedShown<3){
          queuedShown+=1;
          var q=happeningSentence(b,r,i+1,goal);
          push(q.tone,q.mark,q.say,at);
        }else if(rowDead(r)&&deadShown<2){
          deadShown+=1;
          var d=happeningSentence(b,r,i+1,goal);
          push(d.tone,d.mark,d.say,at);
        }
      });
    });
    items.sort(function(a,b){return b.at-a.at;});
    items=items.slice(0,8);
    var list=items.length
      ?'<ul class="happening-list">'+items.map(function(item){
          return '<li class="happening-item '+esc(item.tone)+'"><span class="happening-mark" aria-hidden="true">'+esc(item.mark)+'</span>'
            +'<span class="happening-say">'+item.say+'</span></li>';
        }).join("")+'</ul>'
      :'<p class="happening-empty">Nothing is happening right now — press Start my campaign above and this fills in live.</p>';
    host.innerHTML='<div class="happening-card"><div class="glance-head">'
      +'<h2 title="A running list of what the machine is doing this minute, in plain words.">Happening now<span class="qhint" aria-hidden="true" title="A running list of what the machine is doing this minute, in plain words."></span></h2>'
      +'<span class="label" title="Every sentence comes from the live run — nothing here is scripted.">live, in plain words</span></div>'
      +list+'</div>';
  }
  function sayStall(b,r,index,goal){
    var name=esc(r.businessName||r.prospectId||"a business");
    if(r.status==="qualified")return "Building website "+index+" of "+(goal||"?")+" — <b>"+name+"</b> is taking longer than usual, still trying";
    return "Working on <b>"+name+"</b> — taking longer than usual, still trying";
  }

  // The vertical list is whatever donors-clean can actually build right now,
  // served by console-data. The hardcoded <option> list below it was stale the
  // day landscaping landed and again the day hvac landed; this replaces it in
  // place, and leaves it untouched if the server did not send the field.
  function renderVerticals(snapshot){
    var list=(snapshot&&snapshot.verticals)||[];
    var mapped=snapshot&&snapshot.mappedV2Catalog;
    if(!list.length&&!(mapped&&mapped.available))return;
    var sel=document.getElementById("mineVertical");
    if(!sel)return;
    var mappedList=mapped&&mapped.available&&Array.isArray(mapped.verticals)?mapped.verticals:[];
    var sig=JSON.stringify({legacy:list,mapped:mappedList,available:!!(mapped&&mapped.available)});
    if(sel.__optSig===sig)return;
    sel.__optSig=sig;
    var chosen=sel.value;
    sel.innerHTML="";
    function add(value,label,ready){
      var o=document.createElement("option");
      o.value=value; o.textContent=label;
      if(ready===false)o.setAttribute("data-unready","1");
      sel.appendChild(o);
    }
    add("","Pick the kind of business…");
    add("leadminer","All trades — from our finished research");
    if(mapped&&mapped.available){
      mappedList.forEach(function(v){
        add(v.vertical,v.label+(v.readyDonors?" · ready":" · practice proof only"),!!v.readyDonors);
      });
      var status=document.getElementById("donorCatalogStatus");
      if(status)status.textContent=mappedList.length+" mapped trades · "+mappedList.filter(function(v){return v.readyDonors>0;}).length+" ready for real campaigns. Other mapped trades can be tried in practice mode; each site still must pass the build checks.";
    }else{
      list.forEach(function(v){
        add(v.vertical, v.label+(v.outreachRetired?" · websites only, no emails":""),!v.donorExcluded&&!v.outreachRetired);
      });
      var unavailable=document.getElementById("donorCatalogStatus");
      if(unavailable)unavailable.textContent="V2 donor catalog is not connected. Showing the existing donor list only.";
    }
    if(chosen)sel.value=chosen;
    syncDonorOptions();
    if(typeof launchRequestChanged==="function")launchRequestChanged();
  }
  function syncDonorOptions(){
    var sel=document.getElementById("mineVertical");
    if(!sel)return;
    var live=typeof currentLane==="function"&&currentLane()==="live";
    Array.prototype.forEach.call(sel.options,function(o){o.disabled=o.getAttribute("data-unready")==="1"&&live;});
    if(sel.selectedOptions[0]&&sel.selectedOptions[0].disabled)sel.value="";
  }

  // The owner's front door renders ONLY the workflow truth: which trades can
  // be picked, the four glance numbers, and the one readiness pill. The
  // funnel internals and provider rows this used to feed live on in the
  // Engine room tab; nothing here invents a number the snapshot did not send.
  function renderApprovedOverview(snapshot){
    renderVerticals(snapshot);
    renderReadiness(snapshot);
    renderGlance(snapshot);
  }

  // =========================================================================
  // THE STOP SWITCH
  // -------------------------------------------------------------------------
  // The outreach pause has existed for months and was displayed on three
  // panels with no control on any of them: the only way to halt a run was to
  // hand-write a POST. At six sends a day that is an annoyance; at fifty it is
  // the difference between one bad email and a batch of them.
  //
  // SERVER STATE, ALWAYS. Other controls on this page keep state in the DOM or
  // in localStorage and revert on reload. A stop button that forgets it was
  // pressed is worse than no stop button, because the operator believes the
  // line is halted. Everything below reads /api/admin/outreach-pause — on
  // open, on the 30s poll, and again straight after every write — and what it
  // prints is that read-back, never the click.
  // =========================================================================
  var halt={active:null,known:false,reason:"",at:"",error:"",armed:false,timer:null,busy:false};

  function haltState(){
    if(halt.error)return "error";
    if(halt.active===true)return halt.known?"halted":"unknown";
    if(halt.active===false)return "live";
    return "unknown";
  }
  function haltNote(text,tone){
    var node=byId("haltOut");
    if(!node)return;
    node.hidden=false;
    node.className="halt-out"+(tone?" "+tone:"");
    node.textContent=text;
  }
  function disarmHalt(){
    halt.armed=false;
    if(halt.timer){window.clearTimeout(halt.timer);halt.timer=null;}
  }
  function armHalt(){
    halt.armed=true;renderHalt();
    // 20s, not 6: a human reading "CONFIRM — click again" for the first
    // time takes longer than 6 seconds, and the silent disarm made the
    // second click feel like a dead button — the owner hit exactly that.
    // Expiry now SAYS it expired instead of quietly resetting.
    halt.timer=window.setTimeout(function(){
      disarmHalt();renderHalt();
      haltNote("Confirmation window expired — nothing was changed. Press the button twice within 20 seconds to confirm.","bad");
    },20000);
  }
  function renderHalt(){
    var bar=byId("haltBar"),btn=byId("haltBtn");
    if(!bar||!btn)return;
    var state=haltState();
    bar.setAttribute("data-halt",state);
    btn.disabled=halt.busy===true;
    btn.classList.toggle("armed",halt.armed);
    btn.classList.toggle("resume",state==="halted"&&!halt.armed);
    if(state==="halted"){
      byId("haltTitle").textContent="ALL SENDING IS HALTED";
      byId("haltSub").textContent="Recorded on the server"+(halt.at?" at "+halt.at:"")+(halt.reason?" — "+halt.reason:"")+". Nothing new goes out until you resume.";
      btn.textContent=halt.armed?"CONFIRM RESUME — click again":"Resume sending";
      // Force the masthead pill too. Only ever in the blocking direction, so
      // this can never paint a green "ready" over something that is not.
      var pill=byId("readyPill");
      if(pill){pill.textContent="Sending halted";pill.className="pill warn";}
      return;
    }
    if(state==="live"){
      byId("haltTitle").textContent="SENDING IS LIVE";
      byId("haltSub").textContent=halt.known
        ?("No pause is set"+(halt.reason?" — last change: "+halt.reason:"")+".")
        :"No pause has ever been set on this server.";
    }else if(state==="unknown"){
      byId("haltTitle").textContent="PAUSE STATE UNREADABLE — SENDS ARE ALREADY REFUSING";
      byId("haltSub").textContent="The server cannot read the pause record"+(halt.reason?" ("+halt.reason+")":"")+", so every send gate is failing closed. Press stop to write a real halt.";
    }else{
      byId("haltTitle").textContent="THE STOP SWITCH DID NOT ANSWER";
      byId("haltSub").textContent=halt.error+" — do not assume anything is stopped.";
    }
    btn.textContent=halt.armed?"CONFIRM STOP — click again":"STOP ALL SENDS";
  }
  function readHaltPayload(payload){
    var pause=payload&&payload.deliveryPause;
    if(!pause||typeof pause.active!=="boolean"){
      halt.error=(payload&&(payload.error||payload.message))||"the pause endpoint answered without a state";
      return false;
    }
    halt.error="";halt.active=pause.active===true;halt.known=pause.known===true;
    halt.reason=String(pause.reason||"");halt.at=String(pause.at||"");
    return true;
  }
  function refreshHalt(){
    if(!token())return Promise.resolve(false);
    return api("/api/admin/outreach-pause").then(function(payload){
      var readable=readHaltPayload(payload);renderHalt();return readable;
    }).catch(function(error){
      if(error.status===401||error.status===403)return false;
      halt.error=error.message;renderHalt();return false;
    });
  }
  function setHalt(wanted){
    halt.busy=true;renderHalt();
    return post("/api/admin/outreach-pause",{active:wanted,reason:wanted?"operator_stop_button":"operator_resume"})
      .then(function(payload){
        if(!readHaltPayload(payload)){
          haltNote("THE WRITE DID NOT REPORT A STATE, so nothing here is proven. Server said: "+JSON.stringify(payload),"bad");
          return;
        }
        if(halt.active===wanted){
          haltNote(wanted
            ?("STOPPED"+(halt.at?" at "+halt.at:"")+". The server now refuses sends. One site and one email may already have been in flight when you pressed it; those finish.")
            :("RESUMED"+(halt.at?" at "+halt.at:"")+". Sends are live again. Nothing restarts by itself — start or approve a batch to send."),"ok");
        }else{
          haltNote("THE CHANGE DID NOT TAKE. The server still reports "+(halt.active?"HALTED":"LIVE")+". Do not assume anything changed.","bad");
        }
      })
      .catch(function(error){
        halt.error=error.message;
        haltNote("THE REQUEST FAILED: "+error.message+" — the pause was NOT changed. Sending is still whatever it was before you clicked.","bad");
      })
      .finally(function(){halt.busy=false;disarmHalt();renderHalt();refreshHalt();});
  }
  var haltBtn=byId("haltBtn");
  if(haltBtn){
    haltBtn.addEventListener("click",function(){
      if(halt.busy)return;
      if(haltState()==="halted"){
        // RESUMING is the dangerous direction, so it asks twice AND out loud.
        if(!halt.armed){armHalt();return;}
        disarmHalt();
        if(!window.confirm("Resume sending? Prospect email, the hourly drip and approved batches can go out again from the moment you confirm."))
          {renderHalt();return;}
        setHalt(false);
        return;
      }
      // STOPPING takes two deliberate presses and no modal: an emergency
      // control must not be one stray click away, and must not be hidden
      // behind a dialog either.
      if(!halt.armed){armHalt();return;}
      disarmHalt();setHalt(true);
    });
  }

  function load(){
    if(loadInFlight||document.hidden||!token())return loadInFlight||Promise.resolve(null);
    refreshHalt();
    loadInFlight=api("/api/admin/console-data").then(function(snapshot){
      renderApprovedOverview(snapshot);
      mapSnap=snapshot; noteFeed(); renderMap();
      arcadeConsoleData(snapshot); // arcade hero: absolute counters + station/crew truth from the same snapshot
      hideGate();
      loadBatches();
      return snapshot;
    }).catch(function(error){
      if(error.status===401||error.status===403){
        clearToken();
        showGate("Token expired or rejected. Enter a current operator token.");
      }else{
        byId("readyPill").textContent="offline · last refresh failed";
        byId("readyPill").className="pill warn";
        launchOut.textContent="Console refresh failed: "+error.message;
      }
      throw error;
    }).finally(function(){loadInFlight=null;});
    return loadInFlight;
  }

  accessForm.addEventListener("submit",function(event){
    event.preventDefault();
    var value=tokenInput.value.trim();
    if(!value){showGate("Enter your owner password first.");return;}
    accessButton.disabled=true;
    accessButton.textContent="Checking access…";
    accessStatus.textContent="Checking access…";
    loginWithPassword(value).then(function(session){
      tokenInput.value="";
      setToken(session.token);
      // load() proves the fresh session against /api/admin/line and only
      // then opens the gate — the same validate-before-unlock step the
      // login-recovery hotfix performed.
      return load();
    }).catch(function(error){
      clearToken();
      var reason=error&&error.payload&&error.payload.error;
      showGate(reason==="invalid_password"?"Password not recognized.":((error&&error.message)||"Could not open the command center. Try again."));
    });
  });

  // ---- Owner session controls (Sign out / Change password) ----------------
  // The same session surface the hotfix-era workspace page served: changing
  // the password re-issues the signed session so THIS browser stays signed
  // in while the version bump invalidates every other browser's session.
  function openPasswordDialog(){
    byId("currentPassword").value="";
    byId("newPassword").value="";
    byId("confirmPassword").value="";
    passwordStatus.textContent="";
    passwordGate.hidden=false;
    byId("currentPassword").focus();
  }
  function closePasswordDialog(){passwordGate.hidden=true;}
  passwordCancel.addEventListener("click",closePasswordDialog);
  changePasswordBtn.addEventListener("click",openPasswordDialog);
  passwordForm.addEventListener("submit",function(event){
    event.preventDefault();
    var current=byId("currentPassword").value;
    var next=byId("newPassword").value;
    var confirm=byId("confirmPassword").value;
    if(next.length<12){passwordStatus.textContent="Use at least 12 characters.";return;}
    if(next!==confirm){passwordStatus.textContent="New passwords do not match.";return;}
    passwordGo.disabled=true;
    passwordGo.textContent="Saving…";
    passwordStatus.textContent="";
    api("/api/admin/password",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({currentPassword:current,newPassword:next})}).then(function(payload){
      if(payload&&payload.token)setToken(payload.token);
      passwordStatus.textContent="Password changed. This browser's session was refreshed.";
      window.setTimeout(closePasswordDialog,900);
    }).catch(function(error){
      var reason=error&&error.payload&&error.payload.error;
      passwordStatus.textContent=reason==="current_password_incorrect"?"Current password not recognized.":((error&&error.message)||"Could not change the password.");
    }).finally(function(){
      passwordGo.disabled=false;
      passwordGo.textContent="Change password";
    });
  });
  signOutBtn.addEventListener("click",function(){
    clearToken();
    location.reload();
  });

  // Nationwide rotation: blank city -> a different metro every run, so a
  // Mine 500 day spreads across the country instead of stacking one city.
  var METROS=["Houston TX","Dallas TX","San Antonio TX","Austin TX","Fort Worth TX","Oklahoma City OK","Tulsa OK","Phoenix AZ","Tucson AZ","Albuquerque NM","Denver CO","Colorado Springs CO","Kansas City MO","St Louis MO","Omaha NE","Wichita KS","Little Rock AR","Memphis TN","Nashville TN","Knoxville TN","Louisville KY","Birmingham AL","Jackson MS","Baton Rouge LA","Shreveport LA","Atlanta GA","Charlotte NC","Columbia SC","Charleston SC","Jacksonville FL","Tampa FL","Orlando FL","Boise ID","Salt Lake City UT","Las Vegas NV","Reno NV","Fresno CA","Sacramento CA","Spokane WA","Portland OR","Des Moines IA","Indianapolis IN","Columbus OH","Cincinnati OH"];
  var metroCursor=Math.floor(Math.random()*METROS.length);
  function nextMetro(){metroCursor=(metroCursor+1)%METROS.length;return METROS[metroCursor];}

  function esc(t){return String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

  // =================================================================
  // THE PIPELINE, DRAWN AS A PIPELINE
  // -----------------------------------------------------------------
  // Owner instruction 2026-08-06: the running batch read as six rows of
  // words ticking over. It is now a rail of named stages with a lead
  // moving through it, and a finished mirror shows the mirror.
  //
  // The stage vocabulary is NOT invented here — it is lib/line-state's
  // ROW_STATES in its own order, which is what api/admin/line ships in
  // every row's "reached" array. ROW_FAILED is the terminal set. The SHORT
  // labels are the owner's words (campaign-flow pass 2026-08-16: no machine
  // vocabulary on the owner's screens — the machine names stay in the
  // Engine room).
  // =================================================================
  var STAGES=[
    {key:"picked",short:"Checking",word:"Checking the business"},
    {key:"qualified",short:"Building",word:"Building the website"},
    {key:"mirrored",short:"Inspecting",word:"Checking the website"},
    {key:"gate_passed",short:"Email",word:"Preparing the email"},
    {key:"queued",short:"Ready",word:"Ready for your OK"},
    {key:"sent",short:"Sent",word:"Delivered"}
  ];
  var DEAD_STATES={rejected:1,gate_failed:1,error:1};
  // Three minutes with no movement on the row the runner is actually
  // holding is the honest threshold: a healthy mirror in this lane
  // lands in ~30s (measured 2026-08-07: 33s, 41s, 33s between queues).
  var STALL_MS=180000;
  var seenReach={};   // batch|row -> stages reached at the previous poll
  var gainSet={};     // rows that gained a stage on THIS poll — the only motion source

  function stageIndex(key){
    for(var i=0;i<STAGES.length;i++)if(STAGES[i].key===key)return i;
    return -1;
  }
  function rowKey(b,r){return String(b&&b.batchId||"")+"|"+String(r&&(r.prospectId||r.businessName)||"");}
  function rowPos(r){
    var best=-1;
    (r&&r.reached||[]).forEach(function(s){var i=stageIndex(s);if(i>best)best=i;});
    if(best<0){var cur=stageIndex(r&&r.status);if(cur>=0)best=cur;}
    return best;
  }
  function rowDead(r){return Boolean(DEAD_STATES[String(r&&r.status||"")]);}
  function rowAge(r){var t=Date.parse(String(r&&r.updatedAt||""));return Number.isFinite(t)?Date.now()-t:NaN;}
  function batchRunning(b){return b&&(b.status==="queued"||b.status==="running"||b.status==="building"||b.status==="sending");}

  // The snapshot exposes row transitions, not worker-slot ownership. Highlight
  // the freshest non-terminal row as the best available progress signal; the
  // other rows remain "waiting" rather than claiming a specific worker.
  function activeKey(b){
    if(!batchRunning(b))return "";
    var best=null,bestAt=-1;
    (b.rows||[]).forEach(function(r){
      if(rowDead(r)||r.status==="queued"||r.status==="sent")return;
      var t=Date.parse(String(r.updatedAt||""));
      if(Number.isFinite(t)&&t>bestAt){bestAt=t;best=r;}
    });
    return best?rowKey(b,best):"";
  }
  function rowMotion(b,r,active){
    if(rowDead(r))return "dead";
    if(r.status==="sent")return "done";
    if(r.status==="queued")return "hold";
    if(!batchRunning(b))return "idle";
    if(rowKey(b,r)!==active)return "wait";
    var age=rowAge(r);
    if(!Number.isFinite(age))return "idle";
    return age<STALL_MS?"act":"stall";
  }
  function minutes(ms){
    var m=Math.floor(ms/60000);
    return m<60?(m+"m"):(Math.floor(m/60)+"h "+(m%60)+"m");
  }
  function elapsedLabel(ms){
    var n=Number(ms);
    if(!Number.isFinite(n)||n<0)return "—";
    if(n<60000)return Math.max(1,Math.floor(n/1000))+"s";
    if(n<3600000)return Math.floor(n/60000)+"m "+Math.floor((n%60000)/1000)+"s";
    return Math.floor(n/3600000)+"h "+Math.floor((n%3600000)/60000)+"m";
  }

  // Motion is DERIVED, never assumed: a stage lights up as gained only
  // because this client saw the count of reached stages go up between
  // two polls of the same row.
  function noteMotion(list){
    var next={},gains={};
    (list||[]).forEach(function(b){
      (b.rows||[]).forEach(function(r){
        var key=rowKey(b,r),n=(r.reached||[]).length;
        next[key]=n;
        if(seenReach[key]!==undefined&&n>seenReach[key])gains[key]=true;
      });
    });
    seenReach=next;gainSet=gains;
  }

  function railHtml(b){
    var at=[0,0,0,0,0,0],dead=0,hasLive=[false,false,false,false,false,false];
    var active=activeKey(b);
    (b.rows||[]).forEach(function(r){
      if(rowDead(r)){dead+=1;return;}
      var p=rowPos(r);if(p<0)p=0;
      at[p]+=1;
      if(rowMotion(b,r,active)==="act")hasLive[p]=true;
    });
    var stalled=(b.rows||[]).some(function(r){return rowMotion(b,r,active)==="stall";});
    var html='<div class="railrow"><div class="rail">';
    STAGES.forEach(function(s,i){
      html+='<div class="rnode'+(at[i]?" hot":"")+(i===3?" gate":"")+'">'
        +'<span class="rlab">'+esc(s.short)+'</span><span class="rnum num">'+at[i]+'</span></div>';
      if(i<STAGES.length-1){
        html+='<div class="rlink'+(hasLive[i]?" on":(stalled?" stall":""))+'"><i></i></div>';
      }
    });
    html+='</div><div class="rnode rdead'+(dead?" hot":"")+'">'
      +'<span class="rlab">Stopped</span><span class="rnum num">'+dead+'</span></div></div>';
    return html;
  }

  var MARK={done:["Sent","ok"],hold:["Waiting for your OK","warn"],act:["Building",""],stall:["Taking longer","wait"],
            wait:["Waiting",""],idle:["On hold",""],dead:["Stopped","bad"]};
  var PHASE_MARK={picked:"Checking the business",qualified:"Building the website",mirrored:"Checking the website",gate_passed:"Preparing the email",queued:"Ready for your OK",sent:"Delivered"};
  function deadMark(r){
    if(r.status==="rejected")return ["Didn't meet our bar","bad"];
    if(r.status==="gate_failed")return ["Failed final inspection","bad"];
    return ["Stopped","bad"];
  }

  function leadHtml(b,r,active,budget){
    var motion=rowMotion(b,r,active);
    var pos=rowPos(r);
    var gained=gainSet[rowKey(b,r)]===true;
    var mark=motion==="dead"?deadMark(r):(MARK[motion]||MARK.idle);
    // BUILD PERCENT (owner: "a button with the words so I know where it's at").
    // Stage index -> a friendly percent of the whole build, so a mirrored row
    // reads 60% and a gate-passed row 85. Inline and self-contained.
    var PCT_BY_STAGE=[10,25,60,85,100,100];
    var pct=PCT_BY_STAGE[Math.max(0,Math.min(5,pos))]||0;
    var phaseMark=PHASE_MARK[String(r.status||"")]||mark[0];
    var markText=phaseMark;
    if(motion==="act")markText=phaseMark+" · "+pct+"% built";
    else if(motion==="stall")markText="Taking longer — "+phaseMark;
    else if(motion==="wait")markText=phaseMark+" · waiting its turn";
    var url=safeHttpUrl(r.previewUrl);

    // STATIC, ON PURPOSE. These used to be live iframes of each mirror, and
    // every poll repainted a dozen websites in miniature — the owner watched
    // his batch list strobe white. The gate already took a real screenshot of
    // every revealable build; show THAT. An <img> with a stable src repaints
    // never, costs one cached JPEG, and the click still opens the live site.
    var shot=String(r.shotUrl||"");
    var thumb;
    if(url&&shot)thumb='<a class="shot still" href="'+esc(url)+'" target="_blank" rel="noreferrer" title="Open the finished site"><img class="shotimg" loading="lazy" decoding="async" alt="" src="'+esc(shot)+'"></a>';
    else if(url)thumb='<a class="shotnone" href="'+esc(url)+'" target="_blank" rel="noreferrer" title="Open the finished site"></a>';
    else thumb='<span class="shotnone'+(motion==="dead"?" bad":motion==="act"?" act":motion==="stall"?" stall":"")+'">'
      +((motion==="act"||motion==="stall")?'<i class="lbuildfill" style="width:'+pct+'%"></i><b class="lbuildpct">'+pct+'%</b>':"")
      +'</span>';

    var track='<div class="track" role="img" aria-label="'+esc(trackLabel(r,motion))+'">';
    for(var i=0;i<STAGES.length;i++){
      var cls="seg";
      if(i<=pos)cls+=" on";
      if(i===pos&&gained)cls+=" gain";
      if(i===pos+1){
        if(motion==="act")cls+=" now";
        else if(motion==="stall")cls+=" now stall";
        else if(motion==="dead")cls+=" broke";
      }
      track+='<i class="'+cls+'" title="'+esc(STAGES[i].word)+'"></i>';
    }
    track+='</div>';

    var note="";
    var phaseAge=rowAge(r);
    if(motion==="act"){
      note='<span class="waitnote">'+esc(phaseMark.toLowerCase())+' · '+esc(elapsedLabel(phaseAge))+' in this phase</span>';
    }else if(motion==="stall"){
      note='<span class="stallnote">no movement '+esc(elapsedLabel(phaseAge))+' · '+esc(phaseMark.toLowerCase())+'</span>';
    }

    var where=[r.city,r.state].filter(Boolean).join(", ");
    if(r.vertical)where=where?where+" · "+r.vertical:r.vertical;

    // The mark lives INSIDE the body next to the name, so that on a narrow
    // screen it can drop below the name instead of eating the width of the
    // one thing on this card that a human actually needs to read.
    // WAITING is a fact with a promise attached: the pool runs a few builds at
    // a time and this row starts on its own. Saying so is the difference
    // between "queued" and what the owner read as "dead row, no button".
    if(motion==="wait"&&!note)note='<span class="waitnote">waiting for a '+esc(phaseMark.toLowerCase())+' slot — starts automatically</span>';
    if(motion==="hold"&&!note)note='<span class="waitnote">built + gated — goes out when the batch is approved</span>';

    // The kebab: every action that genuinely exists for a row, in one place.
    // Items render only when their target does — a menu of dead links is the
    // Lovable pattern worn as a costume.
    var acts=[];
    if(url)acts.push('<a href="'+esc(url)+'" target="_blank" rel="noreferrer">Open live site</a>');
    if(url)acts.push('<button type="button" data-copy="'+esc(url)+'">Copy site link</button>');
    if(r.prospectId)acts.push('<button type="button" data-copy="'+esc(r.prospectId)+'">Copy business ID</button>');
    if(r.reason||((r.facts||[]).length))acts.push('<button type="button" data-why="1">Why this status</button>');
    var kebab=acts.length?'<span class="kebab"><button type="button" class="kbtn" aria-label="Website actions" aria-haspopup="true">&#8942;</button><span class="kmenu">'+acts.join("")+'</span></span>':"";

    return '<div class="lead '+esc(motion==="dead"?"dead":motion)+'">'
      +thumb
      +'<div class="lbody">'
      +'<div class="lhead"><span class="lname">'+esc(r.businessName||r.prospectId||"Unnamed business")+'</span>'
      +'<span class="lmark '+esc(mark[1])+'">'+esc(markText)+'</span>'+kebab+'</div>'
      +'<div class="lwhere">'+esc(where||"—")+'</div>'
      +track+note+whyHtml(b,r)+'</div></div>';
  }

  function trackLabel(r,motion){
    var reached=(r.reached||[]).length;
    return "reached "+reached+" of "+STAGES.length+" stages, "+motion;
  }

  // The engineering string stays REACHABLE — it is how a failure gets
  // diagnosed — but it is no longer the first thing a human reads. An open
  // panel survives the re-render; a live poll used to slam it shut every
  // few seconds while the operator was still reading it.
  var openWhy={};
  function whyHtml(b,r){
    var failed=(r.facts||[]).filter(function(f){return f&&f.pass===false;});
    var hasReason=Boolean(r.reason);
    if(!hasReason&&!failed.length&&!(r.failedFacts||[]).length)return "";
    var body="";
    if(hasReason)body+='<div>'+esc(r.reason)+'</div>';
    (r.failedFacts||[]).forEach(function(f){body+='<span class="fchip bad">'+esc(f)+'</span>';});
    failed.forEach(function(f){body+='<div><span class="fchip bad">'+esc(f.fact)+'</span> '+esc(f.reason||"")+'</div>';});
    var key=rowKey(b,r);
    return '<details class="dx" data-why="'+esc(key)+'"'+(openWhy[key]?" open":"")+'>'
      +'<summary>why</summary><div class="dxb">'+body+'</div></details>';
  }
  // "toggle" does not bubble, so this listens in the capture phase.
  document.addEventListener("toggle",function(ev){
    var node=ev.target;
    if(!node||!node.getAttribute||!node.classList||!node.classList.contains("dx"))return;
    var key=node.getAttribute("data-why")||"";
    if(!key)return;
    if(node.open)openWhy[key]=true;else delete openWhy[key];
  },true);

  // The miner already MEASURES why every candidate died and names the reason
  // it died of; the bar alone threw that away and left a run reading as an
  // anonymous grey stub. A stage that killed 7 of 13 now says whether it was
  // seven missing logos or one 403 — which is the difference between a market
  // problem and a grader problem.
  function killChips(s){
    var counts=(s&&s.rejected)||{};
    var keys=Object.keys(counts);
    if(!keys.length)return "";
    keys.sort(function(a,b){return (Number(counts[b])||0)-(Number(counts[a])||0)||a.localeCompare(b);});
    var chips="";
    keys.forEach(function(k){
      // Some reason keys carry the offending URL inline — the store holds a
      // real 78-character one — and at 390px an untruncated chip pushed the
      // whole page into horizontal scroll. The count is never truncated; the
      // full reason stays reachable on hover.
      var full=String(k).replace(/_/g," ");
      var label=full.length>46?full.slice(0,45)+"\\u2026":full;
      chips+='<i class="kchip" title="'+esc(full)+'">'+esc(label)+'<b>'+(Number(counts[k])||0)+'</b></i>';
    });
    return '<span class="mkill">'+chips+'</span>';
  }

  function funnelHtml(b){
    var rows=b&&b.mineFunnel;
    if(!rows||!rows.length)return "";
    var top=0;
    rows.forEach(function(s){top=Math.max(top,Number(s&&s.entered)||0);});
    if(!top)return "";
    var html='<div class="mfun"><div class="mcap">candidates · kept vs killed, stage by stage — and what killed them</div>';
    rows.forEach(function(s){
      var entered=Number(s&&s.entered)||0,survived=Number(s&&s.survived)||0;
      var killed=Math.max(0,entered-survived);
      html+='<div class="mrow"><span class="mlab">'+esc(String(s&&s.stage||"").replace(/^[0-9]+_/,"").replace(/_/g," "))+'</span>'
        +'<span class="mbar"><i style="width:'+(survived/top*100)+'%"></i><u style="width:'+(killed/top*100)+'%"></u></span>'
        +'<span class="mnum num">'+survived+'</span>'
        +killChips(s)+'</div>';
    });
    return html+'</div>';
  }

  function trunc(s,n){s=String(s==null?"":s);return s.length>n?s.slice(0,n-1)+"…":s;}

  // =================================================================
  // OUTCOMES, IN ONE SENTENCE
  // -----------------------------------------------------------------
  // Owner instruction 2026-08-06: a run that refuses everything showed
  // six zero-boxes and a buried card instead of an answer. Every batch
  // now knows how to state its own outcome in one computed sentence —
  // the history rows, the zero-pick cards and the campaign card all
  // read from these. Every clause is derived from measured fields
  // (counts, mineFunnel, row reasons); nothing here is canned-false.
  // =================================================================
  function topDeadReason(b){
    var tally={},best="",n=0;
    (b&&b.rows||[]).forEach(function(r){
      if(!rowDead(r))return;
      var why=String(r.reason||(r.failedFacts||[]).join(", ")||r.status||"refused");
      tally[why]=(tally[why]||0)+1;
    });
    Object.keys(tally).forEach(function(k){if(tally[k]>n){n=tally[k];best=k;}});
    return best?{reason:best,count:n}:null;
  }

  // THE PACKET LANE HAS A SHELF, NOT A METRO. When a packet run refuses
  // everything, re-running cannot help — it re-reads the same shelf. This
  // sentence is the whole story of such a run: what the shelf held, what took
  // it (from the funnel the API measured), what is already queued for the
  // owner, and where fresh supply actually comes from.
  function packetShelfSentence(b,queuedElsewhere){
    var shelf=null;
    (b&&b.mineFunnel||[]).forEach(function(s){if(/^1_packet_shelf/.test(String(s&&s.stage||"")))shelf=s;});
    if(!shelf)return "";
    var held=Number(shelf.entered)||0;
    var kills=shelf.rejected||{};
    var built=Number(kills["already built, queued or sent"])||0;
    var first;
    if(!held)first="The packet shelf is empty — no packets are waiting to build.";
    else if(built>=held)first="The packet shelf is empty of new work — all "+held+" packet"+(held===1?"":"s")+" on it "+(held===1?"is":"are")+" already built, queued or sent.";
    else{
      var keys=Object.keys(kills).sort(function(x,y){return (Number(kills[y])||0)-(Number(kills[x])||0);});
      var top=keys.slice(0,2).map(function(k){return trunc(String(k).replace(/_/g," "),60)+" ×"+kills[k];}).join(" · ");
      first="Nothing buildable on the packet shelf — "+held+" held, refused: "+(top||"no reason recorded")+".";
    }
    var q=Number(queuedElsewhere)||0;
    var mid=q>0?" "+q+" finished site"+(q===1?" is":"s are")+" queued below awaiting your approval.":"";
    return first+mid+" Re-running cannot restock the shelf — new packets arrive from LeadMiner exports, and vertical lanes mine fresh leads.";
  }

  function queuedAwaitingElsewhere(excludeId){
    var q=0;
    (mapBatches||[]).forEach(function(b){
      if(!b||b.batchId===excludeId)return;
      if(b.status!=="awaiting_approval"&&b.status!=="approved")return;
      q+=Number((b.counts||{}).queued)||0;
    });
    return q;
  }

  // How a PACKET run reports itself when it settles. Found-vs-goal is what the
  // run measured; the zero case hands off to the shelf sentence above. The old
  // "Run it again to keep hunting" line never renders here — on this lane a
  // re-run reads the very same shelf, so the advice was false.
  function packetRunNote(batch,found,goal,queuedElsewhere){
    if(found>=goal)return "Done: "+found+" site"+(found===1?"":"s")+" built from the packet shelf and queued. Approve & send below.";
    if(found>0)return found+" of "+goal+" built — the packet shelf ran short. Approve & send below; new packets arrive from LeadMiner exports, and vertical lanes mine fresh leads.";
    return batchOutcome(batch||{target:"leadminer",counts:{total:0}},queuedElsewhere);
  }

  function batchOutcome(b,queuedElsewhere){
    var c=(b&&b.counts)||{};
    var packet=String(b&&b.target||"")==="leadminer";
    if(batchRunning(b))return (c.total||0)+" site"+((c.total||0)===1?"":"s")+" on the line — still working";
    if(!c.total){
      if(packet)return packetShelfSentence(b,queuedElsewhere||0)||"The packet shelf gave this run nothing to build.";
      return "0 candidates survived the hunt"+(b&&b.target?" in "+trunc(b.target,48):"")+" — the nationwide rotation tries a new metro on the next run.";
    }
    if(c.failed===c.total){
      var top=topDeadReason(b);
      return "All "+c.total+" refused"+(top?" — "+trunc(top.reason,90)+(top.count>1?" ×"+top.count:""):"")+"."
        +(packet?" Re-running re-reads the same shelf — vertical lanes mine fresh leads.":"");
    }
    if(b.status==="awaiting_approval"&&c.queued>0)return c.queued+" site"+(c.queued===1?"":"s")+" built + gated — awaiting your approval.";
    if(b.status==="approved"&&c.queued>0)return "Approved — "+c.queued+" still queued; the send did not finish. Resume below.";
    if(b.status==="halted")return "Halted — "+trunc(String(b.haltReason||"operator stop"),120);
    if(c.sent>0)return "Sent "+c.sent+" of "+c.total+(c.failed?" · "+c.failed+" refused":"")+".";
    return humanStatus(b.status||"")+" · "+c.total+" site"+(c.total===1?"":"s");
  }

  // A batch whose every pick is dead has no line to draw — its story is the
  // outcome sentence plus who was refused and why, as chips.
  function zeroPick(counts){
    var c=counts||{};
    return !c.total||(((c.working||0)+(c.queued||0)+(c.sent||0))===0);
  }
  function deadChipsHtml(b){
    var chips="";
    (b&&b.rows||[]).forEach(function(r){
      if(!rowDead(r))return;
      var why=String(r.reason||(r.failedFacts||[]).join(", ")||r.status||"refused");
      chips+='<i class="kchip" title="'+esc(why)+'">'+esc(r.businessName||r.prospectId||"row")+' — '+esc(trunc(why,64))+'</i>';
    });
    return chips?'<span class="mkill" style="margin:4px 0 0">'+chips+'</span>':"";
  }

  // =================================================================
  // APPROVE & SEND — the control the waiting batches never had
  // -----------------------------------------------------------------
  // Any batch awaiting the owner with queued rows gets ONE primary
  // button. Confirmation is the stop bar's own pattern: two presses
  // inside a 20-second window, and the window announces its expiry.
  // The bounded send loop continues only while remaining decreases and the
  // card prints the server read-back — never optimistic success.
  // =================================================================
  var sendState={};   // batchId -> {phase,tone,log:[],timer}
  var MAX_SEND_PASSES=8;
  function sendStateFor(id){return sendState[id]||(sendState[id]={phase:"idle",tone:"",log:[],timer:null});}
  function delaySend(ms){return new Promise(function(resolve){window.setTimeout(resolve,ms);});}
  function focusSendButton(id){
    window.setTimeout(function(){
      var match=null;
      document.querySelectorAll(".approveBtn").forEach(function(node){
        if(node.getAttribute("data-batch")===id)match=node;
      });
      if(match)match.focus();
    },0);
  }

  function approveDeckHtml(b){
    var counts=b.counts||{};
    var st=sendState[b.batchId]||{};
    var awaiting=b.status==="awaiting_approval"&&counts.queued>0;
    var resume=b.status==="approved"&&counts.queued>0;
    if(!awaiting&&!resume&&!(st.log&&st.log.length))return "";
    var live=b.lane==="live";
    var n=counts.queued||0;
    var label;
    if(st.phase==="sending")label="Sending… the card below updates as rows land";
    else if(st.phase==="armed")label="CONFIRM SEND — click again";
    else if(st.phase==="retry")label="Retry remaining — "+n+" still queued → "+(live?"prospects":"your inbox");
    else if(resume)label="Resume send — "+n+" still queued → "+(live?"prospects":"your inbox");
    else label="Approve &amp; send "+n+" site"+(n===1?"":"s")+" → "+(live?"prospects (copy to me)":"your inbox");
    var html='<div class="bact">';
    if(awaiting||resume){
      html+='<button type="button" class="btn approveBtn'+(st.phase==="armed"?" armed2":"")+'" data-batch="'+esc(b.batchId)+'" data-lane="'+esc(b.lane||"sandbox")+'"'+(st.phase==="sending"?" disabled":"")+'>'+label+'</button>';
      html+='<span class="bact-sub">'+(live
        ?"Real sends: business owners get the email and every one is copied to your inbox. The server-side safety switch still has the final say."
        :"Practice mode: every email routes to your own inbox — no business owner can be reached.")+'</span>';
      html+='<div class="send-law" role="note">Every email still needs your OK. Nothing reaches a business owner without you.</div>';
    }
    if(st.log&&st.log.length)html+='<div class="bact-out'+(st.tone?" "+st.tone:"")+'" role="status" aria-live="polite" aria-atomic="true">'+st.log.map(esc).join("\\n")+'</div>';
    return html+'</div>';
  }

  function batchCardHtml(b,budget){
    var counts=b.counts||{};
    var active=activeKey(b);
    var stalled=(b.rows||[]).some(function(r){return rowMotion(b,r,active)==="stall";});
    // Campaign-flow pass 2026-08-16: every chip reads through the shared
    // voice table — a machine status never prints raw on the owner screen
    // (machine words stay in the Engine room), and the internal id of the
    // run is not shown at all.
    var chips="";
    if(b.lane==="live")chips+='<span class="chip lane">real sends → business owners</span>';
    else chips+='<span class="chip">practice → you only</span>';
    if(batchRunning(b))chips+='<span class="chip '+(stalled?"hold":"go")+'">'+(stalled?"taking longer than usual":voiceChip(b.status).label)+'</span>';
    else chips+='<span class="chip '+((voiceChip(b.status).tone==="bad")?"stop":"")+'">'+esc(voiceChip(b.status).label)+'</span>';

    var html='<div class="bcard'+(stalled?" stalled":"")+(b.status==="halted"?" halted":"")+'">'
      +'<div class="bhead"><span class="btarget">'+esc(String(b.target||"")==="leadminer"?"All trades — ready-made research":(b.target||"saved businesses"))+'</span>'
      +'<span class="bchips">'+chips+'</span></div>'
      +campaignClockHtml(b)
      +approveDeckHtml(b)
      +'<div class="bbody">';
    if(zeroPick(counts)){
      // NO SIX ZERO-BOXES. A run that kept nothing tells its story in one
      // sentence plus the named refusals — the rail would be six zeros.
      // The mine funnel kept-vs-killed internals stay in the Engine room.
      html+='<div class="boutcome">'+esc(batchOutcome(b,queuedAwaitingElsewhere(b.batchId)))+'</div>'
        +deadChipsHtml(b)+'</div></div>';
      return html;
    }
    html+=railHtml(b);
    (b.rows||[]).forEach(function(r){html+=leadHtml(b,r,active,budget);});
    html+='</div></div>';
    return html;
  }

  // =================================================================
  // DECLUTTER — one batch open, every other batch is one line
  // -----------------------------------------------------------------
  // The expanded batch is the one that needs the owner: a running or
  // sending batch first, else the newest batch awaiting approval with
  // queued rows, else simply the most recent. Everything else folds
  // into History as a one-line row the owner can expand per click.
  // =================================================================
  var openHist={};
  function expandedId(list){
    var live="",wait="";
    (list||[]).forEach(function(b){
      if(!b)return;
      if(!live&&batchRunning(b))live=b.batchId;
      if(!wait&&b.status==="awaiting_approval"&&Number((b.counts||{}).queued)>0)wait=b.batchId;
    });
    return live||wait||String(list&&list[0]&&list[0].batchId||"");
  }
  function histRowHtml(b,open){
    var c=b.counts||{};
    var chips="";
    if(c.queued)chips+='<span class="hchip q">'+c.queued+' queued</span>';
    if(c.sent)chips+='<span class="hchip s">'+c.sent+' sent</span>';
    if(c.failed)chips+='<span class="hchip f">'+c.failed+' refused</span>';
    return '<button type="button" class="histrow'+(open?" open":"")+'" data-hist="'+esc(b.batchId)+'" aria-expanded="'+(open?"true":"false")+'">'
      +'<span class="hname">'+esc(String(b.target||"")==="leadminer"?"All trades — ready-made research":(b.target||"saved businesses"))+'</span>'
      +'<span class="hwhen">'+esc(whenText(b.startedAt)||"—")+'</span>'
      +'<span class="hout">'+esc(batchOutcome(b,0))+'</span>'
      +'<span class="hchips">'+chips+'</span></button>';
  }

  function pipelineHtml(list,maxBatches){
    var budget={shots:12};   // live thumbnails are real page loads; cap them
    var shownList=(list||[]).slice(0,maxBatches||6);
    var main=expandedId(shownList);
    var html='<div class="bstack">';
    var hist=[];
    shownList.forEach(function(b){
      if(b.batchId===main)html+=batchCardHtml(b,budget);
      else hist.push(b);
    });
    if(hist.length){
      html+='<div class="hist"><div class="hist-cap label">History ('+hist.length+')</div>';
      hist.forEach(function(b){
        html+=openHist[b.batchId]
          ?'<div class="histopen">'+histRowHtml(b,true)+batchCardHtml(b,budget)+'</div>'
          :histRowHtml(b,false);
      });
      html+='</div>';
    }
    return html+'</div>';
  }

  // Thumbnails are LIVE IFRAMES of our own mirrors, so the picture can
  // never be a stale or third-party screenshot of something else. They
  // must therefore survive a re-render: blowing them away every poll
  // would reload every mirror every five seconds. Rendered markup
  // carries a placeholder; this swaps the persistent element back in.
  function mountShots(root,scope){
    // Thumbnails are static <img> tags now — nothing to mount, nothing to
    // strobe. This hook survives as the row-menu binder so call sites and
    // tests keep one wiring point. One delegated listener per container.
    if(root.__kebabWired)return;
    root.__kebabWired=true;
    // A screenshot that 404s (old build, rotated key) must not leave a broken
    // image glyph — fall back to the neutral block. error does not bubble, so
    // this listens in the capture phase.
    root.addEventListener("error",function(ev){
      var img=ev.target;
      if(!img||!img.classList||!img.classList.contains("shotimg"))return;
      var host=img.parentNode;
      if(host){host.className="shotnone";img.remove();}
    },true);
    // The media route serves a 1x1 spacer instead of 404 when a still is
    // missing — right for an email (no broken-image glyph in Gmail), wrong
    // here, where it rendered as an empty white-ish box. A picture smaller
    // than a thumbnail IS "no picture": degrade to the neutral block.
    root.addEventListener("load",function(ev){
      var img=ev.target;
      if(!img||!img.classList||!img.classList.contains("shotimg"))return;
      if(img.naturalWidth>=50)return;
      var host=img.parentNode;
      if(host){host.className="shotnone";img.remove();}
    },true);
    root.addEventListener("click",function(ev){
      var btn=ev.target.closest?ev.target.closest(".kbtn"):null;
      var item=ev.target.closest?ev.target.closest(".kmenu a,.kmenu button"):null;
      if(btn){
        ev.preventDefault();
        var k=btn.parentNode,was=k.classList.contains("open");
        root.querySelectorAll(".kebab.open").forEach(function(o){o.classList.remove("open");});
        if(!was)k.classList.add("open");
        return;
      }
      if(item){
        var copy=item.getAttribute("data-copy");
        if(copy){
          ev.preventDefault();
          (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(copy):Promise.reject())
            .then(function(){item.textContent="Copied ✓";})
            .catch(function(){window.prompt("Copy:",copy);});
        }
        if(item.getAttribute("data-why")){
          ev.preventDefault();
          var lead=item.closest(".lead"),why=lead?lead.querySelector("details.dx"):null;
          if(why)why.open=!why.open;
        }
        return;
      }
      root.querySelectorAll(".kebab.open").forEach(function(o){o.classList.remove("open");});
    });
  }

  // The hero flow bar under the assembly line carries batch truth: it
  // sweeps only while a batch is running and something moved recently,
  // and goes ember-static the moment the line stops moving.
  function renderFlowPulse(list){
    var bar=document.querySelector(".flow");
    if(!bar)return;
    var running=false,moving=false;
    (list||[]).forEach(function(b){
      if(!batchRunning(b))return;
      running=true;
      var active=activeKey(b);
      (b.rows||[]).forEach(function(r){if(rowMotion(b,r,active)==="act")moving=true;});
    });
    bar.className="flow"+(running?(moving?" live":" stall"):"");
  }

  // =================================================================
  // THE LIVE CAMPAIGN CARD — the button answers the instant it is hit
  // -----------------------------------------------------------------
  // Born in the launch click, pinned above every batch, fed by the
  // same poll the batches already run, resolved IN PLACE into the
  // run's outcome sentence. The elapsed clock ticks only while the
  // campaign is genuinely working; the progress numbers are read from
  // the matched batches' own counts, never asserted.
  // =================================================================
  var campaign=null,campaignTick=0;
  function campaignBatches(){
    if(!campaign||!Array.isArray(campaign.batchIds))return [];
    return (mapBatches||[]).filter(function(b){return campaign.batchIds.indexOf(b&&b.batchId)>=0;});
  }
  function retainCampaignBatch(result){
    var batch=result&&result.batch;
    var id=String(result&&(result.batchId||(batch&&batch.batchId))||"");
    if(!id)return "";
    if(campaign&&campaign.batchIds.indexOf(id)<0)campaign.batchIds.push(id);
    if(batch){
      var replaced=false;
      mapBatches=(mapBatches||[]).map(function(existing){
        if(existing&&existing.batchId===id){replaced=true;return batch;}
        return existing;
      });
      if(!replaced)mapBatches=[batch].concat(mapBatches||[]);
    }
    return id;
  }
  function campaignHtml(){
    if(!campaign)return "";
    var working=campaign.state==="working";
    var sum=0,failed=0;
    campaignBatches().forEach(function(b){
      var c=b.counts||{};
      failed+=Number(c.failed)||0;
      sum+=(Number(c.queued)||0)+(Number(c.sent)||0);
    });
    // Two real measurements of the same fact — the responses this loop summed
    // and the polled batch counts — the fresher (larger) one wins.
    var done=Math.max(campaign.found||0,sum);
    var pct=campaign.goal>0?Math.max(0,Math.min(100,Math.round(done/campaign.goal*100))):0;
    var chips='<span class="chip'+(campaign.lane==="live"?" lane":"")+'">'+(campaign.lane==="live"?"real sends → business owners":"practice → you only")+'</span>';
    if(working)chips+='<span class="chip go">working</span>';
    else if(campaign.state==="stopped")chips+='<span class="chip stop">stopped</span>';
    else if(campaign.state==="failed")chips+='<span class="chip stop">failed</span>';
    else chips+='<span class="chip hold">settled</span>';
    var clock=lineElapsedText((campaign.settledAt||Date.now())-campaign.startedAt);
    var html='<div class="lc-card'+(working?" lc-live":"")+'" id="lcCard">'
      +'<div class="lc-head"><span class="lc-kicker">'+(working?"LIVE CAMPAIGN":"CAMPAIGN RESULT")+'</span>'
      +'<span class="lc-name">'+esc(campaign.name)+'</span>'
      +'<span class="bchips">'+chips+'</span>'
      +'<span class="lc-clock num" id="lcClock" title="elapsed since you pressed Run">'+esc(clock)+'</span></div>';
    if(working){
      html+='<div class="lc-line">'+esc(campaign.note||"Asking the server to start the run…")
        +(done||failed?" · "+done+" of "+campaign.goal+" built"+(failed?" · "+failed+" refused":""):"")+'</div>'
        +'<div class="lc-track"><i style="width:'+pct+'%"></i></div>';
    }else{
      html+='<div class="lc-out'+(campaign.state==="done"?" ok":" bad")+'">'+esc(campaign.note||"")+'</div>';
    }
    return html+'</div>';
  }
  function tickCampaign(tok){
    if(!campaign||campaign.tickToken!==tok||campaign.state!=="working")return;
    var el=byId("lcClock");
    if(el)el.textContent=lineElapsedText(Date.now()-campaign.startedAt);
    window.setTimeout(function(){tickCampaign(tok);},1000);
  }
  function startCampaign(name,lane,goal,packet){
    campaign={name:name,lane:lane,goal:goal,packet:packet===true,found:0,runs:0,
      batchIds:[],requested:0,
      state:"working",note:"Asking the server to start the run…",
      startedAt:Date.now(),settledAt:null,tickToken:++campaignTick};
    renderBatches(mapBatches);
    tickCampaign(campaign.tickToken);
  }
  function settleCampaign(state,note){
    if(!campaign)return;
    campaign.state=state;
    campaign.note=note;
    campaign.settledAt=Date.now();
    renderBatches(mapBatches);
  }

  // =================================================================
  // WHERE ARE MY TEN — the dominant header count
  // -----------------------------------------------------------------
  // Owner instruction 2026-08-12: once a campaign starts, "the numbering
  // and understanding how many are being built … is completely lost."
  // This renders ONE running tally of the batch he launched — built of
  // goal, plus building / ready / sent / refused — from the SAME batch
  // snapshot the rows below read. Every number is measured; nothing here
  // is asserted, and it can never claim a site the list does not show.
  // =================================================================
  function pipeGoalBatches(){
    // The batches that make up the run he is watching. A live campaign owns
    // the goal it was launched with; otherwise the focus batch stands alone.
    if(campaign){
      return {goal:Number(campaign.goal)||0,batches:campaignBatches(),name:campaign.name,
        working:campaign.state==="working",note:campaign.note||"",lane:campaign.lane||"sandbox"};
    }
    var list=mapBatches||[];
    if(!list.length)return null;
    var id=expandedId(list),focus=null;
    list.forEach(function(b){if(b&&b.batchId===id)focus=b;});
    if(!focus)focus=list[0];
    var goal=Number(focus.requested)||Number((focus.counts||{}).total)||0;
    return {goal:goal,batches:[focus],name:String(focus.target||"")==="leadminer"?"All trades — ready-made research":(focus.target||"saved businesses"),
      working:batchRunning(focus),note:"",lane:focus.lane||"sandbox"};
  }
  function pipeBar(sent,ready,building,refused,denom){
    denom=denom||1;
    function w(n){return Math.max(0,Math.min(100,(Number(n)||0)/denom*100));}
    return '<div class="ph-bar">'
      +'<i class="b-sent" style="width:'+w(sent)+'%"></i>'
      +'<i class="b-ready" style="width:'+w(ready)+'%"></i>'
      +'<i class="b-build" style="width:'+w(building)+'%"></i>'
      +'<i class="b-fail" style="width:'+w(refused)+'%"></i></div>';
  }
  var lineCapacity=null;
  var PERF_PHASES=[
    {key:"qualification",label:"Qualifying",status:"picked"},
    {key:"mirror_build",label:"Mirroring",status:"qualified"},
    {key:"render_gate",label:"Verifying",status:"mirrored"},
    {key:"email_queue",label:"Packaging",status:"gate_passed"}
  ];
  function compactDuration(ms){
    var n=Number(ms);
    if(!Number.isFinite(n)||n<0)return "—";
    if(n<1000)return Math.round(n)+"ms";
    if(n<60000)return Math.round(n/1000)+"s";
    return (Math.round(n/6000)/10)+"m";
  }
  function pipelinePerformance(batches,goal){
    var active={qualification:0,mirror_build:0,render_gate:0,email_queue:0};
    var samples={qualification:[],mirror_build:[],render_gate:[],email_queue:[]};
    var processed=0,earliest=Number.POSITIVE_INFINITY;
    (batches||[]).forEach(function(b){
      var started=Date.parse(String(b&&b.startedAt||""));
      if(Number.isFinite(started))earliest=Math.min(earliest,started);
      (b&&b.rows||[]).forEach(function(r){
        var status=String(r&&r.status||"");
        PERF_PHASES.forEach(function(p){if(status===p.status)active[p.key]+=1;});
        if(status==="queued"||status==="sent"||rowDead(r))processed+=1;
        var completed=r&&r.telemetry&&r.telemetry.completed||{};
        PERF_PHASES.forEach(function(p){
          var metric=completed[p.key];
          if(metric&&Number.isFinite(Number(metric.ms)))samples[p.key].push(Number(metric.ms));
        });
      });
    });
    var elapsed=Number.isFinite(earliest)?Math.max(0,Date.now()-earliest):0;
    var rate=processed>0&&elapsed>0?processed/(elapsed/60000):0;
    var remaining=Math.max(0,(Number(goal)||0)-processed);
    var eta=rate>0&&remaining>0?Math.ceil(remaining/rate):0;
    var bottleneck=null;
    var phaseHtml=PERF_PHASES.map(function(p){
      var values=samples[p.key];
      var avg=values.length?values.reduce(function(a,b){return a+b;},0)/values.length:0;
      if(values.length&&(!bottleneck||avg>bottleneck.avg)){
        bottleneck={label:p.label,avg:avg,samples:values.length};
      }
      return '<div class="ph-phase"><b>'+active[p.key]+'</b><span>'+esc(p.label)+'</span><span>'
        +(values.length?('avg '+esc(compactDuration(avg))+' · n='+values.length):'measuring')+'</span></div>';
    }).join("");
    var capacity=lineCapacity||{};
    var cap=[];
    if(capacity.mirrorWorkers)cap.push(capacity.mirrorWorkers+" mirror lanes");
    if(capacity.verificationBrowsers)cap.push(capacity.verificationBrowsers+" verification lanes");
    if(capacity.uploadsPerMirror)cap.push(capacity.uploadsPerMirror+" uploads/mirror");
    var perf='<div class="ph-phasegrid">'+phaseHtml+'</div><div class="ph-perf">'
      +'<span><b>'+processed+'</b> processed</span>'
      +'<span><b>'+(rate?Math.round(rate*10)/10:"—")+'</b> rows/min</span>'
      +'<span><b>'+(eta?("~"+eta+" min"):"—")+'</b> ETA</span>'
      +(bottleneck?'<span class="slow">slowest measured: <b>'+esc(bottleneck.label)+" "+esc(compactDuration(bottleneck.avg))+'</b></span>':"")
      +(cap.length?'<span>capacity: <b>'+esc(cap.join(" · "))+'</b></span>':"")
      +'</div>';
    return {html:perf,rate:rate,eta:eta,bottleneck:bottleneck,processed:processed};
  }

  function completionCurveHtml(rows,goal,startedAt){
    var points=[];
    (rows||[]).forEach(function(row){
      var hit=(row.history||[]).find(function(item){return item&&item.status==="queued";});
      var at=Date.parse(String(hit&&hit.at||""));
      if(Number.isFinite(at))points.push(at);
    });
    points.sort(function(a,b){return a-b;});
    if(points.length<2){
      return '<div class="ct-curve"><p>Completion speed will appear after the first two websites finish. The campaign is still measuring its real pace.</p></div>';
    }
    var start=Date.parse(String(startedAt||""));
    if(!Number.isFinite(start))start=points[0];
    var end=Math.max(points[points.length-1],start+1);
    var coords=[[2,70]];
    points.forEach(function(at,index){
      var x=2+96*((at-start)/(end-start));
      var y=70-64*((index+1)/Math.max(goal,1));
      coords.push([x,y]);
    });
    var d=coords.map(function(p,index){return (index?"L":"M")+p[0].toFixed(2)+" "+p[1].toFixed(2);}).join(" ");
    return '<div class="ct-curve"><svg viewBox="0 0 100 74" preserveAspectRatio="none" role="img" aria-label="'+points.length+' completed websites over elapsed campaign time"><path d="M2 70H98" stroke="rgba(255,255,255,.08)" fill="none"/><path d="'+d+'" stroke="#34D399" stroke-width="2.2" fill="none" vector-effect="non-scaling-stroke"/></svg><p>'+points.length+' completed website'+(points.length===1?"":"s")+' plotted over real elapsed time. Target: '+goal+'.</p></div>';
  }

  function renderPipelineHead(){
    var host=byId("pipeHero");
    if(!host)return;
    var info=pipeGoalBatches();
    var launchSection=byId("launchSection");
    if(!info){
      if(launchSection)launchSection.classList.remove("campaign-active");
      host.removeAttribute("data-state");
      host.innerHTML='<div class="ct"><div class="ct-title"><span class="label">Campaign control tower</span><h2>No campaign running</h2><p>Answer the three questions in Start a new campaign above and press Start my campaign. The number you pick means finished, email-ready websites — businesses without usable contact information never consume a website slot.</p></div></div>';
      return;
    }

    var rows=[];
    info.batches.forEach(function(batch){(batch.rows||[]).forEach(function(row){rows.push(row);});});
    rows.sort(function(a,b){return (Number(a.rowIndex)||0)-(Number(b.rowIndex)||0);});
    var goal=Number(info.goal)||0;
    var sent=rows.filter(function(row){return row.status==="sent";}).length;
    var ready=rows.filter(function(row){return row.status==="queued";}).length;
    var reviewing=rows.filter(function(row){return row.status==="picked";}).length;
    var building=rows.filter(function(row){return row.status==="qualified";}).length;
    var checking=rows.filter(function(row){return row.status==="mirrored";}).length;
    var packaging=rows.filter(function(row){return row.status==="gate_passed";}).length;
    var failed=rows.filter(rowDead).length;
    var active=reviewing+building+checking+packaging;
    var finished=ready+sent;
    var stillNeeded=Math.max(0,goal-finished);
    var replacements=Math.max(0,failed);
    var working=info.working||active>0||info.batches.some(function(batch){return batch.status==="building"||batch.status==="running";});
    var halted=info.batches.some(function(batch){return batch.status==="halted";});
    var state=halted?"warn":finished>=goal&&goal>0?"ready":working?"work":"warn";
    if(launchSection)launchSection.classList.toggle("campaign-active",working&&finished<goal);

    var narrative;
    if(halted){
      narrative="This campaign is stopped. "+finished+" finished website"+(finished===1?" is":"s are")+" preserved. Resume only after reviewing the stop reason below.";
    }else if(goal>0&&finished>=goal){
      narrative="All "+goal+" requested websites are built, checked and ready. Failed business attempts were replaced and did not reduce the campaign total.";
    }else{
      narrative="You asked for "+goal+" finished, email-ready websites. "+finished+" are finished, "+active+" are moving through production, and the server is scouting verified replacements until every one of the "+goal+" slots is filled.";
    }

    var slotRows=rows.filter(function(row){return !rowDead(row);});
    var slots="";
    var slotLimit=Math.min(goal,500);
    for(var i=0;i<slotLimit;i++){
      var row=slotRows[i]||null;
      var cls="",label="Scouting for a business with a usable email";
      if(row){
        if(row.status==="sent"){cls="sent";label="Delivered";}
        else if(row.status==="queued"){cls="ready";label="Finished and ready to send";}
        else if(row.status==="gate_passed"){cls="email";label="Preparing the email";}
        else if(row.status==="mirrored"){cls="check";label="Checking the finished website";}
        else if(row.status==="qualified"){cls="build";label="Building the website";}
        else {cls="review";label="Checking the business and contact";}
        label=(row.businessName?row.businessName+" — ":"")+label;
      }
      slots+='<span class="ct-slot '+cls+'" title="'+esc(label)+'">'+(i+1)+'</span>';
    }

    // Campaign-flow pass 2026-08-16: the tower counts what the OWNER asked
    // about (how many moving, how many still owed, how many ready for his OK)
    // and drops the candidate-readiness and factory-capacity rows — those
    // live in the Engine room now.
    var action=finished>=goal&&goal>0
      ?'<div class="ct-note action"><b>Action required:</b> review the finished sites, then use Approve &amp; send below. Practice goes only to your inbox.</div>'
      :halted
        ?'<div class="ct-note"><b>Action required:</b> inspect the stop reason below before resuming.</div>'
        :'<div class="ct-note"><b>No action needed right now.</b> The server keeps replacing failed or uncontactable businesses until the finished quota is reached.</div>';
    var started=info.batches.reduce(function(best,batch){
      var at=Date.parse(String(batch.startedAt||""));return Number.isFinite(at)&&(!best||at<best)?at:best;
    },0);

    host.setAttribute("data-state",state);
    host.innerHTML='<div class="ct"><div class="ct-head"><div class="ct-title"><span class="label">Campaign control tower</span><h2>'+goal+'-website campaign</h2><p>'+esc(narrative)+'</p></div><span class="ct-state '+state+'">'+(halted?"STOPPED":finished>=goal&&goal>0?"READY FOR YOU":working?"WORKING UNTIL FULL":"SCOUTING")+'</span></div>'
      +'<div class="ct-big"><b>'+finished+'</b><span>of '+goal+' finished websites</span></div>'
      +'<div class="ct-grid">'
      +'<div class="ct-metric"><b>'+active+'</b>websites moving now</div>'
      +'<div class="ct-metric"><b>'+stillNeeded+'</b>finished slots still needed</div>'
      +'<div class="ct-metric"><b>'+replacements+'</b>attempts replaced</div>'
      +'<div class="ct-metric"><b>'+ready+'</b>emails ready for approval</div>'
      +'</div>'
      +'<div class="ct-slots" aria-label="'+goal+' campaign slots">'+slots+'</div>'
      +completionCurveHtml(rows,goal,started)
      +'<div class="ct-foot">'+action+'</div></div>';
  }

  function renderBatches(list){
    renderPipelineHead();
    renderHappeningNow();
    renderGlance();
    var panel=byId("batchPanel");
    if(!panel)return;
    renderFlowPulse(list);
    if((!list||!list.length)&&!campaign)return;
    panel.innerHTML=campaignHtml()+pipelineHtml(list||[],6);
    mountShots(panel,"panel");
  }
  function repaintBatches(){renderBatches(mapBatches);}

  // ---- the armed approve & send flow ------------------------------
  function armSend(id,isLive,restoreFocus){
    var st=sendStateFor(id);
    st.phase="armed";st.tone="";
    st.log=[(isLive
      ?"LIVE batch: approve and send every queued email to the REAL prospects? A copy of each lands in your inbox."
      :"Approve this batch and send every queued proof email to YOUR inbox?")
      +" That was press one of two — press the button again within 20 seconds to confirm."];
    if(st.timer)window.clearTimeout(st.timer);
    // Same 20s window as the stop bar, for the same reason — and expiry
    // announces itself instead of silently turning the button dead.
    st.timer=window.setTimeout(function(){
      st.phase="idle";st.timer=null;st.tone="bad";
      st.log=["Send confirmation expired — nothing was approved and nothing was sent. Press the button twice within 20 seconds to confirm."];
      repaintBatches();
    },20000);
    repaintBatches();
    if(restoreFocus)focusSendButton(id);
  }
  function disarmSend(id){
    var st=sendState[id];
    if(st&&st.timer){window.clearTimeout(st.timer);st.timer=null;}
  }
  function runApprovedSend(id,isLive){
    var st=sendStateFor(id);
    st.phase="sending";st.tone="";
    st.log=["Preparing batch …"+id.slice(-8)+" on the server…"];
    repaintBatches();
    function say(line){st.log.push(line);repaintBatches();}
    var current=null;
    (mapBatches||[]).forEach(function(b){if(b&&b.batchId===id)current=b;});
    var queuedAtStart=Number(current&&current.counts&&current.counts.queued);
    var previousRemaining=Number.isFinite(queuedAtStart)?queuedAtStart:null;
    var totals={sent:0,attempted:0,failures:[],passes:0,remaining:null,retryReason:""};
    // A send can span several server budgets, but this tab is not allowed to
    // hammer a refused row forever. Continue only on measured progress, yield
    // between passes, and leave a visible Retry control at every bounded stop.
    function sendLoop(){
      if(totals.passes>=MAX_SEND_PASSES){
        totals.retryReason="Paused after "+MAX_SEND_PASSES+" passes so this tab cannot retry forever.";
        return Promise.resolve(totals);
      }
      totals.passes+=1;
      return post("/api/admin/line",{action:"send",batchId:id}).then(function(pass){
        totals.sent+=Number(pass&&pass.sent)||0;
        totals.attempted+=Number(pass&&pass.attempted)||0;
        ((pass&&pass.failures)||[]).forEach(function(f){totals.failures.push(f||{});});
        var remaining=Number(pass&&pass.remaining);
        totals.remaining=Number.isFinite(remaining)?Math.max(0,remaining):null;
        say("Pass "+totals.passes+": sent "+((pass&&pass.sent)||0)+" · remaining "+(Number.isFinite(totals.remaining)?totals.remaining:"—")
          +(((pass&&pass.failures)||[]).length?" · refused "+pass.failures.length:""));
        loadBatches();
        if(pass&&pass.halted===true){say(String(pass.haltReason||"Stopped by the operator stop switch."));return totals;}
        if(!Number.isFinite(remaining)){
          totals.retryReason="The server did not report a remaining count, so the console stopped safely.";
          return totals;
        }
        if(remaining<=0)return totals;
        if(previousRemaining!==null&&remaining>=previousRemaining){
          totals.retryReason="No rows advanced in the last pass. Review the refusal, then use Retry remaining.";
          say(totals.retryReason);
          return totals;
        }
        if(previousRemaining===null&&(Number(pass&&pass.sent)||0)<=0){
          totals.retryReason="The first pass sent zero rows and did not prove progress. Use Retry remaining after checking the refusal.";
          say(totals.retryReason);
          return totals;
        }
        previousRemaining=remaining;
        if(totals.passes>=MAX_SEND_PASSES){
          totals.retryReason="Paused after "+MAX_SEND_PASSES+" passes with "+remaining+" still queued.";
          say(totals.retryReason);
          return totals;
        }
        var waitMs=Math.min(4000,500*Math.pow(2,totals.passes-1));
        say("Waiting "+waitMs+"ms before the next bounded send pass…");
        return delaySend(waitMs).then(sendLoop);
      });
    }
    var alreadyApproved=Boolean(current&&current.status==="approved");
    (alreadyApproved
      ?Promise.resolve()
      :post("/api/admin/line",{action:"approve",batchId:id,typedBatchId:id,actor:"console-owner"}).then(function(){say("Approved on the server. Sending…");}))
      .then(function(){return sendLoop();})
      .then(function(t){
        var needsRetry=Boolean(t.retryReason)||Number(t.remaining)>0;
        st.phase=needsRetry?"retry":"done";
        st.tone=(t.failures.length||needsRetry)?"bad":"ok";
        st.log.push("Server read-back: "+t.sent+" sent of "+t.attempted+" attempted · "
          +(Number.isFinite(t.remaining)?t.remaining:"—")+" remaining"
          +(t.failures.length?" · refused: "+t.failures.map(function(f){return (f.prospectId?f.prospectId+" — ":"")+(f.reason||"unnamed");}).join("; "):"")
          +(t.retryReason?" · "+t.retryReason:"")
          +(needsRetry?" — remaining rows were not claimed as sent."
            :isLive?" — prospects received them; a copy of each is in your inbox.":" — every sent row was routed to your inbox."));
        repaintBatches();
      })
      .catch(function(e){
        st.phase="failed";st.tone="bad";
        st.log.push("REFUSED: "+e.message+" — nothing beyond the passes printed above was sent.");
        repaintBatches();
      })
      .finally(function(){loadBatches();load().catch(function(){});});
  }
  // Delegated from the document, not from #batchPanel: the same pipeline
  // component also renders inside the Live Map drill, and an approve button
  // that renders without a handler is worse than no button because the
  // operator believes the batch was approved.
  document.addEventListener("click",function(ev){
    var hist=ev.target.closest&&ev.target.closest(".histrow");
    if(hist){
      var hid=hist.getAttribute("data-hist");
      if(hid){
        if(openHist[hid])delete openHist[hid];else openHist[hid]=true;
        repaintBatches();renderDrill();
      }
      return;
    }
    var btn=ev.target.closest&&ev.target.closest(".approveBtn");
    if(!btn)return;
    var id=btn.getAttribute("data-batch");
    if(!id)return;
    var st=sendStateFor(id);
    if(st.phase==="sending")return;
    var isLive=btn.getAttribute("data-lane")==="live";
    if(st.phase!=="armed"){armSend(id,isLive,Boolean(btn.closest&&btn.closest("#batchPanel")));return;}
    disarmSend(id);
    runApprovedSend(id,isLive);
  });
  // ------------------------------------------------------------------ MAP
  // The company as tiles, work as pulses between them. Harvested from the old
  // run theater (0bef655) — its live-data wiring, presented in the approved
  // design language. Every number is read from the same snapshot the Command
  // Center uses; nothing here is asserted.
  var mapSel=null, mapSnap=null, mapBatches=[];
  function num(v){return (v===0||v)?String(v):"\u2014";}
  function fmt(v){var n=Number(v);return Number.isFinite(n)?n.toLocaleString():"\u2014";}

  // A glyph per system, drawn here rather than fetched: a funnel that keeps a
  // few from many, two mirrored frames, a shield that checks, an inbox that
  // holds, a plane that leaves, a handset that rings. Meaning, not ornament \u2014
  // and no external asset, font or CDN call to render any of it.
  var GLYPH={
    funnel:'<path d="M3.5 4.5h17l-6.6 7.6v7.4l-3.8-2.1v-5.3z"/>',
    mirror:'<rect x="2.6" y="4.6" width="12.6" height="10" rx="2.2"/><rect x="8.8" y="9.4" width="12.6" height="10" rx="2.2"/>',
    shield:'<path d="M12 2.8 20 5.9v6.2c0 4.4-3.3 7.6-8 9-4.7-1.4-8-4.6-8-9V5.9z"/><path d="m8.5 11.8 2.5 2.5 4.5-4.7"/>',
    inbox:'<path d="M6 4.6h12l2.6 9.1v5.2a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6v-5.2z"/><path d="M3.4 13.7h5.1l1.5 2.6h4l1.5-2.6h5.1"/>',
    plane:'<path d="M21.2 2.8 10.6 13.4"/><path d="M21.2 2.8 14.6 21.2l-4-7.8-7.8-4z"/>',
    phone:'<path d="M8.3 4.1 10.5 7.9 8.4 10a12.2 12.2 0 0 0 5.6 5.6l2.1-2.1 3.8 2.2v3.1a1.7 1.7 0 0 1-1.9 1.7C10.4 19.6 4.4 13.6 3.5 5.9a1.7 1.7 0 0 1 1.7-1.9z"/><path d="M15.2 3.2a6.8 6.8 0 0 1 5.6 5.6"/>'
  };

  function queuedNow(){
    var q=0;
    (mapBatches||[]).forEach(function(b){var c=b.counts||{};q+=c.queued||0;});
    return q;
  }

  // SVG cannot wrap text, so each sub-line is authored as two short strings.
  // They are the same words the retired tiles carried \u2014 no new claim was
  // introduced to fill the space the bigger layout opened up.
  function systemNodes(){
    var t=(mapSnap&&mapSnap.totals)||{}, e=(mapSnap&&mapSnap.engagement)||{};
    var queued=queuedNow();
    return [
      {id:"leadminer",label:"1 \u00b7 FIND BUSINESSES",glyph:"funnel",val:num(t.prospects),
       sub:["businesses on the books","new ones arrive by the hour"],tone:""},
      {id:"build",label:"2 \u00b7 WEBSITE BUILDER",glyph:"mirror",val:num(e.previews),
       sub:["websites built","from their own facts"],tone:""},
      {id:"gate",label:"3 \u00b7 FINAL INSPECTION",glyph:"shield",
       val:mapSnap?(mapSnap.ready?"CLEAR":"BLOCKED"):"\u2014",
       sub:["every page checked","in a real browser"],
       tone:mapSnap&&mapSnap.ready!==true?"bad":"gate"},
      {id:"queue",label:"4 \u00b7 WAITING ON YOU",glyph:"inbox",val:num(queued),
       sub:["built + inspected,","parked for your OK"],tone:queued>0?"warn":""},
      {id:"send",label:"5 \u00b7 EMAILS SENT",glyph:"plane",val:num(t.emailsSent),
       sub:["delivered \u00b7 practice","sends come to your inbox"],tone:""},
      {id:"riley",label:"6 \u00b7 RILEY",glyph:"phone",val:num(t.calls),
       sub:["the client's own web","person, on the phone"],tone:""}
    ];
  }

  // WHICH WIRE IS ALIVE. A row's stage index maps onto the wire it is crossing:
  // picked and qualified are both still inside LeadMiner, so both light the
  // first wire; mirrored lights build->gate, and so on. There is no other
  // source of motion on this diagram.
  var STAGE_WIRE=[0,0,1,2,3,4];
  function volClass(v){var n=Number(v)||0;return n>=100?"v3":n>=10?"v2":n>=1?"v1":"";}

  function circuitWires(){
    var t=(mapSnap&&mapSnap.totals)||{}, e=(mapSnap&&mapSnap.engagement)||{};
    var stops=(mapSnap&&mapSnap.hardStops)||[];
    var gateBlocked=Boolean(mapSnap)&&mapSnap.ready!==true;
    var prospects=Number(t.prospects)||0, previews=Number(e.previews)||0;
    var live=[false,false,false,false,false], stall=[false,false,false,false,false];
    (mapBatches||[]).forEach(function(b){
      if(!batchRunning(b))return;
      var active=activeKey(b);
      (b.rows||[]).forEach(function(r){
        var m=rowMotion(b,r,active);
        if(m!=="act"&&m!=="stall")return;
        var p=rowPos(r); if(p<0)p=0; if(p>5)p=5;
        if(m==="act")live[STAGE_WIRE[p]]=true; else stall[STAGE_WIRE[p]]=true;
      });
    });
    // Each badge names exactly what it counts, because "126" between two
    // shapes is only honest if the operator can find out what 126 is.
    var wires=[
      {crossed:previews,lost:Math.max(0,prospects-previews),
       what:"websites built, of "+fmt(prospects)+" businesses found \u2014 lifetime"},
      {crossed:previews,what:"websites handed to final inspection \u2014 lifetime"},
      {crossed:queuedNow(),what:"inspected websites parked right now, waiting on your OK"},
      {crossed:Number(t.emailsSent)||0,what:"emails recorded by the live delivery ledger \u2014 lifetime"},
      {crossed:Number(t.calls)||0,what:"calls Riley has taken \u2014 lifetime"}
    ];
    wires.forEach(function(w,i){
      w.live=live[i];
      w.stall=!live[i]&&stall[i];
      w.blocked=gateBlocked&&(i===1||i===2);
      w.stops=stops.length;
      w.vol=volClass(w.crossed);
    });
    return wires;
  }

  // Runs, rows moving, rows stopped, batches waiting on the owner. Counted
  // from the same batch payload the rail reads.
  function circuitPulse(){
    var p={runs:0,moving:0,stalled:0,waiting:0};
    (mapBatches||[]).forEach(function(b){
      if(b.status==="awaiting_approval")p.waiting+=1;
      if(!batchRunning(b))return;
      p.runs+=1;
      var active=activeKey(b);
      (b.rows||[]).forEach(function(r){
        var m=rowMotion(b,r,active);
        if(m==="act")p.moving+=1; else if(m==="stall")p.stalled+=1;
      });
    });
    return p;
  }

  // A ring fires on a node only for a feed event this client had NOT seen on
  // the previous poll \u2014 the same discipline gainSet uses for the rail. The
  // first poll only records, so opening the console does not fire 300 rings
  // for a week of history.
  var seenFeed=null, flareNodes={};
  function feedNode(type){
    var s=String(type||"").toLowerCase();
    if(/call|vapi|riley|answercrew/.test(s))return "riley";
    if(/email|send|deliver|bounce|open|click/.test(s))return "send";
    if(/queue|batch|approv/.test(s))return "queue";
    if(/gate|render|qc/.test(s))return "gate";
    if(/build|mirror|forge|preview|site/.test(s))return "build";
    if(/mine|prospect|lead|enrich/.test(s))return "leadminer";
    return "";
  }
  function noteFeed(){
    var feed=(mapSnap&&mapSnap.feed)||[];
    var next={},fresh={};
    feed.forEach(function(ev){
      var key=String(ev&&ev.type||"")+"|"+String(ev&&ev.created_at||"");
      next[key]=1;
      if(seenFeed&&!seenFeed[key]){var id=feedNode(ev&&ev.type);if(id)fresh[id]=1;}
    });
    seenFeed=next;
    flareNodes=fresh;
  }

  // ---- geometry. Two layouts, one builder. The laser keyframes are pinned to
  // these wire lengths, so the numbers below and the CSS must move together.
  var CQ_H={w:1240,h:216,r:36,gap:46,bw:56,cy:72,cx:[76,294,512,730,948,1166]};
  var CQ_V={w:360,h:944,r:30,gap:42,bw:54,cx:52,cy:[46,214,382,550,718,886]};

  function hexPoints(cx,cy,r){
    var pts=[];
    for(var i=0;i<6;i++){
      var a=Math.PI/180*(60*i-90);
      pts.push((cx+r*Math.cos(a)).toFixed(1)+","+(cy+r*Math.sin(a)).toFixed(1));
    }
    return pts.join(" ");
  }

  function wireSvg(L,i,w,vertical){
    var a,b,mx,my,d;
    if(vertical){
      a=L.cy[i]+L.gap; b=L.cy[i+1]-L.gap; mx=L.cx; my=(a+b)/2;
      d="M"+L.cx+" "+a+"V"+b;
    }else{
      a=L.cx[i]+L.gap; b=L.cx[i+1]-L.gap; my=L.cy; mx=(a+b)/2;
      d="M"+a+" "+L.cy+"H"+b;
    }
    var tone=w.blocked?"blocked":w.stall?"stall":w.vol;
    var s='<path class="cqwire '+tone+'" d="'+d+'"/>';
    if(w.live){
      var dir=vertical?"v":"h";
      s+='<path class="cqlaser trail '+dir+'" d="'+d+'"/><path class="cqlaser '+dir+'" d="'+d+'"/>';
    }
    s+='<g><title>'+esc(w.what)+'</title>'
      +'<rect class="cqbg'+(w.live?" on":w.blocked?" bad":"")+'" x="'+(mx-L.bw/2)+'" y="'+(my-11)+'" width="'+L.bw+'" height="22" rx="11"/>'
      +'<text class="cqnum" x="'+mx+'" y="'+(my+4)+'">'+esc(fmt(w.crossed))+'</text></g>';
    // The drop-off rides beside the wire vertically and below it horizontally,
    // so it never sits on top of the line it is describing.
    if(w.lost)s+='<text class="cqlost" x="'+(vertical?mx+34:mx)+'" y="'+(vertical?my+4:my+33)+'">'
      +'<title>mined but never built</title>\u2212'+esc(fmt(w.lost))+'</text>';
    if(w.blocked)s+='<text class="cqmark" x="'+mx+'" y="'+(my-21)+'">\ud83d\udd12</text>';
    else if(w.stall)s+='<text class="cqmark" x="'+mx+'" y="'+(my-21)+'">\ud83d\udea7</text>';
    return s;
  }

  function nodeCircuitSvg(L,i,nd,wires,vertical){
    var cx=vertical?L.cx:L.cx[i], cy=vertical?L.cy[i]:L.cy;
    var into=wires[i-1], outOf=wires[i];
    var moving=Boolean((into&&into.live)||(outOf&&outOf.live));
    var held=!moving&&Boolean((into&&into.stall)||(outOf&&outOf.stall));
    // The RING carries what is happening on the wires touching this node. The
    // NUMBER keeps the node's own verdict, because a gate reading CLEAR in
    // ember — amber only because a row stalled on the wire beside it — is a
    // mixed signal, and the gate's colour is the one an operator trusts.
    var tone=nd.tone==="bad"?"bad":held?"warn":moving?"on":nd.tone;
    var valTone=nd.tone==="bad"?"bad":nd.tone==="warn"?"warn":moving?"on":"";
    var pts=hexPoints(cx,cy,L.r);
    var scale=L.r/40;
    var g='<g class="cqnode'+(mapSel===nd.id?" sel":"")+'" data-node="'+esc(nd.id)+'"'
      +' role="button" tabindex="0" aria-label="'+esc(nd.label+", "+nd.val+", "+nd.sub.join(" "))+'">'
      +'<polygon class="cqhex '+esc(tone)+'" points="'+pts+'"/>';
    if(flareNodes[nd.id])g+='<polygon class="cqping fire" points="'+pts+'"/>';
    g+='<g class="cqg '+esc(tone)+'" transform="translate('+(cx-12*scale).toFixed(1)+','+(cy-12*scale).toFixed(1)+') scale('+scale.toFixed(3)+')">'
      +GLYPH[nd.glyph]+'</g>';
    if(vertical){
      var tx=L.cx+52;
      g+='<text class="cqlab" x="'+tx+'" y="'+(cy-20)+'">'+esc(nd.label)+'</text>'
        +'<text class="cqval '+esc(valTone)+'" x="'+tx+'" y="'+(cy+4)+'">'+esc(nd.val)+'</text>'
        +'<text class="cqsub" x="'+tx+'" y="'+(cy+21)+'">'+esc(nd.sub[0])+'</text>'
        +'<text class="cqsub" x="'+tx+'" y="'+(cy+34)+'">'+esc(nd.sub[1])+'</text>';
    }else{
      var base=cy+L.r;
      g+='<text class="cqval '+esc(valTone)+'" x="'+cx+'" y="'+(base+34)+'">'+esc(nd.val)+'</text>'
        +'<text class="cqlab" x="'+cx+'" y="'+(base+54)+'">'+esc(nd.label)+'</text>'
        +'<text class="cqsub" x="'+cx+'" y="'+(base+72)+'">'+esc(nd.sub[0])+'</text>'
        +'<text class="cqsub" x="'+cx+'" y="'+(base+86)+'">'+esc(nd.sub[1])+'</text>';
    }
    return g+'</g>';
  }

  function circuitSvg(nodes,wires,vertical){
    var L=vertical?CQ_V:CQ_H;
    var alive=wires.filter(function(w){return w.live;}).length;
    var aria="Six systems wired in order: "+nodes.map(function(n){return n.label+" "+n.val;}).join("; ")
      +". "+(alive?alive+" of 5 connections are carrying work right now.":"No connection is carrying work right now.");
    var s='<svg class="cqsvg'+(vertical?" vert":"")+'" viewBox="0 0 '+L.w+' '+L.h+'" role="img" aria-label="'+esc(aria)+'">'
      +'<defs><linearGradient id="cqface" x1="0" y1="0" x2="0" y2="1">'
      +'<stop offset="0" stop-color="#1B1B24"/><stop offset="1" stop-color="#0F0F14"/></linearGradient></defs>';
    for(var i=0;i<wires.length;i++)s+=wireSvg(L,i,wires[i],vertical);
    for(var j=0;j<nodes.length;j++)s+=nodeCircuitSvg(L,j,nodes[j],wires,vertical);
    return s+'</svg>';
  }

  function pulseHtml(p){
    var say;
    if(p.moving>0)say="Work is on the wires right now \u2014 the lit segments are the ones actually carrying it.";
    else if(p.stalled>0)say="A run is open but the row it is holding has not moved in minutes. That is a stall, not progress.";
    else if(p.runs>0)say="Runs are open and no row has moved yet \u2014 nothing is travelling.";
    else say="No run is in flight. Every wire is idle, and the diagram is not going to pretend otherwise.";
    function stat(n,word,cls){
      return '<span class="cqstat '+cls+'"><b>'+esc(fmt(n))+'</b>'+esc(word)+'</span>';
    }
    return '<div class="cqbar">'
      +stat(p.runs,"campaigns running","")
      +stat(p.moving,"websites moving",p.moving?"on":"")
      +stat(p.stalled,"websites stuck",p.stalled?"warn":"")
      +stat(p.waiting,"waiting on you",p.waiting?"warn":"")
      +'<span class="cqsay">'+esc(say)+'</span></div>';
  }

  function legendHtml(){
    return '<div class="cqleg">'
      +'<span><i class="live"></i>carrying work now</span>'
      +'<span><i class="stall"></i>held, stopped moving</span>'
      +'<span><i class="blocked"></i>blocked</span>'
      +'<span><i class="idle"></i>idle</span>'
      +'<span>wire weight = lifetime volume \u00b7 the badge on each wire is the count that crossed it \u2014 hover it for what it counts</span>'
      +'</div>';
  }
  var DRILL={
    leadminer:["Finding businesses \u2014 how we find them","Finds the businesses whose websites are worst, checks their facts once, and files the research. Nothing gets built on a guess."],
    build:["Website builder \u2014 the copier that doesn't copy","Picks a true-shape starter design, wears the business's own logo, colours and photos, and refuses rather than borrow another trade's look."],
    gate:["Final inspection \u2014 the referee","Loads the finished website in a real browser and checks every fact against the business's own verified sources. Unverifiable is not verified."],
    queue:["Waiting on you \u2014 the holding area","Everything here is built and passed inspection. Real sends wait for your approval. Practice mode may send your copy only to your inbox when enabled server-side."],
    send:["Emails sent \u2014 the delivery ledger","Every send recorded with its provider id. Practice mode force-routes to your own inbox and proves it before dispatch."],
    riley:["Riley \u2014 the client's web person","They call, their website changes. Never a chatbot for their customers."]
  };
  function renderDrill(){
    var d=byId("mapDrill"); if(!d)return;
    if(!mapSel){d.innerHTML='<p class="why" style="margin:0">Six steps, wired in the order work moves through them. A lit wire is carrying a website right now; ember means the website it is holding stopped moving; amber on a step means it is waiting on you. Pick a step to look inside.</p>';return;}
    var meta=DRILL[mapSel]||["",""];
    var html='<h3>'+esc(meta[0])+'</h3><p class="why">'+esc(meta[1])+'</p>';
    if(mapSel==="queue"||mapSel==="build"||mapSel==="send"){
      // Same picture as the Command Center's Batches panel \u2014 one component,
      // so the default tab shows the line moving too instead of a word list.
      if(!mapBatches.length)html+='<div class="row"><span class="k">No runs yet this session \u2014 press Find new customers on the Command Center tab.</span></div>';
      else html+=pipelineHtml(mapBatches,5);
    } else if(mapSel==="gate"){
      var stops=(mapSnap&&mapSnap.hardStops)||[];
      if(!stops.length)html+='<div class="row"><span class="k">All gates clear</span><span class="v ok">ready</span></div>';
      stops.forEach(function(h){html+='<div class="row"><span class="k">'+esc(h.message||h.code||"")+'</span><span class="v bad">blocked</span></div>';});
    } else if(mapSel==="leadminer"){
      var t=(mapSnap&&mapSnap.totals)||{};
      html+='<div class="row"><span class="k">Businesses on the books</span><span class="v num">'+esc(num(t.prospects))+'</span></div>'
        +'<div class="row"><span class="k">Can email today</span><span class="v num">'+esc(num(t.sendable))+'</span></div>';
    } else if(mapSel==="riley"){
      var t2=(mapSnap&&mapSnap.totals)||{};
      html+='<div class="row"><span class="k">Calls recorded</span><span class="v num">'+esc(num(t2.calls))+'</span></div>';
    }
    d.innerHTML=html;
    mountShots(d,"map");
  }
  // The vertical layout is chosen from the SAME breakpoint the stylesheet
  // uses. It re-renders on the media query's own change event rather than on
  // a resize poll, so the page still owns exactly one timer.
  var cqNarrow=window.matchMedia?window.matchMedia("(max-width:900px)"):null;
  function renderMap(){
    var host=byId("liveMap"); if(!host)return;
    var mapPanel=byId("tabPanelMap"); if(mapPanel&&mapPanel.hidden)return;
    var nodes=systemNodes(), wires=circuitWires(), pulse=circuitPulse();
    host.innerHTML='<div class="map-h"><h2>The company, live</h2>'
      +'<span class="label">click any step to look inside</span></div>'
      +'<div class="cq">'+circuitSvg(nodes,wires,Boolean(cqNarrow&&cqNarrow.matches))+'</div>'
      +pulseHtml(pulse)+legendHtml()
      +'<div class="map-drill" id="mapDrill"></div>';
    // One shot: a ring that survived into a second render would be a ring
    // firing for an event that already happened.
    flareNodes={};
    renderDrill();
  }
  if(cqNarrow){
    if(cqNarrow.addEventListener)cqNarrow.addEventListener("change",function(){renderMap();});
    else if(cqNarrow.addListener)cqNarrow.addListener(function(){renderMap();});
  }
  function pickNode(target){
    var n=target&&target.closest&&target.closest("[data-node]");
    if(!n)return;
    var id=n.getAttribute("data-node");
    mapSel=(mapSel===id)?null:id;
    renderMap();
  }
  document.addEventListener("click",function(ev){pickNode(ev.target);});
  // The nodes carry role="button"; a role="button" that only answers the mouse
  // is a lie about what it is.
  document.addEventListener("keydown",function(ev){
    if(ev.key!=="Enter"&&ev.key!==" ")return;
    if(!(ev.target&&ev.target.closest&&ev.target.closest("[data-node]")))return;
    ev.preventDefault();
    pickNode(ev.target);
  });

  // The one-line pointer under the halt bar: when any batch is awaiting the
  // owner with finished sites on it, say so in his words and point at
  // /campaigns. Counts come from the same server snapshot the batch panel
  // renders — the banner can never claim sites the list does not show.
  function renderReadyBanner(list){
    var node=byId("readyBanner");
    if(!node)return;
    var ready=0;
    (list||[]).forEach(function(b){
      if(!b)return;
      if((b.status==="awaiting_approval"||b.status==="approved")&&Number((b.counts||{}).queued)>0)ready+=Number(b.counts.queued)||0;
    });
    if(ready>0){
      node.textContent=(ready===1?"1 site is":ready+" sites are")+" ready to send \\u2014 go to Campaigns";
      node.hidden=false;
    }else{
      node.hidden=true;
    }
  }

  var batchesBusy=false,lineTimer=null,lastLineSig="";
  function lineSig(list){
    return (list||[]).map(function(b){
      var c=b.counts||{},a=activeKey(b);
      return b.batchId+"|"+b.status+"|"+b.lane+"|"+c.total+"/"+c.queued+"/"+c.sent+"/"+c.failed+"/"+c.working+"~"
        +(b.rows||[]).map(function(r){
          return (r.prospectId||r.businessName)+"="+r.status+"."+((r.reached||[]).length)+"."+rowMotion(b,r,a)+"."+(r.shotUrl?1:0);
        }).join(",");
    }).join("||");
  }
  function loadBatches(){
    if(batchesBusy||document.hidden||!token())return Promise.resolve(mapBatches||[]);
    batchesBusy=true;
    if(lineTimer){window.clearTimeout(lineTimer);lineTimer=null;}
    return api("/api/admin/line").then(function(d){
      lineCapacity=d&&d.capacity||lineCapacity;
      var list=(d&&d.batches)||[];
      noteMotion(list); mapBatches=list;
      arcadeLineData(list); // arcade hero: theater stage truth + row-ladder events (replay-safe)
      var sig=lineSig(list);
      if(sig!==lastLineSig){
        lastLineSig=sig;
        renderBatches(list); renderReadyBanner(list);
        if(typeof tabPanelLoaded!=="undefined"&&tabPanelLoaded.line)renderLineWorkshop(list);
        renderMap();
      }
      // Active snapshots can be running | building | sending; terminal and
      // approval states do not need the fast follow-up. This poll used to name
      // "collecting" and "working", which the state machine has never emitted,
      // so it never fired: a live run only refreshed on the 30s console-data
      // tick and the panel looked frozen while the line was moving. The 30s
      // poll contract above is untouched; this is the same follow-up the
      // original author wrote, aimed at the states that actually exist.
      var working=list.some(function(b){return batchRunning(b);});
      if(working)lineTimer=window.setTimeout(loadBatches,5000);
      return list;
    }).catch(function(){return mapBatches||[];}).finally(function(){batchesBusy=false;});
  }
  // The release pills and the footer strip of build telemetry were retired
  // from the owner face by the campaign-flow pass (2026-08-16); the read
  // that fed them went with them. Nothing else here consumed /api/health.

  var mineVertical=document.getElementById("mineVertical");
  var mineLocation=document.getElementById("mineLocation");
  function mineTarget(){
    var v=mineVertical.value.trim(), loc=mineLocation.value.trim();
    if(!v)return "";
    if(v==="leadminer")return "leadminer";
    return loc?(v+" in "+loc):(v+" nationwide");
  }
  function armMineButtons(){
    var ready=!!mineVertical.value.trim();
    document.querySelectorAll(".launchBtn").forEach(function(node){node.disabled=!ready||launchBusy;});
  }
  function launchRequestChanged(){clearStartRetryKey();armMineButtons();wizSync();}
  mineVertical.addEventListener("change",launchRequestChanged);
  mineLocation.addEventListener("input",launchRequestChanged);
  // The mode toggle. Deliberately NOT persisted: live is chosen per session
  // with eyes open, never inherited from last week's tab. #laneMode is the
  // one source of truth currentLane() reads; in the wizard it is the hidden
  // state holder that the two visible Practice/Real choices set.
  var laneModeBtn=document.getElementById("laneMode");
  function currentLane(){return laneModeBtn&&laneModeBtn.getAttribute("data-lane")==="live"?"live":"sandbox";}
  if(laneModeBtn){
    laneModeBtn.addEventListener("click",function(){
      clearStartRetryKey();
      setWizardLane(currentLane()==="live"?"sandbox":"live");
    });
  }
  function allocateWaveQuotas(remaining,slots,perBatchCap){
    var left=Math.max(0,Math.floor(Number(remaining)||0));
    var width=Math.max(0,Math.floor(Number(slots)||0));
    var cap=Math.max(1,Math.floor(Number(perBatchCap)||1));
    var total=Math.min(left,width*cap);
    var used=Math.min(width,total);
    if(!used)return [];
    var base=Math.floor(total/used),extra=total%used,out=[];
    for(var i=0;i<used;i++)out.push(base+(i<extra?1:0));
    return out;
  }
  // =================================================================
  // THE WIZARD — 1, 2, 3, then one GO button
  // -----------------------------------------------------------------
  // Owner verdict 2026-08-16: "there is NO WORKFLOW. No A, B, C, 1, 2, 3
  // feel." One step visible at a time, the numbered rail always showing
  // where you are, and nothing launches until the single big GO. The Build
  // N buttons are now CHOICES, not launchers; GO runs the exact same
  // canonical launch the buttons used to fire.
  // =================================================================
  var WIZ={step:1,count:0};
  function wizShow(step){
    WIZ.step=Math.max(1,Math.min(3,Number(step)||1));
    for(var i=1;i<=3;i+=1){
      var panel=byId("wzStep"+i);
      if(panel)panel.hidden=i!==WIZ.step;
    }
    var rail=byId("wzRail");
    if(rail)Array.prototype.forEach.call(rail.querySelectorAll(".wz-ri"),function(item){
      var n=Number(item.getAttribute("data-wstep"))||0;
      if(n===WIZ.step){item.setAttribute("aria-current","step");item.removeAttribute("data-done");}
      else{
        item.removeAttribute("aria-current");
        if(n<WIZ.step||(n===2&&WIZ.count))item.setAttribute("data-done","1");
      }
    });
  }
  function wizSync(){
    var trade=!!mineVertical.value.trim();
    var next1=byId("wzNext1");
    if(next1)next1.disabled=!trade;
    var next2=byId("wzNext2");
    if(next2)next2.disabled=!WIZ.count;
    var go=byId("goButton");
    if(go)go.disabled=!(trade&&WIZ.count);
    armMineButtons();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".wz-next"),function(button){
    button.addEventListener("click",function(){wizShow(Number(button.getAttribute("data-next"))||1);});
  });
  Array.prototype.forEach.call(document.querySelectorAll(".wz-back"),function(button){
    button.addEventListener("click",function(){wizShow(Number(button.getAttribute("data-back"))||1);});
  });
  // Step 3's two visible choices set the SAME #laneMode state the pinned
  // launch contract reads — no second source of truth for the lane.
  function setWizardLane(lane){
    var live=lane==="live";
    if(laneModeBtn){
      laneModeBtn.setAttribute("data-lane",live?"live":"sandbox");
      laneModeBtn.textContent=live?"Real sends — business owners get emails after your OK (you get a copy of every one)":"Practice mode — every email comes only to you";
    }
    syncDonorOptions();
    launchRequestChanged();
    Array.prototype.forEach.call(document.querySelectorAll(".wz-choice"),function(choice){
      var picked=choice.getAttribute("data-lane")===(live?"live":"sandbox");
      choice.classList.toggle("picked",picked);
      choice.setAttribute("aria-pressed",picked?"true":"false");
    });
    launchOut.textContent=live
      ?"Real sends selected. Nothing goes out until you approve it below; once you do, each business owner gets their email and every one is copied to your inbox. If the server-side safety switch is off, the run will refuse and say so."
      :"Practice mode. Every email routes to your inbox only. Practice mode may auto-send your copy there when enabled server-side; no business owner can be reached.";
  }
  Array.prototype.forEach.call(document.querySelectorAll(".wz-choice"),function(choice){
    choice.addEventListener("click",function(){
      if(launchBusy)return;
      clearStartRetryKey();
      setWizardLane(choice.getAttribute("data-lane")==="live"?"live":"sandbox");
    });
  });

  document.querySelectorAll(".launchBtn").forEach(function(button){
    button.addEventListener("click",function(){
      // The Build N buttons are the wizard's count CHOICE now — they pick
      // the number; the GO button launches it.
      if(launchBusy)return;
      var count=finite(button.getAttribute("data-n"));
      if([10,50,100,500].indexOf(count)<0)return;
      WIZ.count=count;
      document.querySelectorAll(".launchBtn").forEach(function(node){
        var picked=node===button;
        node.classList.toggle("picked",picked);
        node.setAttribute("aria-pressed",picked?"true":"false");
      });
      wizSync();
    });
  });
  // THE GO BUTTON — one huge press, the same canonical launch the Build N
  // buttons used to fire directly.
  var goButton=document.getElementById("goButton");
  if(goButton)goButton.addEventListener("click",function(){launchCampaign(WIZ.count);});

  function launchCampaign(count){
      if(launchBusy)return;
      var target=mineTarget();
      if([10,50,100,500].indexOf(count)<0||!target)return;
      launchBusy=true;
      var buttons=Array.from(document.querySelectorAll(".launchBtn"));
      buttons.forEach(function(node){node.disabled=true;node.classList.add("busy");});
      var campaignVertical=mineVertical.value.trim();
      var campaignLocation=mineLocation.value.trim();
      var packetSource=campaignVertical==="leadminer";
      var fixedCity=true; // the server now owns every replacement and source rotation
      var campaignLane=currentLane();
      function nextCampaignTarget(){
        if(packetSource)return "leadminer";
        return campaignLocation?(campaignVertical+" in "+campaignLocation):(campaignVertical+" nationwide");
      }
      var WAVE=1;
      // A launch owns a hard request budget. Nationwide requests are split
      // across metros in quotas whose sum can never exceed Run N.
      var goal=count,found=0,requested=0,runs=0;
      var maxRuns=1;
      var lastBatch=null;
      // INSTANT FEEDBACK (owner instruction 2026-08-06: "I pressed the run ten
      // sites button, and now nothing is happening"). The card exists from
      // this very click and resolves in place when the run settles.
      startCampaign(
        packetSource?"All trades — ready-made research":(campaignVertical+" — "+(campaignLocation||"anywhere in America")),
        campaignLane,goal,packetSource);
      launchOut.setAttribute("aria-busy","true");
      function syncFound(){
        found=0;
        campaignBatches().forEach(function(batch){
          var counts=batch.counts||{};
          found+=(Number(counts.queued)||0)+(Number(counts.sent)||0);
          lastBatch=batch;
        });
        if(campaign){campaign.found=found;campaign.requested=requested;}
        return found;
      }
      function note(msg){
        launchOut.textContent=msg;
        if(campaign){campaign.note=msg;campaign.found=found;repaintBatches();}
      }
      function finish(msg,state){
        launchOut.textContent=msg;
        launchOut.setAttribute("aria-busy","false");
        launchBusy=false;
        buttons.forEach(function(node){node.classList.remove("busy");});
        armMineButtons();
        wizSync();
        settleCampaign(state||"done",msg);
        load().catch(function(){});loadBatches();
      }
      var stoppedWhy="";
      // Durable continuation belongs to the server. This page only GET-polls
      // the exact batch ids returned by its initial start requests.
      function waitForWave(waveIds){
        if(!waveIds.length)return Promise.resolve([]);
        if(!token())return Promise.resolve(campaignBatches().filter(function(batch){return waveIds.indexOf(batch.batchId)>=0;}));
        return loadBatches().then(function(){
          syncFound();
          var exact=campaignBatches().filter(function(batch){return waveIds.indexOf(batch.batchId)>=0;});
          var active=exact.some(function(batch){return batchRunning(batch);});
          if(!active)return exact;
          note("Server is still building "+activeCount(exact)+" campaign"+(activeCount(exact)===1?"":"s")+" · "+found+" of "+goal+" websites finished…");
          return new Promise(function(resolve){window.setTimeout(resolve,5000);})
            .then(function(){return waitForWave(waveIds);});
        });
      }
      function activeCount(list){
        return (list||[]).filter(function(batch){return batchRunning(batch);}).length;
      }
      function runWave(){
        if(halt.active===true){finish("STOPPED — the operator stop switch is set. "+found+" website"+(found===1?"":"s")+" built before it; no further businesses were contacted.","stopped");return;}
        syncFound();
        var remainingRequest=goal-requested;
        if(remainingRequest<=0){
          finish(found+" of "+goal+" websites finished after asking for exactly "+requested+". No extra campaign was started.","done");
          return;
        }
        var slots=Math.min(WAVE,maxRuns-runs);
        var perBatchCap=fixedCity?remainingRequest:50;
        var quotas=allocateWaveQuotas(remainingRequest,slots,perBatchCap);
        if(!quotas.length){
          finish(found+" of "+goal+" websites finished. The safe request budget is used up; no extra campaign was started.","done");
          return;
        }
        var targets=quotas.map(function(){return nextCampaignTarget();});
        var waveIds=[],waveErrors=[];
        note(packetSource
          ?"Reading your finished research — building up to "+quotas[0]+" website"+(quotas[0]===1?"":"s")+"…"
          :"Looking for "+targets.join(" · ")+" — building "+quotas.join(" + ")+" website"+(quotas.reduce(function(sum,n){return sum+n;},0)===1?"":"s")+"…");
        Promise.all(targets.map(function(t,index){
          var quota=quotas[index];
          requested+=quota;runs+=1;
          if(campaign){campaign.requested=requested;campaign.runs=runs;}
          var signature=startSignature(campaignLane,t,quota);
          var idempotencyKey;
          try{idempotencyKey=startKeyFor(signature);}catch(error){waveErrors.push(error.message||"secure launch key unavailable");return Promise.resolve();}
          return post("/api/admin/line",{action:"start",count:quota,target:t,lane:campaignLane}).then(function(result){
            if(!(result&&result.ok===false&&result.retryable===true))clearStartRetryKey(signature,idempotencyKey);
            var id=retainCampaignBatch(result);
            if(id&&waveIds.indexOf(id)<0)waveIds.push(id);
            else if(!id)waveErrors.push("the server accepted a start without returning its batch id");
            if(result&&result.batch)lastBatch=result.batch;
            if(result&&result.halted===true&&!stoppedWhy)stoppedWhy=String(result.haltReason||"the operator stop switch is set");
          }).catch(function(error){
            if(error.status===401||error.status===403){clearToken();showGate("Token expired or rejected. Enter a current operator token.");}
            if(!startFailureRetryable(error))clearStartRetryKey(signature,idempotencyKey);
            waveErrors.push(error.message||"start request failed");
          });
        })).then(function(){return waitForWave(waveIds);}).then(function(){
          syncFound();
          return refreshHalt().then(function(){
            if(stoppedWhy||halt.active===true){finish("STOPPED MID-RUN. "+(stoppedWhy||"The operator stop switch is set.")+" "+found+" finished website"+(found===1?" was":"s were")+" kept; nothing further was started.","stopped");return;}
            if(waveErrors.length){
              finish("Paused safely: "+waveErrors.join("; ")+". This page did not retry an uncertain start. "+found+" of "+goal+" websites finished.","failed");
              return;
            }
            if(packetSource){finish(packetRunNote(lastBatch,found,goal,queuedAwaitingElsewhere(lastBatch&&lastBatch.batchId)));return;}
            if(found>=goal){finish("Done: "+found+" website"+(found===1?"":"s")+" finished and waiting for your OK. Approve & send below.");return;}
            if(requested>=goal||runs>=maxRuns){
              finish(found+" of "+goal+" websites finished. The launch cap was honored; no extra websites were requested."+(found?" Approve & send below.":""),"done");
              return;
            }
            runWave();
          });
        }).catch(function(e){finish("Stopped early: "+e.message+(found?" — "+found+" websites already finished.":""),"failed");});
      }
      runWave();
  }
  // =================================================================
  // WSS GHOST ARCADE — the overview hero (additive watching layer).
  // -----------------------------------------------------------------
  // The hero (factory map + run theater) is a WATCHING SURFACE mounted above
  // the glance deck. It owns no controls and starts no work; it renders only
  // what these polls already fetch or explicitly scheduled reads:
  //   · /api/admin/console-data — the existing 30s load() feeds station
  //     counters, crew states, engagement, and hard-stop / pause truth.
  //   · /api/admin/line — the existing 5s-while-working loadBatches() is the
  //     theater's stage truth and the only source of row-ladder events
  //     (qualified / built / queued / sent / blocked with reason).
  //   · /api/admin/vapi-calls — every 7s while visible. ok:false is the
  //     disconnected truth: no rings, no crew motion, the reason is the note.
  //   · /api/admin/gallery-data — every 60s while visible: BUILD counter and
  //     installed-base clients. A failed read leaves Unknown, never zero.
  //   · /api/admin/revenue-summary — optional (PR #693 may not be deployed).
  //     Anything but a clean answer — including 404 — leaves MRR Unknown and
  //     stops the poll. It never invents a number.
  // REPLAY SAFETY (the noteFeed law, event-map §5): the first observation only
  // records ("prime, don't play"). Counters are ABSOLUTE snapshot values — an
  // event fires only when a freshly observed absolute value RISES; decreasing
  // values only re-baseline. Every event id is durable (counter name:value,
  // batch|row:stage, vapi call id), so a re-poll can never replay one, and the
  // local seen-set is bounded. One email = one envelope: queued/sent come from
  // line rows only, built from mirrored rows only; counter transitions feed
  // mined / opened / clicked / paid, which have no row source.
  // ?demo=arcade mounts the module's synthetic loop instead: the page fetches
  // nothing, starts no polls, and skips the token gate.
  // =================================================================
  var ARCADE_DEMO=/(?:^|[?&])demo=arcade(?:&|$)/.test(location.search||"");
  var arcadeCtl=null;
  var arcadeSeenQ=[]; var arcadeSeen={};   // bounded seen-set of durable event keys
  var arcadeAbs={};                        // absolute counters last observed
  var arcadeRows={};                       // batch|row -> {s:reached signature, d:dead} at last poll
  var arcadeLineList=[];                   // latest /api/admin/line batches
  var arcadeConsolePart=null;              // console-data derived partial hero state
  var arcadeBuildCount=null;               // gallery builds (Unknown until a clean read)
  var arcadeClientCount=null;              // gallery paid clients
  var arcadeRevenueMrr=null;               // revenue-summary MRR (Unknown until proven)
  var arcadeRevenueDone=false;
  var arcadeVapiNote="";                   // voice disconnect reason, rendered as the ENGAGE note
  var arcadeVapiLive=null;                 // live call ids seen on the previous poll
  var arcadeVapiPrimed=false;
  var arcadeVapiBusy=false; var arcadeGalleryBusy=false; var arcadeRevenueBusy=false;
  var arcadeVapiTimer=null; var arcadeGalleryTimer=null; var arcadeRevenueTimer=null;
  var ARCADE_THEATER_STAGES=["START","MINE","QUALIFY","BUILD","QUEUE","APPROVE","SEND"];
  function arcadeOn(){return Boolean(arcadeCtl&&!arcadeCtl.destroyed&&!ARCADE_DEMO&&token());}
  function arcadeAllow(id){
    if(arcadeSeen[id])return false;
    arcadeSeen[id]=1; arcadeSeenQ.push(id);
    if(arcadeSeenQ.length>600)delete arcadeSeen[arcadeSeenQ.shift()];
    return true;
  }
  function arcadePush(id,type,station,payload){
    if(!arcadeOn())return;
    if(!arcadeAllow(String(id)))return;
    try{arcadeCtl.pushEvent({id:String(id),type:type,at:Date.now(),station:station,payload:payload||{}});}
    catch(_){ /* the watching surface must never break the console */ }
  }
  // Absolute-counter transition: fires only on an observed rise of a
  // server-owned number; first sight or a decrease only records.
  function arcadeCounter(key,value){
    var n=finite(value);
    if(n===null){delete arcadeAbs[key];return null;}
    var prev=arcadeAbs[key];
    arcadeAbs[key]=n;
    if(prev===undefined||n<=prev)return false;
    arcadePush("arc:cnt:"+key+":"+n,arcadeCounterType[key].type,arcadeCounterType[key].station,{});
    return true;
  }
  var arcadeCounterType={
    "mine.prospects":{type:"mined",station:"mine"},
    "engage.opens":{type:"opened",station:"engage"},
    "engage.clicks":{type:"clicked",station:"engage"},
    "convert.won":{type:"paid",station:"convert"}
  };
  function arcadeFresh(iso,ms){
    var t=Date.parse(String(iso||""));
    return Number.isFinite(t)&&(Date.now()-t)<(ms||STALL_MS);
  }
  function arcadeHumanReason(r){
    var fact=r&&r.failedFacts&&r.failedFacts[0];
    return String((r&&(r.reason||(fact&&(fact.reason||fact.fact))||r.contactHoldReason||r.status))||"Blocked");
  }
  function arcadeRowStageStation(r){
    var reached="|"+String(((r&&r.reached)||[]).join("|"))+"|";
    if(reached.indexOf("|queued|")>=0)return "outreach";
    if(reached.indexOf("|gate_passed|")>=0||reached.indexOf("|mirrored|")>=0)return "build";
    if(reached.indexOf("|qualified|")>=0)return "qualify";
    return "mine";
  }
  function arcadeLineData(list){
    arcadeLineList=Array.isArray(list)?list:[];
    if(!arcadeOn())return;
    var totalRows=0;
    arcadeLineList.forEach(function(b){totalRows+=(b.rows||[]).length;});
    if(totalRows>2000){arcadeRows={};arcadeRender();return;} // bounded: re-prime rather than grow without limit
    arcadeLineList.forEach(function(b){
      (b.rows||[]).forEach(function(r){
        var key=String(b.batchId||"")+"|"+String(r.prospectId||r.businessName||"");
        var sig=String((r.reached||[]).join(","));
        var dead=DEAD_STATES[String(r.status||"")]===1;
        var prev=arcadeRows[key];
        arcadeRows[key]={s:sig,d:dead?1:0};
        if(!prev)return; // prime: first observation records, never plays
        var gained=function(stage){return sig.indexOf(stage)>=0&&String(prev.s).indexOf(stage)<0;};
        if(dead&&!prev.d){
          arcadePush("arc:row:"+key+":dead","blocked",arcadeRowStageStation(r),{reason:arcadeHumanReason(r)});
          return;
        }
        if(dead||prev.d)return;
        if(gained("qualified")){
          var held=r.contactReady===false&&r.contactHoldReason;
          arcadePush("arc:row:"+key+":qualified","qualified","qualify",held?{blocked:true,reason:String(r.contactHoldReason)}:{});
        }
        if(gained("mirrored"))arcadePush("arc:row:"+key+":mirrored","built","build",{});
        if(gained("queued"))arcadePush("arc:row:"+key+":queued","queued","outreach",{});
        if(gained("sent"))arcadePush("arc:row:"+key+":sent","sent","outreach",{});
      });
    });
    arcadeRender();
  }
  function arcadeTheaterState(){
    var best=null; var bestScore=-1;
    arcadeLineList.forEach(function(b){
      var status=String(b.status||"");
      var active=batchRunning(b)||status==="awaiting_approval";
      var started=Date.parse(String(b.startedAt||""))||0;
      var score=(active?1e13:0)+started; // a live batch always outranks a finished one
      if(score>bestScore){bestScore=score;best=b;}
    });
    var idx=0; var elapsed=null; var business=null; var paused=null;
    if(best){
      var status=String(best.status||"");
      var maxStage=0;
      (best.rows||[]).forEach(function(r){
        if(DEAD_STATES[String(r.status||"")]===1)return;
        var reached="|"+String(((r&&r.reached)||[]).join("|"))+"|";
        var o=1; // mining by default
        if(reached.indexOf("|picked|")>=0)o=2;
        if(reached.indexOf("|qualified|")>=0)o=3;
        if(reached.indexOf("|mirrored|")>=0||reached.indexOf("|gate_passed|")>=0||reached.indexOf("|queued|")>=0)o=4;
        if(o>maxStage)maxStage=o;
        if(!business&&arcadeFresh(r.updatedAt)&&r.businessName)business=String(r.businessName);
      });
      idx=maxStage;
      if(status==="awaiting_approval")idx=5;
      if(status==="sending"||status==="done")idx=6;
      if(!business){(best.rows||[]).forEach(function(r){if(!business&&!DEAD_STATES[String(r.status||"")]&&r.businessName)business=String(r.businessName);});}
      var startedAt=Date.parse(String(best.startedAt||""));
      if(Number.isFinite(startedAt)&&startedAt>0)elapsed=Math.max(0,Date.now()-startedAt);
      if(best.haltReason)paused=String(best.haltReason);
    }
    return {stages:ARCADE_THEATER_STAGES,currentIndex:idx,elapsedMs:elapsed,currentBusiness:business,pausedReason:paused};
  }
  function arcadeConsoleData(snapshot){
    if(!arcadeOn())return;
    var d=snapshot||{};
    var t=d.totals||{};
    var eng=d.engagement||{};
    var tracking=d.tracking||{};
    var needs=d.needsAction||{};
    var won=null;
    var funnel=d.funnel||[];
    for(var i=0;i<funnel.length;i++){if(String(funnel[i].status)==="won"){won=finite(funnel[i].count);break;}}
    var sentToday=null;
    var now=new Date(); var pad2=function(n){return (n<10?"0":"")+n;};
    var todayKey=now.getFullYear()+"-"+pad2(now.getMonth()+1)+"-"+pad2(now.getDate());
    (d.byDay||[]).forEach(function(row){if(String(row.date)===todayKey)sentToday=finite(row.count);});
    var blocked=Boolean(d.hardStops&&d.hardStops.length)||Boolean(d.drip&&d.drip.deliveryPause&&d.drip.deliveryPause.active);
    var pauseNote="";
    if(d.drip&&d.drip.deliveryPause&&d.drip.deliveryPause.active)pauseNote="Delivery pause: "+String(d.drip.deliveryPause.reason||"threshold crossed");
    else if(d.hardStops&&d.hardStops[0])pauseNote=String(d.hardStops[0]);
    // Open/click truth is conditional (tracking-truth): when the deployment
    // cannot verify opens, Unknown is the answer and no pulse may fire.
    var untracked=String(eng.zeroOpenMeaning||tracking.zeroOpenMeaning||"")==="untracked";
    var openSet=untracked?null:(eng.openedProspects!=null?eng.openedProspects:eng.opens);
    var clickSet=untracked?null:(eng.clickedProspects!=null?eng.clickedProspects:eng.clicks);
    var workingMine=arcadeFresh(d.mineRuns&&d.mineRuns[0]&&d.mineRuns[0].at);
    var workingGhost=arcadeFresh(d.recentEmails&&d.recentEmails[0]&&d.recentEmails[0].sent_at);
    var workingForge=false;
    arcadeLineList.forEach(function(b){(b.rows||[]).forEach(function(r){if(!workingForge&&arcadeFresh(r.updatedAt)&&String(r.status)==="mirrored")workingForge=true;});});
    var callsLive=arcadeVapiLive?Object.keys(arcadeVapiLive).length:0;
    arcadeConsolePart={
      stations:{
        mine:{status:workingMine?"working":"idle",count:finite(t.prospects),note:""},
        qualify:{status:"idle",count:finite(t.sendable),note:needs.contactHold?finite(needs.contactHold)+" holding for contact OK":""},
        build:{status:workingForge?"working":"idle",count:arcadeBuildCount,note:""},
        outreach:{status:blocked?"blocked":"idle",count:finite(t.emailsSent),note:pauseNote},
        engage:{status:callsLive?"working":"idle",count:finite(openSet),note:untracked?"Opens not tracked — Unknown is the truth":(arcadeVapiNote||"")},
        convert:{status:"idle",count:won,note:arcadeClientCount!=null?arcadeClientCount+" active client"+(arcadeClientCount===1?"":"s")+" installed":""}
      },
      metrics:{mrr:arcadeRevenueMrr,sentToday:sentToday,sitesBuilt:arcadeBuildCount},
      crew:{
        leadminer:workingMine?"working":"resting",
        researcher:"resting",
        siteforge:workingForge?"working":"resting",
        ghost:workingGhost?"working":"resting",
        riley:callsLive?"working":"resting",
        answercrew:callsLive?"working":(needs.activeAgentCalls?"starting":"resting"),
        callprep:"resting",
        checkout:"resting"
      },
      theaterPause:pauseNote
    };
    // Counter-driven one-shots (absolute rises only). queued/sent/built come
    // from line rows so one real email never draws twice.
    arcadeCounter("mine.prospects",t.prospects);
    arcadeCounter("engage.opens",openSet);
    arcadeCounter("engage.clicks",clickSet);
    arcadeCounter("convert.won",won);
    arcadeRender();
  }
  function arcadeRender(){
    if(!arcadeCtl||arcadeCtl.destroyed)return;
    var stations={mine:{status:"idle",count:null,note:""},qualify:{status:"idle",count:null,note:""},build:{status:"idle",count:null,note:""},outreach:{status:"idle",count:null,note:""},engage:{status:"idle",count:null,note:""},convert:{status:"idle",count:null,note:""}};
    var metrics={mrr:null,sentToday:null,sitesBuilt:null};
    var crew={leadminer:"resting",researcher:"resting",siteforge:"resting",ghost:"resting",riley:"resting",answercrew:"resting",callprep:"resting",checkout:"resting"};
    var part=arcadeConsolePart;
    if(part){
      ["mine","qualify","build","outreach","engage","convert"].forEach(function(k){if(part.stations&&part.stations[k])stations[k]=part.stations[k];});
      if(part.metrics)metrics=part.metrics;
      ["leadminer","researcher","siteforge","ghost","riley","answercrew","callprep","checkout"].forEach(function(k){if(part.crew&&part.crew[k])crew[k]=part.crew[k];});
    }
    var theater=arcadeTheaterState();
    if(!theater.pausedReason&&part&&part.theaterPause)theater.pausedReason=part.theaterPause;
    try{arcadeCtl.setState({stations:stations,theater:theater,metrics:metrics,crew:crew});}
    catch(_){ /* the watching surface must never break the console */ }
  }
  function arcadePollVapi(){
    if(!arcadeOn()||document.hidden||arcadeVapiBusy)return;
    arcadeVapiBusy=true;
    api("/api/admin/vapi-calls").then(function(d){
      arcadeVapiBusy=false;
      if(!d||d.ok!==true){
        // Disconnected truth (the callsAvailable:false lane): no rings, no crew
        // motion — the reason is the note. Silence is never liveness.
        arcadeVapiLive=null; arcadeVapiPrimed=true;
        arcadeVapiNote="Voice not connected: "+String((d&&d.error)||"unreachable");
        arcadeRender();
        return;
      }
      var live={};
      (d.liveCalls||[]).forEach(function(c){if(c&&c.id!=null)live[String(c.id)]=1;});
      if(!arcadeVapiPrimed){arcadeVapiPrimed=true;arcadeVapiLive=live;} // a ring in flight at first paint never replays
      else{
        var freshIds=Object.keys(live).filter(function(id){return !arcadeVapiLive[id];});
        arcadeVapiLive=live;
        // One ring per newly observed live call, staggered like noteFeed flares.
        freshIds.forEach(function(id,n){
          window.setTimeout(function(){arcadePush("arc:call:"+id,"called","engage",{});},n*650);
        });
      }
      arcadeVapiNote="";
      arcadeRender();
    }).catch(function(){
      arcadeVapiBusy=false;
      arcadeVapiLive=null; arcadeVapiPrimed=true;
      arcadeVapiNote="Voice not connected: unreachable";
      arcadeRender();
    });
  }
  function arcadePollGallery(){
    if(!arcadeOn()||document.hidden||arcadeGalleryBusy)return;
    arcadeGalleryBusy=true;
    api("/api/admin/gallery-data").then(function(d){
      arcadeGalleryBusy=false;
      var builds=d&&d.builds;
      var clients=d&&d.clients;
      arcadeBuildCount=Array.isArray(builds)?builds.length:null;   // a failed read leaves Unknown, never zero
      arcadeClientCount=Array.isArray(clients)?clients.length:null;
      arcadeRender();
    }).catch(function(){arcadeGalleryBusy=false;});
  }
  function arcadePollRevenue(){
    if(arcadeRevenueDone||!arcadeOn()||document.hidden||arcadeRevenueBusy)return;
    arcadeRevenueBusy=true;
    api("/api/admin/revenue-summary").then(function(d){
      arcadeRevenueBusy=false;
      if(!d||d.ok===false){arcadeRevenueDone=true;return;}
      // revenue-summary mrr is CENTS (activeClients x planAmountCents); the
      // hero renders dollars. mrrSource:"unknown" already arrives as null.
      var raw=null;
      if(d.mrr!=null)raw=Number(d.mrr)/100;
      arcadeRevenueMrr=raw==null?null:finite(raw);
      arcadeRender();
    }).catch(function(error){
      arcadeRevenueBusy=false;
      if(error&&error.status===404)arcadeRevenueDone=true; // route absent in this deployment: stop asking, MRR stays Unknown
    });
  }
  function armArcadeFeeds(){
    if(arcadeVapiTimer||arcadeGalleryTimer||arcadeRevenueTimer)return;
    arcadeVapiTimer=window.setInterval(arcadePollVapi,7000);
    arcadeGalleryTimer=window.setInterval(arcadePollGallery,60000);
    arcadeRevenueTimer=window.setInterval(arcadePollRevenue,120000);
  }
  function mountArcade(){
    var host=document.getElementById("wssArcadeHero");
    if(!host||!window.WSSArcade||typeof window.WSSArcade.mount!=="function")return null;
    try{arcadeCtl=window.WSSArcade.mount(host,{mode:ARCADE_DEMO?"demo":"live",reducedMotion:false,sound:false});}
    catch(_){arcadeCtl=null;}
    return arcadeCtl;
  }
  function armPoll(){
    if(pollTimer)window.clearInterval(pollTimer);
    pollTimer=window.setInterval(function(){if(!document.hidden&&token())load().catch(function(){});},30000);
  }
  document.addEventListener("visibilitychange",function(){if(ARCADE_DEMO||document.hidden||!token())return;load().catch(function(){});});
  mountArcade();
  if(ARCADE_DEMO){
    // DEMO ARCADE (?demo=arcade): the hero runs its own clearly-banned
    // synthetic loop and this page fetches NOTHING — no token gate, no polls,
    // no authenticated calls, no localStorage writes. The module's banner is
    // the contract: DEMO — NO LIVE ACTIONS. Exit: drop the query param and
    // reload. Production mode never loads synthetic data; demo never loads
    // production data.
    cockpit.classList.remove("locked");
    cockpit.removeAttribute("inert");
    cockpit.removeAttribute("aria-hidden");
    cockpit.setAttribute("data-demo","1");
    var demoHaltTitle=document.getElementById("haltTitle");
    var demoHaltSub=document.getElementById("haltSub");
    if(demoHaltTitle)demoHaltTitle.textContent="Demo mode — the console is asleep.";
    if(demoHaltSub)demoHaltSub.textContent="Nothing polls and nothing can send while ?demo=arcade is set. Exit: remove the demo parameter and reload.";
  }else{
    armPoll();
    if(token())load().catch(function(){});
    else showGate("");
    armArcadeFeeds();
  }

  // ---- blended ops tabs (owner instruction 2026-08-04) --------------------
  // Command Center stays the fast, default one-screen view. Operations and
  // Line Detail are the older pages, loaded in place instead of sending the
  // operator to a new tab. Both run same-origin and share this page's
  // "wsl_admin_token" localStorage key, so once the operator token unlocks
  // the cockpit it also unlocks these panels with no second login.
  //   · Line Detail is a plain lazy <iframe src="/line"> — that page already
  //     reads the same token key from its own unauthenticated shell, so it
  //     just works, unmodified, with every control it already has.
  //   · Operations (/api/admin/dashboard) is gated differently: it renders
  //     server-side and refuses the page itself unless the request carries
  //     an x-admin-token HEADER — a plain <iframe src> can never attach that
  //     header (only fetch/XHR can), so a direct src= would always show its
  //     token-rejected gate. Instead this fetches the rendered HTML through
  //     the same authenticated api() used everywhere else on this page, then
  //     hands the markup to the iframe via .srcdoc — one fetch, zero
  //     reimplementation of that deck's panels, and the token still never
  //     leaves this script except as the one x-admin-token header.
  var TAB_IDS=["command","agents","operations","line"];
  // TAB_IDS is the set of LAZILY LOADED panels. The Live Map is the default
  // panel and loads with the page, so it was never in that list — and because
  // openTab only toggled the panels in that list, the map was never hidden:
  // it stayed on screen stacked above whichever tab you opened. PANEL_IDS is
  // the set that gets shown and hidden, which is all of them.
  var PANEL_IDS=["map"].concat(TAB_IDS);
  var tabPanelLoaded={command:true,agents:false,operations:false,line:false};
  function tabButtonEl(id){return byId("tabBtn"+id.charAt(0).toUpperCase()+id.slice(1));}
  function tabPanelEl(id){return byId("tabPanel"+id.charAt(0).toUpperCase()+id.slice(1));}

  function openTab(id){
    if(PANEL_IDS.indexOf(id)<0)return;
    PANEL_IDS.forEach(function(name){
      var active=name===id;
      tabButtonEl(name).classList.toggle("active",active);
      tabButtonEl(name).setAttribute("aria-selected",String(active));
      tabButtonEl(name).setAttribute("tabindex",active?"0":"-1");
      tabPanelEl(name).hidden=!active;
    });
    if(id==="line")loadLineTab();
    if(id==="operations")loadOperationsTab();
    if(id==="agents")loadAgentsTab();
    if(id==="map")renderMap();
  }
  PANEL_IDS.forEach(function(id){
    var button=tabButtonEl(id);
    button.addEventListener("click",function(){openTab(id);});
    button.addEventListener("keydown",function(event){
      var index=PANEL_IDS.indexOf(id),next=index;
      if(event.key==="ArrowRight")next=(index+1)%PANEL_IDS.length;
      else if(event.key==="ArrowLeft")next=(index-1+PANEL_IDS.length)%PANEL_IDS.length;
      else if(event.key==="Home")next=0;
      else if(event.key==="End")next=PANEL_IDS.length-1;
      else return;
      event.preventDefault();
      openTab(PANEL_IDS[next]);
      tabButtonEl(PANEL_IDS[next]).focus();
    });
  });

  // The Command Center's old Live-pipeline / Qualification-funnel split was
  // retired by the campaign-flow redesign (2026-08-16): one flow, no sub-nav,
  // and the funnel internals live in the Engine room tab.

  function retryButton(label,onRetry){
    var button=document.createElement("button");
    button.type="button";
    button.className="btn ghost retry";
    button.textContent=label;
    button.addEventListener("click",onRetry);
    return button;
  }

  // ---- Line Detail: the workshop floor --------------------------------
  // There is deliberately no second endpoint, poll loop, iframe or control
  // here. loadBatches() already reads the admin-gated line snapshot and calls
  // this renderer on its existing 5s follow-up while a batch is moving.
  function lineElapsedText(ms){
    var seconds=Math.max(0,Math.floor((Number(ms)||0)/1000));
    if(seconds<60)return seconds+"s";
    var mins=Math.floor(seconds/60),rest=seconds%60;
    if(mins<60)return mins+"m"+(rest?" "+rest+"s":"");
    var hours=Math.floor(mins/60),left=mins%60;
    return hours+"h"+(left?" "+left+"m":"");
  }

  function lineAgeMs(iso,nowMs){
    var at=Date.parse(String(iso||""));
    return Number.isFinite(at)?Math.max(0,(Number(nowMs)||Date.now())-at):NaN;
  }

  function lineClockText(batch,nowMs){
    var start=Date.parse(String(batch&&batch.startedAt||""));
    if(!Number.isFinite(start))return "—";
    var settled=Date.parse(String(batch&&batch.settledAt||""));
    var end=Number.isFinite(settled)?settled:(Number(nowMs)||Date.now());
    var seconds=Math.max(0,Math.floor((end-start)/1000));
    var hours=Math.floor(seconds/3600),mins=Math.floor((seconds%3600)/60),secs=seconds%60;
    function two(n){return String(n).padStart(2,"0");}
    return hours?hours+":"+two(mins)+":"+two(secs):two(mins)+":"+two(secs);
  }

  // =====================================================================
  // THE CAMPAIGN CLOCK — the batch's own stopwatch (campaignTiming, the
  // record api/admin/line stamps per batch), as the one line the owner
  // reads under a batch's header while it runs: when it fired, how long
  // each first took, how many have gone out. Every value comes from a
  // stamped wall-clock moment; an absent, unparseable, or pre-start stamp
  // hides its segment, and a batch without a timing record (every older
  // run) renders no line at all.
  // =====================================================================
  function campaignClockTimeOfDay(ms){
    var at=new Date(ms);
    function two(n){return String(n).padStart(2,"0");}
    return two(at.getHours())+":"+two(at.getMinutes());
  }
  function campaignClockElapsedText(startMs,iso){
    var at=Date.parse(String(iso||""));
    if(!Number.isFinite(at)||at<startMs)return "";
    var seconds=Math.floor((at-startMs)/1000);
    var hours=Math.floor(seconds/3600);
    var mins=Math.floor((seconds/60)%60);
    function two(n){return String(n).padStart(2,"0");}
    return "+"+(hours?hours+":"+two(mins):String(Math.floor(seconds/60)))+":"+two(seconds%60);
  }

  function campaignClockHtml(b){
    var t=b&&b.campaignTiming&&typeof b.campaignTiming==="object"?b.campaignTiming:null;
    var startMs=Date.parse(String(t&&t.startedAt||""));
    if(!Number.isFinite(startMs))return "";
    var parts=["fire "+campaignClockTimeOfDay(startMs)];
    var lead=campaignClockElapsedText(startMs,t.firstQualifiedAt);
    if(lead)parts.push("first lead "+lead);
    var build=campaignClockElapsedText(startMs,t.firstBuiltAt);
    if(build)parts.push("first build "+build);
    var email=campaignClockElapsedText(startMs,t.firstSentAt);
    if(email)parts.push("first email "+email);
    var counts=(b&&b.counts)||{};
    var sent=Math.max(0,Number(counts.sent)||0);
    var goal=Math.max(0,Number(b&&b.requested)||0)||Math.max(0,Number(counts.total)||0);
    if(goal>0)parts.push("sent "+sent+"/"+goal);
    return '<div class="bclock" role="status">Campaign clock: '+esc(parts.join(" · "))+'</div>';
  }

  function lineHasReached(row,key){
    return (row&&row.reached||[]).indexOf(key)>=0||String(row&&row.status||"")===key;
  }

  function lineBatchCounts(batch){
    var rows=(batch&&batch.rows)||[];
    var out={total:rows.length,mirrored:0,gated:0,gateChecked:0,queued:0,sent:0,finished:0};
    rows.forEach(function(row){
      if(lineHasReached(row,"mirrored"))out.mirrored+=1;
      if(lineHasReached(row,"gate_passed"))out.gated+=1;
      if(lineHasReached(row,"gate_passed")||lineHasReached(row,"gate_failed"))out.gateChecked+=1;
      if(lineHasReached(row,"queued"))out.queued+=1;
      if(lineHasReached(row,"sent"))out.sent+=1;
      if(rowDead(row)||row.status==="queued"||row.status==="sent")out.finished+=1;
    });
    return out;
  }

  function linePaceText(batch,nowMs){
    var counts=lineBatchCounts(batch);
    if(!counts.finished)return "Pace available after first finish.";
    var start=Date.parse(String(batch&&batch.startedAt||""));
    if(!Number.isFinite(start))return "Pace unavailable — no batch start time.";
    var settled=Date.parse(String(batch&&batch.settledAt||""));
    var end=Number.isFinite(settled)?settled:(Number(nowMs)||Date.now());
    var per=Math.max(0,Math.round(((end-start)/counts.finished)/1000)*1000);
    return "~"+lineElapsedText(per)+" per site at current pace";
  }

  function lineNames(rows){
    var names=(rows||[]).map(function(row){return row.businessName||row.prospectId||"unnamed site";});
    if(names.length<=2)return names.join(" + ");
    return names.slice(0,2).join(" + ")+" + "+(names.length-2)+" more";
  }

  function lineWorkerModels(batch,nowMs){
    var rows=(batch&&batch.rows)||[],counts=lineBatchCounts(batch);
    var running=batchRunning(batch),hasFunnel=Array.isArray(batch&&batch.mineFunnel);
    var picked=rows.filter(function(row){return row.status==="picked";});
    var building=rows.filter(function(row){return row.status==="qualified";});
    var inspecting=rows.filter(function(row){return row.status==="mirrored";});
    var mailing=rows.filter(function(row){return row.status==="gate_passed";});
    function fresh(list){return list.filter(function(row){var age=lineAgeMs(row.updatedAt,nowMs);return Number.isFinite(age)&&age<STALL_MS;});}
    function stale(list){return list.filter(function(row){var age=lineAgeMs(row.updatedAt,nowMs);return Number.isFinite(age)&&age>=STALL_MS;});}
    function one(id,name,role,state,label,current){return {id:id,name:name,role:role,state:state,label:label,current:current};}
    var shared=building.length
      ? lineNames(building)+" is in the shared mirror-build stage; this feed cannot split extraction, compiling and design timing."
      : "";
    var models=[];

    var mining=running&&!rows.length&&!hasFunnel;
    models.push(one("miner","Miner","Finds local businesses that match this run.",
      mining?"working":hasFunnel?"done":"idle",mining?"Working now":hasFunnel?"Finished":"Idle",
      mining?"Discovering candidates for "+(batch.target||"this batch")+"; no accepted site rows are recorded yet."
        :hasFunnel?"The discovery funnel finished; "+counts.total+" accepted site"+(counts.total===1?"":"s")+" entered this recorded batch."
          :"No discovery funnel is recorded for this batch."));

    models.push(one("extractor","Extractor","Collects homepage, logo, color and place evidence.",
      building.length?"shared":hasFunnel||counts.mirrored?"done":"idle",building.length?"Shared stage":hasFunnel||counts.mirrored?"Finished":"Idle",
      shared||((hasFunnel||counts.mirrored)?"Upstream evidence checks finished; their per-site timing was not exposed.":"No extraction stage is recorded yet.")));

    models.push(one("compiler","Compiler","Checks accepted facts and prepares the build contract.",
      building.length?"shared":picked.length?"stage":counts.mirrored?"done":"idle",building.length?"Shared stage":picked.length?"Stage recorded":counts.mirrored?"Finished":"Idle",
      shared||(picked.length?picked.length+" accepted site"+(picked.length===1?" is":"s are")+" at qualification; active worker slots are not exposed."
        :counts.mirrored?"The recorded rows cleared qualification before their mirror builds completed.":"No qualification work is recorded yet.")));

    models.push(one("designer","Designer","Runs the mirror build that applies content and brand styling.",
      building.length?"shared":counts.mirrored?"done":"idle",building.length?"Shared stage":counts.mirrored?"Finished":"Idle",
      shared||(counts.mirrored?"Mirror builds completed for "+counts.mirrored+" of "+counts.total+" accepted sites.":"No mirror build is recorded yet.")));

    var inspectingFresh=fresh(inspecting),inspectingStale=stale(inspecting);
    models.push(one("inspector","Inspector","Loads each mirror and checks all eight render facts.",
      running&&inspectingFresh.length?"working":running&&inspectingStale.length?"stalled":counts.gateChecked?"done":"idle",
      running&&inspectingFresh.length?"Working now":running&&inspectingStale.length?"Stalled":counts.gateChecked?"Finished":"Idle",
      running&&inspectingFresh.length?"Running the eight-fact render gate for "+lineNames(inspectingFresh)+"."
        :running&&inspectingStale.length?"The render-gate stage for "+lineNames(inspectingStale)+" has not recorded a state change in minutes."
          :counts.gateChecked?"The Inspector checked "+counts.gateChecked+" of "+counts.total+" accepted sites; "+counts.gated+" passed.":"No render-gate result is recorded yet."));

    var mailingFresh=fresh(mailing),mailingStale=stale(mailing),sending=batch&&batch.status==="sending";
    models.push(one("mailroom","Mailroom","Queues only gate-passed previews and sends only after approval.",
      sending||running&&mailingFresh.length?"working":running&&mailingStale.length?"stalled":counts.sent?"done":"idle",
      sending||running&&mailingFresh.length?"Working now":running&&mailingStale.length?"Stalled":counts.sent?"Finished":counts.queued?"Waiting":"Idle",
      sending?"A send pass is recorded for "+Math.max(0,counts.queued-counts.sent)+" queued site"+(Math.max(0,counts.queued-counts.sent)===1?"":"s")+"; the current email row is not exposed."
        :running&&mailingFresh.length?"Writing the preview and queue record for "+lineNames(mailingFresh)+"."
          :running&&mailingStale.length?"The queue stage for "+lineNames(mailingStale)+" has not recorded a state change in minutes."
            :counts.sent?counts.sent+" approved site"+(counts.sent===1?" was":"s were")+" recorded as sent."
              :counts.queued?counts.queued+" gate-passed site"+(counts.queued===1?" is":"s are")+" queued and waiting for operator approval."
                :"No queue or send work is recorded yet."));
    return models;
  }

  function lineWorkerIcon(kind){
    var paths={
      miner:'<circle cx="9" cy="9" r="5"></circle><path d="m13 13 4 4M7 9h4M9 7v4"></path>',
      extractor:'<rect x="3" y="4" width="14" height="12" rx="2"></rect><circle cx="8" cy="8" r="1.5"></circle><path d="m5 14 3.5-3 2.5 2 2-2 2 3"></path>',
      compiler:'<path d="M6 4H4v12h2M14 4h2v12h-2M8 7h4M8 10h4M8 13h3"></path>',
      designer:'<path d="m4 16 1-4L13 4l3 3-8 8-4 1ZM11.5 5.5l3 3M4.5 12.5l3 3"></path>',
      inspector:'<path d="M10 3 16 5v4c0 4-2.5 6.5-6 8-3.5-1.5-6-4-6-8V5l6-2Z"></path><path d="m7.5 10 1.7 1.7 3.5-4"></path>',
      mailroom:'<rect x="3" y="5" width="14" height="10" rx="2"></rect><path d="m4 7 6 4 6-4M13 3l2 2 2-2"></path>'
    };
    return '<svg class="line-worker-icon" viewBox="0 0 20 20" aria-hidden="true">'+(paths[kind]||paths.compiler)+'</svg>';
  }

  function lineWorkerHtml(model){
    var idle=model.state==="idle"?" is-idle":"";
    return '<article class="line-worker'+idle+'" data-worker="'+esc(model.id)+'" data-state="'+esc(model.state)+'">'
      +'<div class="lw-worker-top">'+lineWorkerIcon(model.id)+'<span class="lw-worker-name">'+esc(model.name)+'</span>'
      +'<span class="lw-worker-state"><i class="lw-lamp"></i>'+esc(model.label)+'</span></div>'
      +'<p class="lw-worker-role">'+esc(model.role)+'</p><p class="lw-worker-now">'+esc(model.current)+'</p></article>';
  }

  function lineStageMeta(row){
    var meta={
      picked:["Qualification","Accepted into this batch; the feed cannot separate an active slot from a waiting row."],
      qualified:["Shared mirror build","Extractor, Compiler and Designer share this recorded stage; their internal handoff is not exposed."],
      mirrored:["Eight-fact inspection","The mirror exists and the Inspector is checking the rendered page."],
      gate_passed:["Queue preparation","All eight facts passed; the Mailroom is writing the preview and queue record."],
      queued:["Waiting for approval","Built and gate-passed; it cannot send until the operator approves this batch."],
      sent:["Sent","The delivery ledger records this approved row as sent."],
      rejected:["Qualification stopped","The recorded build contract refused this row before shipment."],
      gate_failed:["Render gate stopped","At least one of the eight rendered facts failed."],
      error:["Line error","The recorded row ended with an error and was not sent."]
    };
    return meta[String(row&&row.status||"")]||["Recorded stage","The latest snapshot carries this machine state without a finer plain-English step."];
  }

  function lineRowReasonHtml(row){
    var failed=(row&&row.facts||[]).filter(function(f){return f&&f.pass===false;});
    if(!row.reason&&!failed.length&&!(row.failedFacts||[]).length)return "";
    var body=row.reason?'<div>'+esc(row.reason)+'</div>':"";
    (row.failedFacts||[]).forEach(function(f){body+='<span class="fchip bad">'+esc(f)+'</span>';});
    failed.forEach(function(f){body+='<div><span class="fchip bad">'+esc(f.fact)+'</span> '+esc(f.reason||"")+'</div>';});
    return '<details class="dx lw-rowreason"><summary>why this stopped</summary><div class="dxb">'+body+'</div></details>';
  }

  function lineRowHtml(batch,row,index,total,nowMs){
    var meta=lineStageMeta(row),age=lineAgeMs(row.updatedAt,nowMs),state="waiting";
    if(rowDead(row))state="failed";
    else if(row.status==="queued"||row.status==="sent")state="done";
    else if(batchRunning(batch)&&(row.status==="qualified"||row.status==="mirrored"||row.status==="gate_passed"))
      state=Number.isFinite(age)&&age<STALL_MS?"working":"stalled";
    else if(!batchRunning(batch))state="idle";
    var where=[row.city,row.state].filter(Boolean).join(", ");
    if(row.vertical)where=where?where+" · "+row.vertical:row.vertical;
    var clock=Number.isFinite(age)?"last state change "+lineElapsedText(age)+" ago":"last state change unavailable";
    return '<div class="lw-row" data-state="'+esc(state)+'">'
      +'<span class="lw-rowno">'+(index+1)+' / '+total+'</span>'
      +'<div><div class="lw-business">'+esc(row.businessName||row.prospectId||"Unnamed site")+'</div><div class="lw-place">'+esc(where||"Location not recorded")+'</div></div>'
      +'<div class="lw-stage"><b>'+esc(meta[0])+'</b>'+esc(meta[1])+'</div>'
      +'<span class="lw-age" title="Time since the latest recorded row transition">'+esc(clock)+'</span>'
      +lineRowReasonHtml(row)+'</div>';
  }

  function lineBatchHtml(batch,nowMs){
    var counts=lineBatchCounts(batch),rows=(batch&&batch.rows)||[],workers=lineWorkerModels(batch,nowMs);
    var target=batch.target||"Saved businesses",status=String(batch.status||"unknown");
    var clock=lineClockText(batch,nowMs),pace=linePaceText(batch,nowMs);
    var started=String(batch.startedAt||"");
    var html='<article class="lw-batch" data-state="'+esc(status)+'">'
      +'<div class="lw-batchhead"><div class="lw-batchtitle"><h3>'+esc(target)+'</h3><p>Batch '+esc(String(batch.batchId||"").slice(-8)||"id unavailable")+' · latest recorded snapshot</p></div>'
      +'<div class="lw-batchmeta"><span class="lw-state '+esc(status)+'">'+esc(status.replace(/_/g," "))+'</span>'
      +'<time class="lw-clock" datetime="'+esc(started)+'" title="Clock starts at the recorded batch start"><b>'+esc(clock)+'</b> batch clock</time>'
      +'<span class="lw-pace"><b>'+esc(pace)+'</b></span></div></div>'
      +'<div class="lw-summary">'
      +'<span class="lw-count" aria-label="Accepted sites '+counts.total+'">Accepted sites<b>'+counts.total+'</b></span>'
      +'<span class="lw-count" aria-label="Mirrored '+counts.mirrored+' of '+counts.total+'">Mirrored<b>'+counts.mirrored+' of '+counts.total+'</b></span>'
      +'<span class="lw-count" aria-label="Gate '+counts.gated+' of '+counts.total+'">Gate<b>'+counts.gated+' of '+counts.total+'</b></span>'
      +'<span class="lw-count" aria-label="Queued '+counts.queued+'">Queued<b>'+counts.queued+'</b></span>'
      +'<span class="lw-count" aria-label="Sent '+counts.sent+'">Sent<b>'+counts.sent+'</b></span></div>'
      +'<div class="lw-workers">';
    workers.forEach(function(worker){html+=lineWorkerHtml(worker);});
    html+='</div><div class="lw-rows"><div class="lw-rows-head"><h4>Sites on this floor</h4><span>batch positions · not lifetime totals</span></div>';
    if(!rows.length)html+='<div class="lw-empty">No accepted site rows are recorded in this snapshot yet.</div>';
    rows.forEach(function(row,index){html+=lineRowHtml(batch,row,index,rows.length,nowMs);});
    html+='</div><section class="lw-reasons"><h4>Where candidates fell out</h4><p>Upstream candidate checks, kept separate from the accepted-site counts above.</p>';
    var funnel=funnelHtml(batch);
    html+=funnel||'<div class="bempty">No funnel data is recorded for this batch.</div>';
    return html+'</section></article>';
  }

  function lineRelevantBatches(list){
    var batches=Array.isArray(list)?list:[];
    var active=batches.filter(function(batch){return batchRunning(batch);});
    return active.length?active:batches.slice(0,1);
  }

  function lineWorkshopHtml(list,nowMs){
    var batches=Array.isArray(list)?list:(list?[list]:[]),relevant=lineRelevantBatches(batches);
    var html='<div class="lw-head"><div><span class="label">Workshop floor</span><h2>Who is doing what, by batch</h2>'
      +'<p>Read-only and batch-relative. A pulse means the latest recorded stage proves work is in flight. The shared mirror-build stage cannot truthfully split Extractor, Compiler and Designer timing, so it says that instead.</p></div>'
      +'<span class="lw-readonly">latest recorded snapshot</span></div>';
    if(!relevant.length)return html+'<div class="lw-empty">No line batch is present in the latest recorded list. Nothing is shown as busy.</div>';
    html+='<div class="lw-stack">';
    relevant.forEach(function(batch){html+=lineBatchHtml(batch,Number(nowMs)||Date.now());});
    return html+'</div>';
  }

  function renderLineWorkshop(list){
    var host=byId("lineWorkshop");
    if(host)host.innerHTML=lineWorkshopHtml(list,Date.now());
  }

  function loadLineTab(){
    if(tabPanelLoaded.line)return;
    tabPanelLoaded.line=true;
    renderLineWorkshop(mapBatches);
    if(!mapBatches.length)loadBatches();
  }

  // ---- Agents & Calls -------------------------------------------------
  // Every string below is rendered from a server-measured field. There is no
  // client-side liveness guess: the server decides active/recent/dormant/never
  // from the row it actually read, and this only paints it.
  function whenText(iso){
    if(!iso)return "";
    var at=new Date(iso);
    if(isNaN(at))return "";
    var mins=Math.round((Date.now()-at.getTime())/60000);
    if(mins<1)return "just now";
    if(mins<60)return mins+" min ago";
    if(mins<1440)return Math.round(mins/60)+"h ago";
    var days=Math.round(mins/1440);
    return days+(days===1?" day ago":" days ago");
  }
  function stampText(iso){
    if(!iso)return "";
    var at=new Date(iso);
    if(isNaN(at))return "";
    return at.toLocaleString();
  }
  function durText(seconds){
    if(seconds===null||seconds===undefined)return "";
    var whole=Math.max(0,Math.round(Number(seconds)||0));
    var m=Math.floor(whole/60),s=whole%60;
    return m?(m+"m "+s+"s"):(s+"s");
  }
  function callIcon(kind){
    var body="";
    if(kind==="outbound")body='<path d="M15 8l6-6m-6 0h6v6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.33 1.84.56 2.8.69A2 2 0 0 1 22 16.92z"/>';
    else if(kind==="inbound")body='<path d="M15 2v6h6m0-6-6 6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.33 1.84.56 2.8.69A2 2 0 0 1 22 16.92z"/>';
    else if(kind==="edit"||kind==="applied")body='<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/><path d="m15 5 3 3"/>';
    else if(kind==="refused")body='<circle cx="12" cy="12" r="9"/><path d="m6.4 6.4 11.2 11.2"/>';
    else if(kind==="clock")body='<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
    else if(kind==="transcript")body='<path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 11h6M9 15h6"/>';
    else if(kind==="audio")body='<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>';
    else body='<path d="M4 12h16M12 4v16"/>';
    return '<svg class="call-icon" viewBox="0 0 24 24" aria-hidden="true">'+body+'</svg>';
  }
  function safeCallerLast4(value){
    var digits=String(value||"").replace(/\\D/g,"");
    return digits.length>=4?digits.slice(-4):"";
  }
  function friendlyCallOutcome(call){
    var edits=Array.isArray(call.edits)?call.edits:[];
    if(edits.some(function(edit){return edit.outcome==="applied";}))return {label:"Site edit completed",tone:"applied",icon:"edit"};
    if(edits.some(function(edit){return edit.outcome==="refused";}))return {label:"Edit request refused",tone:"refused",icon:"refused"};
    if(edits.some(function(edit){return edit.outcome==="queued";}))return {label:"Site edit queued",tone:"queued",icon:"edit"};
    if(edits.some(function(edit){return edit.outcome==="awaiting confirmation";}))return {label:"Waiting for confirmation",tone:"queued",icon:"edit"};
    var reason=String(call.endedReason||"").toLowerCase();
    if(/no-answer|did-not-answer|busy/.test(reason))return {label:"No answer",tone:"refused",icon:"refused"};
    if(/voicemail/.test(reason))return {label:"Reached voicemail",tone:"queued",icon:"audio"};
    if(/error|failed|timeout/.test(reason))return {label:"Call had a problem",tone:"refused",icon:"refused"};
    if(/customer-ended|caller-disconnect/.test(reason))return {label:"Completed by caller",tone:"applied",icon:"inbound"};
    if(/assistant-ended|completed|ended/.test(reason))return {label:"Call completed",tone:"applied",icon:"inbound"};
    return {label:"Call ended",tone:"",icon:"inbound"};
  }
  function stateChip(state,label){
    var known={active:1,recent:1,dormant:1,never:1,unknown:1};
    var cls=known[state]?state:"unknown";
    return '<span class="st st-'+cls+'">'+esc(label||cls)+'</span>';
  }
  function renderCalls(calls,available,reason){
    if(!available)return '<div class="crew-empty"><b>Call history could not be read.</b> '+esc(reason||"The voice provider did not answer.")+'</div>';
    if(!calls.length)return '<div class="crew-empty">No calls on record for Riley yet.</div>';
    return '<div class="callstack">'+calls.map(function(c){
      var direction=c.direction==="outbound"?"outbound":"inbound";
      var directionLabel=direction==="outbound"?"Outbound call":"Inbound call";
      var name=c.resolved&&c.resolved.business?c.resolved.business:"Unmatched caller";
      var where=c.resolved&&c.resolved.where?" · "+c.resolved.where:"";
      var outcome=friendlyCallOutcome(c);
      var exact=stampText(c.at);
      var relative=whenText(c.at)||"Time unavailable";
      var last4=safeCallerLast4(c.caller);
      var identity=c.resolved&&c.resolved.business
        ?"Riley matched this caller to "+c.resolved.business+where+"."
        :"Riley did not resolve this caller to an account.";
      var asks="";
      if(c.edits&&c.edits.length){
        asks='<div class="asks">'+c.edits.map(function(e){
          var out=String(e.outcome||"asked");
          var cls=out==="applied"?"applied":(out==="refused"?"refused":(out==="queued"?"queued":""));
          var outLabel=out==="applied"?"Edit made":(out==="refused"?"Refused":(out==="queued"?"Queued":(out==="awaiting confirmation"?"Needs confirmation":"Requested")));
          var outIcon=out==="refused"?"refused":"edit";
          return '<div class="ask '+cls+'"><div class="ask-body"><div class="ask-what">'+esc(e.instruction)+'</div>'
            +(e.reason?'<div class="ask-why">'+esc(e.reason)+'</div>':'')
            +(e.attempts>1?'<div class="ask-why">asked '+esc(e.attempts)+' times on this call</div>':'')
            +'</div><span class="ask-out" title="'+esc(outLabel)+'">'+callIcon(outIcon)+'<span>'+esc(outLabel)+'</span></span></div>';
        }).join("")+'</div>';
      }
      return '<article class="call call-card">'
        +'<div class="call-glance"><span class="call-avatar"><img src="/brand/riley-avatar.png" alt="Riley" loading="lazy" decoding="async"><span class="call-avatar-fallback" aria-hidden="true">R</span></span>'
        +'<div class="call-identity"><h4 class="call-name">'+esc(name)+'</h4><div class="call-facts">'
        +'<span class="call-fact call-direction" title="'+esc(directionLabel)+'">'+callIcon(direction)+'<span class="call-sr">'+esc(directionLabel)+'</span></span>'
        +'<time class="call-when call-fact" datetime="'+esc(c.at||"")+'" title="'+esc(exact||"Exact time unavailable")+'">'+esc(relative)+'</time>'
        +(c.seconds!==null&&c.seconds!==undefined?'<span class="call-fact" title="Call duration">'+callIcon("clock")+esc(durText(c.seconds))+'</span>':'')
        +'</div></div>'
        +'<span class="call-outcome '+esc(outcome.tone)+'">'+callIcon(outcome.icon)+'<span>'+esc(outcome.label)+'</span></span>'
        +(c.summary?'<p class="call-summary">'+esc(c.summary)+'</p>':'')+'</div>'
        +'<details class="call-details" data-call-id="'+esc(c.id||"")+'" data-caller-last4="'+esc(last4)+'">'
        +'<summary>'+callIcon("transcript")+'<span>Call details</span><span class="call-detail-hint">Transcript &amp; recording</span><span class="call-chevron" aria-hidden="true"></span></summary>'
        +'<div class="call-detail-body"><p class="call-caller-id">'+esc(identity)+(last4?' Caller ID ends in <b>'+esc(last4)+'</b>.':'')+'</p>'
        +asks+'<div class="call-artifact-host"><p class="call-detail-status">Open to load the transcript and recording securely.</p></div></div>'
        +'</details></article>';
    }).join("")+'</div>';
  }
  var callAudioUrls={};
  function releaseCallAudioUrls(){
    Object.keys(callAudioUrls).forEach(function(id){try{URL.revokeObjectURL(callAudioUrls[id]);}catch(_){}});
    callAudioUrls={};
  }
  function callArtifactSection(kind,label){
    var section=document.createElement("section");
    section.className="call-artifact";
    var heading=document.createElement("h5");
    heading.innerHTML=callIcon(kind)+esc(label);
    section.appendChild(heading);
    return section;
  }
  function loadCallAudio(callId,audio,status){
    var path="/api/admin/call-artifact?callId="+encodeURIComponent(callId)+"&audio=1";
    status.textContent="Loading secure recording…";
    return fetch(path,{headers:{"x-admin-token":token()}}).then(function(response){
      if(response.ok)return response.blob();
      return response.text().then(function(raw){
        var payload={};
        try{payload=raw?JSON.parse(raw):{};}catch(_){}
        throw errorWithStatus(payload.error||payload.message||"Recording could not be loaded",response.status,payload);
      });
    }).then(function(blob){
      if(!blob||!blob.size)throw errorWithStatus("Recording was empty",502);
      if(callAudioUrls[callId])URL.revokeObjectURL(callAudioUrls[callId]);
      var objectUrl=URL.createObjectURL(blob);
      callAudioUrls[callId]=objectUrl;
      audio.src=objectUrl;
      status.textContent="Recording ready.";
    }).catch(function(error){
      audio.removeAttribute("src");
      audio.load();
      status.classList.add(error&&error.status===410?"expired":"failed");
      status.textContent=error&&error.status===410?"Recording expired.":(error&&error.status===404?"No recording is available for this call.":"Recording could not be loaded.");
      if(error&&(error.status===401||error.status===403)){clearToken();showGate("Token expired or rejected. Enter a current operator token.");}
    });
  }
  function renderCallArtifact(details,payload){
    var host=details.querySelector(".call-artifact-host");
    if(!host)return;
    host.textContent="";
    var grid=document.createElement("div");
    grid.className="call-artifact-grid";
    var transcript=callArtifactSection("transcript","Transcript");
    var text=typeof payload.transcript==="string"?payload.transcript.trim():"";
    if(payload.transcriptAvailable&&text){
      var pre=document.createElement("pre");
      pre.className="call-transcript";
      pre.textContent=text;
      transcript.appendChild(pre);
      if(payload.transcriptTruncated){
        var clipped=document.createElement("p");
        clipped.className="call-artifact-note";
        clipped.textContent="Transcript capped at 500,000 characters.";
        transcript.appendChild(clipped);
      }
    }else{
      var noTranscript=document.createElement("p");
      noTranscript.className="call-artifact-note";
      noTranscript.textContent="No transcript available for this call.";
      transcript.appendChild(noTranscript);
    }
    grid.appendChild(transcript);
    var recording=callArtifactSection("audio","Recording");
    var recordingStatus=document.createElement("p");
    recordingStatus.className="call-audio-status";
    if(payload.recordingExpired||payload.recordingReason==="recording_expired"){
      recordingStatus.classList.add("expired");
      recordingStatus.textContent="Recording expired after the retention window.";
      recording.appendChild(recordingStatus);
    }else if(payload.recordingAvailable){
      var audio=document.createElement("audio");
      audio.className="call-audio";
      audio.controls=true;
      audio.preload="none";
      audio.setAttribute("aria-label","Call recording");
      recording.appendChild(audio);
      recording.appendChild(recordingStatus);
      loadCallAudio(payload.callId||details.getAttribute("data-call-id")||"",audio,recordingStatus);
    }else{
      recordingStatus.textContent="No recording is available for this call.";
      recording.appendChild(recordingStatus);
    }
    grid.appendChild(recording);
    host.appendChild(grid);
  }
  function loadCallArtifact(details){
    var state=details.getAttribute("data-artifact-state")||"";
    if(state==="loading"||state==="loaded")return;
    var callId=details.getAttribute("data-call-id")||"";
    var host=details.querySelector(".call-artifact-host");
    if(!host)return;
    if(!callId){host.innerHTML='<p class="call-detail-status">Call details are unavailable for this record.</p>';details.setAttribute("data-artifact-state","loaded");return;}
    details.setAttribute("data-artifact-state","loading");
    host.innerHTML='<p class="call-detail-status" role="status">Loading transcript and recording…</p>';
    api("/api/admin/call-artifact?callId="+encodeURIComponent(callId)).then(function(payload){
      if(!payload||payload.ok===false)throw errorWithStatus("Call details could not be loaded",502,payload);
      details.setAttribute("data-artifact-state","loaded");
      renderCallArtifact(details,payload);
    }).catch(function(error){
      details.setAttribute("data-artifact-state","failed");
      host.innerHTML='<p class="call-detail-status">Call details could not be loaded. Close and reopen to retry.</p>';
      if(error&&(error.status===401||error.status===403)){clearToken();showGate("Token expired or rejected. Enter a current operator token.");}
    });
  }
  function wireCallCards(host){
    host.querySelectorAll(".call-avatar img").forEach(function(image){
      function fallback(){image.parentNode.classList.add("is-broken");}
      image.addEventListener("error",fallback,{once:true});
      if(image.complete&&image.naturalWidth===0)fallback();
    });
    host.querySelectorAll(".call-details").forEach(function(details){
      details.addEventListener("toggle",function(){
        if(!details.open)return;
        if(details.getAttribute("data-artifact-state")==="failed")details.removeAttribute("data-artifact-state");
        loadCallArtifact(details);
      });
    });
  }
  window.addEventListener("pagehide",releaseCallAudioUrls);
  function renderCrew(crew,configured,reason){
    // "None configured" and "we could not ask" are different facts. Collapsing
    // them would let a provider outage read as an empty, healthy roster.
    if(!configured)return '<div class="crew-empty"><b>Voice roster could not be read.</b> '+esc(reason||"The voice provider did not answer.")+'</div>';
    if(!crew.length)return '<div class="crew-empty">No voice assistants are provisioned.</div>';
    return '<div class="crew-grid">'+crew.map(function(a){
      return '<div class="crew-row'+(a.isRiley?" crew-lead":"")+(a.state==="never"?" is-never":"")+'">'
        +'<div class="cr-main"><div class="cr-name">'+esc(a.name)+'</div>'
        +'<div class="cr-when">'+(a.lastCall?esc("last call "+whenText(a.lastCall)):"never taken a call")
        +(a.recentCalls?esc(" · "+a.recentCalls+" recent"):"")+'</div></div>'
        +'<span class="cr-state">'+stateChip(a.state,a.label)+'</span></div>';
    }).join("")+'</div>';
  }
  function renderPipeline(agents){
    return '<div class="crew-grid">'+agents.map(function(a){
      return '<div class="crew-row'+(a.state==="never"?" is-never":"")+'">'
        +'<div class="cr-main"><div class="cr-name">'+esc(a.name)+'</div>'
        +'<div class="cr-role">'+esc(a.role)+'</div>'
        +'<div class="cr-when">'+(a.lastRun?esc("last ran "+whenText(a.lastRun)):"no event on record, ever")
        +(a.recentEvents?esc(" · "+a.recentEvents+" in 30d"):"")+'</div></div>'
        +'<span class="cr-state">'+stateChip(a.state,a.label)+'</span></div>';
    }).join("")+'</div>';
  }
  function renderAgentsView(d){
    var agents=(d.pipeline&&d.pipeline.agents)||[];
    var crew=(d.voice&&d.voice.crew)||[];
    var calls=d.calls||[];
    var live=agents.filter(function(a){return a.state==="active";}).length;
    var never=agents.filter(function(a){return a.state==="never";}).length;
    var voiceNever=crew.filter(function(a){return a.state==="never";}).length;
    return '<section style="margin-top:22px"><div class="sec-head"><h2>Agents &amp; calls</h2>'
      +'<span class="label">what is actually running</span></div>'
      +'<div class="crew-note">Every state on this page is measured from a record — an event row for pipeline agents, '
      +'a provider call record for voice agents. <b>'+esc(live)+' of '+esc(agents.length)+'</b> pipeline agents fired in the last 24h; '
      +'<b>'+esc(never)+'</b> have never emitted an event, and <b>'+esc(voiceNever)+'</b> voice agents have never taken a call. '
      +'Those are shown dim and still on purpose — nothing here animates unless it ran.</div>'

      +'<div class="card c12" style="margin-bottom:12px"><h3>Riley — recent calls</h3>'
      +'<p class="why">Who called, when it happened, and what came of it. Open a card to read the transcript or play a retained recording.</p>'
      +renderCalls(calls,d.callsAvailable!==false,d.callsReason)+'</div>'

      +'<div class="card c12" style="margin-bottom:12px"><h3>Voice crew</h3>'
      +'<p class="why">Assistants provisioned at the voice provider. '+esc((d.voice&&d.voice.callWindow)||"")+'</p>'
      +renderCrew(crew,!(d.voice&&d.voice.configured===false),d.voice&&d.voice.reason)+'</div>'

      +'<div class="card c12"><h3>Pipeline agents</h3>'
      +'<p class="why">The registered pipeline roster. Last-run is the true all-time last event for that agent; '
      +'the 30-day count is only what fell inside the recent window.</p>'
      +renderPipeline(agents)+'</div></section>';
  }
  function loadAgentsTab(){
    if(tabPanelLoaded.agents)return;
    var host=byId("agentsView");
    if(!token()){host.innerHTML='<p class="why">Open the command center with your operator token first.</p>';return;}
    tabPanelLoaded.agents=true;
    host.innerHTML='<p class="why">Reading agent records and call history…</p>';
    api("/api/admin/console-data?view=agents").then(function(payload){
      releaseCallAudioUrls();
      host.innerHTML=renderAgentsView(payload||{});
      wireCallCards(host);
    }).catch(function(error){
      releaseCallAudioUrls();
      tabPanelLoaded.agents=false;
      host.innerHTML="";
      var note=document.createElement("p");
      note.className="why";
      note.textContent="Agent records failed to load"+(error&&error.status?(" (status "+error.status+")"):"")+".";
      host.appendChild(note);
      host.appendChild(retryButton("Retry",function(){loadAgentsTab();}));
      if(error&&(error.status===401||error.status===403)){clearToken();showGate("Token expired or rejected. Enter a current operator token.");}
    });
  }

  // MORNING_REPORT_READ_ONLY_BEGIN
  // This panel only reads the same generator used by the owner email. It has
  // no timer and no write path: first Operations open, or a deliberate retry.
  var morningReportLoaded=false;
  var morningReportInFlight=false;

  function mrNode(tag,className,text){
    var node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined&&text!==null)node.textContent=String(text);
    return node;
  }

  function mrCount(value){
    if(value===null||value===undefined||value==="")return "Unknown";
    var count=finite(value);
    return count===null?"Unknown":count.toLocaleString();
  }

  function mrName(item){
    if(typeof item==="string")return item;
    if(!item||typeof item!=="object")return "Unknown";
    return String(item.name||item.businessName||item.label||item.cron||item.job||item.message||item.reason||item.code||item.id||"Unknown");
  }

  function mrUnknown(section,fallback){
    var reason=section&&section.reason?String(section.reason):fallback;
    return "Unknown · "+reason;
  }

  function mrMetric(host,label,value){
    var metric=mrNode("div","mr-metric");
    metric.appendChild(mrNode("b","num",mrCount(value)));
    metric.appendChild(mrNode("span","",label));
    host.appendChild(metric);
  }

  function mrBlock(host,title,className){
    var block=mrNode("section","mr-block"+(className?(" "+className):""));
    block.appendChild(mrNode("h3","",title));
    host.appendChild(block);
    return block;
  }

  function mrKeyValue(host,label,value,tone){
    var row=mrNode("div","mr-kv");
    row.appendChild(mrNode("span","mr-key",label));
    row.appendChild(mrNode("span","mr-value"+(tone?(" "+tone):""),value));
    host.appendChild(row);
  }

  function mrSites(host,sites){
    var block=mrBlock(host,"Sites built and gated");
    var list=mrNode("ul","mr-list");
    if(sites&&sites.known===false){
      list.appendChild(mrNode("li","mr-empty warn",mrUnknown(sites,"site history could not be read")));
      block.appendChild(list);
      return;
    }
    var groups=[
      {label:"Built",items:Array.isArray(sites&&sites.built)?sites.built:[]},
      {label:"Gated",items:Array.isArray(sites&&sites.gated)?sites.gated:[]},
    ];
    groups.forEach(function(group){
      if(!group.items.length){
        var empty=mrNode("li","mr-empty",group.label+" · 0 measured");
        list.appendChild(empty);
        return;
      }
      group.items.forEach(function(item){
        var row=mrNode("li","",group.label+" · "+mrName(item));
        list.appendChild(row);
      });
    });
    block.appendChild(list);
  }

  function mrLosses(host,leads){
    var block=mrBlock(host,"Funnel losses");
    var losses=Array.isArray(leads&&leads.losses)?leads.losses:[];
    var list=mrNode("ul","mr-list");
    if(leads&&leads.lossesKnown===false){
      list.appendChild(mrNode("li","mr-empty warn",mrUnknown({reason:leads.lossesReason},"complete funnel-loss detail was not retained")));
    }else if(leads&&leads.known===false){
      list.appendChild(mrNode("li","mr-empty warn",mrUnknown(leads,"lead funnel history could not be read")));
    }else if(!losses.length){
      list.appendChild(mrNode("li","mr-empty","0 funnel losses measured."));
    }else{
      losses.forEach(function(loss){
        loss=loss&&typeof loss==="object"?loss:{};
        var item=mrNode("li","");
        item.appendChild(mrNode("span","",String(loss.stage||"Unknown stage")));
        item.appendChild(mrNode("span","mr-item-count",mrCount(loss.count)));
        var reasons=Array.isArray(loss.reasons)?loss.reasons:[];
        var reasonText=reasons.map(function(reason){
          if(typeof reason==="string")return reason;
          reason=reason&&typeof reason==="object"?reason:{};
          return String(reason.reason||reason.label||"Unknown reason")+" ("+mrCount(reason.count)+")";
        }).join(" · ");
        item.appendChild(mrNode("span","mr-reasons",reasonText||"No reason recorded."));
        list.appendChild(item);
      });
    }
    block.appendChild(list);
  }

  function mrDelivery(host,report){
    var emails=report.emails||{};
    var replies=report.replies||{};
    var pause=report.deliveryPause||{};
    var block=mrBlock(host,"Delivery and replies");
    mrKeyValue(block,"Email · sandbox",emails.known===false?mrUnknown(emails,"email history could not be read"):mrCount(emails.sandbox),emails.known===false?"warn":"");
    mrKeyValue(block,"Email · live",emails.known===false?mrUnknown(emails,"email history could not be read"):mrCount(emails.live),emails.known===false?"warn":"");
    mrKeyValue(block,"Replies waiting",replies.known===false?mrUnknown(replies,"Reply Desk could not be read"):mrCount(replies.waiting),replies.known===false?"warn":"");
    if(pause.known===true){
      mrKeyValue(block,"Delivery pause",pause.active===true?("Paused"+(pause.reason?(" · "+pause.reason):"")):"Sending is not paused",pause.active===true?"warn":"ok");
    }else{
      mrKeyValue(block,"Delivery pause",mrUnknown(pause,"pause state could not be read"),"warn");
    }
  }

  function mrEditsAndCalls(host,report){
    var edits=report.edits||{};
    var riley=report.riley||{};
    var block=mrBlock(host,"Edits and Riley");
    mrKeyValue(block,"Edits done",edits.known===false?mrUnknown(edits,"edit history could not be read"):mrCount(edits.done),edits.known===false?"warn":"");
    mrKeyValue(block,"Edits failed",edits.known===false?mrUnknown(edits,"edit history could not be read"):mrCount(edits.failed),edits.known===false?"warn":(finite(edits.failed)>0?"bad":""));
    mrKeyValue(block,"Edits refused",edits.known===false?mrUnknown(edits,"edit history could not be read"):mrCount(edits.refused),edits.known===false?"warn":"");
    mrKeyValue(block,"Riley calls",riley.known===true?mrCount(riley.calls):mrUnknown(riley,"call history could not be read"),riley.known===true?"":"warn");
  }

  function mrCronEntry(item){
    var label=mrName(item);
    if(!item||typeof item!=="object")return label;
    var observed=item.observed===null||item.observed===undefined?null:finite(item.observed);
    var expected=item.expected===null||item.expected===undefined?null:finite(item.expected);
    var silent=item.silentRuns===null||item.silentRuns===undefined?null:finite(item.silentRuns);
    var manual=item.manualObserved===null||item.manualObserved===undefined?null:finite(item.manualObserved);
    if(observed!==null&&expected!==null)label+=" "+observed.toLocaleString()+"/"+expected.toLocaleString();
    if(silent!==null&&silent>0)label+=" · "+silent.toLocaleString()+" silent";
    if(manual!==null&&manual>0)label+=" · "+manual.toLocaleString()+" manual";
    return label;
  }

  function mrCronNames(items){
    items=Array.isArray(items)?items:[];
    if(!items.length)return "0 · none";
    return items.length.toLocaleString()+" · "+items.map(mrCronEntry).join(", ");
  }

  function mrCrons(host,crons){
    crons=crons||{};
    var block=mrBlock(host,"Scheduled work");
    if(crons.known===false){
      mrKeyValue(block,"Cron history",mrUnknown(crons,"cron history could not be read"),"warn");
    }
    mrKeyValue(block,"Fired",mrCronNames(crons.fired),"ok");
    mrKeyValue(block,"Silent",mrCronNames(crons.silent),Array.isArray(crons.silent)&&crons.silent.length?"bad":"");
    mrKeyValue(block,"Not due",mrCronNames(crons.notDue));
    mrKeyValue(block,"Unknown",mrCronNames(crons.unknown),Array.isArray(crons.unknown)&&crons.unknown.length?"warn":"");
  }

  function mrNotes(host,report){
    var warnings=Array.isArray(report.warnings)?report.warnings:[];
    if(!warnings.length)return;
    var block=mrBlock(host,"Data notes","mr-notes");
    var list=mrNode("ul","mr-list");
    warnings.forEach(function(warning){list.appendChild(mrNode("li","warn",mrName(warning)));});
    block.appendChild(list);
  }

  function renderMorningReport(report){
    report=report&&typeof report==="object"?report:{};
    var body=byId("morningReportBody");
    var windowNode=byId("morningReportWindow");
    var period=report.window||{};
    var start=new Date(period.start||"");
    var end=new Date(period.end||"");
    var startText=Number.isFinite(start.getTime())?start.toLocaleString():"Unknown start";
    var endText=Number.isFinite(end.getTime())?end.toLocaleString():"Unknown end";
    windowNode.textContent="Measured window: "+startText+" — "+endText;
    if(Number.isFinite(start.getTime()))windowNode.title=start.toISOString()+" — "+(Number.isFinite(end.getTime())?end.toISOString():"unknown end");
    else windowNode.removeAttribute("title");

    body.textContent="";
    body.className="";
    var summary=mrNode("div","mr-summary");
    var totals=report.totals||{};
    mrMetric(summary,"Leads mined",totals.mined);
    mrMetric(summary,"Sites built",totals.built);
    mrMetric(summary,"Emails sent",totals.sent);
    mrMetric(summary,"Replies waiting",totals.repliesWaiting);
    body.appendChild(summary);

    var detail=mrNode("div","mr-detail-grid");
    mrSites(detail,report.sites||{});
    mrLosses(detail,report.leads||{});
    mrDelivery(detail,report);
    mrEditsAndCalls(detail,report);
    mrCrons(detail,report.crons||{});
    mrNotes(detail,report);
    body.appendChild(detail);
  }

  function loadMorningReport(force){
    if(morningReportInFlight)return;
    if(morningReportLoaded&&force!==true)return;
    var body=byId("morningReportBody");
    var refresh=byId("morningReportRefresh");
    if(!token()){
      body.className="mr-status";
      body.textContent="Open the command center with your operator token first.";
      return;
    }
    morningReportInFlight=true;
    refresh.disabled=true;
    refresh.textContent="Loading…";
    body.className="mr-status";
    body.textContent="Loading the measured morning window…";
    api("/api/admin/morning-report").then(function(payload){
      if(!payload||payload.ok!==true||!payload.report)throw errorWithStatus("Morning Report returned no digest",502);
      renderMorningReport(payload.report);
      morningReportLoaded=true;
    }).catch(function(error){
      morningReportLoaded=false;
      body.className="mr-status bad";
      body.textContent="Morning Report failed to load"+(error&&error.status?(" (status "+error.status+")"):"")+". Use Refresh to try again.";
      if(error&&(error.status===401||error.status===403)){clearToken();showGate("Token expired or rejected. Enter a current operator token.");}
    }).then(function(){
      morningReportInFlight=false;
      refresh.disabled=false;
      refresh.textContent="Refresh";
    });
  }

  byId("morningReportRefresh").addEventListener("click",function(){
    morningReportLoaded=false;
    loadMorningReport(true);
  });
  // MORNING_REPORT_READ_ONLY_END

  function loadOperationsTab(){
    loadMorningReport(false);
    if(tabPanelLoaded.operations)return;
    var card=byId("opsFrameCard");
    if(!token()){card.innerHTML='<p class="why">Open the command center with your operator token first.</p>';return;}
    tabPanelLoaded.operations=true;
    card.innerHTML='<p class="why">Loading operations…</p>';
    api("/api/admin/dashboard").then(function(payload){
      var html=payload&&typeof payload.message==="string"?payload.message:"";
      if(!html){throw errorWithStatus("Operations deck returned no markup",502);}
      html=html.replace(/<meta[^>]*http-equiv="refresh"[^>]*>/i,"");
      var frame=document.createElement("iframe");
      frame.title="Operations";
      frame.setAttribute("sandbox","");
      card.innerHTML="";
      card.appendChild(frame);
      frame.srcdoc=html;
    }).catch(function(error){
      tabPanelLoaded.operations=false;
      card.innerHTML="";
      var note=document.createElement("p");
      note.className="why";
      note.textContent="Operations deck failed to load"+(error&&error.status?(" (status "+error.status+")"):"")+".";
      card.appendChild(note);
      card.appendChild(retryButton("Retry",function(){loadOperationsTab();}));
      if(error&&(error.status===401||error.status===403)){clearToken();showGate("Token expired or rejected. Enter a current operator token.");}
    });
  }
})();
</script>
${consoleOrbitHtml}
</body></html>`;
