#!/usr/bin/env node
// Build app/config/template-library.json from a Lovable project export.
//
// Supported inputs:
//   node app/scripts/build-template-library.mjs --source lovable-projects.json
//   LOVABLE_PROJECTS_EXPORT=lovable-projects.json node app/scripts/build-template-library.mjs
//   node app/scripts/build-template-library.mjs --seed
//
// The Codex Lovable connector can confirm the workspace and template counts,
// but this runtime cannot call MCP tools directly. Feed this script an exported
// project list whenever the connector or Lovable API exposes one.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { writeJsonFile } from "../lib/util.mjs";
import { TEMPLATE_LIBRARY_PATH, seedLibrary, matchFamilyForTemplate } from "../lib/template-library.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function flattenProjects(input) {
  if (Array.isArray(input)) return input;
  for (const key of ["projects", "items", "data", "results", "templates"]) {
    if (Array.isArray(input?.[key])) return input[key];
  }
  if (input?.data && typeof input.data === "object") return flattenProjects(input.data);
  return [];
}

function readSource(source) {
  const fp = path.resolve(source);
  const st = statSync(fp);
  if (st.isDirectory()) {
    const files = readdirSync(fp).filter((f) => f.endsWith(".json")).map((f) => path.join(fp, f));
    return files.flatMap((f) => flattenProjects(JSON.parse(readFileSync(f, "utf8"))));
  }
  return flattenProjects(JSON.parse(readFileSync(fp, "utf8")));
}

function normalize(raw, index) {
  const name = raw.name || raw.title || raw.project_name || raw.projectName || `Lovable project ${index + 1}`;
  const desc = raw.description || raw.summary || raw.prompt || raw.tagline || "";
  const category = raw.category || raw.industry || raw.vertical || raw.trade || "local service";
  const tags = Array.isArray(raw.tags) ? raw.tags : String(raw.tags || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    id: String(raw.id || raw.project_id || raw.projectId || raw.slug || `lovable-${index + 1}`),
    name,
    slug: raw.slug,
    category: String(category).toLowerCase(),
    description: desc,
    tags,
    screenshot_url: raw.screenshot_url || raw.screenshotUrl || raw.thumbnail_url || raw.thumbnailUrl || raw.cover_url || raw.image || null,
    source_url: raw.url || raw.preview_url || raw.previewUrl || raw.lovable_url || raw.lovableUrl || null,
    hero_family: raw.hero_family || raw.heroFamily || matchFamilyForTemplate({ ...raw, name, description: desc, tags }, category),
    source: "lovable-workspace-export",
    quality_notes: raw.quality_notes || [],
  };
}

const source = arg("--source") || process.env.LOVABLE_PROJECTS_EXPORT || process.env.LOVABLE_PROJECTS_JSON;
const seedOnly = process.argv.includes("--seed") || process.argv.includes("--allow-seed");
let output;

if (source) {
  const projects = readSource(source);
  output = {
    generated_at: new Date().toISOString(),
    source: "lovable-export",
    source_status: `${projects.length} Lovable projects imported from ${path.relative(APP_ROOT, path.resolve(source)) || source}.`,
    workspace_id: process.env.LOVABLE_WORKSPACE_ID || "iDok9ZWs0DhFjLcdWfAT",
    total: projects.length,
    templates: projects.map(normalize),
  };
} else if (seedOnly) {
  output = { ...seedLibrary([]), generated_at: new Date().toISOString() };
} else {
  console.error("No Lovable project export supplied. Use --source <json|dir> or --seed for the truthful SiteForge seed library.");
  process.exit(2);
}

writeJsonFile(TEMPLATE_LIBRARY_PATH, output);
console.log(`Template library -> ${TEMPLATE_LIBRARY_PATH}`);
console.log(`${output.templates.length} templates, source=${output.source}`);
