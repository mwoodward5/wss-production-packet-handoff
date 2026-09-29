"use strict";
// test/set-hero-video.test.js — the set_hero_video verb.
//
// The owner's ask: "Riley should be able to generate a new Seedance video and
// port that into their site." Generation already exists; the port is this
// verb. Each test pins one of the properties that make attaching a generated
// clip to a LIVE customer site safe:
//
//   · the clip is resolved from the client's own provenance store, never from
//     a URL the plan carried, and the bytes are re-verified against the
//     approved sha256 before anything is uploaded;
//   · only an owner-approved, generated SEEDANCE clip rides — the same gates
//     the build lane applies before a generated clip may ride a ladder;
//   · the ladder the page itself plays from is rewritten and version-bumped,
//     the retired rung's other references follow, and the change is proved on
//     the rendered page or rolled back;
//   · a rebuild replays the SAME swap through the SAME apply function;
//   · the capability floor and the timing bucket tell the truth about the
//     tier: real, and NOT an instant quick edit.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Fakes for the storage, deploy and browser seams — seeded BEFORE
// lib/site-change-plan is required (this verb rides runSiteChange, whose
// storage and deploy imports are module-level).
// ---------------------------------------------------------------------------
const SITE_SLUG = "wss-mirror-flint-video";
const OLD_TOP = "assets/hero-client-general-contractor.mp4";
const FALLBACK_RUNG = "assets/hero-fallback-general-contractor.mp4";
const NEW_REL_PREFIX = "assets/hero-client-wss";

// A minimal MP4-shaped fixture: 'ftyp' at offset 4, then payload.
const CLIP_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(4096, 0x07),
]);
const OTHER_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypmp42"),
  Buffer.alloc(2048, 0x11),
]);
const CLIP_SHA = createHash("sha256").update(CLIP_BYTES).digest("hex");
const NEW_REL = `${NEW_REL_PREFIX}${CLIP_SHA.slice(0, 8)}.mp4`;
const NEW_PATH = `/${NEW_REL}`;

const REEL_PROVENANCE = {
  kind: "seedance_generated",
  generator: "openrouter_seedance",
  checkpoint_schema: "wss.hero.seedance_provider_checkpoint.v1",
  provider_job_id: "provider_job_1",
  hero_job_id: "hero_job_1",
  attempt_id: "attempt_1",
  generation_receipt_schema: "wss.hero.seedance_generation_receipt.v1",
  generation_receipt_sha256: "a".repeat(64),
  output_sha256: CLIP_SHA,
};

const approvedReelRow = (overrides = {}) => ({
  prospect_id: "prospect_1",
  preview_url: `https://${SITE_SLUG}.wss-ai.com/`,
  record: {
    media_bank: {
      hero_reel: {
        url: "https://sup.test/storage/v1/object/public/wss-proof/clips/hero-job-1.mp4",
        generator: "openrouter_seedance",
        composed_from: ["banked-photo-sha"],
        composed_at: "2026-09-01T10:00:00.000Z",
        provenance: REEL_PROVENANCE,
      },
    },
  },
  ...overrides,
});

// The client's current archive + everything this run uploads, in one map so
// assertArchiveMatches (write then read-back) proves the same bytes.
let store = new Map();
const seedStore = (indexHtmlOverride = null) => {
  store = new Map();
  const indexHtml = indexHtmlOverride || `<!doctype html><html><head><meta charset="utf-8" /><title>Flint Plumbing</title></head><body>`
    + `<section id="top"><video data-hero-video muted playsinline></video>`
    + `<h1>Plumbing in Parkville.</h1></section>\n`
    + `<script type="application/json" id="hero-video-ladder">{"sources":["${OLD_TOP}","${FALLBACK_RUNG}"]}</script>\n`
    + `<script>var video=document.querySelector("video[data-hero-video]");var island=document.getElementById("hero-video-ladder");var retired="${OLD_TOP}";</script>\n`
    + `</body></html>`;
  const mainJs = `var video=document.querySelector("video[data-hero-video]");`
    + `var island=document.getElementById("hero-video-ladder");`
    + `var sources=JSON.parse(island.textContent).sources;var s=sources[0];`
    + `var legacy="${OLD_TOP}";`;
  for (const [rel, buf] of Object.entries({
    "index.html": Buffer.from(indexHtml, "utf8"),
    "assets/main.js": Buffer.from(mainJs, "utf8"),
    [FALLBACK_RUNG]: Buffer.from("fallback-clip-bytes"),
    "llms.txt": Buffer.from("- Phone: (512) 971-2445\n- Rating: 4.9 from 106 reviews\n", "utf8"),
  })) store.set(`${SITE_SLUG}/${rel}`, buf);
  return indexHtml;
};

const fakeEditor = {
  listAll: async (prefix) => [...store.keys()]
    .filter((k) => k.startsWith(`${prefix}/`))
    .map((k) => k.slice(prefix.length + 1)),
  download: async () => { throw new Error("download must not be used; runSiteChange reads cache-busted"); },
  upload: async (prefix, rel, buf) => { store.set(`${prefix}/${rel}`, Buffer.from(buf)); },
};

const fakeForge = {
  vercelDeploy: async () => ({ url: "https://deploy-1.vercel.test", alias: `https://${SITE_SLUG}.wss-ai.com` }),
};

const fakeChromium = {
  launchChromium: async () => ({
    newPage: async () => ({ goto: async () => ({ status: () => 200 }), waitForFunction: async () => {}, evaluate: async () => ({}) }),
    close: async () => {},
  }),
};

const siteEditorPath = require.resolve("../lib/site-editor");
const forgePath = require.resolve("../lib/forge");
const chromiumPath = require.resolve("../lib/serverless-chromium");
require.cache[siteEditorPath] = { id: siteEditorPath, filename: siteEditorPath, loaded: true, exports: fakeEditor };
require.cache[forgePath] = { id: forgePath, filename: forgePath, loaded: true, exports: fakeForge };
require.cache[chromiumPath] = { id: chromiumPath, filename: chromiumPath, loaded: true, exports: fakeChromium };

process.env.SUPABASE_URL = "https://sup.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

const originalFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/rest/v1/")) return { ok: true, status: 200, json: async () => [] };
  if (u.includes("/storage/v1/object/wss-site-sources/")) {
    const rel = u.slice(u.indexOf("wss-site-sources/") + "wss-site-sources/".length).split("?")[0];
    const buf = store.get(rel);
    if (!buf) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const P = require("../lib/site-change-plan");
const V = require("../lib/edit-verify");
const R = require("../lib/site-edit-replay");
const LOG = require("../lib/site-edit-log");
const caps = require("../lib/riley-capabilities");
const T = require("../lib/edit-timing");

// The clip download is a DIFFERENT fetch (the client's own store URL), so it
// is injected per-run rather than riding the global stub.
const clipFetcher = (bytes) => async () => ({
  ok: true,
  status: 200,
  headers: { get: () => String(bytes.length) },
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

const heroVerify = async ({ heroVideos = [], marker = null }) => ({
  ok: true,
  checks: [],
  textChecks: [],
  orderChecks: [],
  heroChecks: (heroVideos || []).map((h) => ({
    expected: String(h.expected || "").replace(/^\/+/, ""),
    ladderFound: true,
    ladderReadable: true,
    ladderTop: String(h.expected || "").replace(/^\/+/, ""),
    videoPresent: true,
    videoSrc: String(h.expected || "").replace(/^\/+/, ""),
    armed: true,
    dead: false,
  })),
  markerPresent: marker ? true : null,
});

const plannerEmitting = (ops) => async () => JSON.stringify({
  summary: "Swap the hero video for the new generated clip",
  ops,
  refusal: null,
});

async function runEdit({ rows = [approvedReelRow()], ops, clipBytes = CLIP_BYTES, indexHtml = null } = {}) {
  seedStore(indexHtml);
  return P.runSiteChange({
    siteSlug: SITE_SLUG,
    instruction: "swap the hero video for the new generated one",
    projectName: SITE_SLUG,
    aliasHost: `${SITE_SLUG}.wss-ai.com`,
    jobId: `edit_hero_${Math.random().toString(36).slice(2, 8)}`,
    planner: plannerEmitting(ops),
    resolveHeroVideoDeps: { select: async () => ({ ok: true, data: rows }), fetchImpl: clipFetcher(clipBytes) },
    verifyEditLive: heroVerify,
  });
}

// ---------------------------------------------------------------------------
// 1. THE APPLY — ladder rewritten, version bumped, clip hosted, verified
// ---------------------------------------------------------------------------
test("set_hero_video applies: the approved clip is hosted, the ladder rewritten and version-bumped, the swap verified", async () => {
  const result = await runEdit({ ops: [{ op: "set_hero_video", why: "caller asked for a new hero video" }] });

  assert.equal(result.applied, true);
  assert.equal(result.verified.ok, true);
  assert.equal(result.verified.heroChecks.length, 1, "the rendered check must carry the hero claim");
  assert.match(result.say, /^Done —/);

  const record = result.ops.find((o) => o.op === "set_hero_video");
  assert.ok(record, "the op record exists");
  assert.equal(record.generator, "openrouter_seedance");
  assert.equal(record.replaced, OLD_TOP);
  assert.equal(record.sha256, CLIP_SHA);
  assert.equal(record.clipRef, "hero_job_1");

  // The replay record is the identity a rebuild re-applies.
  assert.deepEqual(result.replay[0], {
    op: "set_hero_video", from: OLD_TOP, to: NEW_REL, file: "index.html", sha256: CLIP_SHA,
  });

  // THE DEPLOYED LADDER: top rung is the new clip, the fallback rung is kept,
  // and the version changed hands in the deployed bytes themselves.
  const deployed = store.get(`${SITE_SLUG}/index.html`).toString("utf8");
  const sources = P.heroLadderSources(deployed);
  assert.equal(sources[0], NEW_REL);
  assert.deepEqual(sources.slice(1), [FALLBACK_RUNG]);
  assert.match(deployed, /"version":1/);

  // The clip bytes are hosted on the customer's own site, unchanged.
  assert.ok(store.get(`${SITE_SLUG}/${NEW_REL}`).equals(CLIP_BYTES));
  // The retired rung's other references follow (the bundle's walker script).
  const bundle = store.get(`${SITE_SLUG}/assets/main.js`).toString("utf8");
  assert.ok(!bundle.includes(OLD_TOP), "the bundle must not keep pointing at the retired rung");
  assert.ok(bundle.includes(NEW_REL), "the bundle's retired reference follows the new clip");
  // The undo snapshot holds the PRE-edit page.
  const undoManifest = JSON.parse(store.get(`_undo/${SITE_SLUG}/${result.jobId}/manifest.json`).toString("utf8"));
  assert.ok(undoManifest.files.includes("index.html"));
  assert.ok(undoManifest.created.includes(NEW_REL));
});

test("an empty ladder gets the clip prepended — a site whose ladder declared no playable rung", async () => {
  const result = await runEdit({
    ops: [{ op: "set_hero_video" }],
    indexHtml: `<!doctype html><html><head></head><body>`
      + `<video data-hero-video></video>`
      + `<script type="application/json" id="hero-video-ladder">{"sources":[]}</script></body></html>`,
  });
  assert.equal(result.applied, true);
  const deployed = store.get(`${SITE_SLUG}/index.html`).toString("utf8");
  assert.deepEqual(P.heroLadderSources(deployed), [NEW_REL]);
});

// ---------------------------------------------------------------------------
// 2. THE GATES — refusals, each with a sentence, all before any byte moves
// ---------------------------------------------------------------------------
test("no approved clip in the store is a refusal, not a guess", async () => {
  const result = await runEdit({
    ops: [{ op: "set_hero_video" }],
    rows: [{ prospect_id: "p1", preview_url: `https://${SITE_SLUG}.wss-ai.com/`, record: {} }],
  });
  assert.equal(result.applied, false);
  assert.equal(result.refused, true);
  assert.match(result.reason, /no approved generated hero clip/);
  assert.ok(result.say.length > 40);
});

test("a NON-Seedance generator fails the provenance gates even when durable", async () => {
  const result = await runEdit({
    ops: [{ op: "set_hero_video" }],
    rows: [approvedReelRow({
      record: {
        media_bank: {
          hero_reel: {
            url: "https://sup.test/x.mp4",
            generator: "wan2_i2v_local",
            composed_from: ["x"],
            provenance: { ...REEL_PROVENANCE, generator: "wan2_i2v_local", kind: "client_derived_reel" },
          },
        },
      },
    })],
  });
  assert.equal(result.refused, true);
  assert.match(result.reason, /generator_is_not_seedance/);
});

test("a tampered store — bytes that no longer match the approved receipt — is refused", async () => {
  const result = await runEdit({ ops: [{ op: "set_hero_video" }], clipBytes: OTHER_BYTES });
  assert.equal(result.refused, true);
  assert.match(result.reason, /does not match the approved receipt/);
});

test("the plan may name only THIS store's clip identity — never a URL", async () => {
  const result = await runEdit({
    ops: [{ op: "set_hero_video", clip: "deadbeefdeadbeef" }],
  });
  assert.equal(result.refused, true);
  assert.match(result.reason, /does not name this site's approved clip/);
  // And a foreign URL as the reference is refused the same way — the field is
  // an identity match, never a fetch source.
  const byUrl = await runEdit({
    ops: [{ op: "set_hero_video", clip: "https://evil.example/clip.mp4" }],
  });
  assert.equal(byUrl.refused, true);
});

test("a site with no hero-video ladder is refused before the store is touched", async () => {
  const result = await runEdit({
    ops: [{ op: "set_hero_video" }],
    indexHtml: "<!doctype html><html><head></head><body><h1>No video here.</h1></body></html>",
  });
  assert.equal(result.refused, true);
  assert.match(result.reason, /no hero-video ladder/);
});

test("two prospect rows claiming one site is refused rather than guessed", async () => {
  const result = await runEdit({
    ops: [{ op: "set_hero_video" }],
    rows: [approvedReelRow({ prospect_id: "p1" }), approvedReelRow({ prospect_id: "p2" })],
  });
  assert.equal(result.refused, true);
  assert.match(result.reason, /could not resolve exactly one video store/);
});

// ---------------------------------------------------------------------------
// 3. THE RESOLVER — the one door between a plan and a clip
// ---------------------------------------------------------------------------
test("defaultResolveHeroVideoClip returns verified bytes for an approved Seedance reel", async () => {
  seedStore();
  const clip = await P.defaultResolveHeroVideoClip({
    siteSlug: SITE_SLUG,
    requested: "",
    select: async () => ({ ok: true, data: [approvedReelRow()] }),
    fetchImpl: clipFetcher(CLIP_BYTES),
  });
  assert.ok(clip.bytes.equals(CLIP_BYTES));
  assert.equal(clip.sha256, CLIP_SHA);
  assert.equal(clip.generator, "openrouter_seedance");
  assert.equal(clip.clipRef, "hero_job_1");
  // An identity that IS the store's clip resolves.
  const bySha = await P.defaultResolveHeroVideoClip({
    siteSlug: SITE_SLUG,
    requested: CLIP_SHA.slice(0, 12),
    select: async () => ({ ok: true, data: [approvedReelRow()] }),
    fetchImpl: clipFetcher(CLIP_BYTES),
  });
  assert.equal(bySha.sha256, CLIP_SHA);
});

test("seedanceProvenanceFault names every missing proof", () => {
  assert.equal(P.seedanceProvenanceFault({ generator: "openrouter_seedance", provenance: REEL_PROVENANCE }), "");
  assert.match(P.seedanceProvenanceFault(null), /reel_missing/);
  assert.match(P.seedanceProvenanceFault({ generator: "ads_image_to_video", provenance: {} }), /generator_is_not_seedance/);
  assert.match(P.seedanceProvenanceFault({ generator: "openrouter_seedance" }), /provenance_missing/);
  assert.match(P.seedanceProvenanceFault({
    generator: "openrouter_seedance",
    provenance: { ...REEL_PROVENANCE, output_sha256: "short" },
  }), /output_sha256_missing/);
  assert.match(P.seedanceProvenanceFault({
    generator: "openrouter_seedance",
    provenance: { ...REEL_PROVENANCE, checkpoint_schema: "unknown.v1" },
  }), /checkpoint_schema_unknown/);
});

// ---------------------------------------------------------------------------
// 4. THE REBUILD — the same swap, replayed through the same apply function
// ---------------------------------------------------------------------------
test("replay: a fresh build gets the clip bytes back and the ladder re-swapped", async () => {
  seedStore();
  const files = { "index.html": Buffer.from(seedStore(), "utf8") };
  const entries = [{
    jobId: "edit_hero_1",
    at: "2026-09-02T00:00:00.000Z",
    seq: "edit_hero_1#0",
    instruction: "swap the hero video for the new generated one",
    op: { op: "set_hero_video", from: OLD_TOP, to: NEW_REL, file: "index.html", sha256: CLIP_SHA },
  }];
  const out = await R.replayEdits({
    files,
    entries,
    readArchived: async (rel) => (rel === NEW_REL ? CLIP_BYTES : null),
  });
  assert.equal(out.unreplayable.length, 0);
  assert.equal(out.applied[0].op, "set_hero_video");
  const html = out.files["index.html"].toString("utf8");
  assert.equal(P.heroLadderSources(html)[0], NEW_REL);
  assert.match(html, /"version":1/);
  assert.ok(out.files[NEW_REL].equals(CLIP_BYTES));
  assert.ok(out.changedFiles.includes(NEW_REL));
});

test("replay: a ladder that no longer names the retired rung is REPORTED, never guessed", async () => {
  const files = { "index.html": Buffer.from(seedStore(), "utf8") };
  const out = await R.replayEdits({
    files,
    entries: [{
      jobId: "edit_hero_2",
      at: "2026-09-02T00:00:00.000Z",
      seq: "edit_hero_2#0",
      instruction: "swap the hero video",
      op: { op: "set_hero_video", from: "assets/hero-client-vanished.mp4", to: NEW_REL, file: "index.html", sha256: CLIP_SHA },
    }],
    readArchived: async () => CLIP_BYTES,
  });
  assert.equal(out.applied.length, 0);
  assert.equal(out.unreplayable[0].reason, "no_reference_to_repoint:assets/hero-client-vanished.mp4");
});

test("replay: the swap already on the fresh build is the state the customer asked for", async () => {
  const files = {
    "index.html": Buffer.from(
      `<!doctype html><html><head></head><body><script type="application/json" id="hero-video-ladder">{"sources":["${NEW_REL}","${FALLBACK_RUNG}"],"version":1}</script></body></html>`,
      "utf8",
    ),
    [NEW_REL]: CLIP_BYTES,
  };
  const out = await R.replayEdits({
    files,
    entries: [{
      jobId: "edit_hero_3",
      at: "2026-09-02T00:00:00.000Z",
      seq: "edit_hero_3#0",
      instruction: "swap the hero video",
      op: { op: "set_hero_video", from: OLD_TOP, to: NEW_REL, file: "index.html", sha256: CLIP_SHA },
    }],
    readArchived: async () => null,
  });
  assert.equal(out.unreplayable.length, 0);
  assert.equal(out.applied[0].note, "already_present");
});

test("the edit log records the swap as replayable — and a half-recorded op is not", () => {
  assert.ok(LOG.REPLAYABLE_OPS.has("set_hero_video"));
  const good = LOG.validateReplayOp({ op: "set_hero_video", from: OLD_TOP, to: NEW_REL, file: "index.html", sha256: CLIP_SHA });
  assert.equal(good.ok, true);
  const emptyFrom = LOG.validateReplayOp({ op: "set_hero_video", from: "", to: NEW_REL, file: "index.html", sha256: CLIP_SHA });
  assert.equal(emptyFrom.ok, true, "an empty `from` is legal: it means the ladder had no playable rung");
  const noSha = LOG.validateReplayOp({ op: "set_hero_video", from: OLD_TOP, to: NEW_REL, file: "index.html" });
  assert.equal(noSha.ok, false);
  assert.equal(noSha.reason, "set_hero_video_missing_sha256");
  const noTo = LOG.validateReplayOp({ op: "set_hero_video", from: OLD_TOP });
  assert.equal(noTo.reason, "set_hero_video_missing_to");
});

// ---------------------------------------------------------------------------
// 5. THE RENDERED CHECK — the ladder AND the element, or it never happened
// ---------------------------------------------------------------------------
test("the hero check lands only when the ladder names the clip AND a video element carries it", () => {
  const pass = {
    expected: NEW_REL, ladderFound: true, ladderReadable: true, ladderTop: NEW_REL,
    videoPresent: true, videoSrc: NEW_REL, armed: true, dead: false,
  };
  assert.equal(V.summarizeVerification({ ok: true, markerPresent: true, checks: [], textChecks: [], heroChecks: [pass] }).status, "landed");

  for (const [broken, reason] of [
    [{ ...pass, ladderFound: false }, "hero_video_ladder_missing"],
    [{ ...pass, ladderTop: OLD_TOP }, "hero_video_not_in_ladder"],
    [{ ...pass, videoPresent: false }, "hero_video_element_missing"],
    [{ ...pass, dead: true, videoSrc: "", armed: false }, "hero_video_failed_to_arm"],
  ]) {
    const verdict = V.summarizeVerification({ ok: true, markerPresent: true, checks: [], textChecks: [], heroChecks: [broken] });
    assert.equal(verdict.status, "not_landed", reason);
    assert.equal(verdict.reason, reason);
  }

  // Not armed YET is honest uncertainty, never a success and never a rollback.
  const waiting = V.summarizeVerification({
    ok: true, markerPresent: true, checks: [], textChecks: [],
    heroChecks: [{ ...pass, armed: false, videoSrc: "" }],
  });
  assert.equal(waiting.status, "unconfirmed");
  assert.equal(waiting.reason, "hero_video_not_armed_yet");
});

// ---------------------------------------------------------------------------
// 6. THE LADDER APPLY FUNCTION — one implementation, both callers
// ---------------------------------------------------------------------------
test("applyHeroLadderSwap: attribute order, invalid JSON, and version bumping", () => {
  // Attribute order the TEST donors ship (id before type).
  const swapped = P.applyHeroLadderSwap(
    '<script id="hero-video-ladder" type="application/json">{"sources":["a.mp4"]}</script>',
    { from: "a.mp4", to: NEW_REL },
  );
  assert.equal(swapped.changed, 1);
  assert.deepEqual(P.heroLadderSources(swapped.html), [NEW_REL]);

  // An unparseable ladder is a ladder this function does not touch.
  const untouched = P.applyHeroLadderSwap(
    '<script id="hero-video-ladder">not json at all</script>',
    { from: "a.mp4", to: NEW_REL },
  );
  assert.equal(untouched.changed, 0);
  assert.match(untouched.html, /not json at all/);

  // An existing version BUMPS; a missing version STARTS at 1.
  assert.equal(P.applyHeroLadderSwap(
    '<script id="hero-video-ladder">{"sources":["a.mp4"],"version":4}</script>',
    { from: "a.mp4", to: NEW_REL },
  ).version, 5);

  // No destination is a hard error, not a silent no-op.
  assert.throws(() => P.applyHeroLadderSwap("<p>x</p>", { from: "a.mp4", to: "" }), /no destination path/);
});

// ---------------------------------------------------------------------------
// 7. THE CAPABILITY FLOOR — honest tier, honest sentence, and the verb list
//    never drifts from the executor's apply loop
// ---------------------------------------------------------------------------
test("capability: the hero video swap is REAL and is NOT promised as instant", () => {
  const hit = caps.classifyRequest("swap the hero video");
  assert.equal(hit.supported, true);
  assert.equal(hit.op, "set_hero_video");
  assert.equal(hit.tier, "bigger_build");
  assert.equal(hit.family, "hero_video");
  assert.equal(caps.classifyRequest("generate a new video for my site").op, "set_hero_video");
  assert.equal(caps.classifyRequest("I want a new hero video").op, "set_hero_video");

  // The picture swap and the styling verbs keep their quick tier: video words
  // do not steal them, and styling words do not steal the video.
  assert.equal(caps.classifyRequest("swap the hero image").op, "swap_image");
  assert.equal(caps.classifyRequest("make the hero video smaller").op, "style_override");
  assert.equal(caps.classifyRequest("make the logo bigger").tier, "quick");

  const described = caps.describeCapability("swap the hero video");
  assert.equal(described.say, caps.HERO_VIDEO_SENTENCE);
  // The laws: honest it runs, honest it is not instant, no duration, no
  // invitation to send a video file.
  assert.match(described.say, /generate the video for you/i);
  assert.match(described.say, /bigger build/i);
  assert.match(described.say, /won't be instant/i);
  assert.doesNotMatch(described.say, /\b(within|in) (an? )?(hour|day|minute)|\bminute\b|\bsecond\b/i);
  assert.doesNotMatch(described.say, /send .*(video|file|link)|upload a video/i);

  // The quick lane's silence is untouched.
  assert.equal(caps.describeCapability("make the logo bigger").say, null);
});

test("capability: the verb list IS the executor's apply loop", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "site-change-plan.js"), "utf8");
  const applyLoop = source.slice(source.indexOf("Phase 3 — the deterministic apply"));
  const executed = new Set();
  for (const m of applyLoop.matchAll(/kind === "([a-z_]+)"/g)) executed.add(m[1]);
  const declared = new Set(caps.EXECUTOR_VERBS.map((v) => v.op));
  assert.ok(executed.has("set_hero_video"), "the executor must have the branch");
  assert.deepEqual([...declared].sort(), [...executed].sort());
});

test("capability: the brief carries the bigger-build tier and the sentence", () => {
  const brief = caps.capabilityBrief();
  assert.deepEqual(brief.tiers.bigger_build.families, ["hero_video"]);
  assert.deepEqual(brief.tiers.bigger_build.supported_ops, ["set_hero_video"]);
  assert.equal(brief.tiers.bigger_build.say, caps.HERO_VIDEO_SENTENCE);
  assert.ok(!caps.QUICK_FAMILIES.includes("hero_video"), "the hero video is not a quick family");
  assert.match(brief.can_do, /hero video for a new one we generate/i);
  // The planner is offered the op, and told it takes no url and no file.
  const contract = P.PLAN_CONTRACT;
  assert.match(contract, /"op":"set_hero_video"/);
  assert.match(contract, /NO\s+url, NO file and NO id/i);
  assert.match(contract, /customer-supplied video files are not supported yet/i);
});

// ---------------------------------------------------------------------------
// 8. THE TIMING TIER — its own bucket, and no number until there is history
// ---------------------------------------------------------------------------
test("timing: hero video requests bucket separately and borrow no instant promise", () => {
  assert.equal(T.bucketOf("swap the hero video for a new one"), "hero_video");
  const row = (status, spanMs, id) => ({
    job_id: id,
    site_slug: "wss-mirror-flint-video",
    instruction: "swap the hero video for a new one",
    status,
    created_at: new Date(Date.now() - spanMs).toISOString(),
    updated_at: new Date().toISOString(),
    result: { timings: { total_s: spanMs / 1000 } },
  });
  const summary = T.summarize(
    [row("done", 200_000, "edit_hero_a"), row("refused", 9_000, "edit_hero_b")],
    { now: Date.now() },
  );
  assert.ok(summary.buckets.hero_video, "the bucket exists");
  const quote = T.quoteFor({ instruction: "swap the hero video", summary });
  // One completed job is "the slowest of the one I have seen" — no number.
  assert.equal(quote.number_spoken, false);
  assert.match(quote.basis.why, /too_few_samples|no_bucket/);
  assert.doesNotMatch(quote.say, /\d/);
});

// ---------------------------------------------------------------------------
// 9. THE VOICE SURFACE — video wording only as far as the verb truly reaches
// ---------------------------------------------------------------------------
test("the tool description carries the hero video, without an instant promise", () => {
  const { universalSiteChangeToolDefinition } = require("../api/admin/vapi-assistants");
  const previous = process.env.VAPI_TOOL_SECRET;
  process.env.VAPI_TOOL_SECRET = "set-hero-video-description-secret";
  try {
    const description = universalSiteChangeToolDefinition(process.env).function.description;
    assert.match(description, /HERO VIDEO/);
    assert.match(description, /GENERATED for their business/i);
    assert.match(description, /Never ask them to send a video file/i);
    assert.match(description, /NOT an instant change/i);
  } finally {
    if (previous === undefined) delete process.env.VAPI_TOOL_SECRET;
    else process.env.VAPI_TOOL_SECRET = previous;
  }
});
