"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseSiteHost } = require("../lib/host");
const { canonicalFilePath, canonicalRoutePath } = require("../lib/path");
const { parseSingleRange } = require("../lib/range");

test("host policy permits exactly one non-reserved wss-ai.com label", () => {
  assert.deepEqual(parseSiteHost("Acme-Site.wss-ai.com"), {
    host: "acme-site.wss-ai.com",
    slug: "acme-site"
  });
  assert.equal(parseSiteHost("acme-site.wss-ai.com:443").slug, "acme-site");
  for (const host of [
    "wss-ai.com",
    "www.wss-ai.com",
    "api.wss-ai.com",
    "a.b.wss-ai.com",
    "site.wss-ai.com.evil.test",
    "ghost-agency-backend.vercel.app",
    "site.wss-ai.com.",
    "site..wss-ai.com",
    "-site.wss-ai.com"
  ]) assert.equal(parseSiteHost(host), null, host);
});

test("route canonicalization rejects traversal and ambiguous encodings", () => {
  assert.equal(canonicalRoutePath("/"), "/");
  assert.equal(canonicalRoutePath("/assets/hero%20photo.webp"), "/assets/hero photo.webp");
  assert.equal(canonicalFilePath("assets/hero%20photo.webp"), null);
  assert.equal(canonicalFilePath("assets/hero photo.webp"), null);
  for (const value of [
    "/../secret",
    "/%2e%2e/secret",
    "/%252e%252e/secret",
    "/assets%2fsecret",
    "/assets\\secret",
    "/assets//secret",
    "/./secret",
    "/bad%ZZ",
    "/x?y",
    "/x#y"
  ]) assert.equal(canonicalRoutePath(value), null, value);
});

test("single ranges support fixed and suffix forms but reject abuse", () => {
  assert.deepEqual(parseSingleRange("bytes=2-5", 10), { start: 2, end: 5, length: 4 });
  assert.deepEqual(parseSingleRange("Bytes=2-5", 10), { start: 2, end: 5, length: 4 });
  assert.deepEqual(parseSingleRange("bytes=-3", 10), { start: 7, end: 9, length: 3 });
  assert.deepEqual(parseSingleRange("bytes=8-", 10), { start: 8, end: 9, length: 2 });
  assert.equal(parseSingleRange("bytes=0-1,4-5", 10), null);
  assert.equal(parseSingleRange("items=0-1", 10), null);
  assert.equal(parseSingleRange("bytes=10-11", 10), null);
  assert.deepEqual(parseSingleRange("bytes=0-9", 10, 5), { start: 0, end: 4, length: 5 });
});
