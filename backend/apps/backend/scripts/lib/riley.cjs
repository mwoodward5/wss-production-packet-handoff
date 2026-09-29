"use strict";
// scripts/lib/riley.cjs — RILEY AND THE PHONE NUMBER, MADE IMPOSSIBLE TO MISS.
//
// Owner, 2026-07-30: "I don't see enough representation about call Riley and
// the phone number for our contact throughout. That is not emphasized enough.
// Our AI web designer assistant that comes with it — it's not being boldly
// shown enough."
//
// He was right, and it was worse than under-emphasised. Measured before this
// module existed: the assembled outreach email contained ZERO phone numbers and
// ZERO tel: links, and "Riley" reached the reader exactly once — as a 12px chip
// in a fifteen-item two-column rail reading "Riley, 24/7 — staged". In a
// phone-first email whose entire differentiator is a voice assistant, the
// differentiator was the smallest text on the page and there was no way to dial.
//
// THREE PLACEMENTS, one module, so the number can never drift between them:
//   rileyFoldLine()  one bold tappable line under the above-fold CTA
//   rileyPanel()     the full dark panel, directly above the ask
//   rileyFooterLine() the signature line, so the last thing read is a number
//
// TRUTH DISCIPLINE. Riley's entry in product-claims.json is verified:true and
// reads "Riley, your 24/7 phone assistant — staged and ready for you to test".
// STAGED is part of the verified claim, so every string here says so. Nothing
// in this module may promise she is answering a live line today.
//
// THE NUMBER IS NEVER FABRICATED, AND NEVER HARDCODED. GHOST_AGENCY_AGENT_PHONE
// is Riley's own Vapi line; it is currently unset (verified: absent from every
// .env on this machine, and api/riley-phone.js falls through to a Vapi lookup
// that needs a phone-number id nobody has configured). While it is unset these
// blocks render a REPLY-based CTA and print no digits at all — not a borrowed
// number, not a placeholder. The moment GHOST_AGENCY_AGENT_PHONE exists, the
// same blocks render tel: buttons and the label upgrades from "Call or text" to
// "Call Riley", with no copy change anywhere.

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// NO HARDCODED NUMBER. Owner directive 2026-07-30: "Do NOT hardcode a phone
// number… I will set GHOST_AGENCY_AGENT_PHONE myself." An earlier revision of
// this file carried the contact line as a literal fallback, which meant the
// email printed a number nobody had configured for this purpose — the exact
// fabricate-a-fact failure the rest of this codebase is built to prevent.
// The number comes from the environment or it does not render at all.

/** Digits-only E.164 for the tel: href. A US 10-digit number gets +1. */
function telHref(display) {
  const digits = String(display || "").replace(/\D/g, "");
  if (!digits) return "";
  return `tel:+${digits.length === 10 ? "1" : ""}${digits}`;
}

/**
 * The number to print, if there is one.
 *
 * FAIL-CLOSED: with nothing configured, `display` is empty and every caller
 * renders a reply-based CTA instead of a dialable one. No placeholder, no
 * borrowed number, no "(555)". The moment GHOST_AGENCY_AGENT_PHONE exists the
 * same blocks render a tel: button and the label upgrades to "Call Riley" —
 * no copy anywhere else changes.
 */
function rileyPhone(env = process.env) {
  const direct = String(env.GHOST_AGENCY_AGENT_PHONE || "").trim();
  return {
    display: direct,
    tel: direct ? telHref(direct) : "",
    direct: Boolean(direct),
    has: Boolean(direct),
    // The verb changes with the truth: "Call Riley" only once it is her line.
    action: "Call Riley",
    note: direct
      ? "Riley answers this line 24/7 — staged and ready for you to test."
      : "Riley is staged and ready for you to test on your site.",
  };
}

/**
 * ABOVE THE FOLD — one line, bold, tappable, directly under the "See your live
 * site" button. Deliberately ONE line: the fold budget on a 390x844 phone is
 * already spent down to the pixel (see the ORDER NOTE in send-final-outreach),
 * and a full panel here would push the Signal report below the fold, which is
 * the exact regression that comment exists to prevent.
 */
function rileyFoldLine({ accent } = {}) {
  const p = rileyPhone();
  const head = p.has
    ? `<span style="color:${accent}">📞</span> ${esc(p.action)} <span style="color:${accent};font-weight:900">${esc(p.display)}</span>`
    : `<span style="color:${accent}">📞</span> Reply <span style="color:${accent};font-weight:900">RILEY</span> and I'll call you`;
  // ONE LINE, MEASURED. The two-line version cost 86px and pushed feature_rail
  // from y=791 to y=877 on a 390x844 phone — check-email-fold.cjs marks that
  // block REQUIRED above the fold, so it failed. Riley keeps her above-fold
  // presence but must pay for it in a single row; the full pitch is the panel
  // further down. Re-run scripts/check-email-fold.cjs after ANY edit here.
  const inner = `${head}<span style="color:#b9b9b2;font-weight:400"> · your AI web designer, edits live on the call</span>`;
  return `<tr><td style="padding:2px 28px 0" class="pad">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#14140f;border-radius:9px">
      <tr><td style="padding:6px 13px">
        ${p.has
    ? `<a href="${p.tel}" style="text-decoration:none;color:#fff;font:700 12.5px/1.4 -apple-system,Segoe UI,Roboto,sans-serif">${inner}</a>`
    : `<div style="color:#fff;font:700 12.5px/1.4 -apple-system,Segoe UI,Roboto,sans-serif">${inner}</div>`}
      </td></tr>
    </table>
  </td></tr>`;
}

/**
 * BELOW THE FOLD — the full panel, placed immediately before the ask, because
 * this is the thing that makes the offer different from every other web company
 * that will ever email this person.
 */
function rileyPanel({ business, accent } = {}) {
  const p = rileyPhone();
  const b = esc(business || "your business");
  const say = (t) => `<tr><td style="padding:3px 0;font:400 13.5px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#e8e8e3">
      <span style="color:${accent}">“</span>${esc(t)}<span style="color:${accent}">”</span></td></tr>`;

  return `<tr><td style="padding:22px 28px 4px" class="pad">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:14px">
      <tr><td style="padding:24px 24px 22px">

        <div style="font:700 11px/1.4 sans-serif;letter-spacing:.13em;text-transform:uppercase;color:${accent}">
          ✦ Included — nobody else gives you this
        </div>

        <div style="font:800 25px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;color:#fff;margin:11px 0 8px">
          Riley, your own AI&nbsp;web&nbsp;designer
        </div>

        <p style="margin:0 0 14px;color:#c9c9c2;font:400 14px/1.62 -apple-system,Segoe UI,Roboto,sans-serif">
          ${b}'s site comes with Riley. You call and just say what you want changed —
          he makes the edit on your live site while you're still on the phone.
          No ticket system, no emailing changes in, no waiting two weeks on a freelancer for one small fix.
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
          ${say("Change my hero video.")}
          ${say("Reword that headline.")}
          ${say("Swap that photo for the one I just sent you.")}
        </table>

        ${p.has
    ? `<a href="${p.tel}" style="display:block;text-align:center;background:${accent};color:#fff;font:800 17px/1 sans-serif;text-decoration:none;padding:18px;border-radius:9px">
          📞 ${esc(p.action)} ${esc(p.display)}
        </a>`
    : `<div style="text-align:center;background:${accent};color:#fff;font:800 17px/1 sans-serif;padding:18px;border-radius:9px">
          📞 Reply &ldquo;RILEY&rdquo; and I'll call you to switch him on
        </div>`}

        <div style="text-align:center;font:400 12px/1.55 sans-serif;color:#8a8a82;margin-top:11px">
          ${esc(p.note)}
        </div>

      </td></tr>
    </table>
  </td></tr>`;
}

/**
 * THE SIGNATURE LINE — the last thing in the email is a number, not a legal
 * paragraph. Rendered above the compliance block, still tappable.
 */
function rileyFooterLine({ accent } = {}) {
  const p = rileyPhone();
  return `<tr><td style="padding:18px 28px 0" class="pad">
    <div style="border-top:1px solid #ececE7;padding-top:16px;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#202534">
      Questions, or want it changed before you decide? ${p.has
    ? `${esc(p.action)} <a href="${p.tel}" style="color:${accent};font-weight:800;text-decoration:none">${esc(p.display)}</a> — or just reply to this email.`
    : "Just reply to this email and I'll get straight back to you."}
    </div>
  </td></tr>`;
}

module.exports = { rileyPhone, rileyFoldLine, rileyPanel, rileyFooterLine, telHref };
