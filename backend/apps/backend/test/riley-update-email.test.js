"use strict";

// test/riley-update-email.test.js — the contract for Riley's recurring
// "here's what I did for you" email (lib/riley-update-email.js).
//
// The tests that matter here are truth tests, in the same spirit as
// test/site-change-log.test.js one layer down:
//
//   1. EMPTY MEANS SILENT. No changes -> no email. An INCOMPLETE change log
//      (a source read failed) -> no email either: a digest that silently
//      under-reports is the same defect class as one that invents.
//   2. N IN, N OUT. A change list of N entries produces exactly N claims, in
//      both MIME halves — never a padded list, never a dropped item. An
//      unknown kind is carried in the record's own words, not invented ones.
//   3. THE LOCK HOLDS. While samples-only, the ONLY recipient is the owner's
//      mailbox, and the lock is checked before a single record is read.
//   4. IT RENDERS AT 680 AND 390. Structurally: the container is fluid
//      (max-width, width:100%), nothing else carries a fixed width a phone
//      cannot fit, and no unbreakable text run can force a sideways scroll —
//      the three mechanisms by which table email actually breaks at 390.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DASHBOARD_URL,
  RILEY_UPDATE_RECIPIENT,
  claimBucket,
  composeRileyUpdateEmail,
  rileyVoiceLine,
  sendRileyUpdateEmail,
  windowPhrases,
} = require("../lib/riley-update-email");
const { RILEY_DISCLOSURE } = require("../lib/riley-email-shell");
const { OPT_OUT_PROMISE } = require("../lib/opt-out-promise");
const { clientReferenceCode } = require("../lib/client-reference");
const design = require("../lib/wss-email-design");

const SLUG = "wss-test-rose-city-heating-and-air-portland";
const SITE_URL = `https://${SLUG}.wss-ai.com/`;
const WEEK = Object.freeze({ since: "2026-08-03T00:00:00.000Z", until: "2026-08-10T00:00:00.000Z" });
const ENV = Object.freeze({
  GHOST_AGENT_PHONE: "(555) 013-8420",
  GHOST_AGENCY_POSTAL_ADDRESS: "27758 Santa Margarita Pkwy #445, Mission Viejo, CA 92691",
});

function entry(kind, what, over = {}) {
  return { at: "2026-08-05T12:00:00.000Z", kind, what, proof: SITE_URL, source: { table: "t" }, ...over };
}

function mkLog(entries, over = {}) {
  return {
    ok: true,
    siteSlug: SLUG,
    siteUrl: SITE_URL,
    window: { ...WEEK },
    entries,
    sources: {},
    complete: true,
    ...over,
  };
}

/** A change list exercising both buckets and an unknown kind. */
const MIXED_ENTRIES = [
  entry("edit_done", 'Your requested change is live on your site: "Make the logo in the top corner twice as big".', {
    detail: "That's live on your site.",
  }),
  entry("rebuild", "A new version of your website was built."),
  entry("rebuild_held", "A new version was built but held back by our checks — it did not replace your live page.", {
    detail: "photo_gate: one image failed to verify",
  }),
  entry("solar_flare_shielded", "A recorded thing happened on your site."), // unknown kind
  entry("lead_captured", 'New lead from your site: Pat Doe reached out via website chat and left contact details — "Water heater quote".', {
    detail: "pat@example.com",
  }),
  entry("lead_captured", "New lead from your site: A visitor reached out via email and left contact details."),
  entry("new_conversation", "Sam Lee started a conversation on your site via text message."),
];

const compose = (entries = MIXED_ENTRIES, over = {}, opts = {}) => composeRileyUpdateEmail({
  log: mkLog(entries, over),
  businessName: "Rose City Heating & Air",
  clientId: "WSS-1F9506",
  env: ENV,
  ...opts,
});

/** The character runs a browser would paint — markup removed, entities decoded. */
function visibleText(html) {
  return String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&middot;/g, "·").replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 1. EMPTY MEANS SILENT
// ---------------------------------------------------------------------------

test("no changes -> no email: compose refuses an empty-but-complete log", () => {
  const out = compose([]);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_changes");
  assert.equal(out.html, undefined, "a refusal must not carry a rendered email");
});

test("an incomplete log is refused — entries or not — never sent as a partial digest", () => {
  const some = compose(MIXED_ENTRIES, { complete: false });
  assert.equal(some.ok, false);
  assert.equal(some.reason, "change_log_incomplete");
  const none = compose([], { complete: false });
  assert.equal(none.ok, false);
  assert.equal(none.reason, "change_log_incomplete", "empty+incomplete is UNKNOWN, not 'no changes'");
});

test("a failed or missing log is change_log_unavailable", () => {
  assert.equal(composeRileyUpdateEmail({}).reason, "change_log_unavailable");
  assert.equal(composeRileyUpdateEmail({ log: { ok: false, reason: "site_slug_invalid" } }).reason, "change_log_unavailable");
});

// ---------------------------------------------------------------------------
// 2. N IN, N OUT — the no-fabrication contract
// ---------------------------------------------------------------------------

test("a change list of N produces exactly N claims, in claims[], in the HTML, and in the text", () => {
  const out = compose();
  assert.equal(out.ok, true);
  const n = MIXED_ENTRIES.length;
  assert.equal(out.claims.length, n);
  // every claim row in the HTML is marked; there are exactly N of them
  assert.equal((out.html.match(/data-claim="/g) || []).length, n);
  // the text half carries exactly N bullets
  assert.equal((out.text.match(/^• /gm) || []).length, n);
  // and each claim's sentence appears in both halves
  const painted = visibleText(out.html);
  for (const claim of out.claims) {
    assert.ok(painted.includes(claim.text), `HTML half dropped: ${claim.text}`);
    assert.ok(out.text.includes(claim.text), `text half dropped: ${claim.text}`);
  }
});

test("subject counts are counted off the claim list, never estimated", () => {
  const out = compose();
  // 4 work entries (edit_done, rebuild, rebuild_held, unknown), 2 leads.
  assert.equal(out.counts.updates, 4);
  assert.equal(out.counts.leads, 2);
  assert.equal(out.counts.conversations, 1);
  assert.match(out.subject, /4 updates/);
  assert.match(out.subject, /2 new leads/);
  assert.match(out.subject, /this week/);
  // a single-entry log says "1 update", singular
  const one = compose([entry("rebuild", "A new version of your website was built.")]);
  assert.match(one.subject, /1 update\b/);
  assert.doesNotMatch(one.subject, /updates/);
});

test("an unknown kind is carried in the record's own words — no invented sentence", () => {
  const out = compose();
  const unknown = out.claims.find((claim) => claim.kind === "solar_flare_shielded");
  assert.equal(unknown.text, "A recorded thing happened on your site.");
  assert.equal(claimBucket("solar_flare_shielded"), "work");
  assert.ok(visibleText(out.html).includes(unknown.text));
});

test("details ride along from the record: the runner's sentence, the reason, the contact", () => {
  const out = compose();
  const painted = visibleText(out.html);
  assert.ok(painted.includes("That's live on your site."));
  assert.ok(painted.includes("photo_gate: one image failed to verify"));
  assert.ok(painted.includes("pat@example.com"));
  assert.ok(out.text.includes("(pat@example.com)"));
});

// ---------------------------------------------------------------------------
// voice + truth bounds
// ---------------------------------------------------------------------------

test("Riley speaks in the first person and quotes the customer's own ask", () => {
  const done = rileyVoiceLine(MIXED_ENTRIES[0]);
  assert.equal(done, 'You asked: "Make the logo in the top corner twice as big" — done. It\'s live on your site.');
  // and the whole email reads like her, not like a deployment report
  const painted = visibleText(compose().html);
  assert.ok(painted.includes("it's Riley"));
  for (const jargon of [/deployed/i, /deployment/i, /modification/i, /\bper your request\b/i, /following changes were/i]) {
    assert.doesNotMatch(painted, jargon);
  }
});

test("each template claims at most what its kind's record supports", () => {
  // rebuild covers built-not-published AND republished -> may not say live/replaced
  const rebuild = rileyVoiceLine(entry("rebuild", "A new version of your website was built."));
  assert.doesNotMatch(rebuild, /live|replac|publish/i);
  // refused: the site was left alone, and that is the claim
  assert.match(rileyVoiceLine(entry("edit_refused", 'We did not make this change, and your site was left as it was: "x".')), /left your site exactly as it was/);
  // failed: claims nothing about the state of the site
  const failed = rileyVoiceLine(entry("edit_failed", 'A change you asked for did not go through: "x".'));
  assert.doesNotMatch(failed, /site (?:is|was|stayed)|live/i);
  // held: every held source records non-publication, so "stayed put" is allowed
  assert.match(rileyVoiceLine(entry("rebuild_held", "…")), /stayed put/);
  // incomplete: stops at "stopped" — no claim either way
  assert.doesNotMatch(rileyVoiceLine(entry("rebuild_incomplete", "…")), /live|publish|site (?:is|was)/i);
  // done IS allowed to say live — the runner render-verified it
  assert.match(rileyVoiceLine(entry("edit_done", "Your requested change is live on your site: a change you asked for.")), /live on your site/);
});

// ---------------------------------------------------------------------------
// structure: greeting, proof links, people, one next step, sign-off
// ---------------------------------------------------------------------------

test("the greeting carries the business name; without one it is never 'Hi there'", () => {
  const named = compose();
  assert.ok(visibleText(named.html).includes("Hi Rose City Heating & Air — it's Riley."));
  const nameless = composeRileyUpdateEmail({ log: mkLog(MIXED_ENTRIES), env: ENV });
  assert.ok(visibleText(nameless.html).includes("Hi — it's Riley."));
  assert.doesNotMatch(visibleText(nameless.html), /\bHi there\b/i);
});

test("every claim row links to its recorded proof page", () => {
  const out = compose();
  const workRows = out.claims.filter((claim) => claim.bucket === "work");
  const links = (out.html.match(new RegExp(`<a href="${SITE_URL.replace(/[/.]/g, "\\$&")}"`, "g")) || []).length;
  assert.ok(links >= workRows.length, `expected at least ${workRows.length} proof links, saw ${links}`);
  // and the raw URL is never painted as visible text (it lives in href only)
  assert.doesNotMatch(visibleText(out.html), /https?:\/\//);
});

test("the people section exists only when people actually reached out, with a counted headline", () => {
  const withPeople = compose();
  assert.ok(visibleText(withPeople.html).includes("3 people messaged your site this week — the messages are in your inbox."));
  const workOnly = compose(MIXED_ENTRIES.filter((item) => claimBucket(item.kind) === "work"));
  assert.doesNotMatch(visibleText(workOnly.html), /messaged your site/);
  assert.doesNotMatch(workOnly.text, /messaged your site/);
  // one person, singular
  const onePerson = compose([MIXED_ENTRIES[0], MIXED_ENTRIES[4]]);
  assert.ok(visibleText(onePerson.html).includes("1 person messaged your site"));
});

test("there is exactly one next step, and it offers reply plus the call line", () => {
  const out = compose();
  const painted = visibleText(out.html);
  assert.equal((painted.match(/Reply to this email with the next thing you want changed/g) || []).length, 1);
  assert.ok(painted.includes("or call me at (555) 013-8420"));
  // the Riley line is voice-only — "text" must not be promised anywhere
  assert.doesNotMatch(painted, /call or text/i);
  assert.doesNotMatch(out.text, /call or text/i);
});

test("the sign-off carries the phone line, the dashboard link, and the Client ID as their login", () => {
  const out = compose();
  const painted = visibleText(out.html);
  assert.ok(out.html.includes(`href="${DASHBOARD_URL}"`));
  assert.ok(painted.includes("wss-ai.com/dashboard"));
  assert.ok(painted.includes("Call Riley: (555) 013-8420"));
  assert.ok(out.html.includes("tel:+15550138420"));
  assert.ok(painted.includes("Client ID: WSS-1F9506"));
  assert.ok(out.text.includes("Client ID: WSS-1F9506"));
  assert.ok(out.text.includes(DASHBOARD_URL));
});

test("no phone configured -> the call line omits itself; no Client ID -> no Client ID label", () => {
  const out = composeRileyUpdateEmail({ log: mkLog(MIXED_ENTRIES), businessName: "Rose City Heating & Air", env: {} });
  assert.equal(out.meta.phone, null);
  assert.doesNotMatch(out.html, /tel:/);
  assert.doesNotMatch(visibleText(out.html), /Call Riley/);
  assert.doesNotMatch(visibleText(out.html), /Client ID/);
  assert.doesNotMatch(out.text, /Client ID/);
  // the next step still stands on the reply path alone, with no hole
  assert.ok(visibleText(out.html).includes("Reply to this email with the next thing you want changed — I'll take it from there."));
});

// ---------------------------------------------------------------------------
// the shared brand, both halves agreeing
// ---------------------------------------------------------------------------

test("the look comes from lib/wss-email-design.js and honors the design lock", () => {
  const out = compose();
  assert.ok(out.html.includes(design.WSS_MARK_URL));
  assert.ok(out.html.includes(design.PALETTE.page));
  assert.ok(out.html.includes(design.PALETTE.ink));
  assert.ok(out.html.includes(design.PALETTE.accent));
  assert.ok(out.html.includes(design.cardStyle()));
  for (const hex of design.FORBIDDEN_HEX) {
    assert.doesNotMatch(out.html, new RegExp(hex, "i"));
  }
});

test("it is email HTML, not web HTML, and both halves carry the disclosure and the promise", () => {
  const out = compose();
  assert.doesNotMatch(out.html, /<style[\s>]/i);
  assert.doesNotMatch(out.html, /@media/i);
  assert.doesNotMatch(out.html, /position:\s*absolute/i);
  assert.doesNotMatch(out.html, /display:\s*(?:flex|grid)/i);
  assert.doesNotMatch(out.html, /<link\b/i);
  for (const [tag] of out.html.matchAll(/<table\b[^>]*>/gi)) {
    assert.match(tag, /role="presentation"/);
  }
  for (const half of [visibleText(out.html), out.text]) {
    assert.ok(half.includes(RILEY_DISCLOSURE), "the AI disclosure ships in both halves");
    assert.ok(half.includes(OPT_OUT_PROMISE), "the opt-out promise ships in both halves");
    assert.ok(half.includes("Woodward Software Systems"));
    assert.ok(half.includes(ENV.GHOST_AGENCY_POSTAL_ADDRESS));
  }
});

// ---------------------------------------------------------------------------
// 4. RENDERS AT 680 AND 390 — the structural width contract
// ---------------------------------------------------------------------------

test("the container is 680 and fluid; nothing else is wider than a phone column", () => {
  const out = compose();
  assert.match(out.html, /width="680" style="max-width:680px;width:100%"/);
  // width attributes: exactly one 680; every other fixed cell is a narrow
  // marker/rule column a 390 viewport fits with room to spare
  const attrWidths = [...out.html.matchAll(/width="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(attrWidths.filter((w) => w === 680).length, 1);
  for (const w of attrWidths) assert.ok(w === 680 || w <= 60, `fixed width ${w} cannot fit a 390 viewport beside text`);
  // inline pixel widths obey the same bound
  for (const [, px] of out.html.matchAll(/width:(\d+(?:\.\d+)?)px/g)) {
    const w = Number(px);
    assert.ok(w === 680 || w <= 60, `inline width ${w}px cannot fit a 390 viewport`);
  }
  // percentage tables stay fluid
  assert.ok(out.html.includes('width="100%"'));
});

test("no declaration or text run can force a sideways scroll at 390", () => {
  const out = compose();
  assert.doesNotMatch(out.html, /min-width/i);
  assert.doesNotMatch(out.html, /white-space:\s*nowrap/i);
  // no unbreakable visible run longer than a 390 column can paint
  for (const token of visibleText(out.html).split(/\s+/)) {
    assert.ok(token.length <= 40, `unbreakable run would overflow 390px: ${token}`);
  }
  // long record details are allowed to break mid-word rather than overflow
  assert.ok(out.html.includes("word-break:break-word"));
});

// ---------------------------------------------------------------------------
// 3. THE SEND PATH AND THE LOCK
// ---------------------------------------------------------------------------

function sendDeps({ log = mkLog(MIXED_ENTRIES), prospect, sendResult } = {}) {
  const calls = { changeLog: [], select: [], sends: [] };
  const deps = {
    env: ENV,
    siteChangeLog: async (options) => { calls.changeLog.push(options); return log; },
    select: async (table, query) => {
      calls.select.push({ table, query });
      if (table === "ghost_agency_prospects") {
        return { ok: true, mode: "live_select", data: prospect ? [prospect] : [] };
      }
      return { ok: true, mode: "live_select", data: [] };
    },
    sendResendEmail: async (input) => {
      calls.sends.push(input);
      return sendResult || { mode: "sent", id: "re_riley_update_1" };
    },
  };
  return { deps, calls };
}

const PROSPECT = Object.freeze({
  prospect_id: "p_rose_city_1",
  business_name: "Rose City Heating & Air",
  site_slug: SLUG,
});

test("a real send goes to the owner only, transactional, with the composed message", async () => {
  const { deps, calls } = sendDeps({ prospect: PROSPECT });
  const result = await sendRileyUpdateEmail({ siteSlug: SLUG, windowMs: 7 * 24 * 60 * 60 * 1000 }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "sent");
  assert.equal(result.claims, MIXED_ENTRIES.length);
  assert.equal(calls.sends.length, 1);
  const sent = calls.sends[0];
  assert.equal(sent.to, RILEY_UPDATE_RECIPIENT);
  assert.deepEqual(sent.cc, []);
  assert.deepEqual(sent.bcc, []);
  assert.equal(sent.senderKind, "transactional");
  assert.match(sent.subject, /^Riley — /);
  // the prospect row fed the greeting and the derived Client ID
  assert.ok(visibleText(sent.html).includes("Hi Rose City Heating & Air — it's Riley."));
  assert.ok(visibleText(sent.html).includes(`Client ID: ${clientReferenceCode(PROSPECT)}`));
});

test("the recipient lock refuses any other address BEFORE reading a single record", async () => {
  const { deps, calls } = sendDeps({ prospect: PROSPECT });
  const result = await sendRileyUpdateEmail({ siteSlug: SLUG, to: "owner@prospect-business.com" }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "recipient_not_allowed");
  assert.equal(calls.changeLog.length, 0, "the lock must fire before the change log is read");
  assert.equal(calls.sends.length, 0);
  // the owner address itself passes the lock regardless of case
  const upper = await sendRileyUpdateEmail({ siteSlug: SLUG, to: RILEY_UPDATE_RECIPIENT.toUpperCase(), dryRun: true }, deps);
  assert.equal(upper.ok, true);
});

test("an empty or incomplete week refuses to send, and the mailer is never called", async () => {
  const empty = sendDeps({ log: mkLog([]) });
  const emptyResult = await sendRileyUpdateEmail({ siteSlug: SLUG }, empty.deps);
  assert.equal(emptyResult.ok, false);
  assert.equal(emptyResult.blocked, "no_changes");
  assert.equal(empty.calls.sends.length, 0);

  const partial = sendDeps({ log: mkLog(MIXED_ENTRIES, { complete: false }) });
  const partialResult = await sendRileyUpdateEmail({ siteSlug: SLUG }, partial.deps);
  assert.equal(partialResult.blocked, "change_log_incomplete");
  assert.equal(partial.calls.sends.length, 0);

  const broken = sendDeps({ log: { ok: false, reason: "site_slug_invalid", entries: [] } });
  const brokenResult = await sendRileyUpdateEmail({ siteSlug: "Bad Slug!" }, broken.deps);
  assert.equal(brokenResult.blocked, "change_log_unavailable");
  assert.equal(broken.calls.sends.length, 0);
});

test("dryRun composes the full email and sends nothing — the samples lane", async () => {
  const { deps, calls } = sendDeps({ prospect: PROSPECT });
  const result = await sendRileyUpdateEmail({ siteSlug: SLUG, dryRun: true }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "composed");
  assert.ok(result.html.includes("<!doctype html>"));
  assert.ok(result.text.includes("— Riley"));
  assert.equal(calls.sends.length, 0);
});

test("an unconfigured mailer is reported honestly, not counted as sent", async () => {
  const { deps } = sendDeps({ prospect: PROSPECT, sendResult: { mode: "dry_run", configured: false } });
  const result = await sendRileyUpdateEmail({ siteSlug: SLUG }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "resend_not_configured");
});

test("a missing prospect row degrades the greeting and drops the Client ID — it never blocks or invents", async () => {
  const { deps, calls } = sendDeps({ prospect: null });
  const result = await sendRileyUpdateEmail({ siteSlug: SLUG, dryRun: true }, deps);
  assert.equal(result.ok, true);
  assert.ok(visibleText(result.html).includes("Hi — it's Riley."));
  assert.doesNotMatch(visibleText(result.html), /Client ID/);
  // both lookups were tried — site_slug first, then the preview_url fallback
  const queries = calls.select.filter((c) => c.table === "ghost_agency_prospects").map((c) => c.query);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /site_slug=eq\./);
  assert.match(queries[1], /preview_url=eq\./);
});

test("a prospect keyed only by preview_url still names the greeting — the fallback lookup", async () => {
  const calls = { sends: [] };
  const deps = {
    env: ENV,
    siteChangeLog: async () => mkLog(MIXED_ENTRIES),
    select: async (table, query) => {
      if (table === "ghost_agency_prospects" && /preview_url=eq\./.test(query)) {
        return { ok: true, mode: "live_select", data: [PROSPECT] };
      }
      return { ok: true, mode: "live_select", data: [] };
    },
    sendResendEmail: async (input) => { calls.sends.push(input); return { mode: "sent", id: "re_2" }; },
  };
  const result = await sendRileyUpdateEmail({ siteSlug: SLUG, dryRun: true }, deps);
  assert.equal(result.ok, true);
  assert.ok(visibleText(result.html).includes("Hi Rose City Heating & Air — it's Riley."));
});

// ---------------------------------------------------------------------------
// window words
// ---------------------------------------------------------------------------

test("the window is named in words, and an unparseable window is omitted, not invented", () => {
  assert.deepEqual(windowPhrases({ since: "2026-08-09T00:00:00.000Z", until: "2026-08-10T00:00:00.000Z" }), {
    label: "in the last 24 hours",
    tag: "today",
  });
  assert.deepEqual(windowPhrases(WEEK), { label: "this week", tag: "this week" });
  assert.deepEqual(windowPhrases({ since: "2026-07-01T00:00:00.000Z", until: "2026-08-10T00:00:00.000Z" }), {
    label: "since Jul 1",
    tag: "since Jul 1",
  });
  assert.deepEqual(windowPhrases({}), { label: "", tag: "" });
  const dayless = composeRileyUpdateEmail({ log: mkLog(MIXED_ENTRIES, { window: {} }), env: ENV });
  assert.equal(dayless.ok, true);
  assert.doesNotMatch(dayless.subject, /this week|today/);
});
