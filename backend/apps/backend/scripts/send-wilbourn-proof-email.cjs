"use strict";
// scripts/send-flint-proof-email.cjs — the Flint Plumbing before/after proof email.
//
// ONE recipient, the owner's own inbox, hardcoded. No prospect address can be
// reached from this file: there is no --to flag, no list, no loop over a batch.
//
// EVERY CLIENT FACT IN THIS EMAIL COMES FROM verified-facts.json AND NOWHERE
// ELSE. The rating prints because the cross-check resolved it from two
// non-subject, non-Genie observers; the certifications line does not print at
// all, because no observer ever produced one. An absent fact is an absent line,
// never a softened one.
//
// The load-time figure is MEASURED against the live site at build time, not
// asserted. If the measurement fails, the line is dropped rather than guessed.
//
// THE SUBJECT IS HELD TO THE SAME BAR AS THE BODY. It is built by
// lib/proof-email-subject.js from the same measurement. It once shipped a
// hardcoded "0 errors" — a blanket claim about a whole site off one console
// check on one page — which is deleted, not softened. No measurement means no
// performance claim in the subject at all.
//
// Images are the PUBLIC wss-proof-assets URLs written by capture-proof-shots.js.
// Every one is fetched and checked here before it can be referenced, because the
// historical failure of this exact email was a 42-byte spacer served as a
// healthy 200 — an invisible pixel that looked like a delivered screenshot.
//
// FLAGS
//   --dry-run        render, write the client-dir artifacts, send nothing
//   --out=<file>     render to <file> (+ <file>-audit.json) for a human to open.
//                    Sends nothing and leaves the client dir's proof-email.html /
//                    proof-email-audit.json alone — those are the record of what
//                    actually went on the wire, not a scratch buffer.

const fs = require("node:fs");
const path = require("node:path");

const ENV = "C:/Users/Main/Documents/New project 2/.fable-proof.env";
function loadEnv() {
  for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const {
  resolveRileyLine,
  CLIENT_RILEY_PHONE_FIELDS,
  NON_RILEY_PHONE_FIELDS,
} = require("../lib/riley-line");
const { buildProofEmailSubject, measuredLoadLabel, unsupportedPerfClaim } = require("../lib/proof-email-subject");
const { marketCity, addressCity } = require("../lib/mirror-engine/facts");
const { measureAccent, guardedFetch, sniffImage } = require("../lib/mirror-engine/brand-assets");

// THE LOOK COMES FROM THE BRAND SYSTEM (2026-07-31). This email used to carry a
// palette invented in this file — #f4f3ee paper, #86d0c4 teal, #12201c ink —
// none of it from packages/wss-brand-system, and a type scale that ran almost
// everything between 12.5px and 15px. The owner's verdict was that it read like
// a PDF report rather than a product email, and both of those are why.
const design = require("../lib/wss-email-design");

const { FONT_STACK, FONT_MONO } = design;
// 2026-08-01 owner directive: the email wears the BRAND KIT, not the light PDF
// surface — Void canvas, Carbon cards, Ice text, kit hairlines. The measured
// client accent still colours actions; only the ground changed. TYPE strings
// from the design lib embed light ink hexes, so they are remapped here rather
// than forked — one source of truth, one dark projection of it.
const PALETTE = Object.freeze({ ...design.PALETTE,
  page: "#08080B", panel: "#131318", ink: "#F2F2F5", muted: "#9B9AA4",
  line: "#26252E", shelf: "#050508", subtle: "#1B1A22",
});
const TYPE = Object.freeze(Object.fromEntries(Object.entries(design.TYPE).map(
  ([k, v]) => [k, String(v).split("#16151B").join("#F2F2F5").split("#5F5E68").join("#9B9AA4")],
)));
const cardStyleDark = (o={}) => "background:#131318;border:1px solid "+(o.line||"#26252E")+";border-radius:"+(o.radius||16)+"px";

// ---------------------------------------------------------------- constants
const OWNER_EMAIL = "woodwardsoftware@gmail.com"; // the ONLY permitted recipient
// Resolved lazily: the secrets file is loaded by loadEnv() inside main(), so
// reading process.env at module scope would capture the value from BEFORE the
// load and silently send from the wrong address.
function sender() {
  const from = process.env.GHOST_AGENCY_RESEND_FROM || "Woodward Software <hello@wss-ai.com>";
  return { from, replyTo: (/<([^>]+)>/.exec(from) || [null, from])[1] };
}

const SITE = "https://wss-test-wilbourn-and-mccabe-plumbing.wss-ai.com/";
const CURRENT = "https://wilbournmccabeplumbing.com/";
const BUSINESS = "Wilbourn & McCabe Plumbing";
const LOGO = "https://wss-ai.com/assets/apple-touch-icon.png";
const FACTS = path.join(__dirname, "../artifacts/clients/wss-test-wilbourn-and-mccabe-plumbing/verified-facts.json");
const STAMP = path.join(__dirname, "../artifacts/clients/wss-test-wilbourn-and-mccabe-plumbing/client.stamp.json");

// Rendered-DOM evidence. Written by scripts/flint-dom-proof.cjs (both sites) and
// scripts/flint-feature-proof.cjs (this mirror's surfaces). Every feature status
// below is DERIVED from these files. A QC "PASS" string is not admissible here:
// if a surface is not in the rendered DOM, its chip says so.
const DOM_PROOF = path.join(__dirname, "../artifacts/wilbourn-dom-proof.json");
const FEATURE_PROOF = path.join(__dirname, "../artifacts/wilbourn-feature-proof.json");

const BUCKET = "https://lmniyuftrboqsgrwpwta.supabase.co/storage/v1/object/public/wss-proof-assets/preview-shots";
const SHOTS = {
  desktopOld: `${BUCKET}/old/f9b903842882c0c6b935577d30c92f34f41bfa182a979320614125a77fa5835d.jpg`,
  desktopNew: `${BUCKET}/new/ace0ac1ac4ea6ca97121b15a50f3ae8f34d54856d78943c82f3fdde736da3c82.jpg`,
  mobileOld: `${BUCKET}/old-mobile/65fbcd28d879a3265e6fa7204d3e1515998667abcbb9f7646be6ed16789af47c.jpg`,
  mobileNew: `${BUCKET}/new-mobile/abad4731a574c1dff54ed824bba03061bd1dde8bf5f2a4c9bd6695d007bd8b40.jpg`,
};

// The client's own logo, on the built mirror. The accent is MEASURED off these
// bytes at send time (same code path the build uses), so the email is coloured
// by the client's mark rather than by a hex somebody liked. Unmeasurable falls
// back to the WSS brand accent — never to an invented hue.
const CLIENT_LOGO = "https://wss-test-wilbourn-and-mccabe-plumbing.wss-ai.com/assets/client-logo.png";
const DEFAULT_ACCENT = design.clientAccent("");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ------------------------------------------------------------- verification
/** A referenced image must exist, be a real JPEG/PNG, and not be the spacer. */
async function assertRealImage(name, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf[0] === 0x89 && buf[1] === 0x50;
  if (!jpeg && !png) throw new Error(`${name}: not a JPEG/PNG (${buf.length} bytes)`);
  if (buf.length < 4096) throw new Error(`${name}: only ${buf.length} bytes — spacer/placeholder, refusing to send`);
  return { name, url, bytes: buf.length, kb: +(buf.length / 1024).toFixed(1), type: jpeg ? "jpeg" : "png" };
}

/** Measure the real load time of the built site. No number, no claim. */
async function measureLoadMs(url, runs = 5) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { return null; }
  const b = await chromium.launch({ headless: true });
  const samples = [];
  try {
    for (let i = 0; i < runs; i++) {
      const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } }); // fresh = cold cache
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: "load", timeout: 60000 });
      const t = await p.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return n ? n.loadEventEnd : null;
      });
      if (Number.isFinite(t) && t > 0) samples.push(t);
      await ctx.close();
    }
  } finally { await b.close().catch(() => {}); }
  if (!samples.length) return null;
  samples.sort((a, b2) => a - b2);
  return { samples: samples.map((n) => Math.round(n)), medianMs: Math.round(samples[Math.floor(samples.length / 2)]) };
}

// ------------------------------------------------------------------ pieces
const RILEY_BENEFITS = [
  ["\u{1F550}", "Answers 24/7", "call anytime, day or night"],
  ["\u26A1", "Instant", "no waiting weeks on a freelancer"],
  ["\u{1F912}", "Never sick, never on vacation, never overloaded", ""],
  ["\u{1F60C}", "Never annoyed, never has a bad day", ""],
  ["\u2705", "Always does exactly what you ask", ""],
  ["\u{1F9E0}", "Usually has the better answer", ""],
  ["\u{1F527}", "\u201CChange my hero photo / add a service / fix my hours\u201D", "done while you\u2019re on the phone, live"],
];

/**
 * Riley's benefits, as icon rows on the dark card. Two cells, not a
 * `position:absolute` span — Gmail deletes `position`, which is what turned
 * every one of these into a glyph loose in the text flow.
 */
function benefitRows() {
  return RILEY_BENEFITS.map(([icon, bold, tail]) => `
    <tr>
      <td width="30" valign="top" style="width:30px;padding:7px 0;font-size:17px;line-height:1.45">${icon}</td>
      <td valign="top" style="padding:7px 0;font-family:${FONT_STACK};font-size:15px;line-height:1.45;color:${PALETTE.inkPanelMuted}">
        <strong style="color:#ffffff;font-weight:700">${esc(bold)}</strong>${tail ? ` — ${esc(tail)}` : ""}
      </td>
    </tr>`).join("");
}

/**
 * One half of the before/after pair.
 *
 * The label is TEXT above the shot, never baked into the image: with images
 * blocked the reader still gets "Your site today" / "The one we built", the alt
 * text and a working link, instead of two broken-image icons and no idea which
 * was which.
 */
function shotCell({ label, badge, src, alt, href, w, tone }) {
  return `
  <td width="50%" valign="top" style="width:50%;padding:0 7px">
    <div style="${TYPE.eyebrow};color:${tone};padding-bottom:9px">${esc(badge)}</div>
    <a href="${esc(href)}" style="text-decoration:none">
      <img src="${esc(src)}" width="${w}" alt="${esc(alt)}"
           style="display:block;width:100%;max-width:100%;height:auto;border:1px solid ${PALETTE.inkPanelLine};border-radius:8px" />
    </a>
    <div style="padding-top:11px;font-family:${FONT_STACK};font-size:14px;line-height:1.35;font-weight:700;color:${PALETTE.inkPanelInk}">${esc(label)}</div>
  </td>`;
}

// ---------------------------------------------------- the 15 included features
//
// artifacts/ramon-qa/product-claims.json is the registry: 18 claims, of which
// exactly 15 carry a `short` scan-label because exactly 15 are verified:true.
// Those 15 ARE the offer. THIS build then gets its own verdict per feature, read
// out of the rendered DOM — the registry proves each capability on the Ramon
// mirror, and that is not evidence about Flint's page.
//
// Three states, and only three:
//   built   — observed in THIS page's rendered DOM
//   product — capability is built and registry-verified, but it is not a surface
//             on this page, so this page cannot prove it
//   absent  — looked for it in the rendered DOM and did not find it. Said plainly.
//
// The three states also have to be TELLABLE APART AT A GLANCE. They used to be
// three near-identical pale chips (#e4f3ed / #eef0f4 / #fbeee2) on three
// identical cards, so a grid of fifteen read as one undifferentiated block and
// the honest "not on this build" answers were the easiest thing in the email to
// miss. Each state now carries its own fill, its own text colour and its own
// card edge, from the brand palette.
const STATE_STYLE = {
  built:   { bg: "rgba(52,211,153,.14)", fg: "#34D399", edge: "rgba(52,211,153,.35)", label: "on this build" },
  product: { bg: "rgba(110,139,255,.13)", fg: "#6E8BFF", edge: "rgba(110,139,255,.30)", label: "in the package" },
  // Absent stays truthful and stays quiet: graphite, not alarm-red. Six red
  // chips made an honest status report read as a failing test suite.
  absent:  { bg: "rgba(155,154,164,.12)", fg: "#9B9AA4", edge: "#26252E", label: "not on this build" },
};

/**
 * Read the rendered-DOM proof and decide each feature's state. `speedLine` and
 * `ratingLine` arrive already validated by the caller; everything else is
 * derived here from what the browser actually saw.
 */
function featureStates({ dom = null, feature = null, facts = {}, speedLine = "", ratingLine = "" } = {}) {
  const mirror = ((dom || {}).sites || []).find((s) => s.label === "new_mirror") || {};
  const home = (feature || {}).home || {};
  const llms = (feature || {}).llmsTxt || {};
  const headers = (feature || {}).responseHeaders || {};
  const has = (a) => Array.isArray(a) && a.length > 0;

  const logoOnPage = (home.logoImgs || []).some((u) => /client-logo/i.test(String(u)));
  const heroLine = has(mirror.h1) ? String(mirror.h1[0]).replace(/\s+/g, " ").trim() : "";
  const llmsOk = llms.status === 200;
  const schemaOk = has(mirror.ldTypes);
  const ratingOnPage = Boolean(home.hasAggregateRating) && Boolean(ratingLine);
  const mapPin = has(home.mapsIframes) && has(home.googleMapsLinks);
  const appleOnPage = has(home.appleMapsLinks);
  const socialOnPage = has(home.socialLinks);
  const httpsOk = headers.status === 200 && /max-age/.test(String(headers.strictTransportSecurity || ""));
  const indexable = ((feature || {}).robots || {}).status === 200 && ((feature || {}).sitemap || {}).status === 200;
  const previewNamespace = /wss-ai\.com$/i.test(SITE.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  const certs = facts.certifications || null;

  return [
    { n: 1, emoji: "\u{1F3A8}", label: "Your logo & colors",
      state: logoOnPage ? "built" : "absent",
      note: logoOnPage ? "your own mark is served from the page, and the palette is measured off it" : "no client mark found in the rendered page" },
    { n: 2, emoji: "\u{1F3AC}", label: "Cinematic hero",
      state: heroLine ? "built" : "absent",
      note: heroLine ? `a designed opening written for you — “${heroLine}”. Stills on this build, not video.` : "no hero headline in the rendered page" },
    // Was "Voice & AI answers", which read as a chatbot answering their
    // customers. It is not one: it is how the PAGE is written and marked up so
    // voice search and AI results can read it back. Say that instead.
    { n: 3, emoji: "\u{1F399}️", label: "Written for voice search & AI results",
      state: llmsOk && schemaOk ? "built" : "absent",
      note: llmsOk && schemaOk ? "llms.txt answers 200 and the page carries a full schema graph, so an answer engine can read you back correctly" : "llms.txt or the schema graph is missing" },
    { n: 4, emoji: "⭐", label: ratingLine || "Your Google rating",
      state: ratingOnPage ? "built" : "absent",
      note: ratingOnPage ? "read from two independent transports, and rendered on the page as AggregateRating" : "no rating verified from a non-Genie observer — nothing shown" },
    // Slot 5 is the certifications slot. The FEATURE is in the package and is
    // shown as such. The CLAIM is not made: no observer ever produced a
    // certification for this business, so the site displays none and neither
    // does this email. An absent fact is an absent claim, never a softened one.
    { n: 5, emoji: "\u{1F3C5}", label: "Your certifications",
      state: certs ? "built" : "absent",
      note: certs ? "verified and displayed" : "nothing claimed. No certification for this business exists in any source, and none is published on your own site — so the slot stays empty rather than filled." },
    { n: 6, emoji: "\u{1F4CD}", label: "Google Maps pin",
      state: mapPin ? "built" : "absent",
      note: mapPin ? "a keyed Maps embed and a live directions link, both answering 200, pinned to your real address" : "no map embed or directions link in the rendered page" },
    { n: 7, emoji: "\u{1F50E}", label: "Competitor research",
      state: "product",
      note: "arrives as your Signal report, not as a panel on this page — so this page cannot show it to you" },
    { n: 8, emoji: "⚡", label: speedLine || "Load speed",
      state: speedLine ? "built" : "absent",
      note: speedLine ? "measured against this page on a cold cache, median of five runs" : "measurement unavailable — no speed claim made" },
    { n: 9, emoji: "\u{1F512}", label: "Hosting & SSL",
      state: httpsOk ? "built" : "absent",
      note: httpsOk ? "served over HTTPS with strict transport security switched on" : "no HTTPS/HSTS evidence from the live response" },
    { n: 10, emoji: "✏️", label: "Unlimited edits — ask and we make the change",
      state: "product",
      note: "the edit pipeline is built; it is a service you use, not something that shows on the page" },
    // The registry pulled this text back from "free" because who pays the
    // registrar was never evidenced. "included" is that same unevidenced
    // commercial promise wearing a different word, so it does not come back.
    { n: 11, emoji: "\u{1F310}", label: "Your own domain — connected and verified for you",
      state: "product",
      note: previewNamespace ? "this build sits on the preview namespace; the custom-domain path is built and runs at go-live" : "custom domain already attached" },
    { n: 12, emoji: "\u{1F4C1}", label: "Directory & citation check",
      state: indexable ? "built" : "product",
      note: indexable ? "robots.txt and sitemap.xml both answer 200, so directories can find the page; the citation audit itself arrives in your report" : "the citation audit arrives in your report" },
    { n: 13, emoji: "\u{1F5FA}️", label: "Google & Apple Maps",
      state: mapPin && appleOnPage ? "built" : "absent",
      note: mapPin && appleOnPage ? "both map links are published for each service to read" : "Google is live on this build. The Apple Maps link is NOT on this page — an open gap, not a delivered feature." },
    { n: 14, emoji: "\u{1F4F1}", label: "5 socials in one feed",
      state: socialOnPage ? "built" : "absent",
      note: socialOnPage ? "your accounts render together in one feed" : "no social account is linked on this page yet — nothing to feed until your handles are connected" },
    // Was "Riley (AI assistant)" — that sells her as a bot for their customers,
    // which is wrong and undersells her badly. She is the OWNER'S developer.
    { n: 15, emoji: "\u{1F916}", label: "Riley — your private web developer: call to change your site",
      state: "product",
      note: "staged for you. Your developer, not a bot for your callers — and on this internal build his edit execution is still unproven." },
  ];
}

function featureCards(features) {
  const cell = (f) => {
    if (!f) return `<td width="50%" style="width:50%">&nbsp;</td>`;
    const s = STATE_STYLE[f.state] || STATE_STYLE.product;
    return `<td width="50%" valign="top" style="width:50%;padding:0 6px 12px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${cardStyleDark({ line: s.edge, shelf: s.edge, radius: 12 })}">
        <tr><td style="padding:15px 15px 16px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
            <td width="34" valign="top" style="width:34px">
              <div style="width:30px;height:30px;background:${s.bg};border-radius:8px;text-align:center;font-size:15px;line-height:30px">${f.emoji}</div>
            </td>
            <td valign="top" style="padding-left:10px">
              <div style="${TYPE.eyebrow};color:#A3A2AE">${f.n} / 15</div>
              <div style="margin-top:5px;font-family:${FONT_STACK};font-size:14.5px;line-height:1.3;color:${PALETTE.ink};font-weight:800">${esc(f.label)}</div>
            </td>
          </tr></table>
          <div style="margin-top:11px">
            <span style="display:inline-block;background:${s.bg};color:${s.fg};font-family:${FONT_STACK};font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;padding:4px 9px;border-radius:20px">${esc(s.label)}</span>
          </div>
          <div style="margin-top:10px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${PALETTE.muted}">${esc(f.note)}</div>
        </td></tr>
      </table>
    </td>`;
  };
  let rows = "";
  for (let i = 0; i < features.length; i += 2) rows += `<tr>${cell(features[i])}${cell(features[i + 1])}</tr>`;
  // table-layout:fixed pins the two columns to 50/50. Under auto layout a single
  // long token in a note ("places_gbp_via_callprep_gateway") sets the column's
  // min-content width and the grid pushes the document wider than the viewport.
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed">${rows}</table>`;
}

/**
 * The market/address split, side by side, each with the evidence that produced
 * it. Austin is the client's OWN claim about the market they sell to. Buda is
 * Google's independently observed locality. Neither is inferred, neither is
 * guessed off a gazetteer, and this panel says which is which rather than
 * quietly picking one and hoping nobody checks.
 */
function cityPanel(cities) {
  if (!cities) return "";
  // One city = no story: narrating a market/postal split that does not exist
  // (both said Wichita Falls) confused the one reader this email has.
  if (cities.market && cities.postal && cities.market.value === cities.postal.value) return "";
  const col = (c) => `
    <td width="50%" valign="top" style="width:50%;padding:0 6px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${cardStyleDark({ radius: 12 })}">
        <tr><td style="padding:18px 18px 16px">
          <div style="${TYPE.eyebrow};color:${c.tone}">${esc(c.role)}</div>
          <div style="margin-top:8px;font-family:${FONT_STACK};font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-.02em;color:${PALETTE.ink}">${esc(c.value)}</div>
          <div style="margin-top:10px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${PALETTE.muted}">${esc(c.why)}</div>
          
        </td></tr>
      </table>
    </td>`;
  // THE RAW READ-BACK STAYS, AND STAYS SMALL. It is the only part of this email
  // that lets the owner check the claim rather than take it, so deleting it to
  // look sleeker would be deleting the proof. It is set as a quiet monospace
  // appendix instead of the 11.5px wall that dominated the old render — and it
  // is the block that caused the 448px-wide horizontal scroll at 375px, because
  // an unbroken schema URL in a fixed-layout cell cannot wrap. break-word fixes
  // that at the source.
  return `
  <tr><td style="padding:0 0 14px">
    <div style="${TYPE.eyebrow};color:${PALETTE.muted};padding-bottom:8px">Two cities, two jobs</div>
    <p style="margin:0 0 16px;${TYPE.body}">
      Your listing is registered in one town and you sell into another. The site now says both, in the right places. The market you sell to is not the address on your envelope, and we stopped treating the two as one field.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed"><tr>
      ${col(cities.market)}
      ${col(cities.postal)}
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;margin-top:14px;${cardStyleDark({ background: PALETTE.subtle, shelf: PALETTE.line, radius: 10 })}">
      <tr><td style="padding:15px 16px;${TYPE.mono};color:#4B4A57;word-break:break-word;overflow-wrap:anywhere">
        <div style="${TYPE.eyebrow};color:${PALETTE.muted};padding-bottom:9px;font-family:${FONT_STACK}">Read back out of the rendered pages</div>
        ${cities.evidence.map((e) => `<div style="padding:3px 0">${esc(e)}</div>`).join("")}
      </td></tr>
    </table>
  </td></tr>`;
}

// --------------------------------------------------------------------- html
// `rileyLine` is the resolver's verdict, not a string: { phone, display,
// telHref }. phone === null means this client has no Riley line, and the CTA
// plus its follow-on instruction are not built at all — the same rule the
// certifications line already lives by.
function buildHtml({ rileyLine = { phone: null, display: "", telHref: "" }, speedLine, ratingLine, features = null, cities = null, accent = DEFAULT_ACCENT }) {
  const gridItems = features || featureStates({ speedLine, ratingLine });

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.page};margin:0;padding:0">
<tr><td align="center" style="padding:28px 12px 40px">

<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px">

  <!-- masthead. The real wss-ai.com mark, left-aligned like a sender rather
       than centred like a medallion over a document. -->
  <tr><td style="padding:0 6px 18px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="padding-right:12px">
        <img src="${esc(LOGO)}" width="44" height="44" alt="WSS Labs"
             style="display:block;width:44px;height:44px;border-radius:12px;border:0" />
      </td>
      <td valign="middle">
        <span style="font-family:${FONT_STACK};font-size:16px;font-weight:800;letter-spacing:-.01em;color:${PALETTE.ink}">WSS Labs</span><br />
        <span style="font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${PALETTE.muted}">AI-powered web studio · California</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- headline card -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${cardStyleDark()}">
      <tr><td style="padding:5px 0 0;background:${accent.base};font-size:0;line-height:0;border-radius:13px 13px 0 0">&nbsp;</td></tr>
      <tr><td style="padding:28px 28px 26px">
        <div style="${TYPE.eyebrow};color:${accent.onLight};padding-bottom:12px">Your new website is live</div>
        <h1 style="margin:0 0 14px;${TYPE.display}">${esc(BUSINESS)} — here it is, next to your old one.</h1>
        <p style="margin:0 0 22px;${TYPE.lead}">A picture’s worth a thousand words. Scroll — this is all yours.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${accent.buttonBg}" style="background:${accent.buttonBg};border-radius:10px;padding:15px 28px">
            <a href="${esc(SITE)}" style="display:block;font-family:${FONT_STACK};font-size:15.5px;line-height:1.2;font-weight:800;color:${accent.buttonFg};text-decoration:none">See your live site &rarr;</a>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <!-- THE HERO MOMENT: before and after, desktop and phone, on the dark panel.
       This pair is the entire proposition of the email, so it sits directly
       under the headline instead of being one section among fifteen. The
       captions are TEXT, so with images blocked the reader still gets
       "Before -> After", "Your site today", "The one we built", the alt text and
       two working links rather than two broken-image icons. -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALETTE.inkPanel}" style="${cardStyleDark({ background: PALETTE.inkPanel, line: PALETTE.inkPanelLine, shelf: "#08080B", radius: 16 })}">
      <tr><td style="padding:26px 18px 24px">

        <div style="${TYPE.eyebrow};color:${accent.onDark};text-align:center;padding-bottom:6px">Before &nbsp;&rarr;&nbsp; After</div>
        <div style="font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${PALETTE.inkPanelMuted};text-align:center;padding-bottom:20px">Same business, same phone number. Tap either one.</div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed"><tr>
          ${shotCell({ badge: "Now", label: "Your site today", src: SHOTS.desktopOld, alt: `${BUSINESS} current website at wilbournmccabeplumbing.com, desktop`, href: CURRENT, w: 288, tone: PALETTE.inkPanelMuted })}
          ${shotCell({ badge: "After", label: "The one we built", src: SHOTS.desktopNew, alt: `${BUSINESS} new website built by Woodward Software, desktop`, href: SITE, w: 288, tone: accent.onDark })}
        </tr></table>

        <div style="height:1px;background:${PALETTE.inkPanelLine};font-size:0;line-height:0;margin:26px 0 20px">&nbsp;</div>

        <div style="${TYPE.eyebrow};color:${PALETTE.inkPanelMuted};text-align:center;padding-bottom:16px">On a phone</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed"><tr>
          <td width="50%" align="center" style="width:50%;padding:0 7px">
            <a href="${esc(CURRENT)}" style="text-decoration:none"><img src="${esc(SHOTS.mobileOld)}" width="150" alt="${esc(BUSINESS)} current website on a phone"
              style="display:block;width:150px;max-width:100%;height:auto;border:1px solid ${PALETTE.inkPanelLine};border-radius:10px" /></a>
          </td>
          <td width="50%" align="center" style="width:50%;padding:0 7px">
            <a href="${esc(SITE)}" style="text-decoration:none"><img src="${esc(SHOTS.mobileNew)}" width="150" alt="${esc(BUSINESS)} new website on a phone"
              style="display:block;width:150px;max-width:100%;height:auto;border:1px solid ${PALETTE.inkPanelLine};border-radius:10px" /></a>
          </td>
        </tr></table>

      </td></tr>
    </table>
  </td></tr>

  <!-- ============ RILEY ============ -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALETTE.inkPanel}" style="${cardStyleDark({ background: PALETTE.inkPanel, line: PALETTE.inkPanelLine, shelf: "#08080B", radius: 16 })}">
      <tr><td style="padding:28px 26px 26px">

        <div style="${TYPE.eyebrow};color:${accent.onDark}">
          &#10022; Included — nobody else gives you this
        </div>

        <h2 style="margin:14px 0 10px;font-family:${FONT_STACK};font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-.02em;color:#ffffff">
          Meet Riley — your private web developer.
        </h2>
        <p style="margin:0 0 20px;font-family:${FONT_STACK};font-size:16px;line-height:1.5;color:${accent.onDark};font-weight:600">
          Not a chatbot for your customers. He works for you — you call
          him, and your site changes.
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${benefitRows()}
        </table>

        <p style="margin:22px 0 0;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:#ffffff;border-top:1px solid ${PALETTE.inkPanelLine};padding-top:18px">
          You don’t get shortchanged with a robot. You get an employee who never clocks out.
        </p>

        <!-- INTERNAL MARKER — required on this self-addressed test build. Riley's
             edit execution has not been watched run end to end, so the section
             that sells her says so, in the email, where the reader is. -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;background:#3A2F12;border:1px solid #7A6320;border-radius:8px">
          <tr><td style="padding:11px 14px;font-family:${FONT_STACK};font-size:12px;line-height:1.45;color:#F2D98B">
            [INTERNAL TEST — Riley edit execution UNPROVEN. Not for prospect send.]
          </td></tr>
        </table>

      </td></tr>
    </table>
  </td></tr>

  <!-- the 15 -->
  <tr><td style="padding:0 0 14px">
    <div style="${TYPE.eyebrow};color:${PALETTE.muted};padding-bottom:8px">What’s in the build — all 15</div>
    <p style="margin:0 0 16px;${TYPE.body}">
      Each one carries its own status, read off your live page rather than off a checklist. Where a thing is not on the page yet, it says so.
    </p>
    ${featureCards(gridItems)}
  </td></tr>

${cityPanel(cities)}
  <!-- CTA — built ONLY when this client has a resolved Riley line. A number is
       not decoration: with nothing to dial, the button and the instruction that
       follows it are both absent, not blank. -->
  ${rileyLine.phone ? `<tr><td style="padding:0 0 14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="${accent.buttonBg}" style="background:${accent.buttonBg};border-radius:12px;padding:20px 22px">
        <a href="${esc(rileyLine.telHref)}" style="display:block;color:${accent.buttonFg};text-decoration:none;font-family:${FONT_STACK};font-size:27px;line-height:1.3;font-weight:800;letter-spacing:-.01em">
          <span style="font-size:15px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.85">&#128222; Call Riley now</span><br />
            <span style="font-size:34px;font-weight:800;letter-spacing:-.02em;line-height:1.15;display:inline-block;padding:6px 0 2px">${esc(rileyLine.display)}</span><br />
          <span style="font-size:14px;font-weight:600">tell him what to change on your site and watch it happen.</span>
        </a>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 0 14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${cardStyleDark()}">
      <tr><td style="padding:18px 24px">
        <p style="margin:0;${TYPE.body};text-align:center">
          Just give him your business name, your phone number, or your Client ID — that’s all he needs to pull up your site.
        </p>
      </td></tr>
    </table>
  </td></tr>` : ""}

  <!-- sign-off. width="100%" is not decoration: a table with no declared width
       gets auto layout and sizes to its longest unbroken run, so at 375px this
       one line was 374px wide inside a 351px column and dragged the entire
       document into a horizontal scroll (measured: 448px of content in a 375px
       viewport). Any table here that holds flowing text carries a width. -->
  <tr><td style="padding:10px 6px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
      <td width="4" style="width:4px;background:${accent.base};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
      <td style="padding-left:14px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;font-weight:700;color:${PALETTE.ink}">
        — Mark Woodward, Woodward Software · Mission Viejo, CA
      </td>
    </tr></table>
  </td></tr>

</table>
</td></tr>
</table>`;
}

function buildText({ rileyLine = { phone: null, display: "", telHref: "" }, speedLine, ratingLine, features = null, cities = null }) {
  const items = features || featureStates({ speedLine, ratingLine });
  return [
    `${BUSINESS} — your new website is LIVE. Here it is next to your old one.`,
    "",
    `Your site today: ${CURRENT}`,
    `The one we built: ${SITE}`,
    "",
    "A picture's worth a thousand words. Scroll — this is all yours.",
    "",
    ...(cities
      ? [
        "TWO CITIES, TWO JOBS",
        `  ${cities.market.role}: ${cities.market.value} — ${cities.market.why}`,
        `    field ${cities.market.field} · class ${cities.market.klass} · said by ${cities.market.source} · drives ${cities.market.drives}`,
        `  ${cities.postal.role}: ${cities.postal.value} — ${cities.postal.why}`,
        `    field ${cities.postal.field} · class ${cities.postal.klass} · said by ${cities.postal.source} · drives ${cities.postal.drives}`,
        "  Read back out of the rendered pages:",
        ...cities.evidence.map((e) => `    ${e}`),
        "",
      ]
      : []),
    "MEET RILEY — your private web developer. Not a chatbot for your customers. He works for you — you call him, and your site changes.",
    ...RILEY_BENEFITS.map(([, b, t]) => `  - ${b}${t ? ` — ${t}` : ""}`),
    "",
    "You don't get shortchanged with a robot. You get an employee who never clocks out.",
    "",
    "[INTERNAL TEST — Riley edit execution UNPROVEN. Not for prospect send.]",
    "",
    "What's in the build — all 15. Each status is read off your live page, not off a checklist:",
    ...items.map((f) => `  ${f.n}. ${f.label}  [${(STATE_STYLE[f.state] || STATE_STYLE.product).label}]\n       ${f.note}`),
    "",
    // Same omission rule as the HTML: no line, no CTA, no follow-on instruction.
    ...(rileyLine.phone
      ? [
        `Call Riley now: ${rileyLine.display} — tell him what to change on your site and watch it happen.`,
        "Just give him your business name, your phone number, or your Client ID — that's all he needs to pull up your site.",
        "",
      ]
      : []),
    "— Mark Woodward, Woodward Software · Mission Viejo, CA",
  ].join("\n");
}

/**
 * The client record for this build. Riley's line, when one is ever provisioned,
 * belongs HERE (a `riley_phone` field) — per client, next to that client's slug
 * and data dir. Missing file or missing field is a normal outcome, not an error.
 */
function readClientStamp() {
  try {
    return JSON.parse(fs.readFileSync(STAMP, "utf8"));
  } catch {
    return {};
  }
}

// --------------------------------------------------------------------- main
async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  // Render-to-file mode. Implies dry: there is no code path from here to Resend.
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outFile = outArg ? path.resolve(outArg.slice("--out=".length)) : null;
  const audit = { recipient: OWNER_EMAIL, factsIncluded: [], factsSkipped: [], images: [] };

  // ---- client facts: verified file is the ONLY source ----
  const vf = JSON.parse(fs.readFileSync(FACTS, "utf8"));
  const f = vf.facts || {};
  const prov = vf.provenance || {};

  const ratingOk = Number.isFinite(f.rating) && prov.rating
    && !JSON.stringify(prov.rating.sources || []).match(/genie/i);
  let ratingLine = "";
  if (ratingOk) {
    ratingLine = `Your Google rating — ${f.rating}\u2605${Number.isFinite(f.review_count) ? ` from ${f.review_count} reviews` : ""}`;
    audit.factsIncluded.push(`rating=${f.rating} reviews=${f.review_count} (class=${prov.rating.class}, ${prov.rating.corroboration}, sources=${(prov.rating.sources || []).map((s) => s.source).join("+")})`);
  } else {
    audit.factsSkipped.push("rating — no verified non-Genie observation");
  }

  // Certifications: there is no such field, in facts or in provenance. Absent.
  const certs = f.certifications || prov.certifications;
  if (certs) audit.factsIncluded.push("certifications");
  else audit.factsSkipped.push("certifications — no field in verified-facts.json, no observation from any source, nothing on the rendered site");

  // ---- measured speed ----
  const speed = await measureLoadMs(SITE, 5);
  let speedLine = "";
  if (speed) {
    // Same formatter the subject uses, so subject and body can never disagree
    // about the same measurement (174ms was printing as "0.2s" in one place).
    speedLine = `Loads in ${measuredLoadLabel(speed)}`;
    audit.factsIncluded.push(`load time = ${speed.medianMs}ms median of ${speed.samples.length} cold-cache runs ${JSON.stringify(speed.samples)} -> "${speedLine}"`);
  } else {
    audit.factsSkipped.push("load speed — measurement unavailable, line omitted rather than guessed");
  }

  // ---- Riley's number: THIS CLIENT'S line, or none at all ----
  // The rendered email published a long-retired agency number because a constant
  // in lib/email.js answered when the environment did not. That constant is gone.
  // What replaces it is per-client: the resolver looks for a Riley line
  // provisioned for THIS client and stops there. `allowAgencyLine` stays false —
  // one agency-wide number mailed to every client is the defect, not the fix.
  //
  // The client's own NAP phone in verified-facts.json is NOT a candidate: it is
  // Flint's front desk (independently corroborated, and correct as *their*
  // number), but Riley does not answer it. Printing it under "Text or call
  // Riley" would be a fabricated attribution — a real number, false claim.
  const clientRecord = readClientStamp();
  const rileyLine = resolveRileyLine({
    client: clientRecord,
    facts: f,
    provenance: prov,
    allowAgencyLine: false,
  });
  audit.rileyLine = {
    rendered: rileyLine.phone ? rileyLine.display : null,
    source: rileyLine.source,
    reason: rileyLine.reason,
    ctaRendered: Boolean(rileyLine.phone),
    searchedClientFields: CLIENT_RILEY_PHONE_FIELDS,
    refusedFields: NON_RILEY_PHONE_FIELDS,
    note: rileyLine.phone
      ? "per-client Riley line"
      : "no Riley line provisioned for this client — CTA and phone line omitted entirely (fail closed)",
  };
  if (rileyLine.phone) audit.factsIncluded.push(`riley line = ${rileyLine.display} (source=${rileyLine.source})`);
  else audit.factsSkipped.push(`riley line — ${rileyLine.reason}; CTA omitted rather than filled with an agency default`);

  // ---- rendered-DOM evidence: required, never optional ----
  // Both proof files are written by a real browser run against the two live
  // sites. Without them this email would be asserting a market split it never
  // watched render, which is the exact failure this build exists to end.
  let dom;
  let feature;
  try {
    dom = JSON.parse(fs.readFileSync(DOM_PROOF, "utf8"));
    feature = JSON.parse(fs.readFileSync(FEATURE_PROOF, "utf8"));
  } catch (e) {
    throw new Error(`rendered-DOM proof missing (${e.message}) — run scripts/flint-dom-proof.cjs and scripts/flint-feature-proof.cjs first. QC PASS is not a substitute.`);
  }
  const oldDom = (dom.sites || []).find((s) => s.label === "old_wilbournmccabeplumbing_com") || {};
  const newDom = (dom.sites || []).find((s) => s.label === "new_mirror") || {};
  for (const [name, site] of [["wilbournmccabeplumbing.com", oldDom], ["the mirror", newDom]]) {
    if (!site.ok || site.httpStatus !== 200) throw new Error(`${name} did not render (ok=${site.ok} status=${site.httpStatus}) — refusing to claim anything about a page nobody saw`);
  }

  // ---- the market/address split, and the evidence for both halves ----
  const market = marketCity(f);
  const postal = addressCity(f);
  if (!market || !postal) throw new Error(`market/address city unresolved (market=${market} postal=${postal})`);
  const provClass = (key) => (prov[key] ? `${prov[key].class} · ${prov[key].corroboration}` : "unclassified");
  const provSource = (key) => (prov[key] ? (prov[key].sources || []).map((s) => s.source).join(" + ") : "no provenance");
  const llmsLines = String((feature.llmsTxt || {}).head || "").split("\n").filter((l) => /^- (Serves|Located in):/.test(l));

  const cities = {
    market: {
      role: "The market you sell to",
      value: `${market}, ${f.state}`,
      tone: "#0e7a5f",
      why: "Your own website has said this for years. Nobody knows your market better than you do, so we take it from you and attribute it to you.",
      field: "facts.service_area",
      klass: provClass("service_area"),
      source: `${provSource("service_area")} — your own site, self-published`,
      drives: "the page title, the hero headline, “Serving …”, and the {{CITY}} token",
    },
    postal: {
      role: "Where the mail goes",
      value: `${postal}, ${f.state}`,
      tone: "#8a4b16",
      why: "The locality on your Google listing, observed independently. It is the only value allowed into a postal address, and it changes nothing else on the page.",
      field: "facts.city",
      klass: provClass("city"),
      source: `${provSource("city")} — Google, independently observed`,
      drives: "schema.org PostalAddress and the visible address block, via {{ADDRESS_CITY}}",
    },
    evidence: [
      `wilbournmccabeplumbing.com  <title>  ${JSON.stringify(oldDom.title)}`,
      `wilbournmccabeplumbing.com  meta description  ${JSON.stringify(String(oldDom.metaDescription || "").slice(0, 96) + "…")}`,
      `the mirror      <title>  ${JSON.stringify(newDom.title)}`,
      `the mirror      data-city=${JSON.stringify(newDom.dataCity)}   data-address-city=${JSON.stringify(newDom.dataAddressCity)}`,
      `the mirror      schema PostalAddress.addressLocality=${JSON.stringify(newDom.ldAddressLocality)}  postalCode=${JSON.stringify(newDom.ldPostalCode)}`,
      `the mirror      schema areaServed  ${JSON.stringify(newDom.ldAreaServed)}`,
      ...llmsLines.map((l) => `the mirror      llms.txt  ${JSON.stringify(l)}`),
    ],
  };
  audit.cities = {
    marketing: { value: market, field: "facts.service_area", class: provClass("service_area"), source: provSource("service_area") },
    postal: { value: postal, field: "facts.city", class: provClass("city"), source: provSource("city") },
    renderedTitles: { old: oldDom.title, new: newDom.title },
    renderedSplit: { dataCity: newDom.dataCity, dataAddressCity: newDom.dataAddressCity, postalLocality: newDom.ldAddressLocality, areaServed: newDom.ldAreaServed },
    llmsTxt: llmsLines,
    note: "Austin is the client's own assertion (self_published). Buda is Google's NAP locality and the ONLY value permitted into PostalAddress. Neither inferred, neither guessed.",
  };

  // ---- the 15, each judged against the rendered page ----
  const features = featureStates({ dom, feature, facts: f, speedLine, ratingLine });
  if (features.length !== 15) throw new Error(`expected the 15 included features, built ${features.length}`);
  audit.features = features.map((x) => ({ n: x.n, label: x.label, state: x.state, note: x.note }));
  audit.featureTally = features.reduce((acc, x) => ({ ...acc, [x.state]: (acc[x.state] || 0) + 1 }), {});

  // ---- images must be real BEFORE they can be referenced ----
  for (const [name, url] of Object.entries(SHOTS)) audit.images.push(await assertRealImage(name, url));
  audit.images.push(await assertRealImage("woodwardLogo", LOGO));

  // ---- the accent: MEASURED off the client's own logo, or none ----
  //
  // The old email was coloured #86d0c4 with the comment "the built site's own
  // teal, so the email matches the product" — a hex typed into this file, which
  // is exactly the class of thing that stops being true the moment the build
  // changes and that nobody notices. It is now read from the client-logo bytes
  // this build actually serves, through the same measureAccent() the mirror
  // engine uses. An unmeasurable logo yields the WSS brand accent and says so in
  // the audit; it never yields a colour somebody guessed.
  let accent = DEFAULT_ACCENT;
  audit.accent = { source: CLIENT_LOGO, measured: null, reason: null };
  try {
    const logoBytes = await guardedFetch(CLIENT_LOGO);
    const sniffed = sniffImage(logoBytes.bytes);
    if (!sniffed) throw new Error("client logo is not a recognized image");
    const measured = await measureAccent(logoBytes.bytes, sniffed.ext);
    if (!measured) throw new Error("accent unmeasurable from the client logo");
    accent = design.clientAccent(measured.hex);
    audit.accent.measured = {
      hex: measured.hex,
      method: measured.method,
      share: Number(measured.share.toFixed(3)),
      palette: measured.palette,
    };
  } catch (e) {
    audit.accent.reason = `${String(e.message || e)} — fell back to the WSS brand accent, nothing invented`;
  }
  audit.accent.resolved = {
    base: accent.base,
    onLight: accent.onLight,
    onDark: accent.onDark,
    buttonBg: accent.buttonBg,
    buttonFg: accent.buttonFg,
    isClientColour: accent.measured,
  };
  audit.accent.contrast = {
    onLight_vs_panel: Number(design.contrast(accent.onLight, design.PALETTE.panel).toFixed(2)),
    onDark_vs_inkPanel: Number(design.contrast(accent.onDark, design.PALETTE.inkPanel).toFixed(2)),
    buttonFg_vs_buttonBg: Number(design.contrast(accent.buttonFg, accent.buttonBg).toFixed(2)),
  };

  const html = buildHtml({ rileyLine, speedLine, ratingLine, features, cities, accent });
  const text = buildText({ rileyLine, speedLine, ratingLine, features, cities });

  // The trade is not negotiable. A plumbing client gets a plumbing page.
  if (!/plumb/i.test(newDom.title || "") || (newDom.roofCount || 0) > 0 || (newDom.hvacCount || 0) > 0) {
    throw new Error(`trade drift on the rendered mirror (title=${JSON.stringify(newDom.title)} roof=${newDom.roofCount} hvac=${newDom.hvacCount})`);
  }
  if (newDom.rawTokenLeak) throw new Error("the rendered mirror still shows raw {{TOKENS}} — refusing to present it as finished");
  // Both cities must survive into the reader's copy, or the split was pointless.
  for (const needle of [market, postal]) {
    if (!html.includes(needle)) throw new Error(`${needle} is missing from the rendered email — the reconciliation must be visible, not implied`);
  }

  // Gmail clips HTML over ~102KB; the whole email is proof, so it must not clip.
  const htmlKB = +(Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
  audit.htmlKB = htmlKB;
  if (htmlKB > 102) throw new Error(`html is ${htmlKB}KB — Gmail would clip it`);

  // The marker is required. Do not allow a send without it.
  if (!html.includes("[INTERNAL TEST — Riley edit execution UNPROVEN. Not for prospect send.]")) {
    throw new Error("internal marker missing — refusing to send");
  }

  // The subject is built from the SAME measurement the body uses, through the
  // shared builder. "0 errors" is gone for good (we measured zero console errors
  // on one render of one page — that is not a property of the site), and when
  // `speed` is null the subject simply carries no performance claim.
  const subjectBuild = buildProofEmailSubject({ businessName: BUSINESS, measured: speed, internalTest: true });
  const subject = subjectBuild.subject;
  audit.subject = subject;
  audit.subjectPerfClaim = subjectBuild.measuredLabel
    ? `${subjectBuild.measuredLabel} — measured, ${speed.medianMs}ms median of ${speed.samples.length} cold-cache runs`
    : "none — no measurement available, subject carries no performance claim";

  // Belt and braces: a perf claim may never reach the wire without a measurement
  // behind it, whoever edits the copy later.
  const strayClaim = unsupportedPerfClaim(subject, {
    businessName: BUSINESS,
    measuredLabel: subjectBuild.measuredLabel || "",
  });
  if (strayClaim && !subjectBuild.measuredLabel) {
    throw new Error(`subject carries an unmeasured performance claim (${strayClaim}) — refusing to send`);
  }

  // --out=<file> renders this email to an arbitrary path for a human to open.
  // It NEVER sends and it NEVER overwrites the client dir's proof-email.html /
  // proof-email-audit.json: those two files are the record of what was actually
  // put on the wire for msg 57d0a6ee, and a preview rebuild that quietly
  // replaced them would destroy the only evidence of what the owner received.
  if (outFile) {
    const auditFile = outFile.replace(/\.html?$/i, "") + "-audit.json";
    fs.writeFileSync(outFile, html);
    fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2) + "\n");
    console.log(JSON.stringify(audit, null, 2));
    console.log(`\nhtml: ${htmlKB}KB -> ${outFile}`);
    console.log(`audit:           -> ${auditFile}`);
    console.log("\nRENDER ONLY (--out) — nothing sent, as-sent artifacts untouched.");
    return;
  }

  const outDir = path.join(__dirname, "../artifacts/clients/wss-test-wilbourn-and-mccabe-plumbing");
  fs.writeFileSync(path.join(outDir, "proof-email.html"), html);
  fs.writeFileSync(path.join(outDir, "proof-email-audit.json"), JSON.stringify(audit, null, 2) + "\n");

  console.log(JSON.stringify(audit, null, 2));
  console.log(`\nhtml: ${htmlKB}KB -> ${path.join(outDir, "proof-email.html")}`);

  if (dryRun) { console.log("\nDRY RUN — nothing sent."); return; }

  const { from: FROM, replyTo: REPLY_TO } = sender();
  const payload = { from: FROM, to: [OWNER_EMAIL], reply_to: REPLY_TO, subject, html, text };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${String(process.env.RESEND_API_KEY || "").trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`RESEND FAILED ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nSENT -> id=${body.id}  to=${OWNER_EMAIL}  from=${FROM}`);
  fs.writeFileSync(path.join(outDir, "proof-email-sent.json"), JSON.stringify({ id: body.id, to: OWNER_EMAIL, subject, at: new Date().toISOString() }, null, 2) + "\n");
}

// Importable for tests (which must be able to render this email's HTML without
// reading the secrets file or contacting anyone). Only a direct `node` run sends.
module.exports = { buildHtml, buildText, readClientStamp, RILEY_BENEFITS };

if (require.main === module) {
  main().catch((e) => { console.error("FATAL", e.message); process.exitCode = 1; });
}
