// Pipeline stage 5 — SiteForge renderer v6 ("trade-true").
// Replaces 05-build.mjs for SiteForge SaaS builds. Fixes the v5 defects that
// shipped generic output: landscaping-only fallback services, stock Unsplash
// heroes, one dark palette for every business, trade-blind headlines, and
// hardcoded noindex. Every choice below derives from trade + deterministic seed.
// Visual law: docs/launch/ENGINE_VISUAL_STANDARDS.md
import { emit } from "../lib/emit.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { blobToPath, seedFrom } from "../lib/hero-seed.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// ---------------- trade knowledge ----------------
const TRADES = {
  roofing:    { noun: "roof", plural: "roofs", verb: "protect", services: ["Roof replacement", "Storm & hail repair", "Metal roofing", "Roof inspections"], material: ["standing seam", "architectural shingle", "underlayment", "flashing"], hooks: ["Built for the weather {city} actually gets.", "A {noun} that ends the leak-watch for good.", "Storm season is not a surprise. Your {noun} shouldn't act like it."], stat: "roofs restored" },
  landscaping:{ noun: "yard", plural: "landscapes", verb: "shape", services: ["Landscape design", "Paver patios", "Planting & cleanup", "Irrigation"], material: ["flagstone", "drip line", "native planting", "steel edging"], hooks: ["A {noun} that looks tended even in the off-season.", "Outdoor rooms, built for {city} light.", "Grass is easy. A landscape has intent."], stat: "yards transformed" },
  plumbing:   { noun: "plumbing", plural: "systems", verb: "keep flowing", services: ["Repiping", "Water heaters", "Drain cleaning", "Leak detection"], material: ["PEX", "copper", "pressure valve", "clean-out"], hooks: ["Pipes don't wait for morning. Neither do we.", "Quiet {noun} is the whole job.", "Water goes where we tell it in {city}."], stat: "calls answered" },
  electrical: { noun: "wiring", plural: "panels", verb: "power", services: ["Panel upgrades", "EV chargers", "Lighting", "Troubleshooting"], material: ["200-amp panel", "conduit", "GFCI", "load calc"], hooks: ["Clean current, tidy conduit, no surprises on the invoice.", "Your panel should be the most boring thing you own.", "{city} runs on good {noun}. So should your house."], stat: "panels upgraded" },
  hvac:       { noun: "air", plural: "systems", verb: "condition", services: ["AC repair", "Furnace installs", "Duct sealing", "Tune-ups"], material: ["heat pump", "SEER2", "plenum", "refrigerant"], hooks: ["Comfort you stop thinking about.", "Sized right, sealed tight, serviced on time.", "{city} summers negotiated on your behalf."], stat: "systems tuned" },
  excavation: { noun: "ground", plural: "sites", verb: "move", services: ["Site prep", "Grading", "Trenching", "Demolition"], material: ["compaction", "cut and fill", "swale", "base rock"], hooks: ["Dirt has opinions. We negotiate.", "Every build starts with honest {noun}.", "Grade it right once."], stat: "sites prepped" },
  painting:   { noun: "walls", plural: "rooms", verb: "finish", services: ["Interior painting", "Cabinet refinishing", "Color consultation", "Exterior repaint"], material: ["low-VOC", "levelling primer", "cut line", "satin finish"], hooks: ["Color chosen for {city} light, not a swatch card.", "A finish you'll want to touch.", "The last coat is the one people see. We obsess over all of them."], stat: "rooms finished" },
  fencing:    { noun: "fence", plural: "fence lines", verb: "frame", services: ["Cedar privacy fences", "Gates & hardware", "Ranch fencing", "Repairs"], material: ["post-set", "cedar picket", "powder-coat", "gate latch"], hooks: ["Straight lines you can sight down.", "A {noun} that holds its line for decades.", "Good {plural} make patient neighbors."], stat: "fence lines set" },
  "tree care":{ noun: "canopy", plural: "trees", verb: "steward", services: ["Pruning", "Removals", "Health assessments", "Stump grinding"], material: ["crown thinning", "rigging", "root flare", "arborist chip"], hooks: ["Your {plural} are decades old. Hire like it.", "Careful cuts, healthy {noun}.", "{city} shade, kept safe."], stat: "trees cared for" },
  concrete:   { noun: "slab", plural: "pours", verb: "form", services: ["Driveways", "Patios", "Foundations", "Flatwork repair"], material: ["rebar grid", "broom finish", "control joint", "4000 PSI"], hooks: ["Formed square, poured full, cut clean.", "A {noun} is forever. Pour accordingly.", "Concrete rewards patience and preparation."], stat: "pours completed" },
  "pool service": { noun: "pool", plural: "pools", verb: "keep swim-ready", services: ["Weekly pool service", "Equipment repair", "Green-to-clean rescues", "Filter & pump installs"], material: ["salt cell", "variable-speed pump", "DE filter", "water chemistry"], hooks: ["Swim-ready every week of the season.", "A {noun} you never have to think about.", "{city} water, balanced like a pro did it — because one did."], stat: "pools maintained" },
  cleaning:   { noun: "space", plural: "homes", verb: "reset", services: ["Recurring cleans", "Deep cleans", "Move-out cleans", "Post-construction"], material: ["HEPA vac", "microfiber system", "checklist", "green products"], hooks: ["Walk in like it's move-in day.", "A clean you can smell from the porch.", "{city} homes, reset weekly."], stat: "homes reset" },
  solar:      { noun: "array", plural: "systems", verb: "harvest", services: ["Solar installs", "Battery storage", "Panel cleaning", "System audits"], material: ["bifacial panel", "microinverter", "rapid shutdown", "kWh offset"], hooks: ["Your roof has a day job now.", "{city} sun, on your ledger.", "An {noun} sized to the bill, not the brochure."], stat: "systems commissioned" },
  default:    { noun: "work", plural: "projects", verb: "deliver", services: ["Consultations", "Installations", "Maintenance", "Repairs"], material: ["scope", "materials", "schedule", "walkthrough"], hooks: ["Done properly, priced plainly.", "{city} work with a name on it.", "The quote is the price."], stat: "projects delivered" },
};
const tradeOf = (category) => {
  const c = (category || "").toLowerCase();
  for (const k of Object.keys(TRADES)) if (k !== "default" && c.includes(k.split(" ")[0])) return { key: k, ...TRADES[k] };
  if (/tree/.test(c)) return { key: "tree care", ...TRADES["tree care"] };
  return { key: "default", ...TRADES.default };
};

// ---------------- palettes: trade hue × family temperament ----------------
const PALETTES = {
  roofing:    [{ bg: "#F5F1E8", ink: "#231F1A", accent: "#A63D2F", accent2: "#3E5C6B", mode: "light" }, { bg: "#1C2228", ink: "#F2EEE6", accent: "#E0703D", accent2: "#8FB0C0", mode: "dark" }],
  landscaping:[{ bg: "#F7F5EC", ink: "#22281E", accent: "#3E6B3F", accent2: "#B98A2F", mode: "light" }, { bg: "#20281F", ink: "#F1F0E4", accent: "#9BC08A", accent2: "#D9A441", mode: "dark" }],
  plumbing:   [{ bg: "#F2F5F4", ink: "#152528", accent: "#0F6B70", accent2: "#C06B2E", mode: "light" }, { bg: "#12262A", ink: "#EDF4F2", accent: "#4FB3AC", accent2: "#E09154", mode: "dark" }],
  electrical: [{ bg: "#F6F4EF", ink: "#1D1D22", accent: "#B07B10", accent2: "#31456B", mode: "light" }, { bg: "#191A21", ink: "#F3F1E9", accent: "#E8B23A", accent2: "#7C93C4", mode: "dark" }],
  hvac:       [{ bg: "#F3F5F7", ink: "#1B2430", accent: "#2E6188", accent2: "#C46A3B", mode: "light" }, { bg: "#17222C", ink: "#EFF3F6", accent: "#6FA8CD", accent2: "#E0854F", mode: "dark" }],
  excavation: [{ bg: "#F5F0E6", ink: "#26201A", accent: "#8A5A2B", accent2: "#4E5B3F", mode: "light" }, { bg: "#241E17", ink: "#F2ECDF", accent: "#CE9455", accent2: "#93A578", mode: "dark" }],
  painting:   [{ bg: "#FAFAF7", ink: "#232228", accent: "#7D4B9E", accent2: "#C2803B", mode: "light" }, { bg: "#232028", ink: "#F6F4F0", accent: "#B58BD0", accent2: "#DBA55E", mode: "dark" }],
  "pool service": [{ bg: "#F1F7F8", ink: "#12333F", accent: "#0F7B9E", accent2: "#C98A3B", mode: "light" }, { bg: "#0F2A33", ink: "#EAF4F5", accent: "#4FB6D8", accent2: "#E0A45E", mode: "dark" }],
  cleaning:   [{ bg: "#F8F7F4", ink: "#22262A", accent: "#2F7A68", accent2: "#B4552D", mode: "light" }, { bg: "#1D2422", ink: "#F2F4F0", accent: "#7BC0AC", accent2: "#DE8B5B", mode: "dark" }],
  solar:      [{ bg: "#FBF7EE", ink: "#20221E", accent: "#C28A12", accent2: "#33566B", mode: "light" }, { bg: "#1C1E22", ink: "#F6F2E7", accent: "#EFC04A", accent2: "#7FA3BE", mode: "dark" }],
  default:    [{ bg: "#F7F4EE", ink: "#1E1B16", accent: "#B4552D", accent2: "#41604F", mode: "light" }, { bg: "#1E1B16", ink: "#F4F0E7", accent: "#D97E4A", accent2: "#8FAF9B", mode: "dark" }],
};
// Which families default to light editorial vs deep cinematic
const FAMILY_MODE = { "cinematic-video-parallax": "dark", "split-editorial-index": "light", "service-map-pins": "light", "material-lab-swatch": "light", "magazine-owner-letter": "light", "atlas-grid-reveal": "dark" };

const TYPE_PAIRS = [
  { display: "'Fraunces', Georgia, serif", body: "'Archivo', system-ui, sans-serif", import: "Fraunces:opsz,wght@9..144,500..700&family=Archivo:wght@400;600;700" },
  { display: "'Libre Caslon Text', Georgia, serif", body: "'Jost', system-ui, sans-serif", import: "Libre+Caslon+Text:wght@400;700&family=Jost:wght@400;600;700" },
  { display: "'Space Grotesk', system-ui, sans-serif", body: "'Source Serif 4', Georgia, serif", import: "Space+Grotesk:wght@500;700&family=Source+Serif+4:wght@400;600" },
  { display: "'Zilla Slab', Georgia, serif", body: "'Public Sans', system-ui, sans-serif", import: "Zilla+Slab:wght@500;700&family=Public+Sans:wght@400;600;700" },
  { display: "'Newsreader', Georgia, serif", body: "'Figtree', system-ui, sans-serif", import: "Newsreader:opsz,wght@6..72,500..700&family=Figtree:wght@400;600;700" },
];

// Per-trade motif SVG (schematic overlay layer)
function motifSvg(tradeKey, accent, seed) {
  const o = 0.16;
  const m = {
    roofing: `<g fill="none" stroke="${accent}" stroke-width="1.4" opacity="${o}">${[0,1,2,3].map(i=>`<path d="M ${40+i*90} 300 L ${240+i*90} ${120+seed.motifScale*30} L ${440+i*90} 300"/>`).join("")}</g>`,
    landscaping: `<g fill="none" stroke="${accent}" stroke-width="1.2" opacity="${o}">${[0,1,2,3,4].map(i=>`<path d="M -20 ${80+i*70} C 200 ${20+i*70}, 420 ${140+i*70}, 660 ${60+i*70} S 980 ${120+i*70}, 1220 ${70+i*70}"/>`).join("")}</g>`,
    plumbing: `<g fill="none" stroke="${accent}" stroke-width="1.6" opacity="${o}"><path d="M 60 60 H 300 A 40 40 0 0 1 340 100 V 260 A 40 40 0 0 0 380 300 H 640 A 40 40 0 0 1 680 340 V 420"/><circle cx="300" cy="60" r="8"/><circle cx="680" cy="420" r="8"/></g>`,
    electrical: `<g fill="none" stroke="${accent}" stroke-width="1.4" opacity="${o}"><path d="M 40 200 H 260 L 300 120 L 360 280 L 420 160 L 460 200 H 700"/><circle cx="700" cy="200" r="7" fill="${accent}"/><path d="M 200 340 H 380 L 420 300 H 620"/></g>`,
    excavation: `<g fill="none" stroke="${accent}" stroke-width="1.1" opacity="${o}">${[0,1,2,3,4,5].map(i=>`<line x1="${i*160}" y1="0" x2="${i*160}" y2="460"/>`).join("")}${[0,1,2].map(i=>`<line x1="0" y1="${i*160}" x2="1000" y2="${i*160}"/>`).join("")}<path d="M 80 380 L 300 180 L 520 340 L 760 140" stroke-width="2.2"/></g>`,
    default: `<g fill="none" stroke="${accent}" stroke-width="1.2" opacity="${o}">${[0,1,2,3].map(i=>`<circle cx="${300+seed.motifScale*100}" cy="230" r="${70+i*60}"/>`).join("")}</g>`,
  };
  return m[tradeKey] || m.default;
}

// Media plane when no real photo exists: an honest abstract trade-scene (never stock).
function sceneSvg(trade, pal, seed, blob) {
  return `<svg class="hero-media motif-scene" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><clipPath id="blobClip"><path d="${blob}" transform="translate(0,-160) scale(1.0,1.28)"/></clipPath>
    <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.accent}" stop-opacity=".28"/><stop offset="1" stop-color="${pal.accent2}" stop-opacity=".14"/></linearGradient></defs>
    <rect width="1000" height="640" fill="url(#sg)"/>
    <g clip-path="url(#blobClip)"><rect width="1000" height="640" fill="${pal.accent}" opacity=".12"/></g>
    ${motifSvg(trade.key, pal.mode === "light" ? pal.ink : pal.accent, seed)}
  </svg>`;
}

function logoBlock(packet, name, pal) {
  const src = packet.logo_source?.remastered_path || packet.logo_source?.url;
  if (src) return `<img src="${esc(src)}" alt="${esc(name)} logo" height="76" data-role="logo" style="height:76px;width:auto;object-fit:contain">`;
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 76 76'><rect width='76' height='76' rx='18' fill='${pal.accent}'/><text x='38' y='50' font-family='Georgia,serif' font-size='30' font-weight='700' fill='${pal.mode === "light" ? "#fff" : pal.bg}' text-anchor='middle'>${initials}</text></svg>`;
  return `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" alt="${esc(name)} logo monogram" height="76" width="76" data-role="logo" style="height:76px">`;
}

// ---------------- copy ----------------
function headline(trade, biz, seed) {
  const t = pick(trade.hooks, seed.rng);
  return t.replaceAll("{city}", biz.city).replaceAll("{noun}", trade.noun).replaceAll("{plural}", trade.plural);
}
function stats(packet, trade) {
  const src = packet.enrichment_sources ?? {};
  const out = [];
  if (src.years?.value) out.push({ n: `${src.years.value}+`, label: "years in the trade" });
  const svcCount = (packet.services || []).length;
  if (svcCount) out.push({ n: String(svcCount), label: "core services" });
  out.push({ n: packet.business.state, label: `${packet.business.city} based` });
  return out.slice(0, 3);
}

// ---------------- sections ----------------
function sectionHtml(kind, ctx) {
  const { trade, biz, pal, services, seed, phone, quote } = ctx;
  switch (kind) {
    case "services": return `<section class="band services" id="services"><div class="shell">
      <p class="kicker">What we ${esc(trade.verb)}</p><h2>${esc(trade.plural[0].toUpperCase() + trade.plural.slice(1))}, done like we live here.</h2>
      <div class="svc-grid">${services.map((s, i) => `<article class="svc" style="--d:${i * 60}ms"><span class="idx">0${i + 1}</span><h3>${esc(s)}</h3><p>Scoped in plain language, priced before work starts, and finished with a walkthrough — not a disappearing act.</p></article>`).join("")}</div></div></section>`;
    case "process": return `<section class="band alt process"><div class="shell"><p class="kicker">How it goes</p><h2>Four steps. No mystery.</h2>
      <ol class="steps">${["A real conversation about the " + trade.noun, "A written scope with one number on it", "The crew shows up when we said", "A walkthrough before we call it done"].map((s, i) => `<li><b>${i + 1}</b><span>${esc(s)}</span></li>`).join("")}</ol></div></section>`;
    case "materials": return `<section class="band materials"><div class="shell"><p class="kicker">Materials & method</p><h2>The words on our invoices.</h2>
      <div class="mat-row">${trade.material.map((m) => `<span class="mat">${esc(m)}</span>`).join("")}</div>
      <p class="muted">If a line item isn't clear, ask — explaining the work is part of the work.</p></div></section>`;
    case "trust": { const st = stats(ctx.packet, trade);
      return `<section class="band alt trust"><div class="shell"><div class="trust-grid">
      <div><p class="kicker">Why ${esc(biz.city)} calls</p><h2>Local, accountable, findable.</h2><p>${esc(biz.name)} is a ${esc(trade.key === "default" ? biz.category : trade.key)} outfit working in and around ${esc(biz.city)}, ${esc(biz.state)}. The name on the truck is the name on the quote.</p></div>
      <div class="stat-cluster">${st.map((s) => `<div class="bigstat"><b>${esc(s.n)}</b><span>${esc(s.label)}</span></div>`).join("")}</div>
      </div></div></section>`; }
    case "faq": { const faqs = ctx.faqs;
      return `<section class="band faq" id="faq"><div class="shell"><p class="kicker">Fair questions</p><h2>Asked often, answered straight.</h2>
      ${faqs.map(([q, a]) => `<details class="faq"><summary class="speakable">${esc(q)}</summary><p class="speakable">${esc(a)}</p></details>`).join("")}</div></section>`; }
    case "map": return `<section class="band alt area"><div class="shell"><div class="area-grid">
      <svg class="area-map" viewBox="0 0 420 300" role="img" aria-label="Service area centered on ${esc(biz.city)}, ${esc(biz.state)}"><rect width="420" height="300" rx="14" fill="${pal.mode === "light" ? "#fff" : "rgba(255,255,255,.05)"}" stroke="${pal.accent}" stroke-opacity=".25"/><g fill="none" stroke="${pal.accent}" stroke-opacity=".3"><circle cx="210" cy="150" r="46"/><circle cx="210" cy="150" r="88"/><circle cx="210" cy="150" r="126"/></g><circle cx="210" cy="150" r="7" fill="${pal.accent}"/><text x="210" y="128" text-anchor="middle" font-family="inherit" font-size="15" font-weight="700" fill="currentColor">${esc(biz.city)}, ${esc(biz.state)}</text></svg>
      <div><p class="kicker">Service area</p><h2>${esc(biz.city)} and the drives worth making.</h2><p>Based in ${esc(biz.city)}, ${esc(biz.state)}. If you're nearby and unsure, ask — the answer is usually yes.</p>
      ${phone ? `<a class="btn solid" href="tel:${esc(phone.replace(/[^+\d]/g, ""))}">Call ${esc(phone)}</a>` : ""}</div></div></div></section>`;
    case "cta": return `<section class="band cta" id="quote"><div class="shell"><div class="cta-card">
      <div><p class="kicker light">Next step</p><h2>${esc(quote)}</h2><p>Tell us about the ${esc(trade.noun)}. We reply like people, not a ticketing system.</p></div>
      <form class="quote-form" action="mailto:${esc(ctx.email || "hello@example.com")}" method="get">
        <label>Name<input name="name" type="text" autocomplete="name" required></label>
        <label>Phone<input name="phone" type="tel" autocomplete="tel"></label>
        <label>What's going on?<textarea name="body" rows="3"></textarea></label>
        <button class="btn solid" type="submit">Request a quote</button>
      </form></div></div></section>`;
    default: return "";
  }
}

// ---------------- render ----------------
function renderSite(packet) {
  const biz = { name: packet.business?.name ?? "Local Business", category: packet.business?.category ?? "service", city: packet.business?.city ?? "your city", state: packet.business?.state ?? "" };
  const trade = tradeOf(biz.category);
  const seed = seedFrom(packet.slug ?? biz.name, trade.key);
  const family = packet.hero_family ?? "split-editorial-index";
  const mode = FAMILY_MODE[family] ?? (seed.rng() > 0.5 ? "light" : "dark");
  const palPair = PALETTES[trade.key] ?? PALETTES.default;
  const pal = palPair[mode === "light" ? 0 : 1];
  const type = TYPE_PAIRS[Math.floor(seed.rng() * TYPE_PAIRS.length)];
  const blob = blobToPath(seed.blobPoints);
  const services = (packet.services?.length ? packet.services : trade.services).slice(0, 6);
  const phone = packet.enrichment_sources?.phone?.value || packet.business.phone || null;
  const email = packet.enrichment_sources?.email?.value || null;
  const photos = (packet.media?.catalog ?? []).map((m) => m.url).filter(Boolean);
  const h1 = headline(trade, biz, seed);
  const snippets = packet.voice_persona?.first_person_snippets ?? [];
  const intro = snippets[0] ? `“${snippets[0]}”` : `${biz.name} handles ${services.slice(0, 3).join(", ").toLowerCase()} for ${biz.city} with written scopes and a name on every quote.`;
  const quote = pick([`Get the ${trade.noun} looked at this week.`, `A straight quote for the ${trade.noun}.`, `Talk to ${biz.name} today.`], seed.rng);
  const faqs = [
    [`Do you give written quotes?`, `Yes. Every job gets a written scope with one number on it before work starts. The quote is the price.`],
    [`What areas do you cover?`, `We're based in ${biz.city}, ${biz.state} and work the surrounding area. If you're close, ask — the answer is usually yes.`],
    [`Are you the right fit for small ${trade.noun} jobs?`, `Small jobs are how most of ${biz.city} met us. Nothing is beneath the standard.`],
  ];
  const mediaPlane = photos[0]
    ? `<img class="hero-media" src="${esc(photos[0])}" alt="${esc(biz.name)} — recent ${esc(trade.key)} work" loading="eager">`
    : sceneSvg(trade, pal, seed, blob);
  const stats3 = stats(packet, trade);
  const ledger = [...services, `${biz.city} ${biz.state}`, ...trade.material].slice(0, 8);

  // family-specific hero geometry
  const HERO = {
    "cinematic-video-parallax": { grid: "1.15fr .85fr", headSize: "clamp(2.6rem,6vw,4.6rem)", mediaShape: "full", copySide: "left" },
    "split-editorial-index":    { grid: ".9fr 1.1fr",  headSize: "clamp(2.2rem,4.6vw,3.6rem)", mediaShape: "panel", copySide: "right" },
    "service-map-pins":         { grid: "1fr 1fr",     headSize: "clamp(2.2rem,4.8vw,3.7rem)", mediaShape: "map", copySide: "left" },
    "material-lab-swatch":      { grid: "1fr .9fr",    headSize: "clamp(2rem,4.2vw,3.2rem)", mediaShape: "swatches", copySide: "left" },
    "magazine-owner-letter":    { grid: "1.2fr .8fr",  headSize: "clamp(2.1rem,4.4vw,3.4rem)", mediaShape: "portrait", copySide: "left" },
    "atlas-grid-reveal":        { grid: "1fr 1fr",     headSize: "clamp(2.3rem,5vw,3.9rem)", mediaShape: "atlas", copySide: "left" },
  }[family] ?? { grid: "1fr 1fr", headSize: "clamp(2.2rem,5vw,3.8rem)", mediaShape: "panel", copySide: "left" };

  const heroWidget = {
    map: `<div class="widget hero-widget map-widget">${sectionHtml("map", { trade, biz, pal, services, seed, phone, packet }).match(/<svg[\s\S]*?<\/svg>/)[0]}</div>`,
    swatches: `<div class="widget hero-widget swatch-widget">${trade.material.slice(0, 4).map((m, i) => `<div class="swatch-cell" style="--i:${i}"><b>${esc(m)}</b></div>`).join("")}</div>`,
    atlas: `<div class="widget hero-widget atlas-widget">${services.slice(0, 6).map((s, i) => `<div class="cell" style="--i:${i}">${esc(s)}</div>`).join("")}</div>`,
    portrait: `<div class="widget hero-widget letter-widget"><p>${esc(snippets[0] ? snippets[0] : `We started in ${biz.city} with one truck and a rule: the quote is the price.`)}</p><span class="sig">— ${esc(packet.voice_persona?.owner_name ?? biz.name)}</span></div>`,
    panel: `<div class="widget hero-widget quote-widget"><b>${esc(quote)}</b><a class="btn solid" href="#quote">Request a quote</a>${phone ? `<a class="btn line" href="tel:${esc(phone.replace(/[^+\d]/g, ""))}">${esc(phone)}</a>` : ""}</div>`,
    full: `<div class="widget hero-widget quote-widget"><b>${esc(quote)}</b><a class="btn solid" href="#quote">Request a quote</a>${phone ? `<a class="btn line" href="tel:${esc(phone.replace(/[^+\d]/g, ""))}">${esc(phone)}</a>` : ""}</div>`,
  }[HERO.mediaShape];

  const order = ["services", seed.rng() > 0.5 ? "process" : "materials", "trust", seed.rng() > 0.5 ? "materials" : "process", "map", "faq", "cta"]
    .filter((v, i, a) => a.indexOf(v) === i);
  const disabled = new Set(packet.sections_disabled ?? []);
  const sections = order.filter((s) => !disabled.has(s)).map((k) => sectionHtml(k, { trade, biz, pal, services, seed, phone, email, quote, faqs, packet })).join("\n");

  const jsonLd = [
    { "@context": "https://schema.org", "@type": "LocalBusiness", name: biz.name, address: { "@type": "PostalAddress", addressLocality: biz.city, addressRegion: biz.state }, ...(phone ? { telephone: phone } : {}), areaServed: `${biz.city}, ${biz.state}`, description: intro.replace(/[“”]/g, "") },
    { "@context": "https://schema.org", "@type": "Service", serviceType: services[0], provider: { "@type": "LocalBusiness", name: biz.name }, areaServed: `${biz.city}, ${biz.state}` },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "/" }] },
    { "@context": "https://schema.org", "@type": "WebPage", speakable: { "@type": "SpeakableSpecification", cssSelector: [".speakable"] }, name: biz.name },
  ];

  const light = pal.mode === "light";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${packet.forge?.demo ? '<meta name="robots" content="noindex, nofollow">' : ""}
<title>${esc(biz.name)} — ${esc(trade.key === "default" ? biz.category : trade.key)} in ${esc(biz.city)}, ${esc(biz.state)}</title>
<meta name="description" content="${esc(`${biz.name}: ${services.slice(0, 3).join(", ")} in ${biz.city}, ${biz.state}. Written scopes, one number, a name on every quote.`)}">
<meta property="og:title" content="${esc(biz.name)} — ${esc(biz.city)} ${esc(trade.key)}"><meta property="og:description" content="${esc(h1)}"><meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='${pal.accent}'/><text x='16' y='22' font-family='Georgia' font-size='16' font-weight='700' fill='white' text-anchor='middle'>${biz.name[0]}</text></svg>`)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
@import url('https://fonts.googleapis.com/css2?family=${type.import}&display=swap');
:root{--bg:${pal.bg};--ink:${pal.ink};--accent:${pal.accent};--accent2:${pal.accent2};
--muted:${light ? "color-mix(in srgb, " + pal.ink + " 62%, " + pal.bg + ")" : "color-mix(in srgb, " + pal.ink + " 70%, " + pal.bg + ")"};
--line:color-mix(in srgb, var(--ink) 16%, transparent);--panel:${light ? "#ffffff" : "color-mix(in srgb, var(--ink) 7%, var(--bg))"};
--display:${type.display};--body:${type.body};color-scheme:${pal.mode};}
*{box-sizing:border-box}html,body{max-width:100%;overflow-x:clip}img,svg,video{max-width:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);line-height:1.6}
header.top,nav.main{flex-wrap:wrap}
.shell{width:min(1140px,calc(100vw - 40px));margin:0 auto}
h1,h2,h3{font-family:var(--display);line-height:1.12;letter-spacing:-.014em;margin:0 0 .5em}
h2{font-size:clamp(1.6rem,3.4vw,2.4rem)}p{color:var(--muted);max-width:62ch}
.kicker{font-size:.74rem;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:700;margin:0 0 .9rem;display:flex;gap:.6rem;align-items:center}
.kicker::before{content:"";width:22px;height:2px;background:var(--accent)}
.kicker.light{color:${light ? "#fff" : "var(--accent)"}}
.btn{display:inline-flex;align-items:center;gap:.45rem;padding:.72rem 1.3rem;border-radius:${pick(["999px", "10px", "4px"], seed.rng)};font-weight:700;font-size:.95rem;text-decoration:none;border:1.5px solid var(--accent);transition:transform .15s}
.btn:hover{transform:translateY(-1.5px)}
.btn.solid{background:var(--accent);color:${light ? "#fff" : pal.bg}}
.btn.line{color:var(--ink)}
header.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 0;position:relative;z-index:5}
.brand{display:flex;align-items:center;gap:.9rem;text-decoration:none;color:var(--ink)}
.brand b{font-family:var(--display);font-size:1.25rem;line-height:1.1;display:block}
.brand span{font-size:.78rem;color:var(--accent);font-weight:700;letter-spacing:.06em}
nav.main{display:flex;gap:1.1rem;font-size:.92rem;font-weight:600}nav.main a{color:var(--muted);text-decoration:none}nav.main a:hover{color:var(--ink)}
/* hero */
.hero{position:relative;padding:clamp(2.5rem,6vw,5rem) 0 clamp(2.5rem,6vw,4.5rem);overflow:hidden}
.hero-grid{display:grid;grid-template-columns:${HERO.grid};gap:clamp(1.6rem,4vw,3.6rem);align-items:center;position:relative;z-index:2}
${HERO.copySide === "right" ? ".hero-copy{order:2}.hero-stage{order:1}" : ""}
@media(max-width:860px){.hero-grid{grid-template-columns:1fr}.hero-copy{order:0}.hero-stage{order:1}}
.hero h1{font-size:${HERO.headSize};max-width:14ch}
.hero .intro{font-size:1.08rem}
.hero-stage{position:relative;min-height:300px}
.hero-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:${pick(["22px", "8px", "44% 12px 44% 12px"], seed.rng)};box-shadow:0 30px 70px -30px color-mix(in srgb, var(--ink) 45%, transparent)}
.veil{position:absolute;inset:0;z-index:1;background:linear-gradient(${105 + seed.hueRotate}deg, color-mix(in srgb, var(--bg) 88%, transparent) 30%, transparent 62%);pointer-events:none}
.grain{position:absolute;inset:0;z-index:1;opacity:.5;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.05'/%3E%3C/svg%3E")}
.motif-overlay{position:absolute;z-index:0;${seed.motifQuadrant.includes("t") ? "top:-40px" : "bottom:-40px"};${seed.motifQuadrant.includes("l") ? "left:-60px" : "right:-60px"};width:70%;opacity:.9;pointer-events:none}
.kinetic span{display:inline-block;opacity:0;transform:translateY(.4em);animation:rise .55s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes rise{to{opacity:1;transform:none}}
.hero-widget{position:relative;z-index:3;margin-top:1.4rem}
.quote-widget{display:flex;gap:.8rem;flex-wrap:wrap;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1rem 1.2rem;box-shadow:0 18px 44px -22px color-mix(in srgb, var(--ink) 35%, transparent)}
.quote-widget b{font-family:var(--display);font-size:1.05rem;flex:1;min-width:180px}
.swatch-widget{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.swatch-cell{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;padding:.9rem;font-size:.9rem}
.atlas-widget{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}
.atlas-widget .cell{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:.7rem .8rem;font-size:.82rem;font-weight:600;transition:transform .18s,border-color .18s}
.atlas-widget .cell:hover{transform:translateY(-3px);border-color:var(--accent)}
.letter-widget{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.3rem;font-family:var(--display);font-size:1.06rem}
.letter-widget .sig{display:block;margin-top:.7rem;color:var(--accent);font-weight:700;font-size:.9rem}
.map-widget svg{width:100%;height:auto}
.stat-row{display:flex;gap:1.6rem;margin-top:1.6rem;flex-wrap:wrap;position:relative;z-index:2}
.stat-row .stat b{font-family:var(--display);font-size:1.7rem;display:block;color:var(--accent)}
.stat-row .stat span{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.marquee{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:.7rem 0;overflow:hidden;white-space:nowrap;position:relative;z-index:2}
.marquee div{display:inline-block;animation:slide 30s linear infinite;font-family:var(--display);font-size:.95rem;color:var(--muted)}
.marquee span{margin:0 1.4rem}.marquee span::after{content:"·";margin-left:1.4rem;color:var(--accent)}
@keyframes slide{to{transform:translateX(-50%)}}
/* bands */
.band{padding:clamp(2.6rem,6vw,4.6rem) 0}
.band.alt{background:color-mix(in srgb, var(--ink) ${light ? "4%" : "6%"}, var(--bg))}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1rem}
.svc{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1.2rem;transition:transform .18s}
.svc:hover{transform:translateY(-3px)}
.svc .idx{font-size:.72rem;color:var(--accent);font-weight:800;letter-spacing:.14em}
.svc h3{font-size:1.05rem;margin:.4rem 0 .3rem}.svc p{font-size:.88rem;margin:0}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;counter-reset:s}
.steps li{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1.1rem;display:flex;gap:.8rem;align-items:baseline}
.steps b{font-family:var(--display);color:var(--accent);font-size:1.5rem}
.mat-row{display:flex;gap:.6rem;flex-wrap:wrap;margin:.4rem 0 1rem}
.mat{border:1.5px solid var(--accent);border-radius:999px;padding:.35rem 1rem;font-size:.88rem;font-weight:600;color:var(--accent)}
.trust-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:2.4rem;align-items:center}
@media(max-width:820px){.trust-grid,.area-grid,.cta-card{grid-template-columns:1fr!important}}
.stat-cluster{display:grid;gap:1rem}
.bigstat{border-left:4px solid var(--accent);padding-left:1rem}
.bigstat b{font-family:var(--display);font-size:2.1rem;display:block}
.bigstat span{color:var(--muted);font-size:.85rem}
details.faq{border-bottom:1px solid var(--line);padding:.95rem 0}
details.faq summary{font-weight:700;cursor:pointer;list-style:none;font-size:1.02rem;font-family:var(--display)}
details.faq summary::after{content:" +";color:var(--accent)}details.faq[open] summary::after{content:" –"}
.area-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:2.4rem;align-items:center}
.cta-card{display:grid;grid-template-columns:1fr 1fr;gap:2rem;background:${light ? "var(--ink)" : "var(--panel)"};color:${light ? pal.bg : "var(--ink)"};border-radius:18px;padding:clamp(1.6rem,4vw,2.8rem);border:1px solid var(--line)}
.cta-card h2,.cta-card p{color:inherit}
.quote-form{display:grid;gap:.8rem}
.quote-form label{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;display:grid;gap:.3rem}
.quote-form input,.quote-form textarea{font:inherit;padding:.65rem .8rem;border-radius:8px;border:1.5px solid color-mix(in srgb, currentColor 25%, transparent);background:${light ? "rgba(255,255,255,.08)" : "var(--bg)"};color:inherit}
footer{border-top:1px solid var(--line);padding:2rem 0;font-size:.88rem;color:var(--muted)}
footer .shell{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}
@media (prefers-reduced-motion: reduce){.kinetic span{opacity:1;transform:none;animation:none}.marquee div{animation:none}*{transition:none!important}}
</style>
</head>
<body>
<div class="grain" aria-hidden="true"></div>
<header class="top shell">
  <a class="brand" href="#">${logoBlock(packet, biz.name, pal)}<span><b>${esc(biz.name)}</b><span>${esc(biz.city)}, ${esc(biz.state)}</span></span></a>
  <nav class="main"><a href="#services">Services</a><a href="#faq">FAQ</a><a class="btn solid" href="#quote">Get a quote</a></nav>
</header>
<section class="hero" data-hero-anatomy="${esc(family)}" data-layout-signature="${esc(String(seed.seed))}" style="overflow:hidden">
  <div class="grain" aria-hidden="true"></div>
  <svg class="motif-overlay" viewBox="0 0 1000 460" aria-hidden="true">${motifSvg(trade.key, pal.accent, seed)}</svg>
  <div class="shell hero-grid">
    <div class="hero-copy">
      <p class="kicker">${esc(trade.key === "default" ? biz.category : trade.key)} · ${esc(biz.city)}</p>
      <h1 class="kinetic">${h1.split(/\s+/).map((w, i) => `<span style="animation-delay:${i * 60}ms">${esc(w)}</span>`).join(" ")}</h1>
      <p class="intro speakable">${esc(intro)}</p>
      ${heroWidget}
      <div class="stat-row">${stats3.map((s) => `<div class="stat"><b>${esc(s.n)}</b><span>${esc(s.label)}</span></div>`).join("")}</div>
    </div>
    <div class="hero-stage">
      ${mediaPlane}
      <div class="veil" aria-hidden="true"></div>
    </div>
  </div>
  <div class="marquee" aria-hidden="true" style="margin-top:clamp(1.6rem,4vw,3rem)"><div>${ledger.map((l) => `<span>${esc(l)}</span>`).join("")}${ledger.map((l) => `<span>${esc(l)}</span>`).join("")}</div></div>
</section>
<main>
${sections}
</main>
<footer><div class="shell">
  <span>© ${new Date().getFullYear()} ${esc(biz.name)} · ${esc(biz.city)}, ${esc(biz.state)}</span>
  <span>${phone ? `<a href="tel:${esc(phone.replace(/[^+\d]/g, ""))}" style="color:inherit">${esc(phone)}</a> · ` : ""}Licensed & local${packet.forge?.demo ? " · Demo preview by SiteForge" : ""}</span>
</div></footer>
</body>
</html>`;
}

// -----------