"use strict";
// lib/veo-ambiance.js — Option B cinematic hero for the build-on-click path.
//
// GEMINI_API_KEY lives on Ghost, not SiteForge, so Ghost generates a short
// 4-second Veo ambiance clip, hosts it in a public Supabase bucket, and injects
// a correctly-tagged asset into the SiteForge dispatch payload (`injected_media`).
// SiteForge's intake merges that asset and its media selector treats it as the
// AI-ambiance hero — but only when the business has no real source video, so a
// truthful business film always wins.
//
// The whole path is gated behind GHOST_AGENCY_VEO_AMBIANCE (default OFF) and is
// wrapped so any failure (no key, no bucket, API error, timeout) degrades
// silently back to the normal photo-cinematic hero. Veo calls cost money, so
// this stays dark until the owner enables it and runs a live click test.

const forge = require("./forge");
const defaultStore = require("./store");

const AMBIANCE_BUCKET = process.env.GHOST_AGENCY_AMBIANCE_BUCKET || "wss-proof-assets";

// Per-vertical cinematic direction. Atmosphere only: no people, no invented
// action, no text — the same honesty bar the rest of the media pipeline holds.
const AMBIANCE_PROMPTS = {
  "auto detailing":
    "Cinematic macro of a freshly detailed car: light sweeping across flawless ceramic-coated paint, " +
    "water beading and rolling off a glossy hood, deep reflections, studio lighting. No people, no text.",
  mobility:
    "Cinematic macro of a pristine vehicle surface under moving studio light, gentle reflections and " +
    "shine, slow parallax. No people, no invented action, no text.",
  hvac:
    "Cinematic slow push across clean modern HVAC equipment and calm conditioned air shimmer, soft " +
    "daylight, atmospheric only. No people, no text.",
  roofing:
    "Cinematic golden-hour drift across a clean finished roofline against sky, subtle parallax, " +
    "atmospheric only. No people, no text.",
  landscaping:
    "Cinematic slow pan over lush manicured landscaping at golden hour, gentle breeze in foliage, " +
    "atmospheric only. No people, no text.",
};

const GENERIC_AMBIANCE_PROMPT =
  "Subtle cinematic motion for a local-service business website hero: gentle camera parallax, natural " +
  "light shifting, atmospheric only. No people, no invented action, no text.";

function veoAmbianceEnabled() {
  const flag = String(process.env.GHOST_AGENCY_VEO_AMBIANCE || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

function ambiancePromptFor(vertical) {
  const key = String(vertical || "").trim().toLowerCase();
  return AMBIANCE_PROMPTS[key] || GENERIC_AMBIANCE_PROMPT;
}

// Pure: build the asset object SiteForge's normalizeAmbianceVideo() accepts as an
// AI-ambiance hero. Kept side-effect-free so the contract can be unit-tested
// without touching Veo or storage.
function tagAmbianceAsset(url, { label = "Cinematic brand concept", width = 1280, height = 720, durationSeconds = 4 } = {}) {
  const clean = String(url || "").trim();
  if (!/^https:\/\//i.test(clean)) return null;
  return {
    kind: "video",
    url: clean,
    mime: "video/mp4",
    source: "ai-ambiance",
    role: "ambiance",
    generated: true,
    ai_generated: true,
    approved: true,
    hero_eligible: true,
    proof_eligible: false,
    truthful_source: false,
    label,
    width,
    height,
    meta: { source: "ai-ambiance", duration: durationSeconds, generator: "veo-3.1-fast" },
  };
}

function supabase() {
  // Prefer ghost's own Supabase creds; fall back to the CallPrep Supabase creds,
  // which ARE present in ghost Production (used by held-drafts / connect). This
  // lets Veo host clips using credentials ghost already has — no service-role key
  // moved across projects.
  const url = process.env.SUPABASE_URL || process.env.CALLPREP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("no Supabase creds (SUPABASE_* or CALLPREP_SUPABASE_*)");
  return { url: url.replace(/\/+$/, ""), headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

// Best-effort: ensure the public bucket exists before the first upload.
// Idempotent — a "already exists" response is fine and ignored.
async function ensureBucket() {
  try {
    const { url, headers } = supabase();
    await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ id: AMBIANCE_BUCKET, name: AMBIANCE_BUCKET, public: true }),
    });
  } catch { /* ignore — the upload itself will surface any real failure */ }
}

// Upload the mp4 to a public bucket and return its public URL (SiteForge fetches
// it during capture, so it must be publicly reachable).
async function uploadAmbianceMp4(buffer, objectPath) {
  await ensureBucket();
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/${AMBIANCE_BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "video/mp4", "x-upsert": "true" },
    body: buffer,
  });
  if (!res.ok) throw new Error(`ambiance upload failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
  return `${url}/storage/v1/object/public/${AMBIANCE_BUCKET}/${objectPath}`;
}

// Deterministic object name (no Math.random) so retries overwrite rather than
// pile up: VERTICAL + a short hash of the prompt.
//
// Keyed by VERTICAL, not by site. The ambiance clip is atmosphere — a cinematic
// roofing/plumbing/landscaping plate with no people, no signage and nothing
// specific to one business (see ambiancePromptFor, which has always been
// per-vertical). One excellent clip therefore serves every client in that
// vertical, and the store becomes a self-populating stock library: the first
// roofing build renders it, every roofing build afterwards is a cache HIT at
// zero cost. Bounded by the number of verticals (~15), not by the number of
// customers.
//
// This used to key on the per-site slug, so each customer paid for their own
// render — at 1000 sites/day and ~$0.60 a clip that is ~$18k/month for footage
// that is deliberately interchangeable. Nothing about the output changes; only
// how often we pay for it.
//
// The prompt hash stays in the key so editing a vertical's cinematic direction
// naturally busts the cache and re-renders that vertical once.
function ambianceObjectPath(vertical, prompt) {
  const safeVertical = String(vertical || "local-service").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "local-service";
  let h = 2166136261;
  for (const ch of String(prompt)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `ambiance/${safeVertical}-${(h >>> 0).toString(36)}.mp4`;
}

// Generate → poll → upload → tag. Bounded so it fits inside the dispatch
// function budget; returns null (never throws) so callers degrade gracefully to
// the photo hero. Poll cadence mirrors the durable forge-jobs media_poll stage.
async function generateAmbianceAsset({
  vertical,
  slug,
  durationSeconds = 4,
  maxPolls = 18,
  pollIntervalMs = 8000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  deps = forge,
} = {}) {
  try {
    const prompt = ambiancePromptFor(vertical);
    const operation = await deps.veoSubmit({ prompt, durationSeconds });
    if (!operation) return null;
    let video = null;
    for (let i = 0; i < maxPolls; i++) {
      const res = await deps.veoPoll(operation);
      if (res && res.done) { video = res.video; break; }
      await sleep(pollIntervalMs);
    }
    if (!video || !video.length) return null;
    const objectPath = ambianceObjectPath(vertical, prompt);
    const publicUrl = await uploadAmbianceMp4(video, objectPath);
    return tagAmbianceAsset(publicUrl, { durationSeconds });
  } catch (err) {
    // Swallow: a missing key, storage error, or timeout must not break the build.
    if (process.env.GHOST_AGENCY_DEBUG) console.error("[veo-ambiance] skipped:", err && err.message);
    return null;
  }
}

// --- Cost controls -----------------------------------------------------------
// These live OUTSIDE generateAmbianceAsset (whose unit tests mock global.fetch
// for the upload and must stay hermetic). The caller — siteforge's
// maybeGenerateAmbianceMedia — uses them to (1) reuse an already-generated clip
// and (2) hold a hard daily ceiling on paid Veo renders. Every Veo generation
// costs money, so both default to the safe/cheap direction.

const AMBIANCE_USAGE_EVENT = "veo_ambiance_generated";

// Hard daily ceiling on paid renders. Owner tunes GHOST_AGENCY_VEO_MAX_PER_DAY;
// 0 (or negative) disables generation entirely. Default is deliberately modest.
function veoDailyCap() {
  const raw = Number(process.env.GHOST_AGENCY_VEO_MAX_PER_DAY);
  return Number.isFinite(raw) && raw >= 0 ? raw : 25;
}

function publicAmbianceUrl(objectPath) {
  const { url } = supabase();
  return `${url}/storage/v1/object/public/${AMBIANCE_BUCKET}/${objectPath}`;
}

// Per-(slug,prompt) cache: if a clip already exists in the public bucket, return
// its tagged asset so a rebuild reuses it instead of paying for a new render.
// Best-effort — any probe error (no creds, network, 404) is a cache miss.
async function existingAmbianceAsset({ vertical, slug, durationSeconds = 4, fetchImpl = globalThis.fetch } = {}) {
  try {
    const objectPath = ambianceObjectPath(vertical, ambiancePromptFor(vertical));
    const publicUrl = publicAmbianceUrl(objectPath);
    const res = await fetchImpl(publicUrl, { method: "GET", headers: { Range: "bytes=0-0" } });
    if (res && res.ok) return tagAmbianceAsset(publicUrl, { durationSeconds });
  } catch { /* cache miss — fall through to generate */ }
  return null;
}

// Daily spend ceiling. Fails CLOSED (returns false => skip generation) whenever
// usage can't be read, so an outage can never uncap paid renders. maxPerDay<=0
// disables generation.
async function veoUnderDailyCap({ store = defaultStore, maxPerDay = veoDailyCap(), startOfDay } = {}) {
  if (!store || typeof store.select !== "function") return false;
  if (!(maxPerDay > 0)) return false;
  try {
    let start = startOfDay;
    if (!start) { start = new Date(); start.setUTCHours(0, 0, 0, 0); }
    const iso = start.toISOString();
    const r = await store.select(
      "ghost_agency_events",
      `?select=id&type=eq.${AMBIANCE_USAGE_EVENT}&created_at=gte.${encodeURIComponent(iso)}&limit=${maxPerDay + 1}`,
    );
    if (r && r.ok === true && Array.isArray(r.data)) return r.data.length < maxPerDay;
    return false; // read failed / dry-run => fail closed
  } catch { return false; }
}

// Record one paid render so the daily cap can count it. Best-effort.
async function recordAmbianceUsage({ store = defaultStore, slug } = {}) {
  try {
    if (store && typeof store.recordEvent === "function") {
      await store.recordEvent(AMBIANCE_USAGE_EVENT, { slug: String(slug || "").slice(0, 120) });
    }
  } catch { /* best-effort — never block the build */ }
}

module.exports = {
  veoAmbianceEnabled,
  ambiancePromptFor,
  tagAmbianceAsset,
  ambianceObjectPath,
  generateAmbianceAsset,
  veoDailyCap,
  existingAmbianceAsset,
  veoUnderDailyCap,
  recordAmbianceUsage,
  AMBIANCE_USAGE_EVENT,
  AMBIANCE_PROMPTS,
  GENERIC_AMBIANCE_PROMPT,
};
