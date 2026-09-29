"use strict";

// ---------------------------------------------------------------------------
// D3 — EVERY SEQUENCE STEP RENDERED THE STEP-1 PROOF EMAIL.
//
// Two defects compounded into one shipped bug:
//
//   (a) lib/email.js gated on `Number(sequence) === 1` alone, so all three
//       steps of the cold sequence were treated as the proof email; and
//   (b) lib/email.js passed `bodyText` to composeOutreachEmailV2(), whose
//       parameter list did not contain `bodyText`. Destructuring a name that is
//       not in the pattern is a silent no-op, so the step copy was accepted,
//       dropped, and the step-1 proof template rendered instead.
//
// The visible result: a follow-up whose plain-text half read "Just following up
// on the preview I built for X" arrived with an HTML half containing the full
// cold pitch — the $199 offer card, the before/after panel, the concierge
// block. One message, two different emails, and the recipient's mail client
// picked which one they saw.
//
// These tests render the DOM. "The composer was called with the right
// arguments" is exactly the assertion that would have passed throughout the
// entire life of this bug.
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const { outreachHtmlV2 } = require("../lib/outreach-email-v2");
const { proofEmailV3Enabled } = require("../lib/proof-email-inputs");

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function configureDryRunEnvironment() {
  process.env.EMAIL_UNSUB_SECRET = "sequence-step-parity-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@wss-ai.com";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  process.env.GHOST_AGENCY_AGENT_PHONE = "+19493395562";
}

// A prospect with a real, provable build: sequence 1 refuses to compose without
// a preview on an approved host that is bound to this business.
function prospect(overrides = {}) {
  return {
    prospect_id: "harbor-ridge-sequence-parity",
    business_name: "Harbor Ridge Roofing",
    city: "Ventura",
    industry: "roofing",
    email: "owner@harborridgeroofing.com",
    preview_url: "https://harbor-ridge-roofing.wss-ai.com/",
    current_website: "https://harborridgeroofing.com/",
    before_shot_source_url: "https://www.harborridgeroofing.com/",
    ...overrides,
  };
}

async function compose({ sequence = 1, step = 1, prospectOverrides = {} } = {}) {
  configureDryRunEnvironment();
  const { sendSequenceStep } = require("../lib/email");
  return sendSequenceStep({
    prospect: prospect(prospectOverrides),
    sequence,
    step,
    dryRun: true,
  });
}

async function composeOk(options) {
  const result = await compose(options);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

// The rendered DOM as a reader sees it: tags gone, entities decoded, whitespace
// collapsed. Everything asserted below is asserted against THIS, not against
// the markup, so an assertion cannot pass on a string that is invisible in the
// mail client.
function visibleText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/(?:&#39;|&#x27;|&apos;)/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function collapse(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function hrefs(html) {
  return [...new Set([...String(html).matchAll(/\bhref="([^"]+)"/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&")))];
}

// Copy that belongs to the STEP-1 PROOF EMAIL and to nothing else. If any of it
// surfaces in a follow-up, the follow-up is the step-1 email again.
//
// TWO LISTS SINCE 2026-08-07, BECAUSE THERE ARE TWO PROOF COMPOSERS.
// GHOST_AGENCY_PROOF_EMAIL_V3 selects lib/outreach-email-v3.js for step 1 and
// lib/outreach-email-v2.js otherwise, so a single list would either go stale
// the moment the flag flipped or quietly stop being a control. The CONTROL half
// runs against whichever composer is live; the EXCLUSION half runs against the
// UNION of both, which is strictly stronger than before — a follow-up must now
// be free of step-1 copy from EITHER shell, whichever one is switched on.
const STEP_ONE_PROOF_ONLY_V2 = [
  "It's already built. Here's the honest math.",
  "$199",
  "A local agency quotes builds like this at $4,000–$8,000 upfront",
  "Before → After",
  "Your site today",
  "Your new site — live now",
  "Sign up and a real person calls you — personally.",
  "See your preview",
  "Personal call",
  "Review my site",
  "Reply \"WALKTHROUGH\"",
  "My name is Mark Woodward, and I own an AI-powered web studio here in California",
  "I went ahead and rebuilt the site as a free live preview",
  "Voice search & AI upgrades — included",
  "WSS Connect — all your social accounts in one feed, built in",
];

// The same role for the V3 shell. Entity-heavy strings (&ndash;, &rarr;,
// &middot;, the glyph numerics) are deliberately avoided: visibleText() decodes
// only a handful of named entities, so a marker containing one would compare
// against its raw form and pass or fail for the wrong reason.
const STEP_ONE_PROOF_ONLY_V3 = [
  "YOU WERE PICKED",
  "we already built your new website.",
  "It is live right now. You pay nothing to look at it.",
  "Nothing to install. Takes 5 seconds.",
  "OPEN YOUR LIVE PREVIEW",
  "IT IS ALREADY BUILT. HERE IS THE HONEST MATH.",
  "$149",
  // The compression pass (2026-08-12) retitled the included-list: the benefit
  // grid under the price became the WHAT YOU GET tiles above it, and this is
  // that section's lead line.
  "All of it is in the $149.",
  "Meet Riley",
  "Your own web developer, on the phone.",
  "Why you? We scan local businesses",
  "Want the 60-second tour?",
  "WALKTHROUGH",
  "Worst case, you got a free look at a better version of your site.",
];

const STEP_ONE_PROOF_ONLY = [...new Set([...STEP_ONE_PROOF_ONLY_V2, ...STEP_ONE_PROOF_ONLY_V3])];

test("sequence 1 steps 2 and 3 render their own step copy, never the step-1 proof HTML", async () => {
  const step1 = visibleText((await composeOk({ step: 1 })).htmlPreview);
  // The step-1 fixture is the control: every marker below really does render
  // for the proof email, so its ABSENCE from a follow-up means something.
  const liveMarkers = proofEmailV3Enabled() ? STEP_ONE_PROOF_ONLY_V3 : STEP_ONE_PROOF_ONLY_V2;
  for (const marker of liveMarkers) {
    assert.ok(
      step1.includes(collapse(marker)),
      `step 1 no longer renders "${marker}" — this control list is stale`,
    );
  }

  // The step copy as it actually ships. Updated 2026-08-10 with the
  // owner-approved rewrite (company voice, no founder, no "following up"); the
  // structural assertions below are untouched and are the point of this test.
  const followUpCopy = {
    2: "The website WSS Labs built for Harbor Ridge Roofing is ready to review. The work is already done in the preview, so you can judge the site itself before paying anything.",
    3: "WSS Labs built a website for Harbor Ridge Roofing and kept the preview available for review. This is our final email about it.",
  };

  for (const step of [2, 3]) {
    const result = await composeOk({ step });
    const html = result.htmlPreview;
    const visible = visibleText(html);

    // 1. THIS step's copy is what renders.
    assert.ok(
      visible.includes(collapse(followUpCopy[step])),
      `step ${step} HTML does not carry its own step copy: ${visible}`,
    );

    // 2. The step-1 proof email does not.
    for (const marker of STEP_ONE_PROOF_ONLY) {
      assert.ok(
        !visible.includes(collapse(marker)),
        `step ${step} rendered step-1 proof copy: "${marker}"`,
      );
    }

    // 3. No proof ARTIFACTS either — a follow-up shows no before/after panel,
    //    so the only image is the WSS sender mark.
    assert.equal(
      (html.match(/<img\b/gi) || []).length, 1,
      `step ${step} must render only the WSS sender mark`,
    );
    assert.match(html, /<img\b[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/wss-mark-176\.png"/i);
    assert.doesNotMatch(html, /\/api\/media\/preview-shot/i);

    // 4. Steps do not bleed into each other either.
    const otherStep = step === 2 ? 3 : 2;
    assert.ok(
      !visible.includes(collapse(followUpCopy[otherStep])),
      `step ${step} rendered step ${otherStep}'s copy`,
    );
  }
});

test("the HTML and plain-text halves of a follow-up carry the same copy", async () => {
  for (const step of [2, 3]) {
    const result = await composeOk({ step });
    const body = result.bodyPreview;
    // bodyPreview is output.body.slice(0, 900); a follow-up body is far shorter,
    // so this is the whole text part. Asserted so a longer template cannot make
    // the comparison below silently partial.
    assert.ok(body.length < 900, `step ${step} body is truncated in bodyPreview`);

    const visible = visibleText(result.htmlPreview);
    const lines = body.split(/\n+/).map((line) => collapse(line)).filter(Boolean);
    assert.ok(lines.length >= 3, `step ${step} text body is suspiciously empty`);
    for (const line of lines) {
      assert.ok(
        visible.includes(line),
        `step ${step}: text part says "${line}" and the HTML part does not`,
      );
    }

    // Parity is two-directional for the promises: the compliance footer the
    // text half carries must be in the HTML half too. This shell is new code —
    // the STOP promise is exactly the kind of thing a new shell drops.
    assert.ok(
      visible.includes("Not interested? Reply STOP and you won't hear from me again."),
      `step ${step} HTML lost the exact STOP promise`,
    );
    assert.ok(
      visible.includes("655 S Main St, Suite 200, Orange, CA 92868"),
      `step ${step} HTML lost the postal address`,
    );
    assert.ok(
      hrefs(result.htmlPreview).some((href) => /\/api\/outreach\/unsubscribe\?/.test(href)),
      `step ${step} HTML lost the unsubscribe link`,
    );

    // The follow-up shell is not a place to smuggle anything in.
    assert.doesNotMatch(result.htmlPreview, /<iframe\b|<script\b|javascript:/i);
    assert.doesNotMatch(result.htmlPreview, /buy\.stripe|Launch my site/i);
    assert.doesNotMatch(result.htmlPreview, /\b(?:undefined|null)\b/i);
    assert.doesNotMatch(result.htmlPreview, /\b(?:href|src)=""/i);
    assert.equal((result.htmlPreview.match(/<body\b/gi) || []).length, 1);
    for (const href of hrefs(result.htmlPreview)) {
      assert.match(
        href,
        /^(?:https:\/\/(?:[a-z0-9-]+\.)*wss-ai\.com\/|mailto:)/i,
        `step ${step} linked a host that is not ours: ${href}`,
      );
    }
  }
});

test("warm and intake sequences render their own copy instead of the cold proof pitch", async () => {
  for (const sequence of [2, 3]) {
    const result = await composeOk({ sequence, step: 1 });
    const visible = visibleText(result.htmlPreview);
    assert.ok(
      visible.includes("Thanks for replying."),
      `sequence ${sequence} did not render its own copy: ${visible}`,
    );
    for (const marker of STEP_ONE_PROOF_ONLY) {
      assert.ok(
        !visible.includes(collapse(marker)),
        `sequence ${sequence} rendered the cold proof pitch: "${marker}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// THE GATE DID NOT GET WEAKER.
//
// Making the composer step-aware means a follow-up no longer needs the
// before/after screenshots — it displays neither, so it asserts nothing about
// them. Everything the follow-up DOES assert is still proven before it can be
// composed: the preview exists, it is on a host we control, and it belongs to
// this prospect. These three cases fail the send at step 2, not step 1.
// ---------------------------------------------------------------------------
test("a follow-up is still refused when the preview it promises is missing, foreign, or not this prospect's", async () => {
  const missing = await compose({ step: 2, prospectOverrides: { preview_url: "", reveal_url: "" } });
  assert.equal(missing.ok, false);
  assert.equal(missing.blocked, "no_preview_url");
  assert.equal(missing.htmlPreview, undefined, "nothing may be composed around a preview that does not exist");

  const foreign = await compose({
    step: 2,
    prospectOverrides: { preview_url: "https://legacy-preview.example.test/" },
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.blocked, "preview_host_not_approved");
  assert.equal(foreign.htmlPreview, undefined);

  const strangers = await compose({
    step: 2,
    prospectOverrides: { preview_url: "https://signature-landscape-design.wss-ai.com/" },
  });
  assert.equal(strangers.ok, false);
  assert.equal(strangers.blocked, "preview_identity_prospect_mismatch");
  assert.equal(strangers.htmlPreview, undefined);
});

test("the step-1 proof email is still refused without its before/after comparison", async () => {
  // The relaxation is scoped to the steps that render no comparison. Step 1
  // renders one, captioned "Your site today", so it still must prove the shot
  // was captured on this prospect's own domain.
  const unrecorded = await compose({ step: 1, prospectOverrides: { before_shot_source_url: "" } });
  assert.equal(unrecorded.ok, false);
  assert.equal(unrecorded.blocked, "before_image_capture_source_unrecorded");

  const stranger = await compose({
    step: 1,
    prospectOverrides: { before_shot_source_url: "https://signature-landscape.example/" },
  });
  assert.equal(stranger.ok, false);
  assert.match(stranger.blocked, /^before_image_/);
});

// ---------------------------------------------------------------------------
// THE FAILURE MODE ITSELF: an option the composer does not read.
// ---------------------------------------------------------------------------
test("composeOutreachEmailV2 refuses an option it does not read instead of dropping it", () => {
  const footer = { postal: "655 S Main St, Suite 200, Orange, CA 92868" };

  // The exact 2026-07-31 defect, as a typo: near-miss names are the ones that
  // look correct at the call site.
  assert.throws(
    () => outreachHtmlV2({ footer, businessName: "Ace Plumbing", bodytext: "follow-up copy" }),
    /unknown option\(s\) bodytext/,
  );
  assert.throws(
    () => outreachHtmlV2({ footer, businessName: "Ace Plumbing", body: "follow-up copy", step: 2 }),
    /unknown option\(s\) body, step/,
  );
  // And the option that was actually being dropped is now honoured.
  const html = outreachHtmlV2({
    footer,
    businessName: "Ace Plumbing",
    previewUrl: "https://ace-plumbing.wss-ai.com/",
    bodyText: "Hi Ace Plumbing team,\n\nJust following up.\n\n— Mark Woodward, Mission Viejo, CA",
  });
  const visible = visibleText(html);
  assert.ok(visible.includes("Just following up."), "bodyText must reach the rendered DOM");
  assert.ok(!visible.includes("It's already built. Here's the honest math."));
});
