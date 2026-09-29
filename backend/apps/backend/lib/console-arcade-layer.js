"use strict";

// WSS GHOST ARCADE — the Command Center overview hero (delivered module).
// Verbatim browser module (ES2020, zero dependencies, zero network calls).
// Stored as an escaped template literal so /console inlines it with the rest
// of the page string — the same single-lib-file pattern as console-page.js —
// instead of adding a second request or a build step.
//
// ESCAPE CONTRACT: backslash, backtick and dollar-brace are escaped; every
// other byte is the delivered source. Round-trip equality with the delivered
// module is pinned by test/console-arcade-hero.test.js (vm evaluation plus
// anchor pins). To redeliver: escape the new source the same way and re-run
// the tests.
module.exports = `(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const ROOT_CLASS = 'wss-arcade';
  const STYLE_ID = 'wss-arcade-layer-style';
  const STATIONS = [
    { key: 'mine', icon: '⛏️', label: 'MINE', crew: ['leadminer'], x: 90 },
    { key: 'qualify', icon: '🔎', label: 'QUALIFY', crew: ['researcher'], x: 260 },
    { key: 'build', icon: '🏗️', label: 'BUILD', crew: ['siteforge'], x: 430 },
    { key: 'outreach', icon: '✉️', label: 'OUTREACH', crew: ['ghost'], x: 600 },
    { key: 'engage', icon: '👀', label: 'ENGAGE', crew: ['riley', 'answercrew', 'callprep'], x: 770 },
    { key: 'convert', icon: '💳', label: 'CONVERT', crew: ['checkout'], x: 940 }
  ];
  const CREW = [
    { key: 'leadminer', label: 'LeadMiner', station: 'mine', prop: 'lead' },
    { key: 'researcher', label: 'Researcher', station: 'qualify', prop: 'card' },
    { key: 'siteforge', label: 'SiteForge', station: 'build', prop: 'site' },
    { key: 'ghost', label: 'Ghost', station: 'outreach', prop: 'mail' },
    { key: 'riley', label: 'Riley', station: 'engage', prop: 'signal' },
    { key: 'answercrew', label: 'AnswerCrew', station: 'engage', prop: 'signal' },
    { key: 'callprep', label: 'CallPrep', station: 'engage', prop: 'phone' },
    { key: 'checkout', label: 'Checkout', station: 'convert', prop: 'coin' }
  ];
  const EVENT_TYPES = new Set([
    'mined', 'qualified', 'built', 'queued', 'sent', 'opened',
    'clicked', 'called', 'replied', 'paid', 'blocked', 'failed'
  ]);
  const DEMO_STORY_MS = 76000;
  const DEFAULT_STATE = {
    stations: {
      mine: { status: 'idle', count: null, note: '' },
      qualify: { status: 'idle', count: null, note: '' },
      build: { status: 'idle', count: null, note: '' },
      outreach: { status: 'idle', count: null, note: '' },
      engage: { status: 'idle', count: null, note: '' },
      convert: { status: 'idle', count: null, note: '' }
    },
    theater: {
      stages: ['START', 'MINE', 'QUALIFY', 'BUILD', 'QUEUE', 'APPROVE', 'SEND'],
      currentIndex: 0,
      elapsedMs: null,
      currentBusiness: null,
      pausedReason: null
    },
    metrics: { mrr: null, sentToday: null, sitesBuilt: null },
    crew: {
      leadminer: 'resting',
      researcher: 'resting',
      siteforge: 'resting',
      ghost: 'resting',
      riley: 'resting',
      answercrew: 'resting',
      callprep: 'resting',
      checkout: 'resting'
    }
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, String(v)));
    return node;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, Number(n) || 0));
  }

  function safeText(v, fallback = '') {
    return v == null ? fallback : String(v);
  }

  function metric(v, currency = false) {
    if (v == null || Number.isNaN(Number(v))) return 'Unknown';
    const n = Number(v);
    return currency
      ? '$' + Math.round(n).toLocaleString()
      : Math.round(n).toLocaleString();
  }

  function copyState(input) {
    const src = input || {};
    const out = {
      stations: {},
      theater: {
        stages: Array.isArray(src.theater?.stages) && src.theater.stages.length
          ? src.theater.stages.map(String)
          : DEFAULT_STATE.theater.stages.slice(),
        currentIndex: Number.isFinite(Number(src.theater?.currentIndex))
          ? Number(src.theater.currentIndex)
          : 0,
        elapsedMs: src.theater?.elapsedMs == null ? null : Number(src.theater.elapsedMs),
        currentBusiness: src.theater?.currentBusiness == null ? null : String(src.theater.currentBusiness),
        pausedReason: src.theater?.pausedReason == null ? null : String(src.theater.pausedReason)
      },
      metrics: {
        mrr: src.metrics?.mrr == null ? null : Number(src.metrics.mrr),
        sentToday: src.metrics?.sentToday == null ? null : Number(src.metrics.sentToday),
        sitesBuilt: src.metrics?.sitesBuilt == null ? null : Number(src.metrics.sitesBuilt)
      },
      crew: {}
    };

    STATIONS.forEach(({ key }) => {
      const s = src.stations?.[key] || DEFAULT_STATE.stations[key];
      out.stations[key] = {
        status: ['idle', 'working', 'blocked', 'done'].includes(s?.status) ? s.status : 'idle',
        count: s?.count == null ? null : Number(s.count),
        note: safeText(s?.note)
      };
    });

    CREW.forEach(({ key }) => {
      const v = src.crew?.[key];
      out.crew[key] = ['resting', 'starting', 'working', 'waiting', 'blocked', 'finished'].includes(v)
        ? v
        : 'resting';
    });

    return out;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = \`
.\${ROOT_CLASS}{
  --void:#08080B;--panel:#10111A;--panel2:#141623;--ink:#F7F7FB;--muted:#9CA3AF;
  --violet:#9E90FF;--violet2:#7C6CF6;--blue:#38BDF8;--green:#34D399;--amber:#FBBF24;--red:#F87171;
  --line:#2A2D3D;--shadow:0 18px 70px rgba(0,0,0,.38);
  color:var(--ink);background:
    radial-gradient(1000px 500px at 50% -10%,rgba(124,108,246,.18),transparent 65%),
    linear-gradient(180deg,#0B0C12 0%,#08080B 100%);
  font-family:"Hanken Grotesk",Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  border:1px solid #202232;border-radius:20px;box-shadow:var(--shadow);overflow:hidden;position:relative;
}
.\${ROOT_CLASS} *{box-sizing:border-box}
.\${ROOT_CLASS} button,.\${ROOT_CLASS} input{font:inherit}
.\${ROOT_CLASS} .mono{font-family:"IBM Plex Mono","SFMono-Regular",Consolas,monospace}
.\${ROOT_CLASS} .topbar{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #1D1F2C;background:#0B0C12}
.\${ROOT_CLASS} .brand{display:flex;align-items:center;gap:10px;min-width:0}
.\${ROOT_CLASS} .brand-mark{width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,var(--violet),var(--violet2));display:grid;place-items:center;box-shadow:0 0 24px rgba(124,108,246,.35)}
.\${ROOT_CLASS} .brand-title{font-size:13px;font-weight:850;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}
.\${ROOT_CLASS} .brand-sub{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.\${ROOT_CLASS} .demo-banner{display:none;background:#2C250B;color:#FFE7A4;border:1px solid #6A5510;border-radius:999px;padding:6px 10px;font-size:10px;font-weight:900;letter-spacing:.08em}
.\${ROOT_CLASS}.is-demo .demo-banner{display:inline-flex}
.\${ROOT_CLASS} .top-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}
.\${ROOT_CLASS} .pill-btn{border:1px solid #30334A;color:#E9E8FF;background:#151726;border-radius:9px;padding:7px 10px;cursor:pointer;font-size:11px;font-weight:800}
.\${ROOT_CLASS} .pill-btn:hover{border-color:#4C4F72}
.\${ROOT_CLASS} .pill-btn:focus-visible,.\${ROOT_CLASS} .station-card:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
.\${ROOT_CLASS} .pill-btn[aria-pressed="true"]{border-color:var(--violet);box-shadow:0 0 0 1px rgba(158,144,255,.25) inset}
.\${ROOT_CLASS} .sound-btn.off{opacity:.72}
.\${ROOT_CLASS} .shell{padding:14px}
.\${ROOT_CLASS} .theater{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;background:#0E1018;border:1px solid #25283A;border-radius:14px;padding:10px 12px;margin-bottom:12px}
.\${ROOT_CLASS} .stages{display:flex;align-items:center;gap:4px;min-width:0;overflow:auto;padding-bottom:2px;scrollbar-width:thin}
.\${ROOT_CLASS} .stage{display:flex;align-items:center;gap:4px;color:#6F738A;font-size:9px;font-weight:900;letter-spacing:.1em;white-space:nowrap}
.\${ROOT_CLASS} .stage:not(:last-child)::after{content:"›";color:#3E4259;margin:0 3px}
.\${ROOT_CLASS} .stage.current{color:#F4F0FF;text-shadow:0 0 16px rgba(158,144,255,.5)}
.\${ROOT_CLASS} .stage.current .dot{background:var(--violet);box-shadow:0 0 10px rgba(158,144,255,.7)}
.\${ROOT_CLASS} .dot{width:6px;height:6px;border-radius:50%;background:#383C52}
.\${ROOT_CLASS} .theater-meta{text-align:right;min-width:190px}
.\${ROOT_CLASS} .business{font-size:11px;font-weight:800;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.\${ROOT_CLASS} .elapsed,.\${ROOT_CLASS} .paused-reason{font-size:10px;color:var(--muted);margin-top:2px}
.\${ROOT_CLASS} .paused-reason{color:var(--amber)}
.\${ROOT_CLASS} .hero-grid{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:12px}
.\${ROOT_CLASS} .factory-wrap{position:relative;background:
  radial-gradient(circle at 50% 10%,rgba(56,189,248,.07),transparent 34%),
  linear-gradient(180deg,#11131D 0,#0B0D14 100%);border:1px solid #242739;border-radius:16px;overflow:hidden;min-height:430px}
.\${ROOT_CLASS} .factory-wrap::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:22px 22px;pointer-events:none}
.\${ROOT_CLASS} .factory-scroll{overflow-x:auto;overflow-y:hidden;height:100%;scrollbar-width:thin}
.\${ROOT_CLASS} .factory-stage{position:relative;width:1040px;height:430px;min-width:1040px}
.\${ROOT_CLASS} .map-svg{position:absolute;inset:0;width:1040px;height:430px;pointer-events:none}
.\${ROOT_CLASS} .road{stroke:#393D54;stroke-width:9;stroke-linecap:round;opacity:.72}
.\${ROOT_CLASS} .road-glow{stroke:#242A45;stroke-width:17;stroke-linecap:round;opacity:.42}
.\${ROOT_CLASS} .road-arrow{fill:#5D637E;opacity:.8}
.\${ROOT_CLASS} .branch{stroke:#6B561A;stroke-width:7;stroke-linecap:round;stroke-dasharray:9 10;opacity:.72}
.\${ROOT_CLASS} .station-card{position:absolute;width:145px;height:178px;top:106px;border-radius:16px;border:1px solid #2A2D40;background:#12141E;padding:11px;transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease;overflow:hidden}
.\${ROOT_CLASS} .station-card::after{content:"";position:absolute;inset:auto 12px 10px;height:2px;background:linear-gradient(90deg,transparent,#444A67,transparent);opacity:.5}
.\${ROOT_CLASS} .station-card[data-status="working"]{border-color:#5D55A4;box-shadow:0 0 0 1px rgba(158,144,255,.12) inset,0 0 28px rgba(124,108,246,.13)}
.\${ROOT_CLASS} .station-card[data-status="done"]{border-color:#245D50}
.\${ROOT_CLASS} .station-card[data-status="blocked"]{border-color:#7A3037;box-shadow:0 0 24px rgba(248,113,113,.12)}
.\${ROOT_CLASS} .station-head{display:flex;align-items:center;justify-content:space-between;gap:6px}
.\${ROOT_CLASS} .station-name{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:950;letter-spacing:.08em}
.\${ROOT_CLASS} .station-icon{font-size:16px}
.\${ROOT_CLASS} .station-light{width:7px;height:7px;border-radius:50%;background:#4A4E63}
.\${ROOT_CLASS} .station-card[data-status="working"] .station-light{background:var(--violet);box-shadow:0 0 12px rgba(158,144,255,.8)}
.\${ROOT_CLASS} .station-card[data-status="done"] .station-light{background:var(--green);box-shadow:0 0 10px rgba(52,211,153,.65)}
.\${ROOT_CLASS} .station-card[data-status="blocked"] .station-light{background:var(--red);box-shadow:0 0 10px rgba(248,113,113,.7)}
.\${ROOT_CLASS} .station-count{font-size:19px;font-weight:900;margin-top:14px;letter-spacing:-.04em}
.\${ROOT_CLASS} .station-note{font-size:9px;color:#8F94A8;line-height:1.35;height:25px;overflow:hidden;margin-top:3px}
.\${ROOT_CLASS} .machine{position:absolute;left:11px;right:11px;bottom:18px;height:43px;border:1px solid #292C3D;border-radius:9px;background:#0C0E15;overflow:hidden}
.\${ROOT_CLASS} .gear,.\${ROOT_CLASS} .belt,.\${ROOT_CLASS} .scanner{position:absolute;display:block}
.\${ROOT_CLASS} .gear{width:17px;height:17px;border:3px dotted #596078;border-radius:50%;left:10px;top:12px}
.\${ROOT_CLASS} .belt{left:38px;right:9px;height:5px;top:18px;background:repeating-linear-gradient(90deg,#3A3F55 0 7px,#1D2030 7px 13px);border-radius:99px}
.\${ROOT_CLASS} .scanner{width:3px;height:25px;background:var(--blue);opacity:.35;top:8px;left:68px;box-shadow:0 0 12px rgba(56,189,248,.8)}
.\${ROOT_CLASS} .site-tile{position:absolute;right:8px;top:7px;width:31px;height:25px;border:1px solid #5C5F79;border-radius:4px;background:#151927;opacity:0;transform:translateY(5px) scale(.9);transition:opacity .22s ease,transform .22s ease}
.\${ROOT_CLASS} .site-tile::before{content:"";display:block;height:5px;background:linear-gradient(90deg,var(--violet),var(--blue));border-radius:3px 3px 0 0}
.\${ROOT_CLASS} .site-tile::after{content:"";display:block;margin:5px;width:17px;height:2px;background:#636981;box-shadow:0 5px 0 #454A60}
.\${ROOT_CLASS} .station-card.reveal-site .site-tile{opacity:1;transform:none}
.\${ROOT_CLASS} .worker{position:absolute;width:31px;height:46px;z-index:6;transform:translate3d(0,0,0);will-change:transform,opacity}
.\${ROOT_CLASS} .worker svg{display:block;width:31px;height:46px;filter:drop-shadow(0 5px 5px rgba(0,0,0,.25))}
.\${ROOT_CLASS} .worker .worker-label{position:absolute;left:50%;bottom:-13px;transform:translateX(-50%);font-size:7px;color:#AEB3C6;white-space:nowrap;opacity:.86}
.\${ROOT_CLASS} .prop-chip{position:absolute;right:-5px;top:20px;font-size:10px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.4))}
.\${ROOT_CLASS} .crew-roster{background:#0E1018;border:1px solid #242739;border-radius:16px;padding:11px;min-height:430px}
.\${ROOT_CLASS} .section-kicker{font-size:9px;color:#80859C;letter-spacing:.12em;font-weight:950;text-transform:uppercase}
.\${ROOT_CLASS} .crew-title{font-size:13px;font-weight:900;margin-top:3px}
.\${ROOT_CLASS} .crew-list{display:grid;gap:7px;margin-top:10px}
.\${ROOT_CLASS} .crew-row{display:grid;grid-template-columns:25px 1fr auto;gap:8px;align-items:center;border-bottom:1px solid #1D2030;padding:4px 0 8px}
.\${ROOT_CLASS} .crew-face{width:24px;height:24px;border:1px solid #34384E;border-radius:8px;background:#141725;display:grid;place-items:center}
.\${ROOT_CLASS} .crew-name{font-size:10px;font-weight:850}
.\${ROOT_CLASS} .crew-station{font-size:8px;color:#767C94;text-transform:uppercase;margin-top:1px}
.\${ROOT_CLASS} .crew-state{font-size:8px;font-weight:900;text-transform:uppercase;border-radius:99px;padding:3px 5px;border:1px solid #33374D;color:#A6ABBE}
.\${ROOT_CLASS} .crew-state[data-state="working"],.\${ROOT_CLASS} .crew-state[data-state="starting"]{border-color:#554D92;color:#C7C0FF}
.\${ROOT_CLASS} .crew-state[data-state="waiting"]{border-color:#69571D;color:#F6D66A}
.\${ROOT_CLASS} .crew-state[data-state="blocked"]{border-color:#71353A;color:#FFACB2}
.\${ROOT_CLASS} .crew-state[data-state="finished"]{border-color:#225B4B;color:#87E9C5}
.\${ROOT_CLASS} .vapi{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:11px;padding:8px;border:1px solid #343033;border-radius:10px;background:#121114}
.\${ROOT_CLASS} .vapi-name{font-size:9px;font-weight:900}
.\${ROOT_CLASS} .vapi-status{font-size:8px;color:#908787}
.\${ROOT_CLASS} .vapi-dot{width:7px;height:7px;border-radius:50%;background:#62555A}
.\${ROOT_CLASS} .vapi.live-call{border-color:#485B70}
.\${ROOT_CLASS} .vapi.live-call .vapi-dot{background:var(--blue);box-shadow:0 0 10px rgba(56,189,248,.65)}
.\${ROOT_CLASS} .bottom-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) 1.5fr;gap:10px;margin-top:12px}
.\${ROOT_CLASS} .metric-card,.\${ROOT_CLASS} .diag-card{border:1px solid #242739;background:#0E1018;border-radius:13px;padding:10px}
.\${ROOT_CLASS} .metric-label{font-size:8px;color:#7B8199;text-transform:uppercase;letter-spacing:.11em;font-weight:950}
.\${ROOT_CLASS} .metric-value{font-size:20px;font-weight:950;margin-top:5px;letter-spacing:-.04em}
.\${ROOT_CLASS} .metric-value.revenue{color:#A6F4D8}
.\${ROOT_CLASS} .diag-card{min-width:0}
.\${ROOT_CLASS} .diag-head{display:flex;justify-content:space-between;gap:8px;align-items:center}
.\${ROOT_CLASS} .diag-list{margin-top:6px;display:grid;gap:5px;max-height:68px;overflow:auto}
.\${ROOT_CLASS} .diag-item{font-size:8px;line-height:1.35;color:#A9AEC0;border-left:2px solid #6B3037;padding-left:6px}
.\${ROOT_CLASS} .diag-empty{font-size:8px;color:#6F7489;margin-top:6px}
.\${ROOT_CLASS} .branch-lane{position:absolute;left:204px;right:96px;top:333px;height:66px;border:1px dashed #5C4B1E;border-radius:14px;background:rgba(80,60,10,.09);z-index:2}
.\${ROOT_CLASS} .branch-title{position:absolute;left:12px;top:8px;font-size:8px;font-weight:900;color:#D9BC59;letter-spacing:.1em}
.\${ROOT_CLASS} .branch-chip{position:absolute;left:160px;right:14px;top:26px;font-size:8px;color:#B8A978;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.\${ROOT_CLASS} .packet{position:absolute;z-index:12;width:13px;height:13px;border-radius:4px;pointer-events:none;will-change:transform,opacity;box-shadow:0 0 16px rgba(158,144,255,.6)}
.\${ROOT_CLASS} .packet.real{background:linear-gradient(135deg,#F3EFFF,var(--violet2));border:1px solid #D6D0FF}
.\${ROOT_CLASS} .packet.ambient{width:8px;height:8px;border-radius:50%;background:#3D4C6A;border:1px solid #62759C;box-shadow:0 0 10px rgba(56,189,248,.15);opacity:.42}
.\${ROOT_CLASS} .packet.blocked{background:var(--red);border-color:#FFC0C3;box-shadow:0 0 12px rgba(248,113,113,.6)}
.\${ROOT_CLASS} .reason-chip{position:absolute;z-index:13;max-width:190px;background:#261315;border:1px solid #6F343A;color:#FFD1D4;border-radius:8px;padding:5px 7px;font-size:8px;line-height:1.25;box-shadow:0 8px 20px rgba(0,0,0,.28)}
.\${ROOT_CLASS} .revenue-burst{position:absolute;z-index:20;color:#B8F9E2;font-size:21px;font-weight:950;text-shadow:0 0 16px rgba(52,211,153,.65);pointer-events:none;will-change:transform,opacity}
.\${ROOT_CLASS} .ring{position:absolute;z-index:8;width:52px;height:52px;border:2px solid rgba(56,189,248,.7);border-radius:50%;pointer-events:none;will-change:transform,opacity}
.\${ROOT_CLASS} .envelope{position:absolute;z-index:12;font-size:16px;filter:drop-shadow(0 0 8px rgba(158,144,255,.4));will-change:transform,opacity}
.\${ROOT_CLASS} .aria-live{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.\${ROOT_CLASS}.visibility-paused *{animation-play-state:paused!important}
.\${ROOT_CLASS}:not(.motion-off) .station-card[data-status="idle"],
.\${ROOT_CLASS}:not(.motion-off) .station-card[data-status="done"]{animation:wss-breathe 4.8s ease-in-out infinite}
.\${ROOT_CLASS}:not(.motion-off) .station-card[data-status="working"]{animation:wss-working 1.9s ease-in-out infinite}
.\${ROOT_CLASS}:not(.motion-off) .gear{animation:wss-spin 7s linear infinite}
.\${ROOT_CLASS}:not(.motion-off) .belt{animation:wss-belt 3.2s linear infinite}
.\${ROOT_CLASS}:not(.motion-off) .scanner{animation:wss-scan 2.6s ease-in-out infinite}
.\${ROOT_CLASS}:not(.motion-off) .worker[data-state="resting"]{animation:wss-wander 4.5s ease-in-out infinite}
.\${ROOT_CLASS}:not(.motion-off) .worker[data-state="starting"]{animation:wss-start 1.2s ease-in-out infinite}
.\${ROOT_CLASS}:not(.motion-off) .worker[data-state="working"]{animation:wss-work .9s ease-in-out infinite}
.\${ROOT_CLASS}:not(.motion-off) .worker[data-state="waiting"]{animation:wss-wait 2.1s ease-in-out infinite}
.\${ROOT_CLASS}:not(.motion-off) .worker[data-state="blocked"]{animation:wss-blocked 1.5s ease-in-out infinite}
.\${ROOT_CLASS}:not(.motion-off) .worker[data-state="finished"]{animation:wss-finish 2.4s ease-in-out infinite}
@keyframes wss-breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes wss-working{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.012)}}
@keyframes wss-spin{to{transform:rotate(360deg)}}
@keyframes wss-belt{to{background-position:26px 0}}
@keyframes wss-scan{0%,100%{transform:translateX(-26px);opacity:.18}50%{transform:translateX(22px);opacity:.48}}
@keyframes wss-wander{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(7px,-1px,0)}}
@keyframes wss-start{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes wss-work{0%,100%{transform:translate3d(0,0,0) rotate(0)}50%{transform:translate3d(2px,-3px,0) rotate(-2deg)}}
@keyframes wss-wait{0%,100%{transform:translateX(0)}50%{transform:translateX(3px)}}
@keyframes wss-blocked{0%,100%{transform:translateY(0)}50%{transform:translateY(2px)}}
@keyframes wss-finish{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@media (max-width:980px){
  .\${ROOT_CLASS} .hero-grid{grid-template-columns:1fr}
  .\${ROOT_CLASS} .crew-roster{min-height:auto}
  .\${ROOT_CLASS} .crew-list{grid-template-columns:repeat(2,minmax(0,1fr))}
  .\${ROOT_CLASS} .bottom-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .\${ROOT_CLASS} .diag-card{grid-column:1/-1}
}
@media (max-width:640px){
  .\${ROOT_CLASS}{border-radius:14px}
  .\${ROOT_CLASS} .topbar{align-items:flex-start;flex-direction:column}
  .\${ROOT_CLASS} .top-actions{justify-content:flex-start}
  .\${ROOT_CLASS} .theater{grid-template-columns:1fr}
  .\${ROOT_CLASS} .theater-meta{text-align:left;min-width:0}
  .\${ROOT_CLASS} .crew-list{grid-template-columns:1fr}
  .\${ROOT_CLASS} .bottom-grid{grid-template-columns:1fr 1fr}
  .\${ROOT_CLASS} .diag-card{grid-column:1/-1}
}
@media (prefers-reduced-motion:reduce){
  .\${ROOT_CLASS} *{animation-duration:.001ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}
}
\`;
    document.head.appendChild(style);
  }

  function workerSVG(index) {
    const helmet = index % 3 === 0;
    const body = ['#8779F6', '#4E8FB4', '#6B72A7'][index % 3];
    return \`
      <svg viewBox="0 0 31 46" aria-hidden="true">
        <circle cx="15.5" cy="9" r="6.2" fill="#F0C7A6"/>
        \${helmet ? '<path d="M8.7 8.2c.5-5.4 12.7-5.4 13.6 0H8.7Z" fill="#A69BFF"/><rect x="8" y="7.3" width="15" height="2.3" rx="1.1" fill="#7466E7"/>' : '<path d="M10 4.5c3-3 8.5-2.3 11 1.3v2H10v-3.3Z" fill="#2A2230"/>'}
        <rect x="9.5" y="15" width="12" height="16" rx="4" fill="\${body}"/>
        <rect x="6.5" y="17" width="4" height="13" rx="2" fill="#F0C7A6"/>
        <rect x="20.5" y="17" width="4" height="13" rx="2" fill="#F0C7A6"/>
        <rect x="10" y="29" width="4.5" height="14" rx="2" fill="#30354A"/>
        <rect x="17" y="29" width="4.5" height="14" rx="2" fill="#30354A"/>
      </svg>\`;
  }

  class Arcade {
    constructor(container, options = {}) {
      if (!container || !(container instanceof Element)) {
        throw new Error('WSSArcade.mount(containerEl): valid mount element required');
      }
      injectStyle();
      this.container = container;
      this.options = {
        mode: options.mode === 'demo' ? 'demo' : 'live',
        reducedMotion: Boolean(options.reducedMotion),
        sound: Boolean(options.sound),
        onEvent: typeof options.onEvent === 'function' ? options.onEvent : null
      };
      this.state = copyState(DEFAULT_STATE);
      this.seenIds = new Set();
      this.lastEventId = null;
      this.destroyed = false;
      this.hidden = document.hidden;
      this.demoPaused = false;
      this.demoSpeed = 1;
      this.demoElapsed = 0;
      this.demoLast = 0;
      this.demoRAF = 0;
      this.ambientTimer = 0;
      this.pendingTimers = new Set();
      this.activeAnimations = new Set();
      this.audioCtx = null;
      this.soundEnabled = false;
      this.lastTheaterIndex = -1;
      this.revenueTween = null;
      this.buildRevealTimer = null;
      this.callPulseTimer = null;
      this.demoFired = new Set();
      this.demoCycle = 0;
      this._media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this._onMedia = () => this.applyMotionMode();
      this._onVisibility = () => {
        this.hidden = document.hidden;
        this.applyMotionMode();
        if (this.root) {
          this.root.getAnimations().forEach(animation => {
            try { this.hidden ? animation.pause() : animation.play(); } catch (_) {}
          });
        }
        if (!this.hidden && this.options.mode === 'demo' && !this.demoPaused) {
          this.demoLast = performance.now();
        }
      };

      this.renderBase();
      this.bind();
      this.applyMotionMode();
      this.setState(this.state);
      this.startAmbient();

      if (this.options.sound) this.setSound(false);
      if (this.options.mode === 'demo') this.startDemo();
    }

    renderBase() {
      const root = el('section', \`\${ROOT_CLASS}\${this.options.mode === 'demo' ? ' is-demo' : ''}\`);
      root.setAttribute('aria-label', 'WSS Ghost Arcade factory console');
      root.innerHTML = \`
        <div class="topbar">
          <div class="brand">
            <div class="brand-mark" aria-hidden="true">W</div>
            <div>
              <div class="brand-title">WSS Ghost Arcade</div>
              <div class="brand-sub">Living website money-machine factory · watching surface only</div>
            </div>
            <div class="demo-banner">DEMO — NO LIVE ACTIONS</div>
          </div>
          <div class="top-actions">
            <div class="demo-controls" style="\${this.options.mode === 'demo' ? '' : 'display:none'}">
              <button class="pill-btn demo-pause" type="button">Pause</button>
              <button class="pill-btn demo-replay" type="button">Replay</button>
              <button class="pill-btn demo-speed" type="button">1x</button>
            </div>
            <button class="pill-btn sound-btn off" type="button" aria-pressed="false" title="Enable synthesized interface sounds">Sound off</button>
          </div>
        </div>
        <div class="shell">
          <div class="theater" aria-label="Run theater">
            <div class="stages"></div>
            <div class="theater-meta">
              <div class="business">No active business</div>
              <div class="elapsed mono">Elapsed: Unknown</div>
              <div class="paused-reason"></div>
            </div>
          </div>

          <div class="hero-grid">
            <div class="factory-wrap" aria-label="Factory overview">
              <div class="factory-scroll">
                <div class="factory-stage">
                  <svg class="map-svg" viewBox="0 0 1040 430" aria-hidden="true">
                    <g>
                      <line class="road-glow" x1="155" y1="193" x2="855" y2="193"></line>
                      <line class="road" x1="155" y1="193" x2="855" y2="193"></line>
                      <polygon class="road-arrow" points="238,186 249,193 238,200"></polygon>
                      <polygon class="road-arrow" points="408,186 419,193 408,200"></polygon>
                      <polygon class="road-arrow" points="578,186 589,193 578,200"></polygon>
                      <polygon class="road-arrow" points="748,186 759,193 748,200"></polygon>
                      <polygon class="road-arrow" points="918,186 929,193 918,200"></polygon>
                      <path class="branch" d="M315 205 C330 255 356 306 412 348 L748 348"></path>
                    </g>
                  </svg>
                  <div class="branch-lane" aria-label="Blocked and waiting lane">
                    <div class="branch-title">BLOCKED / WAITING LANE</div>
                    <div class="branch-chip">Truthful holds park here. They do not continue down the happy path.</div>
                  </div>
                  <div class="stations"></div>
                  <div class="workers"></div>
                  <div class="effects" aria-hidden="true"></div>
                </div>
              </div>
            </div>
            <aside class="crew-roster" aria-label="Your Crew">
              <div class="section-kicker">Your Crew</div>
              <div class="crew-title">Agents on the floor</div>
              <div class="crew-list"></div>
              <div class="vapi" title="VAPI is not connected. This chip only reacts to a real called event.">
                <div>
                  <div class="vapi-name">VAPI provider</div>
                  <div class="vapi-status">Disconnected · event-reactive only</div>
                </div>
                <span class="vapi-dot"></span>
              </div>
            </aside>
          </div>

          <div class="bottom-grid">
            <div class="metric-card"><div class="metric-label">MRR</div><div class="metric-value revenue mono" data-metric="mrr">Unknown</div></div>
            <div class="metric-card"><div class="metric-label">Sent today</div><div class="metric-value mono" data-metric="sentToday">Unknown</div></div>
            <div class="metric-card"><div class="metric-label">Sites built</div><div class="metric-value mono" data-metric="sitesBuilt">Unknown</div></div>
            <div class="diag-card">
              <div class="diag-head"><div><div class="section-kicker">Reports lane</div><div class="crew-title">Diagnostics</div></div><div class="mono" style="font-size:8px;color:#6F7489">truth only</div></div>
              <div class="diag-list"></div>
              <div class="diag-empty">No blocked or failed events received.</div>
            </div>
          </div>
        </div>
        <div class="aria-live" aria-live="polite" aria-atomic="true"></div>
      \`;

      this.root = root;
      this.container.appendChild(root);
      this.stationsEl = root.querySelector('.stations');
      this.workersEl = root.querySelector('.workers');
      this.effectsEl = root.querySelector('.effects');
      this.stagesEl = root.querySelector('.stages');
      this.ariaLive = root.querySelector('.aria-live');
      this.diagList = root.querySelector('.diag-list');
      this.diagEmpty = root.querySelector('.diag-empty');
      this.vapi = root.querySelector('.vapi');

      STATIONS.forEach((s, idx) => {
        const node = el('article', 'station-card');
        node.tabIndex = 0;
        node.dataset.station = s.key;
        node.dataset.status = 'idle';
        node.style.left = (s.x - 72) + 'px';
        node.setAttribute('aria-label', \`\${s.label} station\`);
        node.innerHTML = \`
          <div class="station-head">
            <div class="station-name"><span class="station-icon">\${s.icon}</span>\${s.label}</div>
            <span class="station-light"></span>
          </div>
          <div class="station-count mono">Unknown</div>
          <div class="station-note"></div>
          <div class="machine">
            <span class="gear"></span><span class="belt"></span><span class="scanner"></span>
            \${s.key === 'build' ? '<span class="site-tile"></span>' : ''}
          </div>\`;
        this.stationsEl.appendChild(node);
      });

      CREW.forEach((c, i) => {
        const s = STATIONS.find(x => x.key === c.station);
        const w = el('div', 'worker');
        w.dataset.crew = c.key;
        w.dataset.state = 'resting';
        w.style.left = (s.x - 15 + (i % 3) * 13 - 8) + 'px';
        w.style.top = (75 + (i % 2) * 225) + 'px';
        w.innerHTML = \`\${workerSVG(i)}<span class="prop-chip">\${this.propIcon(c.prop)}</span><span class="worker-label">\${c.label}</span>\`;
        this.workersEl.appendChild(w);

        const row = el('div', 'crew-row');
        row.dataset.crewRow = c.key;
        row.innerHTML = \`
          <div class="crew-face">\${workerSVG(i)}</div>
          <div><div class="crew-name">\${c.label}</div><div class="crew-station">\${c.station}</div></div>
          <div class="crew-state" data-state="resting">resting</div>\`;
        this.root.querySelector('.crew-list').appendChild(row);
      });
    }

    propIcon(type) {
      return ({ lead: '▤', card: '▧', site: '▣', mail: '✉', signal: '⌁', phone: '☎', coin: '●' })[type] || '•';
    }

    bind() {
      this._onClick = (e) => {
        const t = e.target;
        if (t.closest('.demo-pause')) {
          this.demoPaused ? this.resumeDemo() : this.pauseDemo();
        } else if (t.closest('.demo-replay')) {
          this.replayDemo();
        } else if (t.closest('.demo-speed')) {
          const next = this.demoSpeed === 0.5 ? 1 : this.demoSpeed === 1 ? 2 : 0.5;
          this.setDemoSpeed(next);
        } else if (t.closest('.sound-btn')) {
          this.setSound(!this.soundEnabled);
        }
      };
      this.root.addEventListener('click', this._onClick);
      document.addEventListener('visibilitychange', this._onVisibility);
      if (this._media?.addEventListener) this._media.addEventListener('change', this._onMedia);
      else if (this._media?.addListener) this._media.addListener(this._onMedia);
    }

    isReduced() {
      return this.options.reducedMotion || Boolean(this._media?.matches);
    }

    applyMotionMode() {
      if (!this.root) return;
      this.root.classList.toggle('motion-off', this.isReduced());
      this.root.classList.toggle('visibility-paused', this.hidden);
    }

    setState(next) {
      if (this.destroyed) return;
      this.state = copyState(next);
      const { stations, metrics, crew, theater } = this.state;

      STATIONS.forEach(({ key, label }) => {
        const node = this.root.querySelector(\`.station-card[data-station="\${key}"]\`);
        const s = stations[key];
        node.dataset.status = s.status;
        node.querySelector('.station-count').textContent = metric(s.count);
        node.querySelector('.station-note').textContent = s.note || '';
        node.setAttribute('aria-label', \`\${label} station, \${s.status}, count \${metric(s.count)}\${s.note ? ', ' + s.note : ''}\`);
      });

      CREW.forEach(({ key }) => {
        const state = crew[key];
        const worker = this.root.querySelector(\`.worker[data-crew="\${key}"]\`);
        const row = this.root.querySelector(\`[data-crew-row="\${key}"] .crew-state\`);
        worker.dataset.state = state;
        row.dataset.state = state;
        row.textContent = state;
      });

      this.root.querySelector('[data-metric="mrr"]').textContent = metric(metrics.mrr, true);
      this.root.querySelector('[data-metric="sentToday"]').textContent = metric(metrics.sentToday);
      this.root.querySelector('[data-metric="sitesBuilt"]').textContent = metric(metrics.sitesBuilt);
      this.renderTheater(theater);
    }

    renderTheater(theater) {
      const idx = clamp(theater.currentIndex, 0, Math.max(0, theater.stages.length - 1));
      this.stagesEl.innerHTML = '';
      theater.stages.forEach((s, i) => {
        const item = el('div', \`stage\${i === idx ? ' current' : ''}\`);
        item.innerHTML = \`<span class="dot"></span><span>\${safeText(s)}</span>\`;
        this.stagesEl.appendChild(item);
      });

      this.root.querySelector('.business').textContent = theater.currentBusiness || 'No active business';
      this.root.querySelector('.elapsed').textContent =
        'Elapsed: ' + (theater.elapsedMs == null ? 'Unknown' : this.formatElapsed(theater.elapsedMs));
      this.root.querySelector('.paused-reason').textContent = theater.pausedReason || '';

      if (idx !== this.lastTheaterIndex) {
        this.lastTheaterIndex = idx;
        const label = theater.stages[idx] || 'Unknown';
        this.announce(\`Run theater stage \${label}\${theater.currentBusiness ? ' for ' + theater.currentBusiness : ''}\`);
      }
    }

    formatElapsed(ms) {
      const n = Math.max(0, Number(ms) || 0);
      if (n < 1000) return \`\${Math.round(n)}ms\`;
      return \`\${(n / 1000).toFixed(n < 10000 ? 1 : 0)}s\`;
    }

    pushEvent(evt) {
      if (this.destroyed || !evt || typeof evt.id !== 'string' || !evt.id) return false;
      if (this.seenIds.has(evt.id)) return false;
      this.seenIds.add(evt.id);
      this.lastEventId = evt.id;

      const type = String(evt.type || '');
      if (!EVENT_TYPES.has(type)) return false;
      const station = STATIONS.some(s => s.key === evt.station) ? evt.station : this.inferStation(type);
      const normalized = {
        id: evt.id,
        type,
        at: Number(evt.at) || Date.now(),
        station,
        payload: evt.payload && typeof evt.payload === 'object' ? evt.payload : {}
      };

      this.handleEvent(normalized);
      if (this.options.onEvent) {
        try { this.options.onEvent(normalized); } catch (_) {}
      }
      return true;
    }

    inferStation(type) {
      if (type === 'mined') return 'mine';
      if (type === 'qualified') return 'qualify';
      if (type === 'built') return 'build';
      if (type === 'queued' || type === 'sent') return 'outreach';
      if (['opened', 'clicked', 'called', 'replied'].includes(type)) return 'engage';
      if (type === 'paid') return 'convert';
      return 'qualify';
    }

    handleEvent(evt) {
      const p = evt.payload || {};
      this.blip(evt.type);

      switch (evt.type) {
        case 'mined':
          this.announce('Lead mined. Moving from Mine to Qualify.');
          this.travel('mine', 'qualify', { kind: 'lead' });
          break;
        case 'qualified':
          if (p.blocked || p.waiting || p.route === 'blocked') {
            this.announce(\`Qualification routed to blocked or waiting lane\${p.reason ? ': ' + p.reason : ''}.\`);
            this.toBranch('qualify', p.reason || 'Waiting for truthful resolution');
          } else {
            this.announce('Lead qualified. Moving to Build.');
            this.travel('qualify', 'build', { kind: 'qualified' });
          }
          break;
        case 'built': {
          const build = this.root.querySelector('.station-card[data-station="build"]');
          build.classList.add('reveal-site');
          this.announce('Website build completed.');
          this.tempClass(build, 'event-lit', 900);
          break;
        }
        case 'queued':
          this.announce('Outreach item queued.');
          this.envelopeAt('outreach');
          break;
        case 'sent':
          this.announce('Outreach sent. Envelope moving toward Engage.');
          this.sentEnvelope();
          break;
        case 'opened':
          this.announce('Outreach opened.');
          this.stationPulse('engage');
          break;
        case 'clicked':
          this.announce('Outreach clicked.');
          this.stationPulse('engage', true);
          break;
        case 'called':
          this.announce('Real call event received. Engage and AnswerCrew are active.');
          this.callRing();
          break;
        case 'replied':
          this.announce('Owner replied.');
          this.stationPulse('engage');
          this.setCrewVisual('ghost', 'finished', 1700);
          break;
        case 'paid':
          this.announce('Payment event received. Conversion completed with plus 199.');
          this.travel(evt.station === 'convert' ? 'engage' : evt.station, 'convert', { kind: 'paid', onDone: () => this.revenueBurst() });
          this.tweenMRR(p.mrr);
          break;
        case 'blocked':
        case 'failed':
          this.announce(\`\${evt.type === 'blocked' ? 'Blocked' : 'Failed'} at \${evt.station}\${p.reason ? ': ' + p.reason : ''}.\`);
          this.stopAt(evt.station, p.reason || (evt.type === 'blocked' ? 'Blocked' : 'Failed'));
          this.addDiagnostic(evt);
          break;
      }
    }

    getStationPoint(key) {
      const s = STATIONS.find(x => x.key === key) || STATIONS[0];
      return { x: s.x, y: 193 };
    }

    animateTransform(node, from, to, duration = 900, onDone) {
      if (this.destroyed) return;
      if (this.isReduced()) {
        node.style.transform = \`translate3d(\${to.x}px,\${to.y}px,0)\`;
        if (onDone) onDone();
        return;
      }
      let start = performance.now();
      let hiddenSince = null;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      let raf = 0;
      const step = (now) => {
        if (this.destroyed) return;
        if (this.hidden) {
          if (hiddenSince == null) hiddenSince = now;
          raf = requestAnimationFrame(step);
          this.activeAnimations.add(raf);
          return;
        }
        if (hiddenSince != null) {
          start += now - hiddenSince;
          hiddenSince = null;
        }
        const t = clamp((now - start) / duration, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        node.style.transform = \`translate3d(\${from.x + dx * e}px,\${from.y + dy * e}px,0)\`;
        if (t < 1) {
          raf = requestAnimationFrame(step);
          this.activeAnimations.add(raf);
        } else {
          if (onDone) onDone();
        }
      };
      raf = requestAnimationFrame(step);
      this.activeAnimations.add(raf);
    }

    travel(fromKey, toKey, opts = {}) {
      const from = this.getStationPoint(fromKey);
      const to = this.getStationPoint(toKey);
      const packet = el('div', 'packet real');
      packet.title = 'Real event packet';
      packet.style.left = '-6px';
      packet.style.top = '-6px';
      this.effectsEl.appendChild(packet);
      this.animateTransform(packet, from, to, this.isReduced() ? 0 : 820, () => {
        packet.remove();
        this.stationPulse(toKey);
        if (opts.onDone) opts.onDone();
      });
    }

    ambientTravel() {
      if (this.destroyed || this.hidden || this.isReduced()) return;
      const i = Math.floor(Math.random() * (STATIONS.length - 1));
      const from = this.getStationPoint(STATIONS[i].key);
      const to = this.getStationPoint(STATIONS[i + 1].key);
      const packet = el('div', 'packet ambient');
      packet.title = 'Ambient decorative energy — not a real event';
      packet.style.left = '-4px';
      packet.style.top = '-4px';
      this.effectsEl.appendChild(packet);
      this.animateTransform(packet, from, to, 1350, () => packet.remove());
    }

    startAmbient() {
      const schedule = () => {
        if (this.destroyed) return;
        this.ambientTimer = window.setTimeout(() => {
          this.ambientTravel();
          schedule();
        }, 2600 + Math.floor(Math.random() * 2400));
      };
      schedule();
    }

    stationPulse(key, stronger = false) {
      const node = this.root.querySelector(\`.station-card[data-station="\${key}"]\`);
      if (!node || this.isReduced()) return;
      node.animate(
        [
          { transform: 'translateY(0) scale(1)', opacity: 1 },
          { transform: \`translateY(-2px) scale(\${stronger ? 1.035 : 1.02})\`, opacity: 1 },
          { transform: 'translateY(0) scale(1)', opacity: 1 }
        ],
        { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    }

    envelopeAt(key) {
      const p = this.getStationPoint(key);
      const n = el('div', 'envelope', '✉');
      n.style.left = (p.x - 9) + 'px';
      n.style.top = (p.y - 38) + 'px';
      this.effectsEl.appendChild(n);
      const timer = setTimeout(() => n.remove(), 1500);
      this.pendingTimers.add(timer);
    }

    sentEnvelope() {
      const a = this.getStationPoint('outreach');
      const b = this.getStationPoint('engage');
      const n = el('div', 'envelope', '✉');
      n.style.left = '-8px';
      n.style.top = '-13px';
      this.effectsEl.appendChild(n);
      this.animateTransform(n, a, b, 900, () => {
        n.remove();
        this.stationPulse('engage');
      });
    }

    toBranch(key, reason) {
      const a = this.getStationPoint(key);
      const b = { x: 512, y: 360 };
      const n = el('div', 'packet real');
      n.style.left = '-6px';
      n.style.top = '-6px';
      this.effectsEl.appendChild(n);
      this.animateTransform(n, a, b, 900, () => {
        n.classList.add('blocked');
        this.reasonAt(b.x + 12, b.y - 4, reason, 3600);
      });
    }

    stopAt(key, reason) {
      const p = this.getStationPoint(key);
      const n = el('div', 'packet blocked');
      n.style.left = (p.x - 6) + 'px';
      n.style.top = (p.y - 6) + 'px';
      this.effectsEl.appendChild(n);
      this.reasonAt(p.x + 10, p.y + 15, reason, 5000);
      const timer = setTimeout(() => n.remove(), 5000);
      this.pendingTimers.add(timer);
    }

    reasonAt(x, y, text, life) {
      const c = el('div', 'reason-chip', text);
      c.style.left = x + 'px';
      c.style.top = y + 'px';
      this.effectsEl.appendChild(c);
      const timer = setTimeout(() => c.remove(), life);
      this.pendingTimers.add(timer);
    }

    addDiagnostic(evt) {
      this.diagEmpty.style.display = 'none';
      const item = el('div', 'diag-item',
        \`\${evt.type.toUpperCase()} · \${evt.station.toUpperCase()} · \${safeText(evt.payload?.reason, 'No reason supplied')}\`);
      this.diagList.prepend(item);
      while (this.diagList.children.length > 6) this.diagList.lastElementChild.remove();
    }

    revenueBurst() {
      const p = this.getStationPoint('convert');
      const n = el('div', 'revenue-burst', '+$199');
      n.style.left = (p.x - 28) + 'px';
      n.style.top = (p.y - 35) + 'px';
      this.effectsEl.appendChild(n);
      if (this.isReduced()) {
        const timer = setTimeout(() => n.remove(), 1200);
        this.pendingTimers.add(timer);
        return;
      }
      n.animate(
        [
          { transform: 'translateY(0) scale(.8)', opacity: 0 },
          { transform: 'translateY(-8px) scale(1.12)', opacity: 1, offset: .25 },
          { transform: 'translateY(-24px) scale(1)', opacity: 0 }
        ],
        { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' }
      ).onfinish = () => n.remove();
    }

    tweenMRR(target) {
      if (target == null || Number.isNaN(Number(target))) return;
      const out = this.root.querySelector('[data-metric="mrr"]');
      const currentText = out.textContent.replace(/[$,]/g, '');
      const startVal = currentText === 'Unknown' || Number.isNaN(Number(currentText)) ? Number(target) - 199 : Number(currentText);
      const end = Number(target);
      if (this.isReduced()) {
        out.textContent = metric(end, true);
        return;
      }
      const start = performance.now();
      const duration = 800;
      const tick = (now) => {
        if (this.destroyed) return;
        const t = clamp((now - start) / duration, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        out.textContent = metric(startVal + (end - startVal) * e, true);
        if (t < 1) this.revenueTween = requestAnimationFrame(tick);
      };
      this.revenueTween = requestAnimationFrame(tick);
    }

    callRing() {
      const p = this.getStationPoint('engage');
      this.vapi.classList.add('live-call');
      const ring = el('div', 'ring');
      ring.style.left = (p.x - 26) + 'px';
      ring.style.top = (p.y - 26) + 'px';
      this.effectsEl.appendChild(ring);
      this.setCrewVisual('answercrew', 'working', 1800);
      this.setCrewVisual('riley', 'working', 1800);

      if (this.isReduced()) {
        const timer = setTimeout(() => ring.remove(), 1000);
        this.pendingTimers.add(timer);
      } else {
        ring.animate(
          [
            { transform: 'scale(.35)', opacity: .9 },
            { transform: 'scale(1.2)', opacity: 0 }
          ],
          { duration: 900, easing: 'ease-out' }
        ).onfinish = () => ring.remove();
      }
      clearTimeout(this.callPulseTimer);
      this.callPulseTimer = setTimeout(() => this.vapi.classList.remove('live-call'), 1900);
    }

    setCrewVisual(key, state, duration) {
      const w = this.root.querySelector(\`.worker[data-crew="\${key}"]\`);
      if (!w) return;
      const before = w.dataset.state;
      w.dataset.state = state;
      const timer = setTimeout(() => {
        if (w.isConnected) w.dataset.state = before;
      }, duration);
      this.pendingTimers.add(timer);
    }

    tempClass(node, className, duration) {
      if (!node) return;
      node.classList.add(className);
      const timer = setTimeout(() => node.classList.remove(className), duration);
      this.pendingTimers.add(timer);
    }

    announce(text) {
      if (!this.ariaLive) return;
      this.ariaLive.textContent = '';
      const timer = setTimeout(() => {
        if (this.ariaLive) this.ariaLive.textContent = text;
      }, 20);
      this.pendingTimers.add(timer);
    }

    setDemoSpeed(x) {
      const allowed = [0.5, 1, 2];
      const n = Number(x);
      if (!allowed.includes(n)) throw new Error('setDemoSpeed(x): supported speeds are 0.5, 1, 2');
      this.demoSpeed = n;
      const btn = this.root.querySelector('.demo-speed');
      if (btn) btn.textContent = \`\${n}x\`;
      return this;
    }

    pauseDemo() {
      if (this.options.mode !== 'demo') return this;
      this.demoPaused = true;
      const b = this.root.querySelector('.demo-pause');
      if (b) b.textContent = 'Resume';
      return this;
    }

    resumeDemo() {
      if (this.options.mode !== 'demo') return this;
      this.demoPaused = false;
      this.demoLast = performance.now();
      const b = this.root.querySelector('.demo-pause');
      if (b) b.textContent = 'Pause';
      return this;
    }

    replayDemo() {
      if (this.options.mode !== 'demo') return this;
      this.demoElapsed = 0;
      this.demoFired.clear();
      this.demoCycle += 1;
      this.seenIds.clear();
      this.resetDemoVisuals();
      this.demoLast = performance.now();
      return this;
    }

    resetDemoVisuals() {
      const demoState = copyState(DEFAULT_STATE);
      demoState.theater.currentBusiness = 'Demo Plumbing Co.';
      demoState.theater.currentIndex = 0;
      demoState.metrics = { mrr: null, sentToday: null, sitesBuilt: null };
      demoState.crew.leadminer = 'starting';
      this.setState(demoState);
      this.root.querySelector('.station-card[data-station="build"]').classList.remove('reveal-site');
      this.diagList.innerHTML = '';
      this.diagEmpty.style.display = '';
    }

    startDemo() {
      this.resetDemoVisuals();
      this.demoLast = performance.now();

      const story = [
        [3500, 'mined', 'mine', {}],
        [10500, 'qualified', 'qualify', {}],
        [19000, 'built', 'build', {}],
        [27500, 'queued', 'outreach', {}],
        [33500, 'sent', 'outreach', {}],
        [41500, 'opened', 'engage', {}],
        [48500, 'called', 'engage', {}],
        [55500, 'replied', 'engage', {}],
        [63000, 'paid', 'convert', { mrr: 199 }],
        [69000, 'qualified', 'qualify', { blocked: true, reason: 'Demo example: owner verification required' }]
      ];

      const loop = (now) => {
        if (this.destroyed) return;
        if (!this.demoPaused && !this.hidden) {
          const delta = Math.max(0, now - this.demoLast) * this.demoSpeed;
          this.demoElapsed += delta;
          this.demoLast = now;

          const progress = this.demoElapsed;
          const stages = this.state.theater.stages;
          let idx = 0;
          if (progress >= 5000) idx = 1;
          if (progress >= 12000) idx = 2;
          if (progress >= 21000) idx = 3;
          if (progress >= 29000) idx = 4;
          if (progress >= 38000) idx = 5;
          if (progress >= 45000) idx = 6;
          const nextState = copyState(this.state);
          nextState.theater.currentIndex = clamp(idx, 0, stages.length - 1);
          nextState.theater.elapsedMs = progress;
          nextState.theater.currentBusiness = 'Demo Plumbing Co.';
          nextState.crew = this.demoCrewFor(progress);
          nextState.stations = this.demoStationsFor(progress);
          nextState.metrics.sentToday = null;
          nextState.metrics.sitesBuilt = progress >= 19000 ? 1 : null;
          nextState.metrics.mrr = progress >= 63000 ? 199 : null;
          this.setState(nextState);

          story.forEach(([at, type, station, payload], i) => {
            const k = \`c\${this.demoCycle}-\${i}\`;
            if (progress >= at && !this.demoFired.has(k)) {
              this.demoFired.add(k);
              this.pushEvent({
                id: \`demo-\${this.demoCycle}-\${i}\`,
                type,
                at: Date.now(),
                station,
                payload
              });
            }
          });

          if (progress >= DEMO_STORY_MS) this.replayDemo();
        } else {
          this.demoLast = now;
        }
        this.demoRAF = requestAnimationFrame(loop);
      };
      this.demoRAF = requestAnimationFrame(loop);
    }

    demoCrewFor(ms) {
      const c = copyState(DEFAULT_STATE).crew;
      if (ms < 9000) c.leadminer = 'working';
      else if (ms < 18000) { c.leadminer = 'finished'; c.researcher = 'working'; }
      else if (ms < 27000) { c.researcher = 'finished'; c.siteforge = 'working'; }
      else if (ms < 41000) { c.siteforge = 'finished'; c.ghost = 'working'; }
      else if (ms < 55000) { c.ghost = 'finished'; c.riley = 'starting'; c.answercrew = 'waiting'; c.callprep = 'working'; }
      else if (ms < 63000) { c.riley = 'working'; c.answercrew = 'working'; c.callprep = 'finished'; }
      else { c.checkout = 'finished'; c.riley = 'finished'; c.answercrew = 'finished'; }
      return c;
    }

    demoStationsFor(ms) {
      const s = copyState(DEFAULT_STATE).stations;
      if (ms < 9000) s.mine.status = 'working';
      else s.mine.status = 'done';
      if (ms >= 9000 && ms < 18000) s.qualify.status = 'working';
      else if (ms >= 18000) s.qualify.status = 'done';
      if (ms >= 18000 && ms < 28000) s.build.status = 'working';
      else if (ms >= 28000) s.build.status = 'done';
      if (ms >= 28000 && ms < 41000) s.outreach.status = 'working';
      else if (ms >= 41000) s.outreach.status = 'done';
      if (ms >= 41000 && ms < 63000) s.engage.status = 'working';
      else if (ms >= 63000) s.engage.status = 'done';
      if (ms >= 62000) s.convert.status = 'done';
      return s;
    }

    async setSound(enabled) {
      if (!enabled) {
        this.soundEnabled = false;
      } else {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        if (!this.audioCtx) this.audioCtx = new Ctx();
        try { await this.audioCtx.resume(); } catch (_) {}
        this.soundEnabled = this.audioCtx.state === 'running';
      }
      const b = this.root.querySelector('.sound-btn');
      if (b) {
        b.textContent = this.soundEnabled ? 'Sound on' : 'Sound off';
        b.classList.toggle('off', !this.soundEnabled);
        b.setAttribute('aria-pressed', String(this.soundEnabled));
      }
      return this.soundEnabled;
    }

    blip(type) {
      if (!this.soundEnabled || !this.audioCtx || this.hidden) return;
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const paid = type === 'paid';
      const blocked = type === 'blocked' || type === 'failed';
      osc.type = 'sine';
      osc.frequency.value = paid ? 740 : blocked ? 190 : 420;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      clearTimeout(this.ambientTimer);
      clearTimeout(this.callPulseTimer);
      clearTimeout(this.buildRevealTimer);
      this.pendingTimers.forEach(t => clearTimeout(t));
      this.pendingTimers.clear();

      if (this.demoRAF) cancelAnimationFrame(this.demoRAF);
      if (this.revenueTween) cancelAnimationFrame(this.revenueTween);
      this.activeAnimations.forEach(id => cancelAnimationFrame(id));
      this.activeAnimations.clear();

      this.root?.removeEventListener('click', this._onClick);
      document.removeEventListener('visibilitychange', this._onVisibility);
      if (this._media?.removeEventListener) this._media.removeEventListener('change', this._onMedia);
      else if (this._media?.removeListener) this._media.removeListener(this._onMedia);

      if (this.audioCtx) {
        try { this.audioCtx.close(); } catch (_) {}
        this.audioCtx = null;
      }
      if (this.root?.parentNode === this.container) this.container.removeChild(this.root);
      this.root = null;
    }
  }

  window.WSSArcade = {
    mount(containerEl, options) {
      return new Arcade(containerEl, options);
    }
  };
})();
`;
