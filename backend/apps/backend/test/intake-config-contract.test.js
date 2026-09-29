"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { sourceUrls } = require("../lib/intake-genie-client");

test("generic socialUrl remains part of the canonical request only for owner-qualified prospects", () => {
  // Fresh search-harvested candidates compile against their own website only:
  // third-party sources produce unsupported service claims that disqualify
  // the whole compile (present_service_evidence_invalid).
  const fresh = sourceUrls({
    socialUrl: "https://social.example/profile",
    current_website: "https://own.example/",
    record: { source_urls: ["https://directory.example/listing"] },
  });
  assert.deepEqual(Object.keys(fresh).sort(), ["website_url"]);
  assert.equal(fresh.website_url, "https://own.example/");

  // Owner-qualified (leadminer_mirror_ready) packets keep their full,
  // provenance-bound source set including socials.
  const qualified = sourceUrls({
    socialUrl: "https://social.example/profile",
    current_website: "https://own.example/",
    record: {
      truth_packet_source: "leadminer_mirror_ready",
      source_urls: ["https://directory.example/listing"],
    },
  });
  assert.equal(qualified.social_url, "https://social.example/profile");
  assert.equal(qualified.website_url, "https://own.example/");
});

test("canonical Intake Genie variables are documented once with compatibility aliases", () => {
  const example = fs.readFileSync(path.resolve(__dirname, "../.env.example"), "utf8");
  for (const key of ["INTAKE_GENIE_BASE_URL", "INTAKE_GENIE_TOKEN"]) {
    const matches = example.match(new RegExp(`^${key}=`, "gm")) || [];
    assert.equal(matches.length, 1, `${key} should be documented exactly once`);
  }
  assert.match(example, /^GHOST_AGENCY_INTAKE_GENIE_URL=$/m);
  assert.match(example, /^GHOST_AGENCY_INTAKE_GENIE_TOKEN=$/m);
});
