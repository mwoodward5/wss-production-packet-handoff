"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectHeroImage,
} = require("../lib/mirror-engine/hero-image-selector");

test("opaque 512x512 GBP logo is never selected", () => {
  const logo = {
    url: "https://lh3.googleusercontent.com/places/opaque-media=w512-h512",
    source: "gbp",
    sourceContext: "gbp",
    grade: "hero",
    width: 512,
    height: 512,
    bytes: 180_000,
    mime: "image/png",
  };

  const result = selectHeroImage([logo]);

  assert.equal(result.best, null);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /gbp-landscape-unproven/);
});

test("suitable landscape GBP work photo remains selectable", () => {
  const workPhoto = {
    url: "https://lh3.googleusercontent.com/places/opaque-media=w1600-h900",
    source: "gbp",
    sourceContext: "gbp",
    grade: "hero",
    width: 1600,
    height: 900,
    bytes: 420_000,
    mime: "image/jpeg",
  };

  const result = selectHeroImage([workPhoto]);

  assert.strictEqual(result.best, workPhoto);
  assert.equal(result.ranked.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.ok(result.ranked[0].score > 0);
  assert.ok(result.ranked[0].reasons.includes(
    "no-people:+0 opaque GBP media has no explicit no-people evidence"
  ));
});

test("identity and brand-mark signals veto otherwise suitable GBP media", () => {
  const base = {
    source: "gbp",
    sourceContext: "gbp",
    grade: "hero",
    width: 1600,
    height: 900,
    bytes: 420_000,
    mime: "image/jpeg",
  };
  const identity = {
    ...base,
    url: "https://lh3.googleusercontent.com/places/identity",
    identity_critical: true,
  };
  const brandMark = {
    ...base,
    url: "https://lh3.googleusercontent.com/places/brand",
    asset_type: "brand_mark",
  };

  const result = selectHeroImage([identity, brandMark]);

  assert.equal(result.best, null);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected[0].reason, /identity-critical/);
  assert.match(result.rejected[1].reason, /likely-logo/);
});

test("Tennessee-like bank prefers explicit people-free work without inventing evidence", () => {
  const bannerWithUnverifiedFaces = {
    url: "https://client.example/uploads/banner-default-imgx.jpg",
    source: "own_site",
    found_on: "https://client.example/sewage-pump/",
    sha256: "a".repeat(64),
    width: 1920,
    height: 762,
    bytes: 420_000,
    mime: "image/jpeg",
    ext: "jpg",
  };
  const peopleFreeEquipment = {
    url: "https://client.example/uploads/water-heater-for-homes.jpg",
    source: "own_site",
    found_on: "https://client.example/water-heaters/",
    sha256: "b".repeat(64),
    width: 1600,
    height: 900,
    bytes: 380_000,
    mime: "image/jpeg",
    ext: "jpg",
    people_free: true,
  };

  const ranked = selectHeroImage([bannerWithUnverifiedFaces, peopleFreeEquipment]);
  const bannerRow = ranked.ranked.find((row) => row.candidate === bannerWithUnverifiedFaces);
  assert.ok(bannerRow);
  assert.ok(bannerRow.reasons.includes("no-people:+0 no explicit no-people evidence"));
  assert.strictEqual(ranked.best, peopleFreeEquipment);

  assert.ok(ranked.ranked.every((row) => (
    row.candidate === bannerWithUnverifiedFaces || row.candidate === peopleFreeEquipment
  )), "selection never fabricates a candidate");
});

test("only an explicit people signal vetoes an owned banner", () => {
  const peopleBanner = {
    url: "https://client.example/uploads/banner-default-imgx.jpg",
    source: "own_site",
    sourceContext: "own_site",
    found_on: "https://client.example/",
    sha256: "c".repeat(64),
    width: 1920,
    height: 762,
    bytes: 420_000,
    mime: "image/jpeg",
    contains_recognizable_people: true,
  };
  const equipment = {
    ...peopleBanner,
    url: "https://client.example/uploads/sump-pump.jpg",
    sha256: "d".repeat(64),
    width: 1600,
    height: 900,
    contains_recognizable_people: false,
    no_people: true,
  };

  const result = selectHeroImage([peopleBanner, equipment]);
  assert.strictEqual(result.best, equipment);
  assert.equal(result.rejected.length, 1);
  assert.strictEqual(result.rejected[0].candidate, peopleBanner);
  assert.match(result.rejected[0].reason, /people-present/);
});
