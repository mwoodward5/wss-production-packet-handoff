"use strict";
// scripts/render-v3-polish-mock.cjs — the V3 POLISH MOCK render + owner preview.
//
// V4-REAL (2026-09-02): the owner clicked the v4 mock's links and hit Vercel
// 404s — the fixture prospect was invented. This render is now built from a
// REAL, SENT client record so every link resolves:
//
//   prospect:  Absolute Roofing of Southwest Florida (Naples, FL)
//   source:    POST /api/admin/prospect-raw (saved at
//              artifacts/prospect-raw-absolute-roofing.json), found via
//              GET /api/admin/gallery-data. The mapping below is the same
//              field-for-field mapping the real sender's inputs carry.
//
// STILL OWNER-ONLY: the recipient is hardcoded to woodwardsoftware@gmail.com
// (the owner's own inbox, their own client's data), the subject carries the
// [WSS PREVIEW — v4 — REAL CLIENT RENDER: ABSOLUTE ROOFING] banner, and a
// matching banner is prepended to the HTML. Nothing here can reach a prospect.
//
// WHAT RESOLVES (probed live at build time):
//   preview  -> the client's real, live previewUrl (revealable: true)
//   report   -> the client's real report_url on callprep.wss-ai.com
//   shots    -> signed first-party /api/media/preview-shot URLs minted with
//               GHOST_AGENCY_VISUAL_SECRET (the "after/new" capture is a real
//               95KB JPEG in the bucket). The "old" capture was never landed
//               for this prospect, so beforeImage is honestly ABSENT and the
//               composer's absent-removes law renders the after-only layout —
//               no gray spacer, no fake before.
//   dashboard: HONESTLY ABSENT — the record has no client email and no
//               provisioned PIN row, so there is no dashboard login that
//               resolves; the dashboard door drops (same as the real send).
//
// FLAGS
//   --out=<file>   write the rendered HTML (+ -audit.json). Never sends.
//   --send         send the ONE preview email to OWNER_EMAIL via Resend.

const fs = require("node:fs");
const path = require("node:path");

// Secrets file(s), loaded without overriding what the caller already set.
function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      const current = process.env[m[1]];
      if (current === undefined || current === "") process.env[m[1]] = value;
    }
  } catch { /* optional */ }
}
loadEnvFile(path.join(__dirname, "../.env.mock"));
loadEnvFile("C:/Users/Main/Documents/New project 2/.fable-proof.env");

const { composeOutreachEmailV3, gradeReasonsFromCategories, gradeBarsFromCategories, gradeStrengthsFromCategories } = require("../lib/outreach-email-v3");
const { resolveRileyLine } = require("../lib/riley-line");
const { clientReferenceCode } = require("../lib/client-reference");

const OWNER_EMAIL = "woodwardsoftware@gmail.com"; // the ONLY permitted recipient
const SUBJECT_PREFIX = "[WSS PREVIEW — v4 — REAL CLIENT RENDER: ABSOLUTE ROOFING] ";
const SUBJECT_SUFFIX = ""; // the prefix carries the round marker now

// The real record + the signed first-party shot URLs minted from it.
const RAW_PATH = path.join(__dirname, "../artifacts/prospect-raw-absolute-roofing.json");
const SHOTS_PATH = path.join(__dirname, "../artifacts/shot-urls.txt");

function signedShot(variant) {
  // shot-urls.txt carries one URL per line, "k=<variant>." first on the line.
  const line = fs.readFileSync(SHOTS_PATH, "utf8").split(/\r?\n/).find((l) => l.includes(`k=${variant}.`));
  return line ? line.trim() : "";
}

function buildFixture() {
  const raw = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
  const record = raw.record || {};
  const payload = (raw.lineRows && raw.lineRows[0] && raw.lineRows[0].payload) || {};
  const qual = payload.qualification || {};
  const categories = qual.categories || {};
  const agg = payload.publishedAggregate || {};
  const riley = resolveRileyLine({ allowAgencyLine: true, env: process.env });

  // Shot reality (probed live): only the AFTER capture exists in the bucket;
  // old/old-mobile/new-mobile were never landed, so they are honestly absent.
  const afterShot = signedShot("new");
  const beforeShot = "";

  const reasons = gradeReasonsFromCategories(categories);
  const bars = gradeBarsFromCategories(categories);
  const strengths = gradeStrengthsFromCategories(categories);
  const clientId = clientReferenceCode({ prospect_id: raw.prospectId, record });

  return {
    // REAL PROSPECT — a sent client of the fleet, owner's own data.
    businessName: record.business_name,
    city: record.city,
    previewUrl: payload.previewUrl || record.preview_url || "", // the live mirror
    currentUrl: record.current_website || "",
    reportUrl: record.report_url || "",
    checkoutUrl: "", // no signed checkout minted for a mock — the button drops
    beforeImage: beforeShot,
    afterImage: afterShot,
    beforeMobileImage: "",
    mobileImage: "",
    afterAnimUrl: "",
    afterAnimLane: "",
    rating: agg.rating !== undefined && agg.rating !== null ? String(agg.rating) : "",
    reviewCount: agg.review_count !== undefined && agg.review_count !== null ? String(agg.review_count) : "",
    reviewQuotes: [], // none persisted on the record — the quote card drops
    brandColor: (payload.brand_evidence && payload.brand_evidence.accent) || "",
    grade: qual.overallGrade || "",
    gradeScore: qual.overallScore !== undefined && qual.overallScore !== null ? Number(qual.overallScore) : null,
    gradeReasons: reasons,
    gradeBars: bars,
    gradeStrengths: strengths,
    scannedCount: null, // no scan count on this record — the line drops
    clientId,
    rileyPhone: riley && riley.phone ? riley.phone : "",
    // THE VAPI WEB-CALL SURFACE (final polish, 2026-09-03). The talk-to-Riley
    // web URL — the page hosting the VAPI web widget for the Riley assistant —
    // read from TALK_TO_RILEY_URL when the caller has provisioned it. The big
    // Riley buttons prefer it and NEVER dial; the phone number is its own
    // underlined text link. Absent here (not provisioned yet) => the buttons
    // fall back to the live site's chat surface, by the composer's own law.
    talkToRileyUrl: String(process.env.TALK_TO_RILEY_URL || "").trim(),
    dashboardUrl: "",
    dashboardEmail: "",
    dashboardPin: "",
    dashboardMagicLink: "",
    expiresAt: record.preview_expires_at || "",
    postalAddress: "",
    unsubUrl: "",
    connectIncluded: true,
    ownerProof: true, // footer carries the "Owner-only Practice proof" note
  };
}

// The mock banner, prepended to the HTML so nobody can mistake this render for
// a live send even if it is forwarded without its subject line.
function mockBanner() {
  return `<div style="background:#7A2E2E;border:1px solid #A04444;border-radius:10px;padding:12px 16px;margin:0 12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;font-weight:700;color:#FFFFFF;text-align:center;letter-spacing:.04em">
    &#9888; WSS PREVIEW &mdash; v4 &mdash; REAL CLIENT RENDER: ABSOLUTE ROOFING<br>
    <span style="font-weight:400;font-size:12px">Owner-only review of your own client's real send assets &mdash; every link on this page resolves (preview, report, shots). Not a live campaign send; no prospect received this email.</span>
  </div>`;
}

function rawId() {
  try {
    return JSON.parse(fs.readFileSync(RAW_PATH, "utf8")).prospectId;
  } catch { return ""; }
}

function build() {
  const fixture = buildFixture();
  const { subject, preheader, html, text } = composeOutreachEmailV3(fixture);
  const prefixedSubject = SUBJECT_PREFIX + subject + SUBJECT_SUFFIX;
  const banneredHtml = html.replace(
    /(<div style="display:none;max-height:0;overflow:hidden;opacity:0">[\s\S]*?<\/div>)/,
    `$1${mockBanner()}`,
  );
  const linkAudit = {};
  for (const m of banneredHtml.matchAll(/<a href="(https:[^"]+)"/g)) {
    try {
      const host = new URL(m[1]).host;
      linkAudit[host] = (linkAudit[host] || 0) + 1;
    } catch { /* ignore */ }
  }
  const audit = {
    render_only_preview: true,
    branch: "zcode/v3-polish-mock",
    real_client_render: {
      prospectId: rawId(),
      businessName: "Absolute Roofing of Southwest Florida (Naples, FL)",
      source: "POST /api/admin/prospect-raw -> artifacts/prospect-raw-absolute-roofing.json",
      links_that_resolve: {
        preview: fixture.previewUrl,
        report: fixture.reportUrl,
        afterShot: fixture.afterImage,
        riley: "agency line (live)",
        riley_web_call: fixture.talkToRileyUrl || "not provisioned — buttons fall back to the preview #chat surface; phone number renders as its own tel: text link",
      },
      honestly_absent: {
        beforeShot: "no old-site capture in the bucket — after-only layout",
        dashboard: "no client email and no provisioned PIN row — the door drops",
        checkout: "no signed checkout minted for a mock",
        quotes: "none persisted on the record",
      },
      hosts_linked: linkAudit,
    },
    subject: prefixedSubject,
    preheader,
    fixture_field_map: {
      businessName: "record.business_name",
      city: "record.city",
      previewUrl: "lineRows[0].payload.previewUrl",
      reportUrl: "record.report_url",
      currentUrl: "record.current_website",
      rating: "payload.publishedAggregate.rating (verified_facts_resolver)",
      reviewCount: "payload.publishedAggregate.review_count",
      brandColor: "payload.brand_evidence.accent (verified)",
      grade: "payload.qualification.overallGrade + overallScore (really measured)",
      gradeReasonsBarsStrengths: "computed from payload.qualification.categories by the composer's own exported functions",
      clientId: "clientReferenceCode({prospect_id}) — the derived WSS-XXXXXX form",
    },
    htmlKB: Number((Buffer.byteLength(banneredHtml, "utf8") / 1024).toFixed(1)),
    pronounCheck: { her: (banneredHtml.match(/\bher\b/gi) || []).length, she: (banneredHtml.match(/\bshe\b/gi) || []).length, him: (banneredHtml.match(/\bhim\b/gi) || []).length, his: (banneredHtml.match(/\bhis\b/gi) || []).length },
  };
  return { prefixedSubject, preheader, banneredHtml, text, audit, fixture };
}

async function send({ prefixedSubject, preheader, banneredHtml, text }) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) throw new Error("RESEND_API_KEY missing — pull it with `vercel env pull .env.mock --environment production` or export it, then retry --send");
  const from = process.env.GHOST_AGENCY_RESEND_FROM || "Woodward Software <hello@wss-ai.com>";
  const payload = { from, to: [OWNER_EMAIL], reply_to: "hello@wss-ai.com", subject: prefixedSubject, html: banneredHtml, text };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RESEND FAILED ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return { id: body.id, to: OWNER_EMAIL, from };
}

async function main() {
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outFile = path.resolve(outArg ? outArg.slice("--out=".length) : "../mock-v3-polished.html");
  const built = build();

  if (outArg) {
    fs.writeFileSync(outFile, built.banneredHtml);
    fs.writeFileSync(outFile.replace(/\.html?$/i, "") + "-audit.json", JSON.stringify(built.audit, null, 2) + "\n");
    console.log(`html ${built.audit.htmlKB}KB -> ${outFile}`);
    console.log(`audit          -> ${outFile.replace(/\.html?$/i, "") + "-audit.json"}`);
  }

  if (process.argv.includes("--send")) {
    const sent = await send(built);
    console.log(`SENT -> id=${sent.id} to=${sent.to} from=${sent.from}`);
    if (outArg) {
      fs.writeFileSync(outFile.replace(/\.html?$/i, "") + "-sent.json", JSON.stringify({ ...sent, subject: built.prefixedSubject, at: new Date().toISOString() }, null, 2) + "\n");
    }
  } else {
    console.log("RENDER ONLY — nothing sent (add --send for the one owner preview).");
  }
  if (!outArg && !process.argv.includes("--send")) {
    console.log("usage: node scripts/render-v3-polish-mock.cjs --out=<file> [--send]");
  }
}

main().catch((e) => { console.error("FATAL", e.message); process.exitCode = 1; });
