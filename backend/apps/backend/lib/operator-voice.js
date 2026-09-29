"use strict";

/**
 * lib/operator-voice.js — the one plain-words dictionary for every operator
 * page (console, gallery, campaigns, replies, ledger).
 *
 * Owner instruction 2026-08-16: the console is jargon-heavy and its reader is
 * a layman, not a developer. Every machine word the screens print goes through
 * this module so the same status never reads as two different things on two
 * pages.
 *
 * RULES
 *   · Dependency-free pure JS. No DOM, no fetch, no Node APIs — the same
 *     values must work in server-rendered HTML strings and in browser JS.
 *   · Values never contain markup, backticks or "</" so they can be dropped
 *     into templates, JSON and inline scripts alike.
 *   · Truth law: the dictionary translates WORDS, never numbers. An absent
 *     field stays absent on the page; nothing here invents a value.
 *
 * SERVER USE   const { PLAIN, explain, statusChip, tip } = require("./operator-voice");
 *              html += `<span>${PLAIN["Sandbox"]}</span>`
 * BROWSER USE  the requiring page inlines the data at render time, e.g.
 *              `<script>var VOICE_PLAIN=${JSON.stringify(PLAIN)};</script>`
 *              and mirrors the tiny lookups below client-side.
 */

// Machine vocabulary -> owner English. Keys are matched EXACTLY by explain();
// status strings should go through statusChip() instead, which owns its own
// normalized table below.
const PLAIN = Object.freeze({
  // statuses and verdicts the machines print
  "Line Gate Passed": "✓ Passed final inspection",
  "Approval pending": "Waiting for your OK",
  "Packeted": "Research done",
  "Line Queued": "Waiting in line to be built",
  "New": "Just found",
  "Render gate": "Final website inspection",
  "Mined": "Found new businesses",
  "Sandbox": "Practice mode — emails come only to you",
  "Live": "Real sends (after your approval)",
  "Preview URL": "Website link",
  "Dry run": "Practice send",
  "Stalled": "Taking longer than usual",
  // vocabulary swaps — one word of factory talk, one word of English
  "prospect": "business",
  "batch": "campaign",
  "row": "website",
  "vertical": "trade",
  "lane": "mode",
  "mirror": "website copy",
  "queue": "waiting list",
  "gate": "inspection",
  "donor": "starter design",
  "mine": "find businesses",
  "proof email": "preview email",
  "send pass": "send round",
});

// Canonical status table. Keys are snake_case; statusChip() normalizes
// "Line Queued", "line-queued" and "lineQueued" alike onto them.
// value = [plain label, tone] with tone one of "good" | "wait" | "bad" | "neutral".
const STATUS = Object.freeze({
  // prospect funnel
  new: ["Just found", "neutral"],
  packeted: ["Research done", "wait"],
  previewed: ["Website built", "good"],
  reported: ["Report emailed", "good"],
  engaged: ["They replied", "good"],
  won: ["Customer won", "good"],
  closed_lost: ["Not a fit", "neutral"],
  unsubscribed: ["Asked us to stop", "neutral"],
  do_not_contact: ["Do not contact", "bad"],
  held: ["On hold for review", "wait"],
  // line rows (api/admin/line row.status)
  picked: ["Checking the business", "wait"],
  qualified: ["Building the website", "wait"],
  mirrored: ["Checking the website", "wait"],
  gate_passed: ["✓ Passed final inspection", "good"],
  line_gate_passed: ["✓ Passed final inspection", "good"],
  queued: ["Waiting for your OK", "wait"],
  line_queued: ["Waiting in line to be built", "wait"],
  sent: ["Email sent", "good"],
  rejected: ["Didn't meet our bar", "bad"],
  gate_failed: ["Failed final inspection", "bad"],
  error: ["Something went wrong", "bad"],
  // batches / campaigns (batch.status)
  running: ["Working now", "good"],
  building: ["Building websites", "good"],
  sending: ["Sending emails", "good"],
  awaiting_approval: ["Waiting for your OK", "wait"],
  line_awaiting_approval: ["Waiting for your OK", "wait"],
  approved: ["Approved by you", "good"],
  halted: ["Stopped", "bad"],
  settled: ["Finished", "neutral"],
  collecting: ["Looking for businesses", "wait"],
  // modes and motion
  sandbox: ["Practice mode", "neutral"],
  live: ["Real sends", "wait"],
  working: ["Working now", "good"],
  stalled: ["Taking longer than usual", "wait"],
  waiting: ["In line", "neutral"],
  idle: ["Paused", "neutral"],
  active: ["Active", "good"],
  recent: ["Ran recently", "neutral"],
  dormant: ["Quiet for a while", "wait"],
  never: ["Never used", "neutral"],
  unknown: ["Not sure yet", "bad"],
});

const TONE_OK = ["good", "wait", "bad", "neutral"];

// Operator tips, Riley-voiced: one sentence, always useful, never cute for
// cute's sake. tip() hands them out in rotation.
const TIPS = Object.freeze([
  "Nothing emails a business owner until you press Approve and send — the OK is always yours.",
  "Practice mode is the safe place to try a run: every email lands in your inbox and nowhere else.",
  "Run Build 10 first, look at the websites, then scale up once you like what you see.",
  "The stop switch at the top halts everything in one press — press it twice to confirm.",
  "Leave the Where box blank and each run rotates to a new part of America on its own.",
  "Waiting on you means finished websites parked for your OK — clear them from the Ready-to-send page.",
  "Every number on this screen is measured. If the server did not report it, the screen says so instead of guessing.",
]);

function normalize(value) {
  return String(value == null ? "" : value).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function titleCaseWords(value) {
  return String(value == null ? "" : value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, function (letter) { return letter.toUpperCase(); });
}

/**
 * explain(term) — the plain title for a machine word.
 * Exact PLAIN match first ("Sandbox"), then the status table by any casing
 * ("Line Queued", "line_queued"), then a tidy title-case of what came in, so
 * an unmapped term degrades to readable rather than to jargon-with-capitals.
 */
function explain(term) {
  const raw = String(term == null ? "" : term).trim();
  if (!raw) return "";
  if (Object.prototype.hasOwnProperty.call(PLAIN, raw)) return PLAIN[raw];
  const hit = STATUS[normalize(raw)];
  if (hit) return hit[0];
  return titleCaseWords(raw);
}

/**
 * statusChip(status) — { label, tone } for any machine status.
 * tone is always one of "good" | "wait" | "bad" | "neutral"; unknown statuses
 * come back neutral with a readable label, never undefined styling.
 */
function statusChip(status) {
  const key = normalize(status);
  const hit = STATUS[key];
  if (hit) {
    const tone = TONE_OK.indexOf(hit[1]) >= 0 ? hit[1] : "neutral";
    return { label: hit[0], tone: tone };
  }
  if (!key) return { label: "Not reported", tone: "neutral" };
  return { label: titleCaseWords(String(status)), tone: "neutral" };
}

let tipCursor = 0;

/**
 * tip() — the next operator tip, in rotation. Deterministic, dependency-free,
 * safe to call from a server render or a browser script.
 */
function tip() {
  if (!TIPS.length) return "";
  const line = TIPS[tipCursor % TIPS.length];
  tipCursor = (tipCursor + 1) % TIPS.length;
  return line;
}

module.exports = {
  PLAIN: PLAIN,
  STATUS: STATUS,
  TIPS: TIPS,
  explain: explain,
  statusChip: statusChip,
  tip: tip,
};
