"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SUBJECT_POOL,
  outreachEmailV2Enabled,
  outreachHtmlV2,
  pchSubject,
  sanitizeBusinessAddress,
} = require("../lib/outreach-email-v2");
const {
  CONSENT_FIRST_BODY,
  PROOF_FIRST_SUBJECT: TEXT_SUBJECT,
  SEQUENCES,
  render,
} = require("../lib/email-templates");

// The subject the consent-first product shipped. Kept as a named constant so
// the migrated tests below can assert it is GONE rather than deleting the
// evidence that it ever existed.
const RETIRED_CONSENT_FIRST_SUBJECT =
  "talk to your website and it changes — for {{business_name}} in {{city}}";
const FOOTER = {
  postal: "655 S Main St, Suite 200, Orange, CA 92868",
  unsubscribe: "https://ghost.wss-ai.com/api/outreach/unsubscribe?token=abc",
};

function visibleText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hrefs(html) {
  return [...String(html).matchAll(/\bhref="([^"]+)"/gi)].map((match) => match[1]);
}

/**
 * POLICY MIGRATION 2026-07-31 (consent-first -> proof-first).
 *
 * Two clauses left this helper, and only two. They are the ones the owner
 * deliberately reversed:
 *   · /already (?:built|rebuilt)|went ahead and rebuilt/ — under consent-first
 *     this was a LIE (nothing had been built). Under proof-first it is the
 *     proposition, and lib/email.js REFUSES to send sequence 1 unless a real
 *     preview exists, so the sentence is now load-bearing truth.
 *   · /before → after/ — the comparison is the email's entire content now.
 *
 * Everything else is unchanged and still enforced everywhere it was:
 * no payment link, no Stripe, no "Launch my site", no countdown/expiry/delete
 * scarcity mechanic. Those were never consent-first artifacts — a cold email
 * does not ask a stranger for a card, and we do not make promises about
 * deleting things on a date nothing actually enforces.
 */
function assertNoOldMechanic(value) {
  assert.doesNotMatch(value, /stripe|checkout|launch my site/i);
  assert.doesNotMatch(value, /live (?:on my server|until|through)/i);
  assert.doesNotMatch(value, /countdown|expir(?:e|es|ation)|delete it|backups?/i);
  assert.doesNotMatch(value, /reimagined/i);
}

// MIGRATED 2026-07-31. Was "consent-first subject is exact in both template
// layers", asserting the single fixed subject
//   "talk to your website and it changes — for {{business_name}} in {{city}}".
// That subject belonged to an email that offered to build something. The email
// now SHOWS something, and the shipped subject is produced by pchSubject() from
// the v3 rotation. The assertion that survives — and is strengthened here — is
// that there is no THIRD subject source: the retired string cannot be produced
// by any layer any more.
test("proof-first subject comes from one rotation and the retired consent subject is unreachable", () => {
  assert.ok(Array.isArray(SUBJECT_POOL) && SUBJECT_POOL.length > 0);
  for (const variant of SUBJECT_POOL) {
    assert.notEqual(variant, RETIRED_CONSENT_FIRST_SUBJECT);
    assert.doesNotMatch(variant, /talk to your website and it changes/i);
  }
  // Every rendered subject is drawn from that pool and carries the business.
  const subject = pchSubject({ businessName: "Ace & Sons Plumbing", city: "Boise", prospectId: "p-1" });
  assert.match(subject, /Ace & Sons Plumbing/);
  assert.doesNotMatch(subject, /talk to your website and it changes/i);
  assert.doesNotMatch(subject, /\{\{|\}\}|\{city\}/);
  // The text layer moved with it — the two layers must never disagree again.
  // typeof first: this constant is imported across a module boundary, and a
  // rename on the other side would make it `undefined`, at which point
  // notEqual() against the retired string passes while proving nothing.
  assert.equal(typeof TEXT_SUBJECT, "string");
  assert.notEqual(TEXT_SUBJECT, RETIRED_CONSENT_FIRST_SUBJECT);
  assert.doesNotMatch(TEXT_SUBJECT, /talk to your website and it changes/i);
});

// D4, 2026-07-31. The two template layers had diverged on the subject constant.
// lib/outreach-email-v2.js stopped declaring it in the proof-first rewrite
// (that layer composes subjects with pchSubject() over SUBJECT_POOL now), while
// lib/email-templates.js went on exporting the same value twice — once under
// the canonical name and once under the retired consent-first name, aliased.
//
// Two exported names for one string is the drift mechanism itself: the value
// gets edited through one name and read through the other. And it fails
// silently in the worst possible direction — a test that imports the retired
// name from the layer that dropped it reads `undefined`, and `undefined` is
// notEqual to every retired subject there has ever been. So every assertion
// here proves the value is a real, non-empty string BEFORE comparing it, and
// every existence check uses hasOwnProperty rather than truthiness.
//
// SCOPE. "Second layer" means the other TEMPLATE layer. lib/organic-email.js
// and lib/supervised-held-drafts.js deliberately compose their own consent-first
// subjects for their own lanes and are pinned by test/consent-copy-fallbacks
// .test.js; they are not in the proof-first outreach path and are not asserted
// on here.
test("the subject constant has exactly one canonical export and no second layer redeclares it", () => {
  const fs = require("node:fs");
  const textLayer = require("../lib/email-templates");
  const htmlLayer = require("../lib/outreach-email-v2");

  // 1. The canonical export exists, in the plain-text layer, and holds a real
  //    string rather than an absent key that reads as undefined.
  assert.ok(
    Object.prototype.hasOwnProperty.call(textLayer, "PROOF_FIRST_SUBJECT"),
    "lib/email-templates.js must export the canonical subject constant",
  );
  assert.equal(typeof textLayer.PROOF_FIRST_SUBJECT, "string");
  assert.ok(textLayer.PROOF_FIRST_SUBJECT.trim().length > 0);
  assert.notEqual(textLayer.PROOF_FIRST_SUBJECT, RETIRED_CONSENT_FIRST_SUBJECT);

  // 2. The HTML layer does not export the constant under the canonical name or
  //    the retired one. It owns the shipped rotation, not a fixed subject.
  assert.equal(
    Object.prototype.hasOwnProperty.call(htmlLayer, "PROOF_FIRST_SUBJECT"),
    false,
    "lib/outreach-email-v2.js must not redeclare the subject constant",
  );
  for (const [file, layer] of [
    ["lib/email-templates.js", textLayer],
    ["lib/outreach-email-v2.js", htmlLayer],
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(layer, "CONSENT_FIRST_SUBJECT"),
      false,
      `${file} must not export the retired consent-first subject name`,
    );
  }

  // 3. Source level, because a module-shape check alone would miss a private
  //    second copy that never gets exported: the subject string is written down
  //    exactly once across the two layers, and the retired identifier appears
  //    in neither — not as a declaration, not as an alias, not in a comment
  //    that a later edit could turn back into code.
  const sources = {
    "lib/email-templates.js": fs.readFileSync(require.resolve("../lib/email-templates"), "utf8"),
    "lib/outreach-email-v2.js": fs.readFileSync(require.resolve("../lib/outreach-email-v2"), "utf8"),
  };
  let literalOccurrences = 0;
  for (const [file, source] of Object.entries(sources)) {
    literalOccurrences += source.split(textLayer.PROOF_FIRST_SUBJECT).length - 1;
    assert.doesNotMatch(
      source,
      /\bCONSENT_FIRST_SUBJECT\b/,
      `${file} still names the retired consent-first subject constant`,
    );
    assert.doesNotMatch(
      source,
      /talk to your website and it changes/i,
      `${file} still carries the retired consent-first subject copy`,
    );
  }
  assert.equal(
    literalOccurrences,
    1,
    "the proof-first subject string must be written down in exactly one layer",
  );

  // 4. The sequence table is DRIVEN by constants — identity, not a parallel copy
  //    of the same words that happens to match today.
  //
  //    NARROWED 2026-08-10. This used to require ALL THREE cold steps to resolve
  //    from PROOF_FIRST_SUBJECT, which was true and was also the bug: the two
  //    follow-ups reused the first-impression subject, and lib/email.js then
  //    overwrote it with a pchSubject() rotation variant, so a follow-up arrived
  //    pitching a rebuild to someone who had already been pitched exactly that.
  //    Steps 2 and 3 now own their subjects. The invariant that survives is the
  //    one this test is for — every step's subject comes from a named constant in
  //    this layer, each written down once, and no two steps share one.
  const stepSubjects = {
    1: textLayer.PROOF_FIRST_SUBJECT,
    2: textLayer.PROOF_FOLLOWUP_SUBJECT,
    3: textLayer.PROOF_FINAL_NOTE_SUBJECT,
  };
  assert.deepEqual(Object.keys(SEQUENCES["1"].steps).sort(), ["1", "2", "3"]);
  for (const [step, constant] of Object.entries(stepSubjects)) {
    assert.equal(typeof constant, "string");
    assert.ok(constant.trim().length > 0, `step ${step}'s subject constant is empty`);
    assert.equal(
      SEQUENCES["1"].steps[step].subject,
      constant,
      `sequence 1 step ${step} must resolve from its canonical subject constant`,
    );
    assert.equal(
      sources["lib/email-templates.js"].split(constant).length - 1,
      1,
      `step ${step}'s subject is written down more than once`,
    );
  }
  assert.equal(new Set(Object.values(stepSubjects)).size, 3, "two cold steps share one subject");
});

test("V3 flag remains default-on and respects an explicit off switch", () => {
  assert.equal(outreachEmailV2Enabled({}), true);
  assert.equal(outreachEmailV2Enabled({ OUTREACH_EMAIL_V2: "false" }), false);
  assert.equal(outreachEmailV2Enabled({ OUTREACH_EMAIL_V2: "0" }), false);
  assert.equal(outreachEmailV2Enabled({ OUTREACH_EMAIL_V2: "true" }), true);
});

// MIGRATED 2026-07-31 (was "cold text template preserves the required
// consent-first copy and merge fields"). The offer sentence "reply and I'll
// build you a free custom preview — with your input" is the reversed policy and
// is gone. Everything else in this test is UNCHANGED and still required: the
// merge fields, the Riley paragraph, the included list, the sign-off, and — the
// half that matters most — the guarantee that the prospect's current site is
// never touched, which survived the reversal word for word.
test("cold text template carries the proof-first claim, the untouched-site guarantee, and every merge field", () => {
  const result = render(1, 1, {
    business_name: "Ace & Sons Plumbing",
    city: "Boise",
    industry: "plumbing",
    sender_name: "Mark Woodward",
    sender_phone: "(949) 339-5562",
  });

  assert.match(result.subject, /Ace & Sons Plumbing/);
  assert.doesNotMatch(result.subject, /talk to your website and it changes/i);
  assert.equal(result.missing.length, 0);
  assert.match(result.body, /^Hi Ace & Sons Plumbing team,/);
  assert.match(result.body, /I'm Mark Woodward — I run a small AI-powered web studio in California/);
  assert.match(result.body, /your site comes with Riley, your own AI web person you can call anytime/);
  assert.match(result.body, /No ticket system, no emailing changes in, no waiting weeks on a freelancer for one small edit\./);
  assert.match(result.body, /Riley \(AI assistant\) by call — unlimited edits, done live/);
  assert.match(result.body, /WSS Connect — all your social accounts in one built-in feed/);
  assert.match(result.body, /Voice search & AI upgrades, "near me" optimization, Google\/Apple Maps registry \+ directory indexing, plus Boise competitor & search research/);
  assert.match(result.body, /Lead-funnel widgets so visitors turn into calls/);
  assert.match(result.body, /Hosting, SSL, custom domain setup, and unlimited edits — all included/);
  // The proof-first claim, and the guarantees that outlived the reversal.
  assert.match(result.body, /I went ahead and rebuilt the site as a free live preview/);
  assert.match(result.body, /Your current website is untouched, and it stays that way\./);
  assert.match(result.body, /No charge and no obligation for the preview\./);
  assert.match(result.body, /If you'd rather I take it down, say so and it's gone\./);
  // The retired offer must not linger anywhere in the same body.
  assert.doesNotMatch(result.body, /reply and I'll build you a free custom preview/i);
  assert.doesNotMatch(result.body, /I have not built or published anything/i);
  assert.match(result.body, /Prefer to talk it through\? Call me: \(949\) 339-5562\./);
  assert.match(result.body, /— Mark Woodward, Mission Viejo, CA$/);
  assertNoOldMechanic(result.body);
  assert.doesNotMatch(result.body, /https?:\/\/|www\./i);
});

test("every sequence step is link-free and contains no retired sales mechanic", () => {
  const vars = {
    business_name: "Ace Plumbing",
    city: "Boise",
    industry: "plumbing",
    sender_name: "Mark Woodward",
    sender_phone: "(949) 339-5562",
  };

  for (const [sequenceId, sequence] of Object.entries(SEQUENCES)) {
    for (const stepId of Object.keys(sequence.steps)) {
      const result = render(sequenceId, stepId, vars);
      assert.equal(result.missing.length, 0, `${sequenceId}.${stepId} has missing fields`);
      assert.doesNotMatch(result.body, /https?:\/\/|www\./i, `${sequenceId}.${stepId} contains a link`);
      assertNoOldMechanic(`${result.subject}\n${result.body}`);
    }
  }
});

// MIGRATED 2026-07-31. Was "HTML keeps the premium WSS shell and makes Riley
// memorable without a link CTA", which asserted the retired shell copy ("A
// website you can talk to", "Say it. See it change.") and — the reversed part —
// that the preview URL and the before/after shots must NOT render and that the
// unsubscribe link is the only href in the email. Proof-first inverts exactly
// those: the preview link and the comparison ARE the email.
//
// PRESERVED WORD FOR WORD, because none of it is policy:
//   · the WSS sender mark is the only remote image that is not proof;
//   · no <iframe>;
//   · no report link (callprep) and no payment link (buy.stripe), even when both
//     are handed in — the composer must not mint them;
//   · no scarcity countdown, even when an expiry date is handed in;
//   · every href that DOES render points at this prospect's own preview, their
//     own current site, or the unsubscribe — never a third-party host.
test("HTML shows the proof and still refuses report links, payment links, and scarcity", () => {
  const html = outreachHtmlV2({
    footer: FOOTER,
    cta: {
      businessName: "Ace & Sons Plumbing",
      city: "Boise",
      industry: "plumbing",
      senderPhone: "(949) 339-5562",
      previewUrl: "https://ace-sons-plumbing.wss-ai.com/",
      currentUrl: "https://acesonsplumbing.example/",
      reportUrl: "https://callprep.wss-ai.com/report/7b2e4d61-8c03-4a9f-9e15-5d8c2b7f6a34",
      checkoutUrl: "https://buy.stripe.com/should-not-render",
      expiryDate: "August 5, 2026",
      // The field names lib/email.js actually composes with (proofCta).
      beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a&v=old",
      afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=b&v=new",
    },
    senderName: "Mark Woodward",
    senderCity: "Mission Viejo, CA",
  });
  const text = visibleText(html);

  // The shell that actually ships.
  assert.match(text, /WSS Labs/);
  assert.match(text, /AI-powered web studio · California/);
  assert.match(text, /Hi Ace & Sons Plumbing team,/);
  assert.match(text, /you can CALL anytime/);
  assert.match(text, /— Mark/);
  assert.match(text, /I build these one at a time, here in Mission Viejo, CA\./);

  // The proof-first claim and its artifacts.
  assert.match(text, /I went ahead and rebuilt the site as a free live preview/);
  assert.match(text, /Before\s*→\s*After/);
  assert.match(html, /<img\b[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/wss-mark-176\.png"/i);
  assert.equal((html.match(/<img\b/gi) || []).length, 3, "WSS mark + before + after");

  // STILL TRUE, and still enforced against the same hostile inputs.
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /buy\.stripe/i);
  assert.doesNotMatch(html, /August 5, 2026/);
  assertNoOldMechanic(text);
  const rendered = [...new Set(hrefs(html))];
  assert.deepEqual(rendered.sort(), [
    FOOTER.unsubscribe,
    "https://ace-sons-plumbing.wss-ai.com/",
    "https://acesonsplumbing.example/",
    "https://callprep.wss-ai.com/report/7b2e4d61-8c03-4a9f-9e15-5d8c2b7f6a34",
  ].sort(), "this prospect's preview, their own site, our report, and the unsubscribe");
});

test("a report link on a host that is not ours is still refused", () => {
  // The composer PRINTS the report now, which makes reportUrl an injection
  // surface it never was while the value was silently dropped. Only our own
  // estate may appear; anything else is discarded exactly as before.
  const html = outreachHtmlV2({
    footer: FOOTER,
    senderName: "Mark Woodward",
    senderCity: "Mission Viejo, CA",
    cta: {
      businessName: "Ace & Sons Plumbing",
      city: "Boise",
      previewUrl: "https://ace-sons-plumbing.wss-ai.com/",
      currentUrl: "https://acesonsplumbing.example/",
      beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a&v=old",
      afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=b&v=new",
      reportUrl: "https://evil.example/report/pwned",
    },
  });
  assert.doesNotMatch(html, /evil\.example/);
  assert.doesNotMatch(html, /Read your report/);
});

// UNCHANGED CONTRACT, restored in code (2026-07-31). The postal address and the
// exact STOP promise are compliance, not consent-first policy: the same promise
// is owed whether the email offers to build a site or shows one already built.
// The proof-first HTML shell had dropped the STOP sentence while the plain-text
// footer kept it, so the two halves of one email disagreed. Fixed in
// lib/outreach-email-v2.js; the assertion below is untouched.
test("HTML footer always shows the mailing address and exact STOP promise", () => {
  const html = outreachHtmlV2({
    footer: FOOTER,
    businessName: "Ace Plumbing",
    city: "Boise",
    industry: "plumbing",
    senderName: "Mark Woodward",
    senderPhone: "(949) 339-5562",
  });
  const text = visibleText(html);

  assert.match(text, /655 S Main St, Suite 200, Orange, CA 92868/);
  assert.ok(
    text.includes("Not interested? Reply STOP and you won't hear from me again."),
    "the exact STOP promise must be visible",
  );
  assert.deepEqual(hrefs(html), [FOOTER.unsubscribe]);
});

test("unsafe legacy inputs and an unsafe unsubscribe never become HTML or links", () => {
  const html = outreachHtmlV2({
    footer: {
      postal: FOOTER.postal,
      unsubscribe: "javascript:alert(1)",
    },
    cta: {
      businessName: '<script>alert("x")</script>',
      city: "<img src=x onerror=alert(1)>",
      industry: "roofing",
      checkoutUrl: "javascript:alert(1)",
      previewUrl: "data:text/html,bad",
    },
    senderName: "<b>Mark</b>",
    senderPhone: "<script>phone</script>",
  });

  assert.doesNotMatch(html, /<script>|<iframe\b|javascript:|data:text/i);
  assert.equal((html.match(/<img\b/gi) || []).length, 1);
  assert.match(html, /<img\b[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/wss-mark-176\.png"/i);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;Mark&lt;\/b&gt;/);
  assert.deepEqual(hrefs(html), []);
  assert.doesNotMatch(html, /\b(?:undefined|null)\b/i);
});

test("postal-address sanitizer remains compatible and fails closed", () => {
  assert.equal(
    sanitizeBusinessAddress("[13100 Wortham Center Drive, Houston, TX 77065](https://maps.example.test)"),
    "13100 Wortham Center Drive, Houston, TX 77065",
  );
  assert.equal(
    sanitizeBusinessAddress("9 Market St, Reno, NV 89501 | Call now | Best service"),
    "9 Market St, Reno, NV 89501",
  );
  assert.equal(sanitizeBusinessAddress("Boise's most trusted plumbing experts"), "");
  assert.equal(sanitizeBusinessAddress("javascript:alert(1)"), "");
});

test("required source body remains free of artifact and commerce tokens", () => {
  assert.match(CONSENT_FIRST_BODY, /\{\{business_name\}\}/);
  assert.match(CONSENT_FIRST_BODY, /\{\{city\}\}/);
  assert.match(CONSENT_FIRST_BODY, /\{\{industry\}\}/);
  assert.match(CONSENT_FIRST_BODY, /\{\{sender_name\}\}/);
  assert.match(CONSENT_FIRST_BODY, /\{\{sender_phone\}\}/);
  assert.doesNotMatch(
    CONSENT_FIRST_BODY,
    /\{\{(?:preview|report|checkout|sunset|expiry)[^}]*\}\}/i,
  );
  assertNoOldMechanic(CONSENT_FIRST_BODY);
});

test("no live template promises a free registered domain", () => {
  // The backend provisions and connects a *.wss-ai.com subdomain; it does not
  // register a domain for the customer. DOMAIN_PURCHASE_ENABLED gates real
  // registrar spend and is off. 131 emails went out promising otherwise before
  // this was caught, so the promise is now guarded rather than just corrected.
  const fs = require("node:fs");
  const path = require("node:path");
  const live = ["lib/outreach-email-v2.js", "lib/email-templates.js", "lib/supervised-held-drafts.js"];
  for (const rel of live) {
    const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    assert.ok(
      !/free\s+(custom\s+)?domain|domain[^.\n]{0,20}\bfree\b/i.test(src),
      `${rel} promises a free domain — the backend cannot fulfil that`,
    );
  }
});
