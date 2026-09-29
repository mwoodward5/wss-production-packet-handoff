"use strict";

// lib/riley-email-shell.js — the branded shell Riley's outbound notes sit in.
//
// WHY THIS FILE EXISTS
// Riley's ONE outbound-email capability (api/vapi-tools/send-note.js) shipped
// his answer as raw text in a bare <div>: no sender identity, no mark, no
// signature, no compliance footer. A caller who asked him to "email me a couple
// of lines about what you do" received something that looked like a leaked
// debug dump from an unknown address, while the outreach email from the same
// company arrived as a designed product email. Two lanes, one company, and only
// one of them looked like it.
//
// WHAT THIS MODULE IS AND IS NOT
// It is a SHELL. It wraps his answer; it never authors, summarises, expands or
// "improves" it. His words go in and come out character for character — the
// only thing this file adds is type, colour and structure around them. That
// boundary is load-bearing: the note is the answer he gave a human on a live
// call, and a shell that rewrote it would be putting words in his mouth after
// the call ended.
//
// THREE RULES IT ENFORCES
//
//   1. THE LOOK IS NOT INVENTED HERE. Palette, type ladder, card depth and the
//      accent all come from lib/wss-email-design.js — the same module
//      lib/outreach-email-v2.js renders from — which reads
//      packages/wss-brand-system. The masthead is the same two-cell lockup, the
//      card is the same hairline-plus-3px-shelf, the ladder is the same
//      30/21/16.5/15/13/11. That is what makes the proof email and Riley's note
//      read as one company rather than two vendors.
//
//   2. RILEY IS AN AI, AND THE EMAIL SAYS SO. He is the client's own web
//      person, not a chatbot pointed at their customers (the framing is the
//      product — see the VIP block in lib/outreach-email-v2.js). He is warm,
//      and he is not a human employee. A client who works out later what Riley
//      is should feel they were told, not that they were tricked, so the
//      disclosure is a fixed part of the signature and not a caller-supplied
//      option that could be omitted.
//
//   3. NOTHING IS CLAIMED THAT IS NOT TRUE. No team, no credentials, no
//      customer counts, and — deliberately — no statement about what Riley can
//      DO to a website. His edit-execution path is unproven as of 2026-07-31,
//      so this shell describes who he is and stops there. The only capability
//      claim anywhere in the rendered output is the phone line, and that renders
//      only when a real number is configured.
//
// ENV VALUES ARE OPTIONAL AND OMIT THEMSELVES. The callback number resolves
// through lib/riley-line.js, whose whole reason for existing is that a hardcoded
// DEFAULT_AGENT_PHONE once mailed a retired number to strangers: unset means the
// line disappears, never a placeholder. The postal address follows the same
// rule — GHOST_AGENCY_POSTAL_ADDRESS or no address segment at all. An invented
// address in a compliance footer is worse than a missing one.
//
// THE OPT-OUT SENTENCE HAS ONE HOME. It is imported from lib/opt-out-promise.js
// for both MIME parts. The HTML and text halves of an email that state the
// promise differently is a real defect this system already shipped once; a
// shared constant is the only arrangement in which the two cannot drift.

const design = require("./wss-email-design");
const { OPT_OUT_PROMISE, optOutPromiseHtml } = require("./opt-out-promise");
const { resolveRileyLine } = require("./riley-line");

const { FONT_STACK, PALETTE, TYPE } = design;

// ---------------------------------------------------------------------------
// WHO RILEY IS — stated once, rendered into both halves.
// ---------------------------------------------------------------------------

/** His role, in the owner's own words. A title, not a capability claim. */
const RILEY_ROLE = "your private AI web developer";

/**
 * The disclosure. Fixed copy, not a parameter: an identity statement a caller
 * could switch off is not a disclosure. Two facts, both verifiable — he is an
 * AI, and he belongs to the client rather than being aimed at their customers.
 * (Riley is he/him everywhere he speaks: the line, the notes, this footer.)
 */
const RILEY_DISCLOSURE =
  "Riley is an AI assistant, not a person. He is assigned to your account "
  + "— he is not a chatbot pointed at your customers.";

/** The company line in the footer. Matches the proof email's masthead sub-line. */
const WSS_IDENTITY = "WSS Labs — an AI-powered web studio in California";

/**
 * The legal entity, spelled the way lib/email.js's plain-text compliance footer
 * already spells it. NOT "Woodward Software Labs" — that is a retired name, and
 * test/design-lock-contract.test.js forbids it in rendered output.
 */
const LEGAL_ENTITY = "Woodward Software Systems";

/**
 * A short subject can carry the 30px display size; a long one cannot. Twelve
 * words set at 30px inside a 299px-wide card on a 375px phone is a wall of
 * headline the reader has to climb before reaching a single sentence of the
 * answer they asked for. Past this length the headline steps down one rung of
 * the ladder instead, which keeps the hierarchy and loses the wall.
 */
const DISPLAY_SUBJECT_MAX_CHARS = 52;

/** Gmail's preview snippet is roughly this long before it is cut. */
const PREHEADER_MAX_CHARS = 140;

// ---------------------------------------------------------------------------
// escaping
// ---------------------------------------------------------------------------

/**
 * Local, like the escaper in lib/opt-out-promise.js and the one in
 * lib/outreach-email-v2.js. Everything this shell interpolates is untrusted in
 * the strict sense: `answer` and `subject` arrive from a language model that was
 * listening to a stranger on a phone. Nothing reaches the document unescaped.
 */
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function collapse(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// HER ANSWER — restructured, never rewritten
// ---------------------------------------------------------------------------

const LIST_MARKER = /^\s*(?:([-*•–])|(\d{1,2}[.)]))\s+/;

/**
 * Split the answer into blocks the way a reader already reads it: a blank line
 * ends a block, and a block whose every line opens with a list marker is a list.
 *
 * NO WORD IS TOUCHED. The only character this function does not pass through is
 * the leading bullet glyph of an unordered item, which is lifted out of the text
 * and re-set in its own cell so the wrapped second line of a long bullet indents
 * under the first instead of under the dash. A numbered marker keeps its exact
 * characters, because "2)" and "2." are the author's, and so is the number.
 */
function blocksOf(answer) {
  return String(answer == null ? "" : answer)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/[ \t]+$/gm, "").trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length && lines.every((line) => LIST_MARKER.test(line))) {
        return {
          kind: "list",
          items: lines.map((line) => {
            const match = LIST_MARKER.exec(line);
            return {
              // An unordered marker is a glyph, so it is restyled to the one the
              // rest of the system uses. An ordered marker is content.
              marker: match[2] ? match[2] : "•",
              text: line.slice(match[0].length),
            };
          }),
        };
      }
      return { kind: "paragraph", text: chunk };
    });
}

/**
 * Render the blocks as the card's body copy.
 *
 * The first paragraph is set as LEAD (16.5px) and everything after it as BODY
 * (15px). That is the smallest honest hierarchy a note can have: an opening beat
 * the eye lands on, then the rest. A note whose every line is one size is
 * exactly the "reads flat, like a PDF report" the owner rejected in the outreach
 * shell, and it is not more honest for being flatter.
 */
function answerHtml(answer) {
  const blocks = blocksOf(answer);
  let leadUsed = false;
  return blocks.map((block, index) => {
    const last = index === blocks.length - 1;
    const gap = last ? "0" : "16";
    if (block.kind === "list") {
      const rows = block.items.map((item) => `<tr>
              <td valign="top" width="20" style="width:20px;padding:0 0 8px;font-family:${FONT_STACK};font-size:15px;line-height:1.65;color:${PALETTE.accent};font-weight:700">${escapeHtml(item.marker)}</td>
              <td valign="top" style="padding:0 0 8px;${TYPE.body}">${escapeHtml(item.text)}</td>
            </tr>`).join("\n");
      return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;margin:0 0 ${gap}px">
${rows}
          </table>`;
    }
    const style = leadUsed ? TYPE.body : TYPE.lead;
    leadUsed = true;
    return `<p style="margin:0 0 ${gap}px;${style}">${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;
  }).join("\n          ");
}

// ---------------------------------------------------------------------------
// the shell
// ---------------------------------------------------------------------------

/**
 * The masthead. Byte-for-byte the same shape as the proof email's header block
 * in lib/outreach-email-v2.js — hosted 44px raster, wordmark, sub-line — so a
 * client who has seen one recognises the other.
 *
 * IT DEGRADES. The mark is a hosted PNG because the brand kit ships SVG only and
 * Gmail strips inline <svg>; with images blocked the alt text reads "WSS Labs"
 * and the wordmark beside it is live text, so the sender is still named. Width
 * and height are attributes as well as styles, so a blocked image reserves its
 * box instead of collapsing the row.
 */
function mastheadBlock() {
  return `<tr><td style="padding:0 6px 18px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle" style="padding-right:12px">
        <img src="${design.WSS_MARK_URL}" width="44" height="44" alt="WSS Labs" style="display:block;width:44px;height:44px;border:0;border-radius:12px">
      </td>
      <td valign="middle">
        <span style="font-family:${FONT_STACK};font-size:16px;font-weight:800;color:${PALETTE.ink};letter-spacing:-.01em">WSS Labs</span><br>
        <span style="font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${PALETTE.muted}">Riley &middot; ${escapeHtml(RILEY_ROLE)}</span>
      </td>
    </tr></table>
  </td></tr>`;
}

/**
 * The signature. A 4px accent rule down the left, exactly as the outreach
 * email's sign-off, then his name, his role, the disclosure, and the callback
 * line IF one is configured.
 *
 * `width="100%"` on the table is load-bearing and the comment is copied from the
 * outreach shell on purpose: an auto-layout table sizes to its longest unbroken
 * run, which at 375px is how one long sign-off line drags the whole document
 * into a horizontal scroll.
 */
function signatureBlock(line) {
  const phoneLine = line.phone
    ? `<p style="margin:10px 0 0;font-family:${FONT_STACK};font-size:13.5px;line-height:1.5;color:${PALETTE.ink}">&#128222; Call or text Riley: <a href="${line.telHref}" style="color:${PALETTE.accent};text-decoration:none;font-weight:700">${escapeHtml(line.display)}</a></p>`
    : "";
  return `<tr><td style="padding:6px 6px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%"><tr>
      <td width="4" style="width:4px;background:${PALETTE.accent};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
      <td style="padding-left:14px">
        <p style="margin:0;font-family:${FONT_STACK};font-size:17px;line-height:1.35;font-weight:800;color:${PALETTE.ink}">&mdash; Riley</p>
        <p style="margin:3px 0 0;${TYPE.caption}">${escapeHtml(RILEY_ROLE.replace(/^your /, ""))} &middot; WSS Labs</p>
        <p style="margin:8px 0 0;${TYPE.small}">${escapeHtml(RILEY_DISCLOSURE)}</p>
        ${phoneLine}
      </td>
    </tr></table>
  </td></tr>`;
}

/**
 * The compliance footer: who sent this, from what address, and how to make it
 * stop. The postal segment and the opt-out sentence are the two things a footer
 * owes the reader, and the sentence is imported rather than restated.
 */
function footerBlock(postal) {
  const identity = [escapeHtml(WSS_IDENTITY), LEGAL_ENTITY, postal ? escapeHtml(postal) : ""]
    .filter(Boolean)
    .join(" &middot; ");
  return `<tr><td style="padding:24px 6px 0">
    <div style="border-top:1px solid ${PALETTE.line};padding-top:18px">
      ${optOutPromiseHtml()}
      <p style="margin:0;font-family:${FONT_STACK};font-size:11.5px;line-height:1.6;color:${PALETTE.muted}">${identity}</p>
    </div>
  </td></tr>`;
}

/**
 * The one thing this shell will render as a link on Riley's behalf. The shell
 * exists to wrap words he already said; a checkout link is not words he said —
 * it is a URL this system minted — so it rides in a dedicated button-style
 * block AFTER his answer, never inside it. `url` must be https, and the label
 * is escaped like every other untrusted string.
 */
function linkBlock(link) {
  const url = String((link && link.url) || "");
  const label = String((link && link.label) || "Open your link");
  const note = String((link && link.note) || "");
  return `<tr><td style="padding:0 0 6px">
    <p style="margin:18px 0 10px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${PALETTE.accent};color:#ffffff;font-family:${FONT_STACK};font-size:15.5px;font-weight:700;line-height:1.2;padding:13px 26px;border-radius:10px;text-decoration:none">${escapeHtml(label)}</a></p>
    <p style="margin:0;${TYPE.small};word-break:break-all">${escapeHtml(note)} <a href="${escapeHtml(url)}" style="color:${PALETTE.accent};text-decoration:none">${escapeHtml(url)}</a></p>
  </td></tr>`;
}

/**
 * renderRileyEmail({ subject, answer, recipientName, context, link, env })
 *   -> { subject, html, text, meta }
 *
 * `subject`  his subject line, rendered as the note's headline as well.
 * `answer`   his answer, verbatim. Required — an empty shell is a defect, not
 *            an email, so it throws rather than mailing an elegant blank card.
 * `recipientName` optional. Absent means NO greeting line at all; "Hi there,"
 *            is what a mail merge sounds like when it does not know who it is
 *            writing to, and this note always does or does not.
 * `context`  optional one-line provenance ("Sent during your call just now.").
 * `link`     optional { url, label, note } — rendered as a button + the bare
 *            URL, after his answer. Used by the payment-link lane; absent on
 *            every existing render, so nothing already sent changes shape.
 * `env`      injectable for tests; defaults to process.env.
 *
 * `meta` reports what the render decided — whether a phone line and a postal
 * address were available, and where the number came from — so the caller can
 * log a note that shipped without them instead of discovering it in an inbox.
 */
function renderRileyEmail({ subject = "", answer = "", recipientName = "", context = "", link = null, env = process.env } = {}) {
  const answerText = String(answer == null ? "" : answer).trim();
  if (!answerText) throw new Error("renderRileyEmail: `answer` is required — there is nothing to send");

  const subjectText = collapse(subject);
  const name = collapse(recipientName);
  const contextText = collapse(context);

  // The number: the agency line is genuinely Riley's line, so agency fallback is
  // allowed here. Unset resolves to null and the whole line disappears.
  const line = resolveRileyLine({ env, allowAgencyLine: true });
  const postal = collapse(env && env.GHOST_AGENCY_POSTAL_ADDRESS);

  const headlineStyle = subjectText && subjectText.length <= DISPLAY_SUBJECT_MAX_CHARS ? TYPE.display : TYPE.title;
  const headline = subjectText
    ? `<h1 style="margin:0 0 ${name || contextText ? "14" : "18"}px;${headlineStyle}">${escapeHtml(subjectText)}</h1>`
    : "";
  const greeting = name
    ? `<p style="margin:0 0 14px;${TYPE.subtitle}">Hi ${escapeHtml(name)},</p>`
    : "";
  const contextLine = contextText
    ? `<p style="margin:18px 0 0;padding-top:14px;border-top:1px solid ${PALETTE.line};${TYPE.caption}">${escapeHtml(contextText)}</p>`
    : "";
  // A link only renders when a real https URL was supplied; anything else is
  // an omission, not a broken button.
  const linkRendered = link && /^https:\/\//i.test(String(link.url || "")) ? link : null;

  // The preview snippet clients show beside the subject. His own opening words,
  // truncated — never invented copy, and never the "view in browser" noise that
  // usually lands there.
  const preheaderSource = collapse(answerText);
  const preheader = preheaderSource.length > PREHEADER_MAX_CHARS
    ? `${preheaderSource.slice(0, PREHEADER_MAX_CHARS - 1).trimEnd()}…`
    : preheaderSource;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subjectText || "A note from Riley")}</title></head>
<body style="margin:0;padding:0;background:${PALETTE.page};font-family:${FONT_STACK}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${PALETTE.page}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%">

  <!-- 1. MASTHEAD -->
  ${mastheadBlock()}

  <!-- 2. THE NOTE. His answer, in the same raised card the proof email uses. -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle()}">
      <tr><td style="padding:5px 0 0;background:${PALETTE.accent};font-size:0;line-height:0;border-radius:13px 13px 0 0">&nbsp;</td></tr>
      <tr><td style="padding:26px 26px 24px">
        <p style="margin:0 0 12px;${TYPE.eyebrow};color:${PALETTE.accent}">A note from Riley</p>
        ${headline}
        ${greeting}
        ${answerHtml(answerText)}
        ${contextLine}
      </td></tr>
    </table>
  </td></tr>

  <!-- 2b. THE LINK (only when one was minted for this send). -->
  ${linkRendered ? linkBlock(linkRendered) : ""}

  <!-- 3. SIGNATURE -->
  ${signatureBlock(line)}

  <!-- 4. FOOTER -->
  ${footerBlock(postal)}

</table></td></tr></table>
</body></html>
`;

  // The text half. Same message, same order, same promise — his answer carried
  // through untouched, because the plain-text part is the one a screen reader
  // and a terminal client render and it is not a lesser copy.
  //
  // Built as SEGMENTS joined by a blank line, not as a list of lines. A line
  // list needs empty strings to represent the gaps, and an empty string is
  // indistinguishable from an omitted optional field — which is how an absent
  // greeting or an unset phone number opens a hole in the middle of a note.
  const stanza = (...lines) => lines.filter(Boolean).join("\n");
  const text = [
    stanza("WSS Labs", `Riley — ${RILEY_ROLE}`),
    subjectText || null,
    name ? `Hi ${name},` : null,
    answerText,
    linkRendered ? `${linkRendered.note || ""}\n${linkRendered.url}` : null,
    contextText || null,
    stanza(
      "— Riley",
      `${RILEY_ROLE.replace(/^your /, "")} · WSS Labs`,
      RILEY_DISCLOSURE,
      line.phone ? `Call or text Riley: ${line.display}` : null,
    ),
    stanza(
      "--",
      WSS_IDENTITY,
      LEGAL_ENTITY,
      postal || null,
      OPT_OUT_PROMISE,
    ),
  ].filter(Boolean).join("\n\n");

  return {
    subject: subjectText,
    html,
    text,
    meta: {
      phone: line.phone,
      phoneSource: line.source,
      phoneReason: line.reason,
      postal: postal || null,
      hasGreeting: Boolean(name),
      headline: subjectText ? (headlineStyle === TYPE.display ? "display" : "title") : null,
      blocks: blocksOf(answerText).length,
      link: linkRendered ? { url: linkRendered.url, label: linkRendered.label } : null,
    },
  };
}

module.exports = {
  DISPLAY_SUBJECT_MAX_CHARS,
  LEGAL_ENTITY,
  RILEY_DISCLOSURE,
  RILEY_ROLE,
  WSS_IDENTITY,
  blocksOf,
  renderRileyEmail,
};
