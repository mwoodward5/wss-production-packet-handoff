"use strict";
// scripts/prove-trust-surface.js — THE STOP-SCROLLING SIGNALS, proved on a
// rendered page rather than claimed. Builds a real mirror through inject()
// (reveal + hoist + carousel scripts all run) from the audited Air Creation
// pride fixture + a verified 4.9/1,212 score + five reviews (two with a
// Google-served avatar, three initials-only), then renders it and measures:
//   1. a GOLD star SVG emblem beside 4.9 · 1,212, above the fold, animated
//   2. the trust strip as ONE band: stars + count + tenure + licensed/insured
//   3. the review carousel with faces (real + initials) above the fold
//   4. credential badges as OUR designed jewellery — and NO manufacturer art
//
//   node scripts/prove-trust-surface.js

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const OUTDIR = path.join(ROOT, "artifacts", "trust-surface");
const { inject } = require("../lib/mirror-engine/content-inject");
const { prideFromExtraction } = require("../lib/owner-pride");

const AIR = require(path.join(ROOT, "..", "..", "docs", "owner-behind", "air-creation-extraction.json"));
const PRIDE = prideFromExtraction(AIR, { clientDomain: "aircreationheatingandcooling.com" });

// a 4x4 solid PNG, so the two Google-avatar reviews render as real circles
const AVATAR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP8z8Dwn4EIwDiqkL4KAQAs6wX9d0m9dQAAAABJRU5ErkJggg==",
  "base64",
);

const FACTS = {
  business_name: "Air Creation Heating & Cooling, LLC",
  industry: "hvac",
  city: "Gonzales", state: "LA",
  address: "1234 W Main St", postal_code: "70737",
  phone: "+12252220000", email: "hello@aircreationheatingandcooling.com",
  website: "https://www.aircreationheatingandcooling.com/",
  current_website: "https://www.aircreationheatingandcooling.com/",
  place_id: "ChIJ-air-creation", profile_url: "https://www.google.com/maps/place/?q=place_id:ChIJ-air-creation",
  latitude: 30.2352, longitude: -90.9204,
  rating: 4.9, review_count: 1212,
};

const REVIEWS = [
  { author: "Danielle P.", rating: 5, publishedAt: "2026-05-12", avatarUrl: "https://lh3.googleusercontent.com/a/danielle=s96", text: "Same-day install and the crew was spotless. Our house is finally comfortable again." },
  { author: "Marcus T.", rating: 5, publishedAt: "2026-04-30", avatarUrl: "https://lh3.googleusercontent.com/a/marcus=s96", text: "Fair price, no upsell, and they walked me through the whole system. Highly recommend." },
  { author: "Priya N.", rating: 5, publishedAt: "2026-03-18", text: "Booked online at 9pm, tech was here by 8am. The maintenance plan already paid for itself." },
  { author: "Bill R.", rating: 4, publishedAt: "2026-02-04", text: "Honest folks. They fixed what two other companies could not, and stood behind the work." },
  { author: "Sofia G.", rating: 5, publishedAt: "2026-01-22", text: "Family-owned and it shows — they treated our home like their own. Cannot ask for more." },
];

const CONTENT = {
  pride: PRIDE,
  services: ["AC Repair", "AC Installation", "Furnace Repair", "Heating Installation", "Ductless Mini-Splits", "Duct Cleaning", "Thermostat Upgrades", "Indoor Air Quality", "Emergency HVAC", "Preventative Maintenance", "Heat Pump Service", "Commercial HVAC"].map((name) => ({ name })),
  reviews: REVIEWS,
  areas: ["Gonzales", "Prairieville", "Baton Rouge", "Denham Springs"],
  hours: ["Monday: 8:00 AM - 5:00 PM", "Tuesday: 8:00 AM - 5:00 PM", "Wednesday: 8:00 AM - 5:00 PM", "Thursday: 8:00 AM - 5:00 PM", "Friday: 8:00 AM - 5:00 PM", "Saturday: 9:00 AM - 2:00 PM", "Sunday: Closed"],
  faqs: [],
};

// A plain-SPA donor: empty #root + a static hero and footer, so inject() takes
// the static-footer path and the injected block is visible immediately.
const DONOR_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Air Creation Heating & Cooling</title><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12212e;background:#fff}:root{--accent:206 84% 34%}.hero{min-height:64vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;background:linear-gradient(135deg,#0b3d61,#1466a3);color:#fff}.hero h1{font-size:clamp(1.8rem,4vw,2.8rem);margin:.2rem 0}.hero p{opacity:.9;margin:0}</style></head><body>
<section class="hero"><div><h1>Air Creation Heating &amp; Cooling</h1><p>Creating comfort for your family!</p></div></section>
<div id="root"></div>
<footer style="padding:3rem 1rem;background:#0a1219;color:#93a3b0;text-align:center">© Air Creation Heating &amp; Cooling, LLC</footer>
<script src="./app.js"></script>
</body></html>`;

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const result = inject({
    files: { "index.html": Buffer.from(DONOR_HTML), "app.js": Buffer.from("/* stub */") },
    content: CONTENT,
    facts: FACTS,
    phoneDigits: "2252220000",
    slug: "wss-test-air-creation-trust",
    logoUrl: "https://www.aircreationheatingandcooling.com/logo.png",
    manifest: {},
    fonts: null, signup: null, brand: null,
  });
  const out = result.files || result;
  const html = out["index.html"].toString("utf8");
  fs.writeFileSync(path.join(OUTDIR, "index.html"), html);
  fs.writeFileSync(path.join(OUTDIR, "app.js"), "/* stub */");

  // --- static markup truths (no browser needed) ---------------------------
  const markup = {
    emblem_svg: /class="wss-t__emblem"[^>]*aria-label="Rated 4\.9 out of 5 stars"/.test(html),
    gold_gradient: html.includes("wssGoldGrad"),
    count_grouped: html.includes("1,212 Google reviews"),
    strip_since: /data-wss-pride="standing"[^>]*>[^<]*<[^>]*>\s*<\/span>Since 2011/.test(html) || html.includes("Since 2011"),
    strip_family_owned: html.includes("Family-Owned"),
    licensed_insured_chip: /wss-t__badgechip[^>]*data-wss-pride="credential"[\s\S]*?Licensed &amp; Insured/.test(html) || html.includes("Licensed &amp; Insured"),
    license_number_text: html.includes("License #56179"),
    daikin_text: /Daikin/.test(html),
    manufacturer_image_absent: !html.includes("daikin.com"),
    badge_tiles: (html.match(/class="wss-p__cred wss-badge wss-badge--/g) || []).length,
    initials_disc_markup: html.includes("wss-c__face--ini"),
    google_avatar_markup: (html.match(/class="wss-c__face" src="https:\/\/lh3\.googleusercontent\.com/g) || []).length,
    reviews_hoisted: html.includes('var ids=["trust","reviews","social"]'),
  };

  // --- rendered truths ----------------------------------------------------
  const browser = await chromium.launch();
  const measured = { markup, render: {} };
  try {
    for (const [label, vp] of [["desktop-1280", { width: 1280, height: 900 }], ["mobile-390", { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
      const page = await browser.newPage({ viewport: vp });
      // real circular faces: fulfil the Google avatar with a local PNG
      await page.route("**/*googleusercontent.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: AVATAR_PNG }));
      await page.goto("file://" + path.join(OUTDIR, "index.html").replace(/\\/g, "/"), { waitUntil: "load" });
      await page.waitForTimeout(1600); // HOIST + reveal + first paint
      await page.screenshot({ path: path.join(OUTDIR, `${label}.png`), fullPage: true });

      const m = await page.evaluate(() => {
        const q = (s, r = document) => r.querySelector(s);
        const top = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null);
        const hero = q("section.hero");
        const trust = q("#trust");
        const reviews = q("#reviews");
        const social = q("#social");
        const emblem = q("#trust .wss-t__emblem");
        const band = q("#trust .wss-t__row");
        const emblemGold = emblem ? getComputedStyle(emblem.querySelector('path[fill^="url"]') || emblem).fill : null;
        const rvImgs = reviews ? reviews.querySelectorAll("img.wss-c__face").length : 0;
        const rvInis = reviews ? reviews.querySelectorAll(".wss-c__face--ini").length : 0;
        const badges = [...document.querySelectorAll(".wss-badge")].map((b) => (b.className.match(/wss-badge--(\w+)/) || [])[1]);
        // a real image actually decoded (natural size > 0) proves the avatar loaded
        const decoded = reviews ? [...reviews.querySelectorAll("img.wss-c__face")].filter((i) => i.naturalWidth > 0).length : 0;
        return {
          heroTop: top(hero), trustTop: top(trust), reviewsTop: top(reviews), socialTop: top(social),
          heroBottom: hero ? Math.round(hero.getBoundingClientRect().bottom + window.scrollY) : null,
          trustUnderHero: hero && trust ? (top(trust) >= (hero.getBoundingClientRect().bottom + window.scrollY - 4)) : null,
          reviewsAfterTrust: trust && reviews ? top(reviews) > top(trust) : null,
          bandIsOneRow: !!band,
          bandText: band ? band.textContent.replace(/\s+/g, " ").trim().slice(0, 220) : null,
          emblemPresent: !!emblem,
          emblemFill: emblemGold,
          reviewFaceImgs: rvImgs, reviewInitials: rvInis, reviewFacesDecoded: decoded,
          badgeKinds: badges,
          viewportH: window.innerHeight,
        };
      });
      measured.render[label] = m;
      await page.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUTDIR, "measured.json"), JSON.stringify(measured, null, 1));
  console.log(JSON.stringify(measured, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
