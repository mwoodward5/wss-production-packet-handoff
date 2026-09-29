"use strict";

// test/hero-video-lane.test.js — the live-video hero contract.
//
// The owner's audit (2026-08-16) rejected the "no hero video" factory
// contract: a source site with a hero video must ship that video — or fall
// down the donor's documented ladder — never a Ken Burns still sold as
// cinema. These tests keep the pipe open at the request layer: an approved
// video asset in the Genie packet rides in brand.hero_video and passes the
// REAL schema (the same checkMirrorRequest the engine runs); anything the
// Genie did not approve ships nothing at all.

const test = require("node:test");
const assert = require("node:assert/strict");

const { genieToMirrorRequest } = require("../lib/mirror-engine/from-genie");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

const VERIFIED_NAP = { phone: "(520) 900-1442", source: "leadminer:place-lyons-roofing" };

function packetWithAssets(assets) {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "roofing", message: "" },
    facts: {
      name: "Lyons Roofing",
      city: "Tucson",
      state: "AZ",
      category: "roofing",
      phone: "(520) 900-1442",
      email: "",
      website: "https://www.lyonsroofing.com/",
      address: "895 W Grant Rd, Tucson, AZ 85705",
      latlng: [32.254, -110.9742],
    },
    // The real Genie packet carries assets at the ROOT (see the live fixture
    // genie-packet-jacksonville-roofing-usa.json), never nested.
    assets,
    trust: {},
  };
}

test("an approved video asset rides in brand.hero_video and passes the real schema", () => {
  const r = genieToMirrorRequest(packetWithAssets([
    { kind: "logo", url: "https://www.lyonsroofing.com/logo.png", approved: true, meta: {} },
    { kind: "video", url: "https://www.lyonsroofing.com/media/hero.mp4", approved: true, meta: {} },
  ]), { slug: "wss-test-lyons-roofing-tucson", verifiedNap: VERIFIED_NAP });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.request.brand.hero_video,
    { url: "https://www.lyonsroofing.com/media/hero.mp4" },
    "the approved clip is the hero video, url verbatim",
  );
  const structural = checkMirrorRequest(r.request);
  assert.equal(structural.ok, true, JSON.stringify(structural.body));
});

test("TRUTH LAW: an unapproved or URL-less video ships nothing", () => {
  for (const bad of [
    { kind: "video", url: "https://www.lyonsroofing.com/media/hero.mp4", approved: false, meta: {} },
    { kind: "video", approved: true, meta: {} },
  ]) {
    const r = genieToMirrorRequest(packetWithAssets([bad]), {
      slug: "wss-test-lyons-roofing-tucson",
      verifiedNap: VERIFIED_NAP,
    });
    assert.equal(r.ok, true);
    assert.ok(
      !(r.request.brand && r.request.brand.hero_video),
      "no approved url => no hero_video key at all",
    );
  }
});
