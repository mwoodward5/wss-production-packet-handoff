"use strict";
const test = require("node:test");
const assert = require("node:assert");
const wb = require("../lib/web-brand");

test("sameOwner accepts subdomains of the same site, rejects everyone else", () => {
  assert.equal(wb.sameOwner("https://sunsetroofing.com/", "https://www.sunsetroofing.com/img/logo.png"), true);
  assert.equal(wb.sameOwner("https://www.sunsetroofing.com/", "https://cdn.sunsetroofing.com/logo.svg"), true);
  // The APOC incident: a manufacturer's mark from an image search is NOT the
  // prospect's logo, no matter how logo-shaped its filename is.
  assert.equal(wb.sameOwner("https://sunsetroofing.com/", "https://apoc.com/assets/apoc-logo.png"), false);
  assert.equal(wb.sameOwner("https://sunsetroofing.com/", "https://images.example.net/found/logo.png"), false);
});

test("findLogoCandidates keeps only same-owner, non-third-party logo images", () => {
  const html = `
    <img class="site-logo" src="/assets/logo-main.png" alt="Sunset Roofing">
    <img src="https://apoc.com/apoc-logo.png" alt="APOC The Roof Restoration Experts">
    <img src="/media/gaf-certified-logo.png" alt="GAF">
    <img src="/photos/roof-job-12.jpg" alt="finished roof">
    <link rel="apple-touch-icon" href="/icons/touch.png">
  `;
  const got = wb.findLogoCandidates(html, "https://sunsetroofing.com/");
  assert.deepEqual(got, [
    "https://sunsetroofing.com/assets/logo-main.png",
    "https://sunsetroofing.com/icons/touch.png",
  ]);
});

test("findLogoCandidates prefers a header logo over footer/mono variants", () => {
  const html = `
    <img class="footer-logo" src="/logo-white-mono.png" alt="logo">
    <img class="header-logo" src="/logo.png" alt="logo">
  `;
  const got = wb.findLogoCandidates(html, "https://example.com/");
  assert.equal(got[0], "https://example.com/logo.png");
});

test("rankCssColors surfaces the loudest real color and ignores greys", () => {
  const css = `
    a { color: #ffffff } b { color: #111 } c { color: #c8102e }
    .btn { background: #c8102e } .btn:hover { background: #C8102E }
    .muted { color: #888888 }
  `;
  const got = wb.rankCssColors([css]);
  assert.equal(got[0].hex, "#c8102e");
  assert.ok(!got.some((c) => c.hex === "#ffffff" || c.hex === "#888888"));
});

test("brandFromWebsite fails closed on a non-URL", async () => {
  const got = await wb.brandFromWebsite("not-a-url");
  assert.equal(got.measured, false);
  assert.equal(got.logo, null);
  assert.equal(got.accent, null);
});

function fakeResponse({ url, body = "", contentType = "text/html" }) {
  return {
    ok: true,
    url,
    headers: { get: (name) => String(name).toLowerCase() === "content-type" ? contentType : "" },
    text: async () => body,
    arrayBuffer: async () => Buffer.from(body),
  };
}

test("brandFromWebsite refuses a homepage redirect to another owner", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => fakeResponse({
    url: "https://competitor.example/",
    body: '<style>:root{--accent:#ff0000}</style><img class="custom-logo" src="/logo.svg">',
  });
  const got = await wb.brandFromWebsite("https://victim.example/", { businessName: "Victim Plumbing" });
  assert.equal(got.measured, false);
  assert.equal(got.logo, null);
  assert.equal(got.accent, null);
  assert.equal(got.hardProvenanceFailure.reason, "homepage_redirect_provenance_failed");
});

test("brandFromWebsite refuses logo and CSS bytes after cross-owner redirects", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (input) => {
    const requested = String(input);
    if (requested.endsWith("/logo.svg")) return fakeResponse({
      url: "https://competitor.example/logo.svg",
      body: '<svg width="600" height="180" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="180" fill="#ff0000"/></svg>',
      contentType: "image/svg+xml",
    });
    if (requested.endsWith("/brand.css")) return fakeResponse({
      url: "https://competitor.example/brand.css",
      body: ":root{--accent:#ff0000}",
      contentType: "text/css",
    });
    return fakeResponse({
      url: "https://victim.example/",
      body: '<img class="custom-logo" src="/logo.svg"><link rel="stylesheet" href="/brand.css">',
    });
  };
  const got = await wb.brandFromWebsite("https://victim.example/", { businessName: "Victim Plumbing" });
  assert.equal(got.logo, null);
  assert.equal(got.accent, null);
  assert.equal(got.measured, false);
  assert.equal(got.hardProvenanceFailure.reason, "logo_redirect_provenance_failed");
});

test("brandFromWebsite refuses HTTPS downgrade and redirect laundering through approved CDNs", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = async () => fakeResponse({ url: "http://victim.example/", body: '<style>:root{--accent:#ff0000}</style>' });
  const downgraded = await wb.brandFromWebsite("https://victim.example/", { businessName: "Victim Plumbing" });
  assert.equal(downgraded.measured, false);
  assert.equal(downgraded.hardProvenanceFailure.reason, "homepage_redirect_provenance_failed");

  global.fetch = async (input) => {
    const requested = String(input);
    if (requested.endsWith("/logo.svg")) return fakeResponse({
      url: "https://cdn-website.com/victim-plumbing-logo.svg",
      body: '<svg width="600" height="180" xmlns="http://www.w3.org/2000/svg"></svg>',
      contentType: "image/svg+xml",
    });
    return fakeResponse({ url: "https://victim.example/", body: '<img class="custom-logo" src="/logo.svg">' });
  };
  const laundered = await wb.brandFromWebsite("https://victim.example/", { businessName: "Victim Plumbing" });
  assert.equal(laundered.logo, null);
  assert.equal(laundered.hardProvenanceFailure.reason, "logo_redirect_provenance_failed");
});

test("brandFromWebsite rechecks the third-party denylist after a same-owner redirect", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (input) => {
    const requested = String(input);
    if (requested.endsWith("/logo.svg")) return fakeResponse({
      url: "https://victim.example/navien-logo.png",
      body: '<svg width="600" height="180" xmlns="http://www.w3.org/2000/svg"></svg>',
      contentType: "image/svg+xml",
    });
    return fakeResponse({ url: "https://victim.example/", body: '<img class="custom-logo" src="/logo.svg">' });
  };
  const got = await wb.brandFromWebsite("https://victim.example/", { businessName: "Victim Plumbing" });
  assert.equal(got.logo, null);
  assert.equal(got.hardProvenanceFailure.reason, "logo_third_party_mark");
});
