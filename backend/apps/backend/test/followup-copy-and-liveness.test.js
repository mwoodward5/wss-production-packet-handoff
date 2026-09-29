"use strict";

// ---------------------------------------------------------------------------
// THE FOLLOW-UPS: NEW COPY, AND THE CLAIM IT MAKES.
//
// Two changes, one subject.
//
// 1. THE COPY (owner-approved, 2026-08-10). Steps 2 and 3 of the cold sequence
//    were written in the first person, signed by a named founder, and opened
//    with "Just following up" — three separate violations of the owner's own
//    standing rules for cold outreach, all of which survived the proof-first
//    migration because that migration edited the CLAIM and not the VOICE. The
//    replacement speaks as WSS Labs, states the one fact that matters, and asks
//    for one thing.
//
// 2. THE CLAIM IN IT. Both new bodies assert, in the present tense, that the
//    preview is available. Nothing verified that. A follow-up goes out five days
//    after step 1 and the last one fourteen; the preview lives on a per-prospect
//    Vercel project, and 240 of those were deleted in a single purge on
//    2026-07-29 without touching one stored preview_url. So the follow-up path
//    now asks the host, and a non-200 refuses the send.
//
// These tests assert against the SHIPPED constants and the SHIPPED send path.
// Pasting the expected copy into a test and comparing it to a second paste is
// exactly how the banned phrases survived three previous edits.
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const {
  render,
  SEQUENCES,
  PROOF_FOLLOWUP_SUBJECT,
  PROOF_FOLLOWUP_BODY,
  PROOF_FINAL_NOTE_SUBJECT,
  PROOF_FINAL_NOTE_BODY,
} = require("../lib/email-templates");
const {
  checkPreviewLive,
  clearPreviewLivenessCache,
  probeTarget,
} = require("../lib/preview-liveness");

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const emailPath = require.resolve("../lib/email");
const storePath = require.resolve("../lib/store");
let emailWithKnownCleanSuppression;

function loadEmailWithKnownCleanSuppression() {
  if (emailWithKnownCleanSuppression) return emailWithKnownCleanSuppression;
  const priorStoreModule = require.cache[storePath];
  const realStore = require("../lib/store");
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      ...realStore,
      select: async (table, query) => table === "ghost_agency_suppressions"
        ? { ok: true, data: [] }
        : realStore.select(table, query),
    },
  };
  delete require.cache[emailPath];
  emailWithKnownCleanSuppression = require("../lib/email");
  if (priorStoreModule) require.cache[storePath] = priorStoreModule;
  else delete require.cache[storePath];
  return emailWithKnownCleanSuppression;
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  globalThis.fetch = originalFetch;
  clearPreviewLivenessCache();
});

const VARS = Object.freeze({
  business_name: "Harbor Ridge Roofing",
  city: "Ventura",
  industry: "roofing",
  sender_name: "Mark Woodward",
  sender_phone: "(949) 339-5562",
});

// ---------------------------------------------------------------------------
// PART 1 — THE COPY
// ---------------------------------------------------------------------------

test("steps 2 and 3 render the approved copy, verbatim, with every merge field filled", () => {
  const step2 = render(1, 2, VARS);
  assert.equal(step2.missing.length, 0, JSON.stringify(step2.missing));
  assert.equal(step2.subject, "Did you see the site we built?");
  assert.equal(
    step2.body,
    [
      "The website WSS Labs built for Harbor Ridge Roofing is ready to review. The work is already done in the preview, so you can judge the site itself before paying anything.",
      "",
      "Reply PASS and we will take it down.",
      "",
      "WSS Labs",
    ].join("\n"),
  );

  const step3 = render(1, 3, VARS);
  assert.equal(step3.missing.length, 0, JSON.stringify(step3.missing));
  assert.equal(step3.subject, "Final email about the Harbor Ridge Roofing site");
  assert.equal(
    step3.body,
    [
      "WSS Labs built a website for Harbor Ridge Roofing and kept the preview available for review. This is our final email about it.",
      "",
      "Reply PASS and we will take it down.",
      "",
      "WSS Labs",
    ].join("\n"),
  );

  // Identity, not resemblance: the sequence table must resolve from the exported
  // constants rather than carry a parallel copy of the same words.
  assert.equal(SEQUENCES["1"].steps["2"].subject, PROOF_FOLLOWUP_SUBJECT);
  assert.equal(SEQUENCES["1"].steps["2"].body, PROOF_FOLLOWUP_BODY);
  assert.equal(SEQUENCES["1"].steps["3"].subject, PROOF_FINAL_NOTE_SUBJECT);
  assert.equal(SEQUENCES["1"].steps["3"].body, PROOF_FINAL_NOTE_BODY);
});

test("no founder, no first person, no banned cliche, and no link in the text half", () => {
  for (const step of [2, 3]) {
    const { subject, body } = render(1, step, VARS);
    const whole = `${subject}\n${body}`;

    // 1. NO FOUNDER. Not the name, not the merge token that produces it, not the
    //    city that only ever appeared in his sign-off.
    assert.doesNotMatch(whole, /Mark Woodward|Mission Viejo/i, `step ${step} signs a founder`);
    assert.doesNotMatch(
      `${SEQUENCES["1"].steps[String(step)].subject}\n${SEQUENCES["1"].steps[String(step)].body}`,
      /\{\{sender_name\}\}|\{\{sender_phone\}\}/,
      `step ${step} still carries a founder merge token`,
    );

    // 2. NO FIRST PERSON. The sender is a company; "I built you a site" is the
    //    voice this rewrite exists to remove.
    assert.doesNotMatch(whole, /\bI\b|\bI'(?:m|ve|ll|d)\b|\bmy\b|\bme\b|\bmine\b/i,
      `step ${step} speaks in the first person singular`);

    // 3. NO CLICHE. "Just following up" is the first entry on the banned list and
    //    was the literal opening line of the retired step 2.
    assert.doesNotMatch(whole, /following up/i, `step ${step} still opens with the banned cliche`);

    // 4. NO LINK. The text half is link-free by design; the HTML half carries the
    //    preview button. (Also pinned globally by test/outreach-email-v2.js.)
    assert.doesNotMatch(body, /https?:\/\/|www\.|wss-ai\.com/i, `step ${step} put a URL in the text half`);

    // 5. NO INVENTED DEADLINE. Nothing expires, nothing comes down on a date.
    assert.doesNotMatch(whole, /expir|deadline|by (?:friday|monday|tomorrow)|last chance|24 hours/i,
      `step ${step} invented urgency`);

    // 6. ONE ACTION.
    assert.equal((body.match(/Reply /g) || []).length, 1, `step ${step} asks for more than one thing`);
  }
});

// ---------------------------------------------------------------------------
// "FINAL EMAIL" HAS TO BE TRUE
// ---------------------------------------------------------------------------

test('step 3 can call itself the final email: there is no step 4 anywhere', () => {
  // 1. The table has three steps and no more.
  assert.deepEqual(Object.keys(SEQUENCES["1"].steps).sort(), ["1", "2", "3"]);

  // 2. There is no copy for a fourth, and asking for one throws rather than
  //    falling back to step 3's words under a fresh send.
  assert.throws(() => render(1, 4, VARS), /unknown_sequence_step:1\.4/);

  // 3. Both schedulers stop. Neither exports its planner, so this is asserted at
  //    the source — the loop that advances the sequence and the terminal reason
  //    it returns. A future edit that adds a step 4 has to touch these lines.
  const fs = require("node:fs");
  for (const file of ["../api/cron/drip-scheduler.js", "../api/admin/run-campaign.js"]) {
    const source = fs.readFileSync(require.resolve(file), "utf8");
    assert.match(source, /for \(const step of \[2, 3\]\)/, `${file} no longer stops at step 3`);
    assert.match(source, /sequence_complete/, `${file} lost its terminal state`);
    assert.doesNotMatch(source, /\[2, 3, 4\]/, `${file} advances past step 3`);
  }
});

test("even a hand-driven step 4 cannot be composed, let alone sent", async () => {
  // api/outreach/email-sequence.js takes `step` straight off the request body,
  // so "the schedulers stop at 3" is not by itself the whole answer. The send
  // path refuses a fourth step outright rather than reusing step 3's words under
  // a fresh delivery — which is what makes "this is our final email" true even
  // for an operator holding the admin endpoint.
  process.env.EMAIL_UNSUB_SECRET = "followup-liveness-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: {
      prospect_id: "harbor-ridge-step-four",
      business_name: "Harbor Ridge Roofing",
      email: "owner@harborridgeroofing.com",
      preview_url: PREVIEW,
      current_website: "https://harborridgeroofing.com/",
    },
    sequence: 1,
    step: 4,
    dryRun: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "template_error");
  assert.equal(result.error, "unknown_sequence_step:1.4");
});

// ---------------------------------------------------------------------------
// PART 2 — THE LIVENESS PROBE, ON ITS OWN
// ---------------------------------------------------------------------------

const PREVIEW = "https://harbor-ridge-roofing.wss-ai.com/";

function stubFetch({ status = 200, throws = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options && options.method });
    if (throws) throw new Error("getaddrinfo ENOTFOUND");
    return { status, ok: status === 200, body: null };
  };
  return calls;
}

test("checkPreviewLive is true for a 200 and false for everything else", async () => {
  const ok = stubFetch({ status: 200 });
  assert.deepEqual(
    await checkPreviewLive({ url: PREVIEW }),
    { ok: true, status: 200, reason: "", cached: false, url: PREVIEW },
  );
  assert.equal(ok.length, 1);
  assert.equal(ok[0].method, "GET", "the reader's browser issues a GET; so do we");

  clearPreviewLivenessCache();
  stubFetch({ status: 404 });
  const dead = await checkPreviewLive({ url: PREVIEW });
  assert.equal(dead.ok, false);
  assert.equal(dead.reason, "http_404");
  assert.equal(dead.status, 404);

  clearPreviewLivenessCache();
  stubFetch({ status: 503 });
  assert.equal((await checkPreviewLive({ url: PREVIEW })).reason, "http_503");

  // FAIL CLOSED ON A NETWORK ERROR. "We could not tell" and "it is down" have
  // the same correct consequence when the alternative is claiming it is up.
  clearPreviewLivenessCache();
  stubFetch({ throws: true });
  const broken = await checkPreviewLive({ url: PREVIEW });
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, "fetch_failed");

  // And when there is no transport at all.
  clearPreviewLivenessCache();
  globalThis.fetch = undefined;
  assert.equal((await checkPreviewLive({ url: PREVIEW })).reason, "fetch_unavailable");
});

test("checkPreviewLive times out rather than hanging a send", async () => {
  clearPreviewLivenessCache();
  globalThis.fetch = (url, options) => new Promise((resolve) => {
    // A transport that ignores the abort signal entirely — the case the race in
    // lib/preview-liveness.js exists for. Without it this promise never settles
    // and the send hangs to the lambda's own timeout.
    void options;
    setTimeout(() => resolve({ status: 200, body: null }), 5000).unref?.();
  });
  const started = Date.now();
  const result = await checkPreviewLive({ url: PREVIEW, timeoutMs: 50 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
  assert.ok(Date.now() - started < 4000, "the probe did not honour its own ceiling");
});

test("the probe refuses to request anything that is not an approved preview host", async () => {
  const calls = stubFetch({ status: 200 });
  for (const hostile of [
    "http://harbor-ridge-roofing.wss-ai.com/",        // not https
    "https://wss-ai.com.evil.test/",                  // suffix spoof
    "https://attacker.test/preview",                  // someone else entirely
    "https://user:pw@harbor-ridge-roofing.wss-ai.com/", // credentials in the URL
    "http://169.254.169.254/latest/meta-data/",       // the classic
    "",
  ]) {
    clearPreviewLivenessCache();
    const result = await checkPreviewLive({ url: hostile });
    assert.equal(result.ok, false, `probed ${hostile}`);
    assert.equal(result.reason, "no_probeable_preview_url", `probed ${hostile}`);
  }
  assert.equal(calls.length, 0, "a stored field became an outbound request to a host we do not control");
  assert.equal(probeTarget("https://harbor-ridge-roofing.wss-ai.com/"), PREVIEW);
});

test("one host is asked once per batch — failures are cached too", async () => {
  clearPreviewLivenessCache();
  const calls = stubFetch({ status: 404 });
  const first = await checkPreviewLive({ url: PREVIEW });
  const second = await checkPreviewLive({ url: PREVIEW });
  assert.equal(calls.length, 1, "a dead host was hammered twice in one batch");
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.reason, "http_404");

  // ...and the entry expires, so a warm lambda re-reads a host that came back.
  const expired = await checkPreviewLive({ url: PREVIEW, ttlMs: 1, now: () => Date.now() + 1000 });
  assert.equal(expired.cached, false);
  assert.equal(calls.length, 2);
});

// ---------------------------------------------------------------------------
// PART 2 — THE PROBE ON THE SEND PATH
// ---------------------------------------------------------------------------

const OWNER = "owner@wss-ai.com";

// THE SEND PATH, DRIVEN FOR REAL (dryRun: false) BUT INCAPABLE OF DELIVERING.
//
// The liveness gate only runs on a real send, so a dry run cannot exercise it.
// Three independent things make this safe, and all three are asserted or set
// here rather than assumed:
//   · internalOwnerProof forces the recipient gate to the configured owner
//     address — a prospect address is refused outright (owner_proof_recipient_
//     gate_failed), so no test can address a business;
//   · GHOST_AGENCY_OUTREACH_FROM is deleted, so outreachFromStatus() fails the
//     send before any provider call; and
//   · RESEND_API_KEY is deleted behind it.
// The gate under test sits ABOVE all of that, so a pass shows up as a DIFFERENT
// downstream refusal — which is exactly the assertion.
function configureOwnerProofEnvironment() {
  process.env.EMAIL_UNSUB_SECRET = "followup-liveness-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@wss-ai.com";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  process.env.GHOST_AGENCY_OWNER_EMAIL = OWNER;
  delete process.env.GHOST_AGENCY_REVIEW_HOLD;
  delete process.env.GHOST_AGENCY_OUTREACH_FROM;
  delete process.env.RESEND_API_KEY;
  delete process.env.GHOST_AGENCY_PROOF_EMAIL_V3;
}

function ownerProofProspect(overrides = {}) {
  return {
    prospect_id: "harbor-ridge-liveness",
    business_name: "Harbor Ridge Roofing",
    city: "Ventura",
    industry: "roofing",
    email: OWNER,
    preview_url: PREVIEW,
    current_website: "https://harborridgeroofing.com/",
    before_shot_source_url: "https://www.harborridgeroofing.com/",
    ...overrides,
  };
}

async function sendForReal(step) {
  configureOwnerProofEnvironment();
  const { sendSequenceStep } = loadEmailWithKnownCleanSuppression();
  return sendSequenceStep({
    prospect: ownerProofProspect(),
    sequence: 1,
    step,
    dryRun: false,
    internalOwnerProof: true,
  });
}

test("a dead preview blocks steps 2 and 3 with the reason, and composes nothing", async () => {
  for (const step of [2, 3]) {
    clearPreviewLivenessCache();
    const calls = stubFetch({ status: 404 });
    const result = await sendForReal(step);

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.blocked, "preview_not_live", JSON.stringify(result));
    assert.equal(result.detail.reason, "http_404");
    assert.equal(result.detail.status, 404);
    assert.equal(result.detail.checked, true);
    assert.match(result.message, /did not answer 200/);
    // The refusal happens BEFORE composition, like every gate above it.
    assert.equal(result.htmlPreview, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, PREVIEW);
  }

  // A host that cannot be reached at all fails exactly the same way.
  for (const step of [2, 3]) {
    clearPreviewLivenessCache();
    stubFetch({ throws: true });
    const result = await sendForReal(step);
    assert.equal(result.blocked, "preview_not_live");
    assert.equal(result.detail.reason, "fetch_failed");
  }
});

test("a live preview passes the gate and the send continues past it", async () => {
  for (const step of [2, 3]) {
    clearPreviewLivenessCache();
    const calls = stubFetch({ status: 200 });
    const result = await sendForReal(step);

    assert.equal(calls.length, 1, `step ${step} did not probe the preview`);
    assert.equal(calls[0].url, PREVIEW);
    assert.notEqual(result.blocked, "preview_not_live", JSON.stringify(result));
    // It got past this gate and stopped at the next one down — the deliberately
    // unconfigured outreach sender. That is the proof it was not blocked here.
    assert.equal(result.blocked, "outreach_sender_not_ready", JSON.stringify(result));
  }
});

test("step 1 is untouched by the new check — it never probes and never blocks on it", async () => {
  clearPreviewLivenessCache();
  // A stub that would fail the gate outright IF step 1 consulted it.
  const calls = stubFetch({ status: 404 });
  const result = await sendForReal(1);

  assert.equal(calls.length, 0, "step 1 spent an outbound request it does not need");
  assert.notEqual(result.blocked, "preview_not_live");
  assert.equal(result.blocked, "outreach_sender_not_ready", JSON.stringify(result));

  // Step 1's own proof gates are the ones still standing guard for it.
  configureOwnerProofEnvironment();
  const { sendSequenceStep } = require("../lib/email");
  const noPreview = await sendSequenceStep({
    prospect: ownerProofProspect({ preview_url: "", reveal_url: "" }),
    sequence: 1,
    step: 1,
    dryRun: false,
    internalOwnerProof: true,
  });
  assert.equal(noPreview.blocked, "no_preview_url");
});

test("a dry run probes nothing and says so instead of implying a pass", async () => {
  configureOwnerProofEnvironment();
  const calls = stubFetch({ status: 404 });
  const { sendSequenceStep } = require("../lib/email");
  for (const step of [2, 3]) {
    const result = await sendSequenceStep({
      prospect: ownerProofProspect(),
      sequence: 1,
      step,
      dryRun: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.previewLiveness, { checked: false, reason: "dry_run" });
  }
  assert.equal(calls.length, 0, "composing a dry-run email must not reach the network");
});
