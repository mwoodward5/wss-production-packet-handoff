"use strict";
// scripts/probe-family-brief.js — the full design brief for familyhvac.net,
// printed where the identity pass can be audited: heroImage, identityImages
// (with the new identityCritical flags), refusals, and the measured mobile
// image URLs the recurrence rule reads.
require("./brightdata-edit-proof/env").loadEnv();

async function main() {
  const { buildDesignBrief } = require("../lib/design-brief");
  const out = await buildDesignBrief("https://www.familyhvac.net/", { crops: false, businessName: "Family Heating & Air Conditioning", timeoutMs: 45000 });
  if (!out.ok) { console.error("brief failed:", out.reason); process.exit(1); }
  const b = out.brief;
  console.log(JSON.stringify({
    accent: b.accent,
    heroImage: b.heroImage,
    identityImages: (b.identityImages || []).map((i) => ({
      url: String(i.url).slice(0, 110), what: i.what, critical: i.identityCritical || false,
      why: i.criticalWhy || null, inFold: i.inFirstViewport, w: i.width, h: i.height,
    })),
    mobileImageUrls: (b.measurements.mobileImageUrls || []).map((u) => String(u).slice(0, 110)),
    surfaceCandidates: (b.measurements.surfaceCandidates || []).slice(0, 4),
    refusals: (b.refusals || []).filter((r) => /identity|hero/i.test(r.field)),
    vision: b.vision && b.vision.ok ? b.vision.model : (b.vision && b.vision.reason),
  }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
