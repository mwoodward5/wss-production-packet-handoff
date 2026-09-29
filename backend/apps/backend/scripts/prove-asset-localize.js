"use strict";

// scripts/prove-asset-localize.js
//
// PROVE THE URL REWRITE ON ONE BUILD (spec point 4), hermetically — no creds, no
// network. Grounded in a REAL prospect's own photo-bank URLs read from
// artifacts/fleet-surfaces-gunther.json (guntherplumbing.com).
//
// It demonstrates, in one run, the whole owner strategy:
//   1. SNAPSHOT at qualify: capture the exact bytes we referenced (logs captured
//      vs already-404).
//   2. THE OLD SITE GOES DARK: after signup we make the live host 404 for a
//      photo we DID snapshot — and localize still promotes it, because we own
//      the bytes. This is the entire reason snapshot exists.
//   3. LOCALIZE at signup: rewrite every their-host url to our host.
//   4. FAIL-SAFE: a photo that is dead AND was never snapshotted is DROPPED to
//      the accent/pattern fallback — never a broken <img>.
//   5. BEFORE/AFTER DOM printed and written to disk.
//
// Run: node scripts/prove-asset-localize.js

const fs = require("node:fs");
const path = require("node:path");

const {
  createMemoryAssetStore,
  CLIENT_ASSETS_PREFIX,
  ASSET_SNAPSHOTS_PREFIX,
  SNAPSHOT_TTL_DAYS,
} = require("../lib/client-asset-store");
const {
  snapshotReferencedAssets,
  localizeBuild,
  isOurHost,
} = require("../lib/asset-ownership");

const OUT_DIR = process.env.PROVE_OUT_DIR
  || path.join(require("node:os").tmpdir(), "asset-localize-proof");

function realGuntherUrls() {
  const p = path.join(__dirname, "..", "artifacts", "fleet-surfaces-gunther.json");
  const text = fs.readFileSync(p, "utf8");
  const urls = [...new Set(text.match(/https?:\/\/[^"'\\ ]+\.(?:jpg|jpeg|png|webp|avif)/gi) || [])]
    .filter((u) => /guntherplumbing\.com/i.test(u));
  if (urls.length < 3) throw new Error("expected real gunther photo urls in the artifact");
  return urls;
}

function buildFrom(urls) {
  const [hero, logo, ...rest] = urls;
  const gallery = rest.slice(0, 3);
  const photos = [hero, ...gallery];
  return {
    slug: "gunther-plumbing",
    vertical: "plumbing",
    brand: {
      logo,
      photos: photos.slice(),
      photo_bank: {
        version: 1,
        photos: photos.map((url, i) => ({
          url, source: "own_site", sha256: `sha_${i}`,
          grade: i === 0 ? "hero" : "gallery", rank: i,
        })),
        counts: { kept: photos.length, own_site: photos.length, gbp: 0 },
      },
    },
    design_brief: { applied: { current_hero: hero } },
  };
}

function domFrom(build) {
  const b = build.brand;
  const imgs = [
    `  <img class="logo" src="${typeof b.logo === "string" ? b.logo : ""}" alt="logo">`,
    `  <img class="hero" src="${b.photos[0] || ""}" alt="hero">`,
    ...b.photos.slice(1).map((u, i) => `  <img class="gallery" src="${u}" alt="work ${i + 1}">`),
  ];
  return `<section class="mirror">\n${imgs.join("\n")}\n</section>\n`;
}

// A fetch that lets the caller mark specific urls dead (404), to script both the
// "old site goes dark" and the "truly dead" cases.
function scriptedFetch(deadSet) {
  return async function (url) {
    if (deadSet.has(url)) {
      return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const body = Buffer.from(`REAL-BYTES(${url})`);
    return {
      ok: true, status: 200,
      headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? "image/jpeg" : "") },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
}

function line(n = 72) { return "-".repeat(n); }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const urls = realGuntherUrls();
  const build = buildFrom(urls);
  const dom = domFrom(build);

  const hero = build.brand.photos[0];
  const galleryLast = build.brand.photos[build.brand.photos.length - 1];

  // A truly-dead photo we NEVER snapshot and that is 404 at signup -> fail-safe.
  const trulyDead = "https://guntherplumbing.com/wp-content/uploads/2024/06/removed-by-owner.png";
  build.brand.photos.push(trulyDead);
  build.brand.photo_bank.photos.push({ url: trulyDead, source: "own_site", sha256: "sha_dead", grade: "gallery", rank: 99 });
  const domWithDead = domFrom(build);

  console.log(line());
  console.log("ASSET OWNERSHIP PROOF  (hermetic, real guntherplumbing.com photo-bank urls)");
  console.log(line());
  console.log(`\nBEFORE — the build's DOM points at THEIR host (${urls.length} real urls in the artifact):\n`);
  console.log(domWithDead);

  // ---- 1. SNAPSHOT AT QUALIFY -------------------------------------------
  // We email this prospect, so we insure the bytes. We snapshot everything
  // EXCEPT the truly-dead one (which is already gone) — and note the log.
  const snapshotStore = createMemoryAssetStore({ prefix: ASSET_SNAPSHOTS_PREFIX, isPublic: false, ttlDays: SNAPSHOT_TTL_DAYS });
  const snapResult = await snapshotReferencedAssets({
    build,
    snapshotStore,
    fetchImpl: scriptedFetch(new Set([trulyDead])), // truly-dead already 404 at snapshot time
  });
  console.log(line());
  console.log("STEP 1 — SNAPSHOT INSURANCE at qualify (private, TTL " + SNAPSHOT_TTL_DAYS + "d):");
  console.log(`  captured ${snapResult.snapshotted.length} photo(s), ${snapResult.bytes} bytes`);
  console.log(`  already 404 at snapshot time: ${snapResult.dead.map((d) => d.url).join(", ") || "(none)"}`);

  // ---- 2. THE OLD SITE GOES DARK ----------------------------------------
  // The customer signs up and cancels the old provider. Their whole host now
  // 404s. The ONLY reason their site will not go down with it is the snapshot.
  const oldSiteFullyDark = new Set([...build.brand.photos, (typeof build.brand.logo === "string" ? build.brand.logo : "")]);
  oldSiteFullyDark.delete(""); // keep set clean

  // ---- 3. LOCALIZE AT SIGNUP --------------------------------------------
  const permanentStore = createMemoryAssetStore({ prefix: CLIENT_ASSETS_PREFIX, isPublic: true, host: "assets.wss-ai.com" });
  const localized = await localizeBuild({
    build,
    html: domWithDead,
    permanentStore,
    snapshotStore,
    // Live site is now ENTIRELY dark. Everything must come from the snapshot,
    // except trulyDead which was never snapshotted -> fail-safe.
    fetchImpl: scriptedFetch(oldSiteFullyDark),
  });

  console.log(line());
  console.log("STEP 2 — OLD SITE GOES DARK, then STEP 3 — LOCALIZE ON SIGNUP:");
  console.log(`  localized ${localized.localized} photo(s); ${localized.usedSnapshot} served FROM THE SNAPSHOT (live host was dark)`);
  console.log(`  fell back (dead + never snapshotted): ${localized.fellBack.map((f) => f.url).join(", ") || "(none)"}`);
  console.log(`\nAFTER — the build's DOM now points at OUR host:\n`);
  console.log(localized.html);

  console.log(line());
  console.log("REWRITE TABLE (their host -> our host, or DROPPED):");
  for (const r of localized.rewrites) {
    const from = r.from.replace(/^https?:\/\//, "");
    console.log(`  ${r.to ? "REHOST " : "DROP   "} ${from}\n     -> ${r.to || "(accent/pattern fallback — fail-safe)"}${r.via ? `   [via ${r.via}]` : ""}`);
  }

  // ---- ASSERTIONS (the proof is only a proof if it checks itself) -------
  const problems = [];
  const afterJson = JSON.stringify(localized.build);
  if (afterJson.includes("guntherplumbing.com")) problems.push("a their-host url survived in the build");
  if (/src="https?:\/\/guntherplumbing\.com/.test(localized.html)) problems.push("a their-host url survived in the DOM");
  if (localized.html.includes(trulyDead)) problems.push("the truly-dead url is still in the DOM (should be dropped)");
  if (localized.build.brand.photos.some((u) => !u)) problems.push("a null/empty photo slot leaked (broken image)");
  if (!localized.build.brand.photos.every((u) => isOurHost(u))) problems.push("a photo is not on our host after localize");
  if (localized.usedSnapshot < 1) problems.push("expected at least one photo served from the snapshot");
  if (localized.fellBack.length !== 1) problems.push(`expected exactly 1 fail-safe drop, got ${localized.fellBack.length}`);
  // page still shows the SAME photographs, just re-hosted: hero + gallery kept
  if (localized.build.brand.photos.length !== build.brand.photos.length - 1) {
    problems.push("kept-photo count is wrong after the single fail-safe drop");
  }

  fs.writeFileSync(path.join(OUT_DIR, "before-dom.html"), domWithDead);
  fs.writeFileSync(path.join(OUT_DIR, "after-dom.html"), localized.html);
  fs.writeFileSync(path.join(OUT_DIR, "rewrites.json"), JSON.stringify(localized.rewrites, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "after-build.json"), JSON.stringify(localized.build, null, 2));

  console.log(line());
  console.log("Artifacts written:");
  console.log("  " + path.join(OUT_DIR, "before-dom.html"));
  console.log("  " + path.join(OUT_DIR, "after-dom.html"));
  console.log("  " + path.join(OUT_DIR, "rewrites.json"));
  console.log("  " + path.join(OUT_DIR, "after-build.json"));
  console.log(line());
  if (problems.length) {
    console.log("PROOF FAILED:");
    for (const p of problems) console.log("  x " + p);
    process.exitCode = 1;
  } else {
    console.log("PROOF PASSED: before=their-host, after=our-host, same photos re-hosted,");
    console.log("one dead-and-unsnapshotted photo dropped to accent/pattern, zero broken images,");
    console.log("and a snapshotted photo survived the old site going completely dark.");
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
