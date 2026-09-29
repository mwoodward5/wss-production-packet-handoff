"use strict";
// scripts/render-riley-email-sample.cjs — render Riley's branded note shell to a
// file and photograph it at desktop and phone width. NOTHING IS SENT: this file
// has no recipient argument, no provider call, and no import of the send path in
// lib/email.js. It exists because "the shell renders" is not evidence about a
// design — the only evidence is the painted DOM at the width a person reads it.
//
//   node scripts/render-riley-email-sample.cjs
//
// THE ANSWER IS REALISTIC AND IT IS TRUE. Riley's edit EXECUTION is unproven as
// of 2026-07-31, so the sample answer below says she takes a change down, not
// that she ships it. The shell would happily render a boast; the sample must not
// model one, because this artifact is what the next person copies.
//
// THE ENVIRONMENT VALUES ARE PLACEHOLDERS, AND THEY ARE LABELLED. GHOST_AGENT_PHONE
// and GHOST_AGENCY_POSTAL_ADDRESS are not configured on this machine, and the
// shell's contract is that an unset value OMITS its line rather than inventing
// one — so a render with nothing set would photograph an empty signature and
// prove nothing about the element under test. The number below is in the 555-01xx
// range reserved for fiction and the address is a documentation address; neither
// is a real WSS line, and the audit JSON beside the artifact says so.

const fs = require("node:fs");
const path = require("node:path");

const { renderRileyEmail } = require("../lib/riley-email-shell");

const BACKEND = path.join(__dirname, "..");
const OUT_HTML = path.join(BACKEND, "artifacts", "riley-email-sample.html");
const OUT_DIR = path.join(BACKEND, "artifacts", "riley-email-shots");
const PLAYWRIGHT = path.join(BACKEND, "node_modules", "playwright");

// Placeholder configuration — see the header. Never a real line.
const RENDER_ENV = {
  GHOST_AGENT_PHONE: "(555) 013-8420",
  GHOST_AGENCY_POSTAL_ADDRESS: "27758 Santa Margarita Pkwy #445, Mission Viejo, CA 92691",
};

const SUBJECT = "A bit about me";

// What a caller actually asks for — "tell me a bit about yourself" — answered
// the way Riley answers it on the phone. Her voice: warm, plain, short
// sentences. Every claim in it is one this system can point at.
const ANSWER = `Happy to. I'm Riley — I'm the AI that WSS Labs put on your account, so I'm yours, not a chatbot sitting on your website talking to your customers.

Here's what that means day to day:

- I answer this line, so you get a person-shaped conversation instead of a ticket form.
- I can pull your business record up while we're talking — your site, your reviews, what we found when we looked you up.
- If you want something changed on your site, tell me and I'll take it down right here on the call. No emailing screenshots to anyone.
- And I can put a note like this one in your inbox before we hang up.

I should say plainly: I'm an AI, not a person. I'd rather you hear that from me now than work it out later. Mark Woodward is the human behind all of this, and he's a phone call away whenever you want him.

Anything else you want to know, just ask.`;

async function shoot(browser, { width, height, outFile, label }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: width < 500,
    hasTouch: width < 500,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`file://${OUT_HTML.replace(/\\/g, "/")}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(400);

  // The measurement that matters at 375px. The outreach shell shipped a
  // horizontal scroll once, from a single unbreakable sign-off line inside an
  // auto-layout table, and nobody saw it until it was on a phone.
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    documentHeight: document.documentElement.scrollHeight,
    images: [...document.images].map((img) => ({
      src: img.getAttribute("src"),
      alt: img.getAttribute("alt"),
      width: img.getAttribute("width"),
      height: img.getAttribute("height"),
    })),
  }));
  metrics.horizontalOverflow = metrics.scrollWidth > metrics.innerWidth;

  await page.screenshot({ path: outFile, fullPage: true });
  await ctx.close();
  const bytes = fs.statSync(outFile).size;
  console.log(`  ${label.padEnd(8)}: ${Math.round(bytes / 1024)}KB  ${metrics.scrollWidth}x${metrics.documentHeight}  overflow=${metrics.horizontalOverflow}  jsErrors=${errors.length}`);
  return { ok: true, file: outFile, bytes, viewport: { width, height }, metrics, pageErrors: errors };
}

async function main() {
  const rendered = renderRileyEmail({
    subject: SUBJECT,
    answer: ANSWER,
    recipientName: "Mark",
    context: "Sent by Riley during a live call with +1 (714) 555-0142.",
    env: RENDER_ENV,
  });

  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_HTML, rendered.html);
  fs.writeFileSync(path.join(OUT_DIR, "riley-email-sample.txt"), rendered.text);
  console.log(`html  -> ${OUT_HTML} (${rendered.html.length} bytes)`);
  console.log(`meta  -> ${JSON.stringify(rendered.meta)}`);

  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch();
  const shots = {};
  shots.desktop = await shoot(browser, { width: 1200, height: 900, outFile: path.join(OUT_DIR, "riley-email-desktop.png"), label: "desktop" });
  shots.mobile = await shoot(browser, { width: 375, height: 812, outFile: path.join(OUT_DIR, "riley-email-mobile.png"), label: "mobile" });
  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, "audit.json"), JSON.stringify({
    renderedAt: new Date().toISOString(),
    artifact: OUT_HTML,
    subject: rendered.subject,
    meta: rendered.meta,
    placeholderEnv: {
      note: "GHOST_AGENT_PHONE and GHOST_AGENCY_POSTAL_ADDRESS are unset on this machine. "
        + "These placeholders exist so the render exercises the configured path; neither is a real WSS line or address. "
        + "Unset values omit their line entirely — see test/riley-email-shell.test.js.",
      ...RENDER_ENV,
    },
    shots,
  }, null, 2));
  console.log(`audit -> ${path.join(OUT_DIR, "audit.json")}`);
}

if (require.main === module) {
  main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
}

module.exports = { ANSWER, SUBJECT, RENDER_ENV };
