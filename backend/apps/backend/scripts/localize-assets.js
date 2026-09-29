"use strict";

// scripts/localize-assets.js — MANUAL TRIGGER for the localize-on-signup job.
//
// The same job the fulfillment webhook runs (lib/asset-ownership.localizeBuild),
// but driven by hand for backfill, re-runs, or when an operator wants to take
// ownership of a customer's assets outside the checkout path.
//
// Usage:
//   node scripts/localize-assets.js <build.json> [--out <path>] [--dry] [--no-snapshot]
//
//   <build.json>   a build/mirror-request object carrying brand.photos /
//                  brand.logo / brand.photo_bank (their-host urls).
//   --out <path>   where to write the rewritten build (default: <build>.localized.json)
//   --dry          list what WOULD be localized; upload nothing, write nothing.
//   --no-snapshot  ignore the snapshot bucket; always fetch live.
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment (loaded
// from the breadcrumb env). In --dry mode no credentials are needed.

const fs = require("node:fs");
const path = require("node:path");

const { collectAssetUrls, localizeBuild } = require("../lib/asset-ownership");
const { defaultAssetStores } = require("../lib/client-asset-store");

function loadEnvBestEffort() {
  try {
    require("./brightdata-edit-proof/env").loadEnv();
  } catch { /* --dry does not need it */ }
}

function parseArgs(argv) {
  const args = { _: [], out: "", dry: false, snapshot: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") args.dry = true;
    else if (a === "--no-snapshot") args.snapshot = false;
    else if (a === "--out") args.out = argv[++i] || "";
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const buildPath = args._[0];
  if (!buildPath) {
    console.error("usage: node scripts/localize-assets.js <build.json> [--out <path>] [--dry] [--no-snapshot]");
    process.exitCode = 2;
    return;
  }
  const abs = path.resolve(buildPath);
  const build = JSON.parse(fs.readFileSync(abs, "utf8"));

  if (args.dry) {
    const refs = collectAssetUrls(build);
    console.log(`DRY RUN — ${refs.length} their-host asset(s) would be localized:`);
    for (const r of refs) console.log(`  [${r.role}] ${r.url}`);
    return;
  }

  loadEnvBestEffort();
  const { permanent, snapshot } = defaultAssetStores(process.env);
  if (!permanent.configured) {
    console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required (none found). Use --dry to preview.");
    process.exitCode = 2;
    return;
  }
  await permanent.ensureBucket();
  if (args.snapshot && snapshot.configured) await snapshot.ensureBucket();

  const result = await localizeBuild({
    build,
    permanentStore: permanent,
    snapshotStore: args.snapshot ? snapshot : null,
  });

  const outPath = args.out
    ? path.resolve(args.out)
    : abs.replace(/\.json$/i, "") + ".localized.json";
  fs.writeFileSync(outPath, JSON.stringify(result.build, null, 2));

  console.log(`localized ${result.localized}/${result.attempted} asset(s) (${result.usedSnapshot} from snapshot)`);
  for (const r of result.rewrites) {
    console.log(`  ${r.to ? "REHOST" : "DROP  "} [${r.role}] ${r.from}${r.to ? `\n     -> ${r.to}` : "  (fail-safe: accent/pattern)"}`);
  }
  if (result.fellBack.length) {
    console.log(`\n${result.fellBack.length} asset(s) fell back (dead + no snapshot):`);
    for (const f of result.fellBack) console.log(`  ${f.url}  (${f.reason})`);
  }
  console.log(`\nrewritten build -> ${outPath}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
