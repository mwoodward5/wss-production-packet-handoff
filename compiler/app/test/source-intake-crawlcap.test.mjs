import assert from "node:assert/strict";
import test from "node:test";

import { collectSourceIntake } from "../lib/source-intake.mjs";

// Crawl-cap regression coverage (wave3, 2026-09-16): MR A/C of Orlando
// recorded 30 navigation_pages but only 3 sources / pages_read: 3 because
// mapLikelyPages keyword-filtered the crawl set and sliced it to 4. These
// tests pin the uncapped behavior: every same-domain content page is fetched,
// bounded by INTAKE_MAX_SCRAPE_URLS (default 40) and a total byte budget.

const WEBSITE = "https://acme-hvac.example";
const FACTS = { name: "Acme HVAC", city: "Orlando", state: "FL", category: "hvac" };

function pageFor(url, { markdownBytes = 0 } = {}) {
  const label = String(url).replace(`${WEBSITE}/`, "").replace(/\/$/, "") || "home";
  const base = `Acme HVAC serves Orlando with verified HVAC work. Page: ${label}.\n`;
  const markdown = markdownBytes > 0
    ? base.slice(0, 1) + base.slice(1).padEnd(markdownBytes - 1, "x")
    : base;
  return {
    markdown,
    links: [],
    images: [],
    branding: {},
    rawHtml: "",
    metadata: { title: `Acme HVAC — ${label}`, description: `Orlando HVAC page ${label}` },
  };
}

function firecrawlMock({ links, scrapeDelayMs = 0, markdownBytes = 0 } = {}) {
  const scrapedUrls = [];
  let activeScrapes = 0;
  let maxActiveScrapes = 0;
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/map")) {
      return Response.json({ success: true, links });
    }
    if (target.endsWith("/search")) {
      return Response.json({ success: true, data: { web: [] } });
    }
    if (target.endsWith("/scrape")) {
      const requested = JSON.parse(options.body).url;
      scrapedUrls.push(requested);
      activeScrapes += 1;
      maxActiveScrapes = Math.max(maxActiveScrapes, activeScrapes);
      if (scrapeDelayMs) await new Promise((resolve) => setTimeout(resolve, scrapeDelayMs));
      activeScrapes -= 1;
      return Response.json({ success: true, data: pageFor(requested, { markdownBytes }) });
    }
    throw new Error(`Unexpected offline request: ${target}`);
  };
  return { fetchImpl, scrapedUrls: () => scrapedUrls, maxActiveScrapes: () => maxActiveScrapes };
}

async function intakeWith(mock, sources = { website_url: WEBSITE }) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = "offline-test-key";
  globalThis.fetch = mock.fetchImpl;
  try {
    return await collectSourceIntake({ sources }, FACTS);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
  }
}

const MR_AC_STYLE_NAV = [
  `${WEBSITE}/`,
  `${WEBSITE}/about`,
  `${WEBSITE}/contact`,
  `${WEBSITE}/services`,
  `${WEBSITE}/faq`,
  `${WEBSITE}/financing`,
  `${WEBSITE}/rebates`,
  `${WEBSITE}/coupons-promotions`,
  `${WEBSITE}/indoor-air-quality`,
  ...Array.from({ length: 21 }, (_, index) => `${WEBSITE}/orlando-hvac-guide-${String(index + 1).padStart(2, "0")}`),
];

test("thirty navigation pages are all fetched, bounded by forty, in bounded batches", async () => {
  const mock = firecrawlMock({ links: MR_AC_STYLE_NAV, scrapeDelayMs: 5 });
  const result = await intakeWith(mock);

  // 30 map links, but the bare "/" entry is the supplied root — deduped, not re-fetched.
  assert.equal(mock.scrapedUrls().length, 30);
  assert.equal(mock.scrapedUrls()[0], WEBSITE);
  assert.ok(!mock.scrapedUrls().includes(`${WEBSITE}/`), "root map twin must not be re-fetched");
  assert.equal(result.summary.pages_read, 30);
  assert.equal(result.navigation_pages.length, 30);

  // Long-form money pages all qualify — no keyword whitelist survived.
  for (const money of ["/financing", "/rebates", "/coupons-promotions", "/indoor-air-quality", "/orlando-hvac-guide-07"]) {
    assert.ok(
      result.sources.some((url) => url === `${WEBSITE}${money}`),
      `${money} must be a read source`,
    );
  }

  // Children after the root are in canonical sorted order.
  const children = result.sources.slice(1);
  assert.deepEqual(children, [...children].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));

  // Bounded batches: concurrent, but never more than the default 6 in flight.
  assert.ok(mock.maxActiveScrapes() >= 2, "pages must still be scraped concurrently");
  assert.ok(mock.maxActiveScrapes() <= 6, "scrape batches must be bounded by INTAKE_SCRAPE_CONCURRENCY default 6");
});

test("crawl selection keeps only same-domain content pages", async () => {
  const mock = firecrawlMock({ links: [
    `${WEBSITE}/about`,
    "https://external-directory.example/about",
    "tel:+14075550100",
    "mailto:info@acme-hvac.example",
    `${WEBSITE}/images/logo.png`,
    `${WEBSITE}/styles.css`,
    `${WEBSITE}/app.js`,
    `${WEBSITE}/docs/brochure.pdf`,
    `${WEBSITE}/financing`,
  ] });
  const result = await intakeWith(mock);

  assert.deepEqual(mock.scrapedUrls(), [WEBSITE, `${WEBSITE}/about`, `${WEBSITE}/financing`]);
  const navUrls = result.navigation_pages.map((page) => page.url);
  assert.equal(navUrls.length, 3);
  for (const excluded of ["external-directory.example", "tel:", "mailto:", ".png", ".css", ".js", ".pdf"]) {
    assert.ok(
      !navUrls.some((url) => url.includes(excluded)),
      `${excluded} must be excluded from the crawl set`,
    );
  }
});

test("same discovered set yields identical discovery bytes regardless of map order and timing", async () => {
  const links = MR_AC_STYLE_NAV.slice(0, 13);
  const fingerprint = (result) => JSON.stringify({
    sources: result.sources,
    navigation_pages: result.navigation_pages,
    pages_read: result.summary.pages_read,
    copy: result.found.copy,
    services: result.found.services,
  });

  const first = await intakeWith(firecrawlMock({ links, scrapeDelayMs: 3 }));
  const shuffled = [...links];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const second = await intakeWith(firecrawlMock({ links: shuffled, scrapeDelayMs: 7 }));

  assert.equal(fingerprint(first), fingerprint(second));
  assert.equal(first.summary.pages_read, 13);
});

test("INTAKE_MAX_SCRAPE_URLS env override bounds the crawl deterministically", async () => {
  const original = process.env.INTAKE_MAX_SCRAPE_URLS;
  try {
    process.env.INTAKE_MAX_SCRAPE_URLS = "3";
    const { collectSourceIntake: cappedIntake } = await import("../lib/source-intake.mjs?cap=3");
    const links = Array.from({ length: 10 }, (_, index) => `${WEBSITE}/guide-${index}`);
    const mock = firecrawlMock({ links });
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = "offline-test-key";
    globalThis.fetch = mock.fetchImpl;
    try {
      const result = await cappedIntake({ sources: { website_url: WEBSITE } }, FACTS);
      // The env dial bounds the TOTAL scrape set (roots included).
      assert.equal(mock.scrapedUrls().length, 3);
      assert.equal(result.summary.pages_read, 3);
      // The kept children are the alphabetically first ones — a deterministic subset.
      assert.deepEqual(
        result.sources.slice(1).map((url) => url.replace(`${WEBSITE}/guide-`, "")),
        ["0", "1"],
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = originalKey;
    }
  } finally {
    if (original === undefined) delete process.env.INTAKE_MAX_SCRAPE_URLS;
    else process.env.INTAKE_MAX_SCRAPE_URLS = original;
  }
});

test("INTAKE_MAX_SCRAPE_BYTES budget stops the crawl and records a note", async () => {
  const original = process.env.INTAKE_MAX_SCRAPE_BYTES;
  try {
    // Every mock page is exactly 200 markdown bytes; a 500-byte budget is
    // spent by the first six-page batch (6 x 200 = 1200 >= 500), so the
    // remaining pages are skipped after the batch completes.
    process.env.INTAKE_MAX_SCRAPE_BYTES = "500";
    const { collectSourceIntake: budgetedIntake } = await import("../lib/source-intake.mjs?budget=500");
    const links = Array.from({ length: 20 }, (_, index) => `${WEBSITE}/guide-${index}`);
    const mock = firecrawlMock({ links, markdownBytes: 200 });
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = "offline-test-key";
    globalThis.fetch = mock.fetchImpl;
    try {
      const result = await budgetedIntake({ sources: { website_url: WEBSITE } }, FACTS);
      assert.equal(mock.scrapedUrls().length, 6);
      assert.equal(result.summary.pages_read, 6);
      assert.ok(
        result.summary.notes.some((note) => note.includes("scrape byte budget reached")),
        "budget note must be recorded",
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = originalKey;
    }
  } finally {
    if (original === undefined) delete process.env.INTAKE_MAX_SCRAPE_BYTES;
    else process.env.INTAKE_MAX_SCRAPE_BYTES = original;
  }
});
