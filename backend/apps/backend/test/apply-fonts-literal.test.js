"use strict";

// Finding 2A: the client's captured typeface downloaded via <link> but was
// referenced by nothing, because applyFontsToCss only rewrote --font-* custom
// props while 7/11 donors (fencing included) bake the family as a literal
// declaration. It now also rewrites the heading element rule, .font-display,
// the Tailwind arbitrary-value heading utility (.font-['Family'] — the class
// that wins by specificity on fencing, the load-bearing Metro Fence cure), and
// the base body/html rule — with strict mono/inherit guards.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applyFontsToCss } = require("../lib/capture-brand.js");
const { resolveBrandAssets } = require("../lib/mirror-engine/brand-assets");
const { buildHash } = require("../lib/mirror-engine/build-hash");

const DONORS = path.join(__dirname, "..", "donors-clean");

function cssFilesFor(donor) {
  const dir = path.join(DONORS, donor, "assets");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".css")).map((f) => path.join(dir, f));
}

test("fencing: the specificity-winning arbitrary heading class gets the client display face", () => {
  const file = cssFilesFor("fencing-sterling")[0];
  const css = fs.readFileSync(file, "utf8");
  const { css: out, changed } = applyFontsToCss(css, { display: "Red Hat Display", body: "Work Sans" });
  assert.ok(changed >= 3, `expected >=3 rewrites, got ${changed}`);
  // The .font-['Outfit'] utility now leads with the client family.
  assert.ok(out.includes(`.font-\\[\\'Outfit\\'\\]{font-family:"Red Hat Display", Outfit}`),
    "arbitrary heading utility must lead with the client display face");
  // The h1..h6 element rule too.
  assert.ok(out.includes(`h1,h2,h3,h4,h5,h6{font-family:"Red Hat Display", Outfit,sans-serif}`),
    "heading element rule must lead with the client display face");
  // Guards: monospace + inherit untouched.
  assert.ok(out.includes("font-family:ui-monospace,SFMono"), "monospace stack must be untouched");
  assert.ok(out.includes("font-family:inherit"), "inherit must be untouched");
});

test("every donor CSS gets the client face applied with no mono/inherit corruption", () => {
  const donors = fs.readdirSync(DONORS).filter((d) => fs.existsSync(path.join(DONORS, d, "assets")));
  let filesWithChange = 0;
  for (const d of donors) {
    for (const file of cssFilesFor(d)) {
      const before = fs.readFileSync(file, "utf8");
      const { css: after, changed } = applyFontsToCss(before, { display: "Red Hat Display", body: "Work Sans" });
      if (changed > 0) filesWithChange += 1;
      const monoBefore = (before.match(/font-family:[^;}]*mono[^;}]*/gi) || []).join("|");
      const monoAfter = (after.match(/font-family:[^;}]*mono[^;}]*/gi) || []).join("|");
      assert.equal(monoAfter, monoBefore, `monospace changed in ${d} ${path.basename(file)}`);
      const inhBefore = (before.match(/font-family:\s*inherit/gi) || []).length;
      const inhAfter = (after.match(/font-family:\s*inherit/gi) || []).length;
      assert.equal(inhAfter, inhBefore, `inherit changed in ${d} ${path.basename(file)}`);
    }
  }
  assert.ok(filesWithChange >= 8, `expected the display face applied to most donors, got ${filesWithChange}`);
});

test("idempotent + no-op when no font captured", () => {
  const css = "h1,h2,h3,h4,h5,h6{font-family:Outfit,sans-serif}";
  assert.equal(applyFontsToCss(css, {}).changed, 0);
  const once = applyFontsToCss(css, { display: "Red Hat Display" }).css;
  const twice = applyFontsToCss(once, { display: "Red Hat Display" });
  assert.equal(twice.changed, 0, "re-applying the same family must not double-insert");
});

test("different normalized client fonts produce different build hashes", async () => {
  const anton = await resolveBrandAssets({
    fonts: {
      display: " Anton ",
      body: " Inter ",
      href: " https://fonts.googleapis.com/css2?family=Anton&family=Inter ",
      provider: "google",
    },
  });
  const oswald = await resolveBrandAssets({
    fonts: {
      display: "Oswald",
      body: "Roboto",
      href: "https://fonts.googleapis.com/css2?family=Oswald&family=Roboto",
      provider: "google",
    },
  });
  const base = {
    donor: "fencing-sterling",
    donorHash: "a".repeat(64),
    facts: { business_name: "Typography Test" },
    phoneDigits: "5558675309",
  };
  const antonHash = buildHash({ ...base, brandHashes: anton.hashes });
  const oswaldHash = buildHash({ ...base, brandHashes: oswald.hashes });

  assert.match(anton.hashes.fonts_sha, /^[a-f0-9]{64}$/);
  assert.notEqual(anton.hashes.fonts_sha, oswald.hashes.fonts_sha);
  assert.notEqual(antonHash, oswaldHash);
});

test("render-driving palette changes move build hashes while equivalent inputs stay stable", async () => {
  const first = await resolveBrandAssets({
    primary: "#123456",
    site_accent: "#f47a1f",
    site_accent_source: "https://ACME.example/brand/colors?session=secret-one#sample",
  });
  const equivalent = await resolveBrandAssets({
    site_accent_source: "https://ACME.example.:443/brand/colors?session=secret-two#ignored",
    site_accent: "#F47A1F",
    primary: "#123456",
  });
  const changed = await resolveBrandAssets({
    primary: "#654321",
    site_accent: "#1f7af4",
    site_accent_source: "https://acme.example/brand/colors",
  });

  assert.match(first.hashes.palette_sha, /^[a-f0-9]{64}$/);
  assert.equal(first.hashes.palette_sha, equivalent.hashes.palette_sha);
  assert.notEqual(first.hashes.palette_sha, changed.hashes.palette_sha);
  assert.doesNotMatch(JSON.stringify(first.hashes), /secret-one|session=/);

  const base = {
    donor: "plumbing-metro",
    donorHash: "b".repeat(64),
    facts: { business_name: "Palette Test" },
    phoneDigits: "5558675309",
  };
  const firstHash = buildHash({ ...base, brandHashes: first.hashes });
  const equivalentHash = buildHash({ ...base, brandHashes: equivalent.hashes });
  const changedHash = buildHash({ ...base, brandHashes: changed.hashes });
  assert.equal(firstHash, equivalentHash);
  assert.notEqual(firstHash, changedHash);
});
