"use strict";
// scripts/send-5-sample-outreach.cjs — sends 5 SAMPLE outreach emails to the
// OWNER'S OWN INBOX ONLY so he can see/feel the real thing before any batch
// goes to a prospect. Hard-coded single recipient; no prospect is ever
// reachable from this script.
//
// Ramon = fully verified (ramon.truth.json, gate-passed for truth-law).
// The other four = real attested facts from the saved ship-results.json, but
// NOT yet run through the truth.json / enrichment / gate-4A pipeline, so each
// carries a visible DRAFT — UNVERIFIED banner at the very top, per instruction.

// VISUALS: the email now SHOWS the site instead of only describing it. Hero
// screenshots captured by scripts/capture-email-shots.cjs are attached with a
// content_id and referenced as cid: — so Gmail renders them inline with no
// remote fetch and no "display images?" prompt. Every image is a real,
// unretouched photograph of a real URL; if a capture is missing, the panel is
// omitted rather than substituted.

const fs = require("node:fs");
const path = require("node:path");

const SHOT_DIR = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/artifacts/ramon-qa/email-shots";

const ENV = "C:/Users/Main/Documents/New project 2/.fable-proof.env";
for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const OWNER_EMAIL = "woodwardsoftware@gmail.com";
const FROM = process.env.GHOST_AGENCY_RESEND_FROM || "Woodward Software <hello@wss-ai.com>";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function stars(rating) {
  if (rating == null) return "";
  const full = Math.round(rating);
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function pill(text) {
  return `<span style="display:inline-block;background:#f2f2ee;color:#33332c;border-radius:999px;padding:5px 12px;font:600 12px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;margin:3px 4px 3px 0">${esc(text)}</span>`;
}

function draftBanner() {
  return `<div style="background:#fff4d6;border:1px solid #e6c66b;border-radius:8px;padding:10px 14px;margin-bottom:18px;font:700 12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#7a5a00;letter-spacing:.04em;text-transform:uppercase">
    ⚠ DRAFT — UNVERIFIED SAMPLE. Facts shown are real (attested ratings/reviews) but this business has not yet been run through the full truth-sheet + gate pipeline. Do not send to this prospect until it has.
  </div>`;
}

// ---------------------------------------------------------------------------
// Screenshot loading. Returns { attachments: [...], cids: {...}, capturedAt }
// where cids only contains an entry for a shot that actually exists on disk.
// ---------------------------------------------------------------------------
function loadShots(key) {
  const manifestPath = path.join(SHOT_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) return { attachments: [], cids: {}, capturedAt: null };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const rec = manifest.shots && manifest.shots[key];
  if (!rec) return { attachments: [], cids: {}, capturedAt: null };

  const attachments = [];
  const cids = {};
  const files = {};
  const want = [
    { field: "desktop", cid: "heroDesktop", file: `${rec.slug}-desktop.jpg`, name: "your-new-site-desktop.jpg" },
    { field: "mobile", cid: "heroMobile", file: `${rec.slug}-mobile.jpg`, name: "your-new-site-mobile.jpg" },
    { field: "current", cid: "siteCurrent", file: `${rec.slug}-current.jpg`, name: "your-site-today.jpg" },
    { field: "currentMobile", cid: "siteCurrentMobile", file: `${rec.slug}-current-mobile.jpg`, name: "your-site-today-on-a-phone.jpg" },
  ];
  for (const w of want) {
    const shot = rec[w.field];
    if (!shot || !shot.ok) continue;                 // failed capture -> panel omitted, never faked
    const abs = path.join(SHOT_DIR, w.file);
    if (!fs.existsSync(abs)) continue;
    attachments.push({
      filename: w.name,
      content: fs.readFileSync(abs).toString("base64"),
      content_type: "image/jpeg",
      content_id: w.cid,
    });
    cids[w.field] = w.cid;
    files[w.cid] = w.file;
  }
  const metrics = {
    mobile: (rec.mobile && rec.mobile.metrics) || null,
    currentMobile: (rec.currentMobile && rec.currentMobile.metrics) || null,
  };
  return { attachments, cids, files, metrics, capturedAt: manifest.capturedAt, liveUrl: rec.liveUrl, currentUrl: rec.currentUrl };
}

// ---------------------------------------------------------------------------
// The one honest line, or nothing.
//
// Everything below is a MEASUREMENT taken in a real browser at 390px on both
// pages, with a gate that only lets the claim through when it is unambiguously
// true. There is deliberately no fallback: when nothing qualifies, this returns
// null and the email says nothing about their site at all. It never scores
// them, never calls their site old/cluttered/ugly, and never reaches for a
// softer adjective when the hard number does not support it.
//
// PROVEN SILENT: on Ramon Roofing all three gates decline — their current phone
// site does not overflow, does declare a viewport, and has a BETTER small-tap-
// target ratio than our mirror (8/72 vs 9/33). So no line is rendered. That is
// the correct outcome, not a bug.
// ---------------------------------------------------------------------------
function honestMobileObservation(metrics) {
  const before = metrics && metrics.currentMobile;
  const after = metrics && metrics.mobile;
  if (!before || !after) return null;

  // 1. Sideways scrolling. Stated only when THEIRS overflows and OURS does not.
  if (before.horizontalOverflow && !after.horizontalOverflow) {
    return `Measured in a browser at a 390px phone width: your current page lays out ${before.scrollWidth}px wide, so a phone has to be scrolled sideways to read it. The new page measures exactly ${after.scrollWidth}px.`;
  }

  // 2. No mobile viewport declared — checkable in one line of their own HTML.
  if (!before.viewportMeta && after.viewportMeta) {
    return `Measured in a browser at a 390px phone width: your current page doesn't declare a mobile viewport, so phones lay it out at desktop width and shrink it to fit.`;
  }

  // 3. Tap-target size. Requires a meaningful sample on BOTH pages, a genuinely
  //    high rate on theirs, and at least a 2x gap — otherwise it is noise
  //    dressed up as a finding.
  const bTot = before.tapTargetsVisible || 0;
  const aTot = after.tapTargetsVisible || 0;
  if (bTot >= 15 && aTot >= 15) {
    const bRate = before.tapTargetsUnder24px / bTot;
    const aRate = after.tapTargetsUnder24px / aTot;
    if (bRate >= 0.25 && bRate >= aRate * 2) {
      return `Measured in a browser at a 390px phone width: ${before.tapTargetsUnder24px} of the ${bTot} tappable items on your current page render smaller than 24px across. On the new page it's ${after.tapTargetsUnder24px} of ${aTot}.`;
    }
  }

  return null; // nothing measurable qualifies -> say nothing
}

/**
 * MOBILE BEFORE / AFTER — the strip the owner asked for.
 *
 * Rendered only when BOTH phone captures succeeded. A failed load of their site
 * omits the whole strip rather than presenting a blank/error page as "your site".
 * Both images are the same viewport, same capture height, same quality, shown at
 * the same pixel size in the same row — no crop, no zoom, no highlight on one.
 */
function mobileBeforeAfterStrip({ business, url, currentUrl, cids, capturedAt, metrics }) {
  if (!cids.currentMobile || !cids.mobile) return "";
  const W = 236, H = 511;                 // 390x844 aspect, identical for both
  const stamp = capturedAt ? esc(shotDate(capturedAt)) : "";
  const observation = honestMobileObservation(metrics);

  // RESPONSIVE, BUT STILL IDENTICAL. The width/height attributes stay for
  // Outlook (which ignores CSS sizing on images), while the inline style lets
  // the pair shrink together on a narrow screen. Both cells get the SAME
  // percentage width and the SAME max-width, so the fairness invariant — same
  // viewport, same aspect, no crop, neither one favoured — survives the resize.
  // Fixed 236px cells were overflowing a 390px screen by 160px, which is
  // exactly the sin the strip is there to point out.
  const phone = (label, cid, alt, href, caption) => `
    <td width="48%" valign="top" style="padding:0;width:48%">
      <div style="font:700 10px/1.3 sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#8a8a80;margin-bottom:8px;height:26px">${esc(label)}</div>
      ${href ? `<a href="${esc(href)}" style="display:block;text-decoration:none">` : ""}
      <img src="cid:${cid}" width="${W}" height="${H}" alt="${esc(alt)}"
           style="display:block;width:100%;max-width:${W}px;height:auto;border-radius:14px;border:1px solid #e0e0da;background:#fff" />
      ${href ? "</a>" : ""}
      <div style="font:400 11px/1.5 sans-serif;color:#9a9a92;margin-top:7px;word-break:break-all">${esc(caption)}</div>
    </td>`;

  const beforeHost = currentUrl ? currentUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  const afterHost = url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return `<tr><td style="padding:26px 28px 6px">
    <div style="border-top:1px solid #ececE7;padding-top:22px">
      <div style="font:700 11px/1 sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#14140f">On a phone, side by side</div>
      <p style="font:400 13px/1.6 sans-serif;color:#6a6a60;margin:9px 0 16px">
        Most people who look you up are holding a phone. Both shots below were taken
        the same way at the same moment${stamp ? ` (${stamp})` : ""} — same phone-sized screen, same wait for
        the page to finish loading, nothing closed, nothing blocked, neither one scrolled or cropped.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:${W * 2 + 24}px;table-layout:fixed">
        <tr>
          ${phone("Your site on a phone today", cids.currentMobile, `Screenshot of the current ${business} website as it renders on a phone-sized screen`, currentUrl, beforeHost)}
          <td width="4%" style="width:4%">&nbsp;</td>
          ${phone("The one we built", cids.mobile, `Screenshot of the new ${business} website as it renders on a phone-sized screen`, url, afterHost)}
        </tr>
      </table>
      ${observation ? `<p style="font:400 12px/1.6 sans-serif;color:#6a6a60;margin:16px 0 0;padding:11px 13px;background:#f7f7f4;border-radius:8px">${esc(observation)}</p>` : ""}
    </div>
  </td></tr>`;
}

function shotDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Big desktop hero + phone shot. The whole thing is a link to the live site. */
function visualBlock({ business, url, accent, cids, capturedAt }) {
  if (!cids.desktop && !cids.mobile) return "";
  const stamp = capturedAt ? `Screenshot of the live page, taken ${esc(shotDate(capturedAt))}.` : "Screenshot of the live page.";

  const desktop = cids.desktop
    ? `<a href="${esc(url)}" style="display:block;text-decoration:none">
         <img src="cid:${cids.desktop}" width="544" height="408" alt="Screenshot of the new ${esc(business)} website on a desktop browser — click to open the live site"
              style="display:block;width:544px;max-width:100%;height:auto;border-radius:12px;border:1px solid #e0e0da" />
       </a>
       <div style="font:400 12px/1.5 sans-serif;color:#8a8a80;margin-top:8px">${stamp} Tap the image to open the real thing.</div>`
    : "";

  const mobile = cids.mobile
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:20px">
         <tr>
           <td width="170" valign="top" style="padding-right:18px">
             <a href="${esc(url)}" style="display:block;text-decoration:none">
               <img src="cid:${cids.mobile}" width="170" height="368" alt="The same ${esc(business)} website shown on a phone screen"
                    style="display:block;width:170px;height:368px;border-radius:14px;border:1px solid #e0e0da" />
             </a>
           </td>
           <td valign="top">
             <div style="font:700 11px/1 sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${accent}">And on a phone</div>
             <p style="font:400 14px/1.65 sans-serif;color:#4a4a44;margin:10px 0 0">
               Same page, same speed, on the screen most of your callers are actually holding.
               Your phone number is a one-tap call button and the quote form is thumb-sized —
               nothing is shrunk down from the desktop layout.
             </p>
           </td>
         </tr>
       </table>`
    : "";

  return `<tr><td style="padding:4px 28px 8px">${desktop}${mobile}</td></tr>`;
}

/**
 * Honest before/after. Only rendered when a real capture of the client's CURRENT
 * site succeeded. Labels state plainly which is which; no scoring, no adjectives,
 * no invented "performance" numbers attached to either one.
 */
function beforeAfterStrip({ business, url, currentUrl, cids, capturedAt }) {
  if (!cids.current || !cids.desktop) return "";
  const stamp = capturedAt ? esc(shotDate(capturedAt)) : "";
  const cell = (label, sub, cid, alt, href) => `
    <td width="262" valign="top" style="padding:0">
      <div style="font:700 10px/1 sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8a8a80;margin-bottom:7px">${esc(label)}</div>
      ${href ? `<a href="${esc(href)}" style="display:block;text-decoration:none">` : ""}
      <img src="cid:${cid}" width="262" height="197" alt="${esc(alt)}"
           style="display:block;width:262px;height:197px;border-radius:8px;border:1px solid #e0e0da" />
      ${href ? "</a>" : ""}
      <div style="font:400 11px/1.5 sans-serif;color:#9a9a92;margin-top:6px">${esc(sub)}</div>
    </td>`;

  return `<tr><td style="padding:24px 28px 6px">
    <div style="border-top:1px solid #ececE7;padding-top:20px">
      <div style="font:700 11px/1 sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#14140f">Side by side</div>
      <p style="font:400 13px/1.6 sans-serif;color:#6a6a60;margin:8px 0 14px">
        Both shots were taken the same way on the same day${stamp ? ` (${stamp})` : ""} — a plain desktop browser, nothing staged.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          ${cell("Your site today", currentUrl ? currentUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "", cids.current, `Screenshot of the current ${business} website as it looks today`, currentUrl)}
          <td width="20">&nbsp;</td>
          ${cell("The one we built", url.replace(/^https?:\/\//, "").replace(/\/$/, ""), cids.desktop, `Screenshot of the new ${business} website we built`, url)}
        </tr>
      </table>
    </div>
  </td></tr>`;
}

function emailHtml({ draft, business, city, state, accent, url, phone, rating, reviewCount, trustPills, betterList, servicesCount, certLine, cids = {}, capturedAt = null, currentUrl = null, metrics = null }) {
  const ratingBlock = rating != null
    ? `<div style="margin-top:4px"><span style="color:${accent};font-size:20px;letter-spacing:2px">${stars(rating)}</span> <strong style="font-size:16px">${rating}</strong> <span style="color:#6a6a60">across ${reviewCount} Google reviews</span></div>`
    : `<div style="margin-top:4px;color:#6a6a60;font-size:13px">No third-party review count is attested for this business yet — none is shown or implied.</div>`;

  return `<!doctype html><html><body style="margin:0;background:#f7f7f4;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
${draft ? `<div style="max-width:600px;margin:0 auto 0">${draftBanner()}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e6e3">
  <tr><td style="background:#14140f;padding:24px 28px">
    <div style="font:700 13px/1 sans-serif;color:#f5f5f4;letter-spacing:.18em">WSS LABS</div>
    <div style="font:400 12px/1.4 sans-serif;color:#9a9a92;margin-top:6px">Your new website is already built</div>
  </td></tr>
  <tr><td style="padding:30px 28px 10px">
    <div style="font:400 15px/1.6;color:#33332c">Hi — quick note about ${esc(business)}.</div>
    <h1 style="font:700 24px/1.3 sans-serif;color:#14140f;margin:14px 0 6px">
      We built ${esc(business)} a brand-new site.<br/>It's already live.
    </h1>
    <p style="font:400 15px/1.65;color:#4a4a44;margin:10px 0 0">
      No signup, no commitment yet — we mirrored your real business information,
      your logo colors, and your actual reviews into a modern, mobile-first site
      so you can see exactly what it would look like before you decide anything.
      ${cids.desktop || cids.mobile ? "Here it is — you don't have to click anything to look at it:" : ""}
    </p>
  </td></tr>
  ${visualBlock({ business, url, accent, cids, capturedAt })}
  <tr><td style="padding:18px 28px 18px">
    <a href="${esc(url)}" style="display:block;text-align:center;background:${accent};color:#fff;font:700 15px/1 sans-serif;text-decoration:none;padding:16px;border-radius:10px;letter-spacing:.02em">
      See your live site →
    </a>
    <div style="text-align:center;margin-top:8px;font:400 12px/1.4 sans-serif;color:#8a8a80">${esc(url.replace(/^https?:\/\//, ""))}</div>
  </td></tr>
  ${mobileBeforeAfterStrip({ business, url, currentUrl, cids, capturedAt, metrics })}
  ${beforeAfterStrip({ business, url, currentUrl, cids, capturedAt })}
  <tr><td style="padding:6px 28px 4px">
    <div style="border-top:1px solid #ececE7;padding-top:20px">
      <div style="font:700 11px/1 sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${accent}">What we pulled straight from your business</div>
      ${ratingBlock}
      <div style="margin-top:10px">${trustPills}</div>
      <div style="margin-top:10px;font:400 13px/1.5 sans-serif;color:#6a6a60">${esc(certLine)}${servicesCount ? ` · ${servicesCount} of your real services shown, exactly as you list them` : ""}</div>
    </div>
  </td></tr>
  <tr><td style="padding:20px 28px 6px">
    <div style="font:700 11px/1 sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#14140f">What's better than the site you have now</div>
    <ul style="margin:10px 0 0;padding-left:20px;font:400 14px/1.7 sans-serif;color:#33332c">
      ${betterList.map((b) => `<li>${esc(b)}</li>`).join("\n      ")}
    </ul>
  </td></tr>
  <tr><td style="padding:22px 28px 8px">
    <a href="https://ghost.wss-ai.com/claim?slug=${encodeURIComponent(url.match(/https?:\/\/([^.]+)/)[1])}" style="display:inline-block;background:#14140f;color:#fff;font:700 14px/1 sans-serif;text-decoration:none;padding:13px 22px;border-radius:8px">
      Claim this site for ${esc(business)}
    </a>
    <div style="font:400 13px/1.6 sans-serif;color:#6a6a60;margin-top:10px">
      Have a question first? Call ${esc(phone)} and ask for the team — or, once you're set up,
      your customers can talk to <strong>Riley</strong>, a phone assistant that answers with your
      real hours, services and service area, 24/7.
    </div>
  </td></tr>
  <tr><td style="padding:20px 28px 26px;border-top:1px solid #ececE7;margin-top:10px">
    <div style="font:400 11px/1.6 sans-serif;color:#9a9a92">
      Every number on this site — reviews, service list, certifications — comes directly from
      your own public listings. Nothing here is invented or estimated.
    </div>
  </td></tr>
</table>
</body></html>`;
}

const SAMPLES = [
  {
    key: "ramon", draft: false,
    subject: "Ramon Roofing — your new site is live (real reviews, real certs, zero guesswork)",
    business: "Ramon Roofing", city: "Fort Worth", state: "TX",
    accent: "#C53F34", phone: "(817) 924-1645",
    url: "https://wss-test-ramon-roofing-fort-worth.wss-ai.com/",
    rating: 4.9, reviewCount: 85, servicesCount: 14,
    certLine: "8 real certifications shown — NSA, MRCA, NTRCA, TRI, RCAT, CTRCA, BBB, GAF Authorized Roofer",
    trustPills: [pill("4.9 ★ · 85 reviews (Google, attested)"), pill("Since 1995 · founded by Paul Ramon"), pill("Fort Worth · Dallas · Austin · Leander"), pill("14 verified services"), pill("8 real certifications")].join(""),
    betterList: [
      "Every review, certification and service on the page is pulled from your own live site — nothing invented.",
      "Shows your real 4.9★ / 85-review track record up front, where a shopper actually sees it.",
      "Loads in well under a second on mobile, where most of your callers are searching from.",
      "Riley (phone assistant) is staged and ready to test — he only states what's verified about your business, and takes a message rather than guessing.",
      "Google Maps card on the site shows your real address, rating and directions — not a placeholder.",
    ],
  },
  {
    key: "lyons", draft: true,
    subject: "[SAMPLE] Lyons Roofing — Tucson mirror preview (draft, unverified)",
    business: "Lyons Roofing", city: "Tucson", state: "AZ",
    accent: "#c82f33", phone: "(520) 900-1442",
    url: "https://wss-test-lyons-roofing-tucson.wss-ai.com/",
    rating: 4.6, reviewCount: 152, servicesCount: null,
    certLine: "License ROC# 348074 shown as published",
    trustPills: [pill("4.6 ★ · 152 reviews (Google, attested)"), pill("Tucson, AZ"), pill("ROC# 348074")].join(""),
    betterList: [
      "Real 4.6★ / 152-review track record shown where it counts, above the fold.",
      "Mobile-first, click-to-call layout — most roofing searches happen on a phone.",
      "License number displayed exactly as the state licensing board shows it.",
      "NOTE: services and certifications for this business have not yet been individually verified against their own site — this sample is for internal review only.",
    ],
  },
  {
    key: "musiccity", draft: true,
    subject: "[SAMPLE] Music City Roofers — Nashville mirror preview (draft, unverified)",
    business: "Music City Roofers", city: "Nashville", state: "TN",
    accent: "#253b5e", phone: "(615) 802-4999",
    url: "https://wss-test-music-city-roofers-nashville.wss-ai.com/",
    rating: 4.7, reviewCount: 874, servicesCount: null,
    certLine: "No certification list has been individually verified for this business yet",
    trustPills: [pill("4.7 ★ · 874 reviews (Google, attested)"), pill("Nashville, TN")].join(""),
    betterList: [
      "874 real reviews at 4.7★ — one of the strongest review counts in this sample batch — shown prominently.",
      "Their own logo color carried through as the site accent automatically.",
      "NOTE: no certification or detailed service list has been verified yet — those sections would stay minimal until confirmed against their own site.",
    ],
  },
  {
    key: "kingdom", draft: true,
    subject: "[SAMPLE] Kingdom Plumbing — Las Vegas mirror preview (draft, unverified)",
    business: "Kingdom Plumbing", city: "Las Vegas", state: "NV",
    accent: "#e05909", phone: "(702) 213-6112",
    url: "https://wss-test-kingdom-plumbing-las-vegas.wss-ai.com/",
    rating: null, reviewCount: null, servicesCount: null,
    certLine: "NV Contractors License #0085422 shown as published",
    trustPills: [pill("NV Contractors License #0085422"), pill("Las Vegas, NV")].join(""),
    betterList: [
      "IMPORTANT: no third-party rating or review count is attested for this business — none is shown, invented, or estimated. Their own site claims 4.9/595, but nothing independent corroborates it, so the mirror deliberately ships without a star rating rather than assert one.",
      "License number displayed exactly as published.",
      "This is the deliberate 'ships honest, not flashy' case in the sample batch — worth seeing before the others.",
    ],
  },
  {
    key: "enco", draft: true,
    subject: "[SAMPLE] ENCO Plumbing — The Colony mirror preview (draft, unverified)",
    business: "ENCO Plumbing, Inc.", city: "The Colony", state: "TX",
    accent: "#003eac", phone: "(214) 222-4464",
    url: "https://wss-test-enco-plumbing-the-colony.wss-ai.com/",
    rating: 4.9, reviewCount: 403, servicesCount: null,
    certLine: "RMP#35843 shown as published",
    trustPills: [pill("4.9 ★ · 403 reviews (Google, attested)"), pill("The Colony, TX"), pill("RMP#35843")].join(""),
    betterList: [
      "4.9★ / 403 reviews shown up front — matches Ramon's rating tier, strong proof point.",
      "Real license number (RMP#35843) displayed.",
      "NOTE: detailed service/certification list not yet individually verified for this business.",
    ],
  },
];

async function main() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");

  // --only=<key> sends a single sample (used to prove the format without
  // pushing five copies at the owner). --dry-run renders and sizes without sending.
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
  const dryRun = process.argv.includes("--dry-run");
  const queue = only ? SAMPLES.filter((s) => s.key === only) : SAMPLES;
  if (!queue.length) throw new Error(`no sample matched --only=${only}`);

  const results = [];
  for (const s of queue) {
    const shots = loadShots(s.key);
    const html = emailHtml({ ...s, cids: shots.cids, capturedAt: shots.capturedAt, currentUrl: shots.currentUrl, metrics: shots.metrics });

    // Say out loud whether the honest-observation gate fired, so a silent strip
    // is never mistaken for a broken one.
    if (shots.cids.currentMobile && shots.cids.mobile) {
      const obs = honestMobileObservation(shots.metrics);
      console.log(`  mobile before/after: RENDERED. observation=${obs ? JSON.stringify(obs) : "none — no measurement qualified, so nothing is claimed"}`);
      const ov = shots.metrics && shots.metrics.currentMobile && shots.metrics.currentMobile.consentOverlayPctOfViewport;
      if (ov > 10) console.log(`  ** their "before" shot includes a consent overlay covering ${ov}% of the screen (not dismissed, per fairness rule).`);
    } else {
      console.log(`  mobile before/after: OMITTED (a phone capture is missing — never substituted).`);
    }

    const payload = { from: FROM, to: [OWNER_EMAIL], subject: s.subject, html };
    if (shots.attachments.length) payload.attachments = shots.attachments;

    const htmlKB = Buffer.byteLength(html, "utf8") / 1024;
    const attKB = shots.attachments.reduce((n, a) => n + Buffer.byteLength(a.content, "utf8"), 0) / 1024;
    const totalKB = Buffer.byteLength(JSON.stringify(payload), "utf8") / 1024;

    console.log(`[${s.key}] html=${htmlKB.toFixed(1)}KB  attachments=${shots.attachments.length} (${attKB.toFixed(1)}KB base64)  total=${totalKB.toFixed(1)}KB`);
    if (htmlKB > 100) console.warn(`  !! HTML is ${htmlKB.toFixed(1)}KB — Gmail clips around 102KB. Trim the markup.`);
    if (!shots.attachments.length) console.warn(`  !! no screenshots found for ${s.key} — run capture-email-shots.cjs first; sending text-only.`);

    if (dryRun) {
      const out = `${SHOT_DIR}/preview-${s.key}.html`;
      const localised = html.replace(/cid:([A-Za-z]+)/g, (m, c) => shots.files[c] || m);
      fs.writeFileSync(out, localised);
      console.log(`  dry-run: preview written -> ${out}`);
      results.push({ key: s.key, id: "(dry-run)", attachments: shots.attachments.length, totalKB });
      continue;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`resend ${res.status} for ${s.key}: ${JSON.stringify(body).slice(0, 300)}`);
    results.push({ key: s.key, draft: s.draft, subject: s.subject, id: body.id, attachments: shots.attachments.length, totalKB });
    console.log(`SENT [${s.draft ? "DRAFT" : "VERIFIED"}] ${s.key} -> id=${body.id}  attachments=${shots.attachments.length}  total=${totalKB.toFixed(1)}KB`);
  }
  console.log("");
  console.log(`${results.length} sample email(s) sent to ${OWNER_EMAIL} only. Zero prospects contacted.`);
}

// Exported so send-final-outreach.cjs can reuse the PROVEN blocks (shot loading,
// the measured mobile before/after strip, the honest-observation gate) instead of
// forking a second copy of them. Running this file directly still sends.
module.exports = {
  loadShots, mobileBeforeAfterStrip, beforeAfterStrip, visualBlock,
  honestMobileObservation, draftBanner, pill, stars, shotDate, esc,
  SAMPLES, SHOT_DIR, OWNER_EMAIL, FROM,
};

if (require.main === module) {
  main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
}
