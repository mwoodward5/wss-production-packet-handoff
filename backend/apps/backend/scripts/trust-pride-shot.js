"use strict";
/**
 * scripts/trust-pride-shot.js — is the trust pack ON the page, and the pride
 * block with it, and can you SEE them?
 *
 * Both have been reported present before on the strength of a build report. A
 * build report says what was assembled, not what a visitor gets: reviewer faces
 * were in eight stored contracts and rendered on none of them. So this reads
 * the hydrated DOM for each element and then SCROLLS THE SECTION INTO VIEW AND
 * PHOTOGRAPHS IT, because the screenshot is the deliverable and a count is not.
 *
 *   node scripts/trust-pride-shot.js <url> [--tag name]
 */

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const URL = process.argv[2];
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const TAG = arg("tag", "trust");
const OUTDIR = path.join(__dirname, "..", "artifacts", "trust-pride", TAG);
if (!URL) { console.error("usage: node scripts/trust-pride-shot.js <url> [--tag name]"); process.exit(2); }

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const browser = await chromium.launch();
  const results = {};

  for (const width of [1280, 390]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      userAgent: width === 390
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
    });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4200);

    const found = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const q = (s) => document.querySelectorAll(s);
      const schema = [...q('script[type="application/ld+json"]')].map((s) => s.textContent || "").join(" ");

      // The reviewer faces: only IMAGES INSIDE the review cards count. A stock
      // photo elsewhere on the page is not a reviewer.
      let faces = 0;
      for (const img of q("img")) {
        const src = String(img.getAttribute("src") || "");
        if (/googleusercontent|ggpht/.test(src) && img.clientWidth > 12) faces++;
      }

      // THE SMALLEST SECTION THAT CONTAINS IT, not the first. The first match
      // walking the document is almost always a wrapper that starts at y=0, so
      // "found the trust rail" produced a photograph of the hero.
      const findSection = (re) => {
        let best = null;
        for (const el of q("section, div[id], footer")) {
          if (!re.test(el.innerText || "")) continue;
          const r = el.getBoundingClientRect();
          if (r.height < 80 || r.height > 4000) continue;
          if (!best || r.height < best.h) best = { y: Math.round(r.top + window.scrollY), h: Math.round(r.height) };
        }
        return best;
      };

      return {
        starRating: /\b[45]\.\d\b/.test(text),
        reviewCount: /\b\d{2,4}\s+(reviews?|google reviews?)/i.test(text),
        appleMaps: [...q("a[href]")].some((a) => /maps\.apple\.com/.test(a.href)),
        writeReview: [...q("a[href]")].some((a) => /search\.google\.com\/local\/writereview|writereview/.test(a.href)),
        quotes: [...q("blockquote, [class*=review]")].length,
        aggregateRating: /AggregateRating/.test(schema),
        reviewSchema: /"@type"\s*:\s*"Review"/.test(schema),
        faces,
        // Pride: the shapes lib/owner-pride.js can produce.
        familyOwned: /family[- ]owned/i.test(text),
        sinceYear: /\bsince\s+(19|20)\d{2}\b/i.test(text),
        licence: /licen[cs]e\s*#?\s*[a-z0-9-]+/i.test(text),
        plans: /\$\d+(\.\d{2})?\s*(\/|per )\s*(mo|month|system)/i.test(text),
        trustSection: findSection(/review|rating|stars/i),
        prideSection: findSection(/family[- ]owned|licen[cs]e|since \d{4}/i),
        pageChars: text.length,
      };
    });

    results[width] = found;

    for (const [name, sec] of [["trust", found.trustSection], ["pride", found.prideSection]]) {
      if (!sec) continue;
      // WALK DOWN THE PAGE, DO NOT JUMP TO IT.
      //
      // The first version did `window.scrollTo(0, y)` and photographed a blank
      // white rectangle — for a section the DOM probe had just confirmed was
      // there, with its text, at that exact offset. These donors reveal their
      // sections with IntersectionObserver, and a single jump lands past every
      // observer between here and there, so the target arrives still at
      // opacity 0. Proof that read the DOM and proof that took the picture
      // disagreed, and the picture was right about what a visitor sees.
      const target = Math.max(0, sec.y - 60);
      for (let y = 0; y < target; y += 600) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(120);
      }
      await page.evaluate((v) => window.scrollTo(0, v), target);
      await page.waitForTimeout(1800);

      // And say whether the thing is actually PAINTED, so a blank shot fails
      // here instead of being handed over as evidence.
      const visible = await page.evaluate(() => {
        let painted = 0;
        for (const el of document.querySelectorAll("h1,h2,h3,p,li,span,dd,dt")) {
          const r = el.getBoundingClientRect();
          if (r.top < 0 || r.top > window.innerHeight || r.height < 6) continue;
          const s = getComputedStyle(el);
          if (Number(s.opacity) < 0.1 || s.visibility === "hidden") continue;
          if ((el.textContent || "").trim().length > 2) painted++;
        }
        return painted;
      });
      if (!results[`${name}Painted`]) results[`${name}Painted`] = {};
      results[`${name}Painted`][width] = visible;
      fs.writeFileSync(path.join(OUTDIR, `${name}-${width}.png`), await page.screenshot());
    }
    await ctx.close();
  }
  await browser.close();

  console.log(URL);
  for (const width of [1280, 390]) {
    const f = results[width];
    console.log(`\n-- ${width}px  (${f.pageChars} chars of visible text)`);
    for (const [k, v] of Object.entries(f)) {
      if (k === "pageChars" || k.endsWith("Section")) continue;
      console.log(`   ${k.padEnd(18)} ${v === true ? "YES" : v === false ? "no" : v}`);
    }
    console.log(`   trust section     ${f.trustSection ? `y=${f.trustSection.y} h=${f.trustSection.h} -> shot` : "NOT FOUND"}`);
    console.log(`   pride section     ${f.prideSection ? `y=${f.prideSection.y} h=${f.prideSection.h} -> shot` : "NOT FOUND"}`);
  }
  fs.writeFileSync(path.join(OUTDIR, "measured.json"), JSON.stringify({ url: URL, results }, null, 1));
  console.log(`\nshots in ${OUTDIR}`);
})().catch((e) => { console.error(e); process.exit(1); });
