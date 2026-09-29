"use strict";

// hero-reel-runner.js — THE MISSING PRODUCER for the couture hero rung.
//
// The whole consume side of record.media_bank.hero_reel has been finished for
// some time: heroReelBlock (lib/mirror-lane-build.js) earns the ride on three
// gates, brand-assets fetches and byte-sniffs the URL, the engine places it on
// the donor's client_video_path slot, all 13 donor ladders arm it, and the
// render proof polls it to readyState 4. What the repo did NOT have was a
// single line anywhere that WRITES media_bank.hero_reel — the pipe had no
// upstream, so every mirror ever built rode the donor's shared fallback clip.
// This module is that upstream:
//
//   ensureHeroReel(prospectRow)  pick 2-6 of the client's own banked
//                                photographs (+ their verified logo), compose
//                                the 12s crossfade reel with lib/hero-compose,
//                                upload it to the public proof bucket, hand
//                                back { ok, url, composed_from, bytes }.
//   patchHeroReel(id, reel)      write the reel onto the prospect record so
//                                heroReelBlock finds it on the NEXT build.
//
// RUNTIME CONSTRAINT, HONORED FIRST: ffmpeg is NOT in the Vercel lambda —
// lib/hero-compose.js:82-96 documents the trap in blood (favicon.js and
// measureAccent both hit it before). So the very first thing ensureHeroReel
// does is PROBE for a working ffmpeg (FFMPEG_PATH, then PATH) and return
// { ok:false, reason:"ffmpeg_unavailable" } cleanly when there is none. A
// build flow that sees that refusal proceeds exactly as today: heroReelBlock
// returns {}, and the donor fallback-clip ladder carries the hero. This module
// is only ever USEFUL on the Chromium build host / local forge lane, where
// ffmpeg genuinely exists — but it is SAFE everywhere.
//
// FAIL-SOFT EVERYWHERE. Nothing here throws into a build. Every path resolves
// to { ok:true, ... } or { ok:false, reason }, in the composer's own idiom.
//
// ---------------------------------------------------------------------------
// RETIRED FROM THE AUTOMATIC PATH, 2026-08-21 — READ BEFORE WIRING THIS UP.
// ---------------------------------------------------------------------------
// This composer is a CROSSFADE SLIDESHOW, and a slideshow reads as a
// slideshow. The default producer for the couture hero rung is now the Google
// Ads AI Studio (Veo 3) image-to-video Station
// (lib/hero-reel-orchestrator.js + scripts/ads-station/veo-clip-runner.cjs),
// which animates two of the SAME client photographs into a real ten-second
// clip.
//
// Nothing here was deleted, because a host without the owner's signed-in
// Chrome still deserves a documented way to make something. But it is now
// reachable ONLY by asking for it by name:
//
//   · POST /api/admin/hero-reel { prospect_id, producer:"hero_compose_local" }
//   · the GHOST_AGENCY_HERO_REEL_PREBUILD hook in lib/full-run.js
//
// The orchestrator will NOT start it and will not fall back to it. That is the
// point: when the Station refuses, the honest outcome is a mirror on the
// donor's fallback rung with a named reason — not a mirror quietly wearing a
// substitute nobody chose. patchHeroReel() below is shared by both producers
// on purpose: one writer, one shape, one set of ride gates.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const { composeHeroVideo } = require("./hero-compose");
const { uploadProofShot, publicProofUrl } = require("./proof-storage");
const { bankFromRecord } = require("./client-photo-bank");
const {
  isDurableHeroProducer,
  isLegacyComposeProducer,
} = require("./hero-video-policy");
const store = require("./store");

const PROSPECTS_TABLE = "ghost_agency_prospects";
const GENERATOR = "hero_compose_local";

// ---------------------------------------------------------------------------
// THE RIDE GATES — the same three checks heroReelBlock applies at
// lib/mirror-lane-build.js:619-622, duplicated here rather than required from
// there because pulling all of mirror-lane-build into this module (and into
// the admin route that uses it) would drag the entire lane behind a three-line
// predicate. If the gates ever change THERE, the rung test
// (test/hero-reel-rung.test.js) and the runner test both pin the contract.
// ---------------------------------------------------------------------------
function reelEarnsTheRide(reel) {
  if (!reel || typeof reel !== "object") return false;
  if (!/^https:\/\//i.test(String(reel.url || ""))) return false;
  const generator = String(reel.generator || "");
  if (!isDurableHeroProducer(generator) && !isLegacyComposeProducer(generator)) return false;
  if (!Array.isArray(reel.composed_from) || !reel.composed_from.length) return false;
  if (isLegacyComposeProducer(generator)) return true;
  const proof = reel.provenance && typeof reel.provenance === "object" ? reel.provenance : null;
  if (!proof || String(proof.generator || "") !== generator || !String(proof.hero_job_id || "")) return false;
  if (generator !== "openrouter_seedance") return proof.kind === "client_derived_reel";
  return proof.kind === "seedance_generated"
    && proof.checkpoint_schema === "wss.hero.seedance_provider_checkpoint.v1"
    && String(proof.provider_job_id || "")
    && String(proof.attempt_id || "")
    && /^[a-f0-9]{64}$/i.test(String(proof.output_sha256 || ""));
}

// ---------------------------------------------------------------------------
// THE FFMPEG PROBE
// ---------------------------------------------------------------------------

/**
 * probeFfmpeg() -> { ok:true, bin } | { ok:false, reason:"ffmpeg_unavailable" }
 *
 * FFMPEG_PATH wins when it names a real file; bare "ffmpeg" on PATH is the
 * fallback. When FFMPEG_PATH resolves, its directory is PREPENDED to
 * process.env.PATH — hero-compose spawns bare "ffmpeg"/"ffprobe" and resolves
 * them through PATH, so without this hop an operator's explicit FFMPEG_PATH
 * would pass the probe here and then miss inside the composer. Adding one
 * directory to PATH is additive and idempotent; nothing is removed.
 *
 * The probe actually RUNS `-version` rather than stat-ing the file: a binary
 * for the wrong architecture stats fine and then ENOENTs/exits nonzero, and
 * "enabled ≠ wired" is the exact lie this codebase has been burned by.
 */
async function probeFfmpeg({ execFileImpl = execFile, env = process.env } = {}) {
  let bin = "ffmpeg";
  const explicit = String(env.FFMPEG_PATH || "").trim();
  if (explicit) {
    try {
      if (fs.statSync(explicit).isFile()) {
        bin = explicit;
        const dir = path.dirname(explicit);
        const sep = process.platform === "win32" ? ";" : ":";
        const parts = String(env.PATH || "").split(sep);
        if (!parts.includes(dir)) env.PATH = [dir, ...parts].join(sep);
      }
    } catch { /* a bad FFMPEG_PATH falls through to plain PATH resolution */ }
  }
  const ran = await new Promise((resolve) => {
    try {
      execFileImpl(bin, ["-version"], { timeout: 10000, windowsHide: true }, (error) => {
        resolve(!error);
      });
    } catch {
      resolve(false);
    }
  });
  if (!ran) return { ok: false, reason: "ffmpeg_unavailable" };
  return { ok: true, bin };
}

// ---------------------------------------------------------------------------
// PHOTO SELECTION
// ---------------------------------------------------------------------------

/**
 * pickReelPhotos(bank, { maxPhotos }) -> ranked bank rows, best first.
 *
 * The bank (lib/client-photo-bank) already did the hard truth work — ownership
 * (notTheirPicture), grading, near-duplicate collapse — so selection here is
 * pure preference over rows that are ALL already the client's own media:
 *
 *   1. hero-grade photographs first — the bank's own judgment of what carries
 *      a hero slot;
 *   2. then the bank's rank (lower is better — rank IS the product, the same
 *      order that decides which photos a visitor sees in the donor's slots);
 *   3. bigger pixels break ties — the reel supersamples and crops, and a small
 *      source is the one artifact a slow Ken Burns push cannot hide;
 *   4. stock-caption suspects sink to the back: they passed ownership, but a
 *      photograph whose filename smells of a stock library only rides when
 *      there are not enough clean ones to fill the reel.
 *
 * Only https URLs are usable at all — the ride gate refuses http, so spending
 * an encode on one would produce a reel that can never ship.
 */
function pickReelPhotos(bank, { maxPhotos = 6 } = {}) {
  const rows = (bank && Array.isArray(bank.photos) ? bank.photos : [])
    .filter((p) => p && /^https:\/\//i.test(String(p.url || "")));
  const score = (p) => [
    p.stock_caption_suspect ? 1 : 0,
    p.grade === "hero" ? 0 : 1,
    Number.isFinite(Number(p.rank)) ? Number(p.rank) : Number.MAX_SAFE_INTEGER,
    -((Number(p.width) || 0) * (Number(p.height) || 0)),
  ];
  return rows
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => {
      for (let i = 0; i < a.s.length; i++) if (a.s[i] !== b.s[i]) return a.s[i] - b.s[i];
      return 0;
    })
    .map(({ p }) => p)
    .slice(0, maxPhotos);
}

/** The storage folder for this prospect's reel: the mirror's slug when one is
 * established (the rung test's canonical URL shape is `<slug>/hero-reel.mp4`),
 * else the prospect id — both sanitized to what an object path can carry. */
function reelSlug(prospectRow = {}) {
  const record = (prospectRow && prospectRow.record) || {};
  for (const url of [record.preview_url, prospectRow.preview_url]) {
    const m = String(url || "").match(/^https:\/\/([a-z0-9-]+)\.wss-ai\.com(\/|$)/i);
    if (m) return m[1].toLowerCase();
  }
  const id = String(prospectRow.prospect_id || prospectRow.prospectId || "").trim();
  return id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown-prospect";
}

// ---------------------------------------------------------------------------
// DOWNLOADS — the composer eats local files, the bank stores URLs.
// ---------------------------------------------------------------------------

async function downloadTo(file, url, { fetchImpl = fetch, timeoutMs = 20000, maxBytes = 20 * 1024 * 1024 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal });
    if (!res.ok) return { ok: false, reason: `fetch_${res.status}` };
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (!buffer.length) return { ok: false, reason: "empty_body" };
    // A "photo" past this cap is not a photo — refuse before ffmpeg spends a
    // second on it, and before the temp dir eats a stray video file.
    if (buffer.length > maxBytes) return { ok: false, reason: "too_large" };
    fs.writeFileSync(file, buffer);
    return { ok: true, bytes: buffer.length };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// THE PRODUCER
// ---------------------------------------------------------------------------

/**
 * ensureHeroReel(prospectRow, opts) ->
 *   { ok:true, url, composed_from, bytes, generator, composed_at, reused? }
 *   | { ok:false, reason, detail? }
 *
 * `prospectRow` is the ghost_agency_prospects row shape (prospect_id + record);
 * a prospect-like object with the same two fields works identically.
 *
 * "ensure", not "make": a reel already on the record that passes the ride
 * gates is returned as-is (`reused:true`) unless opts.force — composing the
 * same twelve seconds twice buys nothing and re-uploading moves the CDN key
 * for no reason.
 *
 * Every dependency is injectable for tests: probe (the ffmpeg prober),
 * compose (composeHeroVideo), upload (uploadProofShot), fetchImpl, publicUrl,
 * now, tmpRoot. Production callers pass nothing.
 */
async function ensureHeroReel(prospectRow, opts = {}) {
  const {
    force = false,
    probe = probeFfmpeg,
    compose = composeHeroVideo,
    upload = uploadProofShot,
    publicUrl = publicProofUrl,
    fetchImpl = fetch,
    now = () => new Date().toISOString(),
    tmpRoot = os.tmpdir(),
    maxPhotos = 6,
  } = opts;

  let workDir = null;
  try {
    const record = (prospectRow && prospectRow.record) || {};

    // Reuse before any probe: an existing provenanced reel is the answer even
    // on a host with no ffmpeg at all.
    const existing = record.media_bank && record.media_bank.hero_reel;
    if (!force && reelEarnsTheRide(existing)) {
      return {
        ok: true,
        reused: true,
        url: String(existing.url),
        composed_from: existing.composed_from.slice(),
        generator: String(existing.generator),
        composed_at: String(existing.composed_at || ""),
      };
    }

    // THE HARD CONSTRAINT, front and center: no ffmpeg, no reel, no drama.
    const ff = await probe();
    if (!ff || ff.ok !== true) return { ok: false, reason: "ffmpeg_unavailable" };

    // The client's own banked photography — record.photo_bank or
    // record.build_ready.photo_bank, whichever shape the row is in.
    const bank = bankFromRecord(record);
    if (!bank) return { ok: false, reason: "no_photo_bank" };
    const picked = pickReelPhotos(bank, { maxPhotos });
    if (picked.length < 2) {
      // The honest reason a mirror stays on the fallback rung: we do not have
      // enough of their work to make a reel out of. Same sentence the
      // composer itself uses, so the two refusals read as one vocabulary.
      return { ok: false, reason: "need_at_least_two_photos", detail: `have:${picked.length}` };
    }

    workDir = fs.mkdtempSync(path.join(tmpRoot, "hero-reel-"));

    // Downloads are individually fail-soft: one dead CDN link drops ONE photo,
    // not the reel — unless the survivors dip below the composer's floor.
    const localPhotos = [];
    const composedFrom = [];
    const dropped = [];
    for (let i = 0; i < picked.length; i++) {
      const row = picked[i];
      const file = path.join(workDir, `photo-${i}${row.ext ? `.${String(row.ext).replace(/[^a-z0-9]/gi, "")}` : ".jpg"}`);
      const got = await downloadTo(file, row.url, { fetchImpl });
      if (!got.ok) { dropped.push(`${got.reason}:${String(row.url).slice(0, 80)}`); continue; }
      localPhotos.push(file);
      // Provenance rides as the bank's content sha when it has one — the same
      // key the engine joins photos on — and the URL when it does not.
      composedFrom.push(String(row.sha256 || row.url));
    }
    if (localPhotos.length < 2) {
      return { ok: false, reason: "photo_download_failed", detail: dropped.slice(0, 3).join(" | ") };
    }

    // The verified mark, optional and never fatal — hero-compose already
    // treats a missing logo as "their reel, unwatermarked", and so do we.
    let logoPath = null;
    const logoUrl = String(record?.build_ready?.brand_evidence?.logo_url || "");
    if (/^https:\/\//i.test(logoUrl)) {
      const logoFile = path.join(workDir, "logo");
      const gotLogo = await downloadTo(logoFile, logoUrl, { fetchImpl });
      if (gotLogo.ok) logoPath = logoFile;
    }

    const outPath = path.join(workDir, "hero-reel.mp4");
    const composed = await compose({ photos: localPhotos, logoPath, outPath });
    if (!composed || composed.ok !== true) {
      return {
        ok: false,
        reason: String((composed && composed.reason) || "compose_failed"),
        ...(composed && composed.detail ? { detail: composed.detail } : {}),
      };
    }

    const bytes = fs.readFileSync(composed.path || outPath);
    const objectPath = `${reelSlug(prospectRow)}/hero-reel.mp4`;
    const uploaded = await upload(objectPath, bytes, { contentType: "video/mp4" });
    if (!uploaded || uploaded.ok !== true) {
      return { ok: false, reason: "upload_failed", detail: String((uploaded && uploaded.reason) || "") };
    }
    const url = String(uploaded.publicUrl || publicUrl(objectPath) || "");
    if (!/^https:\/\//i.test(url)) {
      // A reel the ride gate would refuse is not a success, whatever the
      // storage call said — this is the misconfigured-base-URL case.
      return { ok: false, reason: "public_url_not_https", detail: url.slice(0, 120) };
    }

    return {
      ok: true,
      url,
      composed_from: composedFrom.slice(0, localPhotos.length),
      generator: GENERATOR,
      composed_at: now(),
      bytes: bytes.length,
      object_path: objectPath,
      encode: {
        durationSec: composed.durationSec,
        photosUsed: composed.photosUsed,
        logo: composed.logo === true,
        encodeMs: composed.encodeMs,
      },
    };
  } catch (e) {
    // The contract is "never throws into a build".
    return { ok: false, reason: "unexpected_error", detail: String((e && e.message) || e).slice(0, 200) };
  } finally {
    if (workDir) {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* a leftover temp dir is not worth a failure */ }
    }
  }
}

// ---------------------------------------------------------------------------
// THE RECORD PATCH
// ---------------------------------------------------------------------------

/**
 * patchHeroReel(prospectId, reel, opts) -> { ok:true, prospect_id } | { ok:false, reason }
 *
 * Writes record.media_bank.hero_reel so heroReelBlock finds it at the next
 * request assembly. The write is read-merge-upsert on the WHOLE record column
 * — the exact pattern lib/line-delivery.js uses for proof_shots — because
 * upsertRow's Prefer:merge-duplicates merges COLUMNS, not JSON leaves; writing
 * { record: { media_bank } } bare would erase everything else the record
 * holds. (And the arg order is (table, ROW, conflict) — the order that
 * silently no-opped three writes once already; copied verbatim from a proven
 * call site, never from memory.)
 *
 * The reel is validated against the ride gates BEFORE the write: persisting a
 * reel heroReelBlock would refuse is a record that lies about having a hero.
 */
async function patchHeroReel(prospectId, reel, opts = {}) {
  const {
    select = store.select,
    upsertRow = store.upsertRow,
    now = () => new Date().toISOString(),
  } = opts;
  try {
    const id = String(prospectId || "").trim();
    if (!id) return { ok: false, reason: "missing_prospect_id" };
    if (!reelEarnsTheRide(reel)) return { ok: false, reason: "reel_fails_ride_gates" };

    const found = await select(
      PROSPECTS_TABLE,
      `select=*&prospect_id=eq.${encodeURIComponent(id)}&limit=1`,
    ).catch(() => null);
    const row = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
    if (!row) return { ok: false, reason: "prospect_not_found" };

    const record = row.record && typeof row.record === "object" ? row.record : {};
    const mediaBank = record.media_bank && typeof record.media_bank === "object" ? record.media_bank : {};
    // Only the provenance fields the consumers read travel; runner-side
    // bookkeeping (bytes, encode timings) stays out of the durable record.
    const stored = {
      url: String(reel.url),
      generator: String(reel.generator || GENERATOR),
      composed_from: reel.composed_from.slice(),
      composed_at: String(reel.composed_at || now()),
      ...(reel.provenance ? { provenance: { ...reel.provenance } } : {}),
      ...(reel.poster_url ? { poster_url: String(reel.poster_url) } : {}),
    };

    const persisted = await upsertRow(PROSPECTS_TABLE, {
      prospect_id: id,
      record: { ...record, media_bank: { ...mediaBank, hero_reel: stored } },
      updated_at: now(),
    }, "prospect_id");

    if (!persisted || typeof persisted.mode !== "string") {
      return { ok: false, reason: "persist_failed" };
    }
    if (persisted.mode === "dry_run") return { ok: false, reason: "store_not_configured" };
    if (/_failed$/.test(persisted.mode)) {
      return { ok: false, reason: "persist_failed", detail: JSON.stringify(persisted.error || {}).slice(0, 160) };
    }
    return { ok: true, prospect_id: id, hero_reel: stored };
  } catch (e) {
    return { ok: false, reason: "unexpected_error", detail: String((e && e.message) || e).slice(0, 200) };
  }
}

module.exports = {
  ensureHeroReel,
  patchHeroReel,
  probeFfmpeg,
  pickReelPhotos,
  reelEarnsTheRide,
  reelSlug,
};
