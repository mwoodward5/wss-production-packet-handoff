"use strict";
// scripts/verify-signal-report.cjs
// -----------------------------------------------------------------------------
// READ-ONLY verification of a live Signal / CallPrep report.
//
// callprep.wss-ai.com is a LIVE PRODUCT. This script only NAVIGATES and READS.
// It never posts, never edits, never touches the app's code.
//
// WHY IT EXISTS. The outreach email is about to give the report real estate and
// call it a gift. Everything it says about the report — the grade, the score,
// the competitive set, the expiry — therefore has to come from the page as it
// actually renders today, not from a JSON row written when the report was
// created and not from anybody's memory.
//
// It caught exactly that class of error on first run: the persisted row
// (callprep-report-result.json) carries competitor_data with ONE entry (the
// client themselves), while the rendered page lists eight. An email built from
// the row would have understated the gift; an email built from the page's own
// "#1 of 9" headline would have overstated it, because the page prints a
// 9-business headline above a list of 8. We record all three numbers and let the
// email cite only the one it can see.
//
// Output: artifacts/ramon-qa/signal-report-contents.json
// -----------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

const PLAYWRIGHT = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/apps/backend/node_modules/playwright";
const ART = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/artifacts/ramon-qa";
const OUT = path.join(ART, "signal-report-contents.json");

async function main() {
  const truth = JSON.parse(fs.readFileSync(path.join(ART, "ramon.truth.json"), "utf8"));
  const rep = truth.signalReport;
  if (!rep || !rep.report_url) throw new Error("no signalReport.report_url in ramon.truth.json");

  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const resp = await page.goto(rep.report_url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const total = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < total; y += 500) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(900);

  const read = await page.evaluate(() => {
    const text = document.body.innerText;
    const grab = (from, to) => {
      const i = text.indexOf(from);
      if (i < 0) return null;
      const j = to ? text.indexOf(to, i) : -1;
      return text.slice(i, j > i ? j : i + 1200);
    };
    const comp = grab("Local Competitive Landscape", "How Your Business Scores") || "";
    // Each rank row is: <medal or #n> \n <name> \n [YOU] \n <score>
    const rows = [];
    const lines = comp.split("\n").map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (!/^(🥇|🥈|🥉|#\d+)$/.test(lines[i])) continue;
      const name = lines[i + 1];
      const isYou = lines[i + 2] === "YOU";
      const score = Number(lines[i + (isYou ? 3 : 2)]);
      if (name && Number.isFinite(score)) rows.push({ rank: lines[i], name, score, isClient: isYou });
    }
    const gm = text.match(/\n(A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|F)\n(\d{1,3})\/100/);
    const rankLine = (text.match(/You rank #(\d+) of (\d+) businesses analyzed[^\n]*/) || [])[0] || null;
    const claimedTotal = Number((text.match(/of (\d+) businesses analyzed/) || [])[1]) || null;
    const cd = text.match(/THIS REPORT EXPIRES IN\s*\n\s*(\d+)\s*\n?\s*DAYS/);
    return {
      httpText: true,
      grade: gm ? gm[1] : null,
      score: gm ? Number(gm[2]) : null,
      rankLine,
      claimedTotal,
      competitorRows: rows,
      countdownDays: cd ? Number(cd[1]) : null,
      hasExpiryCountdown: text.includes("THIS REPORT EXPIRES IN"),
    };
  });

  const shot = path.join(ART, "signal-report-verify.png");
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();

  const createdAt = rep.createdAt ? new Date(rep.createdAt) : null;
  const expiresAt = createdAt ? new Date(createdAt.getTime() + 7 * 24 * 3600 * 1000) : null;
  const daysLeft = expiresAt ? Math.floor((expiresAt - Date.now()) / 86400000) : null;

  const rivals = read.competitorRows.filter((r) => !r.isClient);
  const doc = {
    verifiedAt: new Date().toISOString(),
    method: "headless Chromium navigation + innerText read of the live report page. Read-only.",
    report_url: rep.report_url,
    httpStatus: resp.status(),
    renderVerified: resp.status() === 200 && read.grade != null,
    grade: read.grade,
    score: read.score,
    clientRow: read.competitorRows.find((r) => r.isClient) || null,
    rivalsNamed: rivals,
    rivalCount: rivals.length,
    rowsRendered: read.competitorRows.length,
    headlineClaimsTotal: read.claimedTotal,
    rankLine: read.rankLine,
    countdownDays: read.countdownDays,
    hasExpiryCountdown: read.hasExpiryCountdown,
    createdAt: rep.createdAt || null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    daysLeft,
    stale: daysLeft == null ? true : daysLeft < 1,
    discrepancy:
      read.claimedTotal && read.claimedTotal !== read.competitorRows.length
        ? `The report's own headline says "${read.claimedTotal} businesses analyzed" but it renders ${read.competitorRows.length} rows. The email cites the ${rivals.length} rivals it can actually see by name and does not repeat the headline number.`
        : null,
    screenshot: shot,
  };

  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
  console.log(`HTTP ${doc.httpStatus}  grade=${doc.grade} score=${doc.score}`);
  console.log(`rows rendered=${doc.rowsRendered}  rivals named=${doc.rivalCount}  headline claims=${doc.headlineClaimsTotal}`);
  if (doc.discrepancy) console.log(`DISCREPANCY: ${doc.discrepancy}`);
  console.log(`expires ${doc.expiresAt} (${doc.daysLeft} days left)  stale=${doc.stale}`);
  console.log(`-> ${OUT}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
