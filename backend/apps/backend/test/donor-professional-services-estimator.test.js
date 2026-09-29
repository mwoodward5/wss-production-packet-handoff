"use strict";

// test/donor-professional-services-estimator.test.js
//
// THE LIBRARY'S FIRST B2B FAMILY (professional-services-estimator), built
// 2026-09-02 as a fictional-identity static template by the Lovable a-plus
// lane: outsourced construction estimating for contractors — quantity
// takeoffs, priced bid packages, scope letters — sold on fixed fees and
// 48-hour turnaround, nationwide. THE HERO VIDEO LADDER contract ships in
// the fleet's standard shape (marked mount bundle, island, walker, kill
// switch), with no rung bytes today: the painted surface is the hero.
//
//   1. The static design ships whole (page + css + hero bundle + drawn
//      slots + the plan-upload dropzone + the calculator).
//   2. ZERO template-identity atoms survive in any shipped byte.
//   3. B2B guardrails: no maps embed, no hours table, no review carousel,
//      no service-radius towns — an estimating firm sells capacity, not a
//      walk-in radius.
//   4. The hero ladder contract (marked mount bundle, no src, island,
//      walker, kill-switch + paint-under CSS) — and an unlit ladder leaves
//      the painted surface exactly as it was.
//   5. Hydration resolves every token (no {{ or NEED residue), full and
//      bare; a phone-less build collapses the whole call path while the
//      upload dropzone keeps converting.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS_CLEAN = path.join(BACKEND, "donors-clean");
const DONOR = "professional-services-estimator";
const DIR = path.join(DONORS_CLEAN, DONOR);

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-estimator-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));
const mountBundle = () =>
  fs.readFileSync(path.join(DIR, "assets", "index-professional-services-estimator.js"), "utf8");

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Cardinal Takeoff Group",
    CITY: "Columbus", ADDRESS_CITY: "Columbus", STATE: "OH", REGION: "OH",
    HERO_HEADLINE: "Construction estimating in Columbus, OH",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(614) 555-0184", PHONE_DIGITS: "6145550184",
      EMAIL: "bids@example.com", COUNTY: "Franklin County",
      LICENSE: "OH-EST-77120", OWNER_NAME: "Marla Quentin",
      PROFILE_URL: "https://maps.google.com/?cid=1", POSTAL: "43215",
      GEO: "39.9612;-82.9988", GEO_LAT: "39.9612", GEO_LNG: "-82.9988",
    });
  }
  return tv;
}

function ladderOf(html) {
  const m = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ---------------------------------------------------------------------------
// 1. The static design ships whole
// ---------------------------------------------------------------------------
test("the static design ships whole: page, stylesheet, hero bundle, drawn slots, dropzone, calculator", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.ok(files["index.html"], "the page ships");
  assert.ok(files["assets/style.css"], "the hand-authored stylesheet ships");
  assert.ok(files["assets/index-professional-services-estimator.js"], "the hero mount bundle ships");
  for (const slot of m.photo_slots) {
    assert.ok(files[slot], `design asset ships: ${slot}`);
  }
  const html = files["index.html"].toString("utf8");
  assert.match(html, /class="ticker"/, "the deliverables ticker ships");
  assert.match(html, /class="bento"/, "the deliverables bento ships");
  assert.match(html, /class="dropzone"/, "the plan-upload dropzone ships");
  assert.match(html, /id="calculator"/, "the bid-hit calculator ships");
  assert.match(html, /class="floater"/, "the floating CTA ships");
  assert.match(files["assets/style.css"].toString("utf8"), /--wss-accent/, "the stylesheet consumes --wss-* tokens");
  // Exactly one document tail: the repaired page must not carry the spliced
  // duplicates the incoming branch shipped.
  assert.equal((html.match(/<\/body>/g) || []).length, 1, "exactly one </body>");
  assert.equal((html.match(/<footer class="site-footer">/g) || []).length, 1, "exactly one footer");
  const hydratedOnce = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal((hydratedOnce.files["index.html"].toString("utf8").match(/class="floater"/g) || []).length, 1,
    "exactly one floater renders");
});

// ---------------------------------------------------------------------------
// 2. TRUTH LAW — zero template-identity atoms in any shipped byte
// ---------------------------------------------------------------------------
test("TRUTH LAW — zero template-identity atoms in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.equal(m.donor_business_name, "Northbeam Estimating Partners");
  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes
    const text = buf.toString("utf8");
    for (const needle of [
      "Northbeam Estimating", "northbeamestimating.com", "Devrim Kalvachev",
      "7205550161", "720-555-0161", "(720) 555-0161", "+17205550161",
      "CO-EST-40921", "80202", "39.7392", "-104.9903",
      "maps.example.com/place/northbeam-estimating-partners",
      "lovableproject.com", "lovable.app",
    ]) {
      assert.ok(!text.includes(needle), `${rel} leaked template identity: ${needle}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. B2B guardrails — no local-trades artifacts
// ---------------------------------------------------------------------------
test("B2B guardrails: no maps embed, no hours table, no review carousel, no radius towns", () => {
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(DIR, "assets", "style.css"), "utf8");
  const all = html + "\n" + css;
  assert.doesNotMatch(all, /google\.com\/maps\/embed|maps\.googleapis\.com\/maps|iframe[^>]+map/i,
    "an estimating firm sells nationwide capacity — no maps embed");
  assert.doesNotMatch(all, /opening\s*hours|hours\s*of\s*operation|<time\s|openingHours/i,
    "no hours table — there is no walk-in door");
  assert.doesNotMatch(all, /carousel|swiper|slick-slider|data-ride="carousel"/i,
    "no review carousel widget");
  // The service-area voice is nationwide, not a radius: the footer names the
  // city once as the firm's own address, never a towns list.
  assert.match(html, /serving contractors nationwide|contractors nationwide/, "the copy sells nationwide capacity");
  assert.doesNotMatch(html, /Service by town|areas-grid|SERVICE x CITY/,
    "no service-x-city local-SEO grid — a B2B estimating firm has no town pages");
  assert.doesNotMatch(html, /Workmanship warranty|Insured &amp; bonded|crews live in|Same address, two weeks apart/,
    "no contractor trust badges or trades before/after framing — an estimator does not build");
});

// ---------------------------------------------------------------------------
// 4. THE HERO VIDEO CONTRACT — mount bundle, ladder, walker, kill-switch
// ---------------------------------------------------------------------------
test("the hero ships the video-first contract: marked mount bundle, no src, island, walker, kill-switch", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = mountBundle();

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 3,
    "the documented ladder (client video, WSS clip, painted surface) must live in the manifest");

  const marker = js.indexOf('"data-hero-video"');
  assert.ok(marker >= 0, "the marked hero video element ships in the mount bundle");
  const frag = js.slice(marker - 60, marker + 430);
  assert.match(frag, /hidden:!0/, "the hero video must mount hidden");
  assert.ok(!/"src":"[^"]*\.mp4"/.test(frag), "no static src — a rung arms only when its bytes shipped");
  assert.ok(!fs.existsSync(path.join(DIR, m.hero_video.wss_fallback_clip_path)),
    "no WSS fallback bytes ship yet — the rung arms the day a vetted clip lands");

  const ladder = ladderOf(html);
  assert.ok(ladder && Array.isArray(ladder.sources), "the ladder island must parse");
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
    "the client's clip outranks the WSS clip");

  assert.match(html, /heroRungs/, "the ladder runtime ships in the shell");
  assert.match(html, /prefers-reduced-motion:\s*reduce/, "reduced motion never arms the video rungs");
  assert.match(html, /video\[data-hero-video\]\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/,
    "the kill-switch must enforce hidden against video display preflights");
  assert.match(html, /data-wss-hero-fallback/, "the paint-under fallback surface ships");
  assert.match(js, /prefers-reduced-motion:\s*reduce/,
    "the mount layer's own reduced-motion guard must stay — it never mounts the video element at all");
});

test("an unlit ladder leaves the painted surface: nothing points at a clip that is not there", () => {
  const { files } = loadDonor(DIR);
  for (const optional of [false, true]) {
    const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional }) });
    assert.equal(out.ok, true, `hydration failed: ${out.error}`);
    const html = out.files["index.html"].toString("utf8");
    const videoRefs = [...html.matchAll(/(?:src|href)="([^"]*\.(?:mp4|webm))"/gi)].map((mm) => mm[1]);
    assert.deepEqual(videoRefs, [],
      `a src pointing at an absent clip is a broken player (${optional ? "full" : "bare"})`);
    assert.match(html, /data-wss-hero-fallback/, "the painted surface stays shipped");
  }
});

// ---------------------------------------------------------------------------
// 5. Hydration — every token resolves; the no-phone build collapses the call path
// ---------------------------------------------------------------------------
test("hydration: a full token set leaves no residue; a phone-less build collapses the call path and keeps the dropzone", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 400)}`);

  for (const rel of ["index.html", "assets/index-professional-services-estimator.js", "assets/style.css"]) {
    const text = out.files[rel].toString("utf8");
    for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
      assert.ok(!text.includes(residue), `${residue} survived hydration in ${rel}`);
    }
  }
  const html = out.files["index.html"].toString("utf8");
  assert.ok(html.includes("Cardinal Takeoff Group"), "the business name lands");
  assert.ok(html.includes("(614) 555-0184"), "the client phone lands");
  assert.match(html, /Send to bids@example\.com/, "the dropzone CTA lands");

  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true, `phone-less hydration failed: ${bare.error} ${JSON.stringify(bare.detail || "").slice(0, 400)}`);
  const bareHtml = bare.files["index.html"].toString("utf8");
  assert.match(bareHtml, /Send the plan set online\./, "no-phone build flips the meta sentence");
  assert.ok(!/href\s*=\s*["']tel:/.test(bareHtml), "no dialable href survives a phone-less build");
  assert.match(bareHtml, /class="dropzone"/, "the upload dropzone survives a phone-less build");
  assert.match(bareHtml, /Send the plan set<\/button>/, "the dropzone CTA survives without an email");
  assert.match(bareHtml, /href="#upload"/, "the header CTA re-anchors to the dropzone");
});
