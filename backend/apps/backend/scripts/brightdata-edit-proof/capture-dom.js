"use strict";
// scripts/brightdata-edit-proof/capture-dom.js
// Captures the LIVE RENDERED DOM of a wss-ai.com site with Playwright, after
// the SPA has hydrated. Used to take before/after snapshots around an edit job.
//
//   node scripts/brightdata-edit-proof/capture-dom.js <slug> <label>
//
// Writes <scratch>/dom-<label>.json and a full-page PNG next to it.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");

const OUT_DIR = process.env.PROOF_OUT_DIR
  || path.join(__dirname, "..", "..", "artifacts", "brightdata-edit-proof");

async function capture(slug, label) {
  const url = `https://${slug}.wss-ai.com/`;
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  // SPA: give React a beat past networkidle before reading text.
  await page.waitForTimeout(2500);

  const snap = await page.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
    const bodyText = document.body ? document.body.innerText.replace(/\s+/g, " ").trim() : "";
    // Every <style> block the site-editor could have injected into index.html.
    const inlineStyles = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent || "")
      .filter((s) => s.trim().length);
    return {
      title: document.title,
      h1: Array.from(document.querySelectorAll("h1")).map(txt),
      h2: Array.from(document.querySelectorAll("h2")).map(txt).slice(0, 12),
      bodyTextLength: bodyText.length,
      bodyTextHead: bodyText.slice(0, 400),
      // The specific things a BrightData trust lookup would write onto a page.
      ratingMentions: (bodyText.match(/\b[0-5]\.\d\s*(?:star|★|out of 5)/gi) || []).slice(0, 8),
      reviewCountMentions: (bodyText.match(/\b\d{1,5}\+?\s*(?:google\s+)?reviews?\b/gi) || []).slice(0, 8),
      hasFiveStarGlyphs: /★{3,}/.test(bodyText),
      inlineStyleCount: inlineStyles.length,
      inlineStyleChars: inlineStyles.join("").length,
      // Marker the edit job is asked to write, if the edit path ever runs.
      proofMarkerPresent: /BRIGHTDATA-TRUST-PROOF/i.test(document.documentElement.outerHTML),
      htmlLength: document.documentElement.outerHTML.length,
      bodyText,
    };
  });

  const png = path.join(OUT_DIR, `dom-${label}.png`);
  await page.screenshot({ path: png, fullPage: true });
  await browser.close();

  const record = {
    label,
    url,
    captured_at: new Date().toISOString(),
    http_status: resp ? resp.status() : null,
    console_errors: consoleErrors.slice(0, 5),
    screenshot: png,
    bodyTextSha256: crypto.createHash("sha256").update(snap.bodyText).digest("hex"),
    ...snap,
  };
  delete record.bodyText; // keep the JSON readable; the sha is the comparator
  const jsonPath = path.join(OUT_DIR, `dom-${label}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `bodytext-${label}.txt`), snap.bodyText);
  return { record, jsonPath };
}

if (require.main === module) {
  const slug = process.argv[2] || "wss-test-flint-plumbing-s5";
  const label = process.argv[3] || "before";
  capture(slug, label)
    .then(({ record, jsonPath }) => {
      console.log(JSON.stringify(record, null, 2));
      console.log(`\nwrote ${jsonPath}`);
    })
    .catch((e) => { console.error("CAPTURE FAILED:", e.message); process.exit(1); });
}

module.exports = { capture };
