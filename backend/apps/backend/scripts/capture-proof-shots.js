#!/usr/bin/env node
"use strict";

// scripts/capture-proof-shots.js — the WRITE half of the proof-shot pipeline.
//
// Run this on a machine that has a real browser. It captures the prospect's
// current website ("old") and their new mirror ("new"), plus a scrolled
// filmstrip frame ("gif"), and uploads all of them to the public
// 'wss-proof-assets' Supabase bucket at the exact object paths that
// /api/media/preview-shot reads back.
//
// Why it is a CLI and not part of the request: the capture needs Playwright's
// Chromium, which lives in a ~1.4 GB machine-level cache that is never inside
// node_modules and therefore never inside a Vercel lambda. Capturing on the
// request path could only ever fail — and it did, silently, serving a 42-byte
// spacer GIF as a healthy HTTP 200 for every before/after image ever sent.
//
// Usage:
//   node scripts/capture-proof-shots.js --preview=https://slug.wss-ai.com/ \
//                                       --current=https://theircurrentsite.com
//   node scripts/capture-proof-shots.js --batch=path/to/pairs.json
//   (batch file: [{ "preview_url": "...", "current_website": "..." }, ...])
//
// Flags:
//   --env-file=<path>  where to read SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//   --skip-existing    do not re-capture a URL that is already stored
//   --mobile           ALSO capture a 375x812 phone frame of each site
//   --dry-run          capture and report sizes, upload nothing
//   --json             machine-readable summary on stdout

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ENV_FILE = "C:/Users/Main/Documents/New project 2/.fable-proof.env";

const {
  PROOF_BUCKET,
  normalizeProofUrl,
  proofObjectPath,
  proofMetaPath,
  registrableDomain,
  capturedShotBelongsTo,
  publicProofUrl,
  ensureProofBucket,
  uploadProofShot,
  fetchProofShot,
} = require("../lib/proof-storage");

// ---------------------------------------------------------------- env / args

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
  const out = { pairs: [], flags: {} };
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    out.flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

// ------------------------------------------------------------------ capture

async function captureOnePair({ previewUrl, currentWebsite, mobile = false }) {
  // Required lazily: this is the only place a browser is needed, and requiring
  // it at module load would make even --help depend on Chromium being present.
  const { generatePreviewVisuals } = require("../lib/preview-visuals");
  return generatePreviewVisuals({ previewUrl, currentWebsite, mobile });
}

async function alreadyStored(objectPath) {
  const hit = await fetchProofShot(objectPath, { timeoutMs: 5000 });
  return hit.ok === true && hit.buffer && hit.buffer.length > 1024;
}

async function storeShot({ url, variant, buffer, finalUrl = "", dryRun, skipExisting, results }) {
  if (!buffer || !buffer.length) {
    results.push({ variant, url, ok: false, reason: "no_capture" });
    return;
  }
  const objectPath = proofObjectPath({ url, variant });
  if (!objectPath) {
    results.push({ variant, url, ok: false, reason: "unkeyable_url" });
    return;
  }
  // WHOSE SITE DID WE ACTUALLY PHOTOGRAPH? A "before" shot is only usable as
  // proof if the browser landed on the prospect's own domain. Refuse to store
  // one that drifted — a stored mismatch is a loaded gun pointed at the next
  // send, and the reader would have to catch it every single time instead.
  const landed = String(finalUrl || "");
  const identity = /^old(-|$)/.test(variant)
    ? capturedShotBelongsTo({ capturedUrl: landed || url, expectedWebsite: url })
    : { ok: true };
  if (!identity.ok) {
    results.push({
      variant, url, objectPath, ok: false,
      reason: `capture_identity_${identity.reason}`,
      landedOn: registrableDomain(landed),
      expected: identity.expected,
    });
    return;
  }
  if (skipExisting && (await alreadyStored(objectPath))) {
    results.push({ variant, url, objectPath, ok: true, skipped: "already_stored", publicUrl: publicProofUrl(objectPath) });
    return;
  }
  if (dryRun) {
    results.push({ variant, url, objectPath, ok: true, bytes: buffer.length, dryRun: true, landedOn: landed });
    return;
  }
  const up = await uploadProofShot(objectPath, buffer, { contentType: "image/jpeg" });
  // The sidecar goes up AFTER the image and is what every reader checks. It is
  // stored at the same content-addressed key so the writer and the reader still
  // never have to talk to each other — see proof-storage.proofMetaPath().
  let meta = { ok: false, reason: "not_attempted" };
  if (up.ok === true) {
    const metaPath = proofMetaPath({ url, variant });
    meta = await uploadProofShot(
      metaPath,
      Buffer.from(JSON.stringify({
        schema: "wss-proof-shot-meta-v1",
        variant,
        requested_url: String(url),
        captured_url: landed || String(url),
        captured_domain: registrableDomain(landed || url),
        bytes: buffer.length,
        captured_at: new Date().toISOString(),
      }, null, 2), "utf8"),
      { contentType: "application/json" },
    );
  }
  results.push({
    variant,
    url,
    objectPath,
    ok: up.ok === true && meta.ok === true,
    bytes: buffer.length,
    reason: up.reason || (meta.ok === true ? undefined : `meta_${meta.reason}`),
    landedOn: landed,
    publicUrl: up.publicUrl || publicProofUrl(objectPath),
  });
}

// --------------------------------------------------------------------- main

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(3, 30).join("\n").replace(/^\/\/ ?/gm, ""));
    return 0;
  }

  const envFile = typeof flags["env-file"] === "string" ? flags["env-file"] : DEFAULT_ENV_FILE;
  const loaded = loadEnvFile(envFile);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (env file: ${envFile}, vars loaded: ${loaded})`);
    return 2;
  }

  // Build the work list.
  const pairs = [];
  if (typeof flags.batch === "string") {
    const raw = JSON.parse(fs.readFileSync(path.resolve(flags.batch), "utf8"));
    for (const row of Array.isArray(raw) ? raw : []) {
      pairs.push({
        previewUrl: String(row.preview_url || row.previewUrl || ""),
        currentWebsite: String(row.current_website || row.currentWebsite || ""),
      });
    }
  }
  if (typeof flags.preview === "string") {
    pairs.push({
      previewUrl: String(flags.preview),
      currentWebsite: typeof flags.current === "string" ? String(flags.current) : "",
    });
  }
  if (!pairs.length) {
    console.error("FATAL: nothing to do — pass --preview=<url> (and optionally --current=<url>) or --batch=<file.json>");
    return 2;
  }

  // The bucket is the contract with the read route. Verify before capturing —
  // spending 30s of browser time only to discover there is nowhere to put the
  // result is the wrong order.
  const bucketReport = await verifyBucket();
  console.log(`bucket ${PROOF_BUCKET}: ${bucketReport.summary}`);
  if (!bucketReport.ok) {
    console.error("FATAL: proof bucket unavailable");
    return 2;
  }

  const dryRun = Boolean(flags["dry-run"]);
  const skipExisting = Boolean(flags["skip-existing"]);
  const mobile = Boolean(flags.mobile);
  const summary = [];

  for (const pair of pairs) {
    const previewUrl = pair.previewUrl.trim();
    const currentWebsite = pair.currentWebsite.trim();
    if (!/^https?:\/\//i.test(previewUrl)) {
      console.error(`skip: preview url is not http(s): ${previewUrl}`);
      continue;
    }

    const started = Date.now();
    console.log(`\ncapture: ${previewUrl}${currentWebsite ? `  (old: ${currentWebsite})` : "  (no current website)"}`);
    const visuals = await captureOnePair({ previewUrl, currentWebsite, mobile });
    if (!visuals || visuals.ok !== true) {
      console.error(`  FAILED: ${(visuals && (visuals.reason || visuals.error)) || "unknown"}`);
      summary.push({ previewUrl, currentWebsite, ok: false, reason: (visuals && visuals.reason) || "capture_failed" });
      continue;
    }

    const results = [];
    if (currentWebsite && visuals.oldJpeg) {
      await storeShot({ url: currentWebsite, variant: "old", buffer: visuals.oldJpeg, finalUrl: visuals.oldFinalUrl, dryRun, skipExisting, results });
    }
    if (visuals.newJpeg) {
      await storeShot({ url: previewUrl, variant: "new", buffer: visuals.newJpeg, finalUrl: visuals.newFinalUrl, dryRun, skipExisting, results });
    }
    if (currentWebsite && visuals.oldMobileJpeg) {
      await storeShot({ url: currentWebsite, variant: "old-mobile", buffer: visuals.oldMobileJpeg, finalUrl: visuals.oldFinalUrl, dryRun, skipExisting, results });
    }
    if (visuals.newMobileJpeg) {
      await storeShot({ url: previewUrl, variant: "new-mobile", buffer: visuals.newMobileJpeg, finalUrl: visuals.newFinalUrl, dryRun, skipExisting, results });
    }
    const frames = Array.isArray(visuals.gifFrames) ? visuals.gifFrames : [];
    if (frames.length) {
      await storeShot({ url: previewUrl, variant: "gif", buffer: frames[frames.length - 1], dryRun, skipExisting, results });
    }

    for (const r of results) {
      const state = r.ok ? (r.skipped || (r.dryRun ? "captured (dry-run)" : "uploaded")) : `FAILED ${r.reason}`;
      console.log(`  ${r.variant.padEnd(10)}  ${String(r.bytes ?? "-").padStart(8)} bytes  ${state}`);
      if (r.objectPath) console.log(`       ${r.objectPath}`);
    }
    summary.push({
      previewUrl,
      currentWebsite,
      ok: results.length > 0 && results.every((r) => r.ok),
      elapsedMs: Date.now() - started,
      results,
    });
  }

  if (flags.json) console.log(`\n${JSON.stringify({ bucket: bucketReport, summary }, null, 2)}`);

  const failures = summary.filter((s) => !s.ok).length;
  console.log(`\ndone: ${summary.length - failures}/${summary.length} pairs fully stored`);
  return failures ? 1 : 0;
}

/**
 * Confirm the proof bucket exists AND is public. A private bucket would make
 * every read 400 and put the spacer straight back, so this is not cosmetic.
 * Creates it as public if it is missing, and says so.
 */
async function verifyBucket() {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = await fetch(`${base}/storage/v1/bucket/${PROOF_BUCKET}`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    if (res.ok) {
      const b = await res.json();
      if (b && b.public === true) return { ok: true, existed: true, public: true, summary: "exists, public" };
      return { ok: false, existed: true, public: false, summary: "EXISTS BUT IS PRIVATE — reads would 400" };
    }
    if (res.status === 404 || res.status === 400) {
      const created = await ensureProofBucket();
      if (created.ok) return { ok: true, existed: false, public: true, summary: "DID NOT EXIST — created as public" };
      return { ok: false, existed: false, summary: `missing and create failed: ${created.reason}` };
    }
    return { ok: false, summary: `bucket probe http ${res.status}` };
  } catch (err) {
    return { ok: false, summary: `bucket probe error: ${String((err && err.message) || err).slice(0, 120)}` };
  }
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => { console.error(err); process.exitCode = 1; });
}

module.exports = { main, verifyBucket, normalizeProofUrl, proofObjectPath };
