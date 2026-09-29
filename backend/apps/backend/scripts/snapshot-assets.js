"use strict";

// scripts/snapshot-assets.js — MANUAL / BATCH TRIGGER for snapshot insurance.
//
// Run this at the moment we EMAIL a prospect (the send route also records a
// `ghost_agency_asset_snapshot_requested` event a drain worker can read). It
// copies the exact bytes the build references into the PRIVATE, TTL-bounded
// snapshot bucket, so a prospect who cancels their old host before they sign up
// can still be localized from our copy.
//
// Usage:
//   node scripts/snapshot-assets.js <build.json> [--dry]
//   node scripts/snapshot-assets.js --urls <a.jpg,b.png,...> [--dry]
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (loaded from the breadcrumb
// env). --dry needs no credentials.

const fs = require("node:fs");
const path = require("node:path");

const { collectAssetUrls, snapshotReferencedAssets } = require("../lib/asset-ownership");
const { defaultAssetStores } = require("../lib/client-asset-store");

function loadEnvBestEffort() {
  try { require("./brightdata-edit-proof/env").loadEnv(); } catch { /* --dry ok */ }
}

function parseArgs(argv) {
  const args = { _: [], dry: false, urls: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") args.dry = true;
    else if (a === "--urls") args.urls = argv[++i] || "";
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let build = null;
  let urls = null;
  if (args.urls) {
    urls = args.urls.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (args._[0]) {
    build = JSON.parse(fs.readFileSync(path.resolve(args._[0]), "utf8"));
  } else {
    console.error("usage: node scripts/snapshot-assets.js <build.json> | --urls a,b,c  [--dry]");
    process.exitCode = 2;
    return;
  }

  if (args.dry) {
    const refs = urls
      ? urls.map((u) => ({ url: u, role: "url" }))
      : collectAssetUrls(build);
    console.log(`DRY RUN — ${refs.length} asset(s) would be snapshotted:`);
    for (const r of refs) console.log(`  [${r.role || "url"}] ${r.url}`);
    return;
  }

  loadEnvBestEffort();
  const { snapshot } = defaultAssetStores(process.env);
  if (!snapshot.configured) {
    console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required (none found). Use --dry to preview.");
    process.exitCode = 2;
    return;
  }
  await snapshot.ensureBucket();

  const res = await snapshotReferencedAssets({ build, urls, snapshotStore: snapshot });
  console.log(`snapshotted ${res.snapshotted.length}/${res.attempted} asset(s), ${res.bytes} bytes, TTL ${res.ttlDays}d`);
  if (res.dead.length) {
    console.log(`already dead (404/410) at snapshot time — logged, not an error:`);
    for (const d of res.dead) console.log(`  ${d.status}  ${d.url}`);
  }
  if (res.errors.length) {
    console.log(`transient/store errors (worth a retry):`);
    for (const e of res.errors) console.log(`  ${e.reason}  ${e.url}`);
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
