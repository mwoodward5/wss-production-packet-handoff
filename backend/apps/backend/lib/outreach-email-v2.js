"use strict";

// WSS Labs outreach email v3 (owner directive 2026-07-27).
// Warm, personal, first-person from Mark Woodward. The v1 "was selected" template
// is DELETED — this is the single source of truth. Never revert.

// The one place that answers "does this captured page belong to this
// prospect?". Shared with the proof-shot proxy and the capture writer so all
// three enforce one rule instead of three approximations of it.
const { capturedShotBelongsTo, registrableDomain } = require("./proof-storage");
const { safeReportUrl } = require("./report-url");

// The one place the STOP promise is written. Both MIME parts of a cold email
// render from this module so they cannot disagree about how to opt out.
const { optOutPromiseHtml } = require("./opt-out-promise");

// THE LOOK IS NOT DEFINED HERE (2026-07-31). Palette, type scale, card depth and
// the contrast-safe client accent all come from lib/wss-email-design.js, which
// reads packages/wss-brand-system. Before this, every colour and font-size in
// this file was an inline literal invented on the spot — which is why the owner
// read the result as "flat, like a PDF report": six type roles all landed
// between 12.5px and 15px, and the only brand signal was the mark at the top.
const design = require("./wss-email-design");

const { FONT_STACK, PALETTE, TYPE } = design;

// Sender mark shown in the header. Same-origin on wss-ai.com so Gmail treats it
// as first-party rather than a tracking pixel from an unknown host.
const WSS_HEADER_LOGO_URL = design.WSS_MARK_URL;

/**
 * THE PROOF SHELL, REDESIGNED 2026-07-31 (owner: "reads flat, like a PDF
 * report, not a sleek product email").
 *
 * What actually changed, and why each one is a fix rather than a restyle:
 *
 *   · HIERARCHY. Old shell: 16px greeting, 14.5px body, 13.5px CTA, 13px card
 *     copy, 12.5px offer rows, 12px footer — six roles inside a 4px band, so
 *     nothing led. New shell runs the design module's ladder, 30 / 21 / 16.5 /
 *     15 / 13 / 11, and the reader's eye has somewhere to go.
 *
 *   · THE COMPARISON IS THE HERO. The before/after used to sit two thirds of
 *     the way down under a 11px grey label, below the offer's ancestors and
 *     after four paragraphs of prose. It is the only thing in this email that
 *     proves anything, so it is now the second block, on the dark panel, at
 *     full container width with its own captions.
 *
 *   · THE ACCENT IS THEIRS. Every accent surface resolves from the colour
 *     measured off the client's OWN logo bytes, through
 *     design.clientAccent(), which keeps their hue and moves only lightness far
 *     enough to stay legible on the surface it lands on. Two clients with
 *     different logos get visibly different emails.
 *
 *   · GMAIL. Every icon row was `position:absolute` + a 24px indent. Gmail
 *     deletes `position`, so in the client that matters most the glyph dropped
 *     into the text flow and the indent stayed. Icons are two-cell rows now.
 *     Depth is a 3px bottom border, not a box-shadow Gmail would strip.
 *
 * NOTHING IN THE COPY MOVED. The sentences are load-bearing (several are pinned
 * verbatim by test/sequence-step-html-parity.js as the proof that a follow-up
 * is not the step-1 email) and several are promises made to strangers. This is
 * the same email, told with a type scale and a palette.
 */
const TEMPLATE = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PALETTE.page};font-family:${FONT_STACK}">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${PALETTE.page}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%">

  <!-- 1. HEADER LOGO -->
  {HEADER_LOGO_BLOCK}

  <!-- 2. THE HEADLINE CARD — eyebrow, display headline, one-line promise, CTA -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle()}">
      <tr><td style="padding:5px 0 0;background:{ACCENT_BASE};font-size:0;line-height:0;border-radius:13px 13px 0 0">&nbsp;</td></tr>
      <tr><td style="padding:26px 26px 24px">
        <p style="margin:0 0 12px;${TYPE.eyebrow};color:{ACCENT_LIGHT}">Your free live preview</p>
        <h1 style="margin:0 0 14px;${TYPE.display}">{BUSINESS_NAME}, here&#39;s your new website.</h1>
        <p style="margin:0 0 20px;${TYPE.lead}">It is built, it is online, and it costs you nothing to look at.</p>
        {PREVIEW_CTA_BLOCK}
      </td></tr>
    </table>
  </td></tr>

  <!-- 3. THE PROOF. This is the email. -->
  {COMPARISON_BLOCK}

  <!-- 3b. THE SIGNAL REPORT. The comparison shows what they could have; this
       shows why they need it — their own site, scored on the things a customer
       and a search engine actually check. Collapses to nothing when no report
       was generated, so a failed scan costs a link, never a broken email. -->
  {SIGNAL_REPORT_BLOCK}

  <!-- 4. HERO IMAGE (only when we serve it ourselves) -->
  {HERO_IMAGE_BLOCK}

  <!-- 5. THE LETTER -->
  <tr><td style="padding:14px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle()}">
      <tr><td style="padding:26px 26px 22px">
        <p style="margin:0 0 16px;${TYPE.subtitle}">{GREETING_LINE}</p>
        <p style="margin:0 0 14px;${TYPE.body}">My name is Mark Woodward, and I own an AI-powered web studio here in California. We build modern websites for local businesses like {BUSINESS_NAME} — and handle the marketing and advertising that goes with them — for roughly ten cents on the dollar compared to a traditional agency. We're able to do that because of how heavily we use today's best AI platforms to do the heavy lifting.</p>
        <p style="margin:0;${TYPE.body}">{RESEARCH_OPENER}</p>
        {STORY_BLOCK}
      </td></tr>
    </table>
  </td></tr>

  <!-- 6. THREE STEPS -->
  <tr><td style="padding:4px 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle({ background: PALETTE.subtle, shelf: PALETTE.line })}"><tr><td style="padding:20px 10px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed"><tr>
        <td width="33%" align="center" valign="top" style="padding:0 6px">
          <div style="font-size:26px;line-height:1">&#128064;</div>
          <div style="margin-top:8px;${TYPE.eyebrow};color:{ACCENT_LIGHT}">Step 1</div>
          <div style="margin-top:4px;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:700;color:${PALETTE.ink}">See your preview</div>
        </td>
        <td width="33%" align="center" valign="top" style="padding:0 6px">
          <div style="font-size:26px;line-height:1">&#9997;&#65039;</div>
          <div style="margin-top:8px;${TYPE.eyebrow};color:{ACCENT_LIGHT}">Step 2</div>
          <div style="margin-top:4px;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:700;color:${PALETTE.ink}">Sign up</div>
        </td>
        <td width="33%" align="center" valign="top" style="padding:0 6px">
          <div style="font-size:26px;line-height:1">&#128222;</div>
          <div style="margin-top:8px;${TYPE.eyebrow};color:{ACCENT_LIGHT}">Step 3</div>
          <div style="margin-top:4px;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:700;color:${PALETTE.ink}">Personal call</div>
        </td>
      </tr></table>
    </td></tr></table>
  </td></tr>

  <!-- 7. VIP CONCIERGE. Riley is the OWNER'S web person, never a bot pointed at
       their customers — the framing is the product, so it is stated plainly. -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle({ background: "{ACCENT_TINT}", line: "{ACCENT_TINT_LINE}", shelf: "{ACCENT_TINT_LINE}" })}"><tr><td style="padding:24px 26px 22px">
      <p style="margin:0 0 4px;${TYPE.eyebrow};color:{ACCENT_LIGHT}">&#127911; Included with every build</p>
      <p style="margin:0 0 14px;${TYPE.title}">Sign up and a real person calls you — personally.</p>
      {CLIENT_ID_VIP_LINE}
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        {VIP_ROWS}
      </table>
      <!-- ONE PRICE ACROSS EVERY SURFACE (2026-08-08). This card read $199
           while the step-1 proof email, which the same prospect received two
           days earlier, read $149 — so the follow-up raised the price on a
           business that had not answered yet. The owner's price is $149/mo
           with the $500 setup fee waived. -->
      <p style="margin:16px 0 0;padding-top:14px;border-top:1px solid {ACCENT_TINT_LINE};${TYPE.small}">And here's the part I think you'll really like: the moment you sign up, I'll personally give you a courtesy call to get you set up and answer any quick questions you have. I'll also introduce you to our full AI assistant suite — and I think it'll surprise you. For editing your site or getting work done for your business, you'll find it faster and easier to talk to than any human you've worked with before. It's there for you anytime.</p>
    </td></tr></table>
  </td></tr>

  <!-- 8. OFFER CARD -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle({ background: PALETTE.inkPanel, line: PALETTE.inkPanelLine, shelf: "#08080B", radius: 16 })}"><tr><td style="padding:28px 26px 26px">
      <p style="margin:0 0 12px;${TYPE.eyebrow};color:{ACCENT_DARK}">&#10022; It's already built. Here's the honest math.</p>
      <p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${PALETTE.inkPanelMuted}">A local agency quotes builds like this at $4,000–$8,000 upfront, then bills monthly on top.</p>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td valign="bottom" style="font-family:${FONT_STACK};font-size:46px;line-height:1;font-weight:800;letter-spacing:-.03em;color:${PALETTE.inkPanelInk};padding-right:10px">$149</td>
        <td valign="bottom" style="font-family:${FONT_STACK};font-size:14px;line-height:1.45;color:${PALETTE.inkPanelMuted};padding-bottom:4px">/month<br>No setup fee. Cancel anytime.</td>
      </tr></table>
      <div style="height:1px;background:${PALETTE.inkPanelLine};font-size:0;line-height:0;margin:22px 0 20px">&nbsp;</div>
      <p style="margin:0 0 14px;${TYPE.eyebrow};color:${PALETTE.inkPanelMuted}">Everything below is in the $149</p>
      {OFFER_FEATURE_GRID}
      {CHECKOUT_CTA_BLOCK}
    </td></tr></table>
  </td></tr>

  <!-- 9. LOW-FRICTION CTA -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle({ background: PALETTE.subtle, shelf: PALETTE.line })}"><tr><td style="padding:18px 22px">
      <p style="margin:0;${TYPE.small}"><b style="color:${PALETTE.ink};font-size:14px">Not ready to buy?</b> Totally fine. Reply "WALKTHROUGH" and I'll send you a 60-second video tour of your new site. No card, no call.</p>
    </td></tr></table>
  </td></tr>

  <!-- 10. SOCIAL PROOF -->
  {SOCIAL_PROOF_BLOCK}

  <!-- 11. DOMAIN LINE -->
  {DOMAIN_BLOCK}

  <!-- 12. SCARCITY -->
  {SCARCITY_BLOCK}

  <!-- 13. SIGNATURE -->
  <tr><td style="padding:8px 6px 0">
    <p style="margin:0 0 16px;${TYPE.body}">Take a look. Worst case, you saw a cool version of your site for free.</p>
    <!-- width="100%" is load-bearing: an auto-layout table sizes to its longest
         unbroken run, which at 375px is how a one-line sign-off drags the whole
         document into a horizontal scroll. -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%"><tr>
      <td width="4" style="width:4px;background:{ACCENT_BASE};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
      <td style="padding-left:14px">
        <p style="margin:0;font-family:${FONT_STACK};font-size:17px;line-height:1.35;font-weight:800;color:${PALETTE.ink}">— {SENDER_FIRST_NAME}</p>
        <p style="margin:3px 0 0;${TYPE.caption}">I build these one at a time, here in {SENDER_CITY}.</p>
        {SENDER_PHONE_LINE}
        {CLIENT_ID_SIGNATURE_LINE}
      </td>
    </tr></table>
  </td></tr>

  <!-- 14. FOOTER -->
  <tr><td style="padding:22px 6px 0">
    <p style="margin:0;${TYPE.caption}">Your current website is untouched. Want changes, or want the preview taken down? Just reply — a real person (me) reads every one.</p>
  </td></tr>

  {COMPLIANCE_FOOTER_BLOCK}

</table></td></tr></table>
</body></html>
`;

/**
 * THE FOLLOW-UP SHELL (added 2026-07-31).
 *
 * Steps 2 and 3 of sequence 1 — and every step of the warm/intake sequences —
 * are NOT the proof pitch. They are a short note whose copy already exists, in
 * full, in lib/email-templates.js, and which lib/email.js hands to this composer
 * as `bodyText`. Until now that parameter was passed and silently dropped (it
 * was not in the signature at all), so a follow-up rendered the entire step-1
 * proof email — offer card, before/after, VIP concierge and all — while the
 * plain-text half of the SAME message carried the two-paragraph follow-up. The
 * two halves of one email said different things.
 *
 * This shell renders the step copy verbatim and nothing else: the WSS mark, the
 * copy, the preview link (the text layer is link-free by design, so the HTML
 * carries it), and the compliance footer. There is deliberately no comparison
 * block here — a follow-up shows no "YOUR SITE TODAY" panel, so it makes no
 * claim about a screenshot.
 */
const FOLLOWUP_TEMPLATE = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PALETTE.page};font-family:${FONT_STACK}">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${PALETTE.page}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%">

  <!-- 1. HEADER LOGO -->
  {HEADER_LOGO_BLOCK}

  <!-- 2. THE STEP COPY (parity with the plain-text part) + the preview link.
       One card, because a follow-up is a short note and a note is one surface. -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle()}">
      <tr><td style="padding:5px 0 0;background:{ACCENT_BASE};font-size:0;line-height:0;border-radius:13px 13px 0 0">&nbsp;</td></tr>
      <tr><td style="padding:26px 26px 24px">
        {STEP_COPY_BLOCK}
        {PREVIEW_CTA_BLOCK}
      </td></tr>
    </table>
  </td></tr>

  {COMPLIANCE_FOOTER_BLOCK}

</table></td></tr></table>
</body></html>
`;

/**
 * A PARAMETER THIS COMPOSER DOES NOT READ IS DROPPED COPY.
 *
 * `bodyText` was passed by lib/email.js for weeks and ignored, because JS
 * destructuring a name that is not in the pattern is a silent no-op. The list
 * below is the composer's whole contract, and anything outside it now throws at
 * the call site instead of vanishing. Note this checks the TOP-LEVEL options
 * only: `cta` is deliberately a loose adapter bag whose job is to absorb legacy
 * and hostile field names and drop them, and `footer` is the compliance record.
 */
const COMPOSE_OPTION_KEYS = Object.freeze([
  "address", "afterImage", "beforeImage", "beforeUnavailable", "bodyText", "brandColor", "businessName",
  "checkoutUrl", "city", "clientId", "cta", "currentUrl", "customDomain",
  "deleteDate", "footer", "heroImage", "industry", "logoUrl", "ownerFirstName",
  "previewUrl", "rating", "reportUrl", "reviewCount", "senderCity",
  "senderFirstName", "senderName", "senderPhone", "snapshotImage", "unsubUrl",
]);
const COMPOSE_OPTION_KEY_SET = new Set(COMPOSE_OPTION_KEYS);

function assertKnownComposeOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("composeOutreachEmailV2: options must be a plain object");
  }
  const unknown = Object.keys(options).filter((key) => !COMPOSE_OPTION_KEY_SET.has(key));
  if (unknown.length) {
    throw new TypeError(
      `composeOutreachEmailV2: unknown option(s) ${unknown.sort().join(", ")}. `
      + "Every option must be read by the composer — an unread option is copy that "
      + "disappears from the email while the caller believes it shipped. Add it to "
      + "COMPOSE_OPTION_KEYS and render it, or stop passing it.",
    );
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function htmlUrl(value) {
  const s = String(value ?? "").trim();
  return /^https:\/\//i.test(s) ? s.replace(/"/g, "%22") : "";
}

function attrUrl(value) {
  return escapeHtml(htmlUrl(value));
}

/**
 * A Signal report URL we are willing to PRINT. Only our own estate — the
 * report is generated by us, about the prospect's own site, and the composer
 * must not become a way to place an arbitrary link in front of a prospect.
 */
function ourReportUrl(value) {
  // Host allowlist AND shape. A legacy row can hold
  // `callprep.wss-ai.com/report/<build-slug>` — our host, but an id the reports
  // table cannot store, so the page resolves to nothing. Host alone would have
  // printed 51 such links.
  return safeReportUrl(value);
}

function firstHttps(...values) {
  return values.find((value) => Boolean(htmlUrl(value))) || "";
}

/**
 * WHOSE SERVER IS THIS PICTURE ON? (added 2026-07-31)
 *
 * Under consent-first the email rendered no images at all, so it did not matter
 * that this composer would embed any https URL it was handed. Proof-first puts
 * pictures in the body, and the fields they come from — heroImage,
 * reviewSnapshotImage, oldSiteShot/newSiteShot — are PERSISTED prospect columns.
 * A row that ever captured a scraper URL (s0.wp.com/mshots was the real one)
 * would put a stranger's server inside a cold email: a remote fetch from the
 * recipient's mail client to a host we do not control, and a picture whose
 * contents nobody on our side has seen.
 *
 * So an <img> may only point at somewhere WE serve: wss-ai.com (or a subdomain
 * of it), the configured ghost origin that mints the signed proof-shot proxy
 * URLs, or the configured proof-asset bucket. Anything else resolves to "" and
 * the block that would have contained it is simply not rendered. Links are a
 * separate question and are handled by the callers' own identity gates — this
 * rule is about what the mail client is told to FETCH.
 */
function firstPartyImageOrigins() {
  return [process.env.GHOST_AGENCY_PUBLIC_URL, process.env.WSS_PROOF_ASSETS_BASE_URL]
    .map((value) => {
      const raw = String(value || "").trim();
      if (!/^https:\/\//i.test(raw)) return "";
      try {
        return new URL(raw).hostname.toLowerCase().replace(/\.$/, "");
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function firstPartyImage(value) {
  const url = htmlUrl(value);
  if (!url) return "";
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
  if (host === "wss-ai.com" || host.endsWith(".wss-ai.com")) return url;
  return firstPartyImageOrigins().includes(host) ? url : "";
}

// Kept for the `hasBrandColors` evidence sentence, which needs to know whether
// the value we were handed was a real colour at all. The FALLBACK is now the WSS
// brand accent rather than #d93025 — a hardcoded Google red was neither the
// client's colour nor ours, so an email with no measured logo colour shipped in
// a hue belonging to nobody. Rendering resolves through design.clientAccent().
function safeBrandColor(value) {
  const color = String(value ?? "").trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : PALETTE.accent;
}

function safeEmail(value) {
  const email = String(value ?? "").trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "";
}

// Only make the strong "confirmed address" claim for a bounded postal address.
// Intake can contain scraped Markdown map links or a heading/marketing sentence
// in the address slot. Strip a map-link wrapper, but fail closed on multiline
// copy, leftover markup/URLs, and values that do not resemble a street address.
function sanitizeBusinessAddress(value) {
  let address = String(value ?? "").replace(/\0/g, "").trim();
  if (!address || /[\r\n]/.test(address)) return "";

  const markdownLink = address.match(/^\[([^\]]{1,180})\]\(\s*https?:\/\/[^)\s]+(?:\s+"[^"]*")?\s*\)$/i);
  if (markdownLink) {
    address = markdownLink[1].trim();
  } else {
    address = address
      .replace(/\]\(\s*https?:\/\/[\s\S]*$/i, "")
      .replace(/^\[/, "")
      .trim();
  }

  // Scrapers commonly flatten contact bars into the address field, using
  // either a literal pipe or a Markdown-escaped pipe as the separator.
  // A pipe is not part of a postal address, so keep only the address segment.
  address = address
    .replace(/\s*(?:\\+\s*)?\|[\s\S]*$/, "")
    .trim();

  address = address.replace(/\s+/g, " ");
  if (
    !address
    || address.length > 180
    || /https?:\/\/|www\.|[\[\]{}<>]/i.test(address)
  ) return "";

  const streetAddress = /^\d{1,8}\s+[a-z0-9#.'’\- ]+\b(?:street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|court|ct|circle|cir|parkway|pkwy|highway|hwy|way|trail|trl|terrace|ter|place|pl)\b/i;
  const postOfficeBox = /^p\.?\s*o\.?\s+box\s+\d+\b/i;
  return streetAddress.test(address) || postOfficeBox.test(address) ? address : "";
}

function outreachEmailV2Enabled(env = process.env) {
  const raw = String(env.OUTREACH_EMAIL_V2 ?? "true").trim().toLowerCase();
  return !/^(0|false|off|no)$/.test(raw);
}

// SENDER identity in the header, never the prospect's logo. A cold email that
// opens with the recipient's own mark reads as a spoof, and the owner's
// 2026-07-27 note was explicit: the header carries the real wss-ai.com mark.
// The prospect's logo still earns its place lower down, as evidence.
const HEADER_LOGO_BLOCK = `<tr><td style="padding:0 6px 18px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle" style="padding-right:12px">
        <img src="${WSS_HEADER_LOGO_URL}" width="44" height="44" alt="WSS Labs" style="display:block;width:44px;height:44px;border:0;border-radius:12px">
      </td>
      <td valign="middle">
        <span style="font-family:${FONT_STACK};font-size:16px;font-weight:800;color:${PALETTE.ink};letter-spacing:-.01em">WSS Labs</span><br>
        <span style="font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${PALETTE.muted}">AI-powered web studio · California</span>
      </td>
    </tr></table>
  </td></tr>`;

// THE OPT-OUT IS NOT DECORATION (restored 2026-07-31).
//
// The plain-text footer built in lib/email.js complianceFooter() has always
// carried the exact sentence below; the HTML shell lost it when the template
// was rewritten for proof-first, so every rendered proof email went out with a
// postal address and an Unsubscribe link but no STOP promise. That is a
// COMPLIANCE invariant, not a consent-first policy artifact: the promise is
// the same whether the email offers to build a site or shows one already
// built, and the two layers of the same email must not disagree about it.
// The wording is quoted verbatim in tests on purpose — it is a promise made to
// strangers, so it is a fixed string, not copy.
//
// Shared by BOTH shells (2026-07-31). A follow-up is cold outreach too, so it
// owes the reader the identical opt-out; building it once is what guarantees
// the two shells cannot drift apart the way the text and HTML halves did.
//
// AND SHARED WITH THE TEXT HALF (2026-07-31). Restoring the sentence here by
// re-typing it left two literals — this file's and lib/email.js's — with
// nothing connecting them, which is the arrangement that lost the promise in
// the first place. The sentence now has exactly one definition, in
// lib/opt-out-promise.js, and this shell renders it rather than restating it.
const STOP_PROMISE_LINE = optOutPromiseHtml();

function complianceFooterBlock({ footer = {}, unsubUrl = "", business = "" } = {}) {
  const unsubscribeHref = attrUrl(unsubUrl);
  const supportEmail = safeEmail(footer.support);
  const linkStyle = `color:${PALETTE.muted};text-decoration:underline`;
  const footerParts = [
    unsubscribeHref ? `<a href="${unsubscribeHref}" style="${linkStyle}">Unsubscribe</a>` : "Reply “unsubscribe”",
    supportEmail ? `<a href="mailto:${escapeHtml(supportEmail)}" style="${linkStyle}">${escapeHtml(supportEmail)}</a>` : "",
    footer.postal ? escapeHtml(footer.postal) : "",
  ].filter(Boolean).join(" · ");
  const shell = (inner) => `<tr><td style="padding:24px 6px 0">
    <div style="border-top:1px solid ${PALETTE.line};padding-top:18px">
      ${inner}
    </div>
  </td></tr>`;
  return footerParts
    ? shell(`${STOP_PROMISE_LINE}
      <p style="margin:0;font-family:${FONT_STACK};font-size:11.5px;line-height:1.6;color:${PALETTE.muted}">This message is from WSS Labs about the website preview prepared for ${business}. ${footerParts}</p>`)
    : shell(STOP_PROMISE_LINE);
}

/**
 * The step copy, rendered as the email's body. Blank-line separated paragraphs
 * become <p>; a single newline inside one becomes <br> so the "What's included"
 * style lists in the templates keep their shape. Escaped throughout: this text
 * carries merged prospect fields.
 *
 * Returns CELL CONTENT, not a table row: the follow-up shell wraps it in the
 * same raised card the proof shell uses, so the two lanes look like one product.
 * The first paragraph is set as lead copy — a two-paragraph note with no opening
 * beat is the flattest thing an email can be.
 */
function stepCopyBlock(bodyText) {
  const paragraphs = String(bodyText ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "";
  return paragraphs
    .map((paragraph, index) =>
      `<p style="margin:0 0 ${index === paragraphs.length - 1 ? "20" : "14"}px;${index === 0 ? TYPE.lead : TYPE.body}">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n        ");
}

/**
 * Resolve the {ACCENT_*} tokens against one client's accent family.
 *
 * Runs LAST, over the fully assembled document, because several blocks are
 * built as strings long before the family is known and the template itself
 * carries tokens inside style attributes. One pass, one source of truth, and no
 * block can quietly opt out of the client's colour.
 */
function applyAccentTokens(html, accent) {
  return String(html)
    .replaceAll("{ACCENT_BASE}", accent.base)
    .replaceAll("{ACCENT_LIGHT}", accent.onLight)
    .replaceAll("{ACCENT_DARK}", accent.onDark)
    .replaceAll("{ACCENT_TINT_LINE}", accent.tintLine)
    .replaceAll("{ACCENT_TINT}", accent.tint);
}

/**
 * A button that survives Gmail. `<a>` alone is not a button — Outlook ignores
 * padding on an anchor and Gmail's mobile app under-taps it — so the fill lives
 * on a `<td>` (with a `bgcolor` attribute for the clients that drop the style)
 * and the anchor is display:block inside it.
 *
 * The label colour is `accent.buttonFg`, chosen by contrast against
 * `accent.buttonBg`: a client whose logo is pale yellow gets ink-on-yellow, and
 * one whose logo is navy gets white-on-navy. Neither is a guess and neither can
 * come out unreadable.
 */
function ctaButton(href, label, accent, { block = false } = {}) {
  const width = block ? ' width="100%"' : "";
  const widthStyle = block ? "width:100%;" : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0"${width} style="${widthStyle}border-collapse:separate">
          <tr><td align="center" bgcolor="${accent.buttonBg}" style="background:${accent.buttonBg};border-radius:10px;padding:15px 28px">
            <a href="${href}" style="display:block;font-family:${FONT_STACK};font-size:15.5px;line-height:1.2;font-weight:800;letter-spacing:-.01em;color:${accent.buttonFg};text-decoration:none">${label} &rarr;</a>
          </td></tr>
        </table>`;
}

/**
 * The offer's included list, as a two-column icon grid on the dark panel.
 *
 * The icon is its own `<td>`, NOT a `position:absolute` span — Gmail strips
 * `position`, which is why the old list rendered as a glyph shoved into the
 * text flow behind a 24px indent that no longer had anything to clear.
 *
 * `label` is trusted markup by construction: every entry is a literal in this
 * module or a value already escaped by the caller. Nothing here escapes, and
 * nothing here should be handed raw prospect input.
 */
function featureGrid(items) {
  const cell = (item) => {
    if (!item) return `<td width="50%" style="width:50%">&nbsp;</td>`;
    const [icon, label] = item;
    return `<td width="50%" valign="top" style="width:50%;padding:0 8px 14px 0">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
              <td width="26" valign="top" style="width:26px;font-size:15px;line-height:1.45;padding-top:1px">${icon}</td>
              <td valign="top" style="font-family:${FONT_STACK};font-size:13.5px;line-height:1.45;color:${PALETTE.inkPanelInk}">${label}</td>
            </tr></table>
          </td>`;
  };
  let rows = "";
  for (let index = 0; index < items.length; index += 2) {
    rows += `<tr>${cell(items[index])}${cell(items[index + 1])}</tr>`;
  }
  // table-layout:fixed pins the columns to 50/50. Under auto layout one long
  // token — a business name, a domain — sets the column's min-content width and
  // the grid drags the whole document into a horizontal scroll on a phone.
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed">${rows}</table>`;
}

/**
 * The concierge rows.
 *
 * RILEY IS THE OWNER'S WEB PERSON, NOT A BOT POINTED AT THEIR CUSTOMERS. That
 * distinction is the product, and an email that blurs it sells the wrong thing
 * and undersells the right one, so the row says which it is in as many words.
 * The phrase "you can CALL anytime" is pinned by tests — it is the sentence
 * the whole offer turns on. HONESTY PASS 2026-09-02, same law as the V3 truth
 * pass and the lib/email.js footer fix of 2026-08-08: the Riley line is a VAPI
 * VOICE number with no SMS provisioning, so "CALL or TEXT" promised a channel
 * that answers nothing, and "Change my video." named a request the executor
 * has no verb for — classifyRequest() sends it to the one refusal, which is
 * exactly the promise a live call would have to un-say. Every example in the
 * row now classifies as a quick edit (verified against lib/riley-capabilities.js).
 */
function vipRows(senderFirstName) {
  const rows = [
    ["\u{1F4DE}", `After you sign up, ${escapeHtml(senderFirstName)} personally reaches out for a one-on-one call to walk through your site.`],
    ["\u{1F4AC}", "You get Riley, your own AI web person you can CALL anytime — <b style=\"color:" + PALETTE.ink + "\">yours, not a chatbot for your customers</b>. “Make the phone number bigger.” “Reword that headline.” “Swap that photo.” No ticket system, no emailing changes in."],
    ["✏️", "“Want the headline changed? Call and it's done while we talk.”"],
  ];
  return rows.map(([icon, html]) => design.iconRow({ icon, html, pad: "6px 0" })).join("\n        ");
}

function composeOutreachEmailV2(options = {}) {
  assertKnownComposeOptions(options);
  let { footer = {}, cta = {}, businessName = "", ownerFirstName = "", city = "", industry = "", rating = "", reviewCount = "", address = "", customDomain = "", previewUrl = "", deleteDate = "", logoUrl = "", heroImage = "", currentUrl = "", beforeImage = "", afterImage = "", beforeUnavailable = "", snapshotImage = "", checkoutUrl = "", reportUrl = "", brandColor = "", senderFirstName = "", senderName = "", senderCity = "Mission Viejo, CA", senderPhone = "", clientId = "", unsubUrl = "", bodyText = "" } = options;
  // The phone is ENV-ONLY and never hardcoded (owner directive 2026-07-22): a
  // literal number in source outlives the number itself and gets mailed to
  // strangers. Absent phone => the call line is omitted, never guessed.
  // First name is derived from whatever the caller passes as the full name.
  senderFirstName = String(senderFirstName || senderName || cta.senderName || "Mark").trim().split(/\s+/)[0];
  // email.js passes {footer, cta}. Keep this adapter exhaustive so the visual
  // template never renders a blank token when the evidence already exists.
  businessName = businessName || cta.businessName || "your business";
  ownerFirstName = ownerFirstName || cta.ownerFirstName || "there";
  city = city || cta.city || "";
  industry = industry || cta.industry || "";
  rating = rating || cta.rating || "";
  reviewCount = reviewCount || cta.reviewCount || "";
  address = address || cta.address || "";
  customDomain = customDomain || cta.customDomain || "";
  // ORDER FIXED 2026-07-31: the real preview wins over a legacy reveal token.
  // This chain used to read (previewUrl, cta.revealUrl, cta.previewUrl), so a
  // stale `reveal_url` column — the retired build-on-click mechanic — outranked
  // the actual built site and became the link in the email. lib/email.js passes
  // both fields set to the same value, which is exactly why the inversion was
  // invisible; any other caller would have shipped the wrong URL.
  previewUrl = firstHttps(previewUrl, cta.previewUrl, cta.revealUrl);
  checkoutUrl = firstHttps(checkoutUrl, cta.checkoutUrl);
  // THE SIGNAL REPORT LINK — ours only. The owner asked for the report to ride
  // along with the proof (2026-08-05); until then this value was accepted and
  // silently dropped. It is now RENDERED, which makes it an injection surface,
  // so only a report on our own wss-ai.com estate is allowed through. A caller
  // handing us any other host still gets refused exactly as before.
  reportUrl = ourReportUrl(firstHttps(reportUrl, cta.reportUrl));
  deleteDate = deleteDate || cta.expiryDate || "";
  // The expiry arrives as a raw ISO timestamp and shipped verbatim: the owner's
  // settled proof email read "live on my server until 2026-08-05T02:28:35.347Z".
  // A machine string inside warm first-person copy breaks the whole voice.
  // Render it as a plain date; anything unparseable passes through untouched.
  {
    const parsed = Date.parse(deleteDate);
    if (Number.isFinite(parsed) && /\d{4}-\d{2}-\d{2}T/.test(String(deleteDate))) {
      deleteDate = new Date(parsed).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles",
      });
    }
  }
  logoUrl = firstHttps(logoUrl, cta.logoUrl);
  heroImage = firstHttps(heroImage, cta.heroImage, cta.newSiteGif, cta.newSiteShot);
  currentUrl = firstHttps(currentUrl, cta.currentUrl, cta.currentWebsite);
  beforeImage = firstHttps(beforeImage, cta.beforeImage, cta.oldSiteShot);
  afterImage = firstHttps(afterImage, cta.afterImage, cta.newSiteShot);
  // The disclosed-absence state: when the before IMAGE is absent because the
  // prospect's old site was classified unavailable, the comparison renders a
  // disclosure panel in its place (see proofReadiness). Absent state and
  // absent image together still mean NO comparison block — never an empty box.
  beforeUnavailable = namedBeforeUnavailable(beforeUnavailable, cta.beforeUnavailable, cta.beforeUnavailableReason);
  snapshotImage = firstHttps(snapshotImage, cta.snapshotImage, cta.reviewSnapshotImage);
  brandColor = brandColor || cta.brandColor || "";
  clientId = clientId || cta.clientId || cta.referenceCode || "";
  unsubUrl = firstHttps(unsubUrl, footer.unsubscribe);

  const business = escapeHtml(businessName);
  const location = escapeHtml(city);
  const vertical = escapeHtml(industry || "local service");
  // THE ACCENT IS THE CLIENT'S OWN, MADE LEGIBLE — not merely "a hex we were
  // handed". `brandColor` is measured off the client's logo bytes upstream
  // (lib/mirror-engine/brand-assets.js measureAccent), so it can be any colour
  // a logo happens to be, including ones that vanish on white or on the dark
  // offer panel. clientAccent() keeps their hue and returns the variant that
  // clears 4.5:1 on each surface, plus a button pair whose label is chosen for
  // its own fill. See lib/wss-email-design.js.
  const accentHex = safeBrandColor(brandColor);
  const accent = design.clientAccent(accentHex);
  const previewHref = attrUrl(previewUrl);

  // ---- STEP SELECTION. WHICH EMAIL IS THIS? ----
  // `bodyText` present => the caller has already rendered this step's own copy
  // (lib/email-templates.js) and this is NOT the step-1 proof pitch. Render that
  // copy and stop, rather than falling through into the proof template and
  // shipping HTML that contradicts the plain-text half of the same message.
  const stepCopy = stepCopyBlock(bodyText);
  if (stepCopy) {
    const followupCta = previewHref ? ctaButton(previewHref, "Open your live preview", accent) : "";
    let followup = FOLLOWUP_TEMPLATE;
    followup = followup.replaceAll("{HEADER_LOGO_BLOCK}", HEADER_LOGO_BLOCK);
    followup = followup.replaceAll("{STEP_COPY_BLOCK}", stepCopy);
    followup = followup.replaceAll("{PREVIEW_CTA_BLOCK}", followupCta);
    followup = followup.replaceAll(
      "{COMPLIANCE_FOOTER_BLOCK}",
      complianceFooterBlock({ footer, unsubUrl, business }),
    );
    return applyAccentTokens(followup, accent);
  }

  const logoSrc = attrUrl(logoUrl);
  const currentHref = attrUrl(currentUrl);
  // Images are first-party only — see firstPartyImage(). `logoSrc` above is NOT
  // an <img> src anywhere in this template; it is evidence copy ("matched the
  // business logo"), which is why it is not filtered here.
  const heroSrc = escapeHtml(firstPartyImage(heroImage));
  const beforeSrc = escapeHtml(firstPartyImage(beforeImage));
  const afterSrc = escapeHtml(firstPartyImage(afterImage));
  const snapshotSrc = escapeHtml(firstPartyImage(snapshotImage));
  const reference = escapeHtml(clientId);
  const addressText = sanitizeBusinessAddress(address);
  const customDomainText = String(customDomain || "").trim();
  const ratingNumber = Number(rating);
  const reviewCountNumber = Number(reviewCount);
  // v4 audit fix: review counts render rounded DOWN with a "+" — "115+" is
  // strictly true for a business with 116 reviews; rounding up would assert
  // reviews that do not exist.
  const reviewCountDisplay = Number.isFinite(reviewCountNumber) && reviewCountNumber >= 5
    ? `${Math.floor(reviewCountNumber / 5) * 5}+`
    : String(Math.trunc(reviewCountNumber) || "");
  const hasRating = Number.isFinite(ratingNumber) && ratingNumber > 0 && ratingNumber <= 5;
  const hasReviewCount = Number.isFinite(reviewCountNumber) && reviewCountNumber > 0;
  const hasReviews = hasReviewCount || cta.hasReviews === true;
  const hasBusinessPhotos = cta.hasBusinessPhotos === true || cta.hasPhotos === true;
  const hasBrandColors = safeBrandColor(brandColor) === String(brandColor || "").trim();

  const linkedImage = (image, href, alt, width, style) => {
    const img = `<img src="${image}" width="${width}" alt="${escapeHtml(alt)}" style="${style}">`;
    return href ? `<a href="${href}">${img}</a>` : img;
  };

  // industryForSubject: "I came across Diamond State Plumbing while researching
  // plumbing in Little Rock" says the trade twice — when the name already
  // carries it, the sentence researches "local businesses" instead.
  const researchTrade = industryForSubject(businessName, industry);
  const researchParts = [researchTrade ? escapeHtml(researchTrade) : "local businesses", city ? `in ${location}` : ""].filter(Boolean).join(" ");
  const researchOpener = `I came across ${business} while researching ${researchParts}, and I went ahead and rebuilt the site as a free live preview so you could actually see it rather than just imagine it:`;
  const previewCtaBlock = previewHref
    ? `${ctaButton(previewHref, "Open your live preview", accent)}
        <p style="margin:12px 0 0;${TYPE.caption}">It's already online — takes 5 seconds. Nothing to install, nothing to sign.</p>`
    : "";
  const heroImageBlock = heroSrc
    ? `<tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle({ radius: 14 })}"><tr><td style="padding:10px">
      ${linkedImage(heroSrc, previewHref, `${businessName} — rebuilt website preview`, 580, `display:block;width:100%;border-radius:8px;border:1px solid ${PALETTE.line};height:auto`)}
    </td></tr></table>
  </td></tr>`
    : "";

  const evidence = [];
  if (hasRating && hasReviewCount) evidence.push(`found its ${ratingNumber.toFixed(1)}-star Google rating across ${reviewCountDisplay} reviews`);
  else if (hasReviewCount) evidence.push(`found ${reviewCountDisplay} Google reviews`);
  else if (hasRating) evidence.push(`found its ${ratingNumber.toFixed(1)}-star Google rating`);
  if (addressText) evidence.push(`confirmed the listed business address at ${escapeHtml(addressText)}`);
  if (logoSrc) evidence.push("matched the business logo");
  if (hasBrandColors) evidence.push("carried the brand colors into the redesign");
  if (hasBusinessPhotos) evidence.push("used the available business photos");
  const evidenceSentence = evidence.length ? `Building it, I ${evidence.join(", ")}.` : "";
  const reputationLine = hasReviewCount
    ? `<p style="margin:14px 0 0;font-family:${FONT_STACK};font-size:15px;line-height:1.55;font-weight:700;color:${PALETTE.ink}">${business} has ${reviewCountDisplay} Google reviews${city ? ` in ${location}` : ""}. The website should look like the business those customers are describing.</p>`
    : "";
  // The evidence sits in an accent-ruled inset rather than another grey
  // paragraph: it is the one part of the letter that is checkable, so it should
  // not be indistinguishable from the part that is just prose.
  const storyBlock = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;margin-top:20px"><tr>
          <td width="4" style="width:4px;background:{ACCENT_BASE};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
          <td style="padding-left:16px">
            <p style="margin:0;${TYPE.body}">${evidenceSentence.trim() || `Everything on it came from your own listing and site — nothing invented.`}</p>
            ${reputationLine}
          </td>
        </tr></table>`;

  // THE HERO MOMENT. Two shots, side by side, on the dark panel, directly under
  // the headline card — this is the only block in the email that proves
  // anything, and it used to be the eighth thing the reader met.
  //
  // The captions are TEXT, never baked into the images: with images blocked
  // (Gmail's default for an unknown sender) the reader still gets "Before →
  // After", "Your site today", "Your new site — live now", the alt text, and two
  // working links. The block degrades to a labelled comparison instead of two
  // broken-image icons.
  const shotPanel = (src, href, alt, caption, captionColor, badge) => `<td width="50%" valign="top" style="width:50%;padding:0 6px">
        <p style="margin:0 0 8px;${TYPE.eyebrow};color:${captionColor}">${badge}</p>
        ${linkedImage(src, href, alt, 268, `display:block;width:100%;max-width:100%;height:auto;border-radius:8px;border:1px solid ${PALETTE.inkPanelLine}`)}
        <p style="margin:10px 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:700;color:${PALETTE.inkPanelInk}">${caption}</p>
      </td>`;
  // The disclosure panel that stands in for a missing before image when the
  // capture lane named the absence (before_unavailable:<reason>). No image, no
  // link — a dashed, honest placeholder where "YOUR SITE TODAY" would sit, so
  // the comparison block still renders and still tells the truth.
  const disclosureCell = `<td width="50%" valign="top" style="width:50%;padding:0 6px">
        <p style="margin:0 0 8px;${TYPE.eyebrow};color:${PALETTE.inkPanelMuted}">Now</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border:1px dashed ${PALETTE.inkPanelLine};border-radius:8px"><tr><td style="padding:20px 12px;text-align:center">
          <p style="margin:0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${PALETTE.inkPanelMuted}">Your previous online presence was unavailable for capture when this comparison was prepared.</p>
        </td></tr></table>
        <p style="margin:10px 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.4;font-weight:700;color:${PALETTE.inkPanelInk}">Your site today</p>
      </td>`;
  const comparisonBlock = (beforeSrc && afterSrc) || (afterSrc && beforeUnavailable)
    ? `<tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle({ background: PALETTE.inkPanel, line: PALETTE.inkPanelLine, shelf: "#08080B", radius: 16 })}"><tr><td style="padding:24px 18px 22px">
      <p style="margin:0 0 4px;${TYPE.eyebrow};color:{ACCENT_DARK};text-align:center">Before &nbsp;→&nbsp; After</p>
      <p style="margin:0 0 20px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${PALETTE.inkPanelMuted};text-align:center">Same business. Same phone number.${beforeSrc ? " Tap either one." : ""}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed"><tr>
      ${beforeSrc ? shotPanel(beforeSrc, currentHref, `${businessName} — current site`, "Your site today", PALETTE.inkPanelMuted, "Now") : disclosureCell}
      ${shotPanel(afterSrc, previewHref, `${businessName} — rebuilt site`, "Your new site — live now", "{ACCENT_DARK}", "After")}
      </tr></table>
    </td></tr></table>
  </td></tr>`
    : "";

  // Evidence rows for the offer grid: what of THEIRS actually made it into the
  // build. Each is conditional on the thing existing — an absent fact is an
  // absent row, never a softened one.
  const proofRows = [
    hasBusinessPhotos ? ["\u{1F4F7}", "Available business photos — placed in the preview"] : null,
    logoSrc ? ["\u{1F3A8}", "Your logo — matched in the preview"] : null,
    hasReviews ? ["⭐", "Verified review proof — reflected where available"] : null,
    addressText ? ["\u{1F4CD}", "Listed contact details — carried into the site"] : null,
  ].filter(Boolean);
  if (!proofRows.length) proofRows.push(["\u{1F3A8}", "Your business content — organized in a polished, mobile-first layout"]);

  // NO PAYMENT LINK IN A COLD EMAIL (2026-07-31).
  //
  // This used to render "→ Launch my site" + "Secured by Stripe" whenever a
  // checkoutUrl was handed in. Proof-first did not change that rule and neither
  // does anything else: the first contact shows the prospect their site, it does
  // not ask a stranger for a card. The only caller (lib/email.js) already
  // withholds checkoutUrl, so this branch was unreachable in the live path — and
  // an unreachable path that mints a payment link into cold outreach is exactly
  // the kind of thing that gets wired up by accident later. `checkoutUrl` is
  // still accepted by the signature and deliberately ignored, so no caller
  // breaks and no caller can resurrect it by passing the field.
  const checkoutCtaBlock = previewHref
    ? `<div style="margin-top:22px">${ctaButton(previewHref, "Review my site", accent, { block: true })}</div>`
    : "";

  const socialProofBlock = snapshotSrc && hasReviews
    ? `<tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle()}"><tr><td style="padding:22px 22px 18px">
      <p style="margin:0 0 14px;${TYPE.eyebrow};color:{ACCENT_LIGHT}">${city ? `What ${location} says about ${business}` : `Customer review proof for ${business}`}</p>
      <img src="${snapshotSrc}" width="556" alt="${business} — Google review snapshot" style="display:block;width:100%;max-width:100%;height:auto;border-radius:8px;border:1px solid ${PALETTE.line}">
    </td></tr></table>
  </td></tr>`
    : "";

  const domainBlock = customDomainText
    ? `<tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle({ background: PALETTE.inkPanel, line: PALETTE.inkPanelLine, shelf: "#08080B", radius: 12 })}"><tr><td style="padding:16px 20px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="18" valign="middle" style="width:18px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${PALETTE.accent};font-size:0;line-height:0">&nbsp;</span></td>
        <td valign="middle" style="font-family:${FONT_STACK};font-size:13.5px;line-height:1.5;color:${PALETTE.inkPanelMuted}"><b style="color:${PALETTE.inkPanelInk};font-size:15px">${escapeHtml(customDomainText)}</b><br>Custom domain setup included</td>
      </tr></table>
    </td></tr></table>
  </td></tr>`
    : "";

  // THE SCARCITY COUNTDOWN IS RETIRED (2026-07-31).
  //
  // It read: "this preview is live on my server until <date>. After that it
  // comes down and I delete it — I don't keep backups." Three problems, none of
  // which proof-first fixes:
  //   · it contradicts the footer of this very email, which invites the reader
  //     to reply if they want the preview taken down;
  //   · nothing in the system actually deletes a mirror on that date, so it is a
  //     promise about our own behaviour that we do not keep;
  //   · the date arrived as a persisted `preview_expires_at`, i.e. a stale row
  //     could put a date in the past into a freshly composed email.
  // `deleteDate` is still parsed above (so a legacy ISO value cannot leak as a
  // machine string anywhere else) and is now simply never rendered.
  const scarcityBlock = "";

  // THE OFFER LIST IS NOW A GRID (2026-07-31). It was thirteen identical
  // single-column rows at 12.5px, each an emoji hung off a `position:absolute`
  // span that Gmail deletes — the definition of a flat list. Two columns, an
  // icon cell of its own, and 13.5px copy make it scannable in the two seconds
  // it actually gets. Every label is byte-for-byte the copy that shipped
  // before; only the arrangement changed.
  const localResearchLine = `${city ? `${location} ` : ""}${industry === "plumbing" ? "plumbing competitor &amp; search research — built into your pages" : industry === "roofing" ? "roofing competitor &amp; search research — built into your pages" : `${vertical} competitor &amp; search research — built into your pages`}`;
  const offerFeatures = [
    ...proofRows,
    ["\u{1F3AC}", heroSrc ? `A visual hero, built for ${business}` : `A polished, mobile-first preview for ${business}`],
    ["\u{1F399}\u{FE0F}", "Voice search &amp; AI upgrades — included"],
    ["\u{1F4CD}", "\"Near me\" upgrades — included"],
    ["\u{1F4C7}", "Directory indexing — included"],
    ["\u{1F5FA}\u{FE0F}", "Google Maps &amp; Apple Maps registry — included"],
    ["\u{1F50D}", localResearchLine],
    ["\u{1F4E5}", "Lead funnel widgets — lead capture straight to whatever email you want"],
    ["\u{1F4F1}", "WSS Connect — all your social accounts in one feed, built in"],
    ["\u{1F512}", "Hosting, SSL, lead capture &amp; unlimited edits"],
    ["\u{1F310}", "Custom domain setup — included"],
  ];

  let h = TEMPLATE;
  h = h.replaceAll("{HEADER_LOGO_BLOCK}", HEADER_LOGO_BLOCK);
  h = h.replaceAll("{RESEARCH_OPENER}", researchOpener);
  h = h.replaceAll("{PREVIEW_CTA_BLOCK}", previewCtaBlock);
  h = h.replaceAll("{HERO_IMAGE_BLOCK}", heroImageBlock);
  h = h.replaceAll("{STORY_BLOCK}", storyBlock);
  h = h.replaceAll("{COMPARISON_BLOCK}", comparisonBlock);
  h = h.replaceAll("{VIP_ROWS}", vipRows(senderFirstName));
  h = h.replaceAll("{CLIENT_ID_VIP_LINE}", reference ? `<p style="margin:0 0 14px;${TYPE.caption}">Your Client ID: <b style="color:{ACCENT_LIGHT}">${reference}</b> — mention this when you call Riley.</p>` : "");

  // The Signal report link. One row, one sentence, one link — deliberately
  // plain so the layout can be restyled without unpicking logic. Absent report
  // collapses the whole row.
  h = h.replaceAll("{SIGNAL_REPORT_BLOCK}", reportUrl
    ? `<tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle({ background: "{ACCENT_TINT}", line: "{ACCENT_TINT_LINE}", shelf: "{ACCENT_TINT_LINE}" })}"><tr><td style="padding:22px 26px">
      <p style="margin:0 0 4px;${TYPE.eyebrow};color:{ACCENT_LIGHT}">Your free visibility report</p>
      <p style="margin:0 0 12px;${TYPE.body}">I scored your current site the way a customer and a search engine see it — speed, security, how you show up on Google, and what a phone visitor hits first.</p>
      <a href="${escapeHtml(reportUrl)}" style="${TYPE.body};font-weight:700;color:{ACCENT_LIGHT};text-decoration:underline">Read your report</a>
    </td></tr></table>
  </td></tr>`
    : "");
  h = h.replaceAll("{OFFER_FEATURE_GRID}", featureGrid(offerFeatures));
  h = h.replaceAll("{CHECKOUT_CTA_BLOCK}", checkoutCtaBlock);
  h = h.replaceAll("{SOCIAL_PROOF_BLOCK}", socialProofBlock);
  h = h.replaceAll("{DOMAIN_BLOCK}", domainBlock);
  h = h.replaceAll("{SCARCITY_BLOCK}", scarcityBlock);
  // The Client ID already appears once, with the reason it matters ("mention
  // this when you call Riley"). Printing it again in the signature was
  // the second literal repeat the owner spotted, and it carried no new
  // information — one statement, in the place where it is useful.
  h = h.replaceAll("{CLIENT_ID_SIGNATURE_LINE}", "");
  h = h.replaceAll("{COMPLIANCE_FOOTER_BLOCK}", complianceFooterBlock({ footer, unsubUrl, business }));
  // "Hi there at Ready Roofing," is what a mail-merge sounds like when it has no
  // name. Address the business itself instead — natural, and it never implies we
  // know an owner we do not.
  const ownerName = String(ownerFirstName || "").trim();
  const namedOwner = ownerName && !/^(there|owner|team|info|admin|manager)$/i.test(ownerName);
  h = h.replaceAll("{GREETING_LINE}", namedOwner
    ? `Hi ${escapeHtml(ownerName)} at ${business},`
    : `Hi ${business} team,`);
  h = h.replaceAll("{BUSINESS_NAME}", business);
  h = h.replaceAll("{CITY}", location);
  h = h.replaceAll("{VERTICAL}", vertical);
  h = h.replaceAll("{SENDER_FIRST_NAME}", escapeHtml(senderFirstName));
  h = h.replaceAll("{SENDER_CITY}", escapeHtml(senderCity));
  const senderPhoneText = String(senderPhone || "").trim();
  h = h.replaceAll("{SENDER_PHONE_LINE}", senderPhoneText
    ? `<p style="margin:6px 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${PALETTE.muted}">\u{1F4F1} Call or text me: ${escapeHtml(senderPhoneText)}</p>`
    : "");
  // Accent tokens resolve LAST, so every block above — including the ones built
  // as strings before the accent family existed — lands on the same client hue.
  return applyAccentTokens(h, accent);
}

// v4 subject rotation (owner walkthrough 2026-08-12; replaces the v3 pool).
//
// THE OLD POOL FAILED HIS TWO RULES AT ONCE. "quick one about your plumbing
// site" was lowercase (reads as mail-merge, not a sentence a person wrote) and
// it sold nothing — a subject line gets "five or ten seconds to grab their
// attention" and that one spent them on the word "quick". His reference is
// CarsForSale's "Don't gamble with your inventory": sell a feeling, not a fact.
// The feeling this product earns honestly is the winning lottery ticket — the
// work is already DONE, it is theirs, and looking costs nothing.
//
// EVERY VARIANT CARRIES {Business Name}. Gmail's mobile list view shows ~35-40
// characters; the name is the only word that earns the open, so no variant may
// spend that window without it. Properly capitalized: sentence case, their
// name as written.
//
// NO {industry} TOKEN IN THE POOL, ON PURPOSE. "Diamond State Plumbing —
// plumbing in Little Rock" says "plumbing" twice, because half of America's
// trade businesses carry their trade in their name. A subject that needs the
// trade word must go through industryForSubject() below, which drops it when
// the name already says it — but the safest sentence is one that never needs
// the word, and none of these do.
// TAIL BUDGETS ARE PART OF THE COPY. SUBJECT_MAX is 62 and the over-length
// guard shortens the NAME, so every character a tail spends comes out of the
// business name that earns the open. The longest tail here is 39 characters,
// which keeps a 23-character name ("Austin Air Conditioning") intact.
const SUBJECT_VARIANTS = [
  "{Business Name}, your new website is ready",
  "We already built {Business Name} a new website",
  "{Business Name}, your new website is live. Take a look",
];

/**
 * The trade word, only when the business name does not already carry it.
 *
 * "Diamond State Plumbing" + "plumbing" -> "" (the name says it; saying it
 * again reads as a bot). "Riverside Services" + "plumbing" -> "plumbing".
 * Word-run containment, same normalization as the redundant-city guard below,
 * so "Plumbing" in the name matches trade "plumbing" but "Temperature Pros"
 * does not match "hvac". Multi-word trades ("air conditioning") match as a
 * run. A one-character overlap can never fire because trades are real words.
 */
function industryForSubject(businessName, industry) {
  const simplify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const name = simplify(businessName);
  const trade = simplify(industry);
  if (!trade) return "";
  if (name && new RegExp(`(^| )${trade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(name)) return "";
  return String(industry).trim();
}

// Gmail truncates the subject in the list view. Desktop shows roughly 70
// characters, the mobile app closer to 35-40. 62 keeps the whole line visible
// on desktop and puts the business name — the only part that earns the open —
// inside the mobile window.
const SUBJECT_MAX = 62;

/**
 * Two guards, both cases seen in real sends:
 *   · "Austin Air Conditioning in Austin" — the city is already IN the name, so
 *     the appended "in {city}" reads like a bot wrote it. Drop it.
 *   · An overlong name pushes the hook past Gmail's cut. Trim at a word
 *     boundary rather than mid-word.
 */
function applySubjectGuards(subject, { businessName = "", city = "" } = {}) {
  let out = String(subject || "");
  const simplify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nameWords = simplify(businessName);
  const cityWords = simplify(city);

  // Redundant-city guard: only when the name genuinely contains the city as a
  // whole word run ("Austin" in "Austin Air Conditioning", not "Tempe" inside
  // "temperature").
  if (cityWords && nameWords && new RegExp(`(^| )${cityWords}( |$)`).test(nameWords)) {
    out = out.replace(/\s+in\s+\{city\}/gi, "").replace(new RegExp(`\\s+in\\s+${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "");
  }

  // Any city token that never got substituted (no city on file) must not ship.
  out = out.replace(/\s+in\s+\{city\}/gi, "").replace(/\{city\}/gi, "").replace(/\s{2,}/g, " ").trim();

  // Over-length: shorten the BUSINESS NAME, never the hook. Chopping the tail
  // turns "Lori Fowler Luxury Real Estate ... — did I get this right?" into a
  // bare truncated name with no question in it, which is not a subject line.
  if (out.length > SUBJECT_MAX) {
    const name = String(businessName || "");
    if (name && out.includes(name)) {
      const room = SUBJECT_MAX - (out.length - name.length);
      if (room >= 12) {
        const cut = name.slice(0, room);
        const boundary = cut.lastIndexOf(" ");
        // The strip class includes the joiners a business name can end on after
        // a word-boundary cut ("Hamstra Heating &" -> "Hamstra Heating"); a
        // dangling "&" or "|" before the comma reads as a typo, not a name.
        const shortName = (boundary > room * 0.5 ? cut.slice(0, boundary) : cut).replace(/[\s\-—,:&|]+$/, "");
        out = out.replace(name, shortName);
      }
    }
  }
  // Last resort — a hook alone still longer than the cap.
  if (out.length > SUBJECT_MAX) {
    const cut = out.slice(0, SUBJECT_MAX);
    const boundary = cut.lastIndexOf(" ");
    out = (boundary > SUBJECT_MAX * 0.6 ? cut.slice(0, boundary) : cut).replace(/[\s\-—,:]+$/, "");
  }
  return out;
}

function pchSubject({ businessName = "", industry = "", city = "", prospectId = "" } = {}) {
  let h = 0;
  const id = String(prospectId);
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  // With no prospectId every send hashes to 0 and the whole batch ships one
  // subject; fall back to the name so a batch still varies.
  if (!id) { const n = String(businessName); for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; }

  // industryForSubject: no current variant carries {industry}, but the guard
  // stays wired so a future variant cannot reintroduce "Diamond State Plumbing
  // — plumbing" by editing the pool alone.
  const raw = SUBJECT_VARIANTS[h % SUBJECT_VARIANTS.length]
    .replaceAll("{Business Name}", businessName || "Your business")
    .replaceAll("{industry}", industryForSubject(businessName, industry) || "local business")
    .replaceAll("{city}", city || "{city}");

  return applySubjectGuards(raw, { businessName, city });
}

/**
 * THE DISCLOSED-ABSENCE STATE (2026-09-02).
 *
 * Owner directive for the mined-prospect lane: an honest disclosed-absence
 * beats zero emails. When a prospect's CURRENT external site bot-blocks the
 * BEFORE capture and no public archive has a usable snapshot, the capture lane
 * no longer fails the send — it stores a styled disclosure card in the before
 * slot and names the state `before_unavailable:<reason>` on the shot record.
 * The gate's treatment of that state is RENDERABLE-WITH-DISCLOSURE: the email
 * may ship showing "your previous online presence was unavailable for capture"
 * where the "YOUR SITE TODAY" panel would sit, rather than blocking the send.
 * It is NOT a waiver of any identity law — a captured before IMAGE must still
 * belong to the prospect; the state only ever stands in for an IMAGE THAT
 * DOES NOT EXIST, and the after visual is still mandatory.
 */
const BEFORE_UNAVAILABLE_RE = /^before_unavailable:[a-z0-9_.:-]{1,120}$/i;

/** The named state from a proof-shots record, or "" — never a guess. */
function beforeUnavailableStateOf(shots) {
  const reason = String((shots && shots.before_unavailable) || "").trim();
  return reason ? `before_unavailable:${reason}` : "";
}

/** Accepts the full `before_unavailable:<reason>` state or a bare reason. */
function namedBeforeUnavailable(...values) {
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    if (BEFORE_UNAVAILABLE_RE.test(raw)) return raw.toLowerCase();
    if (/^[a-z0-9_.:-]{1,100}$/i.test(raw)) return `before_unavailable:${raw.toLowerCase()}`;
  }
  return "";
}

/**
 * THE SEND GATE. Owner directive 2026-07-30: a proof-first email whose proof is
 * missing is worse than no email — it promises a preview and shows a blank box.
 * Callers must refuse the send when this is not ok, rather than degrade.
 */
function proofReadiness({ previewUrl = "", beforeImage = "", afterImage = "", beforeUnavailable = "", cta = {}, requireComparison = true } = {}) {
  const preview = firstHttps(previewUrl, cta.revealUrl, cta.previewUrl);
  if (!preview) return { ok: false, reason: "no_preview_url" };

  // `requireComparison: false` is NOT a relaxed gate — it says this email has no
  // before/after SURFACE. A sequence-1 follow-up (step 2/3) renders only its own
  // step copy plus the preview link, so it displays no "YOUR SITE TODAY" panel
  // and therefore makes no claim about a screenshot. The preview URL above is
  // still mandatory for it, because the follow-up copy states the preview exists
  // ("the preview I built for X — it is still up"), and lib/email.js still runs
  // the approved-host and prospect-binding checks on that URL for EVERY step.
  // The two checks below exist solely to keep a rendered comparison honest, and
  // are skipped only when nothing is rendered for them to be honest about.
  if (!requireComparison) {
    return { ok: true, previewUrl: preview, comparison: false };
  }

  // WHOSE SITE IS THE "BEFORE" A PICTURE OF? (owner directive 2026-07-30, with
  // the Flint audit.) Having a JPEG proves it is a JPEG. The panel is captioned
  // "YOUR SITE TODAY" — a picture of a parked page, a resold domain or another
  // company's homepage under that caption is a lie told in the prospect's name.
  // Same defect class as a stale preview from a different business, so it gets
  // the same answer: refuse to attach, and refuse to send.
  //
  // ORDER MATTERS. This runs BEFORE the presence check so a refusal reports the
  // real reason instead of surfacing as "no visuals" once the caller has
  // withheld the URL. The one exception is a prospect with no current website
  // at all: there is nothing to compare, that is not an identity failure, and
  // "no_before_after_visuals" has always been its correct, published answer.
  //
  // capturedUrl is the RECORDED landing URL only. It deliberately does not fall
  // back to the site we meant to shoot — a check that reads its own input is
  // not a check, and every shot taken before the recording existed would pass.
  const expectedSite = firstHttps(cta.currentUrl, cta.currentWebsite);
  if (expectedSite) {
    const identity = capturedShotBelongsTo({
      capturedUrl: firstHttps(cta.beforeImageSource, cta.beforeImageSourceUrl),
      expectedWebsite: expectedSite,
    });
    if (!identity.ok) return { ok: false, reason: `before_image_${identity.reason}`, identity };
  }

  const before = firstHttps(beforeImage, cta.beforeImage, cta.oldSiteShot);
  const after = firstHttps(afterImage, cta.afterImage, cta.newSiteShot);
  // The disclosed-absence verdict needs both facts settled: a NAMED
  // before_unavailable state, an after visual, and genuinely no before image.
  // A caller handing a real before image can never buy the disclosure path.
  const beforeUnavailableState = namedBeforeUnavailable(beforeUnavailable, cta.beforeUnavailable, cta.beforeUnavailableReason);
  const disclosedAbsence = Boolean(!before && after && beforeUnavailableState);
  if (expectedSite && !disclosedAbsence) {
    const identity = capturedShotBelongsTo({
      capturedUrl: firstHttps(cta.beforeImageSource, cta.beforeImageSourceUrl),
      expectedWebsite: expectedSite,
    });
    if (!identity.ok) return { ok: false, reason: `before_image_${identity.reason}`, identity };
  }
  if (!before || !after) {
    // RENDERABLE-WITH-DISCLOSURE: the capture lane classified the old site as
    // unavailable (bot-wall, dead origin, no archive), and the composer will
    // render the disclosure panel instead of a before image. The after visual
    // and the preview link remain fully gated — this path only ever stands in
    // for a MISSING before image, never a withheld identity check.
    if (disclosedAbsence) {
      return {
        ok: true,
        previewUrl: preview,
        beforeImage: "",
        afterImage: after,
        beforeUnavailable: beforeUnavailableState,
        comparison: "disclosed",
      };
    }
    return { ok: false, reason: "no_before_after_visuals", has: { before: Boolean(before), after: Boolean(after) } };
  }
  return {
    ok: true,
    previewUrl: preview,
    beforeImage: before,
    afterImage: after,
    beforeImageDomain: registrableDomain(firstHttps(cta.beforeImageSource, cta.beforeImageSourceUrl)),
  };
}

// v3 compose (was the v1 PCH compose — deleted)
function outreachHtmlV2(args = {}) {
  return composeOutreachEmailV2(args);
}

module.exports = {
  applySubjectGuards,
  beforeUnavailableStateOf,
  composeOutreachEmailV2,
  industryForSubject,
  namedBeforeUnavailable,
  outreachEmailV2Enabled,
  outreachHtmlV2,
  pchSubject,
  proofReadiness,
  sanitizeBusinessAddress,
  SUBJECT_MAX,
  SUBJECT_POOL: SUBJECT_VARIANTS,
  WSS_HEADER_LOGO_URL,
};
