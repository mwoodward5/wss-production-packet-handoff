"use strict";

// Keep the runtime export self-contained. Vercel traces this module into each
// serverless function, while the adjacent JSON/CSS/SVG files remain the
// portable cross-product design handoff.
const typography = {
  display: "Hanken Grotesk",
  ui: "Hanken Grotesk",
  mono: "IBM Plex Mono",
  fallbackUi: "system-ui, sans-serif",
  fallbackMono: "monospace",
  weights: { regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 },
  scale: {
    display: "clamp(34px, 5vw, 58px)",
    section: "16px",
    body: "15px",
    monoCaption: "11px",
  },
};

const emailTokens = {
  background: "#F7F7FA",
  panel: "#FFFFFF",
  ink: "#16151B",
  muted: "#5F5E68",
  line: "rgba(22,21,27,.10)",
  accent: "#4A6CF7",
  accentAlt: "#8B5CF6",
  success: "#0E6B52",
  danger: "#C94C4C",
  footer: "Woodward Software Labs",
};

const reportTokens = {
  background: "#0D0D11",
  panel: "#131318",
  ink: "#F2F2F5",
  muted: "#8C8B96",
  line: "rgba(255,255,255,.08)",
  accent: "#4A6CF7",
  accentAlt: "#8B5CF6",
  success: "#34D399",
  warning: "#E0A44A",
  danger: "#F26D6D",
};

const motion = {
  uiTransitionMs: 180,
  panelRevealMs: 420,
  livePulseMs: 2200,
  heroLoopMaxSeconds: 12,
  reducedMotion: "collapse to instant state changes",
};

const tokensCss = [
  "/* WSS Labs brand tokens v1.0 */",
  ":root {",
  "  --wss-void: #08080B;",
  "  --wss-carbon: #131318;",
  "  --wss-ink: #F2F2F5;",
  "  --wss-slate: #9B9AA4;",
  "  --wss-graphite: #6F6E79;",
  "  --wss-hairline: rgba(255,255,255,.07);",
  "  --wss-violet: #7C6CF6;",
  "  --wss-blue: #4A6CF7;",
  "  --wss-green: #34D399;",
  "  --wss-sky: #6E8BFF;",
  "  --wss-ember: #E0A44A;",
  "  --wss-rose: #F26D6D;",
  "  --wss-grad-signal: linear-gradient(135deg, #4A6CF7 0%, #8B5CF6 100%);",
  "  --wss-grad-pulse: linear-gradient(135deg, #0E6B52 0%, #34D399 100%);",
  "  --wss-font-ui: \"Hanken Grotesk\", system-ui, sans-serif;",
  "  --wss-font-mono: \"IBM Plex Mono\", monospace;",
  "  --wss-shell-bg: radial-gradient(1100px 460px at 50% -160px, rgba(124,108,246,.13), transparent 62%), #08080B;",
  "  --wss-shell-panel: linear-gradient(150deg, rgba(255,255,255,.09), rgba(255,255,255,.028));",
  "  --wss-shell-panel-strong: linear-gradient(150deg, rgba(255,255,255,.12), rgba(255,255,255,.04));",
  "  --wss-shell-focus: 0 0 0 3px rgba(124,108,246,.24), 0 0 0 1px rgba(255,255,255,.08) inset;",
  "  --wss-shell-shadow: 0 24px 70px rgba(0,0,0,.5);",
  "  --wss-email-bg: #F7F7FA;",
  "  --wss-email-ink: #16151B;",
  "  --wss-email-muted: #5F5E68;",
  "  --wss-email-line: rgba(22,21,27,.10);",
  "  --wss-email-link: #4A6CF7;",
  "  --wss-report-bg: #0D0D11;",
  "  --wss-report-ink: #F2F2F5;",
  "  --wss-report-muted: #8C8B96;",
  "  --wss-report-line: rgba(255,255,255,.08);",
  "}",
].join("\n");

const assets = {
  mark: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6CF7"></stop><stop offset="1" stop-color="#8B5CF6"></stop></linearGradient></defs><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#g)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="7" fill="#34D399" opacity="0.22"></circle><circle cx="50" cy="20" r="4" fill="#34D399"></circle></svg>',
  markBare: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6CF7"></stop><stop offset="1" stop-color="#8B5CF6"></stop></linearGradient></defs><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#g)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="7" fill="#34D399" opacity="0.22"></circle><circle cx="50" cy="20" r="4" fill="#34D399"></circle></svg>',
  markMonoBlack: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="#16151B" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="4" fill="#16151B"></circle></svg>',
  markMonoWhite: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="#FFFFFF" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="4" fill="#FFFFFF"></circle></svg>',
  appIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><defs><linearGradient id="t" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8B5CF6"></stop><stop offset="1" stop-color="#4A6CF7"></stop></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#t)"></rect><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="#FFFFFF" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="7" fill="#34D399" opacity="0.3"></circle><circle cx="50" cy="20" r="4" fill="#34D399"></circle></svg>',
};

function fontLinks() {
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">',
  ].join("");
}

function shellStyle(extra = "") {
  return [
    tokensCss,
    ":root{color-scheme:dark;}",
    "a{color:var(--wss-violet);text-decoration:none}",
    "a:hover{text-decoration:underline}",
    "*{box-sizing:border-box}",
    "html,body{margin:0;padding:0}",
    "input,button,select,textarea{font:inherit}",
    "input::placeholder,textarea::placeholder{color:var(--wss-graphite)}",
    "::selection{background:rgba(124,108,246,.32)}",
    "@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}",
    extra,
  ].join("\n");
}

module.exports = {
  assets,
  emailTokens,
  fontLinks,
  motion,
  reportTokens,
  shellStyle,
  typography,
  tokensCss,
};
