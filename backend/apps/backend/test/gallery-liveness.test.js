"use strict";

// The gallery's honesty contract, in three parts:
//
//   1. api/admin/gallery-liveness measures whether each preview host answers
//      RIGHT NOW, and reports "unknown" separately from "offline".
//   2. lib/gallery-page withdraws "Open live site" from a measured-offline card
//      and says which nothing its empty tile is.
//   3. lib/preview-visuals no longer truncates a long URL into a signed key that
//      addresses a different page.

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const page = require("../lib/gallery-page");
const { createGalleryLivenessHandler, stateFor } = require("../api/admin/gallery-liveness");
const { visualCacheKey, signedVisualPath } = require("../lib/preview-visuals");

const TOKEN = "gallery-liveness-test-token";

function res() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(payload = "") { this.body = payload ? JSON.parse(payload) : null; },
  };
}

function req(method = "GET", token = TOKEN) {
  return { method, url: "/api/admin/gallery-liveness", headers: token ? { "x-admin-token": token } : {} };
}

function inlineScript() {
  return [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
}

function withAdminToken(run) {
  const previous = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = TOKEN;
  try { return run(); } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = previous;
  }
}

// --------------------------------------------------------------- the endpoint

test("liveness separates offline from unknown and never invents a verdict", async () => {
  const probed = [];
  const handler = createGalleryLivenessHandler({
    select: async () => ({
      ok: true,
      data: [
        { prospect_id: "a", preview_url: "https://live.wss-ai.com/" },
        { prospect_id: "b", preview_url: "https://dead.wss-ai.com/" },
        // Same host twice: one probe, not two.
        { prospect_id: "c", preview_url: "https://dead.wss-ai.com/" },
        // Outside the preview allowlist, so lib/preview-liveness refuses to
        // request it. That refusal is a guard, not evidence the site is down.
        { prospect_id: "d", preview_url: "https://siteforge-app-seven.vercel.app/try/x/" },
      ],
    }),
    checkPreviewLive: async ({ url }) => {
      probed.push(url);
      if (url.includes("live.")) return { ok: true, status: 200, reason: "" };
      if (url.includes("dead.")) return { ok: false, status: 404, reason: "http_404" };
      return { ok: false, status: 0, reason: "no_probeable_preview_url" };
    },
  });

  const response = res();
  await withAdminToken(() => handler(req(), response));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(probed.length, 3, "a shared host is probed once, not once per row");

  const byUrl = Object.fromEntries(response.body.results.map((r) => [r.previewUrl, r]));
  assert.equal(byUrl["https://live.wss-ai.com/"].state, "live");
  assert.equal(byUrl["https://dead.wss-ai.com/"].state, "offline");
  assert.equal(byUrl["https://dead.wss-ai.com/"].status, 404);
  assert.equal(byUrl["https://siteforge-app-seven.vercel.app/try/x/"].state, "unknown",
    "an unprobeable host is unknown — calling it offline would be a second lie");
  assert.deepEqual(response.body.counts, { live: 1, offline: 1, unknown: 1 });
  assert.equal(response.headers["cache-control"], "no-store",
    "a cached liveness answer is a stale claim about the present tense");
});

test("liveness is admin-gated, GET-only, and 503s rather than guessing when the store is down", async () => {
  const handler = createGalleryLivenessHandler({
    select: async () => ({ ok: false, error: "boom" }),
    checkPreviewLive: async () => ({ ok: true, status: 200 }),
  });

  const unauthorized = res();
  await withAdminToken(() => handler(req("GET", ""), unauthorized));
  assert.equal(unauthorized.statusCode, 401);

  const wrongMethod = res();
  await withAdminToken(() => handler(req("POST"), wrongMethod));
  assert.equal(wrongMethod.statusCode, 405);

  const broken = res();
  await withAdminToken(() => handler(req(), broken));
  assert.equal(broken.statusCode, 503);
  assert.notEqual(broken.body && broken.body.ok, true);
});

test("stateFor maps exactly one outcome to live", () => {
  assert.equal(stateFor({ ok: true, status: 200 }), "live");
  assert.equal(stateFor({ ok: false, status: 404, reason: "http_404" }), "offline");
  assert.equal(stateFor({ ok: false, status: 0, reason: "timeout" }), "offline");
  assert.equal(stateFor({ ok: false, status: 0, reason: "no_probeable_preview_url" }), "unknown");
});

test("liveness also probes the Line rows' preview URLs, and a failed Line read never blocks the prospects", async () => {
  const probed = [];
  const reads = [];
  let lineReadOk = true;
  const handler = createGalleryLivenessHandler({
    select: async (table, query) => {
      reads.push({ table, query });
      if (table === "ghost_agency_prospects") {
        return { ok: true, data: [{ prospect_id: "a", preview_url: "https://prospect-host.wss-ai.com/" }] };
      }
      if (table === "ghost_agency_line_batch_rows") {
        if (!lineReadOk) throw new Error("line store down");
        return { ok: true, data: [{ preview_url: "https://line-only-host.wss-ai.com/" }] };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    checkPreviewLive: async ({ url }) => {
      probed.push(url);
      return url.includes("prospect-host") ? { ok: true, status: 200 } : { ok: false, status: 404, reason: "http_404" };
    },
  });

  const response = res();
  await withAdminToken(() => handler(req(), response));
  assert.equal(response.statusCode, 200);
  // A Line-only mirror's host — the kind the legacy-mirror retirement is
  // deleting right now — is measured, not guessed at.
  assert.ok(probed.includes("https://line-only-host.wss-ai.com/"));
  const byUrl = Object.fromEntries(response.body.results.map((r) => [r.previewUrl, r]));
  assert.equal(byUrl["https://line-only-host.wss-ai.com/"].state, "offline");
  assert.equal(byUrl["https://prospect-host.wss-ai.com/"].state, "live");
  assert.equal(response.body.counts.offline, 1);
  const lineQuery = reads.find(({ table }) => table === "ghost_agency_line_batch_rows");
  assert.match(lineQuery.query, /select=preview_url:payload->>previewUrl/);
  assert.match(lineQuery.query, /status=not\.in\.\(picked,qualified,rejected\)/);

  // The Line read is annotation: with it throwing, the prospect URLs are still
  // answered for and the route stays 200.
  probed.length = 0;
  lineReadOk = false;
  const degraded = res();
  await withAdminToken(() => handler(req(), degraded));
  assert.equal(degraded.statusCode, 200);
  assert.deepEqual(probed, ["https://prospect-host.wss-ai.com/"]);
});

// ------------------------------------------------------------------- the page

test("gallery page fetches liveness as a GET annotation that can never block the catalog", () => {
  const script = inlineScript();
  assert.doesNotThrow(() => new vm.Script(script, { filename: "gallery-inline.js" }));

  assert.match(script, /api\(["']\/api\/admin\/gallery-liveness["']\)/);
  assert.equal((script.match(/\/api\/admin\/gallery-liveness/g) || []).length, 1);
  // Liveness must not become a second source of the rows themselves — that is
  // the point of this count, and it still holds. The number moved from 1 to 2
  // when the live-refresh lane landed: the page now reads the catalog on first
  // paint AND on a timer, because it used to be a static snapshot that never
  // updated after open. Two reads of the ONE catalog endpoint is not two
  // sources; it is the same source, read again. It moved again to 3 mentions
  // (still two REQUESTS) when the campaign clock landed: the third mention is
  // a path CHECK inside the api() wrap that repaints the clock from snapshots
  // already in flight. What must never appear is a second URL serving rows,
  // which this assertion still catches.
  assert.equal((script.match(/\/api\/admin\/gallery-data/g) || []).length, 3);
  // Liveness itself stays a bare GET. The page gained write actions with the
  // operator drawer on 2026-08-11 (read one record, save a note, mail the
  // owner a proof), so "no write verb anywhere" is no longer the right test —
  // but the liveness probe must never become one of them. Its api() call takes
  // a single argument, which is the only shape that cannot carry a method.
  assert.match(script, /api\(["']\/api\/admin\/gallery-liveness["']\)\s*\./,
    "liveness is called with a URL and nothing else, so it cannot be a write");
  // The catalog paints first; liveness is kicked off after and swallows its own
  // failures, so a broken probe leaves the page exactly as it was.
  assert.match(script, /updateView\(\);\s*loadLiveness\(\);/);
  assert.match(script, /loadLiveness[\s\S]{0,600}?\.catch\(function\(\)\{\}\)/);
});

test("a measured-offline card withdraws the broken action instead of relabelling it", () => {
  const script = inlineScript();

  // The stretched whole-card link and the menu entry both come off the same
  // measurement, so a dead host cannot be opened from either affordance.
  assert.match(script, /var offline=isOffline\(item\);\s*var liveUrl=offline\?["']["']:safeHttpUrl\(item\.previewUrl\)/);
  assert.match(script, /var liveUrl=isOffline\(item\)\?["']["']:safeHttpUrl\(item\.previewUrl\)/);
  // Copy site link survives: the URL is still evidence of which host died.
  assert.match(script, /menuItem\(["']copy-site["']/);

  // Absence of a probe is not offline. isOffline must require the measured
  // string, never merely "not live".
  assert.match(script, /hit\.state==="offline"/);
  assert.doesNotMatch(script, /state!=="live"/);

  assert.match(page, /\.status\.offline\{/, "offline needs its own chip style");
  assert.match(script, /dead\.textContent=hit&&hit\.status\?["']Offline · ["']\+hit\.status/);
});

test("the empty tile names which nothing it is, and never borrows a picture", () => {
  const script = inlineScript();

  assert.match(script, /previewFallback\(offline\?["']Site no longer live["']:["']No preview yet — one is captured at inspection["']\)/);
  assert.match(script, /relabelFallback\(fallback,["']Preview unavailable["']\)/);
  assert.match(page, /Preview unavailable/);

  // The fallback is built from our own inline mark and text nodes only — no
  // image element, no remote URL, nothing that could resolve to another
  // business's site.
  const fallbackBody = script.slice(script.indexOf("function previewFallback"), script.indexOf("function relabelFallback"));
  assert.doesNotMatch(fallbackBody, /createElement\(["']img["']\)/i);
  assert.doesNotMatch(fallbackBody, /\.src\s*=/);

  // A 1x1 spacer arrives as a healthy 200; the card must read it as MISSING.
  assert.match(script, /naturalWidth>=50&&image\.naturalHeight>=50/);
  assert.match(script, /if\(!ready&&!offline\)relabelFallback\(fallback,["']No preview yet — one is captured at inspection["']\)/);

  assert.match(script, /offlineCount\?["'] · ["']\+offlineCount\.toLocaleString\(\)\+["'] offline["']/);
});

// -------------------------------------------------- the silently-wrong key

test("a long preview URL is refused, not truncated into a different page's key", () => {
  // 74 bytes: the exact shape that used to decode back to a prefix.
  const long = "https://siteforge-app-seven.vercel.app/try/canyon-roofing-llc-swappehf2-y/";
  const key = visualCacheKey({ kind: "new", previewUrl: long });
  const decoded = Buffer.from(key.split(".")[1], "base64url").toString("utf8");
  assert.equal(decoded, long, "the key must carry the whole URL or none of it");

  // Past the cap it refuses outright rather than addressing a different page.
  const absurd = `https://x.wss-ai.com/${"a".repeat(600)}`;
  assert.equal(visualCacheKey({ kind: "new", previewUrl: absurd }), "");
  assert.equal(signedVisualPath({ kind: "new", previewUrl: absurd }), "");
});

test("keys for normal URLs are byte-identical to the ones already in sent emails", () => {
  // Anything at or under 72 bytes encodes to at most 96 base64 characters, which
  // is where the old slice sat — so no live email's <img src> moves.
  const url = "https://wss-test-rose-city-heating-and-air-portland.wss-ai.com/";
  assert.ok(url.length <= 72);
  const legacy = [
    "new",
    Buffer.from(url).toString("base64url").slice(0, 96),
    Buffer.from("").toString("base64url").slice(0, 96),
    "",
  ].join(".");
  assert.equal(visualCacheKey({ kind: "new", previewUrl: url }), legacy);
});
