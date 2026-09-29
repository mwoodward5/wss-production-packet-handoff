#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const targetArg = args.find((arg) => !arg.startsWith("--"));

function findWorkspaceRoot(start) {
  let dir = path.resolve(start);
  while (true) {
    const hasHandoff = fs.existsSync(path.join(dir, "CODEX_MASTER_HANDOFF.md"));
    const hasKitchens =
      fs.existsSync(path.join(dir, "razzle-fx-kitchen")) &&
      fs.existsSync(path.join(dir, "site-superpowers-kitchen")) &&
      fs.existsSync(path.join(dir, "master-glue-kitchen"));
    if (hasHandoff && hasKitchens) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

const root = findWorkspaceRoot(process.cwd());
const target = targetArg ? path.resolve(process.cwd(), targetArg) : null;

const required = [
  "CODEX_MASTER_HANDOFF.md",
  "razzle-fx-kitchen/START_HERE.md",
  "razzle-fx-kitchen/phrases.json",
  "site-superpowers-kitchen/START_HERE.md",
  "site-superpowers-kitchen/phrases.json",
  "master-glue-kitchen/FIRST_PROMPT_POLISH.md",
  "master-glue-kitchen/polish-rules.json",
  "master-glue-kitchen/phrases.json",
  "master-glue-kitchen/tokens/font-pairs.json",
  "master-glue-kitchen/tokens/type-scales.json",
];

const publicCopyBans = [
  /\bLeadMiner\b/i,
  /\bFirecrawl\b/i,
  /\bthree-kitchen\b/i,
  /\bstatic preview\b/i,
  /\bstatic demo\b/i,
  /\bdemo form\b/i,
  /\bfuture intake\b/i,
  /\bsource packet\b/i,
  /\bfallback media\b/i,
  /\bproof-board\b/i,
  /\binternal proof\b/i,
  /\bmigration\b/i,
  /owner provides approved assets/i,
  /public candidates until/i,
  /these are placeholders/i,
  /clear,\s*plain-language service copy/i,
  /built instead of templated/i,
  /screenshot(?:s)? of the source site/i,
  /firecrawl screenshot/i,
];

const genericFontBans = [
  /font-family:\s*(?:Inter|Poppins|Arial|system-ui|-apple-system)/i,
  /font:\s*900\b/i,
  /font-weight:\s*900\b/i,
];

const repeatedArchitectureClasses = [
  "estateLedger",
  "architectGrid",
  "sunlitLetter",
  "coastalAtlas",
  "stoneBlueprint",
];

function fileExists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", ".vercel"].includes(entry.name)) continue;
      out.push(...walk(full));
    } else if (entry.isFile() && /\.(html|css|tsx?|jsx?)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function checkTarget(targetPath) {
  const files = fs.statSync(targetPath).isDirectory() ? walk(targetPath) : [targetPath];
  const html = files.filter((file) => file.endsWith(".html"));
  const allText = files.map((file) => readText(file)).join("\n");
  const home = html.find((file) => path.basename(file) === "index.html") || html[0];
  const homeText = home ? readText(home) : "";
  const failures = [];
  const warnings = [];

  const hasVideo = /<video\b/i.test(allText);
  const hasCinemagraph = /data-motion-model=["']cinemagraph-pan\+shader["']/i.test(allText)
    && /<canvas\b[^>]*data-cinematic-shader|cinematic-drift/i.test(allText);
  const hasPhotoShader = /data-motion-model=["']photo-light-shader["']/i.test(allText)
    && /data-motion-treatment=["']cinematic-light-shader["']/i.test(allText)
    && /\.cinematic-light\s*\{[^}]*animation\s*:/is.test(allText)
    && /@keyframes\s+premierLight\b/i.test(allText);
  if (!hasVideo && !hasCinemagraph && !hasPhotoShader) {
    failures.push({
      id: "cinematic-hero-media-missing",
      message: "No video, shader, or cinemagraph contract found in the hero.",
    });
  }

  if (hasVideo && !/data-video-status=["'](?:veo-ready|source-ready)["']/i.test(allText)) {
    failures.push({
      id: "provider-video-not-ready",
      message: "Hero video is present without a `veo-ready` or `source-ready` provenance marker.",
    });
  }

  if (hasVideo && !/\.(?:mp4|webm)(?:[?"'])/i.test(allText)) {
    failures.push({
      id: "hero-video-asset-unreferenced",
      message: "Hero video markup does not reference an MP4 or WebM asset.",
    });
  }

  const heavyWeightHits = (allText.match(/font(?:-weight)?:\s*900\b/gi) || []).length;
  if (heavyWeightHits > 12) {
    failures.push({
      id: "all-bold-typography-leak",
      message: `Found ${heavyWeightHits} hard 900-weight font declarations. Typography is still too blunt.`,
    });
  }

  const bannedCopy = publicCopyBans
    .filter((pattern) => pattern.test(allText))
    .map((pattern) => String(pattern));
  if (bannedCopy.length) {
    failures.push({
      id: "placeholder-public-copy",
      message: `Public-facing placeholder/internal copy detected: ${bannedCopy.join(", ")}`,
    });
  }

  const genericFonts = genericFontBans
    .filter((pattern) => pattern.test(allText))
    .map((pattern) => String(pattern));
  if (genericFonts.length) {
    warnings.push({
      id: "generic-font-or-weight-pattern",
      message: `Generic font/weight patterns still appear: ${genericFonts.join(", ")}`,
    });
  }

  const architectureCount = repeatedArchitectureClasses.filter((name) =>
    new RegExp(`\\b${name}\\b`).test(homeText),
  ).length;
  if (architectureCount > 2) {
    failures.push({
      id: "multi-template-css-bundle",
      message: `Home page contains ${architectureCount} layout architecture class families. Batch sites should not ship every sibling template inside one page.`,
    });
  }

  return {
    target: path.relative(root, targetPath),
    filesScanned: files.length,
    htmlFiles: html.length,
    failures,
    warnings,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  root,
  strict,
  required: required.map((rel) => ({ path: rel, exists: fileExists(rel) })),
  polishRules: null,
  target: null,
};

const missing = report.required.filter((item) => !item.exists);
if (missing.length) {
  report.ok = false;
  report.error = `Missing required kitchen/default files: ${missing.map((item) => item.path).join(", ")}`;
} else {
  const polish = JSON.parse(readText(path.join(root, "master-glue-kitchen/polish-rules.json")));
  report.polishRules = {
    version: polish.version,
    rules: Array.isArray(polish.rules) ? polish.rules.length : 0,
    unprompted: Array.isArray(polish.rules)
      ? polish.rules.filter((rule) => rule.unprompted === true).length
      : 0,
  };
  report.ok = true;
}

if (target) {
  report.target = checkTarget(target);
  if (strict && report.target.failures.length) {
    report.ok = false;
  }
}

const outFile = path.join(root, "kitchen-gatecheck.json");
fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}
