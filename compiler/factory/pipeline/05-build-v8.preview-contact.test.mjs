import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_PREVIEW_CONTACT_ENDPOINT,
  build,
  directionUrls,
  previewContactConfig,
  previewContactScript,
  publicBusinessDisplayName,
  quoteFormHtml,
  resolvePublicSiteUrl,
  reviewAttribution,
  sourceBrandLogoUrl,
} from "./05-build-v8.mjs";

test("public business display names remove scraped title suffixes", () => {
  assert.equal(publicBusinessDisplayName("AR Landscapes | Landscape Design Fresno"), "AR Landscapes");
  assert.equal(publicBusinessDisplayName("Cedar Stone · Fresno, CA"), "Cedar Stone");
  assert.equal(publicBusinessDisplayName("Black Diamond Paver Stones & Landscape, Inc."), "Black Diamond Paver Stones & Landscape, Inc.");
});

test("preview contact config honors the build ticket and preserves fallback data", () => {
  const config = previewContactConfig({
    business: { name: "Packet Business" },
    prospect: { business_name: "Prospect Business", phone: "+1 (949) 555-0100" },
    contact_capture: {
      endpoint: "https://receiver.example/api/contact",
      prospect_id: "lead_123",
      fallback_href: "mailto:owner@example.com",
    },
  });

  assert.deepEqual(config, {
    endpoint: "https://receiver.example/api/contact",
    prospect_id: "lead_123",
    business_name: "Prospect Business",
    phone: "+1 (949) 555-0100",
    fallback_href: "mailto:owner@example.com",
  });
});

test("preview contact config fails over to the production receiver", () => {
  const config = previewContactConfig({}, { businessName: "Local Team" });
  assert.equal(config.endpoint, DEFAULT_PREVIEW_CONTACT_ENDPOINT);
  assert.equal(config.business_name, "Local Team");
});

test("quote form includes required fields, status output, and honeypot", () => {
  const html = quoteFormHtml({
    contactCapture: {
      endpoint: DEFAULT_PREVIEW_CONTACT_ENDPOINT,
      fallback_href: "mailto:owner@example.com",
    },
  });

  assert.match(html, /data-quote-form/);
  assert.match(html, /name="name"[^>]*required/);
  assert.match(html, /name="email_or_phone"[^>]*required/);
  assert.match(html, /name="message"[^>]*required/);
  assert.match(html, /name="website"/);
  assert.match(html, /data-quote-status/);
  assert.match(html, /action="mailto:owner@example\.com"/);
});

test("inline client escapes script-breaking ticket values", () => {
  const script = previewContactScript({
    endpoint: "https://receiver.example/</script><script>alert(1)</script>",
    prospect_id: "lead_123",
    business_name: "Safe Team",
    phone: "",
    fallback_href: "mailto:owner@example.com",
  });

  assert.doesNotMatch(script, /<\/script>/i);
  assert.match(script, /window\.PREVIEW_CONTACT=/);
  assert.match(script, /json\.accepted!==true/);
  assert.doesNotThrow(() => new Function(script));
});

test("public metadata accepts only explicit public HTTPS site roots", () => {
  assert.equal(resolvePublicSiteUrl({ public_url: "/preview/" }), null);
  assert.equal(resolvePublicSiteUrl({ public_url: "http://cedarstone.example.com/" }), null);
  assert.equal(resolvePublicSiteUrl({ public_url: "https://localhost:3000/" }), null);
  assert.equal(resolvePublicSiteUrl({ public_url: "https://preview.example.test/" }), null);
  assert.equal(
    resolvePublicSiteUrl({ public_url: "https://cedar-stone.vercel.app/showcase?draft=1#hero" }),
    "https://cedar-stone.vercel.app/showcase/",
  );
});

test("direction models omit unavailable or untrusted providers instead of returning nulls", () => {
  assert.deepEqual(directionUrls({ googleDirectionsUrl: null, appleDirectionsUrl: null }), {});
  assert.deepEqual(directionUrls({ googleDirectionsUrl: "https://google.example.test/maps/dir" }), {});
  assert.deepEqual(directionUrls({
    googleDirectionsUrl: "https://www.google.com/maps/dir/?api=1&destination=Fresno",
    appleDirectionsUrl: "https://maps.apple.com/?daddr=Fresno",
  }), {
    googleDirectionsUrl: "https://www.google.com/maps/dir/?api=1&destination=Fresno",
    directions: "https://www.google.com/maps/dir/?api=1&destination=Fresno",
    appleDirectionsUrl: "https://maps.apple.com/?daddr=Fresno",
    appleDirections: "https://maps.apple.com/?daddr=Fresno",
  });
});

test("review labels and logo reuse require matching source evidence", () => {
  assert.equal(reviewAttribution({ source: "gbp" }), "Google");
  assert.equal(reviewAttribution({ source: "site" }, { source: "gbp" }), "Business website");
  assert.equal(reviewAttribution({ source: "public" }), "");
  assert.equal(reviewAttribution({ source_url: "https://www.google.com/maps/place/Cedar+Stone" }), "Google");

  assert.equal(sourceBrandLogoUrl({ logo_source: { url: "media/brand.svg", origin: "upload", proposed: false } }), "media/brand.svg");
  assert.equal(sourceBrandLogoUrl({ logo_source: { remastered_path: "media/brand-clean.svg", origin: "site", proposed: false } }), "media/brand-clean.svg");
  assert.equal(sourceBrandLogoUrl({ logo_source: { url: "media/brand.svg", origin: "generated", proposed: false } }), null);
  assert.equal(sourceBrandLogoUrl({ logo_source: { url: "media/brand.svg", origin: "upload", proposed: true } }), null);
});

test("V8 renders source-backed metadata, honest reviews, static photo light, and one mobile rail", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-v8-focused-"));
  const mediaDir = path.join(outDir, "media");
  mkdirSync(mediaDir, { recursive: true });
  writeFileSync(path.join(mediaDir, "source-logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="#173f35"/><text x="24" y="74" fill="white" font-size="34">Cedar Stone</text></svg>');
  writeFileSync(path.join(mediaDir, "source-photo.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

  const packet = {
    slug: "cedar-stone-focused",
    public_url: "https://cedar-stone.vercel.app/showcase?draft=1",
    forge: { demo: true },
    build_type: "multi-page",
    business: { name: "Cedar Stone Landscaping", category: "landscaping", city: "Fresno", state: "CA" },
    services: ["Garden planning", "Irrigation repair", "Seasonal cleanup"],
    logo_source: { chosen_url: "media/source-logo.svg", origin: "upload", proposed: false },
    media: { catalog: [{ kind: "photo", url: "media/source-photo.png", source: "upload", label: "Completed garden", width: 1600, height: 1000, proof_eligible: true }] },
    launch: { purchase_url: "https://buy.woodwardsoftware.com/cedar-stone", agent_phone: "(949) 339-5562" },
    enrichment_sources: {
      phone: { value: "(559) 555-0147", source: "owner" },
      rating: { value: { value: 4.9, count: 28 }, source: "site" },
      reviews_attributed: {
        source: "mixed-public-sources",
        value: [
          { author: "Avery Stone", rating: 5, text: "Careful work and clear updates from the first visit.", source: "gbp" },
          { author: "Google review", rating: 5, text: "The garden looked thoughtful and tidy when the crew finished.", source: "site" },
        ],
      },
    },
  };

  try {
    await build(packet, { outDir, capture: false });
    const home = readFileSync(path.join(outDir, "index.html"), "utf8");
    const contact = readFileSync(path.join(outDir, "contact", "index.html"), "utf8");
    const og = readFileSync(path.join(mediaDir, "og.svg"), "utf8");

    assert.match(home, /<link rel="canonical" href="https:\/\/cedar-stone\.vercel\.app\/showcase\/">/);
    assert.match(home, /<meta property="og:url" content="https:\/\/cedar-stone\.vercel\.app\/showcase\/">/);
    assert.match(home, /<meta property="og:image" content="https:\/\/cedar-stone\.vercel\.app\/showcase\/media\/og\.png">/);
    assert.match(contact, /<link rel="canonical" href="https:\/\/cedar-stone\.vercel\.app\/showcase\/contact\/">/);
    assert.doesNotMatch(home, /<link rel="canonical" href="\//);
    assert.match(home, /<link rel="icon" href="media\/source-logo\.svg">/);
    assert.doesNotMatch(home, /rel="icon" href="data:/);
    assert.match(og, /source-logo\.svg/);
    assert.match(og, /source-photo\.png/);
    assert.doesNotMatch(og, /<path\b/);
    assert.equal(existsSync(path.join(mediaDir, "og.png")), false);

    assert.match(home, /data-media-treatment="source-photo-light-shader"/);
    assert.match(home, /data-motion-treatment="cinematic-light-shader"/);
    assert.match(home, /data-reduced-motion="static"/);
    assert.doesNotMatch(home, /@keyframes\s+[a-z-]*burns/i);
    assert.match(home, /data-review-source="google"/);
    assert.match(home, /data-review-source="business-site"/);
    assert.match(home, /Customer · <span class="src-chip">Business website<\/span>/);
    assert.doesNotMatch(home, /4\.9[^<]*on Google/);
    assert.match(home, /4\.9[^<]*public rating/);

    assert.match(home, /data-launch-rail(?:\s|>)/);
    assert.match(home, /class="launch-tile glass"[^>]*data-launch-chip/);
    assert.doesNotMatch(home, /data-collapsed/);
    assert.match(home, /<header class="top shell" data-sticky-cta data-conversion-rail>/);
    assert.doesNotMatch(home, /class="sticky-cta"/);
    assert.match(home, /body:has\(\[data-launch-chip\]\) \.pchat\{display:none\}/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
