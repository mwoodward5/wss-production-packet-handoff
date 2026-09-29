"use strict";

/**
 * The Ledger, retitled "Results" (2026-08-16 plain-words pass).
 *
 * One protected read (/api/admin/ledger-data), measured records only. The
 * plain-words rules: the owner is a layman, so every metric label passes
 * through the shared voice (lib/operator-voice.js explain(), mirrored
 * client-side), every headline number is big, and each headline metric
 * carries a one-line "what this means" built from the definitions the page
 * already holds — absent definitions omit the line, nothing is invented.
 */

const { operatorNav } = require("./operator-nav");
const { PLAIN: VOICE_PLAIN, STATUS: VOICE_STATUS } = require("./operator-voice");

module.exports = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Results · WSS Labs</title>
  <style>
    :root {
      --void: #08080B;
      --carbon: #131318;
      --carbon-raised: #17171C;
      --ice: #F2F2F5;
      --slate: #9B9AA4;
      --graphite: #6F6E79;
      --hair: rgba(255,255,255,.07);
      --signal: linear-gradient(135deg,#4A6CF7,#8B5CF6);
      --violet: #7C6CF6;
      --blue: #4A6CF7;
      --green: #34D399;
      --sky: #6E8BFF;
      --ember: #E0A44A;
      --rose: #F26D6D;
      --sans: "Hanken Grotesk", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --mono: "IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    }
    * { box-sizing: border-box; }
    html { min-width: 0; background: var(--void); }
    body {
      margin: 0;
      min-width: 0;
      min-height: 100vh;
      overflow-x: hidden;
      color: var(--ice);
      background:
        radial-gradient(900px 420px at 50% -170px, rgba(124,108,246,.16), transparent 68%),
        var(--void);
      font-family: var(--sans);
      -webkit-font-smoothing: antialiased;
    }
    button, input { font: inherit; }
    button { color: inherit; }
    button:focus-visible, input:focus-visible, [tabindex]:focus-visible {
      outline: 2px solid #9E90FF;
      outline-offset: 3px;
    }
    [hidden] { display: none !important; }
    ::selection { background: rgba(124,108,246,.34); }
    .shell {
      width: min(1200px, calc(100% - 52px));
      margin: 0 auto;
      padding: 32px 0 64px;
    }
    .stack { display: flex; min-width: 0; flex-direction: column; gap: 16px; }
    .topbar {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      min-width: 0;
    }
    .identity { display: flex; min-width: 0; align-items: center; gap: 13px; }
    .mark { flex: none; width: 44px; height: 44px; filter: drop-shadow(0 7px 18px rgba(124,108,246,.24)); }
    .eyebrow {
      color: var(--graphite);
      font: 500 11px/1.2 var(--mono);
      letter-spacing: .2em;
      text-transform: uppercase;
    }
    h1 { margin: 5px 0 0; font-size: 28px; line-height: 1.05; letter-spacing: -.02em; }
    .actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; flex-wrap: wrap; }
    .pill, .button, .range {
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 999px;
      background: #15151A;
    }
    .pill { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 6px 11px; }
    .pill-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ember); box-shadow: 0 0 8px rgba(224,164,74,.54); }
    .pill[data-tone="good"] .pill-dot { background: var(--green); box-shadow: 0 0 8px rgba(52,211,153,.68); }
    .pill-text { color: #C7C6CF; font-size: 12px; font-weight: 600; }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      padding: 7px 13px;
      cursor: pointer;
      color: #E7E7EA;
      font-size: 13px;
      font-weight: 650;
      transition: border-color .18s ease, background .18s ease, transform .18s ease;
    }
    .button:hover { border-color: rgba(124,108,246,.56); background: #1A1922; }
    .button:active { transform: translateY(1px); }
    .button[disabled] { cursor: wait; opacity: .58; }
    .button.primary { border-color: rgba(124,108,246,.4); background: rgba(124,108,246,.15); }
    .lede { margin: 0; color: var(--slate); font-size: 14px; line-height: 1.5; }
    .lede strong { color: var(--ice); font-weight: 650; }
    .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
    .muted { color: var(--graphite); }
    .panel {
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--hair);
      border-radius: 16px;
      background: var(--carbon);
      padding: 20px;
    }
    .panel-title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
    .panel-title { margin: 0; color: var(--ice); font-size: 16px; font-weight: 650; }
    .panel-note { color: var(--graphite); font: 11px/1.35 var(--mono); }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(178px,1fr)); gap: 12px; }
    .kpi {
      position: relative;
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--hair);
      border-radius: 16px;
      background: var(--carbon);
      padding: 18px;
    }
    .kpi::after {
      position: absolute;
      content: "";
      width: 145px;
      height: 105px;
      top: -36px;
      right: -30px;
      background: radial-gradient(circle, rgba(124,108,246,.18), transparent 68%);
      pointer-events: none;
    }
    .kpi-label { position: relative; z-index: 1; color: var(--graphite); font: 11px/1.2 var(--mono); letter-spacing: .06em; text-transform: uppercase; }
    .kpi-value { position: relative; z-index: 1; margin-top: 12px; color: #F4F4F6; font-size: 30px; font-weight: 720; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    /* The one-line "what this means" under a headline number. Fresh class
       name so the shared nav readability floor cannot shrink it away. */
    .kpi-plain { position: relative; z-index: 1; margin-top: 7px; color: #B9B8C2; font-size: 15px; line-height: 1.45; }
    .kpi-sub { position: relative; z-index: 1; margin-top: 4px; color: #84838E; font-size: 12px; }
    .split { display: grid; min-width: 0; grid-template-columns: minmax(0,1.02fr) minmax(0,1.5fr); gap: 14px; }
    .funnel { display: flex; flex-direction: column; gap: 15px; margin-top: 20px; }
    .funnel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 6px; }
    .funnel-name { color: #E7E7EA; font-size: 13px; font-weight: 650; text-transform: capitalize; }
    .funnel-value { color: var(--ice); font: 600 13px/1 var(--mono); }
    .funnel-track { height: 26px; overflow: hidden; border-radius: 7px; background: rgba(255,255,255,.06); }
    .funnel-fill { height: 100%; min-width: 3px; border-radius: 7px; background: linear-gradient(90deg,#0E6B52,#34D399); }
    .funnel-rate { margin-top: 6px; color: #7C7B86; font: 11px/1.3 var(--mono); }
    .range { display: inline-flex; padding: 3px; background: rgba(255,255,255,.05); }
    .range button {
      border: 0;
      border-radius: 999px;
      background: transparent;
      padding: 6px 12px;
      cursor: pointer;
      color: #898894;
      font: 600 12px/1 var(--mono);
    }
    .range button[aria-pressed="true"] { color: #fff; background: var(--signal); box-shadow: 0 3px 12px rgba(74,108,247,.2); }
    .chart-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .chart-legend { display: flex; align-items: center; gap: 14px; min-height: 21px; margin-top: 13px; flex-wrap: wrap; }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; color: #84838E; font: 11px/1 var(--mono); }
    .legend-swatch { width: 10px; height: 10px; border-radius: 3px; }
    .chart-wrap { min-height: 250px; margin-top: 8px; }
    #trendChart { display: block; width: 100%; height: 250px; overflow: visible; }
    .chart-empty { display: grid; min-height: 230px; place-items: center; color: var(--graphite); font-size: 13px; text-align: center; }
    .table-scroll { width: 100%; min-width: 0; overflow-x: auto; overscroll-behavior-inline: contain; }
    table { width: 100%; min-width: 790px; border-collapse: collapse; }
    thead th {
      padding: 11px 8px;
      border-bottom: 1px solid rgba(255,255,255,.06);
      color: #5F5E68;
      font: 500 10.5px/1.3 var(--mono);
      letter-spacing: .05em;
      text-align: left;
      text-transform: uppercase;
    }
    tbody td { padding: 13px 8px; border-bottom: 1px solid rgba(255,255,255,.045); color: #C9C8D0; font-size: 12px; vertical-align: middle; }
    .campaign-button {
      display: flex;
      width: 100%;
      min-width: 0;
      align-items: center;
      gap: 10px;
      border: 0;
      background: transparent;
      padding: 0;
      cursor: pointer;
      color: inherit;
      text-align: left;
    }
    .avatar { display: grid; flex: none; width: 34px; height: 34px; place-items: center; border-radius: 9px; background: rgba(124,108,246,.16); color: #B7ACFF; font-size: 12px; font-weight: 720; }
    .campaign-copy { min-width: 0; }
    .campaign-name { overflow: hidden; color: #ECECEF; font-size: 13.5px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .campaign-source { overflow: hidden; margin-top: 2px; color: #7C7B86; font: 11px/1.3 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
    .status-chip { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; background: rgba(124,108,246,.14); padding: 4px 9px; color: #B0A4FF; font-size: 11px; font-weight: 650; }
    .status-chip::before { width: 6px; height: 6px; border-radius: 50%; background: var(--violet); content: ""; }
    .metric-cell { min-width: 92px; color: #ECECEF; font: 12px/1.3 var(--mono); }
    .metric-bar { width: 100%; height: 6px; margin-top: 5px; overflow: hidden; border-radius: 4px; background: rgba(255,255,255,.06); }
    .metric-bar span { display: block; height: 100%; border-radius: inherit; background: var(--green); }
    .metric-cell.click .metric-bar span { background: var(--violet); }
    .detail-row td { padding: 2px 8px 12px; }
    .detail-card { border: 1px solid rgba(255,255,255,.06); border-radius: 12px; background: rgba(255,255,255,.025); padding: 14px 16px; }
    .detail-summary { display: flex; gap: 8px; flex-wrap: wrap; }
    .detail-stat { min-width: 82px; border: 1px solid rgba(255,255,255,.07); border-radius: 9px; background: var(--carbon-raised); padding: 8px 12px; }
    .detail-label { color: var(--graphite); font: 10px/1.2 var(--mono); letter-spacing: .05em; text-transform: uppercase; }
    .detail-value { margin-top: 3px; color: #ECECEF; font-size: 16px; font-weight: 650; }
    .event-list { display: flex; flex-direction: column; margin-top: 12px; }
    .event { display: grid; grid-template-columns: 84px minmax(0,1fr) auto; gap: 12px; align-items: baseline; padding: 9px 2px; border-top: 1px solid rgba(255,255,255,.05); }
    .event-stage { color: #A99DFF; font: 600 11px/1.3 var(--mono); text-transform: uppercase; }
    .event-label { min-width: 0; color: #C9C8D0; font-size: 12.5px; }
    .event-time { color: #666570; font: 11px/1.3 var(--mono); white-space: nowrap; }
    .bottom-grid { display: grid; min-width: 0; grid-template-columns: minmax(0,1.5fr) minmax(260px,1fr); gap: 14px; }
    .activity-list { display: flex; flex-direction: column; margin-top: 12px; }
    .activity-item { display: grid; grid-template-columns: 28px minmax(0,1fr) auto; gap: 12px; align-items: center; padding: 9px 4px; border-bottom: 1px solid rgba(255,255,255,.045); }
    .activity-icon { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 8px; background: rgba(124,108,246,.14); color: #B7ACFF; font: 650 11px/1 var(--mono); }
    .activity-copy { min-width: 0; overflow: hidden; color: #ECECEF; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .activity-copy span { color: #84838E; }
    .source-panel { position: relative; border-color: rgba(52,211,153,.2); }
    .source-panel::after { position: absolute; width: 180px; height: 120px; top: -44px; right: -36px; border-radius: 50%; background: radial-gradient(circle,rgba(52,211,153,.14),transparent 68%); content: ""; pointer-events: none; }
    .source-list { position: relative; z-index: 1; display: flex; flex-direction: column; margin-top: 13px; }
    .source-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
    .source-row-label { display: flex; align-items: center; gap: 9px; color: #C9C8D0; font-size: 13px; }
    .source-row-label::before { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--green); content: ""; }
    .source-value { color: #ECECEF; font: 500 11px/1.3 var(--mono); text-align: right; }
    .coverage { position: relative; z-index: 1; margin: 14px 0 0; color: var(--graphite); font-size: 11.5px; line-height: 1.55; }
    .warning-list { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 7px; margin-top: 12px; }
    .warning { border-left: 2px solid var(--ember); padding-left: 10px; color: #AAA9B2; font-size: 11.5px; line-height: 1.45; }
    .empty-state { display: grid; min-height: 180px; place-items: center; border: 1px dashed rgba(255,255,255,.12); border-radius: 16px; background: rgba(19,19,24,.72); padding: 30px; color: var(--slate); text-align: center; }
    .empty-state strong { display: block; margin-bottom: 7px; color: var(--ice); font-size: 17px; }
    .state-line { min-height: 18px; color: var(--graphite); font: 11px/1.4 var(--mono); }
    .access-gate {
      position: fixed;
      z-index: 20;
      inset: 0;
      display: grid;
      place-items: center;
      overflow-y: auto;
      background: rgba(8,8,11,.92);
      backdrop-filter: blur(14px);
      padding: 24px;
    }
    .access-card { width: min(430px,100%); border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: #111116; padding: 24px; box-shadow: 0 30px 90px rgba(0,0,0,.48); }
    .access-mark { width: 42px; height: 42px; }
    .access-card h2 { margin: 16px 0 6px; font-size: 22px; }
    .access-card p { margin: 0; color: var(--slate); font-size: 13px; line-height: 1.55; }
    .access-form { display: grid; gap: 10px; margin-top: 18px; }
    .access-form label { color: #C9C8D0; font: 11px/1.2 var(--mono); letter-spacing: .05em; text-transform: uppercase; }
    .access-form input { width: 100%; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: #08080B; padding: 11px 12px; color: var(--ice); }
    .access-status { min-height: 19px; color: var(--rose); font-size: 12px; }
    @media (max-width: 800px) {
      .split, .bottom-grid { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; }
    }
    @media (max-width: 540px) {
      .shell { width: min(100% - 28px,1200px); padding: 20px 0 42px; }
      .topbar { flex-direction: column; gap: 16px; }
      .actions { width: 100%; justify-content: flex-start; }
      .mark { width: 40px; height: 40px; }
      h1 { font-size: 24px; }
      .panel, .kpi { padding: 15px; }
      .kpi-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
      .kpi-value { font-size: 25px; }
      .chart-head { align-items: flex-start; flex-direction: column; }
      .event { grid-template-columns: 75px minmax(0,1fr); }
      .event-time { grid-column: 2; }
      .activity-item { grid-template-columns: 28px minmax(0,1fr); }
      .activity-item .event-time { grid-column: 2; }
    }
    @media (max-width: 410px) {
      .kpi-grid { grid-template-columns: 1fr; }
      .button { flex: 1 1 auto; }
      .range { width: 100%; }
      .range button { flex: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .001ms !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
    }
  </style>
</head>
<body>
  ${operatorNav("ledger")}
  <main id="ledgerShell" class="shell" data-state="locked">
    <div class="stack">
      <header class="topbar">
        <div class="identity">
          <svg class="mark" aria-label="WSS Labs" role="img" viewBox="0 0 64 64">
            <defs><linearGradient id="wssSignal" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6CF7"></stop><stop offset="1" stop-color="#8B5CF6"></stop></linearGradient></defs>
            <rect width="64" height="64" rx="15" fill="#131318"></rect><rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#fff" stroke-opacity=".09"></rect><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#wssSignal)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="7" fill="#34D399" opacity=".22"></circle><circle cx="50" cy="20" r="4" fill="#34D399"></circle>
          </svg>
          <div>
            <div class="eyebrow">Command Center · Results</div>
            <h1>Results</h1>
          </div>
        </div>
        <div class="actions">
          <div id="sourcePill" class="pill"><span class="pill-dot" aria-hidden="true"></span><span id="sourcePillText" class="pill-text">Access required</span></div>
          <button id="refreshButton" class="button" type="button">Refresh</button>
          <button id="exportButton" class="button primary" type="button" disabled>Export CSV</button>
        </div>
      </header>

      <p class="lede">Every send, open, and click — tracked and reconciled. <strong id="headline">Measured records only.</strong></p>
      <div id="dataState" class="state-line" role="status" aria-live="polite">Enter your access code to load the results.</div>

      <section id="ledgerContent" class="stack" hidden>
        <div id="kpiGrid" class="kpi-grid" aria-label="Campaign totals"></div>

        <div class="split">
          <section class="panel" aria-labelledby="funnelTitle">
            <div class="panel-title-row"><h2 id="funnelTitle" class="panel-title">From send to reply</h2><span class="panel-note">Sent → Replied</span></div>
            <div id="funnelList" class="funnel"></div>
          </section>
          <section class="panel" aria-labelledby="trendTitle">
            <div class="chart-head">
              <h2 id="trendTitle" class="panel-title">Opens and clicks over time</h2>
              <div id="chartRange" class="range" role="group" aria-label="Chart time range">
                <button type="button" data-days="7" aria-pressed="false">7d</button>
                <button type="button" data-days="30" aria-pressed="true">30d</button>
                <button type="button" data-days="90" aria-pressed="false">90d</button>
              </div>
            </div>
            <div id="chartLegend" class="chart-legend"></div>
            <div class="chart-wrap"><svg id="trendChart" role="img" aria-label="Recorded campaign events over time" viewBox="0 0 720 250" preserveAspectRatio="none"></svg><div id="chartEmpty" class="chart-empty" hidden>Nothing has happened yet — the lines appear after the first sends.</div></div>
          </section>
        </div>

        <section class="panel" aria-labelledby="campaignTitle">
          <div class="panel-title-row"><h2 id="campaignTitle" class="panel-title">Campaigns</h2><span class="panel-note">open a row for recorded events</span></div>
          <div class="table-scroll" tabindex="0" aria-label="Campaign ledger table">
            <table>
              <thead><tr><th>Campaign</th><th>Status</th><th>Open rate</th><th>Click rate</th><th>Replies</th><th>Activity</th><th></th></tr></thead>
              <tbody id="campaignRows"></tbody>
            </table>
          </div>
        </section>

        <div class="bottom-grid">
          <section class="panel" aria-labelledby="activityTitle">
            <div class="panel-title-row"><h2 id="activityTitle" class="panel-title">Recent activity</h2><span class="panel-note">newest first</span></div>
            <div id="activityList" class="activity-list"></div>
          </section>
          <section class="panel source-panel" aria-labelledby="sourceTitle">
            <h2 id="sourceTitle" class="panel-title">Where these numbers come from</h2>
            <div class="source-list">
              <div class="source-row"><span class="source-row-label">Prospect sends</span><span class="source-value">delivery ledger</span></div>
              <div class="source-row"><span class="source-row-label">Opens &amp; clicks</span><span class="source-value">verified Resend events</span></div>
              <div class="source-row"><span class="source-row-label">Replies</span><span class="source-value">inbound reply drafts</span></div>
            </div>
            <p id="sourceCoverage" class="coverage" aria-live="polite">Tracking began with the first reconciled store record.</p>
            <div id="warningList" class="warning-list"></div>
          </section>
        </div>
      </section>

      <section id="emptyState" class="empty-state" hidden>
        <div><strong>Nothing to show yet</strong>No tracked sends yet — this fills as campaigns go out.</div>
      </section>
    </div>
  </main>

  <section id="accessGate" class="access-gate" role="dialog" aria-modal="true" aria-labelledby="accessTitle">
    <div class="access-card">
      <svg class="access-mark" aria-hidden="true" viewBox="0 0 64 64"><defs><linearGradient id="gateSignal" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6CF7"></stop><stop offset="1" stop-color="#8B5CF6"></stop></linearGradient></defs><rect width="64" height="64" rx="15" fill="#131318"></rect><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#gateSignal)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="4" fill="#34D399"></circle></svg>
      <h2 id="accessTitle">Open the Results page</h2>
      <p>The page shell contains no campaign data. Your access code unlocks one protected, read-only snapshot.</p>
      <form id="accessForm" class="access-form">
        <label for="accessToken">Access code</label>
        <input id="accessToken" name="token" type="password" autocomplete="current-password" required>
        <button class="button primary" type="submit">Show me the results</button>
        <div id="accessStatus" class="access-status" aria-live="polite"></div>
      </form>
    </div>
  </section>

  <script>
  (function () {
    "use strict";
    var TOKEN_KEY = "wsl_admin_token";
    var ENDPOINT = "/api/admin/ledger-data";
    var EMPTY_COPY = "No tracked sends yet — this fills as campaigns go out.";
    var COLORS = { sent: "#0E6B52", opened: "#34D399", clicked: "#7C6CF6", replied: "#6E8BFF" };
    var state = { data: null, days: 30, loading: false };
    var shell = document.getElementById("ledgerShell");
    var gate = document.getElementById("accessGate");
    var form = document.getElementById("accessForm");
    var tokenInput = document.getElementById("accessToken");
    var accessStatus = document.getElementById("accessStatus");
    var dataState = document.getElementById("dataState");
    var content = document.getElementById("ledgerContent");
    var empty = document.getElementById("emptyState");
    var refresh = document.getElementById("refreshButton");
    var exportButton = document.getElementById("exportButton");

    function token() { return String(localStorage.getItem(TOKEN_KEY) || "").trim(); }
    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    function element(tag, className, value) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (value !== undefined && value !== null) node.textContent = String(value);
      return node;
    }
    function number(value) { return Number(value || 0).toLocaleString("en-US"); }
    function rate(value) { return value === null || value === undefined ? "—" : Number(value).toFixed(1) + "%"; }
    function when(value) {
      var at = Date.parse(value || "");
      if (!Number.isFinite(at)) return "—";
      var seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
      if (seconds < 60) return "just now";
      if (seconds < 3600) return Math.round(seconds / 60) + "m ago";
      if (seconds < 86400) return Math.round(seconds / 3600) + "h ago";
      return Math.round(seconds / 86400) + "d ago";
    }
    function initials(value) {
      return String(value || "C").split(/\s+/).filter(Boolean).slice(0, 2).map(function (part) { return part.charAt(0); }).join("").toUpperCase() || "C";
    }

    // ---- the shared plain-words voice (lib/operator-voice.js) ---------------
    // Serialised in at render time; explain() is mirrored from the module so
    // a term never reads two ways on two pages.
    var VOICE_PLAIN_TABLE = ${JSON.stringify(VOICE_PLAIN)};
    var VOICE_STATUS_TABLE = ${JSON.stringify(VOICE_STATUS)};
    function voiceNormalize(value) {
      return String(value == null ? "" : value).trim().toLowerCase().replace(/[\s-]+/g, "_");
    }
    function titleCaseWords(value) {
      return String(value == null ? "" : value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b([a-z])/g, function (letter) { return letter.toUpperCase(); });
    }
    function explain(term) {
      var raw = String(term == null ? "" : term).trim();
      if (!raw) return "";
      if (Object.prototype.hasOwnProperty.call(VOICE_PLAIN_TABLE, raw)) return VOICE_PLAIN_TABLE[raw];
      var hit = VOICE_STATUS_TABLE[voiceNormalize(raw)];
      if (hit) return hit[0];
      return titleCaseWords(raw);
    }

    // What each headline number MEANS, in one line, built from the metric
    // definitions this page already carries (the sub captions below each
    // KPI). A label without a definition here simply omits the line —
    // nothing is invented.
    var METRIC_MEANINGS = {
      "Emails sent": "Every email that really went out, counted from the send log.",
      "Open rate": "Of the emails we sent, the share that got opened.",
      "Click rate": "Of the emails we sent, the share where someone clicked a link.",
      "Replies": "Businesses that wrote back to us."
    };
    function setReadyTone(good, copy) {
      var pill = document.getElementById("sourcePill");
      if (good) pill.setAttribute("data-tone", "good"); else pill.removeAttribute("data-tone");
      document.getElementById("sourcePillText").textContent = copy;
    }

    function renderKpis(data) {
      var host = document.getElementById("kpiGrid");
      clear(host);
      var values = [{ label: "Emails sent", value: data.summary.sent || 0, sub: "recorded prospect sends" }];
      if (data.summary.opened !== undefined) values.push({ label: "Open rate", value: rate(data.summary.sent ? data.summary.opened / data.summary.sent * 100 : null), sub: number(data.summary.opened) + " messages opened" });
      if (data.summary.clicked !== undefined) values.push({ label: "Click rate", value: rate(data.summary.sent ? data.summary.clicked / data.summary.sent * 100 : null), sub: number(data.summary.clicked) + " messages clicked" });
      if (data.summary.replied !== undefined) values.push({ label: "Replies", value: number(data.summary.replied), sub: "sent prospects replied" });
      values.forEach(function (item) {
        var card = element("article", "kpi");
        // Every metric label passes through the shared voice first.
        card.appendChild(element("div", "kpi-label", explain(item.label) || item.label));
        card.appendChild(element("div", "kpi-value", item.value));
        var meaning = METRIC_MEANINGS[item.label];
        if (meaning) card.appendChild(element("div", "kpi-plain", "What this means: " + meaning));
        card.appendChild(element("div", "kpi-sub", item.sub));
        host.appendChild(card);
      });
    }

    function renderFunnel(data) {
      var host = document.getElementById("funnelList");
      clear(host);
      (data.funnel || []).forEach(function (item) {
        var row = element("div");
        row.setAttribute("data-stage", item.stage);
        var head = element("div", "funnel-head");
        head.appendChild(element("span", "funnel-name", item.label || item.stage));
        head.appendChild(element("span", "funnel-value", number(item.count)));
        var track = element("div", "funnel-track");
        var fill = element("div", "funnel-fill");
        fill.style.width = Math.max(0, Math.min(100, Number(item.rate || 0))) + "%";
        if (COLORS[item.stage]) fill.style.background = COLORS[item.stage];
        track.appendChild(fill);
        row.appendChild(head);
        row.appendChild(track);
        row.appendChild(element("div", "funnel-rate", item.stage === "sent" ? "recorded audience" : rate(item.rate) + " of recorded sends"));
        host.appendChild(row);
      });
    }

    function svgNode(tag, attrs) {
      var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, String(attrs[key])); });
      return node;
    }
    function dateKey(date) { return date.toISOString().slice(0, 10); }
    function selectedDays(data) {
      var end = new Date(data.generatedAt || Date.now());
      end.setUTCHours(0, 0, 0, 0);
      var start = new Date(end);
      start.setUTCDate(start.getUTCDate() - state.days + 1);
      var began = Date.parse(data.source && data.source.trackingBegan || "");
      if (Number.isFinite(began)) {
        var beganDate = new Date(began);
        beganDate.setUTCHours(0, 0, 0, 0);
        if (beganDate > start) start = beganDate;
      }
      var lookup = new Map((data.series && data.series.days || []).map(function (item) { return [item.date, item]; }));
      var days = [];
      for (var cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        var key = dateKey(cursor);
        days.push(Object.assign({ date: key }, lookup.get(key) || {}));
      }
      return days;
    }
    function renderLegend(stages) {
      var legend = document.getElementById("chartLegend");
      clear(legend);
      stages.forEach(function (stage) {
        var item = element("span", "legend-item");
        var swatch = element("span", "legend-swatch");
        swatch.style.background = COLORS[stage];
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(stage.charAt(0).toUpperCase() + stage.slice(1)));
        legend.appendChild(item);
      });
    }
    function renderChart(data) {
      var svg = document.getElementById("trendChart");
      var emptyChart = document.getElementById("chartEmpty");
      clear(svg);
      var days = selectedDays(data);
      var stages = ["sent", "opened", "clicked", "replied"].filter(function (stage) {
        return days.some(function (item) { return Number(item[stage] || 0) > 0; });
      });
      renderLegend(stages);
      if (!days.length || !stages.length) {
        svg.setAttribute("hidden", "");
        emptyChart.removeAttribute("hidden");
        return;
      }
      svg.removeAttribute("hidden");
      emptyChart.setAttribute("hidden", "");
      var width = 720, height = 250, left = 34, right = 10, top = 14, bottom = 34;
      var usableW = width - left - right, usableH = height - top - bottom;
      var maximum = Math.max(1, ...days.flatMap(function (item) { return stages.map(function (stage) { return Number(item[stage] || 0); }); }));
      [0, .5, 1].forEach(function (portion) {
        var y = top + usableH * portion;
        svg.appendChild(svgNode("line", { x1: left, x2: width - right, y1: y, y2: y, stroke: "rgba(255,255,255,.07)", "stroke-width": 1 }));
      });
      if (days.length >= 8) {
        stages.forEach(function (stage) {
          var points = days.map(function (item, index) {
            var x = left + (days.length === 1 ? usableW / 2 : index * usableW / (days.length - 1));
            var y = top + usableH - Number(item[stage] || 0) / maximum * usableH;
            return { x: x, y: y, value: Number(item[stage] || 0), date: item.date };
          });
          var path = svgNode("path", { d: "M" + points.map(function (point) { return point.x.toFixed(1) + " " + point.y.toFixed(1); }).join(" L "), fill: "none", stroke: COLORS[stage], "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" });
          svg.appendChild(path);
          points.forEach(function (point) {
            var circle = svgNode("circle", { cx: point.x, cy: point.y, r: 2.8, fill: COLORS[stage] });
            var title = svgNode("title");
            title.textContent = point.date + " · " + stage + " " + point.value;
            circle.appendChild(title);
            svg.appendChild(circle);
          });
        });
      } else if (days.length >= 2) {
        var group = usableW / days.length;
        var gap = 2;
        var bar = Math.max(3, Math.min(24, (group - 8) / stages.length - gap));
        days.forEach(function (item, dayIndex) {
          stages.forEach(function (stage, stageIndex) {
            var value = Number(item[stage] || 0);
            var barHeight = value / maximum * usableH;
            var x = left + dayIndex * group + (group - (bar + gap) * stages.length) / 2 + stageIndex * (bar + gap);
            var rect = svgNode("rect", { x: x, y: top + usableH - barHeight, width: bar, height: Math.max(value ? 2 : 0, barHeight), rx: 2, fill: COLORS[stage] });
            var title = svgNode("title");
            title.textContent = item.date + " · " + stage + " " + value;
            rect.appendChild(title);
            svg.appendChild(rect);
          });
        });
      } else {
        var xCenter = left + usableW / 2;
        stages.forEach(function (stage, index) {
          var value = Number(days[0][stage] || 0);
          var barWidth = 42;
          var x = xCenter - stages.length * 24 + index * 48;
          var barHeight = value / maximum * usableH;
          var rect = svgNode("rect", { x: x, y: top + usableH - barHeight, width: barWidth, height: Math.max(2, barHeight), rx: 5, fill: COLORS[stage] });
          var title = svgNode("title");
          title.textContent = days[0].date + " · " + stage + " " + value;
          rect.appendChild(title);
          svg.appendChild(rect);
        });
      }
      var first = svgNode("text", { x: left, y: height - 8, fill: "#5F5E68", "font-size": 10, "font-family": "IBM Plex Mono, monospace" });
      first.textContent = days[0].date;
      svg.appendChild(first);
      var last = svgNode("text", { x: width - right, y: height - 8, fill: "#5F5E68", "font-size": 10, "font-family": "IBM Plex Mono, monospace", "text-anchor": "end" });
      last.textContent = days[days.length - 1].date;
      svg.appendChild(last);
    }

    function appendMetricCell(row, value, className) {
      var cell = element("td", "metric-cell " + className);
      cell.appendChild(document.createTextNode(rate(value)));
      var meter = element("div", "metric-bar");
      var fill = element("span");
      fill.style.width = Math.max(0, Math.min(100, Number(value || 0))) + "%";
      meter.appendChild(fill);
      cell.appendChild(meter);
      row.appendChild(cell);
    }
    function detailStat(label, value) {
      var item = element("div", "detail-stat");
      item.appendChild(element("div", "detail-label", label));
      item.appendChild(element("div", "detail-value", value));
      return item;
    }
    function renderCampaigns(data) {
      var host = document.getElementById("campaignRows");
      clear(host);
      (data.campaigns || []).forEach(function (campaign, index) {
        var row = element("tr");
        row.setAttribute("data-campaign-id", campaign.id);
        var identity = element("td");
        var button = element("button", "campaign-button");
        button.type = "button";
        button.setAttribute("data-action", "toggle-detail");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", "campaign-detail-" + index);
        button.appendChild(element("span", "avatar", initials(campaign.name)));
        var copy = element("span", "campaign-copy");
        copy.appendChild(element("span", "campaign-name", campaign.name));
        copy.appendChild(element("span", "campaign-source", number(campaign.sent) + " sent · " + campaign.source));
        button.appendChild(copy);
        identity.appendChild(button);
        row.appendChild(identity);
        var status = element("td"); status.appendChild(element("span", "status-chip", campaign.status)); row.appendChild(status);
        appendMetricCell(row, campaign.openRate, "open");
        appendMetricCell(row, campaign.clickRate, "click");
        row.appendChild(element("td", "mono", number(campaign.replies)));
        row.appendChild(element("td", "muted", when(campaign.activityAt)));
        row.appendChild(element("td", "mono muted", "⌄"));
        host.appendChild(row);

        var detailRow = element("tr", "detail-row");
        detailRow.id = "campaign-detail-" + index;
        detailRow.setAttribute("data-detail-for", campaign.id);
        detailRow.setAttribute("hidden", "");
        var detailCell = element("td"); detailCell.colSpan = 7;
        var card = element("div", "detail-card");
        var summary = element("div", "detail-summary");
        summary.appendChild(detailStat("Sent", number(campaign.sent)));
        if (campaign.opens !== undefined) summary.appendChild(detailStat("Opened", number(campaign.opens)));
        if (campaign.clicks !== undefined) summary.appendChild(detailStat("Clicked", number(campaign.clicks)));
        summary.appendChild(detailStat("Replied", number(campaign.replies)));
        card.appendChild(summary);
        var list = element("div", "event-list");
        (campaign.events || []).forEach(function (item) {
          var eventRow = element("div", "event");
          eventRow.appendChild(element("span", "event-stage", item.stage));
          eventRow.appendChild(element("span", "event-label", item.label));
          eventRow.appendChild(element("time", "event-time", new Date(item.at).toLocaleString()));
          list.appendChild(eventRow);
        });
        if (!(campaign.events || []).length) list.appendChild(element("div", "coverage", "No events are recorded for this campaign yet."));
        card.appendChild(list);
        detailCell.appendChild(card); detailRow.appendChild(detailCell); host.appendChild(detailRow);

        button.addEventListener("click", function () {
          var open = button.getAttribute("aria-expanded") === "true";
          button.setAttribute("aria-expanded", String(!open));
          if (open) detailRow.setAttribute("hidden", ""); else detailRow.removeAttribute("hidden");
        });
      });
    }

    function renderActivity(data) {
      var host = document.getElementById("activityList");
      clear(host);
      (data.activity || []).forEach(function (item) {
        var row = element("div", "activity-item");
        row.appendChild(element("span", "activity-icon", String(item.stage || "·").charAt(0).toUpperCase()));
        var copy = element("div", "activity-copy");
        copy.appendChild(document.createTextNode(item.campaign + " "));
        copy.appendChild(element("span", "", item.label));
        row.appendChild(copy);
        row.appendChild(element("time", "event-time", when(item.at)));
        host.appendChild(row);
      });
      if (!(data.activity || []).length) host.appendChild(element("div", "coverage", "Activity will appear here after the first send."));
    }

    function renderSource(data) {
      var source = data.source || {};
      document.getElementById("sourceCoverage").textContent = source.trackingStatus || "Tracking starts with the first recorded prospect send.";
      var host = document.getElementById("warningList");
      clear(host);
      (source.warnings || []).forEach(function (warning) { host.appendChild(element("div", "warning", warning)); });
    }

    function render(data) {
      state.data = data;
      var noSends = Boolean(data.empty) || !Number(data.summary && data.summary.sent);
      if (noSends) {
        content.setAttribute("hidden", "");
        empty.removeAttribute("hidden");
        document.getElementById("headline").textContent = EMPTY_COPY;
      } else {
        empty.setAttribute("hidden", "");
        content.removeAttribute("hidden");
        document.getElementById("headline").textContent = number(data.summary.sent) + " recorded sends.";
        renderKpis(data);
        renderFunnel(data);
        renderChart(data);
        renderCampaigns(data);
        renderActivity(data);
        renderSource(data);
      }
      exportButton.disabled = noSends;
      shell.setAttribute("data-state", noSends ? "empty" : "ready");
      dataState.textContent = "Updated " + new Date(data.generatedAt).toLocaleString() + ".";
      setReadyTone(true, noSends ? "Nothing sent yet" : "Up to date");
    }

    async function load() {
      if (state.loading || !token()) return;
      state.loading = true;
      refresh.disabled = true;
      shell.setAttribute("data-state", "loading");
      dataState.textContent = "Loading the recorded numbers…";
      accessStatus.textContent = "";
      try {
        var headers = {};
        headers["x-admin-token"] = token();
        var response = await fetch(ENDPOINT, { headers: headers, cache: "no-store" });
        if (response.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          throw new Error("That access code was not accepted.");
        }
        if (!response.ok) throw new Error(response.status === 413 ? "The ledger is too large to total safely." : "The numbers are temporarily unavailable.");
        var data = await response.json();
        if (!data || data.ok !== true) throw new Error("The server's answer did not look right, so nothing is shown.");
        gate.setAttribute("hidden", "");
        render(data);
      } catch (error) {
        content.setAttribute("hidden", "");
        empty.setAttribute("hidden", "");
        gate.removeAttribute("hidden");
        shell.setAttribute("data-state", "error");
        accessStatus.textContent = error && error.message ? error.message : "The results could not be loaded.";
        dataState.textContent = "Results unavailable.";
        setReadyTone(false, "Could not reach the numbers");
        window.setTimeout(function () { tokenInput.focus(); }, 0);
      } finally {
        state.loading = false;
        refresh.disabled = false;
      }
    }

    function csvCell(value) {
      var cleanValue = String(value == null ? "" : value);
      if (/^\s*[=+@-]/.test(cleanValue)) cleanValue = "'" + cleanValue;
      return '"' + cleanValue.replace(/"/g, '""') + '"';
    }
    function exportCsv() {
      if (!state.data) return;
      var rows = [["Campaign", "Status", "Sent", "Open rate", "Click rate", "Replies", "Last activity"]];
      (state.data.campaigns || []).forEach(function (campaign) {
        rows.push([campaign.name, campaign.status, campaign.sent, rate(campaign.openRate), rate(campaign.clickRate), campaign.replies, campaign.activityAt || ""]);
      });
      var csv = rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "campaign-ledger.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var supplied = String(tokenInput.value || "").trim();
      if (!supplied) { accessStatus.textContent = "Enter the access code."; return; }
      localStorage.setItem(TOKEN_KEY, supplied);
      tokenInput.value = "";
      load();
    });
    refresh.addEventListener("click", load);
    exportButton.addEventListener("click", exportCsv);
    document.getElementById("chartRange").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-days]");
      if (!button || !state.data) return;
      state.days = Number(button.getAttribute("data-days")) || 30;
      document.querySelectorAll("#chartRange button").forEach(function (item) { item.setAttribute("aria-pressed", String(item === button)); });
      renderChart(state.data);
    });

    if (token()) load(); else window.setTimeout(function () { tokenInput.focus(); }, 0);
  }());
  </script>
</body>
</html>`;
