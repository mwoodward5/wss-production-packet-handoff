#!/usr/bin/env node
// Create a preview deployment of the SiteForge public site on Vercel.
// Production is deployed only by Vercel's Git integration after a reviewed PR
// is merged to main. Reads VERCEL_TOKEN and VERCEL_TEAM_ID from the environment
// or .env.local.
//   node app/scripts/deploy-vercel.mjs [--project siteforge-web]
import "../lib/env.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const DIRECT_PRODUCTION_REQUESTED = ARGS.some((arg, index) => {
  const normalized = arg.toLowerCase();
  return normalized === "--prod"
    || normalized === "--production"
    || normalized === "--target=production"
    || (normalized === "--target" && ARGS[index + 1]?.toLowerCase() === "production");
});
if (DIRECT_PRODUCTION_REQUESTED) {
  console.error("Direct production deployment is disabled.");
  console.error("Open a PR for a Vercel preview, then merge the reviewed PR to main.");
  console.error("Vercel's Git integration is the only production deployment path.");
  process.exit(2);
}

const TOKEN = process.env.VERCEL_TOKEN;
const TEAM = process.env.VERCEL_TEAM_ID || "team_d1RUoZ8HnmCsYLmbqEtHdrb3";
const PROJECT = ARGS.includes("--project") ? ARGS[ARGS.indexOf("--project") + 1] : "siteforge-web";
if (!TOKEN) {
  console.error("✖ VERCEL_TOKEN not set. Create one at vercel.com/account/settings/tokens (scope: Woodward Software Systems) and put it in .env.local");
  process.exit(2);
}

// 1. Fresh static export
const DIST = path.join(APP_ROOT, "..", "web", "dist");
console.log("⚒ exporting static bundle…");
const ex = spawnSync(process.execPath, [path.join(APP_ROOT, "scripts", "export-static.mjs"), DIST], { stdio: "inherit" });
if (ex.status !== 0) process.exit(1);

// 2. Collect files (trim heavy demo artifacts: keep hero posters, drop the rest)
const files = [];
const skip = /(?:^|\/)(packet\.json|qc-report\.(json|html)|veo_prompt\.json)$/;
const shot = /screenshots\/(desktop|mobile)\/(hero|mid|footer|full)\.png$/;
(function walk(dir, base = "") {
  for (const name of readdirSync(dir)) {
    const fp = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const st = statSync(fp);
    if (st.isDirectory()) { walk(fp, rel); continue; }
    if (skip.test(rel)) continue;
    if (shot.test(rel) && !/desktop\/hero\.png$/.test(rel)) continue; // posters only
    files.push({ rel, buf: readFileSync(fp) });
  }
})(DIST);
const totalMb = (files.reduce((n, f) => n + f.buf.length, 0) / 1048576).toFixed(1);
console.log(`⚒ uploading ${files.length} files (${totalMb} MB)…`);

// 3. Upload each file by sha (v2/files), then create the deployment
const api = (p, opts = {}) => fetch(`https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${TEAM}`, {
  ...opts, headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
});
const manifest = [];
for (const f of files) {
  const sha = createHash("sha1").update(f.buf).digest("hex");
  const r = await api("/v2/files", { method: "POST", headers: { "x-vercel-digest": sha, "Content-Length": String(f.buf.length), "Content-Type": "application/octet-stream" }, body: f.buf });
  if (!r.ok && r.status !== 200) { const t = await r.text(); if (!t.includes("already exists") && r.status !== 409) { console.error(`✖ upload ${f.rel}: ${r.status} ${t.slice(0, 120)}`); process.exit(1); } }
  manifest.push({ file: f.rel, sha, size: f.buf.length });
  process.stdout.write(".");
}
console.log("\n⚒ creating preview deployment…");
const dep = await api("/v13/deployments", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: PROJECT, files: manifest, projectSettings: { framework: null } }),
});
const data = await dep.json();
if (!dep.ok) { console.error("✖ deployment failed:", JSON.stringify(data.error || data).slice(0, 300)); process.exit(1); }
console.log(`\n✔ preview deployed: https://${data.url}`);
console.log(`  project: ${PROJECT} · target: preview · id: ${data.id}`);
console.log("  production: reviewed PR merge to main via Vercel Git integration only");
console.log(`  inspect: https://vercel.com/${TEAM.startsWith("team_") ? "rocketsites" : TEAM}/${PROJECT}`);
