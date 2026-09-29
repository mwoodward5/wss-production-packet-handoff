"use strict";

// scripts/theme-engine-dryrun-proof.js — the THEME, through the REAL engine.
//
// theme-live-preview.js proves the stylesheet works in a browser by splicing it
// into a live page. This proves the other half: that engine.js actually calls
// the theme pass, on a real donor, and that the bytes it is about to ship carry
// the override, the boot script and the toggle.
//
// dry_run stops before any Vercel call (engine.js §11), so this deploys nothing.

const path = require("node:path");
const { mirror } = require("../lib/mirror-engine/engine");
const theme = require("../lib/mirror-engine/theme");

const REQUEST = {
  slug: "wss-theme-dryrun-proof",
  donor: "hvac-premier",
  facts: {
    business_name: "Theme Proof Heating & Air",
    industry: "hvac",
    city: "Columbus",
    state: "OH",
    phone: "(614) 555-0100",
  },
  // accent_source is REQUIRED whenever accent is supplied — the engine will not
  // take a colour without a URL it can run through the third-party denylist.
  brand: {
    accent: "#C53F34",
    accent_source: "https://example.com/theme-proof-logo.svg",
    primary: "#2B1B18",
  },
  // The measured reading of THEIR own site. Omit it and the engine defaults to
  // light and records that it defaulted; supplying a dark one is how a
  // genuinely dark client keeps dark.
  client_surface: { mode: "light", basis: "paper", brightShare: 0.86, darkShare: 0.07 },
};

async function main() {
  const files = {};
  const out = await mirror(REQUEST, {
    dryRun: true,
    deps: {
      // Capture the tree the engine assembled, without touching the network.
      captureFiles: (f) => Object.assign(files, f),
    },
  });

  console.log(`status        ${out.status}`);
  if (!out.ok) {
    console.log(`error         ${out.body && out.body.error}`);
    console.log(JSON.stringify(out.body, null, 2).slice(0, 1500));
    process.exitCode = 1;
    return;
  }

  const checks = out.body.checks || {};
  console.log(`\ncheck.theme   ${JSON.stringify(checks.theme, null, 2)}`);
  console.log(`build_hash    ${out.body.build_hash}`);
  console.log(`renderer      ${out.body.renderer}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
