#!/usr/bin/env node
"use strict";

// scripts/backfill-gallery-thumbnails.js
//
// WHY THIS EXISTS
// ---------------
// The operator gallery (/gallery -> api/admin/gallery-data.js) builds every
// card's thumbnail as signedVisualPath({ kind:"new", previewUrl }). That URL is
// read back by api/media/preview-shot.js, which is a pure read-through proxy:
// it fetches `preview-shots/new/<sha256(normalizedPreviewUrl|new)>.jpg` from the
// public wss-proof-assets bucket and streams it. No object at that key means a
// 42-byte spacer GIF served as a healthy HTTP 200, which the card's
// naturalWidth>=50 check turns into "PREVIEW UNAVAILABLE".
//
// So a missing thumbnail is never a rendering bug. It means nobody ever
// photographed that mirror. Shots are written today only as a side effect of an
// outreach send (lib/line-proof-shots.js), so every mirror that was built but
// not yet emailed has an empty card — which is most of the queue.
//
// This script is the missing writer. It photographs mirrors that are ALREADY
// LIVE and uploads to the exact object key the gallery reads. It needs no
// change to the build lane, and it never invents a picture: a host that is not
// ours, is not reachable, or redirects somewhere else is REFUSED and reported,
// so the card keeps saying "no shot" instead of showing a stranger's website.
//
// Usage:
//   node scripts/backfill-gallery-thumbnails.js --missing-only
//   node scripts/backfill-gallery-thumbnails.js --missing-only --active-only
//   node scripts/backfill-gallery-thumbnails.js --preview=https://slug.wss-ai.com/
//   node scripts/backfill-gallery-thumbnails.js --missing-only --limit=10 --dry-run
//
// Flags:
//   --missing-only   only rows with no stored "new" shot (default when no --preview)
//   --active-only    skip archived_legacy rows
//   --limit=N        stop after N captures
//   --concurrency=N  parallel pages in one browser (default 3)
//   --dry-run        capture, report bytes, upload nothing
//   --env-file=PATH  secrets file (default: the canonical breadcrumb env)
//   --json           machine-readable summary on stdout

const fs = require("node:fs");
const { createHash } = require("node:crypto");

const DEFAULT_ENV_FILE = "C:/Users/Main/Documents/New project 2/.fable-proof.env";

const {
  proofObjectPath,
  proofMetaPath,
  publicProofUrl,
  fetchProofShot,
  uploadProofShot,
  suppressOurPanelsUrl,
  normalizeProofUrl,
} = require("../lib/proof-storage");
const { isApprovedPreviewUrl, previewHostOf } = require("../lib/preview-host-guard");

// The gallery photographs at the card's own aspect (16/10) so the stored JPEG
// is not letterboxed into the tile. object-fit:cover would crop a 4:3 frame.
const VIEWPORT = { width: 1440, height: 900 };
const NAV_TIMEOUT_MS = 45000;

function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return 0;
  let loaded = 0;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) { process.env[key] = value; loaded += 1; }
  }
  return loaded;
}

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return flags;
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

/** Rows the gallery would render, in the same order it renders them. */
async function galleryRows({ activeOnly = false } = {}) {
  const { select } = require("../lib/store");
  const query = [
    "select=prospect_id,status,business_name,city,state,industry,preview_url,report_url,updated_at,record",
    "preview_url=not.is.null",
    "order=updated_at.desc",
    "limit=500",
  ].join("&");
  const result = await select("ghost_agency_prospects", query);
  if (!result || result.ok !== true || !Array.isArray(result.data)) {
    throw new Error(`prospect read failed: ${JSON.stringify(result).slice(0, 200)}`);
  }
  return result.data
    .map((row) => {
      const record = row && row.record && typeof row.record === "object" && !Array.isArray(row.record) ? row.record : {};
      const status = text(row.status || record.status || "unknown");
      return {
        prospectId: text(row.prospect_id),
        businessName: text(record.business_name || record.businessName || row.business_name),
        status,
        archived: status.toLowerCase() === "archived_legacy",
        previewUrl: text(record.preview_url || record.previewUrl || row.preview_url),
      };
    })
    .filter((row) => row.previewUrl)
    .filter((row) => !activeOnly || !row.archived);
}

async function alreadyStored(previewUrl) {
  const objectPath = proofObjectPath({ url: previewUrl, variant: "new" });
  if (!objectPath) return false;
  const hit = await fetchProofShot(objectPath, { timeoutMs: 6000 }).catch(() => null);
  return Boolean(hit && hit.ok === true && hit.buffer && hit.buffer.length > 1024);
}

/**
 * Is this mirror actually up? Spending 30s of browser time on a dead host is
 * the wrong order, and a dead host must produce a REFUSAL, not a picture of an
 * error page stored as this business's homepage.
 */
async function reachable(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "follow" });
    return { ok: res.status === 200, status: res.status, finalUrl: res.url };
  } catch (err) {
    return { ok: false, status: 0, reason: String((err && err.message) || err).slice(0, 90) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Photograph one of our own mirrors.
 *
 * Two refusals are deliberate and are the whole reason this is not just
 * "screenshot the URL":
 *   · the URL must pass the preview-host guard (it is one of ours), and
 *   · the browser must still be on THAT host when the shutter fires. A mirror
 *     that redirects elsewhere yields a perfectly valid JPEG of somebody else's
 *     website, and the object key — derived from the URL we aimed at — cannot
 *     tell the difference. That is exactly how a card ends up showing another
 *     business's site.
 */
async function captureMirror(browser, previewUrl) {
  const wantHost = previewHostOf(previewUrl);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    const target = suppressOurPanelsUrl(previewUrl);
    await page.goto(target, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS }).catch(async () => {
      await page.goto(target, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    });
    await page.waitForTimeout(1500);
    const landed = String(page.url() || "");
    const landedHost = previewHostOf(landed) || (() => {
      try { return new URL(landed).hostname.toLowerCase(); } catch { return ""; }
    })();
    if (!landedHost || landedHost !== wantHost) {
      return { ok: false, reason: "landed_off_host", landed, landedHost, wantHost };
    }
    const buffer = await page.screenshot({ type: "jpeg", quality: 82 });
    return { ok: true, buffer, landed };
  } finally {
    await context.close().catch(() => {});
  }
}

async function storeThumbnail({ previewUrl, buffer, landed, dryRun }) {
  const objectPath = proofObjectPath({ url: previewUrl, variant: "new" });
  if (!objectPath) return { ok: false, reason: "unkeyable_url" };
  if (dryRun) return { ok: true, dryRun: true, bytes: buffer.length, objectPath };

  const up = await uploadProofShot(objectPath, buffer, { contentType: "image/jpeg" });
  if (up.ok !== true) return { ok: false, reason: `upload_failed: ${up.reason || ""}`.slice(0, 140) };

  // The sidecar is what every later reader interrogates. build_hash is left
  // null ON PURPOSE: this picture is keyed to a URL, not to a build, so
  // line-proof-shots must treat it as "predates build keying" and re-shoot at
  // send time rather than reuse it as proof of the current build.
  const shotSha = createHash("sha256").update(buffer).digest("hex");
  const meta = await uploadProofShot(
    proofMetaPath({ url: previewUrl, variant: "new" }),
    Buffer.from(JSON.stringify({
      schema: "wss-proof-shot-meta-v2",
      variant: "new",
      requested_url: String(previewUrl),
      captured_url: String(landed || previewUrl),
      captured_host: previewHostOf(landed || previewUrl),
      normalized_url: normalizeProofUrl(previewUrl),
      bytes: buffer.length,
      build_hash: null,
      shot_sha256: shotSha,
      captured_at: new Date().toISOString(),
      captured_by: "backfill-gallery-thumbnails",
    }, null, 2), "utf8"),
    { contentType: "application/json" },
  );
  return {
    ok: true,
    bytes: buffer.length,
    objectPath,
    publicUrl: publicProofUrl(objectPath),
    metaOk: meta.ok === true,
  };
}

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await worker(items[index], index);
    }
  }));
  return out;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(3, 42).join("\n").replace(/^\/\/ ?/gm, ""));
    return 0;
  }

  const envFile = typeof flags["env-file"] === "string" ? flags["env-file"] : DEFAULT_ENV_FILE;
  loadEnvFile(envFile);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (env file: ${envFile})`);
    return 2;
  }

  const dryRun = Boolean(flags["dry-run"]);
  const limit = Number.parseInt(String(flags.limit || ""), 10);
  const concurrency = Math.max(1, Math.min(6, Number.parseInt(String(flags.concurrency || "3"), 10) || 3));

  let candidates;
  if (typeof flags.preview === "string") {
    candidates = [{ prospectId: "(cli)", businessName: "(cli)", previewUrl: flags.preview, archived: false, status: "cli" }];
  } else {
    candidates = await galleryRows({ activeOnly: Boolean(flags["active-only"]) });
  }
  console.log(`gallery rows carrying a preview_url: ${candidates.length}`);

  // Refuse hosts that are not ours BEFORE anything else. A "new" shot is by
  // definition a picture of a mirror we published.
  const offHost = candidates.filter((row) => !isApprovedPreviewUrl(row.previewUrl));
  const ours = candidates.filter((row) => isApprovedPreviewUrl(row.previewUrl));
  if (offHost.length) console.log(`refused (not an approved wss-ai.com preview host): ${offHost.length}`);

  let work = ours;
  if (flags["missing-only"] !== false && (flags["missing-only"] || typeof flags.preview !== "string")) {
    const stored = await pool(ours, 12, (row) => alreadyStored(row.previewUrl));
    work = ours.filter((_, i) => !stored[i]);
    console.log(`already have a stored thumbnail: ${ours.length - work.length}`);
  }
  if (Number.isFinite(limit) && limit > 0) work = work.slice(0, limit);
  console.log(`to capture: ${work.length}${dryRun ? "  (dry run)" : ""}\n`);
  if (!work.length) return 0;

  // Liveness first — cheap, and it turns a dead host into an honest refusal
  // instead of a screenshot of an error page.
  const live = await pool(work, 10, (row) => reachable(row.previewUrl));
  const up = work.filter((_, i) => live[i].ok);
  const down = work.filter((_, i) => !live[i].ok).map((row, i) => ({ row, probe: live[work.indexOf(row)] }));
  console.log(`live now: ${up.length}/${work.length}`);
  for (const d of down.slice(0, 40)) {
    console.log(`  UNREACHABLE http=${d.probe.status} ${d.probe.reason || ""} ${d.row.previewUrl}`);
  }
  if (!up.length) return 1;

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const summary = [];
  try {
    await pool(up, concurrency, async (row) => {
      const started = Date.now();
      let shot;
      try {
        shot = await captureMirror(browser, row.previewUrl);
      } catch (err) {
        shot = { ok: false, reason: `capture_failed: ${String((err && err.message) || err).slice(0, 110)}` };
      }
      if (!shot.ok) {
        summary.push({ ...row, ok: false, reason: shot.reason, landed: shot.landed || "" });
        console.log(`  REFUSED  ${shot.reason.padEnd(26)} ${row.businessName}`);
        return;
      }
      const stored = await storeThumbnail({ previewUrl: row.previewUrl, buffer: shot.buffer, landed: shot.landed, dryRun });
      summary.push({ ...row, ok: stored.ok, reason: stored.reason, bytes: stored.bytes, objectPath: stored.objectPath, ms: Date.now() - started });
      console.log(`  ${stored.ok ? (dryRun ? "captured " : "STORED   ") : "FAILED   "}${String(stored.bytes ?? "-").padStart(8)}b  ${String(Date.now() - started).padStart(6)}ms  ${row.businessName}${stored.reason ? `  ${stored.reason}` : ""}`);
    });
  } finally {
    await browser.close().catch(() => {});
  }

  const okCount = summary.filter((s) => s.ok).length;
  console.log(`\ndone: ${okCount}/${summary.length} thumbnails stored`);
  if (flags.json) console.log(JSON.stringify({ summary }, null, 2));
  return okCount === summary.length ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => { console.error(err); process.exitCode = 1; });
}

module.exports = { main, captureMirror, storeThumbnail, galleryRows };
