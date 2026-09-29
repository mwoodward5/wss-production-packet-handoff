"use strict";
// scripts/probe-site-wear.js — what does a client's site WEAR? The painted
// chrome areas (backgrounds histogram), beside the action colour the brief
// already reports. Evidence for the site-wear accent rule.
//   node scripts/probe-site-wear.js --url https://www.familyhvac.net/
require("./brightdata-edit-proof/env").loadEnv();
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const URL_ = arg("url", "https://www.familyhvac.net/");

async function main() {
  const { captureDesignEvidence, briefFromMeasurement } = require("../lib/design-brief");
  const ev = await captureDesignEvidence(URL_, { mobile: false });
  if (!ev.ok) { console.error("capture failed:", ev.reason); process.exit(1); }
  try {
    const brief = briefFromMeasurement(ev, {});
    const { hexToHsl } = require("../lib/capture-brand");
    const rows = (brief.measurements.surfaceCandidates || []).map((c) => ({
      ...c, hsl: hexToHsl(c.hex),
    }));
    console.log(JSON.stringify({
      url: URL_,
      surface: brief.surface,
      action_accent: brief.accent,
      accent_conf: brief.provenance.accent && brief.provenance.accent.confidence,
      surfaceCandidates: rows,
      accentCandidates: (brief.measurements.accentCandidates || []).slice(0, 5),
    }, null, 1));
  } finally {
    await ev._closePage();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
