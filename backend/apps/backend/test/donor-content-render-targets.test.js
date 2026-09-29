"use strict";

// test/donor-content-render-targets.test.js
//
// THE HAYS CONTRACT. On 2026-08-31 Hays Roofing died not_revealable with five
// supplied channels, seven photos, NAP and a verified Genie compile — killed
// by a manifest gap, not missing content. The roofing donor declared
// `renders: ["services","faq"]` while `content_render_targets` named only
// `services`, so the floor demanded a visible-target proof for a channel the
// audit had no selector for. `target_checked` was false BY CONSTRUCTION and
// the build died at `content_floor=failed`.
//
// The floor's bar is correct and stays: a donor that claims native rendering
// of a channel suppresses the shared appended section for it, so every
// claimed channel MUST be provable against an audited target. That means a
// consuming donor's manifest is only valid when every channel it claims in
// `renders` carries a `content_render_targets` entry for the home page. This
// test holds that contract for the whole donor library, so the next manifest
// that claims a channel without naming its audit target fails HERE, in CI,
// instead of killing a real business's build in production.
//
// Mocked and fast: it reads BOILERPLATE.json only. The selectors themselves
// are proven by the per-donor browser tests (e.g.
// test/donor-roofing-falcon-clean.test.js, which runs the real renderAudit
// baseline differential against the declared targets).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DONORS = path.join(__dirname, "..", "donors-clean");

// The island channel names the audit reads (verify.js reads exactly these
// keys off window.__WSS_CONTENT__), and the aliases a manifest may use in its
// `renders` list for each — the same alias table the content floor resolves
// (lib/mirror-lane-build.js nativeAliases).
const ISLAND_CHANNELS = new Set(["services", "faqs", "areas", "reviews", "hours", "about"]);
const RENDERS_ALIASES = {
  services: ["services"],
  faqs: ["faq", "faqs"],
  areas: ["area", "areas", "coverage"],
  reviews: ["reviews"],
  hours: ["hours"],
  about: ["about"],
};

function consumingDonors() {
  return fs.readdirSync(DONORS, { withFileTypes: true })
    .filter((ent) => ent.isDirectory() && fs.existsSync(path.join(DONORS, ent.name, "BOILERPLATE.json")))
    .map((ent) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(DONORS, ent.name, "BOILERPLATE.json"), "utf8"));
      return { name: ent.name, manifest };
    })
    .filter(({ manifest }) => manifest.consumes_content === true);
}

test("every consuming donor declares an auditable home-page target for each channel it claims", () => {
  const donors = consumingDonors();
  assert.ok(donors.length >= 8, "the consuming donor set shrank unexpectedly — update this test deliberately");

  for (const { name, manifest } of donors) {
    const targets = manifest.content_render_targets || {};
    for (const key of Object.keys(targets)) {
      assert.ok(ISLAND_CHANNELS.has(key),
        `${name}: content_render_targets key "${key}" is not an island channel the audit reads — the proof would never run`);
    }
    for (const claim of manifest.renders || []) {
      const channel = Object.entries(RENDERS_ALIASES)
        .find(([, aliases]) => aliases.includes(String(claim).toLowerCase()))?.[0];
      assert.ok(channel, `${name}: renders entry "${claim}" matches no island channel`);
      const specs = targets[channel] || [];
      const homeSpecs = specs.filter((spec) => spec && typeof spec === "object" && String(spec.path || "/") === "/" && String(spec.selector || "").trim());
      assert.ok(homeSpecs.length > 0,
        `${name}: claims "${claim}" (${channel}) but declares no home-page content_render_target for it — the floor would kill every build supplying ${channel} (the Hays Roofing kill, 2026-08-31)`);
    }
  }
});

test("a consuming donor that renders nothing natively is the honest minimal case", () => {
  // general-contractor-clean is the reference minimal manifest: one claimed
  // channel, one declared target. It must keep passing the contract above.
  const minimal = consumingDonors().find(({ name }) => name === "general-contractor-clean");
  assert.ok(minimal, "general-contractor-clean is the reference minimal consuming donor");
  assert.deepEqual((minimal.manifest.renders || []).sort(), ["services"]);
  assert.ok(minimal.manifest.content_render_targets.services.length >= 1);
});
