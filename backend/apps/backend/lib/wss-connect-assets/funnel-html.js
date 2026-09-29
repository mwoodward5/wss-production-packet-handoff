"use strict";

// lib/wss-connect-assets/funnel-html.js — the WSS Connect funnel graphic,
// as markup. Six platform tiles flow into the WSS Connect app tile: the
// closing image of the outreach email ("all your leads in one place").
//
// TWO RULES THIS FILE IS BUILT AROUND:
//
//   1. NO TRADEMARKED LOGO ARTWORK. Each platform is drawn as a simple
//      rounded tile in that platform's recognisable brand colour carrying an
//      initial-letter glyph set in our own type. A blue tile with a lowercase
//      "f" reads as Facebook instantly and is entirely our own drawing; a
//      traced Facebook logo would be someone else's mark inside our asset.
//
//   2. EVERYTHING ELSE IS wss-email-design. The Connect tile, the flow
//      lines, the wordmark and the canvas all come from PALETTE/FONT_STACK —
//      nothing invented off-palette. The platform hexes are the only foreign
//      colours, and they are foreign ON PURPOSE (they are what makes each
//      tile recognisable); none of them lands on a FORBIDDEN_HEX.
//
// The PNG itself is rendered from this markup by ./render-funnel.js and
// committed to public/brand/connect-funnel.png, served first-party from
// ghost.wss-ai.com. Rendered on a TRANSPARENT canvas so the email can place
// it on the page tone or a white card; the ink wordmark assumes a LIGHT
// surface — do not drop this PNG on the dark ink panel.

const brand = require("../../../../packages/wss-brand-system");
const { FONT_STACK, PALETTE, mix } = require("../wss-email-design");

/** Where the rendered PNG is served from once deployed (public/ tree). */
const CONNECT_FUNNEL_URL = "https://ghost.wss-ai.com/brand/connect-funnel.png";

/** Display size the email should render the (retina, @2x) PNG at. */
const CONNECT_FUNNEL_WIDTH = 560;
const CONNECT_FUNNEL_HEIGHT = 424;

/**
 * The six platforms the owner asked for, in reading order. `fill` is the
 * platform's own recognisable brand colour (drawn by us, not their artwork);
 * `glyph` is the initial-letter mark set in our FONT_STACK.
 */
const PLATFORM_TILES = Object.freeze([
  { name: "Facebook", glyph: "f", fill: "#1877F2", glyphColor: "#FFFFFF" },
  { name: "Instagram", glyph: "IG", fill: "#E1306C", glyphColor: "#FFFFFF" },
  { name: "Google", glyph: "G", fill: "#4285F4", glyphColor: "#FFFFFF" },
  { name: "LinkedIn", glyph: "in", fill: "#0A66C2", glyphColor: "#FFFFFF" },
  { name: "Yelp", glyph: "Y", fill: "#D32323", glyphColor: "#FFFFFF" },
  { name: "TikTok", glyph: "T", fill: "#121212", glyphColor: "#FFFFFF" },
]);

// Geometry, all in the 560-wide viewBox. Worked out so the flow lines start
// exactly at each tile's bottom-center and converge on the app tile's mouth.
const TILE_SIZE = 64;
const TILE_RADIUS = 16;
const TILE_Y = 20;
const TILE_GAP = 28;
const TILE_MARGIN = (CONNECT_FUNNEL_WIDTH - PLATFORM_TILES.length * TILE_SIZE - (PLATFORM_TILES.length - 1) * TILE_GAP) / 2;
const APP_TILE = { x: 228, y: 260, size: 104, radius: 26 };
const APP_CENTER_X = APP_TILE.x + APP_TILE.size / 2;
const WORDMARK_Y = APP_TILE.y + APP_TILE.size + 34;

function tileX(index) {
  return TILE_MARGIN + index * (TILE_SIZE + TILE_GAP);
}

function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * One flow line: a cubic from a platform tile's bottom-center down into the
 * app tile's mouth. Outer lines run fainter than inner ones so the bundle
 * reads as a funnel, not a grille.
 */
function flowPath(index) {
  const startX = tileX(index) + TILE_SIZE / 2;
  const startY = TILE_Y + TILE_SIZE + 4;
  const endY = APP_TILE.y - 8;
  const d = `M ${startX} ${startY} C ${startX} ${startY + 88}, ${APP_CENTER_X} ${endY - 74}, ${APP_CENTER_X} ${endY}`;
  const distanceFromCenter = Math.abs(startX - APP_CENTER_X);
  const opacity = (0.5 - (distanceFromCenter / CONNECT_FUNNEL_WIDTH) * 0.55).toFixed(2);
  return `<path d="${d}" fill="none" stroke="${PALETTE.accent}" stroke-width="2.5" stroke-linecap="round" opacity="${opacity}"/>`;
}

function platformTile(tile, index) {
  const x = tileX(index);
  const glyphSize = tile.glyph.length > 1 ? 26 : 32;
  // TikTok's near-black tile needs a hairline so its edge survives on any
  // light surface; the coloured tiles carry their own contrast.
  const outline = tile.fill === "#121212" ? ` stroke="${PALETTE.line}" stroke-width="1"` : "";
  return [
    `<rect x="${x}" y="${TILE_Y}" width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}" fill="${tile.fill}"${outline}/>`,
    `<text x="${x + TILE_SIZE / 2}" y="${TILE_Y + TILE_SIZE / 2}" text-anchor="middle" dominant-baseline="central"`
      + ` font-family="${esc(FONT_STACK)}" font-size="${glyphSize}" font-weight="800" fill="${tile.glyphColor}">${esc(tile.glyph)}</text>`,
    `<title>${esc(tile.name)}</title>`,
  ].join("\n    ");
}

/**
 * The WSS mark, white, drawn from the brand kit's own path (wss-mark-bare
 * geometry, mono-white treatment) — the same mark wss-mark-176.png is
 * rasterized from. Scaled to sit centered in the app tile.
 */
function connectMark() {
  const scale = 1.15;
  const size = 64 * scale;
  const x = APP_CENTER_X - size / 2;
  const y = APP_TILE.y + APP_TILE.size / 2 - size / 2;
  return `<g transform="translate(${x} ${y}) scale(${scale})">
      <path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="#FFFFFF" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="50" cy="20" r="4" fill="#FFFFFF"/>
    </g>`;
}

/** The whole graphic as one self-contained SVG (no external refs). */
function buildConnectFunnelSvg() {
  const tiles = PLATFORM_TILES.map(platformTile).join("\n    ");
  const flows = PLATFORM_TILES.map((_, index) => flowPath(index)).join("\n    ");
  const shelf = mix(PALETTE.accent, PALETTE.ink, 0.45);
  const tileEdge = mix(PALETTE.accent, PALETTE.ink, 0.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CONNECT_FUNNEL_WIDTH}" height="${CONNECT_FUNNEL_HEIGHT}" viewBox="0 0 ${CONNECT_FUNNEL_WIDTH} ${CONNECT_FUNNEL_HEIGHT}" role="img" aria-label="Facebook, Instagram, Google, LinkedIn, Yelp and TikTok leads flowing into the WSS Connect app">
    <defs>
      <linearGradient id="appTile" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${PALETTE.accent}"/>
        <stop offset="1" stop-color="${tileEdge}"/>
      </linearGradient>
    </defs>
    ${flows}
    <ellipse cx="${APP_CENTER_X}" cy="${APP_TILE.y - 4}" rx="72" ry="14" fill="${PALETTE.accent}" opacity="0.10"/>
    ${tiles}
    <rect x="${APP_TILE.x}" y="${APP_TILE.y + 3}" width="${APP_TILE.size}" height="${APP_TILE.size}" rx="${APP_TILE.radius}" fill="${shelf}"/>
    <rect x="${APP_TILE.x}" y="${APP_TILE.y}" width="${APP_TILE.size}" height="${APP_TILE.size}" rx="${APP_TILE.radius}" fill="url(#appTile)"/>
    ${connectMark()}
    <text x="${APP_CENTER_X}" y="${WORDMARK_Y}" text-anchor="middle" font-family="${esc(FONT_STACK)}" font-size="20" font-weight="800" letter-spacing="-0.2" fill="${PALETTE.ink}">WSS Connect</text>
  </svg>`;
}

/**
 * A full renderable page around the SVG. Body is transparent — the renderer
 * screenshots #stage with omitBackground so the PNG keeps its alpha. Tries to
 * load the real brand face (${brand.typography.ui}) from Google Fonts; if the
 * render machine is offline the FONT_STACK's own fallback applies, exactly as
 * it would in a mail client.
 */
function buildConnectFunnelPage() {
  const family = encodeURIComponent(brand.typography.ui);
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${family}:wght@700;800&display=swap">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #stage { width: ${CONNECT_FUNNEL_WIDTH}px; height: ${CONNECT_FUNNEL_HEIGHT}px; }
  #stage svg { display: block; }
</style>
</head><body><div id="stage">${buildConnectFunnelSvg()}</div></body></html>`;
}

module.exports = {
  CONNECT_FUNNEL_HEIGHT,
  CONNECT_FUNNEL_URL,
  CONNECT_FUNNEL_WIDTH,
  PLATFORM_TILES,
  buildConnectFunnelPage,
  buildConnectFunnelSvg,
};
