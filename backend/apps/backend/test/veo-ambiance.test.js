"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  veoAmbianceEnabled,
  ambiancePromptFor,
  tagAmbianceAsset,
  ambianceObjectPath,
  generateAmbianceAsset,
  veoDailyCap,
  existingAmbianceAsset,
  veoUnderDailyCap,
} = require("../lib/veo-ambiance");
const { buildSiteForgePayload } = require("../lib/siteforge");

test("veoAmbianceEnabled reads the flag truthfully", () => {
  const prev = process.env.GHOST_AGENCY_VEO_AMBIANCE;
  try {
    for (const on of ["1", "true", "on", "TRUE"]) { process.env.GHOST_AGENCY_VEO_AMBIANCE = on; assert.equal(veoAmbianceEnabled(), true, on); }
    for (const off of ["", "0", "false", "no", undefined]) { if (off === undefined) delete process.env.GHOST_AGENCY_VEO_AMBIANCE; else process.env.GHOST_AGENCY_VEO_AMBIANCE = off; assert.equal(veoAmbianceEnabled(), false, String(off)); }
  } finally { if (prev === undefined) delete process.env.GHOST_AGENCY_VEO_AMBIANCE; else process.env.GHOST_AGENCY_VEO_AMBIANCE = prev; }
});

test("ambiancePromptFor is vertical-aware with a generic fallback, always atmosphere-only", () => {
  assert.match(ambiancePromptFor("auto detailing"), /ceramic|paint|detailed/i);
  assert.match(ambiancePromptFor("Auto Detailing"), /ceramic|paint|detailed/i);
  assert.match(ambiancePromptFor("something-unknown"), /cinematic/i);
  for (const v of ["auto detailing", "hvac", "roofing", "unknown"]) {
    assert.match(ambiancePromptFor(v), /no people/i);
    assert.match(ambiancePromptFor(v), /no text/i);
  }
});

test("tagAmbianceAsset produces the SiteForge ai-ambiance contract shape", () => {
  const a = tagAmbianceAsset("https://x.supabase.co/storage/v1/object/public/wss-proof-assets/ambiance/x.mp4");
  assert.equal(a.kind, "video");
  assert.equal(a.mime, "video/mp4");
  assert.equal(a.source, "ai-ambiance");
  assert.equal(a.role, "ambiance");
  assert.equal(a.generated, true);
  assert.equal(a.approved, true);
  assert.equal(a.hero_eligible, true);
  assert.equal(a.proof_eligible, false);
  assert.equal(a.truthful_source, false);
  // rejects non-https / empty
  assert.equal(tagAmbianceAsset(""), null);
  assert.equal(tagAmbianceAsset("http://insecure/x.mp4"), null);
});

test("ambianceObjectPath is keyed by VERTICAL so one clip serves every client in it", () => {
  // Deterministic: no Math.random, so a retry overwrites rather than piling up.
  const p1 = ambianceObjectPath("Auto Detailing!!", "prompt A");
  const p2 = ambianceObjectPath("Auto Detailing!!", "prompt A");
  assert.equal(p1, p2);
  assert.match(p1, /^ambiance\/auto-detailing-[a-z0-9]+\.mp4$/);

  // THE POINT OF THE CHANGE: the ambiance clip is atmosphere with no people,
  // signage or business-specific detail, so every client in a vertical shares
  // one render. Keyed per-site, 1000 sites/day at ~$0.60 a clip is ~$18k/month
  // for deliberately interchangeable footage.
  assert.equal(
    ambianceObjectPath("roofing", "prompt A"),
    ambianceObjectPath("roofing", "prompt A"),
    "two roofing clients must resolve to the SAME cached clip",
  );
  assert.notEqual(
    ambianceObjectPath("roofing", "prompt A"),
    ambianceObjectPath("plumbing", "prompt A"),
    "different verticals must NOT share a clip",
  );

  // Editing a vertical's cinematic direction re-renders that vertical once.
  assert.notEqual(ambianceObjectPath("x", "prompt A"), ambianceObjectPath("x", "prompt B"));

  // Missing vertical degrades to a named generic bucket, never an empty key.
  assert.match(ambianceObjectPath("", "prompt A"), /^ambiance\/local-service-[a-z0-9]+\.mp4$/);
});

test("generateAmbianceAsset polls to completion, uploads, and returns a tagged asset", async () => {
  const calls = { submit: 0, poll: 0 };
  const deps = {
    veoSubmit: async ({ durationSeconds }) => { calls.submit++; assert.equal(durationSeconds, 4); return "operations/abc"; },
    veoPoll: async () => { calls.poll++; return calls.poll >= 2 ? { done: true, video: Buffer.from("mp4bytes") } : { done: false }; },
  };
  const prevUrl = process.env.SUPABASE_URL, prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY, prevFetch = global.fetch;
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  let uploaded = null;
  global.fetch = async (url, opts) => { uploaded = { url, contentType: opts.headers["Content-Type"] }; return { ok: true, text: async () => "" }; };
  try {
    const asset = await generateAmbianceAsset({ vertical: "auto detailing", slug: "atlanta-auto-spa", pollIntervalMs: 0, sleep: async () => {}, deps });
    assert.ok(asset, "asset returned");
    assert.equal(asset.source, "ai-ambiance");
    assert.match(asset.url, /\/object\/public\/wss-proof-assets\/ambiance\/auto-detailing-[a-z0-9]+\.mp4$/);
    assert.equal(uploaded.contentType, "video/mp4");
    assert.equal(calls.submit, 1);
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    global.fetch = prevFetch;
  }
});

test("generateAmbianceAsset degrades to null on any failure (never throws)", async () => {
  const deps = { veoSubmit: async () => { throw new Error("no key"); }, veoPoll: async () => ({ done: true }) };
  const asset = await generateAmbianceAsset({ vertical: "hvac", slug: "x", deps });
  assert.equal(asset, null);
  // timeout: never done within maxPolls -> null
  const deps2 = { veoSubmit: async () => "op", veoPoll: async () => ({ done: false }) };
  const asset2 = await generateAmbianceAsset({ vertical: "hvac", slug: "x", maxPolls: 2, pollIntervalMs: 0, sleep: async () => {}, deps: deps2 });
  assert.equal(asset2, null);
});

test("veoDailyCap defaults to 25 and honors GHOST_AGENCY_VEO_MAX_PER_DAY", () => {
  const prev = process.env.GHOST_AGENCY_VEO_MAX_PER_DAY;
  try {
    delete process.env.GHOST_AGENCY_VEO_MAX_PER_DAY;
    assert.equal(veoDailyCap(), 25);
    process.env.GHOST_AGENCY_VEO_MAX_PER_DAY = "5"; assert.equal(veoDailyCap(), 5);
    process.env.GHOST_AGENCY_VEO_MAX_PER_DAY = "0"; assert.equal(veoDailyCap(), 0);
    process.env.GHOST_AGENCY_VEO_MAX_PER_DAY = "not-a-number"; assert.equal(veoDailyCap(), 25);
  } finally { if (prev === undefined) delete process.env.GHOST_AGENCY_VEO_MAX_PER_DAY; else process.env.GHOST_AGENCY_VEO_MAX_PER_DAY = prev; }
});

test("existingAmbianceAsset reuses a cached clip on hit, returns null on miss / error / no-creds", async () => {
  const prevUrl = process.env.SUPABASE_URL, prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    const hit = await existingAmbianceAsset({ vertical: "auto detailing", slug: "atlanta-auto-spa", fetchImpl: async () => ({ ok: true }) });
    assert.ok(hit, "cache hit returns an asset"); assert.equal(hit.source, "ai-ambiance");
    assert.match(hit.url, /\/object\/public\/wss-proof-assets\/ambiance\/auto-detailing-[a-z0-9]+\.mp4$/);
    const otherClient = await existingAmbianceAsset({ vertical: "auto detailing", slug: "a-totally-different-business", fetchImpl: async () => ({ ok: true }) });
    assert.ok(otherClient, "a different business in the same vertical still hits the cache");
    assert.equal(otherClient.url, hit.url, "and reuses the SAME clip — zero extra Veo spend");
    const miss = await existingAmbianceAsset({ vertical: "auto detailing", slug: "x", fetchImpl: async () => ({ ok: false }) });
    assert.equal(miss, null, "404 => cache miss");
    const err = await existingAmbianceAsset({ vertical: "auto detailing", slug: "x", fetchImpl: async () => { throw new Error("net"); } });
    assert.equal(err, null, "probe error => cache miss");
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.CALLPREP_SUPABASE_URL; delete process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY;
    const noCreds = await existingAmbianceAsset({ vertical: "auto detailing", slug: "x", fetchImpl: async () => ({ ok: true }) });
    assert.equal(noCreds, null, "no supabase creds => null (never build a bad url)");
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test("veoUnderDailyCap enforces the ceiling and fails closed on any read problem", async () => {
  const okStore = (rows) => ({ select: async () => ({ ok: true, data: rows }) });
  assert.equal(await veoUnderDailyCap({ store: okStore([]), maxPerDay: 3 }), true, "0/3 under cap");
  assert.equal(await veoUnderDailyCap({ store: okStore([1, 2]), maxPerDay: 3 }), true, "2/3 under cap");
  assert.equal(await veoUnderDailyCap({ store: okStore([1, 2, 3]), maxPerDay: 3 }), false, "3/3 at cap");
  assert.equal(await veoUnderDailyCap({ store: { select: async () => ({ ok: false, mode: "live_select_failed", data: [] }) }, maxPerDay: 3 }), false, "read failure => fail closed");
  assert.equal(await veoUnderDailyCap({ store: { select: async () => ({ ok: false, mode: "dry_run", data: [] }) }, maxPerDay: 3 }), false, "dry-run => fail closed");
  assert.equal(await veoUnderDailyCap({ store: okStore([]), maxPerDay: 0 }), false, "cap 0 disables");
  assert.equal(await veoUnderDailyCap({ store: { select: async () => { throw new Error("db"); } }, maxPerDay: 3 }), false, "throwing store => fail closed");
});

test("buildSiteForgePayload omits injected_media by default and includes it when provided", () => {
  const base = buildSiteForgePayload({ prospect: { business_name: "X" }, job: { id: "j" }, truthPacket: {} });
  assert.equal("injected_media" in base, false, "no injected_media on normal builds");
  const asset = tagAmbianceAsset("https://x.supabase.co/a.mp4");
  const withMedia = buildSiteForgePayload({ prospect: { business_name: "X" }, job: { id: "j" }, truthPacket: {}, injectedMedia: [asset, null] });
  assert.equal(Array.isArray(withMedia.injected_media), true);
  assert.equal(withMedia.injected_media.length, 1, "nulls filtered out");
  assert.equal(withMedia.injected_media[0].source, "ai-ambiance");
});
