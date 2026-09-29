"use strict";

// scripts/mirror-e2e.js — the finish-line proof: ONE real test-namespace
// mirror end to end. donor in -> hydrated -> deployed -> verified -> aliased
// -> revealable:true. Prints the manifest evidence; never emails anyone.
//
// Usage: node scripts/mirror-e2e.js [envfile]
// Slug stays in the wss-test-* namespace (MIRROR_ALLOW_REAL_SLUGS unset).

const fs = require("node:fs");
const path = require("node:path");

const envFile = process.argv[2];
if (envFile && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "..", "boilerplates");

const { mirror } = require("../lib/mirror-engine/engine");

const request = {
  slug: "wss-test-obrien-and-sons-roofing",
  donor: "roofing-riseabove",
  facts: {
    business_name: "O'Brien & Sons Roofing",
    industry: "roofing",
    city: "Tucson",
    state: "AZ",
    phone: "(520) 555-0142",
    // Adversarial by omission, per the permanent fixture: no rating, no
    // reviews, no license, no owner — every proof element must collapse.
  },
};

(async () => {
  const dryRun = process.argv.includes("--dry-run");
  const started = Date.now();
  const res = await mirror(request, { dryRun });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(JSON.stringify(res.body, null, 2));
  console.log(`\n--- ${dryRun ? "DRY RUN" : "LIVE"} finished in ${elapsed}s, status ${res.status}, revealable=${res.body.revealable} ---`);
  process.exit(res.ok && (dryRun || res.body.revealable) ? 0 : 1);
})().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
