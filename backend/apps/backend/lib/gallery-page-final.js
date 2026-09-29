"use strict";

// Final operator-facing polish over the safety-owned Gallery page. The base
// page remains the owner of all actions and send confirmations; this wrapper is
// presentation/language only.
let page = require("./gallery-page");

page = page.replace(/Engine Room/g, "Factory details").replace(/Engine room/g, "Factory details");

const style = `<style id="wss-liquid-glass-gallery">
:root{--gallery-glass-edge:rgba(255,255,255,.145);--gallery-glass-shadow:0 18px 48px rgba(0,0,0,.26),inset 0 1px 0 rgba(255,255,255,.09)}
.controls,.site-card,.skeleton-card,.site,.drawer,.batch-bar,.wss-manage-bar,.wss-action-dialog{backdrop-filter:blur(18px) saturate(145%);-webkit-backdrop-filter:blur(18px) saturate(145%);border-color:var(--gallery-glass-edge)!important;box-shadow:var(--gallery-glass-shadow)!important}
.controls,.site-card,.skeleton-card,.site{background-image:linear-gradient(145deg,rgba(255,255,255,.065),rgba(255,255,255,.018) 42%,rgba(124,108,246,.04))!important}
.tab,.search,.sort,.wss-card-action,.wss-manage-button,.wss-filter-reset,.menu-item,.button,.send-button,.details-button,.action{backdrop-filter:blur(15px) saturate(140%);-webkit-backdrop-filter:blur(15px) saturate(140%);border-color:rgba(255,255,255,.14)!important;box-shadow:0 9px 25px rgba(0,0,0,.20),inset 0 1px 0 rgba(255,255,255,.10);transition:transform .18s ease,filter .18s ease,border-color .18s ease,box-shadow .18s ease}
.wss-card-action,.wss-manage-button,.wss-filter-reset,.menu-item,.button,.send-button,.details-button,.action{background-image:linear-gradient(145deg,rgba(255,255,255,.10),rgba(255,255,255,.022) 48%,rgba(124,108,246,.10))!important}
.wss-card-action:hover,.wss-manage-button:hover:not(:disabled),.wss-filter-reset:hover,.menu-item:hover,.button:hover,.send-button:hover,.details-button:hover,.action:hover{transform:translateY(-1px);filter:brightness(1.07);border-color:rgba(255,255,255,.24)!important;box-shadow:0 13px 30px rgba(0,0,0,.26),inset 0 1px 0 rgba(255,255,255,.16)}
.preview{box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
/* CONTRAST ON GLASS: the glass wash lightens card surfaces, so the secondary
   card text (trade/place line, last-send and pending footnotes) steps up one
   tone to keep its contrast promise over the brighter surface. */
.site-card .metadata,.card-sent,.card-pending{color:#A9A8B2}
.site-card .metadata span+span::before{background:#A9A8B2}
@media(prefers-reduced-motion:reduce){.wss-card-action,.wss-manage-button,.wss-filter-reset,.menu-item,.button,.send-button,.details-button,.action{transition:none!important;transform:none!important}}
</style>`;
if (!page.includes("wss-liquid-glass-gallery")) page = page.replace("</head>", `${style}</head>`);

module.exports = page;
