"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { verifyUnsubscribeToken } = require("../lib/unsubscribe");
// Which composer renders step 1. Read from the same function lib/email.js
// branches on, so the assertions below cannot drift from the shipped lane.
const { proofEmailV3Enabled } = require("../lib/proof-email-inputs");

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  global.fetch = originalFetch;
}

function consentProspect(email, overrides = {}) {
  return {
    prospect_id: "recipient-hygiene-1",
    business_name: "Roofing Example",
    email,
    city: "Irvine",
    industry: "roofing",
    ...overrides,
  };
}

/**
 * PROOF-FIRST FIXTURE (added 2026-07-31 with the consent-first -> proof-first
 * migration). Sequence 1 now REFUSES to compose without a preview it can prove
 * belongs to this prospect and a "before" shot recorded as having been captured
 * from this prospect's own domain. Tests below that are about something else
 * entirely — recipient hygiene, the owner lock, artifact isolation — have to
 * clear that gate first, so they build on this shape.
 *
 * This is the strengthened contract SUPPLIED, not an assertion relaxed: every
 * one of these fields is a real thing lib/email.js checks, and the checks
 * themselves are asserted in test/security-contracts.test.js and
 * test/before-image-identity.test.js.
 */
function provableProspect(email, overrides = {}) {
  return consentProspect(email, {
    preview_url: "https://roofing-example.wss-ai.com/",
    current_website: "https://roofing-example.example/",
    before_shot_source_url: "https://www.roofing-example.example/",
    ...overrides,
  });
}

function readableText(html = "") {
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/(?:&#39;|&#x27;|&apos;)/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

afterEach(restoreEnvironment);

test("sendSequenceStep blocks a stale telemetry recipient before any provider call", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("network must not be reached");
  };
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: consentProspect("605@sentry-next.wixpress.com"),
    dryRun: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "invalid_recipient_email");
  assert.match(result.message, /No email was sent/i);
  assert.equal(calls, 0);
});

test("a prospect on the suppression list is skipped by the generator", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  let providerCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes("ghost_agency_suppressions")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [{
          suppression_key: "roofing@example.org",
          email: "roofing@example.org",
          prospect_id: "recipient-hygiene-1",
        }],
      };
    }
    providerCalls += 1;
    throw new Error("suppressed recipient must not reach another provider");
  };

  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: consentProspect("roofing@example.org"),
    dryRun: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "suppressed");
  assert.equal(providerCalls, 0);
});

// SECURITY INVARIANT — UNCHANGED ASSERTION (2026-07-31).
//
// This test did not move an inch. What moved is lib/email.js: the owner lock
// used to sit BELOW composition, so once the proof-first gate landed, a
// prospect with no build was refused for "no_preview_url" and the authorization
// decision was never reached. Nothing shipped either way — no provider call is
// made — but a lock that is never evaluated is not a lock, and the operator has
// to be told the real reason. The check now runs immediately after the
// suppression lookup, before any composition. See the AUTHORIZATION BEFORE
// CONTENT block in lib/email.js.
test("live prospect delivery stays owner-locked until explicitly enabled", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  delete process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED;
  let nonSuppressionCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes("ghost_agency_suppressions")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [],
      };
    }
    nonSuppressionCalls += 1;
    throw new Error("owner-locked prospect must not reach another provider");
  };

  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: consentProspect("roofing@example.org"),
    dryRun: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "prospect_sends_disabled");
  assert.equal(nonSuppressionCalls, 0);
});

// MIGRATED 2026-07-31. Was "sendSequenceStep composes the consent offer without
// any prebuilt site or report" — the whole premise ("without a prebuilt site")
// is the policy the owner reversed, and the send now REFUSES in that state.
// Everything this test actually guards is unchanged and asserted below: the
// recipient is normalised and masked, the unsubscribe token round-trips to the
// canonical address, the postal address is present, and the exact STOP promise
// is visible. Only the offer sentence and the subject moved.
test("sendSequenceStep composes the proof email with a canonical recipient and a valid unsubscribe token", async () => {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: provableProspect("%20roofing@example.org"),
    sequence: 1,
    step: 1,
    dryRun: true,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.to, "roo***");
  assert.match(result.subject, /Roofing Example/);
  assert.doesNotMatch(result.subject, /talk to your website and it changes/i);
  assert.equal(result.previewExpiresOn, null);

  const tokenMatch = result.htmlPreview.match(/\/api\/outreach\/unsubscribe\?t(?:=|&#61;)([^"&\s]+)/);
  assert.ok(tokenMatch, "the composed email must carry an unsubscribe token");
  assert.equal(verifyUnsubscribeToken(tokenMatch[1]).data.email, "roofing@example.org");

  const text = readableText(result.htmlPreview);
  // THE OFFER SENTENCE MOVED AGAIN (2026-08-07), exactly as the header note
  // above anticipated: step 1 now composes through lib/outreach-email-v3.js
  // when GHOST_AGENCY_PROOF_EMAIL_V3 is on. What this test GUARDS is unchanged
  // and is asserted below the fold — the masked recipient, the unsubscribe
  // token round-tripping to the canonical address, the postal address, and the
  // exact STOP promise. Those four are the reason the test exists.
  //
  // The two copy assertions are kept, per lane, because they are still worth
  // something: the email must address this business by name and must make the
  // proof-first claim. Neither composer may quietly stop doing either.
  if (proofEmailV3Enabled()) {
    assert.match(text, /Roofing Example, we already built your new website\./);
    assert.match(text, /It is live right now\./);
  } else {
    assert.match(text, /Hi Roofing Example team,/);
    assert.match(text, /I went ahead and rebuilt the site as a free live preview/);
    assert.match(text, /Your current website is untouched/);
  }
  assert.match(text, /123 Real St, Irvine, CA 92618/);
  assert.match(text, /Not interested\? Reply STOP and you won't hear from me again\./);
});

// MIGRATED 2026-07-31. Was "provider-bound composition drops stale preview,
// Stripe, screenshot, and expiry fields". The preview is no longer "stale
// state to be dropped" — it is the email, and it is bound to this prospect
// before anything is composed.
//
// THE SECURITY HALF SURVIVES INTACT, and is the reason this test still exists:
// a persisted report_url, a persisted checkout_url, a persisted
// preview_expires_at, and caller-supplied third-party screenshot URLs are all
// still fed in, and NONE of them may reach the body. Those are commerce and
// third-party-host isolation, not consent-first policy.
test("provider-bound composition still drops persisted Stripe, report, screenshot, and expiry fields", async () => {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: provableProspect("roofing@example.org", {
      report_url: "https://callprep.wss-ai.com/report/legacy",
      checkout_url: "https://buy.stripe.com/legacy",
      preview_expires_at: "August 5, 2026",
    }),
    vars: {
      force_reveal: true,
      old_site_shot: "https://s0.wp.com/mshots/v1/before",
      new_site_shot: "https://s0.wp.com/mshots/v1/after",
    },
    sequence: 1,
    step: 1,
    dryRun: true,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  // The proof renders, from our own hosts only.
  assert.match(result.htmlPreview, /roofing-example\.wss-ai\.com/i);
  // THE COUNT WAS ALWAYS A PROXY. What matters is that no third-party or
  // prospect-supplied image can become an <img> — the count was how that was
  // spelled when the proof email had exactly three. V3 adds Riley's avatar,
  // which is served from our own /brand/ directory alongside the WSS mark, so
  // the count moved and the property did not. Both are now asserted directly:
  // the exact expected set for the active composer, AND the host allowlist for
  // every source, which is the assertion a donor logo would actually trip.
  const imageSources = [...result.htmlPreview.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&"));
  // 2026-08-12 compression pass: the how-to-get-in door reuses the AFTER shot
  // as door 1's thumbnail. 2026-08-13: the WSS Connect banner now carries the
  // owner's own funnel graphic (connect-funnel.png), one ungated first-party
  // <img>. So the V3 count is six <img> tags over five first-party assets. The
  // host allowlist below is still the assertion that matters.
  // 2026-09-02 polish-v2 mock: the funnel PNG retires (owner showpiece note —
  // the letter tiles read as "plain letters"); the WSS Connect banner's drawn
  // app-frame reuses the WSS mark instead, so the count STAYS six and only the
  // funnel assertion below goes.
  // 2026-09-03 final polish: the drawn table flag and both 🇺🇸 emoji retire —
  // the owner supplied a real first-party flag raster (/brand/us-flag.png),
  // which renders in THREE spots (brand row, American-AI story card, the
  // BUILT WITH AMERICAN AI strip). Nine <img> tags over six first-party
  // assets; the host allowlist below is still the load-bearing assertion.
  assert.equal(
    imageSources.length,
    proofEmailV3Enabled() ? 9 : 3,
    `WSS mark + before + after (x2)${proofEmailV3Enabled() ? " + Riley avatar + WSS Connect graphic + US flag (x3)" : ""}: ${JSON.stringify(imageSources)}`,
  );
  for (const src of imageSources) {
    assert.match(src, /^https:\/\/(?:[a-z0-9-]+\.)*wss-ai\.com\//i, `third-party image host: ${src}`);
  }
  assert.equal(
    imageSources.filter((src) => /\/api\/media\/preview-shot/.test(src)).length,
    proofEmailV3Enabled() ? 3 : 2,
    "both proof shots must render (V3 reuses the after as door 1's thumbnail)",
  );
  assert.match(result.htmlPreview, /<img\b[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/wss-mark-176\.png"/i);
  // UNCHANGED REFUSALS.
  assert.doesNotMatch(result.htmlPreview, /\/api\/reveal|buy\.stripe\.com/i);
  assert.doesNotMatch(result.htmlPreview, /s0\.wp\.com\/mshots|<iframe\b/i);
  // NARROWED 2026-08-08, and only for the payment clause. The proof email now
  // carries ONE payment destination — our own signed /api/checkout-link on
  // ghost.wss-ai.com, minted per prospect — because everything past payment was
  // built and no email contained a way to reach it. A third-party payment host
  // is still refused outright, by name. See test/checkout-loop.test.js for the
  // positive assertions on that button.
  assert.doesNotMatch(
    result.htmlPreview,
    /buy\.stripe\.com|checkout\.stripe\.com|paypal|venmo|cash\.app|Launch my site/i,
  );
  assert.doesNotMatch(result.htmlPreview, /August 5, 2026|comes down|delete(?:d| it)?|backups?/i);
  assert.equal(result.previewExpiresOn, null);
});

// MIGRATED 2026-07-31. Was "cold follow-up HTML and text use the same
// consent-first step copy", asserting that both halves said "I have not built
// or published anything for Roofing Example."
//
// That sentence is now FALSE: lib/email.js refuses sequence 1 unless a real
// preview exists, so by the time a follow-up goes out we have built and
// published exactly that. THE POINT OF THE TEST IS PRESERVED AND IS THE REASON
// IT WAS KEPT — the HTML part and the plain-text part of one multipart email
// must not contradict each other. They did: the HTML said "I went ahead and
// rebuilt the site" while the text said "I have not built anything", in the
// same message. lib/email-templates.js was migrated to fix that.
// MIGRATED AGAIN 2026-08-10. The expected sentences moved with the owner-approved
// follow-up rewrite: the old ones were written in the first person and signed by
// a founder ("the preview I built for X", "This is my last note"), which is not
// the voice cold outreach ships in. THE POINT OF THE TEST IS UNCHANGED for the
// third time — the two MIME halves of one message must say the same thing — and
// it is now asserted on the sentence that carries the offer to end it, which is
// the promise the new copy makes ("Reply PASS and we will take it down") in place
// of the retired untouched-site line.
test("cold follow-up HTML and text agree on the proof-first claim", async () => {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  const { sendSequenceStep } = require("../lib/email");

  for (const [step, expected] of [
    [2, "The website WSS Labs built for Roofing Example is ready to review."],
    [3, "WSS Labs built a website for Roofing Example and kept the preview available for review."],
  ]) {
    const result = await sendSequenceStep({
      prospect: provableProspect("roofing@example.org"),
      sequence: 1,
      step,
      dryRun: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.bodyPreview, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // Neither half may carry the retired claim any more.
    assert.doesNotMatch(result.bodyPreview, /I have not built or published anything/i);
    assert.doesNotMatch(readableText(result.htmlPreview), /I have not built or published anything/i);
    // Both halves make the same promise about ending it.
    //
    // STRENGTHENED 2026-07-31 (D3). This used to assert the phrase in the text
    // half case-insensitively and in the HTML half with a capital "Y" — which
    // matched only because the follow-up was rendering the STEP-1 PROOF
    // TEMPLATE, whose closing footer opens a sentence with "Your current
    // website is untouched." The two halves were not agreeing; they were two
    // separately authored sentences that happened to overlap, in an email whose
    // HTML was the wrong email entirely.
    //
    // Now that the HTML renders this step's own copy, agreement is asserted
    // literally: the whole sentence carrying the promise in the text part must
    // appear verbatim in the rendered HTML. Same words, same source, no room
    // for the two halves to drift.
    assert.match(result.bodyPreview, /Reply PASS and we will take it down\./);
    const promiseSentence = result.bodyPreview
      .split(/(?<=\.)\s+|\n+/)
      .map((sentence) => sentence.trim())
      .find((sentence) => /Reply PASS and we will take it down\./.test(sentence));
    assert.ok(promiseSentence, "the text half lost the take-it-down promise");
    assert.ok(
      readableText(result.htmlPreview).includes(promiseSentence),
      `step ${step}: the HTML half does not carry the text half's promise "${promiseSentence}"`,
    );
    // The retired founder voice is gone from BOTH halves, not just the template.
    for (const half of [result.bodyPreview, readableText(result.htmlPreview)]) {
      assert.doesNotMatch(half, /following up/i);
      assert.doesNotMatch(half, /the preview I built|my last note/i);
    }
  }
});
