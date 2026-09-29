"use strict";

// scripts/riley-update-email-sample.js — compose (and optionally send) ONE
// Riley owner-update email for one site, from the real durable store.
//
// This is the SAMPLES lane: no cron calls this, and sends go only to the
// owner's own mailbox (the recipient lock inside lib/riley-update-email.js —
// any other address is refused before a record is read). Run it, open the
// written HTML, and only wire scheduling after the owner approves the look.
//
//   node scripts/riley-update-email-sample.js <siteSlug> [--hours 168] [--send] [--out <path>]
//
//   default        compose only (dry run) and write the HTML next to a JSON
//                  summary line on stdout
//   --hours N      change-log window ending now (default 168 = 7 days)
//   --send         actually send via Resend, to the locked owner recipient
//   --out <path>   where to write the composed HTML (default: %TEMP%)
//
// TRUTH LAW: if the site's change log is empty (or a source read failed) the
// compose REFUSES and nothing is written or sent — that refusal is the
// feature working, not the script failing.

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const { loadEnv } = require("./brightdata-edit-proof/env");
const { sendRileyUpdateEmail } = require("../lib/riley-update-email");

async function main() {
  const args = process.argv.slice(2);
  const siteSlug = args.find((arg) => !arg.startsWith("--"));
  if (!siteSlug) {
    console.error("usage: node scripts/riley-update-email-sample.js <siteSlug> [--hours 168] [--send] [--out <path>]");
    process.exit(2);
  }
  const hoursIndex = args.indexOf("--hours");
  const hours = hoursIndex >= 0 ? Number(args[hoursIndex + 1]) : 168;
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0
    ? args[outIndex + 1]
    : path.join(os.tmpdir(), `riley-update-${siteSlug}.html`);
  const send = args.includes("--send");

  loadEnv(); // canonical breadcrumb secrets; never printed

  const result = await sendRileyUpdateEmail({
    siteSlug,
    windowMs: (Number.isFinite(hours) && hours > 0 ? hours : 168) * 60 * 60 * 1000,
    dryRun: !send,
  });

  if (result.ok && result.mode === "composed") {
    fs.writeFileSync(outPath, result.html, "utf8");
  }
  console.log(JSON.stringify({
    ok: result.ok,
    mode: result.mode || null,
    blocked: result.blocked || null,
    subject: result.subject || null,
    claims: result.claims ?? null,
    counts: result.counts || null,
    window: (result.meta && result.meta.window) || result.window || null,
    id: result.id || null,
    to: result.to || null,
    html_written_to: result.ok && result.mode === "composed" ? outPath : null,
  }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
