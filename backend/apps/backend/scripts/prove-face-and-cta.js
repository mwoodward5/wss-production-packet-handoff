"use strict";
// scripts/prove-face-and-cta.js — "A REAL FACE, AND URGENT CTAs" proved on a
// rendered page at a 390 phone (and 1280 desktop), not claimed. Builds a mirror
// through inject() with a stand-in identity photograph, the sign-up floater and
// a phone, then MEASURES that at 390:
//   * the sticky Call · Text · Chat bar sits at the bottom
//   * the chat launcher AND the floater pill lift clear ABOVE it (no overlap)
//   * the "Ask Riley" expert label is visible and clear of the bar
//   * the face/crew band rendered its image, high on the page
//
//   node scripts/prove-face-and-cta.js
//
// The photograph is a stand-in SVG here (silhouettes + a van); in production the
// engine only ever passes an ownership-gated photo from the client's photo bank.

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };

const ROOT = path.join(__dirname, "..");
const OUTDIR = path.join(ROOT, "artifacts", "face-cta-proof");
const { inject } = require("../lib/mirror-engine/content-inject");

// A stand-in "crew + van" so the band renders a visible people-photo; the real
// one is an ownership-gated raster from the photo bank.
const PEOPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe0f5"/><stop offset="1" stop-color="#9db8dd"/></linearGradient></defs><rect width="640" height="480" fill="url(#s)"/><rect x="360" y="250" width="250" height="120" rx="14" fill="#20324a"/><rect x="380" y="270" width="80" height="60" rx="8" fill="#8fb0dd"/><circle cx="410" cy="380" r="26" fill="#12202f"/><circle cx="560" cy="380" r="26" fill="#12202f"/><g fill="#33465f"><circle cx="90" cy="150" r="42"/><rect x="48" y="200" width="84" height="150" rx="30"/><circle cx="200" cy="140" r="46"/><rect x="152" y="196" width="96" height="170" rx="32"/><circle cx="310" cy="150" r="42"/><rect x="268" y="200" width="84" height="150" rx="30"/></g></svg>`;

const FACTS = {
  business_name: "Ramon Roofing", industry: "roofing", city: "Fort Worth", state: "TX",
  address: "500 Main St", postal_code: "76102", phone: "+18175551212",
  place_id: "ChIJ-ramon", latitude: 32.7555, longitude: -97.3308,
  rating: 4.9, review_count: 212,
  // THE CONTACT-RAIL FLAGS (2026-09): the bar and the chat handoff are
  // feature-flagged per business, default OFF — the proof builds a PROMOTED
  // business so the bar exists to be measured, and sms_capable so Text Us
  // renders alongside Call.
  sms_capable: true,
  primary_cta: { label: "Book Online", href: "https://booking.example/ramon" },
  features: { sticky_cta: true, sms_cta: true, chat_handoff: true },
};
const CONTENT = {
  services: ["Roof Repair", "Roof Replacement", "Storm Damage", "Gutters"].map((name) => ({ name })),
  reviews: [
    { author: "Danielle P.", rating: 5, publishedAt: "2026-05-12", text: "Same-day repair after the hail. Crew was spotless and on time." },
    { author: "Marcus T.", rating: 5, publishedAt: "2026-04-30", text: "Fair price, no upsell, walked me through the whole roof." },
  ],
  areas: ["Fort Worth", "Arlington", "Keller"],
};

// Donor: a hero with a header logo and a primary in-page CTA (so we can prove
// the sticky bar covers neither), an empty #root, a static footer.
const DONOR = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ramon Roofing</title><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12212e;background:#fff}:root{--accent:6 58% 49%}header.bar{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;position:sticky;top:0;background:#0d2740;color:#fff;z-index:5}.hero{min-height:52vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;padding:2rem 1.2rem;background:linear-gradient(135deg,#0d2740,#1b4d7a);color:#fff}.hero h1{font-size:clamp(1.8rem,5vw,2.6rem);margin:0}.cta{display:inline-block;background:#c53f34;color:#fff;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px}</style></head><body>
<header class="bar"><strong>Ramon Roofing</strong><a class="cta" href="tel:+18175551212">Call now</a></header>
<section class="hero"><h1>Ramon Roofing</h1><p>Fort Worth's storm-damage roofers</p><a class="cta" data-cta="hero-quote" href="#quote">Get a free estimate</a></section>
<div id="root"></div>
<footer style="padding:3rem 1rem;background:#0a1219;color:#93a3b0;text-align:center">&copy; Ramon Roofing</footer>
<script src="./app.js"></script>
</body></html>`;

async function main() {
  fs.mkdirSync(path.join(OUTDIR, "assets"), { recursive: true });
  const result = inject({
    files: { "index.html": Buffer.from(DONOR), "app.js": Buffer.from("/* stub */") },
    content: CONTENT, facts: FACTS, phoneDigits: "8175551212", slug: "wss-test-ramon-facecta",
    logoUrl: "https://ramonroofing.example/logo.png", manifest: {},
    brand: { accent: "#c53f34" },
    signup: { clientId: "WSS-RAMON-8421", rileyTel: "tel:+19493395562", checkoutUrl: "https://wss-ai.com/c/ramon" },
    identityPhoto: { url: "/assets/wss-people.svg", subject: "team" },
  });
  const out = result.files;
  fs.writeFileSync(path.join(OUTDIR, "index.html"), out["index.html"].toString("utf8"));
  fs.writeFileSync(path.join(OUTDIR, "app.js"), "/* stub */");
  fs.writeFileSync(path.join(OUTDIR, "assets", "wss-people.svg"), PEOPLE_SVG);

  const rectOf = (a, b) => {
    if (!a || !b) return null;
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return x > 1 && y > 1 ? { x: Math.round(x), y: Math.round(y) } : null;
  };

  // Serve OUTDIR over http so absolute "/assets/…" paths resolve exactly as
  // they do on the deployed site (they do NOT under file://).
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
    const fp = path.join(OUTDIR, rel);
    if (!fp.startsWith(OUTDIR) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.statusCode = 404; return res.end("nf"); }
    res.setHeader("Content-Type", MIME[path.extname(fp)] || "application/octet-stream");
    res.end(fs.readFileSync(fp));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch();
  const measured = { report: { call_bar: result.report.call_bar, identity_band: result.report.identity_band }, render: {} };
  try {
    for (const [label, vp] of [["mobile-390", { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ["desktop-1280", { width: 1280, height: 900 }]]) {
      const page = await browser.newPage({ viewport: vp });
      await page.goto(`${base}/index.html`, { waitUntil: "load" });
      await page.waitForTimeout(2600); // hoist + reveal + widget measurement + cta animation
      await page.screenshot({ path: path.join(OUTDIR, `${label}.png`), fullPage: false });
      await page.screenshot({ path: path.join(OUTDIR, `${label}-full.png`), fullPage: true });

      const m = await page.evaluate(() => {
        const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: Math.round(r.width), h: Math.round(r.height), display: cs.display, visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 1 && r.height > 1 }; };
        const teamImg = document.querySelector("#wss-team img");
        return {
          vw: window.innerWidth, vh: window.innerHeight,
          bar: box("#wsscallbar"),
          launcher: box("#wss-chat-launcher"),
          cta: box("#wss-chat-cta"),
          pill: box("#wss-pill"),
          team: box("#wss-team"),
          heroCta: box('.hero [data-cta="hero-quote"]'),
          teamImgDecoded: !!(teamImg && teamImg.naturalWidth > 0),
          barButtons: [...document.querySelectorAll("#wsscallbar .wss-cb__btn")].map((b) => b.textContent.trim()),
          ctaText: (document.querySelector("#wss-chat-cta") || {}).textContent || null,
          handoff: box("#wss-chat-call"),
          handoffText: (document.querySelector("#wss-chat-call") || {}).textContent || null,
        };
      });
      // Overlap checks (only meaningful on mobile, where the bar shows).
      m.overlap = {
        bar_x_launcher: rectOf(m.bar, m.launcher),
        bar_x_pill: rectOf(m.bar, m.pill),
        bar_x_cta: rectOf(m.bar, m.cta),
        cta_x_pill: rectOf(m.cta, m.pill),
        bar_x_heroCta: rectOf(m.bar, m.heroCta),
        bar_x_handoff: rectOf(m.bar, m.handoff),
      };
      measured.render[label] = m;
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  fs.writeFileSync(path.join(OUTDIR, "measured.json"), JSON.stringify(measured, null, 1));
  console.log(JSON.stringify(measured, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
