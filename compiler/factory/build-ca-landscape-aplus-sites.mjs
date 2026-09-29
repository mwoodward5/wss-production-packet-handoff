import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const prospectDir = path.join(__dirname, "proof", "ca-landscape-leadminer-2026-07-05");
const proofRoot = path.join(prospectDir, "preview-sites");
const outRoot = path.join(__dirname, "dist-ca-landscape-sites");
const generatedVideoRoot = path.join(prospectDir, "generated-videos");
const enrichedQueue = path.join(prospectDir, "ca-landscape-build-queue-enriched.json");
const baseQueue = path.join(prospectDir, "ca-landscape-build-queue.json");
const packets = JSON.parse(readFileSync(existsSync(enrichedQueue) ? enrichedQueue : baseQueue, "utf8"));
const polishRules = JSON.parse(readFileSync(path.join(workspaceRoot, "master-glue-kitchen", "polish-rules.json"), "utf8"));

const kitchenStack = {
  handoff: "CODEX_MASTER_HANDOFF.md §4 build loop + §13 signoff",
  glue: [
    "master-glue-kitchen/FIRST_PROMPT_POLISH.md",
    `master-glue-kitchen/polish-rules.json (${polishRules.rules.filter((rule) => rule.unprompted).length} unprompted rules)`,
    "master-glue-kitchen/recipes/content-rescue/logo-horizontal-lockup",
    "master-glue-kitchen/recipes/content-rescue/brand-color-extract",
    "master-glue-kitchen/recipes/layouts/magazine-spread",
    "master-glue-kitchen/recipes/layouts/hero-video-bg",
    "master-glue-kitchen/recipes/local-seo/*",
    "master-glue-kitchen/recipes/social-preview/og-dynamic-generator",
  ],
  fx: [
    "razzle-fx-kitchen/recipes/media/hero-video-loop",
    "razzle-fx-kitchen/recipes/media/liquid-mask",
    "razzle-fx-kitchen/recipes/media/broken-grid-photos",
    "razzle-fx-kitchen/recipes/backgrounds/topographic-lines",
    "razzle-fx-kitchen/recipes/backgrounds/granite-flake",
    "razzle-fx-kitchen/recipes/backgrounds/paper-fiber",
    "razzle-fx-kitchen/recipes/motion/cascade-cards",
  ],
  superpowers: [
    "site-superpowers-kitchen/recipes/media/video-hero-loop",
    "site-superpowers-kitchen/recipes/data/json-export",
    "site-superpowers-kitchen/recipes/backend/health-check",
    "site-superpowers-kitchen/recipes/backend/llms-txt",
  ],
  source: "Firecrawl enrichment runs server-side only; static previews never receive API keys.",
};

const fallbackImagesByTheme = {
  estate: [
    "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1589923188900-85dae523342b?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1598902108854-10e335adac99?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1800&q=88",
  ],
  architect: [
    "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1598902108854-10e335adac99?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1800&q=88",
  ],
  warm: [
    "https://images.unsplash.com/photo-1599685315640-3b80863c4c26?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1598902108854-10e335adac99?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1601001815894-4bb6c81416d7?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=1800&q=88",
  ],
  coastal: [
    "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600573472591-ee6981cf35e5?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1589923188900-85dae523342b?auto=format&fit=crop&w=1800&q=88",
  ],
  stone: [
    "https://images.unsplash.com/photo-1598902108854-10e335adac99?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600573472556-e636c2acda4f?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1589923188900-85dae523342b?auto=format&fit=crop&w=1800&q=88",
    "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1800&q=88",
  ],
};

const nearbyCitiesByCity = {
  Clovis: ["Fresno", "Sanger", "Madera Ranchos", "Friant"],
  "Los Angeles": ["West Adams", "Mid-City", "Beverly Grove", "Culver City"],
  Sacramento: ["East Sacramento", "Arden-Arcade", "Carmichael", "Rosemont"],
  "Mission Viejo": ["Lake Forest", "Laguna Hills", "Rancho Santa Margarita", "Aliso Viejo"],
  Orange: ["Anaheim Hills", "Villa Park", "Tustin", "Santa Ana"],
};

const specs = [
  {
    match: "Landscape Connection, Inc.",
    theme: "estate",
    heroModel: "split-editorial",
    sectionPattern: ["story", "trust-ledger", "service-map", "journal"],
    blueprint: "Estate Editorial",
    display: "Cormorant Garamond",
    body: "Manrope",
    bg: "#f7f0de",
    ink: "#162114",
    muted: "#64725b",
    panel: "#fffaf0",
    accent: "#87be49",
    accent2: "#935734",
    soft: "#e8d7b6",
    kicker: "Clovis estate gardens",
    headline: "Garden care with a composed first impression.",
    subhead: "A refined web presence for planting, estate maintenance, irrigation checks, and commercial grounds that need to feel steady before the first walkthrough.",
    services: ["Estate maintenance", "Planting refresh", "Commercial grounds", "Irrigation checks", "Seasonal color"],
    signature: "A botanical editorial layout with a crest lockup, arched media, topographic garden lines, and quiet luxury spacing.",
  },
  {
    match: "AJP LANDSCAPE INC",
    theme: "architect",
    heroModel: "service-map",
    sectionPattern: ["configurator", "zigzag", "service-map", "process-timeline"],
    blueprint: "Architect Grid",
    display: "Space Grotesk",
    body: "IBM Plex Sans",
    bg: "#eef2e7",
    ink: "#101511",
    muted: "#5b665b",
    panel: "#fbfff7",
    accent: "#5ed598",
    accent2: "#fb7d33",
    soft: "#d9eadb",
    kicker: "LA design-build crew",
    headline: "Outdoor plans that look intentional from the street.",
    subhead: "A sharper Los Angeles site for planting, hardscape, lighting, and outdoor upgrades, arranged like a plan set instead of a service flyer.",
    services: ["Design-build", "Hardscape layout", "Lighting upgrades", "Planting plan", "Outdoor repairs"],
    signature: "A blueprint board with angled plan sheets, grid labels, motion strips, and city-yard utility.",
  },
  {
    match: "Barriga Landscaping",
    theme: "warm",
    heroModel: "magazine-letter",
    sectionPattern: ["journal", "configurator", "trust-ledger", "faq-speakable"],
    blueprint: "Sunlit Neighborhood Letter",
    display: "Fraunces",
    body: "Nunito Sans",
    bg: "#fff1d7",
    ink: "#2c1c10",
    muted: "#755b3d",
    panel: "#fffaf0",
    accent: "#ef7b45",
    accent2: "#78a75f",
    soft: "#f7ca70",
    kicker: "Sacramento yard care",
    headline: "Easy yard help with a neighborly touch.",
    subhead: "A warm mobile-first site for lawn care, sprinklers, cleanup visits, planting help, and simple maintenance without making the owner decode a complicated quote process.",
    services: ["Lawn care", "Sprinkler check", "Cleanup visit", "Planting help", "Small repairs"],
    signature: "A sunlit paper-collage layout with tactile note cards, friendly stamps, and rounded garden photography.",
  },
  {
    match: "Signature Landscape",
    theme: "coastal",
    heroModel: "atlas-grid",
    sectionPattern: ["story", "before-after", "service-map", "project-index"],
    blueprint: "Coastal Atlas",
    display: "Newsreader",
    body: "DM Sans",
    bg: "#edf8f7",
    ink: "#09242b",
    muted: "#5f7678",
    panel: "#fbfffd",
    accent: "#0074db",
    accent2: "#dba34b",
    soft: "#bce8e4",
    kicker: "Mission Viejo outdoor rooms",
    headline: "Outdoor spaces with light, air, and a real gallery.",
    subhead: "A coastal-style rebuild for hardscaping, garden refreshes, patios, and project photos that should breathe instead of hiding inside a template.",
    services: ["Outdoor rooms", "Hardscape", "Garden refresh", "Project gallery", "House exterior flow"],
    signature: "An airy atlas with a wide cinematic ribbon, coastal contour lines, and image-led trust blocks.",
  },
  {
    match: "Richard Diaz Landscape",
    theme: "stone",
    heroModel: "material-lab",
    sectionPattern: ["swatch-lab", "zigzag", "process-timeline", "contact-strip"],
    blueprint: "Stone Material Lab",
    display: "Bricolage Grotesque",
    body: "Source Sans 3",
    bg: "#130f0b",
    ink: "#fff0dc",
    muted: "#c8ae87",
    panel: "#21170f",
    accent: "#f6821f",
    accent2: "#fbad41",
    soft: "#3f2a19",
    kicker: "Orange hardscape + masonry",
    headline: "Masonry, planting, grading, and outdoor structure.",
    subhead: "A rugged but polished web presence for patios, retaining walls, paver repair, planting, cleanup, and hardscape work that needs to feel built, not generic.",
    services: ["Masonry", "Paver repair", "Retaining walls", "Patios", "Planting + grading"],
    signature: "A stone material lab with diagonal slabs, masonry texture, source logo recovery, and grounded call-to-estimate rhythm.",
  },
];

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function slugify(value = "") {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 52) || "site";
}

function projectName(packet) {
  return `wss-ca-landscape-${slugify(packet.business.name)}`.slice(0, 63);
}

function phoneHref(phone = "") {
  const digits = phone.replace(/[^0-9+]/g, "");
  return digits ? `tel:${digits}` : "#quote";
}

function smsHref(phone = "") {
  const digits = phone.replace(/[^0-9+]/g, "");
  return digits ? `sms:${digits}` : "#quote";
}

function specFor(packet, index) {
  return specs.find((spec) => spec.match === packet.business.name) || specs[index % specs.length];
}

function laneFor(index) {
  return index < 3 ? "single-page-cinematic" : "premier-multi-page";
}

function mapProfile(packet) {
  const city = packet.business.city || "California";
  const address = packet.business.address || `${packet.business.name}, ${city}, CA`;
  const encoded = encodeURIComponent(address);
  const cities = [city, ...(nearbyCitiesByCity[city] || [])].slice(0, 5);
  return {
    address,
    cities,
    embed: `https://maps.google.com/maps?q=${encoded}&t=k&z=14&output=embed`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${encoded}`,
    maps: packet.business.googleMaps || `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  };
}

function cleanImageUrl(url = "") {
  return String(url || "").trim();
}

function isBadLogo(url = "", context = "") {
  const hay = `${url} ${context}`.toLowerCase();
  return !/^https?:/i.test(url)
    || /wix-public|favicon\.ico|widget-|stylesheet|\.css(\?|$)|yelp|reviews-img|social-icons|icon-list|avatar|rosemary-f/i.test(hay);
}

function isBadPhoto(url = "", context = "") {
  const hay = `${url} ${context}`.toLowerCase();
  const width = Number(context.match(/\bwidth=["']?(\d+)/i)?.[1] || 0);
  const height = Number(context.match(/\bheight=["']?(\d+)/i)?.[1] || 0);
  const tinyExplicit = (width && width < 300) || (height && height < 220);
  return !/^https?:/i.test(url)
    || /\.(ico|svg|css|js|pdf|woff2?)(\?|$)/i.test(url)
    || /logo|favicon|yelp|reviews-img|avatar|headshot|rosemary-f|widget-|social-icons|icon-list|kitchen/i.test(hay)
    || tinyExplicit;
}

function logoFor(packet) {
  return (packet.source.logoCandidates || []).find((item) => !isBadLogo(item.url, item.context))?.url || "";
}

function imagesFor(packet, spec) {
  const sourceImages = [
    ...(packet.source.imageCandidates || []),
    ...(packet.source.selectedImages || []).map((url) => ({ url, context: "curated fallback" })),
  ]
    .map((item) => ({ url: cleanImageUrl(item.url || item), context: item.context || "" }))
    .filter((item) => !isBadPhoto(item.url, item.context));
  const fallbacks = (fallbackImagesByTheme[spec.theme] || fallbackImagesByTheme.estate).map((url) => ({ url, context: "premium fallback" }));
  const seen = new Set();
  return [...sourceImages, ...fallbacks].filter((item) => {
    const key = item.url.replace(/\?.*$/, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 9).map((item) => item.url);
}

function fontImport(spec) {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(spec.display)}:wght@500;600;700;800&family=${encodeURIComponent(spec.body)}:wght@400;500;600;700;800&display=swap`;
}

function videoAssetFor(dir, packet, spec, images) {
  const project = projectName(packet);
  const assets = path.join(dir, "assets");
  mkdirSync(assets, { recursive: true });
  const source = path.join(generatedVideoRoot, `${project}.mp4`);
  const target = path.join(assets, "hero-video.mp4");
  const prompt = [
    `Create an 8 second premium local-business website hero loop for ${packet.business.name} in ${packet.business.city}, California.`,
    `Direction: ${spec.blueprint}; ${spec.signature}`,
    "Natural light, outdoor craft, real materials, no visible text, no artificial logos, no talking people.",
    `Palette cue: ${spec.accent}, ${spec.accent2}, ${spec.bg}.`,
  ].join(" ");
  writeFileSync(path.join(assets, "hero-video-request.json"), JSON.stringify({
    provider: "Google Gemini / Veo generation, already generated when status is ready",
    status: existsSync(source) ? "ready" : "needs_generation",
    prompt,
    outputPath: target,
  }, null, 2));
  if (existsSync(source)) {
    copyFileSync(source, target);
    return { ready: true, src: "/assets/hero-video.mp4", prompt };
  }
  return { ready: false, src: images[0], prompt };
}

function markSvg(spec) {
  if (spec.theme === "architect") return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 12h44v40H10zM22 12v40M42 12v40M10 30h44" fill="none" stroke="currentColor" stroke-width="4"/><path d="m16 47 31-30" stroke="currentColor" stroke-width="3"/></svg>`;
  if (spec.theme === "warm") return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 10c11 10 16 19 16 28 0 10-7 16-16 16S16 48 16 38c0-9 5-18 16-28Z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M32 22v26M24 39c8-2 13-8 18-16" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
  if (spec.theme === "coastal") return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M9 39c10-13 19-13 29 0 6 7 11 7 17 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M17 25c11-8 22-8 31 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
  if (spec.theme === "stone") return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 18 32 8l20 10v27L32 56 12 45V18Z" fill="none" stroke="currentColor" stroke-width="4"/><path d="m12 18 20 11 20-11M32 29v27" stroke="currentColor" stroke-width="3"/></svg>`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M11 48c20-3 35-17 44-40" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M17 36c13 2 24-4 33-18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
}

function brand(packet, spec, logoUrl) {
  const legalName = packet.business.name.replace(/\s+(inc|llc|corp|corporation)\.?$/i, "");
  const lockup = logoUrl
    ? `<span class="brand-logo sourced"><img src="${esc(logoUrl)}" alt="${esc(packet.business.name)} logo"></span>`
    : `<span class="brand-logo proposed">${markSvg(spec)}</span>`;
  return `<a class="brand" href="/" aria-label="${esc(packet.business.name)} home">${lockup}<span><b>${esc(legalName)}</b><em>${esc(spec.kicker)}</em></span></a>`;
}

function head(packet, spec, routeTitle, description) {
  const canonical = `https://${projectName(packet)}.vercel.app/`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(routeTitle)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="noindex,nofollow">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${esc(routeTitle)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${canonical}og.svg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="${spec.bg}">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${fontImport(spec)}" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <script src="/site.js" defer></script>
</head>`;
}

function css(spec) {
  const dark = spec.theme === "stone" || spec.theme === "architect";
  return `:root{--bg:${spec.bg};--ink:${spec.ink};--muted:${spec.muted};--panel:${spec.panel};--accent:${spec.accent};--accent-2:${spec.accent2};--soft:${spec.soft};--display:"${spec.display}",serif;--body:"${spec.body}",sans-serif;--line:color-mix(in oklab,var(--ink) 14%,transparent);--shadow:0 26px 80px color-mix(in oklab,var(--ink) 16%,transparent);--ease:cubic-bezier(.2,.72,.18,1)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);font-synthesis:none;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;overflow-x:hidden}a{color:inherit;text-decoration:none}img,video{display:block;max-width:100%}button,input,select,textarea{font:inherit;letter-spacing:0}.shell{width:min(1200px,calc(100% - 40px));margin-inline:auto}.skip{position:fixed;top:12px;left:12px;z-index:99;transform:translateY(-150%);padding:10px 14px;background:var(--ink);color:var(--bg);border-radius:999px}.skip:focus{transform:translateY(0)}:focus-visible{outline:3px solid var(--accent);outline-offset:4px}.site{position:relative;min-height:100vh;isolation:isolate}.texture{position:fixed;inset:0;z-index:-4;pointer-events:none;opacity:${dark ? ".24" : ".32"};background-image:radial-gradient(circle at 18% 14%,color-mix(in oklab,var(--accent) 28%,transparent),transparent 24rem),radial-gradient(circle at 84% 10%,color-mix(in oklab,var(--accent-2) 18%,transparent),transparent 22rem),linear-gradient(90deg,color-mix(in oklab,var(--ink) 11%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in oklab,var(--ink) 9%,transparent) 1px,transparent 1px);background-size:auto,auto,42px 42px,42px 42px}.texture:after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 20%,transparent 0 18%,rgba(255,255,255,.08) 18.3% 18.7%,transparent 19%),linear-gradient(120deg,transparent 0 42%,color-mix(in oklab,var(--accent) 10%,transparent) 42.5% 43.5%,transparent 44%);mix-blend-mode:${dark ? "screen" : "multiply"}}
.nav{position:sticky;top:14px;z-index:40}.nav-inner{min-height:70px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:10px 12px 10px 14px;border:1px solid var(--line);background:color-mix(in oklab,var(--bg) 82%,transparent);backdrop-filter:blur(18px);box-shadow:var(--shadow)}.estate .nav-inner{border-radius:999px 999px 32px 999px}.architect .nav-inner{border-radius:0;clip-path:polygon(0 0,98% 0,100% 100%,2% 100%)}.warm .nav-inner{border-radius:34px 14px 34px 14px}.coastal .nav-inner{border-radius:999px}.stone .nav-inner{border-radius:16px;background:color-mix(in oklab,#070503 70%,transparent)}.brand{display:flex;align-items:center;gap:13px;min-width:0}.brand-logo{width:54px;height:54px;display:grid;place-items:center;overflow:hidden;flex:0 0 auto;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:${dark ? "#111" : "#fff"};box-shadow:0 16px 40px color-mix(in oklab,var(--accent) 22%,transparent)}.brand-logo.sourced{background:color-mix(in oklab,var(--panel) 86%,transparent);padding:7px}.brand-logo img{width:100%;height:100%;object-fit:contain}.brand-logo svg{width:32px;height:32px}.estate .brand-logo{border-radius:18px 18px 6px 18px}.architect .brand-logo{border-radius:2px}.warm .brand-logo{border-radius:22px 8px 22px 8px}.coastal .brand-logo{border-radius:999px 999px 999px 18px}.stone .brand-logo{border-radius:12px}.brand b{display:block;font-family:var(--display);font-size:clamp(20px,1.8vw,29px);font-weight:700;line-height:.94;letter-spacing:0}.brand em{display:block;margin-top:4px;font-style:normal;color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.links{display:flex;align-items:center;gap:8px}.links a,.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:44px;padding:0 17px;border:1px solid var(--line);border-radius:999px;background:color-mix(in oklab,var(--panel) 78%,transparent);color:var(--ink);font-family:var(--body);font-size:14px;font-weight:800;line-height:1;white-space:nowrap;transition:transform .22s var(--ease),border-color .22s var(--ease),box-shadow .22s var(--ease)}.links a:hover,.btn:hover{transform:translateY(-2px);border-color:color-mix(in oklab,var(--accent) 72%,var(--line));box-shadow:0 16px 38px color-mix(in oklab,var(--accent) 20%,transparent)}.btn.primary,.phone{border-color:transparent;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:${dark ? "#120f0b" : "#111"}}
.hero{position:relative;min-height:88svh;overflow:hidden;padding:60px 0 80px}.hero-video{position:absolute;inset:0;z-index:-3;overflow:hidden}.hero-video video,.hero-video img{width:100%;height:100%;object-fit:cover;filter:saturate(1.14) contrast(1.05);opacity:${dark ? ".46" : ".32"}}.hero-video:after{content:"";position:absolute;inset:0;background:${dark ? "linear-gradient(90deg,rgba(8,6,4,.9),rgba(8,6,4,.42),rgba(8,6,4,.86))" : "linear-gradient(90deg,color-mix(in oklab,var(--bg) 92%,transparent),color-mix(in oklab,var(--bg) 46%,transparent),color-mix(in oklab,var(--bg) 82%,transparent))"}}.kicker{display:inline-flex;align-items:center;gap:10px;margin:0 0 17px;color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.17em;text-transform:uppercase}.kicker:before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 22px currentColor}h1,h2,h3{font-family:var(--display);letter-spacing:0;text-wrap:balance;margin:0}h1{font-size:clamp(42px,5.6vw,76px);line-height:.96;font-weight:700}h1 .wash{color:var(--accent)}p{margin:0}.lead{max-width:650px;margin-top:20px;color:var(--muted);font-size:clamp(17px,1.35vw,21px);line-height:1.62;font-weight:500}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.hero-grid{display:grid;align-items:center;gap:clamp(28px,5vw,70px)}.estate .hero-grid{grid-template-columns:.86fr .7fr}.architect .hero-grid{grid-template-columns:.58fr .92fr}.warm .hero-grid{grid-template-columns:.9fr .64fr}.coastal .hero-grid{grid-template-columns:1fr}.stone .hero-grid{grid-template-columns:.7fr .82fr}.hero-copy{position:relative;z-index:2}.estate .hero-copy{padding:36px 0 36px 28px;border-left:1px solid color-mix(in oklab,var(--accent) 40%,transparent)}.architect .hero-copy{align-self:end;padding:34px 32px 34px 0;margin-top:128px;color:#f4f8ef;text-shadow:0 2px 18px rgba(0,0,0,.34)}.architect .hero-copy h1{color:#f4f8ef}.architect .hero-copy .lead{color:rgba(244,248,239,.78)}.architect .hero-copy .btn:not(.primary){background:rgba(255,255,255,.9);color:#101511}.warm .hero-copy{order:2;background:color-mix(in oklab,var(--panel) 76%,transparent);border:1px solid var(--line);border-radius:40px 12px 40px 12px;padding:34px;box-shadow:var(--shadow)}.coastal .hero-copy{width:min(760px,100%);padding-top:60px}.stone .hero-copy{padding:30px;background:linear-gradient(135deg,color-mix(in oklab,var(--panel) 84%,transparent),color-mix(in oklab,var(--bg) 40%,transparent));border:1px solid var(--line);clip-path:polygon(0 0,96% 0,100% 88%,4% 100%);box-shadow:var(--shadow)}
.stage{position:relative;min-height:520px}.estate .stage{min-height:610px}.coastal .stage{min-height:470px}.frame{position:absolute;overflow:hidden;border:1px solid var(--line);background:var(--panel);box-shadow:var(--shadow)}.frame img{width:100%;height:100%;object-fit:cover;filter:saturate(1.08) contrast(1.04)}.estate .frame.one{inset:0 14% 6% 6%;border-radius:220px 220px 28px 28px}.estate .frame.two{right:0;bottom:0;width:44%;height:36%;border:10px solid var(--bg);border-radius:28px}.architect .frame.one{inset:14% 0 0 6%;border-radius:4px;clip-path:polygon(6% 0,100% 0,94% 100%,0 100%)}.architect .frame.two{left:0;top:0;width:38%;height:42%;border-radius:4px;transform:rotate(-3deg)}.warm .stage{order:1}.warm .frame.one{inset:5% 4% 14% 0;border-radius:48% 16% 38% 18%;transform:rotate(-2deg)}.warm .frame.two{right:0;bottom:0;width:45%;height:36%;border:9px solid var(--bg);border-radius:32px 10px 32px 10px;transform:rotate(4deg)}.coastal .stage{margin-top:34px}.coastal .frame.one{inset:0;border-radius:50px;height:340px}.coastal .frame.two{right:4%;bottom:0;width:36%;height:42%;border:10px solid var(--bg);border-radius:999px 999px 28px 28px}.stone .frame.one{inset:2% 4% 8% 0;border-radius:16px;clip-path:polygon(8% 0,100% 0,92% 100%,0 100%)}.stone .frame.two{right:0;bottom:0;width:44%;height:34%;border:10px solid var(--bg);border-radius:12px}.caption{position:absolute;left:18px;right:18px;bottom:18px;padding:14px 16px;border:1px solid var(--line);border-radius:20px;background:color-mix(in oklab,var(--bg) 76%,transparent);backdrop-filter:blur(16px)}.caption b{display:block;font-weight:800}.caption span{display:block;margin-top:5px;color:var(--muted);font-size:14px;line-height:1.35}.badge-row{position:absolute;display:flex;gap:8px;flex-wrap:wrap}.estate .badge-row{left:0;bottom:24px;width:48%}.architect .badge-row{right:0;top:74px;width:44%}.warm .badge-row{left:0;top:20px;width:50%}.coastal .badge-row{left:34px;bottom:30px}.stone .badge-row{left:0;bottom:40px;width:40%}.badge-row span{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:color-mix(in oklab,var(--panel) 76%,transparent);color:var(--muted);font-size:12px;font-weight:800}
.section{padding:82px 0}.section.alt{background:color-mix(in oklab,var(--panel) 22%,transparent)}.section-head{display:grid;grid-template-columns:minmax(0,.72fr) minmax(280px,.4fr);gap:28px;align-items:end;margin-bottom:30px}.section-head h2{font-size:clamp(34px,4.3vw,58px);line-height:1;font-weight:650}.section-head p{color:var(--muted);font-size:17px;line-height:1.6}.services{display:grid;gap:14px}.estate .services{grid-template-columns:1.3fr 1fr 1fr}.architect .services{grid-template-columns:repeat(5,1fr)}.warm .services{grid-template-columns:1fr 1fr}.coastal .services{grid-template-columns:repeat(3,1fr)}.stone .services{grid-template-columns:1fr 1fr 1fr}.service{min-height:180px;padding:22px;border:1px solid var(--line);background:color-mix(in oklab,var(--panel) 74%,transparent);box-shadow:0 18px 52px color-mix(in oklab,var(--ink) 10%,transparent)}.estate .service{border-radius:30px 30px 10px 30px}.architect .service{border-radius:0;clip-path:polygon(0 0,96% 0,100% 100%,0 100%)}.warm .service{border-radius:32px 10px}.coastal .service{border-radius:999px 999px 30px 30px;min-height:220px;padding-top:34px}.stone .service{border-radius:14px}.service i{display:block;color:var(--accent);font-style:normal;font-size:12px;font-weight:800;letter-spacing:.16em;margin-bottom:20px}.service h3{font-size:clamp(24px,2.1vw,32px);line-height:1.05;font-weight:650}.service p{margin-top:12px;color:var(--muted);line-height:1.55}.mosaic{display:grid;gap:14px}.estate .mosaic{grid-template-columns:1.2fr .8fr 1fr}.architect .mosaic{grid-template-columns:repeat(4,1fr)}.warm .mosaic{grid-template-columns:.8fr 1.2fr .8fr}.coastal .mosaic{grid-template-columns:1fr 1fr}.stone .mosaic{grid-template-columns:.92fr 1.1fr .76fr}.mosaic figure{position:relative;margin:0;overflow:hidden;min-height:290px;border:1px solid var(--line);background:var(--panel);box-shadow:0 20px 62px color-mix(in oklab,var(--ink) 12%,transparent)}.mosaic figure:first-child{grid-row:span 2;min-height:600px}.architect .mosaic figure:first-child{grid-column:span 2}.coastal .mosaic figure:first-child{grid-row:auto;min-height:380px}.mosaic img{width:100%;height:100%;object-fit:cover;filter:saturate(1.08) contrast(1.04)}.mosaic figcaption{position:absolute;left:14px;bottom:14px;padding:10px 12px;border-radius:999px;background:color-mix(in oklab,var(--bg) 80%,transparent);backdrop-filter:blur(12px);font-size:12px;font-weight:800}.estate .mosaic figure{border-radius:38px}.architect .mosaic figure{border-radius:0}.warm .mosaic figure{border-radius:34px 12px}.coastal .mosaic figure{border-radius:44px}.stone .mosaic figure{border-radius:14px}
.panel{border:1px solid var(--line);background:color-mix(in oklab,var(--panel) 78%,transparent);box-shadow:var(--shadow);border-radius:26px;padding:26px}.architect .panel{border-radius:0}.stone .panel{border-radius:16px}.trust{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.trust span{display:block;padding:17px;border:1px solid var(--line);background:color-mix(in oklab,var(--panel) 66%,transparent);border-radius:20px;color:var(--muted)}.trust b{display:block;color:var(--ink);font-size:20px;margin-bottom:5px}.estimate-zone{position:relative;overflow:hidden}.estimate-zone:before{content:"";position:absolute;inset:8% -8% auto auto;width:46vw;height:46vw;border-radius:50%;background:radial-gradient(circle,color-mix(in oklab,var(--accent) 22%,transparent),transparent 62%);filter:blur(36px);opacity:.72;pointer-events:none}.estimate-studio{position:relative;display:grid;grid-template-columns:.72fr 1fr;gap:clamp(16px,3vw,30px);padding:clamp(18px,2.8vw,34px);border:1px solid color-mix(in oklab,var(--ink) 18%,transparent);border-radius:36px;background:linear-gradient(135deg,color-mix(in oklab,var(--panel) 72%,transparent),color-mix(in oklab,var(--bg) 52%,transparent));box-shadow:0 34px 100px color-mix(in oklab,var(--ink) 18%,transparent);backdrop-filter:blur(26px);overflow:hidden}.architect .estimate-studio{border-radius:8px;clip-path:polygon(0 0,98% 0,100% 96%,2% 100%)}.warm .estimate-studio{border-radius:42px 16px}.coastal .estimate-studio{border-radius:46px 46px 20px 46px}.stone .estimate-studio{border-radius:22px;background:linear-gradient(145deg,color-mix(in oklab,var(--panel) 82%,transparent),color-mix(in oklab,#030201 38%,transparent))}.estimate-studio:before{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 0 24%,color-mix(in oklab,var(--accent) 12%,transparent) 24.5% 25.2%,transparent 26% 58%,color-mix(in oklab,var(--accent-2) 12%,transparent) 58.5% 59.2%,transparent 60%),radial-gradient(circle at 82% 16%,color-mix(in oklab,var(--accent-2) 18%,transparent),transparent 26rem);pointer-events:none}.studio-card,.studio-console{position:relative;z-index:1;border:1px solid color-mix(in oklab,var(--ink) 12%,transparent);background:color-mix(in oklab,var(--bg) 48%,transparent);backdrop-filter:blur(18px);box-shadow:0 24px 70px color-mix(in oklab,var(--ink) 12%,transparent)}.studio-card{display:grid;align-content:space-between;gap:24px;min-height:440px;padding:26px;border-radius:30px}.architect .studio-card{border-radius:4px}.warm .studio-card{border-radius:34px 12px}.coastal .studio-card{border-radius:999px 999px 34px 34px;padding-top:44px}.stone .studio-card{border-radius:16px}.studio-card h2{font-size:clamp(34px,4vw,58px);line-height:1;font-weight:650}.studio-card p{margin-top:14px;color:var(--muted);font-size:17px;line-height:1.58}.scope-ring{width:min(220px,72vw);aspect-ratio:1;margin:6px auto 0;border-radius:50%;display:grid;place-items:center;background:conic-gradient(from 230deg,var(--accent),var(--accent-2) 68%,color-mix(in oklab,var(--ink) 11%,transparent) 0);box-shadow:inset 0 0 0 16px color-mix(in oklab,var(--panel) 62%,transparent),0 20px 70px color-mix(in oklab,var(--accent) 18%,transparent)}.scope-ring span{width:68%;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;text-align:center;background:color-mix(in oklab,var(--bg) 82%,transparent);border:1px solid var(--line);font-family:var(--display);font-size:clamp(38px,5vw,62px);line-height:.9}.scope-ring small{display:block;margin-top:6px;font-family:var(--body);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.studio-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.studio-metrics span{padding:12px;border:1px solid var(--line);border-radius:18px;background:color-mix(in oklab,var(--panel) 58%,transparent);color:var(--muted);font-size:12px;line-height:1.25}.studio-metrics b{display:block;color:var(--ink);font-size:18px;margin-bottom:4px}.studio-console{padding:22px;border-radius:26px}.architect .studio-console{border-radius:4px}.stone .studio-console{border-radius:16px}.console-top{display:flex;justify-content:space-between;gap:16px;align-items:start;margin-bottom:20px}.console-top h3{font-size:clamp(28px,3vw,42px);line-height:1}.console-top p{max-width:430px;margin-top:8px;color:var(--muted);line-height:1.55}.status-pill{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border:1px solid color-mix(in oklab,var(--accent) 42%,var(--line));border-radius:999px;background:color-mix(in oklab,var(--accent) 14%,transparent);color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.status-pill:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 16px currentColor}.choice-row,.chip-cloud{display:flex;flex-wrap:wrap;gap:9px;margin:14px 0 18px}.choice,.material-chip{border:1px solid var(--line);background:color-mix(in oklab,var(--panel) 56%,transparent);color:var(--ink);min-height:42px;padding:0 14px;border-radius:999px;font-weight:700;font-size:13px;cursor:pointer;transition:transform .22s var(--ease),background .22s var(--ease),border-color .22s var(--ease)}.choice:hover,.material-chip:hover,.choice.is-active,.material-chip.is-active{transform:translateY(-2px);border-color:color-mix(in oklab,var(--accent) 72%,var(--line));background:color-mix(in oklab,var(--accent) 18%,var(--panel))}.meter{margin:14px 0 20px;padding:16px;border:1px solid var(--line);border-radius:22px;background:color-mix(in oklab,var(--bg) 38%,transparent)}.meter-head{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.meter-track{position:relative;height:10px;margin:18px 0 10px;border-radius:999px;background:color-mix(in oklab,var(--ink) 12%,transparent);overflow:hidden}.meter-track:before{content:"";position:absolute;inset:0 22% 0 0;border-radius:inherit;background:linear-gradient(90deg,var(--accent),var(--accent-2))}.meter-labels{display:flex;justify-content:space-between;color:var(--muted);font-size:12px}.flow-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.flow-steps span{position:relative;padding:14px 12px;border:1px solid var(--line);border-radius:18px;background:color-mix(in oklab,var(--panel) 50%,transparent);font-size:13px;color:var(--muted);line-height:1.25}.flow-steps b{display:block;color:var(--ink);font-size:14px;margin-bottom:4px}.action-dock{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding:10px;border:1px solid color-mix(in oklab,var(--ink) 14%,transparent);border-radius:999px;background:color-mix(in oklab,var(--bg) 68%,transparent);box-shadow:0 18px 48px color-mix(in oklab,var(--ink) 12%,transparent);backdrop-filter:blur(22px)}.dock-copy{padding-left:12px;color:var(--muted);font-size:12px;line-height:1.25}.dock-copy b{display:block;color:var(--ink);font-size:14px}.dock-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.mobile-cta{display:none}.route-hero{padding:90px 0 44px}.route-hero h1{font-size:clamp(38px,4.6vw,64px);line-height:1}.route-list{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.route-card{padding:22px;border:1px solid var(--line);background:color-mix(in oklab,var(--panel) 75%,transparent);border-radius:22px}.route-card b{display:block;margin-bottom:8px}.route-card p{color:var(--muted);line-height:1.55}.footer{padding:42px 0 70px;border-top:1px solid var(--line);color:var(--muted)}.footer-grid{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:18px}.footer b{color:var(--ink)}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}@keyframes floaty{from{transform:translate3d(-1%,0,0) scale(1.01)}to{transform:translate3d(1%,-1%,0) scale(1.04)}}.hero-copy,.frame,.service,.mosaic figure,.panel,.estimate-studio{animation:rise .68s var(--ease) both}.frame.one img{animation:floaty 10s ease-in-out infinite alternate}@media(max-width:920px){.shell{width:min(100% - 28px,1200px)}.nav{top:8px}.links a:not(.phone){display:none}.brand-logo{width:46px;height:46px}.brand b{font-size:19px}.brand em{font-size:10px}.hero{min-height:auto;padding:42px 0 58px}.hero-grid,.estate .hero-grid,.architect .hero-grid,.warm .hero-grid,.coastal .hero-grid,.stone .hero-grid,.section-head,.estimate-studio,.footer-grid{grid-template-columns:1fr}.architect .hero-copy{padding-top:40px}.warm .hero-copy{order:1}.warm .stage{order:2}.hero h1{font-size:clamp(37px,10vw,56px)}.stage,.estate .stage,.coastal .stage{min-height:380px}.frame.one,.estate .frame.one,.architect .frame.one,.warm .frame.one,.coastal .frame.one,.stone .frame.one{inset:0 0 80px 0}.frame.two,.estate .frame.two,.architect .frame.two,.warm .frame.two,.coastal .frame.two,.stone .frame.two{width:52%;height:38%;right:0;bottom:0;left:auto;top:auto}.badge-row{display:none}.services,.estate .services,.architect .services,.warm .services,.coastal .services,.stone .services,.mosaic,.estate .mosaic,.architect .mosaic,.warm .mosaic,.coastal .mosaic,.stone .mosaic,.trust,.route-list,.flow-steps{grid-template-columns:1fr}.mosaic figure,.mosaic figure:first-child{grid-row:auto;grid-column:auto;min-height:270px}.section{padding:62px 0}.studio-card{min-height:auto}.console-top,.action-dock{align-items:stretch;flex-direction:column;border-radius:24px}.dock-actions{justify-content:stretch}.dock-actions .btn{width:100%}.mobile-cta{position:fixed;left:14px;right:14px;bottom:14px;z-index:60;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 10px 10px 16px;border:1px solid var(--line);border-radius:999px;background:color-mix(in oklab,var(--bg) 76%,transparent);backdrop-filter:blur(22px);box-shadow:0 18px 60px color-mix(in oklab,var(--ink) 18%,transparent)}.mobile-cta span{font-size:12px;color:var(--muted);line-height:1.15}.mobile-cta b{display:block;color:var(--ink);font-size:14px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.frame.one img{animation:none!important}}@media print{.nav,.hero-video,.actions,.mobile-cta{display:none!important}body{background:#fff;color:#111}.section{padding:26px 0}}`;
}

function formulaCss() {
  return `
.founder{display:grid;grid-template-columns:.65fr 1fr;gap:22px;align-items:stretch}.founder-portrait{min-height:420px;border:1px solid var(--line);border-radius:34px;overflow:hidden;background:var(--panel);box-shadow:var(--shadow)}.founder-portrait img{width:100%;height:100%;object-fit:cover}.founder-copy{padding:34px;border:1px solid var(--line);border-radius:34px;background:color-mix(in oklab,var(--panel) 70%,transparent);box-shadow:var(--shadow)}.founder-copy h2{font-size:clamp(34px,4vw,58px);line-height:1}.founder-copy p{margin-top:16px;color:var(--muted);font-size:18px;line-height:1.62}.proof-band{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.proof-quote{padding:22px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(135deg,color-mix(in oklab,var(--panel) 72%,transparent),color-mix(in oklab,var(--bg) 36%,transparent));box-shadow:0 18px 54px color-mix(in oklab,var(--ink) 10%,transparent)}.proof-quote p{font-family:var(--display);font-size:clamp(23px,2.2vw,32px);line-height:1.12}.proof-quote span{display:block;margin-top:16px;color:var(--muted);font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.process-ribbon{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.process-step{position:relative;min-height:190px;padding:20px;border:1px solid var(--line);border-radius:24px;background:color-mix(in oklab,var(--panel) 66%,transparent);overflow:hidden}.process-step:before{content:attr(data-step);position:absolute;right:10px;bottom:-10px;font-family:var(--display);font-size:90px;line-height:1;color:color-mix(in oklab,var(--accent) 18%,transparent)}.process-step b{position:relative;display:block;font-size:20px;margin-bottom:12px}.process-step p{position:relative;color:var(--muted);line-height:1.5}.map-band{position:relative;overflow:hidden}.map-grid{display:grid;grid-template-columns:.62fr 1fr;gap:18px;align-items:stretch}.map-copy{position:relative;padding:30px;border:1px solid var(--line);border-radius:34px;background:color-mix(in oklab,var(--panel) 70%,transparent);box-shadow:var(--shadow);overflow:hidden}.map-copy:after{content:"";position:absolute;right:-90px;bottom:-90px;width:230px;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,color-mix(in oklab,var(--accent) 28%,transparent),transparent 65%)}.map-copy h2{font-size:clamp(36px,4vw,58px);line-height:1}.map-copy p{position:relative;margin-top:16px;color:var(--muted);font-size:17px;line-height:1.6}.pin-list{position:relative;display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}.pin{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:color-mix(in oklab,var(--bg) 48%,transparent);font-size:13px;font-weight:800}.pin:before{content:"";width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 18px var(--accent)}.map-frame{position:relative;min-height:520px;border:1px solid var(--line);border-radius:36px;overflow:hidden;background:#111;box-shadow:var(--shadow)}.architect .map-frame{border-radius:5px;clip-path:polygon(3% 0,100% 0,97% 100%,0 100%)}.stone .map-frame{border-radius:18px}.map-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0;filter:saturate(.88) contrast(1.12)}.map-frame:after{content:"SATELLITE SERVICE VIEW";position:absolute;left:18px;top:18px;padding:10px 12px;border-radius:999px;background:color-mix(in oklab,var(--bg) 78%,transparent);backdrop-filter:blur(14px);color:var(--ink);font-size:11px;font-weight:900;letter-spacing:.16em}.direction-dock{position:absolute;left:18px;right:18px;bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 12px 12px 16px;border:1px solid var(--line);border-radius:999px;background:color-mix(in oklab,var(--bg) 78%,transparent);backdrop-filter:blur(18px);box-shadow:0 18px 48px color-mix(in oklab,var(--ink) 20%,transparent)}.direction-dock span{color:var(--muted);font-size:13px}.faq-list{display:grid;gap:10px}.faq-list details{border:1px solid var(--line);border-radius:20px;background:color-mix(in oklab,var(--panel) 66%,transparent);padding:16px 18px}.faq-list summary{cursor:pointer;font-weight:850}.faq-list p{margin-top:10px;color:var(--muted);line-height:1.55}.premier-intro{display:grid;grid-template-columns:.9fr .55fr;gap:18px;margin-top:28px}.premier-copy{padding:28px;border:1px solid var(--line);border-radius:28px;background:color-mix(in oklab,var(--panel) 70%,transparent)}.premier-copy h2{font-size:clamp(30px,3.8vw,54px);line-height:1}.premier-copy p,.long-copy p{margin-top:14px;color:var(--muted);font-size:17px;line-height:1.7}.long-copy{display:grid;gap:18px}
@media(max-width:920px){.founder,.proof-band,.process-ribbon,.map-grid,.premier-intro{grid-template-columns:1fr}.map-frame{min-height:390px}.founder-portrait{min-height:320px}.direction-dock{align-items:stretch;flex-direction:column;border-radius:24px}}
@media print{.map-frame iframe{display:none!important}}`;
}

function heroCompositionCss() {
  return `
.stage[data-stage]{isolation:isolate}.stage[data-stage] .frame{will-change:transform}.hero-orbit,.blueprint-grid,.note-stack,.atlas-line,.stone-dust,.micro-card,.measure-rail,.stamp-strip,.coast-tags,.slab-label{position:absolute;pointer-events:none}.estate .stage[data-stage=garden-crest]{min-height:650px}.estate .stage[data-stage=garden-crest]:before{content:"";position:absolute;inset:4% 24% 11% 1%;border:1px solid color-mix(in oklab,var(--accent) 35%,transparent);border-radius:999px 999px 42px 42px;background:radial-gradient(circle at 50% 18%,color-mix(in oklab,var(--panel) 42%,transparent),transparent 48%);transform:rotate(-4deg)}.estate .stage[data-stage=garden-crest] .hero-orbit{inset:7% 18% 12% 4%;border:1px dashed color-mix(in oklab,var(--accent) 42%,transparent);border-radius:999px 999px 44px 44px;transform:rotate(3deg)}.estate .stage[data-stage=garden-crest] .frame.one{inset:2% 20% 9% 7%;border-radius:999px 999px 42px 42px;transform:rotate(-2.5deg);box-shadow:0 34px 110px color-mix(in oklab,var(--accent) 22%,transparent)}.estate .stage[data-stage=garden-crest] .frame.two{right:1%;bottom:4%;width:42%;height:32%;border:12px solid color-mix(in oklab,var(--bg) 86%,transparent);border-radius:999px 999px 30px 30px;transform:rotate(6deg)}.estate .stage[data-stage=garden-crest] .micro-card{right:3%;top:12%;width:150px;padding:16px;border:1px solid var(--line);border-radius:24px 24px 6px 24px;background:color-mix(in oklab,var(--panel) 82%,transparent);box-shadow:var(--shadow);font-size:12px;font-weight:850;color:var(--muted);backdrop-filter:blur(14px)}.estate .stage[data-stage=garden-crest] .micro-card b{display:block;font-family:var(--display);font-size:34px;line-height:.9;color:var(--accent)}.estate .stage[data-stage=garden-crest] .badge-row{left:1%;bottom:2%;width:45%;display:grid;grid-template-columns:1fr 1fr}
.architect .stage[data-stage=blueprint-stack]{min-height:620px}.architect .stage[data-stage=blueprint-stack]:before{content:"";position:absolute;inset:7% 0 2% 4%;background:linear-gradient(90deg,color-mix(in oklab,var(--accent) 20%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in oklab,var(--accent) 16%,transparent) 1px,transparent 1px);background-size:38px 38px;border:1px solid color-mix(in oklab,var(--accent) 28%,transparent);clip-path:polygon(5% 0,100% 0,94% 100%,0 100%);opacity:.72}.architect .blueprint-grid{inset:7% 0 2% 4%;background:radial-gradient(circle at 24% 24%,color-mix(in oklab,var(--accent) 20%,transparent),transparent 20rem),linear-gradient(135deg,transparent 0 48%,color-mix(in oklab,var(--accent-2) 20%,transparent) 48.5% 49.2%,transparent 50%)}.architect .stage[data-stage=blueprint-stack] .frame.one{inset:20% 0 2% 20%;border-radius:2px;clip-path:polygon(7% 0,100% 0,92% 100%,0 100%);transform:rotate(.7deg);box-shadow:0 30px 100px rgba(0,0,0,.38)}.architect .stage[data-stage=blueprint-stack] .frame.two{left:2%;top:5%;width:43%;height:34%;border-radius:2px;transform:rotate(-7deg);box-shadow:0 20px 80px rgba(0,0,0,.32)}.architect .measure-rail{right:3%;top:6%;display:grid;gap:8px;width:180px;color:#eaf7ef;font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.architect .measure-rail span{display:flex;justify-content:space-between;border-bottom:1px solid color-mix(in oklab,var(--accent) 45%,transparent);padding-bottom:5px}.architect .stage[data-stage=blueprint-stack] .badge-row{right:2%;top:43%;width:35%;display:grid}.architect .stage[data-stage=blueprint-stack] .caption{left:7%;right:7%;bottom:20px;border-radius:4px}
.warm .stage[data-stage=sunlit-scrapbook]{min-height:610px}.warm .stage[data-stage=sunlit-scrapbook]:before{content:"";position:absolute;inset:12% 5% 6% 2%;border-radius:44px 18px 52px 20px;background:linear-gradient(135deg,color-mix(in oklab,var(--soft) 42%,transparent),color-mix(in oklab,var(--panel) 64%,transparent));border:1px solid color-mix(in oklab,var(--ink) 10%,transparent);transform:rotate(-3deg);box-shadow:0 34px 110px color-mix(in oklab,var(--accent-2) 16%,transparent)}.warm .stage[data-stage=sunlit-scrapbook] .frame.one{inset:15% 12% 14% 3%;border-radius:55% 16% 36% 20%;transform:rotate(-4deg)}.warm .stage[data-stage=sunlit-scrapbook] .frame.two{right:0;bottom:5%;width:43%;height:30%;border:12px solid var(--bg);border-radius:28px 10px 34px 12px;transform:rotate(7deg)}.warm .note-stack{right:6%;top:8%;width:190px;min-height:128px;padding:18px;border-radius:26px 8px 26px 8px;background:color-mix(in oklab,var(--panel) 82%,transparent);box-shadow:var(--shadow);transform:rotate(5deg);font-family:var(--display);font-size:24px;line-height:1.05}.warm .note-stack:before{content:"";position:absolute;left:24px;right:24px;top:-12px;height:22px;border-radius:4px;background:color-mix(in oklab,var(--accent) 30%,#fff6dc)}.warm .stamp-strip{left:0;top:10%;display:grid;gap:9px}.warm .stamp-strip span{display:inline-flex;min-height:34px;align-items:center;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:color-mix(in oklab,var(--panel) 76%,transparent);font-size:12px;font-weight:900;color:var(--muted)}.warm .stage[data-stage=sunlit-scrapbook] .badge-row{display:none}.warm .stage[data-stage=sunlit-scrapbook] .caption{left:18px;right:auto;width:54%;border-radius:22px 8px 22px 8px}
.coastal .stage[data-stage=coastal-atlas]{min-height:520px;margin-top:24px}.coastal .stage[data-stage=coastal-atlas]:before{content:"";position:absolute;inset:8% 3% 4% 0;border-radius:0 90px 90px 0;border:1px solid color-mix(in oklab,var(--accent) 24%,transparent);background:linear-gradient(100deg,color-mix(in oklab,var(--panel) 58%,transparent),transparent 62%);clip-path:polygon(0 0,94% 0,100% 82%,84% 100%,0 100%)}.coastal .stage[data-stage=coastal-atlas] .frame.one{left:0;right:18%;top:8%;height:360px;border-radius:0 76px 76px 0;clip-path:polygon(0 0,96% 0,100% 86%,86% 100%,0 100%)}.coastal .stage[data-stage=coastal-atlas] .frame.two{right:3%;top:2%;width:31%;height:78%;border:12px solid color-mix(in oklab,var(--bg) 84%,transparent);border-radius:999px 999px 36px 36px;transform:rotate(4deg)}.coastal .atlas-line{left:4%;right:7%;bottom:11%;height:72px;border-bottom:2px solid color-mix(in oklab,var(--accent) 42%,transparent);border-radius:50%;transform:rotate(-3deg)}.coastal .coast-tags{left:4%;bottom:13%;display:flex;gap:8px;flex-wrap:wrap;width:52%}.coastal .coast-tags span{padding:9px 12px;border-radius:999px;background:color-mix(in oklab,var(--panel) 82%,transparent);border:1px solid var(--line);font-size:12px;font-weight:900;color:var(--muted)}.coastal .stage[data-stage=coastal-atlas] .badge-row{display:none}.coastal .stage[data-stage=coastal-atlas] .caption{border-radius:0 26px 26px 0;right:32%;left:20px}
.stone .stage[data-stage=material-yard]{min-height:610px}.stone .stage[data-stage=material-yard]:before{content:"";position:absolute;inset:8% 0 6% 5%;background:linear-gradient(125deg,color-mix(in oklab,var(--soft) 66%,transparent),transparent 54%),linear-gradient(90deg,transparent 0 47%,color-mix(in oklab,var(--accent) 18%,transparent) 47.4% 48.4%,transparent 49%);border:1px solid color-mix(in oklab,var(--accent) 20%,transparent);clip-path:polygon(10% 0,100% 0,88% 100%,0 100%)}.stone .stone-dust{inset:0;background:radial-gradient(circle at 82% 18%,color-mix(in oklab,var(--accent) 20%,transparent),transparent 19rem),radial-gradient(circle at 18% 82%,color-mix(in oklab,var(--accent-2) 16%,transparent),transparent 16rem);mix-blend-mode:screen;opacity:.8}.stone .stage[data-stage=material-yard] .frame.one{inset:12% 1% 15% 16%;border-radius:0;clip-path:polygon(7% 0,100% 0,89% 100%,0 100%);transform:rotate(2deg);box-shadow:0 34px 110px rgba(0,0,0,.44)}.stone .stage[data-stage=material-yard] .frame.two{left:0;bottom:2%;width:42%;height:32%;border:10px solid #110c08;border-radius:6px;clip-path:polygon(0 0,100% 8%,92% 100%,8% 92%);transform:rotate(-5deg)}.stone .slab-label{right:0;top:7%;display:grid;gap:10px;width:210px}.stone .slab-label span{padding:12px 14px;border:1px solid color-mix(in oklab,var(--accent) 28%,transparent);background:color-mix(in oklab,var(--panel) 76%,transparent);border-radius:6px;color:var(--muted);font-size:12px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;backdrop-filter:blur(12px)}.stone .stage[data-stage=material-yard] .badge-row{right:3%;bottom:6%;left:auto;width:42%;display:grid;grid-template-columns:1fr 1fr}.stone .stage[data-stage=material-yard] .caption{left:10%;right:10%;bottom:22px;border-radius:6px}
@media(max-width:920px){.stage[data-stage]{min-height:420px!important}.stage[data-stage]:before,.hero-orbit,.blueprint-grid,.measure-rail,.note-stack,.atlas-line,.stone-dust,.slab-label{display:none!important}.estate .stage[data-stage=garden-crest] .frame.one,.architect .stage[data-stage=blueprint-stack] .frame.one,.warm .stage[data-stage=sunlit-scrapbook] .frame.one,.coastal .stage[data-stage=coastal-atlas] .frame.one,.stone .stage[data-stage=material-yard] .frame.one{inset:0 0 88px 0!important;width:auto;height:auto;clip-path:none!important;border-radius:30px!important;transform:none!important}.estate .stage[data-stage=garden-crest] .frame.two,.architect .stage[data-stage=blueprint-stack] .frame.two,.warm .stage[data-stage=sunlit-scrapbook] .frame.two,.coastal .stage[data-stage=coastal-atlas] .frame.two,.stone .stage[data-stage=material-yard] .frame.two{right:0!important;left:auto!important;top:auto!important;bottom:0!important;width:52%!important;height:34%!important;clip-path:none!important;border-radius:22px!important;transform:rotate(2deg)!important}.coast-tags,.stamp-strip{display:none!important}.caption{left:14px!important;right:14px!important;width:auto!important}.micro-card{display:none!important}}`;
}

function v4DivergenceCss() {
  return `
.hero-noise{position:absolute;inset:0;z-index:-1;pointer-events:none;opacity:.34;background-image:radial-gradient(circle at 12px 18px,color-mix(in oklab,var(--ink) 12%,transparent) 0 1px,transparent 1.5px),radial-gradient(circle at 34px 28px,color-mix(in oklab,var(--accent) 12%,transparent) 0 1px,transparent 1.6px);background-size:42px 42px,64px 64px;mix-blend-mode:soft-light}.hero-instrument{margin-top:24px;border:1px solid var(--line);background:color-mix(in oklab,var(--panel) 68%,transparent);backdrop-filter:blur(18px);box-shadow:0 22px 62px color-mix(in oklab,var(--ink) 11%,transparent)}.hero-stats{position:relative;z-index:3;display:grid;margin-top:-52px;gap:10px}.hero-stats span{display:grid;padding:14px 16px;border:1px solid var(--line);background:color-mix(in oklab,var(--panel) 72%,transparent);backdrop-filter:blur(14px);box-shadow:0 16px 46px color-mix(in oklab,var(--ink) 10%,transparent)}.hero-stats b{font-family:var(--display);font-size:clamp(24px,3vw,42px);line-height:.92}.hero-stats i{margin-top:5px;color:var(--muted);font-style:normal;font-size:12px;font-weight:850;text-transform:uppercase;letter-spacing:.08em}.hero-marquee{position:relative;z-index:2;overflow:hidden;border-block:1px solid var(--line);background:color-mix(in oklab,var(--panel) 45%,transparent)}.hero-marquee div{display:flex;width:max-content;animation:marquee 32s linear infinite}.hero-marquee span{display:inline-flex;align-items:center;min-height:44px;margin-right:30px;color:var(--muted);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.14em}.hero-marquee span:before{content:"";width:7px;height:7px;margin-right:12px;background:var(--accent)}@keyframes marquee{to{transform:translateX(-50%)}}
.estate .btn{border-radius:999px 999px 14px 999px;font-family:var(--body);font-weight:850}.estate .btn.primary{position:relative;padding-inline:24px 34px;box-shadow:0 16px 44px color-mix(in oklab,var(--accent) 24%,transparent)}.estate .btn.primary:after{content:"";position:absolute;right:14px;width:9px;height:9px;border-radius:50%;background:color-mix(in oklab,var(--ink) 80%,transparent)}.estate .links a{border-radius:999px 999px 10px 999px}.estate .hero-instrument{display:flex;align-items:center;gap:14px;width:min(430px,100%);padding:12px;border-radius:999px 999px 24px 999px}.garden-dial{width:72px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:conic-gradient(from 140deg,var(--accent),var(--accent-2),var(--soft),var(--accent));color:var(--ink)}.garden-dial span{font-family:var(--display);font-size:25px;font-weight:800;line-height:.8}.garden-dial small{font-size:10px;font-weight:900;text-transform:uppercase}.garden-lines b,.garden-lines em{display:block}.garden-lines em{margin-top:3px;color:var(--muted);font-style:normal;font-size:13px}.estate .hero-stats{grid-template-columns:.72fr .5fr .5fr;width:min(780px,calc(100% - 40px))}.estate .hero-stats span{border-radius:26px 26px 8px 26px}
.architect .btn{border-radius:0;clip-path:polygon(0 0,92% 0,100% 100%,8% 100%);text-transform:uppercase;letter-spacing:.07em;background:rgba(255,255,255,.88);color:#101511;border:0}.architect .btn.primary{background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#07100b}.architect .links a{border-radius:0;clip-path:polygon(0 0,94% 0,100% 100%,6% 100%);letter-spacing:.07em;text-transform:uppercase}.architect .hero-instrument{display:grid;grid-template-columns:52px 1fr 1fr 1fr;width:min(560px,100%);border-radius:0;padding:12px 14px;clip-path:polygon(0 0,98% 0,100% 92%,2% 100%);background:rgba(8,14,10,.68);color:#f4f8ef}.architect-instrument span{display:grid;place-items:center;background:var(--accent);color:#08100b;font-weight:950}.architect-instrument b,.architect-instrument i{display:flex;align-items:center;min-height:38px;border-left:1px solid color-mix(in oklab,var(--accent) 42%,transparent);padding-left:13px;font-style:normal;font-weight:850}.architect .hero-stats{grid-template-columns:repeat(3,1fr);margin-top:-74px}.architect .hero-stats span{border-radius:0;clip-path:polygon(0 0,96% 0,100% 100%,0 100%);background:rgba(5,10,8,.72);color:#f4f8ef}.architect .hero-stats i{color:rgba(244,248,239,.68)}
.warm .btn{border-radius:22px 9px 22px 9px;box-shadow:5px 7px 0 color-mix(in oklab,var(--ink) 14%,transparent);transform:rotate(-.35deg)}.warm .btn:nth-child(2){transform:rotate(.45deg)}.warm .links a{border-radius:18px 8px;background:#fff8e8}.warm .hero-instrument{display:grid;gap:8px;width:min(330px,100%);padding:18px;border-radius:28px 10px 28px 10px;transform:rotate(-1deg);background:#fff8e8}.warm-instrument b{font-family:var(--display);font-size:24px}.warm-instrument label{display:flex;gap:9px;align-items:center;color:var(--muted);font-weight:750}.warm-instrument input{accent-color:var(--accent)}.warm .hero-stats{grid-template-columns:1fr;max-width:360px;margin-left:auto;margin-right:7vw}.warm .hero-stats span{border-radius:24px 8px 24px 8px;transform:rotate(.7deg)}.warm .hero-marquee{transform:rotate(-.8deg);margin-top:18px}
.coastal .btn{border-radius:999px;background:transparent;border-color:color-mix(in oklab,var(--accent) 42%,var(--line));box-shadow:none}.coastal .btn.primary{background:linear-gradient(135deg,var(--accent),#8fd9ff);color:#061a22;border:0}.coastal .links a{border-radius:999px;background:transparent}.coastal .hero-instrument{display:grid;grid-template-columns:auto 1fr 1fr;align-items:center;width:min(500px,100%);padding:12px 16px;border-radius:999px;background:color-mix(in oklab,var(--panel) 68%,transparent)}.coastal-instrument span{font-family:var(--display);font-size:32px;color:var(--accent)}.coastal-instrument b,.coastal-instrument i{font-style:normal;color:var(--muted);font-weight:850}.coastal .hero-stats{grid-template-columns:repeat(3,1fr);width:min(920px,calc(100% - 40px))}.coastal .hero-stats span{border-radius:999px 999px 20px 999px}.coastal .hero-marquee span:before{border-radius:999px;background:linear-gradient(135deg,var(--accent),var(--accent-2))}
.stone h1{font-size:clamp(40px,4.8vw,66px)}.stone .lead{margin-top:16px}.stone .actions{margin-top:22px}.stone .hero-copy{padding:24px;clip-path:none!important;border-radius:8px}.stone .btn{border-radius:5px;clip-path:polygon(0 0,96% 0,100% 100%,4% 100%);background:#120b06;color:var(--ink);border-color:color-mix(in oklab,var(--accent) 32%,transparent);text-transform:none}.stone .btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#120b06}.stone .links a{border-radius:4px;background:#120b06;clip-path:polygon(0 0,95% 0,100% 100%,5% 100%)}.stone .hero-instrument{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:min(440px,100%);padding:14px;border-radius:4px;clip-path:polygon(0 0,98% 0,100% 92%,2% 100%);background:#110c08}.stone-instrument b{grid-column:1/-1;font-family:var(--display);font-size:22px}.stone-instrument span,.stone-instrument em{padding:10px;border:1px solid color-mix(in oklab,var(--accent) 28%,transparent);font-style:normal;color:var(--muted);font-weight:850}.stone .hero-stats{grid-template-columns:.5fr .5fr 1fr;width:min(820px,calc(100% - 40px));margin-left:auto}.stone .hero-stats span{border-radius:4px;clip-path:polygon(0 0,98% 0,100% 100%,2% 100%);background:#130d08}
.hero .hero-stats{margin-top:26px!important}.estate .estimate-studio{border-radius:54px 54px 18px 54px}.architect .studio-card,.architect .studio-console,.architect .choice,.architect .material-chip{border-radius:0!important;clip-path:polygon(0 0,98% 0,100% 100%,2% 100%)}.warm .studio-card,.warm .studio-console{border-radius:34px 12px 34px 12px;transform:rotate(-.2deg)}.coastal .studio-card,.coastal .studio-console{border-radius:42px 42px 18px 42px}.stone .studio-card,.stone .studio-console,.stone .choice,.stone .material-chip{border-radius:6px!important}.estate .service:nth-child(2n){transform:translateY(24px)}.architect .service:nth-child(2n){transform:translateY(-18px)}.warm .service:nth-child(odd){transform:rotate(-.55deg)}.warm .service:nth-child(even){transform:rotate(.55deg)}.coastal .service:nth-child(3n){transform:translateY(28px)}.stone .service:nth-child(2){transform:translateY(20px) skewY(-1deg)}
@media(max-width:920px){.hero-stats{margin-top:12px!important;grid-template-columns:1fr 1fr 1fr!important}.hero-instrument{width:100%!important}.hero-marquee span{min-height:38px}.warm .btn,.warm .hero-stats span,.warm .studio-card,.warm .studio-console,.warm .service{transform:none!important}}
@media(prefers-reduced-motion:reduce){.hero-marquee div{animation:none!important}}`;
}

function nav(packet, spec, logoUrl, lane = "premier-multi-page") {
  const links = lane === "single-page-cinematic"
    ? `<a href="#services">Services</a><a href="#map">Map</a><a href="#quote">Estimate</a>`
    : `<a href="/services/">Services</a><a href="/service-areas/">Map</a><a href="/contact/">Contact</a>`;
  return `<nav class="nav"><div class="shell nav-inner">${brand(packet, spec, logoUrl)}<div class="links">${links}<a class="phone" href="${phoneHref(packet.business.phone)}">${esc(packet.business.phone || "Call")}</a></div></div></nav>`;
}

function colorHeadline(text, spec) {
  const parts = text.split(" ");
  const hit = spec.theme === "stone" ? 1 : spec.theme === "architect" ? 3 : spec.theme === "warm" ? 2 : 4;
  return parts.map((word, index) => index === Math.min(hit, parts.length - 1) ? `<span class="wash">${esc(word.replace(/[.,]$/, ""))}</span>${/[.,]$/.test(word) ? word.slice(-1) : ""}` : esc(word)).join(" ");
}

function heroStage(packet, spec, images) {
  const image = (index) => esc(images[index % images.length] || images[0]);
  const chipItems = spec.services.slice(0, 4);
  const chips = chipItems.map((item) => `<span>${esc(item)}</span>`).join("");
  const caption = `<div class="caption"><b>${esc(packet.business.city)}</b><span>${esc(spec.blueprint)}</span></div>`;
  const img1 = `<img src="${image(0)}" alt="${esc(packet.business.name)} landscape project visual">`;
  const img2 = `<img src="${image(1)}" alt="${esc(packet.business.name)} detail image">`;

  if (spec.theme === "estate") {
    return `<div class="stage" data-stage="garden-crest"><div class="hero-orbit"></div><div class="frame one">${img1}${caption}</div><div class="frame two">${img2}</div><div class="micro-card"><b>${esc(String(packet.business.rating || "4+"))}</b>public rating cue</div><div class="badge-row">${chips}</div></div>`;
  }

  if (spec.theme === "architect") {
    const rails = ["LOT", "GRADE", "LIGHT"].map((label, index) => `<span>${label}<b>0${index + 1}</b></span>`).join("");
    return `<div class="stage" data-stage="blueprint-stack"><div class="blueprint-grid"></div><div class="frame one">${img1}${caption}</div><div class="frame two">${img2}</div><div class="measure-rail">${rails}</div><div class="badge-row">${chips}</div></div>`;
  }

  if (spec.theme === "warm") {
    const stamps = chipItems.slice(0, 3).map((item) => `<span>${esc(item)}</span>`).join("");
    return `<div class="stage" data-stage="sunlit-scrapbook"><div class="stamp-strip">${stamps}</div><div class="frame one">${img1}${caption}</div><div class="frame two">${img2}</div><div class="note-stack">Quick yard help, clearly scoped.</div><div class="badge-row">${chips}</div></div>`;
  }

  if (spec.theme === "coastal") {
    const tags = chipItems.map((item) => `<span>${esc(item)}</span>`).join("");
    return `<div class="stage" data-stage="coastal-atlas"><div class="frame one">${img1}${caption}</div><div class="frame two">${img2}</div><div class="atlas-line"></div><div class="coast-tags">${tags}</div><div class="badge-row">${chips}</div></div>`;
  }

  const labels = ["stone detail", "clean edges", "site-ready"].map((item) => `<span>${item}</span>`).join("");
  return `<div class="stage" data-stage="material-yard"><div class="stone-dust"></div><div class="frame one">${img1}${caption}</div><div class="frame two">${img2}</div><div class="slab-label">${labels}</div><div class="badge-row">${chips}</div></div>`;
}

function heroInstrument(packet, spec) {
  const city = esc(packet.business.city || "California");
  const rating = esc(String(packet.business.rating || "4.8"));
  const reviews = esc(String(packet.business.reviewCount || "12"));
  const first = esc(spec.services[0] || "Outdoor work");
  const second = esc(spec.services[1] || "Site visit");

  if (spec.theme === "estate") {
    return `<div class="hero-instrument estate-instrument" aria-label="Garden readiness widget"><div class="garden-dial"><span>${rating}</span><small>rating</small></div><div class="garden-lines"><b>Walkthrough path</b><em>${city} / ${first} / ${second}</em></div></div>`;
  }
  if (spec.theme === "architect") {
    return `<div class="hero-instrument architect-instrument" aria-label="Plan takeoff widget"><span>LOT</span><b>${city}</b><i>${first}</i><i>${second}</i></div>`;
  }
  if (spec.theme === "warm") {
    return `<div class="hero-instrument warm-instrument" aria-label="Yard checklist widget"><b>Today list</b><label><input type="checkbox" checked> ${first}</label><label><input type="checkbox"> ${second}</label><label><input type="checkbox"> Send photos</label></div>`;
  }
  if (spec.theme === "coastal") {
    return `<div class="hero-instrument coastal-instrument" aria-label="Project index widget"><span>${reviews}</span><b>public notes</b><i>${first}</i><i>${city}</i></div>`;
  }
  return `<div class="hero-instrument stone-instrument" aria-label="Material calculator widget"><b>Material path</b><span>${first}</span><span>${second}</span><em>${rating} public rating</em></div>`;
}

function heroStats(packet, spec) {
  const stats = [
    [packet.business.rating || "4.8", "rating"],
    [packet.business.reviewCount || "12", "reviews"],
    [(mapProfile(packet).cities.length || 4), "nearby areas"],
  ];
  return `<div class="shell hero-stats ${spec.theme}-stats" aria-label="${esc(packet.business.name)} quick proof">${stats.map(([num, label]) => `<span><b>${esc(num)}</b><i>${esc(label)}</i></span>`).join("")}</div>`;
}

function heroMarquee(packet, spec) {
  const map = mapProfile(packet);
  const words = [...spec.services.slice(0, 5), ...map.cities].filter(Boolean);
  const row = words.map((word) => `<span>${esc(word)}</span>`).join("");
  return `<div class="hero-marquee ${spec.theme}-marquee" aria-hidden="true"><div>${row}${row}</div></div>`;
}

function heroCtas(spec) {
  const labels = {
    estate: ["Book the garden walk", "View estate care"],
    architect: ["Map my yard", "Open the plan board"],
    warm: ["Start a yard note", "See easy fixes"],
    coastal: ["Plan the outdoor room", "Open the project atlas"],
    stone: ["Build my quote", "Inspect the work"],
  };
  return labels[spec.theme] || ["Request an estimate", "See the work"];
}

function hero(packet, spec, images, video) {
  const media = heroStage(packet, spec, images);
  const [primaryLabel, secondaryLabel] = heroCtas(spec);
  const copy = `<div class="hero-copy"><p class="kicker">${esc(spec.kicker)}</p><h1>${colorHeadline(spec.headline, spec)}</h1><p class="lead">${esc(spec.subhead)}</p>${heroInstrument(packet, spec)}<div class="actions"><a class="btn primary" href="/quote/">${esc(primaryLabel)}</a><a class="btn" href="/gallery/">${esc(secondaryLabel)}</a></div></div>`;
  const order = spec.theme === "warm" ? `${media}${copy}` : `${copy}${media}`;
  const videoLayer = video.ready ? `<video autoplay muted loop playsinline poster="${esc(images[0])}"><source src="${esc(video.src)}" type="video/mp4"></video>` : `<img src="${esc(images[0])}" alt="">`;
  return `<section class="hero" id="main" data-video-status="${video.ready ? "veo-ready" : "veo-pending"}" data-hero-model="${esc(spec.heroModel || spec.theme)}"><div class="hero-video" aria-hidden="true">${videoLayer}</div><div class="hero-noise" aria-hidden="true"></div><div class="shell hero-grid">${order}</div>${heroStats(packet, spec)}${heroMarquee(packet, spec)}</section>`;
}

function serviceIntro(packet, spec) {
  const name = esc(packet.business.name);
  const city = esc(packet.business.city || "California");
  const copy = {
    estate: ["Property care with a softer front gate.", `${name} gets a quieter service menu for ${city} homes, estates, and commercial grounds: elegant enough to feel established, simple enough to call from a phone.`],
    architect: ["A plan-set menu for tight outdoor work.", `${name} is organized like a field board: scope, material, lighting, and site constraints placed where a homeowner can understand the work fast.`],
    warm: ["Yard help that feels easy to ask for.", `${name} needs friendly service cards, quick choices, and plain-language project paths for homeowners who just want the yard handled.`],
    coastal: ["Outdoor rooms arranged by light, flow, and proof.", `${name} gets a gallery-led service system for patios, gardens, hardscape, and exterior spaces that should feel calm before the first call.`],
    stone: ["Stone, grade, repair, and planting in one rugged path.", `${name} needs masonry and landscape work shown with material weight, service clarity, and a quote route that feels built.`],
  }[spec.theme];
  return copy || ["Services that make the next call easier.", `${name} gets a clear service menu for ${city} homeowners.`];
}

function services(packet, spec) {
  const [title, copy] = serviceIntro(packet, spec);
  return `<section class="section alt" id="services" data-section-model="${esc(spec.sectionPattern?.[1] || "services")}"><div class="shell"><div class="section-head"><h2>${esc(title)}</h2><p>${copy}</p></div><div class="services">${spec.services.map((service, index) => `<article class="service"><i>${String(index + 1).padStart(2, "0")}</i><h3>${esc(service)}</h3><p>${esc(serviceCopy(service, spec))}</p></article>`).join("")}</div></div></section>`;
}

function serviceCopy(service, spec) {
  const map = {
    "Estate maintenance": "Regular exterior care, clean arrivals, irrigation checks, and seasonal polish presented like a premium property service.",
    "Planting refresh": "Color, shade, mulch, beds, and softer curb appeal translated into a simple estimate path.",
    "Commercial grounds": "Managed properties get clearer scope, faster contact, and a site that looks more established.",
    "Design-build": "Outdoor ideas become a confident plan view with edges, lighting, materials, and next steps.",
    "Hardscape layout": "Patios, walkways, walls, and grade changes are framed as one coordinated project.",
    "Lawn care": "A friendly path for recurring yard care, cleanup, edges, and quick service calls.",
    "Sprinkler check": "Water issues become easier to describe before the visit, which makes the call feel less vague.",
    "Outdoor rooms": "Patios and planting read as livable space, with image-led confidence and clear service areas.",
    "Hardscape": "Hard surfaces, walls, and outdoor structure get shown with enough detail to feel trustworthy.",
    "Masonry": "Stone and block work gets a more grounded presentation with material-first visual rhythm.",
    "Paver repair": "Repair work is framed with the exact clarity homeowners need before they call.",
  };
  return map[service] || `${service} changes the yard in a visible way: cleaner edges, easier access, and a clearer first walkthrough.`;
}

function gallery(packet, spec, images) {
  const captions = {
    estate: ["Garden arrival", "Planting texture", "Estate care", "Path and shade", "Seasonal layer"],
    architect: ["Plan view", "Outdoor edge", "Build surface", "Lighting rhythm", "Finished yard"],
    warm: ["Neighborhood curb", "Yard reset", "Planting note", "Cleanup detail", "Friendly path"],
    coastal: ["Outdoor room", "Coastal light", "Hardscape detail", "Garden flow", "Project image"],
    stone: ["Masonry surface", "Patio structure", "Retaining detail", "Grade line", "Built edge"],
  }[spec.theme];
  const intros = {
    estate: ["A garden album with estate rhythm.", "Tall arched crops, quiet captions, and slower image pacing make the page feel composed instead of assembled."],
    architect: ["A visual takeoff board.", "Image plates are treated like plan sheets, with hard edges, scale labels, and project proof arranged for fast scanning."],
    warm: ["A sunny yard notebook.", "Photos sit like saved snapshots and service notes, so the page feels approachable without losing polish."],
    coastal: ["A light-filled outdoor-room atlas.", "Wide ribbons, soft contours, and project tags create a more spatial gallery for patios and gardens."],
    stone: ["A material wall for hardscape work.", "Stone, grade, paver, and planting frames get heavier treatment so the craft feels tangible."],
  }[spec.theme] || ["Work with a clearer visual story.", "The gallery uses matched crops and motion so the page feels rooted in the owner's work."];
  return `<section class="section" id="work" data-section-model="${esc(spec.sectionPattern?.[3] || "gallery")}"><div class="shell"><div class="section-head"><h2>${esc(intros[0])}</h2><p>${esc(intros[1])}</p></div><div class="mosaic">${images.slice(0, 5).map((src, index) => `<figure><img src="${esc(src)}" alt="${esc(packet.business.name)} ${captions[index]}"><figcaption>${esc(captions[index])}</figcaption></figure>`).join("")}</div></div></section>`;
}

function trust(packet) {
  const hours = packet.business.hours?.[0]?.replace(/^Monday:\s*/i, "Mon ") || "Call for current hours";
  return `<section class="section alt"><div class="shell trust"><span><b>${esc(packet.business.city)}</b>Primary market</span><span><b>${esc(packet.business.rating || "5.0")}</b>Google rating</span><span><b>${esc(packet.business.reviewCount || 0)}</b>Public reviews</span><span><b>${esc(hours)}</b>Hours cue</span></div></section>`;
}

function proofBand(packet, spec) {
  const reviews = Number(packet.business.reviewCount || 0);
  const rating = packet.business.rating || "5.0";
  const hours = packet.business.hours?.[0]?.replace(/^Monday:\s*/i, "Monday ") || "Call for current hours";
  const cards = [
    [`${rating} rating`, `${packet.business.name} carries a public rating signal that should be made visible before the homeowner has to search for it.`],
    [`${reviews} public reviews`, reviews > 0 ? "The review count gives the page a real trust spine without inventing testimonials." : "Review copy should be added only after a real review pull."],
    [hours, `The opening-hours cue helps ${packet.business.city} homeowners decide when to call.`],
  ];
  return `<section class="section alt"><div class="shell"><div class="section-head"><h2>Trust signals that do not need a speech.</h2><p>Real public facts are placed close to the decision points, so the page feels useful before anyone gets sold to.</p></div><div class="proof-band">${cards.map(([title, copy]) => `<article class="proof-quote"><p>${esc(title)}</p><span>${esc(copy)}</span></article>`).join("")}</div></div></section>`;
}

function founderBlock(packet, spec, images) {
  return `<section class="section"><div class="shell founder"><figure class="founder-portrait"><img src="${esc(images[2] || images[0])}" alt="${esc(packet.business.name)} local landscape work"></figure><div class="founder-copy"><p class="kicker">${esc(packet.business.city)} local footprint</p><h2>Built around the way homeowners actually choose a crew.</h2><p>This page does not try to make ${esc(packet.business.name)} feel like a software product. It puts the work, the map, the service area, the phone path, and the proof signals close together so a homeowner can understand the company quickly.</p><p>The full client-approved version should add owner story, team photos, verified licenses, and real review language after approval.</p></div></div></section>`;
}

function processRibbon(packet) {
  const steps = [
    ["Share the outdoor area", "Pick the project type and send the first details from a phone."],
    ["Show the location", "The satellite map and service-area pins make the request feel grounded."],
    ["Send photos", "Homeowners can show the trouble spot before a walkthrough is scheduled."],
    ["Confirm the walkthrough", "The call starts with scope, timing, and address context already clear."],
  ];
  return `<section class="section alt"><div class="shell"><div class="section-head"><h2>A cleaner path from curiosity to walkthrough.</h2><p>The scroll is designed to reduce vague calls and help the owner start with a real project shape.</p></div><div class="process-ribbon">${steps.map(([title, copy], index) => `<article class="process-step" data-step="${String(index + 1).padStart(2, "0")}"><b>${esc(title)}</b><p>${esc(copy)}</p></article>`).join("")}</div></div></section>`;
}

function geoMapBand(packet, spec) {
  const map = mapProfile(packet);
  const pins = map.cities.map((city) => `<span class="pin">${esc(city)}</span>`).join("");
  return `<section class="section map-band" id="map"><div class="shell map-grid"><div class="map-copy"><p class="kicker">Satellite map + directions</p><h2>See the service area before you call.</h2><p>${esc(packet.business.name)} is anchored at ${esc(map.address)}. The production version can pair this satellite view with verified service-radius details, neighborhood pages, and route-aware call tracking.</p><div class="pin-list">${pins}</div></div><div class="map-frame"><iframe title="${esc(packet.business.name)} satellite map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${esc(map.embed)}"></iframe><div class="direction-dock"><span>${esc(map.address)}</span><a class="btn primary" target="_blank" rel="noopener" href="${esc(map.directions)}">Get directions</a></div></div></div></section>`;
}

function faqSection(packet, spec) {
  const city = packet.business.city || "the service area";
  const faqs = [
    [`Does ${packet.business.name} serve ${city}?`, `Yes. The preview is built around ${city} and nearby service-area pins so homeowners immediately understand the local footprint.`],
    ["Can I send photos before a walkthrough?", "Yes. The estimate path is designed around photos first, then a clearer phone call or walkthrough."],
    ["What kind of landscape work is highlighted?", `${spec.services.slice(0, 4).join(", ")} and related outdoor improvements are placed into the main service path.`],
    ["Is the map based on the business address?", `The map uses the public business address when available: ${packet.business.address || city}.`],
  ];
  return `<section class="section" id="faq"><div class="shell"><div class="section-head"><h2>Questions homeowners ask before they call.</h2><p>Short direct answers support search, AI answers, and a calmer sales conversation.</p></div><div class="faq-list">${faqs.map(([question, answer]) => `<details><summary>${esc(question)}</summary><p>${esc(answer)}</p></details>`).join("")}</div></div></section>`;
}

function quote(packet, spec) {
  const chips = spec.services.slice(0, 5).map((service, index) => `<button class="material-chip${index < 2 ? " is-active" : ""}" type="button" data-choice="${esc(service)}">${esc(service)}</button>`).join("");
  const phone = packet.business.phone || "Call now";
  const city = packet.business.city || "local service area";
  const intro = {
    estate: ["Schedule the garden walk.", "Choose the property care lane, add the first details, and make the call feel like a private walkthrough instead of a generic inquiry.", "Garden concierge"],
    architect: ["Turn the yard into a build brief.", "Pick the site condition, choose the outdoor system, and create a cleaner first conversation around scope and materials.", "Plan intake"],
    warm: ["Send the yard note.", "Make the request feel easy: choose the need, add photos, and start with enough detail for a useful call.", "Yard note"],
    coastal: ["Map the next outdoor room.", "Place the project in the service area, choose the space, and keep the first call focused on what the homeowner wants to change.", "Outdoor room"],
    stone: ["Size the stone and repair path.", "Choose the masonry or landscape scope, send the surface photos, and start with material context already in hand.", "Material brief"],
  }[spec.theme] || ["Plan the outdoor project in minutes.", "Choose the kind of work, add the first details, then call or send photos.", "Estimate path"];
  return `<section class="section estimate-zone" id="quote" data-intake-model="${esc(spec.heroModel || spec.theme)}"><div class="shell"><div class="section-head"><h2>${esc(intro[0])}</h2><p>${esc(intro[1])}</p></div><div class="estimate-studio"><aside class="studio-card"><div><p class="kicker">${esc(city)} ${esc(intro[2])}</p><h2>Shape the job before the call.</h2><p>Fast enough for a phone, polished enough to make the business feel established before the first walkthrough.</p></div><div class="scope-ring" aria-label="Three-step estimate readiness"><span>3<small>steps</small></span></div><div class="studio-metrics"><span><b>${esc(packet.business.rating || "5.0")}</b>rating cue</span><span><b>${esc(packet.business.reviewCount || "0")}</b>reviews</span><span><b>24h</b>reply goal</span></div></aside><div class="studio-console"><div class="console-top"><div><p class="kicker">Build the request</p><h3>Pick the work. Add photos. Book the walkthrough.</h3><p>Each choice trims the back-and-forth and gives the owner a clearer opening conversation.</p></div><span class="status-pill">Ready path</span></div><div class="choice-row" aria-label="Project size"><button class="choice is-active" type="button" data-choice="Refresh">Refresh</button><button class="choice" type="button" data-choice="Repair">Repair</button><button class="choice" type="button" data-choice="Full yard">Full yard</button><button class="choice" type="button" data-choice="Commercial">Commercial</button></div><div class="chip-cloud" aria-label="Service choices">${chips}</div><div class="meter"><div class="meter-head"><span>Timeline</span><strong data-estimate-summary>This month · photo-ready</strong></div><div class="meter-track" aria-hidden="true"></div><div class="meter-labels"><span>Today</span><span>This week</span><span>This month</span></div></div><div class="flow-steps"><span><b>01 Scope</b>Choose the outdoor work.</span><span><b>02 Photos</b>Send the trouble spots.</span><span><b>03 Walkthrough</b>Confirm timing and price.</span></div><div class="action-dock"><div class="dock-copy"><b>Ready to start?</b><span>Call, text photos, or save this scope for the walkthrough.</span></div><div class="dock-actions"><a class="btn primary" href="${phoneHref(packet.business.phone)}">Call ${esc(phone)}</a><a class="btn" href="${smsHref(packet.business.phone)}">Send photos</a></div></div></div></div><div class="mobile-cta"><span><b>${esc(intro[2])}</b>Call or send photos</span><a class="btn primary" href="${phoneHref(packet.business.phone)}">Start</a></div></div></section>`;
}

function footer(packet) {
  return `<footer class="footer"><div class="shell footer-grid"><div><b>${esc(packet.business.name)}</b><p>${esc(packet.business.city)} landscape services and outdoor project planning.</p></div><div><b>Phone</b><p>${esc(packet.business.phone || "Add phone")}</p></div><div><b>Website</b><p>${esc(packet.business.website || "Not listed")}</p></div><div><b>Next step</b><p>Call, send photos, or start a walkthrough request.</p></div></div></footer>`;
}

function home(packet, spec, images, video, logoUrl, lane) {
  const title = `${packet.business.name} | ${packet.business.city} Landscape Website`;
  const description = `${packet.business.name} premium landscape website preview for ${packet.business.city}, California.`;
  const blocks = {
    hero: () => hero(packet, spec, images, video),
    trust: () => trust(packet),
    services: () => services(packet, spec),
    founder: () => founderBlock(packet, spec, images),
    proof: () => proofBand(packet, spec),
    process: () => processRibbon(packet),
    map: () => geoMapBand(packet, spec),
    faq: () => faqSection(packet, spec),
    gallery: () => gallery(packet, spec, images),
    quote: () => quote(packet, spec),
    premier: () => `<section class="section"><div class="shell premier-intro"><div class="premier-copy"><p class="kicker">Premier authority hub</p><h2>A deeper site for service areas and real customer decisions.</h2><p>This version keeps the cinematic homepage but adds proper inner pages for services, process, service areas, FAQ, contact, and source review so the business can grow beyond a single scroll.</p></div><div class="premier-copy"><h2>${esc(packet.business.city)} map-first trust.</h2><p>The map/directions flow becomes its own page, with satellite context, service-area pins, and a cleaner route for homeowners who are already deciding whether the company is local enough.</p></div></div></section>`,
  };
  const order = {
    estate: ["hero", "founder", "trust", "services", "gallery", "map", "proof", "quote", "faq"],
    architect: ["hero", "services", "map", "process", "quote", "gallery", "trust", "faq", "proof"],
    warm: ["hero", "proof", "quote", "services", "founder", "faq", "map", "gallery", "process"],
    coastal: ["hero", "gallery", "premier", "map", "services", "proof", "process", "quote", "trust"],
    stone: ["hero", "services", "quote", "founder", "map", "gallery", "process", "proof", "trust"],
  }[spec.theme] || ["hero", "services", "gallery", "map", "quote"];
  const body = `${order.map((key) => blocks[key]()).join("")}${footer(packet)}`;
  return `${head(packet, spec, title, description)}
<body><a class="skip" href="#main">Skip to content</a><div class="texture"></div><div class="site ${spec.theme}" data-v4-build="a-plus-meta" data-lane="${lane}">${nav(packet, spec, logoUrl, lane)}${body}</div></body></html>`;
}

function quotePage(packet, spec, logoUrl) {
  return `${head(packet, spec, `${packet.business.name} | Estimate`, `Start a clear estimate path for ${packet.business.name}.`)}
<body><a class="skip" href="#main">Skip to content</a><div class="texture"></div><div class="site ${spec.theme}" data-v4-build="a-plus-meta">${nav(packet, spec, logoUrl)}<main id="main">${quote(packet, spec)}</main>${footer(packet)}</div></body></html>`;
}

function routePage(packet, spec, logoUrl, title, subtitle, cards) {
  return `${head(packet, spec, `${packet.business.name} | ${title}`, subtitle)}
<body><a class="skip" href="#main">Skip to content</a><div class="texture"></div><div class="site ${spec.theme}" data-v4-build="a-plus-meta">${nav(packet, spec, logoUrl)}<main class="shell route-hero" id="main"><p class="kicker">${esc(spec.kicker)}</p><h1>${esc(title)}</h1><p class="lead">${esc(subtitle)}</p></main><section class="section"><div class="shell route-list">${cards.map((card) => `<article class="route-card"><b>${esc(card[0])}</b><p>${esc(card[1])}</p></article>`).join("")}</div></section>${footer(packet)}</div></body></html>`;
}

function longCopy(packet, spec, focus) {
  const city = packet.business.city || "the service area";
  const services = spec.services.join(", ");
  return [
    `${packet.business.name} needs a site that helps a homeowner understand the work before the first call. The ${focus} page is written around ${city}, the public business profile, the available source imagery, and the service categories that matter most: ${services}. The goal is not to overwhelm the visitor with a marketing essay. The goal is to give enough context that the company feels grounded, local, and easy to contact.`,
    `The page structure follows the premier authority hub formula: direct answers first, real service area context, visible phone paths, map context, and internal links that help a visitor move from research to action. Where public data is verified, it is used directly. Where owner story, licensing, awards, or team details are not verified yet, the page avoids making claims and leaves the structure ready for the approval pass.`,
    `For local search and AI answer engines, this page keeps the language specific to the outdoor project. Instead of generic filler, each section describes how a homeowner thinks about timing, photos, walkthroughs, property access, materials, and service-area confidence. The satellite map and directions path are intentionally part of the conversion flow because local trust is often decided before design taste is judged.`,
    `The production version should deepen this content with approved project photos, real before-and-after notes, verified credentials, a founder story, and true review quotes. This preview establishes the site architecture and gives Lovable a stronger foundation to repair visually without losing the search and conversion intent.`,
  ].map((paragraph) => `<p>${esc(paragraph)}</p>`).join("");
}

function premierContentPage(packet, spec, logoUrl, title, subtitle, focus, innerHtml = "") {
  return `${head(packet, spec, `${packet.business.name} | ${title}`, subtitle)}
<body><a class="skip" href="#main">Skip to content</a><div class="texture"></div><div class="site ${spec.theme}" data-v4-build="a-plus-meta" data-lane="premier-multi-page">${nav(packet, spec, logoUrl, "premier-multi-page")}<main class="shell route-hero" id="main"><p class="kicker">${esc(spec.kicker)}</p><h1>${esc(title)}</h1><p class="lead">${esc(subtitle)}</p></main>${innerHtml}<section class="section"><div class="shell long-copy">${longCopy(packet, spec, focus)}</div></section>${footer(packet)}</div></body></html>`;
}

function aboutPage(packet, spec, logoUrl, images) {
  return premierContentPage(packet, spec, logoUrl, "About the local crew", `${packet.business.name} needs a fuller story page built from verified owner and project facts.`, "about", `${founderBlock(packet, spec, images)}${proofBand(packet, spec)}`);
}

function processPage(packet, spec, logoUrl) {
  return premierContentPage(packet, spec, logoUrl, "How the project starts", "A clear walkthrough path for photos, scope, timing, and follow-up.", "process", processRibbon(packet));
}

function serviceAreasPage(packet, spec, logoUrl) {
  return premierContentPage(packet, spec, logoUrl, "Service areas and directions", "Satellite map context, nearby service pins, and a direct directions path.", "service areas", geoMapBand(packet, spec));
}

function faqPage(packet, spec, logoUrl) {
  return premierContentPage(packet, spec, logoUrl, "Landscape questions", "Short answers for homeowners comparing local landscape companies.", "FAQ", faqSection(packet, spec));
}

function contactPage(packet, spec, logoUrl) {
  return premierContentPage(packet, spec, logoUrl, "Contact and estimate", "Call, send photos, or use the estimate path with map context.", "contact", `${quote(packet, spec)}${geoMapBand(packet, spec)}`);
}

function sourcePage(packet, spec, logoUrl) {
  const enriched = packet.source.firecrawlEnrichment || {};
  const cards = [
    ["Business profile", `${packet.business.city}, ${packet.business.rating || "n/a"} rating, ${packet.business.reviewCount || 0} public reviews.`],
    ["Current website", packet.business.website || "No public website listed."],
    ["Recovered media", `${packet.source.logoCandidates?.length || 0} logo candidates, ${packet.source.imageCandidates?.length || 0} image candidates, ${packet.source.brandColors?.length || 0} color signals.`],
    ["Selected source", enriched.selectedUrl || "No source site available; proposed identity used."],
    ["Platform", packet.leadMiner.platformDetected || "Unknown"],
    ["Production note", "Owner approval and final image rights review happen before this preview becomes a real public customer site."],
  ];
  return routePage(packet, spec, logoUrl, "Source and media review", "The private operator route shows what the preview is based on without turning the public homepage into an audit board.", cards);
}

function packagePage(packet, spec, logoUrl) {
  const cards = (packet.leadMiner.packageOptions || []).map((option) => [
    String(option.label || "")
      .replace(/\bGBP\b/gi, "business profile")
      .replace(/\bsource packet\b/gi, "business profile")
      .replace(/\s+/g, " ")
      .trim(),
    option.bestFor,
  ]);
  cards.push(["Recommended launch", spec.signature]);
  cards.push(["Secure backend", "Calls, texts, billing, and delivery workflows stay server-side after owner approval."]);
  return routePage(packet, spec, logoUrl, "Launch package", "Choose the route from preview to production without exposing internal controls on the public homepage.", cards);
}

function faviconSvg(spec) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="${spec.bg}"/><circle cx="72" cy="48" r="34" fill="${spec.accent}" opacity=".34"/><path d="M30 88c28-3 50-22 68-52" fill="none" stroke="${spec.accent2}" stroke-width="12" stroke-linecap="round"/><path d="M42 70c14 3 28-3 42-18" fill="none" stroke="${spec.ink}" stroke-width="7" stroke-linecap="round"/></svg>`;
}

function ogSvg(packet, spec) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${spec.bg}"/><circle cx="990" cy="130" r="310" fill="${spec.accent}" opacity=".28"/><path d="M80 520c230-18 430-168 590-360" fill="none" stroke="${spec.accent2}" stroke-width="20" stroke-linecap="round" opacity=".42"/><text x="76" y="142" font-family="${spec.body},Arial,sans-serif" font-size="28" font-weight="700" fill="${spec.accent2}" letter-spacing="5">${esc(spec.kicker.toUpperCase())}</text><text x="76" y="292" font-family="${spec.display},Georgia,serif" font-size="70" font-weight="700" fill="${spec.ink}">${esc(packet.business.name)}</text><text x="80" y="374" font-family="${spec.body},Arial,sans-serif" font-size="34" fill="${spec.muted}">${esc(packet.business.city)} landscape preview</text></svg>`;
}

function writePolishFiles(dir, packet, spec, lane) {
  const host = `https://${projectName(packet)}.vercel.app`;
  const pages = ["/", "/services/", "/gallery/", "/quote/", "/source/", "/package/"];
  if (lane === "premier-multi-page") pages.push("/about/", "/process/", "/service-areas/", "/faq/", "/contact/");
  writeFileSync(path.join(dir, "favicon.svg"), faviconSvg(spec));
  writeFileSync(path.join(dir, "og.svg"), ogSvg(packet, spec));
  writeFileSync(path.join(dir, "manifest.webmanifest"), JSON.stringify({
    name: `${packet.business.name} Preview`,
    short_name: packet.business.name.slice(0, 24),
    start_url: "/",
    display: "standalone",
    background_color: spec.bg,
    theme_color: spec.bg,
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  }, null, 2));
  writeFileSync(path.join(dir, "robots.txt"), "User-agent: *\nDisallow: /\n");
  writeFileSync(path.join(dir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((page) => `<url><loc>${host}${page === "/" ? "/" : page}</loc></url>`).join("")}</urlset>`);
  writeFileSync(path.join(dir, "security.txt"), "Contact: mailto:preview@example.invalid\nPolicy: Preview site; no secrets are stored in the browser bundle.\n");
  writeFileSync(path.join(dir, "humans.txt"), `Woodward local website preview for ${packet.business.name}\n`);
  writeFileSync(path.join(dir, "llms.txt"), `# ${packet.business.name}\n${packet.business.city} landscape website preview with services, local trust, and estimate pathways.\n`);
}

function writeSite(packet, index) {
  const spec = specFor(packet, index);
  const lane = laneFor(index);
  const project = projectName(packet);
  const dir = path.join(outRoot, project);
  const logoUrl = logoFor(packet);
  const images = imagesFor(packet, spec);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const route of ["services", "gallery", "quote", "source", "package", "privacy", "terms", "about", "process", "service-areas", "faq", "contact"]) {
    mkdirSync(path.join(dir, route), { recursive: true });
  }
  writeFileSync(path.join(dir, "styles.css"), css(spec) + formulaCss() + heroCompositionCss() + v4DivergenceCss());
  writeFileSync(path.join(dir, "site.js"), `document.documentElement.dataset.ready='true';
document.querySelectorAll('[data-choice]').forEach((button) => {
  button.addEventListener('click', () => {
    const group = button.closest('.choice-row,.chip-cloud');
    if (group) group.querySelectorAll('.is-active').forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
    const summary = document.querySelector('[data-estimate-summary]');
    if (summary) summary.textContent = button.dataset.choice + ' · photo-ready';
  });
});
`);
  const video = videoAssetFor(dir, packet, spec, images);
  writeFileSync(path.join(dir, "index.html"), home(packet, spec, images, video, logoUrl, lane));
  writeFileSync(path.join(dir, "services", "index.html"), routePage(packet, spec, logoUrl, "Services", `${packet.business.name} service menu shaped for fast homeowner decisions.`, spec.services.map((service) => [service, serviceCopy(service, spec)])));
  writeFileSync(path.join(dir, "gallery", "index.html"), routePage(packet, spec, logoUrl, "Project gallery", "A production version would use approved owner images; this preview uses recovered source media where available and strong visual direction where not.", images.slice(0, 6).map((url, idx) => [`Frame ${idx + 1}`, url])));
  writeFileSync(path.join(dir, "quote", "index.html"), quotePage(packet, spec, logoUrl));
  writeFileSync(path.join(dir, "about", "index.html"), lane === "premier-multi-page" ? aboutPage(packet, spec, logoUrl, images) : routePage(packet, spec, logoUrl, "About", `${packet.business.name} local landscape profile.`, [["Local footprint", `${packet.business.city} and nearby communities.`], ["Public proof", `${packet.business.rating || "n/a"} rating and ${packet.business.reviewCount || 0} reviews.`]]));
  writeFileSync(path.join(dir, "process", "index.html"), lane === "premier-multi-page" ? processPage(packet, spec, logoUrl) : routePage(packet, spec, logoUrl, "Process", "Photo-first estimate path and walkthrough flow.", [["Scope", "Choose the work."], ["Photos", "Send the trouble spots."], ["Walkthrough", "Confirm timing."]]));
  writeFileSync(path.join(dir, "service-areas", "index.html"), lane === "premier-multi-page" ? serviceAreasPage(packet, spec, logoUrl) : premierContentPage(packet, spec, logoUrl, "Service areas and directions", "Satellite map context and nearby service pins.", "service areas", geoMapBand(packet, spec)));
  writeFileSync(path.join(dir, "faq", "index.html"), lane === "premier-multi-page" ? faqPage(packet, spec, logoUrl) : premierContentPage(packet, spec, logoUrl, "Questions", "Short answers for homeowners.", "FAQ", faqSection(packet, spec)));
  writeFileSync(path.join(dir, "contact", "index.html"), lane === "premier-multi-page" ? contactPage(packet, spec, logoUrl) : quotePage(packet, spec, logoUrl));
  writeFileSync(path.join(dir, "source", "index.html"), sourcePage(packet, spec, logoUrl));
  writeFileSync(path.join(dir, "package", "index.html"), packagePage(packet, spec, logoUrl));
  writeFileSync(path.join(dir, "privacy", "index.html"), routePage(packet, spec, logoUrl, "Privacy", "Minimal preview collection; production analytics and CRM are added only after owner approval.", [["Preview privacy", "No public tracking scripts are required for this preview."]]));
  writeFileSync(path.join(dir, "terms", "index.html"), routePage(packet, spec, logoUrl, "Terms", "Production scope and support terms are finalized before a real customer launch.", [["Preview terms", "This is a non-indexed owner-review preview."]]));
  writeFileSync(path.join(dir, "404.html"), routePage(packet, spec, logoUrl, "Page not found", "The preview route is not available.", [["Return home", "Open the homepage to continue."]]));
  writeFileSync(path.join(dir, "offline.html"), routePage(packet, spec, logoUrl, "Offline", "Reconnect to view this preview.", [["Status", "Offline fallback page."]]));
  writePolishFiles(dir, packet, spec, lane);
  writeFileSync(path.join(dir, "leadminer-source-packet.json"), JSON.stringify(packet, null, 2));
  writeFileSync(path.join(dir, "kitchen-wiring.json"), JSON.stringify({
    kitchenStack,
    spec,
    lane,
    source: {
      logoUrl: logoUrl || "generated preview lockup",
      imageCount: images.length,
      recoveredLogoCandidates: packet.source.logoCandidates?.length || 0,
      recoveredImageCandidates: packet.source.imageCandidates?.length || 0,
      firecrawl: packet.source.firecrawlEnrichment || null,
    },
    video,
  }, null, 2));
  writeFileSync(path.join(dir, "vercel.json"), JSON.stringify({
    cleanUrls: true,
    trailingSlash: true,
    headers: [{ source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "X-Woodward-Preview", value: "ca-landscape-aplus" }] }],
  }, null, 2));

  return {
    business: packet.business.name,
    project,
    url: `https://${project}.vercel.app`,
    theme: spec.theme,
    lane,
    blueprint: spec.blueprint,
    fontPair: `${spec.display} + ${spec.body}`,
    heroVideo: video.ready ? "assets/hero-video.mp4" : "pending Gemini/Veo generation",
    videoStatus: video.ready ? "ready" : "needs_generation",
    sourceStatus: packet.source.status,
    firecrawlSelectedUrl: packet.source.firecrawlEnrichment?.selectedUrl || "",
    logoMode: logoUrl ? "source-recovered" : "proposed-lockup",
    sourceImageCount: packet.source.imageCandidates?.filter((item) => !isBadPhoto(item.url, item.context || "")).length || 0,
    publicRoutes: lane === "premier-multi-page"
      ? ["/", "/services/", "/gallery/", "/quote/", "/about/", "/process/", "/service-areas/", "/faq/", "/contact/", "/source/", "/package/"]
      : ["/", "/services/", "/gallery/", "/quote/", "/service-areas/", "/faq/", "/source/", "/package/"],
  };
}

mkdirSync(outRoot, { recursive: true });
mkdirSync(proofRoot, { recursive: true });
const manifest = packets.map(writeSite);
writeFileSync(path.join(proofRoot, "CA_LANDSCAPE_THREE_KITCHEN_REBUILD_2026-07-06.json"), `${JSON.stringify({
  ok: true,
  generatedAt: new Date().toISOString(),
  build: "A+ production preview rebuild",
  queue: existsSync(enrichedQueue) ? enrichedQueue : baseQueue,
  kitchenStack,
  manifest,
}, null, 2)}\n`);
writeFileSync(path.join(proofRoot, "CA_LANDSCAPE_APLUS_REBUILD_2026-07-06.md"), [
  "# CA Landscape A+ Rebuild",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "What changed:",
  "- Firecrawl enrichment is now consumed when available.",
  "- Source logos are used only when they are real logo/image assets; otherwise a proposed brand lockup is generated.",
  "- Each company uses a different hero anatomy, media shape, layout gravity, and section cadence.",
  "- Homepages are customer-facing local business sites, not internal proof boards.",
  "- Full public route set added: home, services, gallery, quote, source, package, privacy, terms, 404, offline.",
  "- Provider-generated hero video remains the background motion layer.",
  "",
  "Live targets:",
  ...manifest.map((item) => `- ${item.business}: ${item.url} (${item.blueprint}, ${item.logoMode}, ${item.sourceImageCount} source images)`),
  "",
].join("\n"));
console.log(JSON.stringify({ ok: true, count: manifest.length, manifest }, null, 2));
