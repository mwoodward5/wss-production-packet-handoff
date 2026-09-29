"use strict";

// THE OPT-OUT PROMISE — ONE DEFINITION, EVERY LANE.
//
// A cold email is a multipart/alternative message: the same message rendered
// twice, once as plain text and once as HTML. The reader's client picks one and
// shows it; the reader never learns the other half exists. So the opt-out
// instruction is not copy that may be phrased per-layer. It is a single promise
// made to a stranger who did not ask to be written to, and whichever half their
// client happens to render has to make that promise in the same words.
//
// It did not stay the same words. The sentence lived as three unrelated string
// literals — the plain-text compliance footer in lib/email.js, the proof-first
// HTML footer in lib/outreach-email-v2.js, and the supervised local draft
// fallback in lib/supervised-held-drafts.js. The HTML one was dropped entirely
// when the template was rewritten for proof-first, so cold email went out whose
// text part promised "reply STOP and you won't hear from me again" and whose
// HTML part, the half most clients actually render, said no such thing. It was
// then re-typed by hand into the HTML shell, which restores the sentence but
// not the invariant: nothing in the code connected the copies, so nothing could
// notice the next time one of them moved.
//
// This module is the only place the sentence exists. Every renderer imports it,
// so editing the promise here changes it in every layer at once — which is the
// whole point. test/opt-out-parity.test.js fails if a second definition
// reappears anywhere in the backend source, and fails if the two MIME parts of
// a real composed cold email ever stop matching byte for byte.
//
// This file deliberately has NO dependencies. lib/email.js and
// lib/supervised-held-drafts.js already require each other (one of them
// lazily), and a leaf module can be imported from either side of that knot
// without deepening it.

/**
 * The promise itself, as TEXT. This is the canonical form: every other
 * rendering in the system is this string plus escaping and markup.
 *
 * Wording is deliberately fixed rather than templated. It is quoted verbatim in
 * tests on purpose — a promise made to strangers is a contract, not copy to be
 * A/B tested, and lib/reply-agent.js is on the other end of it treating a bare
 * "STOP" reply as an opt-out.
 */
const OPT_OUT_PROMISE = "Not interested? Reply STOP and you won't hear from me again.";

/**
 * Footer type styling for the HTML layer. Kept here beside the sentence so the
 * HTML rendering is fully described in one place, and so a caller cannot
 * accidentally render the promise in an invisible or throwaway style.
 */
const OPT_OUT_PROMISE_STYLE = "margin:0 0 6px;font-size:11.5px;color:#5f6368;line-height:1.5";

/**
 * The constant is TEXT, so the HTML layer escapes it rather than assuming it
 * happens to contain no markup-significant characters. Today the only such
 * character is the apostrophe in "won't"; escaping it costs nothing and means a
 * future edit to the sentence (an "&", a quote) cannot silently emit broken or
 * injectable markup. Every entity emitted here decodes back to the exact
 * characters of OPT_OUT_PROMISE, which is the property the parity test checks.
 *
 * Local rather than imported: this file has no dependencies by design, and the
 * two escapers that already exist (lib/email.js, lib/outreach-email-v2.js) are
 * both module-private.
 */
function escapeHtmlText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

/**
 * The promise as an HTML footer paragraph. This is what the proof-first shell
 * renders; it takes no arguments, because a caller that could supply the
 * sentence would be a second definition of it.
 */
function optOutPromiseHtml() {
  return `<p style="${OPT_OUT_PROMISE_STYLE}">${escapeHtmlText(OPT_OUT_PROMISE)}</p>`;
}

module.exports = {
  OPT_OUT_PROMISE,
  OPT_OUT_PROMISE_STYLE,
  optOutPromiseHtml,
};
