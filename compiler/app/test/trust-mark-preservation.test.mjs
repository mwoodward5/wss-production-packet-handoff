import assert from "node:assert/strict";
import test from "node:test";
import { collectSourceIntake, sanitizeSourceAssets, sourceAssetIdentity } from "../lib/source-intake.mjs";
import { mergeRendererTrustMarks, rendererTrustMarks } from "../lib/engine-adapter.mjs";
import { preparePremierMedia } from "../../factory/lib/premier-media.mjs";
import { renderTrustMarkRail, trustedTrustMarksForPacket } from "../../factory/pipeline/05-build-v8.mjs";

const businessUrl = "https://firstrate-roofing.testsite.dev/";
const primaryLogo = "https://firstrate-roofing.testsite.dev/assets/first-rate-roofing-logo.png";
const trustMarkUrls = [
  "https://firstrate-roofing.testsite.dev/assets/rheem-authorized-partner.png",
  "https://firstrate-roofing.testsite.dev/assets/lochinvar-manufacturer-badge.webp",
  "https://firstrate-roofing.testsite.dev/assets/phcc-member-mark.svg",
  "https://firstrate-roofing.testsite.dev/assets/100-club-award.png",
];

test("source intake preserves official trust marks without promoting them to logo or gallery media", async () => {
  const originalFetch = globalThis.fetch;
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
  try {
    delete process.env.FIRECRAWL_API_KEY;
    globalThis.fetch = async (url) => {
      if (String(url).includes("pagehub-intake-lock-form")) {
        return new Response(JSON.stringify({ ok: false, error: "compiler unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url) === businessUrl) {
        return new Response(`<!doctype html><title>First Rate Roofing</title>
          <header><img class="brand-logo" src="/assets/first-rate-roofing-logo.png" alt="First Rate Roofing logo"></header>
          <main>
            <img src="/assets/first-rate-project.webp" alt="Completed roofing project">
            <section class="trust-partners" aria-label="Partners and certifications">
              <img class="partner-mark" src="/assets/rheem-authorized-partner.png" alt="Rheem authorized partner">
              <img class="manufacturer-badge" src="/assets/lochinvar-manufacturer-badge.webp" alt="Lochinvar manufacturer badge">
              <img class="membership-mark" src="/assets/phcc-member-mark.svg" alt="PHCC member">
              <img class="award-seal" src="/assets/100-club-award.png" alt="100 Club award">
              <img class="partner-mark" src="https://cdn.jobber.com/logo_jobber_powered-by.svg" alt="Powered by Jobber partner">
              <img class="certification-badge" src="/assets/private-certification.png?token=secret" alt="Private certification">
            </section>
          </main>
          <p>First Rate Roofing provides roof repair and replacement in Spokane.</p>`, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const intake = await collectSourceIntake({ sources: { website_url: businessUrl } }, {
      name: "First Rate Roofing",
      city: "Spokane",
      state: "WA",
      category: "roofing",
    });
    const logos = intake.assets.filter((asset) => asset.kind === "logo");
    const trustMarks = intake.assets.filter((asset) => asset.kind === "trust_mark");
    const photos = intake.assets.filter((asset) => asset.kind === "photo");

    assert.equal(logos.length, 1);
    assert.equal(logos[0].url, primaryLogo);
    assert.deepEqual(trustMarks.map((asset) => asset.url), trustMarkUrls);
    assert.equal(intake.summary.trust_marks_found, 4);
    assert.deepEqual(photos.map((asset) => asset.url), ["https://firstrate-roofing.testsite.dev/assets/first-rate-project.webp"]);
    assert.ok(trustMarks.every((asset) => asset.hero_eligible === false && asset.proof_eligible === false));
    assert.ok(trustMarks.every((asset) => asset.provenance.source_url === businessUrl));
    assert.ok(trustMarks.every((asset) => asset.provenance.source_host === "firstrate-roofing.testsite.dev"));
    assert.ok(trustMarks.every((asset) => asset.provenance.owner_key === "first-rate"));
    assert.equal(intake.assets.some((asset) => /jobber|token=secret/i.test(asset.url)), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  }
});

test("sanitized trust marks bridge to the renderer but never become Premier hero or gallery media", () => {
  const sourceMarks = trustMarkUrls.map((url, index) => ({
    kind: "trust_mark",
    url,
    label: `Trust mark ${index + 1}`,
    source: "business-site",
    origin: "business-evidence",
    approved: true,
    hero_eligible: false,
    proof_eligible: false,
    meta: { trust_mark_evidence: "explicit-site-trust-mark" },
    provenance: {
      source_url: businessUrl,
      source_host: "firstrate-roofing.testsite.dev",
      owner_key: "first-rate",
    },
  }));
  const sanitized = sanitizeSourceAssets([
    ...sourceMarks,
    {
      ...sourceMarks[0],
      url: "https://firstrate-roofing.testsite.dev/assets/private-certification.svg?token=secret",
    },
  ]);
  const bridged = rendererTrustMarks([
    ...sanitized,
    { kind: "photo", url: "https://firstrate-roofing.testsite.dev/assets/project.webp", approved: true },
  ]);

  assert.equal(bridged.length, 4);
  assert.ok(bridged.some((asset) => asset.url.endsWith(".svg")));
  assert.equal(preparePremierMedia({ assets: bridged }).length, 0);
});

test("PageHub cannot inject a foreign loose trust mark that is absent from the official page", async () => {
  const originalFetch = globalThis.fetch;
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
  const acmeUrl = "https://acme-roofing.example/";
  const officialBadge = "https://acme-roofing.example/assets/gaf-master-elite.svg";
  const foreignBadge = "https://tekline-roofing.example/assets/tekline-certified-badge.svg";
  try {
    delete process.env.FIRECRAWL_API_KEY;
    globalThis.fetch = async (url) => {
      if (String(url).includes("pagehub-intake-lock-form")) {
        return new Response(JSON.stringify({
          ok: true,
          extracted: {
            brandName: "Acme Roofing",
            domainUrl: acmeUrl,
            imageCandidates: [
              { url: officialBadge, alt: "GAF Master Elite certification", role: "certification badge" },
              { url: foreignBadge, alt: "Tekline certified partner badge", role: "certification badge" },
            ],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (String(url) === acmeUrl) {
        return new Response(`<!doctype html><title>Acme Roofing</title>
          <header><img class="site-logo" src="/assets/acme-logo.svg" alt="Acme Roofing"></header>
          <main><section class="certifications trust-rail">
            <img src="/assets/gaf-master-elite.svg" alt="GAF Master Elite certification">
          </section></main>`, { status: 200, headers: { "content-type": "text/html" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const intake = await collectSourceIntake({ sources: { website_url: acmeUrl } }, {
      name: "Acme Roofing", city: "Seattle", state: "WA", category: "roofing",
    });
    const trustUrls = intake.assets.filter((asset) => asset.kind === "trust_mark").map((asset) => asset.url);
    assert.deepEqual(trustUrls, [officialBadge]);
    assert.equal(intake.assets.some((asset) => asset.url === foreignBadge), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  }
});

test("brand logos and certified installation photos are never reclassified as trust marks", async () => {
  const originalFetch = globalThis.fetch;
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
  const preferredUrl = "https://preferred-roofing-partners.example/";
  const logoUrl = `${preferredUrl}assets/preferred-roofing-partners.svg`;
  const projectUrl = `${preferredUrl}assets/certified-gaf-installation.webp`;
  const badgeUrl = `${preferredUrl}assets/owens-corning-preferred-contractor.svg`;
  try {
    delete process.env.FIRECRAWL_API_KEY;
    globalThis.fetch = async (url) => {
      if (String(url).includes("pagehub-intake-lock-form")) {
        return new Response(JSON.stringify({ ok: false, error: "compiler unavailable" }), {
          status: 503, headers: { "content-type": "application/json" },
        });
      }
      if (String(url) === preferredUrl) {
        return new Response(`<!doctype html><title>Preferred Roofing Partners</title>
          <header class="site-brand">
            <img class="primary brand-logo" src="/assets/preferred-roofing-partners.svg" alt="Preferred Roofing Partners">
          </header>
          <main>
            <section class="project-gallery">
              <img class="project-photo" src="/assets/certified-gaf-installation.webp" alt="Certified GAF installation">
            </section>
            <aside class="preferred-contractors trust-rail">
              <img class="contractor-badge" src="/assets/owens-corning-preferred-contractor.svg" alt="Owens Corning preferred contractor">
            </aside>
          </main>`, { status: 200, headers: { "content-type": "text/html" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const intake = await collectSourceIntake({ sources: { website_url: preferredUrl } }, {
      name: "Preferred Roofing Partners", city: "Tacoma", state: "WA", category: "roofing",
    });
    assert.equal(intake.assets.find((asset) => asset.url === logoUrl)?.kind, "logo");
    assert.equal(intake.assets.find((asset) => asset.url === projectUrl)?.kind, "photo");
    assert.equal(intake.assets.find((asset) => asset.url === badgeUrl)?.kind, "trust_mark");
    assert.equal(intake.found.photos.some((url) => sourceAssetIdentity(url) === sourceAssetIdentity(logoUrl)), false);
    assert.equal(intake.assets.filter((asset) => sourceAssetIdentity(asset.url) === sourceAssetIdentity(logoUrl)).length, 1);
    assert.equal(intake.assets.filter((asset) => asset.kind === "trust_mark").some((asset) => asset.url === logoUrl || asset.url === projectUrl), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  }
});

test("renderer trust-mark merge preserves existing packet logo and photos", () => {
  const existing = [
    { kind: "logo", url: primaryLogo, approved: true, meta: { logo_evidence: "logo-markup" } },
    { kind: "photo", url: `${businessUrl}assets/project.webp`, approved: true },
  ];
  const trustMark = {
    kind: "trust_mark",
    url: trustMarkUrls[0],
    approved: true,
    meta: { trust_mark_evidence: "explicit-site-trust-mark" },
    provenance: { source_url: businessUrl, source_host: "firstrate-roofing.testsite.dev", owner_key: "first-rate" },
  };
  const merged = mergeRendererTrustMarks(existing, [trustMark]);

  assert.deepEqual(merged.slice(0, 2), existing);
  assert.equal(merged.length, 3);
  assert.equal(merged[2].kind, "trust_mark");
  assert.equal(merged[2].url, trustMark.url);
});

test("trust rail renders only marks owned by the packet's official source", () => {
  const official = trustMarkUrls.map((url, index) => ({
    kind: "trust_mark",
    url,
    label: ["Rheem authorized partner", "Lochinvar manufacturer badge", "PHCC member", "100 Club award"][index],
    approved: true,
    meta: { trust_mark_evidence: "explicit-site-trust-mark" },
    provenance: {
      source_url: businessUrl,
      source_host: "firstrate-roofing.testsite.dev",
      owner_key: "first-rate",
    },
  }));
  const foreign = {
    kind: "trust_mark",
    url: "https://foreign-roofer.com/assets/foreign-partner-badge.svg",
    label: "Foreign partner",
    approved: true,
    meta: { trust_mark_evidence: "explicit-site-trust-mark" },
    provenance: {
      source_url: "https://foreign-roofer.com/",
      source_host: "foreign-roofer.com",
      owner_key: "foreign",
    },
  };
  const packet = {
    business: { name: "First Rate Roofing", current_website: businessUrl },
    assets: [...official, foreign],
  };

  assert.equal(trustedTrustMarksForPacket(packet).length, 4);
  const html = renderTrustMarkRail(packet);
  assert.equal((html.match(/class="trust-mark"/g) || []).length, 4);
  for (const url of trustMarkUrls) assert.match(html, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /foreign-roofer|Foreign partner/);
  assert.doesNotMatch(html, /<script|<iframe/i);

  const [ownerUpload] = sanitizeSourceAssets([{
    kind: "trust_mark",
    url: "https://uploads.wss-ai.com/customer/owner-certified-seal.svg",
    label: "Owner supplied certification",
    source: "upload",
    origin: "upload",
    approved: true,
  }]);
  assert.equal(trustedTrustMarksForPacket({ business: packet.business, assets: [ownerUpload] }).length, 1);
});
