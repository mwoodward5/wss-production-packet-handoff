// Bounded prompt-to-edit for delivered builds.
// Edits never mutate HTML directly. They become renderer options + prompt notes,
// then startGeneration re-renders and QC re-grades the new version.
import { HERO_FAMILIES } from "./engine-adapter.mjs";
import { clampStr } from "./util.mjs";

const DISALLOWED = [
  /<\/?[a-z][\s\S]*>/i,
  /\b(script|iframe|onclick|onerror|javascript:|raw html|custom css|inject|bypass qc|skip qc)\b/i,
  /\b(fake|invent|make up)\b.*\b(review|testimonial|award|credential|license|before|after)\b/i,
];

const FAMILY_BY_INTENT = {
  map: "service-map-pins",
  areas: "service-map-pins",
  gallery: "atlas-grid-reveal",
  photos: "atlas-grid-reveal",
  material: "material-lab-swatch",
  pool: "material-lab-swatch",
  owner: "magazine-owner-letter",
  trust: "magazine-owner-letter",
  editorial: "split-editorial-index",
  copy: "split-editorial-index",
  cinematic: "cinematic-video-parallax",
  video: "cinematic-video-parallax",
};

function has(hay, re) {
  return re.test(hay);
}

function familyFor(intents, fallback) {
  for (const intent of intents) {
    const fam = FAMILY_BY_INTENT[intent];
    if (HERO_FAMILIES.some((f) => f.key === fam)) return fam;
  }
  return fallback || null;
}

export function planPromptEdit({ message, last, project, profile }) {
  const raw = clampStr(message, 2000).trim();
  if (!raw) return { ok: false, status: "operator_review", reason: "Empty edit request." };
  if (!last || last.status !== "done") return { ok: false, status: "operator_review", reason: "Run a completed forge before applying prompt edits." };
  if (DISALLOWED.some((re) => re.test(raw))) {
    return { ok: false, status: "operator_review", reason: "Request needs human review because it asks for raw code, a QC bypass, or unsourced proof." };
  }

  const hay = raw.toLowerCase();
  const intents = [];
  if (has(hay, /\b(hero|headline|above the fold|top section|video|cinematic|photo|image)\b/)) intents.push(has(hay, /\b(video|motion|cinematic)\b/) ? "video" : "photos");
  if (has(hay, /\b(map|service[-\s]?area|near[-\s]?me|city|cities|neighborhood|coverage)\b/)) intents.push("map");
  if (has(hay, /\b(gallery|portfolio|project|before|after|photos)\b/)) intents.push("gallery");
  if (has(hay, /\b(material|finish|tile|stone|paint|pool|surface)\b/)) intents.push("material");
  if (has(hay, /\b(owner|family|story|trust|local|about)\b/)) intents.push("owner");
  if (has(hay, /\b(copy|tone|shorter|warmer|premium|plainspoken|headline|cta|call to action)\b/)) intents.push("copy");
  if (has(hay, /\b(faq|question|answer|financ|payment|warranty|maintenance|emergency|same day)\b/)) intents.push("copy");

  const removing = has(hay, /\b(remove|hide|drop|delete|less)\b/);
  const sectionsDisabled = [...(last.sections_disabled || [])];
  const disable = (key) => { if (!sectionsDisabled.includes(key)) sectionsDisabled.push(key); };
  const enable = (key) => {
    const i = sectionsDisabled.indexOf(key);
    if (i >= 0) sectionsDisabled.splice(i, 1);
  };
  if (removing && has(hay, /\b(map|service[-\s]?area|near[-\s]?me)\b/)) disable("service-map");
  if (!removing && has(hay, /\b(map|service[-\s]?area|near[-\s]?me)\b/)) enable("service-map");
  if (removing && has(hay, /\b(gallery|portfolio|photo)\b/)) disable("atlas-grid");

  if (!intents.length) {
    return { ok: false, status: "operator_review", reason: "Request is too open-ended for the bounded edit engine. It was queued for a human operator." };
  }

  const heroFamily = familyFor(intents, last.hero_family || project.hero_family || null);
  const factsGuard = `Use only approved facts for ${profile.business_name} in ${profile.city}, ${profile.state}; do not invent reviews, awards, credentials, guarantees, or before/after proof.`;
  const options = {
    prompt: clampStr(`${last.prompt || ""}\n\nQC-safe edit request: ${raw}\n${factsGuard}`, 4000),
    build_type: last.build_type || "single_page_cinematic",
    hero_family: heroFamily,
    sections_disabled: sectionsDisabled,
    regen_target: "prompt-edit",
    video_prompt: intents.includes("video"),
    rediscover: false,
  };
  return {
    ok: true,
    status: "planned",
    reason: `Bounded intents: ${[...new Set(intents)].join(", ")}`,
    intents: [...new Set(intents)],
    options,
  };
}
