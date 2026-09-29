// SiteForge template-library helpers.
// The Lovable workspace inventory can be exported into app/config/template-library.json.
// When that export is not available, this module serves a truthful seed library
// built from the active V7 hero families rather than fabricating project data.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readJsonFile, kebab } from "./util.mjs";
import { HERO_FAMILIES } from "./engine-adapter.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATE_LIBRARY_PATH = path.join(APP_ROOT, "config", "template-library.json");

const CATEGORY_KEYWORDS = {
  roofing: ["roof", "gutter", "storm"],
  landscaping: ["landscap", "lawn", "garden", "hardscape", "yard"],
  plumbing: ["plumb", "pipe", "drain", "water heater"],
  electrical: ["electric", "panel", "lighting"],
  hvac: ["hvac", "air conditioning", "heating", "furnace"],
  "tree care": ["tree", "arbor", "stump"],
  concrete: ["concrete", "paver", "masonry"],
  fencing: ["fence", "gate"],
  painting: ["paint", "coating"],
  "pool service": ["pool", "spa"],
  cleaning: ["clean", "maid", "janitor"],
  "general contracting": ["contract", "remodel", "builder", "construction"],
  excavation: ["excavat", "grading", "dirt"],
  solar: ["solar", "battery"],
  "pest control": ["pest", "termite", "mosquito"],
  "garage door": ["garage"],
};

const FAMILY_HINTS = [
  ["service-map-pins", ["service area", "near me", "multi city", "coverage", "route", "map", "neighborhood"]],
  ["material-lab-swatch", ["material", "finish", "stone", "tile", "color", "paint", "pool", "concrete", "landscap"]],
  ["atlas-grid-reveal", ["gallery", "portfolio", "before", "after", "photo", "case study", "project"]],
  ["magazine-owner-letter", ["family", "owner", "legacy", "local", "trust", "care"]],
  ["split-editorial-index", ["editorial", "premium", "service list", "index", "structured"]],
  ["cinematic-video-parallax", ["cinematic", "motion", "video", "emergency", "dramatic", "storm"]],
];

function familyByKey(key) {
  return HERO_FAMILIES.find((f) => f.key === key) || HERO_FAMILIES[0];
}

function guessCategory(input) {
  const hay = String(input || "").toLowerCase();
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => hay.includes(w))) return category;
  }
  return "local service";
}

export function matchFamilyForTemplate(template = {}, fallbackCategory = "") {
  const hay = [
    template.name,
    template.title,
    template.category,
    template.industry,
    template.description,
    template.tags?.join?.(" "),
    fallbackCategory,
  ].filter(Boolean).join(" ").toLowerCase();
  for (const [family, words] of FAMILY_HINTS) {
    if (words.some((w) => hay.includes(w))) return family;
  }
  const families = HERO_FAMILIES.map((f) => f.key);
  const seed = Array.from(hay).reduce((n, ch) => n + ch.charCodeAt(0), 0);
  return families[seed % families.length];
}

function normalizeTemplate(raw, index = 0) {
  const idRaw = raw.id || raw.project_id || raw.projectId || raw.slug || raw.name || `template-${index + 1}`;
  const name = raw.name || raw.title || raw.project_name || raw.projectName || `Lovable project ${index + 1}`;
  const desc = raw.description || raw.summary || raw.prompt || raw.tagline || "";
  const category = raw.category || raw.industry || guessCategory(`${name} ${desc}`);
  const heroFamily = raw.hero_family || raw.heroFamily || raw.matched_family || matchFamilyForTemplate(raw, category);
  const slug = kebab(raw.slug || `${category}-${name}-${String(idRaw).slice(-6)}`) || `template-${index + 1}`;
  const screenshot = raw.screenshot_url || raw.screenshotUrl || raw.thumbnail_url || raw.thumbnailUrl || raw.image || raw.cover_url || null;
  const sourceUrl = raw.source_url || raw.sourceUrl || raw.url || raw.preview_url || raw.previewUrl || raw.lovable_url || raw.lovableUrl || null;
  const tags = Array.isArray(raw.tags) ? raw.tags : String(raw.tags || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    id: String(idRaw),
    slug,
    name: String(name),
    category: String(category).toLowerCase(),
    description: String(desc || familyByKey(heroFamily).blurb),
    hero_family: familyByKey(heroFamily).key,
    tags,
    screenshot_url: screenshot,
    source_url: sourceUrl,
    source: raw.source || "lovable",
    quality_notes: raw.quality_notes || raw.qualityNotes || [],
  };
}

export function seedLibrary(demos = []) {
  const templates = HERO_FAMILIES.map((f, i) => {
    const demo = demos.find((d) => d.family === f.key);
    const category = ["roofing", "landscaping", "pool service", "general contracting", "tree care", "fencing"][i % 6];
    return normalizeTemplate({
      id: `siteforge-${f.key}`,
      slug: f.key,
      name: f.name,
      category,
      description: f.blurb,
      hero_family: f.key,
      tags: [category, "siteforge-v7", "seed"],
      screenshot_url: demo?.poster || null,
      source_url: demo?.url || null,
      source: "siteforge-seed",
      quality_notes: ["Seeded from the active V7 renderer family until the Lovable project export is supplied."],
    }, i);
  });
  return {
    generated_at: null,
    source: "siteforge-seed",
    source_status: "Lovable workspace is visible, but no project-list endpoint is exposed in this Codex session. Run app/scripts/build-template-library.mjs with an exported Lovable project JSON to replace this seed.",
    workspace_id: process.env.LOVABLE_WORKSPACE_ID || "iDok9ZWs0DhFjLcdWfAT",
    total: templates.length,
    templates,
  };
}

export function loadTemplateLibrary(demos = []) {
  const seed = seedLibrary(demos);
  if (!existsSync(TEMPLATE_LIBRARY_PATH)) return seed;
  const raw = readJsonFile(TEMPLATE_LIBRARY_PATH, null);
  if (!raw) return seed;
  const sourceTemplates = Array.isArray(raw) ? raw : raw.templates;
  if (!Array.isArray(sourceTemplates) || !sourceTemplates.length) return { ...seed, source_status: raw.source_status || seed.source_status };
  const templates = sourceTemplates.map(normalizeTemplate);
  return {
    generated_at: raw.generated_at || null,
    source: raw.source || "lovable-export",
    source_status: raw.source_status || `${templates.length} templates loaded.`,
    workspace_id: raw.workspace_id || "iDok9ZWs0DhFjLcdWfAT",
    inventory_total: Number(raw.inventory_total || templates.length),
    total: raw.total || templates.length,
    templates,
  };
}

export function categories(library) {
  return [...new Set((library.templates || []).map((t) => t.category).filter(Boolean))].sort();
}

export function findTemplate(library, slugOrId) {
  const key = String(slugOrId || "").toLowerCase();
  return (library.templates || []).find((t) => t.slug.toLowerCase() === key || t.id.toLowerCase() === key || t.hero_family === key) || null;
}

export function isCategory(library, value) {
  const key = String(value || "").toLowerCase().replace(/-/g, " ");
  return categories(library).some((c) => c === key || kebab(c) === value);
}

export function filterTemplates(library, { category = "", q = "" } = {}) {
  const cat = String(category || "").toLowerCase().replace(/-/g, " ");
  const query = String(q || "").trim().toLowerCase();
  return (library.templates || []).filter((t) => {
    if (cat && t.category !== cat && kebab(t.category) !== category) return false;
    if (!query) return true;
    const hay = [t.name, t.category, t.description, t.tags.join(" "), t.hero_family].join(" ").toLowerCase();
    return hay.includes(query);
  });
}

export function sitemapUrls(library) {
  const cats = categories(library).map((c) => `/templates/${kebab(c)}`);
  const items = (library.templates || []).slice(0, 80).map((t) => `/templates/${t.slug}`);
  return [...new Set(["/templates", ...cats, ...items])];
}
