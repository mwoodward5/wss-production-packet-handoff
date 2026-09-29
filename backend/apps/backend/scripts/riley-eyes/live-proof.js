"use strict";

// scripts/riley-eyes/live-proof.js — run the four modules against PRODUCTION.
//
// A passing unit test proves the code does what the fixture says. It does not
// prove the fixture matches the table, and this repo has been burned by exactly
// that gap more than once. So this script signs a real scope token, reads real
// rows, lists the real storage bucket, and prints what Riley would actually be
// handed — including the sentences it would say out loud.
//
//   node scripts/riley-eyes/live-proof.js [siteSlug]

const path = require("node:path");
const BACKEND = path.resolve(__dirname, "..", "..");
require(path.join(BACKEND, "scripts", "brightdata-edit-proof", "env.js")).loadEnv();

const { signScopeToken } = require(path.join(BACKEND, "lib", "dashboard-link.js"));
const { readRileyContext } = require(path.join(BACKEND, "lib", "riley-context.js"));
const { listTenantUploads, resolveUploadForEdit } = require(path.join(BACKEND, "lib", "riley-uploads.js"));
const { loadEditTimings, quoteFor } = require(path.join(BACKEND, "lib", "edit-timing.js"));
const { describeCapability, capabilityBrief } = require(path.join(BACKEND, "lib", "riley-capabilities.js"));

const SLUG = process.argv[2] || "wss-test-poor-john-s-plumbing-parkville";

function head(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

(async () => {
  head(`1. CONTEXT — what Riley sees for ${SLUG}`);
  const token = signScopeToken(SLUG, 1);
  console.log(`scope token minted: ${token ? `yes (${token.length} chars)` : "NO — CONNECT_APP_TOKEN missing"}`);
  const context = await readRileyContext({ scopeToken: token });
  if (!context.ok) {
    console.log("NOT OK:", JSON.stringify(context));
  } else {
    console.log(`business: ${context.business_name} | identity: ${context.identity}`);
    for (const [name, sec] of Object.entries(context.sections)) {
      console.log(`\n  [${name}] ok=${sec.ok} items=${sec.items.length}${sec.note ? `\n    note: ${sec.note}` : ""}`);
      for (const item of sec.items.slice(0, 4)) console.log(`    - ${JSON.stringify(item)}`);
    }
    console.log(`\n  SPOKEN >> ${context.spoken}`);
  }

  head("2. FOREIGN READ — a valid token pointed at someone else's slug");
  // Deliberately derived from the slug under test, so this can never
  // accidentally ask for the SAME site and report a pass it did not earn.
  const otherSlug = `${SLUG}-not-yours`;
  console.log(`asking for: ${otherSlug} with a token signed for ${SLUG}`);
  const foreign = await readRileyContext({ scopeToken: token, siteSlug: otherSlug });
  console.log(JSON.stringify(foreign));
  console.log(foreign.ok === false && foreign.status === 404 ? "PASS — 404 not_found, and not 403" : "FAIL — a foreign slug was readable");

  head("3. TIMING — measured from the real ghost_agency_edit_jobs table");
  const summary = await loadEditTimings({});
  if (!summary) {
    console.log("history unreadable");
  } else {
    console.log(`window ${summary.window_days}d, measured ${summary.measured_at}`);
    const secs = (ms) => (ms == null ? "-" : (ms / 1000).toFixed(1) + "s");
    const rate = (r) => (r == null ? "-" : Math.round(r * 100) + "%");
    const fmt = (s) => [
      "n=" + String(s.samples).padStart(3),
      "terminal=" + String(s.terminal).padStart(3),
      "landed=" + rate(s.landed_rate),
      "p50=" + secs(s.done_p50_ms),
      "p90=" + secs(s.done_p90_ms),
      "max=" + secs(s.done_max_ms),
      "dropped=" + s.discarded,
    ].join(" ");
    for (const [family, stat] of Object.entries(summary.buckets)) console.log(`  ${family.padEnd(15)} ${fmt(stat)}`);
    console.log(`  ${"OVERALL".padEnd(15)} ${fmt(summary.overall)}`);
  }
  for (const instruction of [
    "make the phone number in the header bold",
    "we need a privacy policy page on the site",
    "put that photo I sent on the home page",
    "undo the last change",
    "add my google analytics, the id is G-4Q7RSTVWX2",
  ]) {
    const quote = quoteFor({ instruction, summary });
    console.log(`\n  ASK: ${instruction}`);
    console.log(`  SAY: ${quote.say}`);
    console.log(`  WHY: ${JSON.stringify(quote.basis)}`);
  }

  head("4. UPLOADS — the real bucket, and the composed edit input");
  const listed = await listTenantUploads({ siteSlug: SLUG });
  console.log(`ok=${listed.ok} reason=${listed.reason || "-"} count=${listed.uploads.length}`);
  for (const u of listed.uploads) console.log(`  - ${u.name} | ${u.kind} | ${u.mimetype} | ${u.bytes}B | ${u.at}\n      ${u.url}`);
  for (const message of [
    "put that photo I just sent on the home page",
    "use the picture at https://example.com/truck.jpg for the hero",
    "make the logo bigger",
  ]) {
    const out = await resolveUploadForEdit({ siteSlug: SLUG, message });
    console.log(`\n  ASK: ${message}`);
    console.log(`  OUT: ok=${out.ok} attached=${out.attached === true} reason=${out.reason || "-"} why=${out.why || "-"}`);
    if (out.say) console.log(`  SAY: ${out.say}`);
    if (out.instruction) console.log(`  INSTRUCTION >>>\n${out.instruction.split("\n").map((l) => `      ${l}`).join("\n")}`);
  }

  head("5. CAPABILITY — the executor's real verb list, and the one refusal");
  const brief = capabilityBrief();
  console.log(`verbs (${brief.verbs.length}): ${brief.verbs.map((v) => v.op).join(", ")}`);
  console.log(`CAN DO  >> ${brief.can_do}`);
  console.log(`REFUSAL >> ${brief.refusal}`);
  for (const ask of [
    "make the hero video play sound",
    "hook my site up to QuickBooks",
    "write me a blog post every week",
    "change the headline to say we show up when Columbus gets cold",
  ]) {
    const cap = describeCapability(ask);
    console.log(`\n  ASK: ${ask}\n  -> supported=${cap.supported} op=${cap.op || "-"}${cap.say ? `\n  SAY: ${cap.say}` : ""}`);
  }
})();
