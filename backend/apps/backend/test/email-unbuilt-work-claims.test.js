"use strict";
// A PROMISE OF WORK WE DO NOT PERFORM IS A LIE, NOT A FLOURISH.
//
// The proof email, the on-site sign-up floater and the build-on-click loading
// page all told the prospect we "remaster" their photographs. Measured against
// the shipped code on 2026-08-08, nothing in this repository enhances, upscales,
// denoises, re-crops or colour-corrects a single client pixel:
//
//   * apps/backend/package.json has no image-processing dependency at all —
//     the runtime deps are @sparticuz/chromium, acorn, ajv, ajv-formats,
//     playwright and playwright-core. No sharp, no jimp, no canvas.
//   * lib/mirror-engine/client-photos.js HARVESTS: it fetches candidate URLs,
//     proves ownership, sniffs the bytes, refuses stock and duplicates, and
//     ranks what survives. `kept.push({ url: secureUrl, ... })` — the client's
//     own URL, verbatim. No transform anywhere in the module.
//   * The one byte-level operation on a client photograph is
//     brand-assets.transcodePhoto(), and it is a CONTAINER conversion for MIME
//     correctness (webp bytes into a .jpg slot) that early-returns the input
//     unchanged when the formats already match. It shells out to ffmpeg, which
//     this codebase documents in five places as absent from the serverless
//     runtime — so in production it returns null and the original bytes are
//     placed or nothing is.
//
// Wiring beats cutting when the capability exists and is one call site away.
// Here there is no capability to wire — no module, no dependency, no binary —
// so the line was cut and the waived-$500 justification rewritten around the
// four things the pipeline provably does: extract their content and brand,
// write their pages, measure their local market, and gate the build.
//
// These tests fail against the copy as it shipped before 2026-08-08.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const acorn = require("acorn");

const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");
const { composeOutreachEmailV2 } = require("../lib/outreach-email-v2");
const { classifyRequest } = require("../lib/riley-capabilities");
const { buildSignupFloater } = require("../lib/mirror-engine/signup-floater");
const { REQUIRED_CHECKS, POLISH_CHECKS } = require("../lib/mirror-engine/engine");

// The vocabulary of pixel work we do not do. `remaster` is the word that
// actually shipped; the rest are the near-synonyms a future rewrite would
// reach for first.
const UNBUILT_IMAGE_WORK = /remaster|retouch|upscal|super-?resolution|photo[- ]enhanc|image[- ]enhanc|photos? (?:upgraded|enhanced|restored)/i;

// Media we do not originate. Nothing in the mirror lane generates an image or
// a video: lib/veo-ambiance.js belongs to the SiteForge lane, is required by
// lib/siteforge.js alone, and returns [] unless GHOST_AGENCY_VEO_AMBIANCE is
// switched on (it defaults off). The mirror ships the DONOR's motion layer.
const UNBUILT_GENERATED_MEDIA = /ai[- ]generated imager|generated hero visual|generating your ai hero|ai hero image/i;

const EMAIL = {
  businessName: "Poor John's Plumbing",
  city: "Parkville",
  previewUrl: "https://example.wss-ai.com/",
  reportUrl: "https://callprep.wss-ai.com/report/abc",
  clientId: "WSS-7A3980",
  checkoutUrl: "https://buy.stripe.com/test_abc",
};

test("the proof email never claims we remaster the client's photographs", () => {
  const { html, text } = composeOutreachEmailV3(EMAIL);
  assert.doesNotMatch(html, UNBUILT_IMAGE_WORK, "HTML half promises pixel work no code performs");
  assert.doesNotMatch(text, UNBUILT_IMAGE_WORK, "text half promises pixel work no code performs");
});

test("both halves of the email agree about what the waived setup fee buys", () => {
  const { html, text } = composeOutreachEmailV3(EMAIL);
  // The reciprocity beat only works if the struck-through number survives.
  assert.match(html, /\$500 setup fee/, "the waived fee vanished from the HTML half");
  assert.match(text, /\$500 setup fee, waived/, "the waived fee vanished from the text half");
  // And it must still be earned by named, real work rather than left as a bare
  // number with nothing behind it.
  for (const half of [html, text]) {
    assert.match(half, /content/i, "the fee no longer names the content work");
    assert.match(half, /local market/i, "the fee no longer names the local research");
    assert.match(half, /eleven checks/i, "the fee no longer names the render gates");
  }
});

// A real cold email, composed offline through the real send path. Same shape
// test/opt-out-parity.test.js uses: dryRun composes and passes every compliance
// gate, then returns before Resend, and global.fetch is booby-trapped so a
// composition that reaches the network fails loudly instead of quietly.
async function composeColdEmail({ agentPhone } = {}) {
  const savedFetch = global.fetch;
  const savedEnv = {};
  const setEnv = (k, v) => {
    savedEnv[k] = process.env[k];
    if (v === null) delete process.env[k]; else process.env[k] = v;
  };
  setEnv("EMAIL_UNSUB_SECRET", "test-secret");
  setEnv("GHOST_AGENCY_POSTAL_ADDRESS", "123 Real St, Irvine, CA 92618");
  setEnv("GHOST_AGENCY_SUPPORT_EMAIL", "support@example.test");
  setEnv("GHOST_AGENT_PHONE", agentPhone === undefined ? "+19493395562" : agentPhone);
  setEnv("GHOST_AGENCY_AGENT_PHONE", null);
  global.fetch = async () => { throw new Error("composing a dry-run email must not reach the network"); };
  try {
    const { sendSequenceStep } = require("../lib/email");
    const result = await sendSequenceStep({
      prospect: {
        prospect_id: "unbuilt-work-claims-1",
        business_name: "Roofing Example",
        email: "roofing@example.org",
        city: "Irvine",
        industry: "roofing",
        preview_url: "https://roofing-example.wss-ai.com/",
        current_website: "https://roofing-example.example/",
        before_shot_source_url: "https://www.roofing-example.example/",
      },
      sequence: 1,
      step: 1,
      dryRun: true,
      persistCampaignLog: false,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  } finally {
    global.fetch = savedFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test("the delivered email does not invite a text to a voice-only line", async () => {
  // The compliance footer is appended by lib/email.js AFTER the composer runs,
  // which is how it kept saying "Call or text" straight through the 2026-08-07
  // truth pass that removed that exact phrase from the body copy. The number is
  // Riley's VAPI line; nothing in this codebase receives an SMS on it.
  const composed = await composeColdEmail();
  assert.doesNotMatch(composed.composedText, /call or text/i, "the sent text half invites a text to a line nothing answers");
  assert.match(composed.composedText, /Call \(949\) 339-5562, or email /, "the footer lost its real support line");
});

// THE PITCH MAY ONLY SELL WHAT THE EXECUTOR CAN DO (2026-09-02). The V2 VIP row
// used to put "Change my video." in a prospect's mouth — a request
// classifyRequest() sends to the one refusal, because the executor has no video
// verb — and "CALL or TEXT anytime", though the Riley line is VAPI voice with
// no SMS provisioning. Riley is also he/him (owner correction); a stale "Tell
// her" shipped in the V3 Meet Riley card. Each guard below is a promise a live
// call would otherwise have to un-say.
const RILEY_PITCH_UNTRUTHS = [
  { re: /change my video/i, why: "a video-swap verb the executor does not have" },
  { re: /call or text|text or call|text Riley/i, why: "a text channel the voice-only VAPI line does not answer" },
  { re: /\bshe\b|\bher\b/i, why: "the wrong pronoun — Riley is he/him" },
];

// The examples the V2 VIP row quotes as things the owner can say. Each is
// checked against the REAL capability floor, not a list: if the copy ever
// quotes a phrase classifyRequest() refuses, this fails and the copy has to
// change — the same drift-guard the verb list itself is pinned by.
const RILEY_PITCHED_EXAMPLES = [
  "Make the phone number bigger.",
  "Reword that headline.",
  "Swap that photo.",
];

test("the Riley pitch sells no verb, channel, or pronoun the product does not have", () => {
  const v2Html = composeOutreachEmailV2({ ...EMAIL, senderName: "Mark Woodward" });
  const { html: v3Html, text: v3Text } = composeOutreachEmailV3(EMAIL);
  const surfaces = [["v2 html", v2Html], ["v3 html", v3Html], ["v3 text", v3Text]];
  for (const [surface, rendered] of surfaces) {
    for (const { re, why } of RILEY_PITCH_UNTRUTHS) {
      assert.doesNotMatch(rendered, re, `${surface} promises ${why}`);
    }
  }
  for (const example of RILEY_PITCHED_EXAMPLES) {
    assert.ok(v2Html.includes(example), `the VIP row no longer quotes "${example}" — update this pin and re-verify it classifies`);
    const verdict = classifyRequest(example);
    assert.equal(verdict.tier, "quick", `"${example}" is quoted in the pitch but classifies as ${verdict.tier} — the email may only quote quick edits`);
  }
});

test("an unconfigured agent line takes its clause with it, and leaves no hole", async () => {
  // agencyAgentPhone() documents "" as MUST BE TREATED AS OMIT; the footer
  // interpolated it unconditionally and printed "Questions? Call or text , or
  // email …" — observed in a real dry-run compose against a live prospect row.
  const composed = await composeColdEmail({ agentPhone: null });
  assert.doesNotMatch(composed.composedText, /Call\s*,/, "an empty number left a hole in the middle of the sentence");
  assert.doesNotMatch(composed.composedText, /call or text/i, "an empty number still invited a text");
  assert.match(composed.composedText, /Questions\? Email support@example\.test\./, "the fallback lost the support address");
});

test("the email does not put a quote form on pages that have no form", () => {
  // Rendered 2026-08-08 on wss-test-chattanooga-and-battlefield-plumbing-chatt,
  // wss-test-larson-air-conditioning-scottsdale and
  // wss-test-poor-john-s-plumbing-parkville: exactly ONE page per mirror
  // carries a <form>; /about and /faq carry none, because authority-pages.js
  // emits a CTA link rather than a form. A tel: button is on every page that
  // answers 200. One click from this email disproves the old wording.
  const { html, text } = composeOutreachEmailV3(EMAIL);
  for (const half of [html, text]) {
    assert.doesNotMatch(half, /quote form[^.<]{0,20}on every (single )?page/i, "claims a form on every page");
  }
  assert.match(html, /tap-to-call on every page/i, "dropped the claim that IS true everywhere");
  assert.match(text, /tap-to-call button on every page/i, "text half dropped the true claim");
});

test("the email's eleven checks equal the engine's truth plus polish checks", () => {
  // Read the exported contract, not source text. The truth/polish split keeps
  // eight reveal gates and three non-gating polish checks: eleven measured
  // checks still run, while only REQUIRED_CHECKS can block reveal.
  const names = new Set([...REQUIRED_CHECKS, ...POLISH_CHECKS]);
  assert.equal(names.size, 11, `email says eleven checks; engine measures ${names.size}`);
});

test("the email does not name a count of measured areas the report contradicts", () => {
  // "A health report on your current site, across seven measured areas" and
  // "Seven measured areas — graded in your report" shipped in the two halves.
  //
  // MEASURED 2026-08-09 through lib/report-grade.js — the same module the send
  // path uses — against every one of the 16 structurally-real report URLs in
  // the store (lib/report-url.js accepts 16 of the 17 stored values):
  //
  //     8 categories … 11 reports
  //     7 categories …  4 reports
  //     1 category  …  1 report
  //
  // and the union of keys across all of them is EIGHT: businessIntelligence,
  // geo, googleBusinessProfile, onlineReputation, security, seo, socialMedia,
  // websitePerformance. "Seven" was wrong for 11 of 16, and no other number is
  // right either — a report renders only the categories it captured and prints
  // "NOT CAPTURED IN THIS REPORT VERSION" for the rest, which is exactly the
  // predicate lib/report-grade.js drops on.
  //
  // The reader can count this in about four seconds: the link that settles it
  // is two lines further down the same email. So the email names no number.
  const { html, text } = composeOutreachEmailV3(EMAIL);
  for (const half of [html, text]) {
    assert.doesNotMatch(
      half,
      /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+measured\s+areas/i,
      "the email names a fixed count of measured areas",
    );
  }
  assert.match(
    text,
    /health report on your current site, graded area by area/i,
    "the text half lost the report bullet",
  );
  assert.match(html, /graded area by area/i, "the benefit grid lost its report row");
});

test("the sign-up floater sells only work the mirror lane performs", () => {
  const html = buildSignupFloater({
    clientId: "WSS-7A3980",
    rileyTel: "tel:+19493395562",
    checkoutUrl: "https://buy.stripe.com/test_abc",
    domain: "example.wss-ai.com",
  });
  assert.ok(html, "the floater rendered nothing to inspect");
  assert.doesNotMatch(html, UNBUILT_IMAGE_WORK, "floater promises pixel work no code performs");
  assert.doesNotMatch(html, UNBUILT_GENERATED_MEDIA, "floater promises media nothing generates");
  // The mirror contains no competitor content — that ranking lives in the
  // Signal report, exactly as the email's 2026-08-07 truth pass established.
  // The floater must not relocate it back into the pages.
  assert.doesNotMatch(
    html,
    /competitor[^<]{0,40}built into your pages/i,
    "floater puts competitor research in the pages, where it does not exist",
  );
});

// api/reveal.js builds its loading page as one long template literal and
// exports only the handler. Render it for real rather than reading the source:
// the whole point of this file is that source text and shipped text are not the
// same thing — a `//` note written inside that literal travels to the reader,
// and `\'` inside it collapses to a bare quote before the browser ever sees it.
function renderLoadingPage() {
  const revealPath = path.join(__dirname, "..", "api", "reveal.js");
  const backend = path.join(__dirname, "..").split(path.sep).join("/");
  const patched = fs.readFileSync(revealPath, "utf8")
    .split('require("../lib/').join(`require("${backend}/lib/`)
    .replace(/^module\.exports = async function handler/m, "module.exports.loadingPage = loadingPage;\nmodule.exports.handler = async function handler");
  const probe = path.join(os.tmpdir(), `wss-reveal-probe-${process.pid}-${Date.now()}.js`);
  try {
    fs.writeFileSync(probe, patched);
    return require(probe).loadingPage({ businessName: "Poor John's Plumbing", token: "t", sig: "s" });
  } finally {
    try { fs.unlinkSync(probe); } catch { /* best effort */ }
  }
}

test("the build-on-click loading page narrates the real build, not an imagined one", () => {
  const html = renderLoadingPage();
  assert.doesNotMatch(html, UNBUILT_IMAGE_WORK, "loading page narrates photo remastering");
  assert.doesNotMatch(html, UNBUILT_GENERATED_MEDIA, "loading page narrates image generation");
});

test("the loading page's inline script is script a browser can actually parse", () => {
  // Found by rendering this page while cutting the remastering copy: the
  // INCLUDED array carried `caller\'s`, and inside a template literal that
  // escape collapses to a bare apostrophe, closing the single-quoted string
  // early. The emitted <script> was a SyntaxError, so nothing in it ran — not
  // the stage animation, and not the ?poll=1 fetch that is the ONLY thing that
  // advances the build and redirects the prospect to their preview. It parses
  // now, and this test is what keeps the next apostrophe from killing it.
  const html = renderLoadingPage();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length, "the loading page shipped no inline script at all");
  for (const [i, code] of scripts.entries()) {
    assert.doesNotThrow(
      () => acorn.parse(code, { ecmaVersion: 2020 }),
      `inline script[${i}] of the loading page does not parse`,
    );
  }
});
