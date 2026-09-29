"use strict";
// scripts/render-outreach-proof-email.cjs — render the step-1 outreach proof
// email to a file so a human can look at it. NOTHING IS SENT: this file has no
// provider call, no recipient argument, and no import of lib/email.js's send
// path. It exists because "the QC gate passed" is not evidence about a design —
// the only evidence is the rendered DOM.
//
// The client data is the Flint Plumbing verified-facts packet, which is the same
// source the owner proof email reads. The accent is MEASURED, live, off the
// client's own logo bytes through lib/mirror-engine/brand-assets.js
// measureAccent — the production path — rather than typed in here, so the render
// demonstrates the real bespoke-accent behaviour instead of a colour I picked.
//
//   node scripts/render-outreach-proof-email.cjs --out=artifacts/outreach-proof-email-v3.html

const fs = require("node:fs");
const path = require("node:path");

const { composeOutreachEmailV2, proofReadiness, pchSubject } = require("../lib/outreach-email-v2");
const { measureAccent, guardedFetch, sniffImage } = require("../lib/mirror-engine/brand-assets");
const design = require("../lib/wss-email-design");

const FACTS = path.join(__dirname, "../artifacts/clients/wss-test-flint-plumbing-s5/verified-facts.json");
const LOGO = "https://wss-test-flint-plumbing-s5.wss-ai.com/assets/client-logo.png";
const PREVIEW = "https://wss-test-flint-plumbing-s5.wss-ai.com/";
const CURRENT = "https://flintplumb.com/";

// The proof shots written by scripts/capture-proof-shots.js, in the public
// proof-asset bucket. Declaring the bucket as WSS_PROOF_ASSETS_BASE_URL is what
// lets composeOutreachEmailV2's first-party image rule accept them — the same
// configuration production runs with. An <img> may only point somewhere we serve.
const BUCKET_ORIGIN = "https://lmniyuftrboqsgrwpwta.supabase.co";
const BUCKET = `${BUCKET_ORIGIN}/storage/v1/object/public/wss-proof-assets/preview-shots`;
const BEFORE = `${BUCKET}/old/5997fccf0d08025af2c0fb8ad4ac3b85be9180323814d6528e4109c9abdde9f2.jpg`;
const AFTER = `${BUCKET}/new/1cf78f8e0838917c73f4dd0864429b9086ad913cd05b0340e8e50daa15bf0090.jpg`;

async function main() {
  process.env.WSS_PROOF_ASSETS_BASE_URL = BUCKET_ORIGIN;

  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outFile = path.resolve(outArg ? outArg.slice("--out=".length) : "artifacts/outreach-proof-email-v3.html");

  const vf = JSON.parse(fs.readFileSync(FACTS, "utf8"));
  const f = vf.facts || {};

  // MEASURE the accent off the client's own logo, exactly as the build does.
  const fetched = await guardedFetch(LOGO);
  const sniffed = sniffImage(fetched.bytes);
  const measured = await measureAccent(fetched.bytes, sniffed.ext);
  if (!measured) throw new Error("accent unmeasurable from the client logo — refusing to invent one");
  const family = design.clientAccent(measured.hex);

  const cta = {
    businessName: f.business_name,
    // MARKETING city, not the postal one. facts.service_area is the client's own
    // published claim about the market they sell into; facts.city is Google's
    // NAP locality and is the only value allowed near a postal address. This
    // email is marketing copy, so it takes service_area — and it must never
    // silently fall back to the other field.
    city: f.service_area,
    industry: f.industry,
    rating: f.rating,
    reviewCount: f.review_count,
    address: f.address,
    logoUrl: LOGO,
    brandColor: measured.hex,
    previewUrl: PREVIEW,
    currentUrl: CURRENT,
    beforeImage: BEFORE,
    afterImage: AFTER,
    beforeImageSource: CURRENT,
    hasBusinessPhotos: true,
    hasReviews: true,
  };

  // THE SAME GATE THE SENDER RUNS. A render that skips it would be a picture of
  // an email the system would refuse to send.
  const readiness = proofReadiness({ cta, previewUrl: PREVIEW, beforeImage: BEFORE, afterImage: AFTER });
  if (!readiness.ok) throw new Error(`proofReadiness refused: ${JSON.stringify(readiness)}`);

  const html = composeOutreachEmailV2({
    cta,
    footer: {
      postal: "655 S Main St, Suite 200, Orange, CA 92868",
      unsubscribe: "https://ghost.wss-ai.com/api/outreach/unsubscribe?token=render-only",
      support: "support@wss-ai.com",
    },
    senderName: "Mark Woodward",
    senderCity: "Mission Viejo, CA",
  });

  fs.writeFileSync(outFile, html);
  const audit = {
    render_only: true,
    recipient: null,
    subject: pchSubject({ businessName: f.business_name, industry: f.industry, city: f.service_area, prospectId: "flint-s5" }),
    accent: {
      measured_hex: measured.hex,
      method: measured.method,
      share: Number(measured.share.toFixed(3)),
      palette: measured.palette,
      source: LOGO,
      resolved: {
        base: family.base,
        onLight: family.onLight,
        onDark: family.onDark,
        buttonBg: family.buttonBg,
        buttonFg: family.buttonFg,
      },
      contrast: {
        onLight_vs_white: Number(design.contrast(family.onLight, "#FFFFFF").toFixed(2)),
        onDark_vs_inkPanel: Number(design.contrast(family.onDark, design.PALETTE.inkPanel).toFixed(2)),
        buttonFg_vs_buttonBg: Number(design.contrast(family.buttonFg, family.buttonBg).toFixed(2)),
      },
    },
    cities: { marketing: f.service_area, postal: f.city, note: "marketing copy takes facts.service_area; facts.city is NAP-only" },
    proofReadiness: readiness,
    images: { before: BEFORE, after: AFTER, count: (html.match(/<img\b/gi) || []).length },
    htmlKB: Number((Buffer.byteLength(html, "utf8") / 1024).toFixed(1)),
  };
  fs.writeFileSync(outFile.replace(/\.html?$/i, "") + "-audit.json", JSON.stringify(audit, null, 2) + "\n");
  console.log(JSON.stringify(audit, null, 2));
  console.log(`\nRENDER ONLY — nothing sent. -> ${outFile}`);
}

main().catch((e) => { console.error("FATAL", e.message); process.exitCode = 1; });
