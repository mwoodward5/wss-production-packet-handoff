// Pipeline stage 4 — design: choose hero family, derive layout seed, pick
// motif, plan sections, assemble voice_persona. Deterministic given packet.
import { seedFrom } from "../lib/hero-seed.mjs";
import { emit } from "../lib/emit.mjs";
import { pickLovablePattern } from "../lib/lovable-pattern-catalog.mjs";

const FAMILY_ROTATION = [
  "cinematic-video-parallax",
  "split-editorial-index",
  "service-map-pins",
  "material-lab-swatch",
  "magazine-owner-letter",
  "atlas-grid-reveal",
];

const FAMILY_BY_PREMIUM_PATTERN = {
  "cinematic-overlay": "cinematic-video-parallax",
  "scroll-story": "cinematic-video-parallax",
  "video-cinema": "cinematic-video-parallax",
  "split-editorial": "split-editorial-index",
  "service-atlas": "atlas-grid-reveal",
  "material-configurator": "material-lab-swatch",
  "editorial-letter": "magazine-owner-letter",
  "media-atlas": "atlas-grid-reveal",
  "focused-stack": "service-map-pins",
  "quiet-stack": "split-editorial-index",
};

const MOTIF_BY_TRADE = {
  landscape: "botanical-contour",
  landscaping: "botanical-contour",
  excavation: "survey-grid",
  roofing: "slope-diagram",
  plumbing: "flow-schematic",
  electrical: "circuit-trace",
  hvac: "airflow-vector",
  concrete: "rebar-grid",
  paving: "chevron-topo",
  default: "material-mesh",
};

export function design(packet, { batchIndex = 0 } = {}) {
  emit("design", "start", { slug: packet.slug });

  const trade = normalizeTrade(packet.business.category);
  const premiumPattern = pickLovablePattern({ slug: `${packet.slug}:${batchIndex}`, trade });
  const family = FAMILY_BY_PREMIUM_PATTERN[premiumPattern.id]
    ?? FAMILY_ROTATION[(batchIndex + hashSlug(packet.slug)) % FAMILY_ROTATION.length];
  const seed = seedFrom(packet.slug, trade);

  packet.hero_family = family;
  packet.hero_pattern = {
    id: premiumPattern.id,
    cohort: "newest-100",
    anatomy: premiumPattern.anatomy,
    motion: premiumPattern.motion,
    media: premiumPattern.media,
    typography: premiumPattern.typography,
    mode: premiumPattern.mode,
    capabilities: premiumPattern.capabilities,
  };
  packet.layout_seed = String(seed.seed);
  packet.motif = MOTIF_BY_TRADE[trade] ?? MOTIF_BY_TRADE.default;

  packet.section_plan = planSections(packet, seed);

  packet.voice_persona = packet.voice_persona ?? {
    owner_name: packet.business.name,
    years_in_biz: null,
    first_person_snippets: extractSnippets(packet),
    tone: "confident, specific, local",
  };

  emit("design", "done", {
    family: packet.hero_family,
    premium_pattern: packet.hero_pattern.id,
    motif: packet.motif,
    seed: packet.layout_seed,
    sections: packet.section_plan.length,
  });
  return packet;
}

function normalizeTrade(cat) {
  const c = (cat ?? "").toLowerCase();
  for (const key of Object.keys(MOTIF_BY_TRADE)) {
    if (c.includes(key)) return key;
  }
  return "default";
}

function hashSlug(slug) {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// Section plan is at least 8 authored sections, no more than 2 of the same
// pattern. Order is family-aware.
function planSections(packet, seed) {
  const patternPool = [
    "hero", "before-after-slider", "zigzag-photo-text", "project-storytelling",
    "material-swatch-lab", "service-map", "homeowner-configurator",
    "trust-ledger", "faq-speakable", "process-timeline", "team-portrait",
    "journal-excerpt", "contact-strip-map",
  ];
  const forced = ["hero", "trust-ledger", "faq-speakable", "contact-strip-map"];
  const rest = patternPool.filter((p) => !forced.includes(p));
  const shuffled = [...rest].sort(() => seed.rng() - 0.5);
  return [
    "hero",
    ...shuffled.slice(0, 5),
    "trust-ledger",
    "faq-speakable",
    "contact-strip-map",
  ];
}

function extractSnippets(packet) {
  const copy = packet.enrichment_sources?.copy?.value ?? "";
  if (typeof copy !== "string") return [];
  return copy
    .split(/\n+/)
    .filter((l) => /\b(we|our|us)\b/i.test(l) && l.length > 40 && l.length < 240)
    .slice(0, 5);
}
