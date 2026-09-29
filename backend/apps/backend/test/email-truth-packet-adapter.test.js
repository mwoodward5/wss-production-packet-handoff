"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
// Which composer renders step 1 — the same function lib/email.js branches on.
const { proofEmailV3Enabled } = require("../lib/proof-email-inputs");

const originalEnv = { ...process.env };

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

afterEach(restoreEnvironment);

function configureDryRunEnvironment() {
  process.env.EMAIL_UNSUB_SECRET = "truth-packet-email-test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@wss-ai.com";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  process.env.GHOST_AGENCY_AGENT_PHONE = "+19493395562";
}

function canonicalTruthPacket(overrides = {}) {
  return {
    identity: {
      name: { value: "Harbor Ridge Roofing", confidence: 0.99 },
      city: { value: "Ventura", confidence: 0.99 },
      category: { value: "roofing", confidence: 0.99 },
    },
    intakeGenie: {
      facts: {
        name: "Harbor Ridge Roofing",
        city: "Ventura",
        category: "roofing",
        services: ["Standing seam roofing"],
      },
      assets: [],
      evidence: [],
      ...overrides,
    },
  };
}

// PROOF-FIRST FIXTURE (added 2026-07-31). Sequence 1 refuses to compose without
// a preview bound to this prospect and a "before" shot recorded on their own
// domain. This file is about the TRUTH-PACKET ADAPTER — which identity wins when
// a stale donor row and a canonical packet disagree — so it now supplies that
// evidence up front and keeps its own assertions untouched.
//
// The preview slug deliberately spells out the CANONICAL business (Harbor
// Ridge), not the stale donor row, because that is the identity the adapter is
// asserted to resolve to.
const PROVABLE_BUILD = {
  preview_url: "https://harbor-ridge-roofing.wss-ai.com/",
  current_website: "https://harborridgeroofing.com/",
  before_shot_source_url: "https://www.harborridgeroofing.com/",
};

function prospect(overrides = {}) {
  return {
    prospect_id: "harbor-ridge-consent-email",
    business_name: "Stale Donor Roofing",
    city: "Tukwila",
    industry: "donor construction",
    email: "owner@harborridgeroofing.com",
    truth_packet: canonicalTruthPacket(),
    ...PROVABLE_BUILD,
    ...overrides,
  };
}

async function compose({ prospectOverrides = {}, vars = {}, step = 1 } = {}) {
  configureDryRunEnvironment();
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: prospect(prospectOverrides),
    sequence: 1,
    step,
    vars,
    dryRun: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mode, "dry_run");
  return result;
}

// MIGRATED 2026-07-31 (consent-first -> proof-first). The subject contract and
// the retired "For local roofing teams in {city}." line both belonged to the
// consent email. The POINT of this test is unchanged and is asserted below: a
// stale donor row and caller-injected vars must never beat the canonical truth
// packet — not in the subject, not in the body.
test("canonical truth supplies the business identity and subject, over a stale donor row", async () => {
  const result = await compose({
    vars: {
      business_name: "Injected Donor LLC",
      city: "Seattle",
      industry: "donor roofing",
    },
  });

  assert.match(result.subject, /Harbor Ridge Roofing/);
  assert.doesNotMatch(result.subject, /talk to your website and it changes/i);
  assert.match(result.bodyPreview, /^Hi Harbor Ridge Roofing team,/);
  assert.match(result.htmlPreview, /Ventura/);
  assert.doesNotMatch(result.subject, /Stale|Donor|Tukwila|Seattle/i);
  assert.doesNotMatch(result.htmlPreview, /Stale Donor|Injected Donor|Tukwila|Seattle/i);
});

// MIGRATED 2026-07-31. Was "persisted and caller-supplied legacy artifacts never
// enter consent-first output". The prospect's OWN preview is no longer a legacy
// artifact to be scrubbed — it is the email. Everything else on the list still
// is, and every one of those assertions is kept verbatim: a persisted report
// URL, a persisted Stripe checkout URL, a caller-supplied reveal token, a
// third-party screenshot host, and a persisted expiry date must not reach the
// body. So must the injected "I already rebuilt your website" / "Launch my site
// with Stripe" copy vars.
//
// The legacy PREVIEW value is still fed in — as a hostile input on a foreign
// host — and lib/email.js now HARD-REFUSES it (preview_host_not_approved)
// rather than silently dropping it, so it is exercised in its own test below.
test("persisted and caller-supplied legacy artifacts never enter proof-first output", async () => {
  const legacyValues = [
    "https://legacy-preview.example.test/",
    "https://callprep.example.test/report/legacy",
    "https://buy.stripe.com/legacy-checkout",
    "https://ghost.example.test/api/reveal?token=legacy",
    "https://s0.wp.com/mshots/v1/legacy-proof",
    "August 5, 2026",
  ];
  const result = await compose({
    prospectOverrides: {
      report_url: legacyValues[1],
      checkout_url: legacyValues[2],
      preview_expires_at: legacyValues[5],
    },
    vars: {
      preview_url: legacyValues[0],
      report_url: legacyValues[1],
      checkout_url: legacyValues[2],
      reveal_url: legacyValues[3],
      email_hero_image: legacyValues[4],
      sunset_date: legacyValues[5],
      findings_text: "I already rebuilt your website.",
      comparison_text: "Launch my site with Stripe.",
    },
  });

  for (const value of legacyValues) {
    assert.doesNotMatch(result.htmlPreview, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  // "already rebuilt" left this list on 2026-07-31 — it is the proof-first
  // claim now, and the send is refused unless it is true. Commerce, scarcity
  // and injected sales copy did not.
  assert.doesNotMatch(
    result.htmlPreview,
    /Launch my site|Stripe|checkout|countdown|expires?|comes down/i,
  );
  assert.deepEqual(result.comparison, []);
  assert.equal(result.authorityText, "");
  assert.equal(result.previewExpiresOn, null);
});

// SECURITY HALF, UNCHANGED. A preview on a host we do not control is refused
// outright rather than scrubbed — the same answer a stale preview from a
// different business gets (test/security-contracts.test.js). Under
// consent-first this input was silently dropped and the email went out anyway.
test("a persisted preview on a foreign host is refused, not quietly dropped", async () => {
  configureDryRunEnvironment();
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: prospect({ preview_url: "https://legacy-preview.example.test/" }),
    sequence: 1,
    step: 1,
    dryRun: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "preview_host_not_approved");
  assert.equal(result.htmlPreview, undefined, "nothing may be composed around a refused preview");
});

test("prospect media, branding, and reviews cannot replace the WSS email shell", async () => {
  const donorLogo = "https://donor.example.test/logo.svg";
  const donorPhoto = "https://donor.example.test/hero.webp";
  const result = await compose({
    prospectOverrides: {
      logo_url: donorLogo,
      brand_color: "#4169e1",
      rating: 5,
      review_count: 999,
      reviews: [{ text: "Donor review that must not ship." }],
      truth_packet: canonicalTruthPacket({
        assets: [
          { kind: "logo", url: donorLogo, approved: true },
          { kind: "photo", url: donorPhoto, approved: true },
        ],
        trust: {
          rating: 5,
          review_count: 999,
          reviews: [{ text: "Canonical review that still does not belong in pre-consent mail." }],
        },
      }),
    },
    vars: {
      hero_image: donorPhoto,
      review_snapshot_image: "https://donor.example.test/reviews.png",
    },
  });

  // MIGRATED 2026-07-31: was "exactly one <img>" (the WSS mark), because the
  // consent email carried no pictures at all. It now carries the two proof
  // shots — and NOTHING ELSE. The assertion that matters is unchanged and is
  // now enforced by construction: every <img> in the email is served from a
  // host we control, so a donor logo, a donor photo and a donor review
  // snapshot cannot become an <img> even when all three are supplied.
  //
  // MIGRATED AGAIN 2026-08-07: step 1 composes through lib/outreach-email-v3.js
  // when GHOST_AGENCY_PROOF_EMAIL_V3 is on, and that shell also carries Riley's
  // avatar — served from our own /brand/ directory, exactly like the WSS mark.
  // The count therefore moved from 3 to 4 and THE ASSERTION THAT MATTERS DID
  // NOT MOVE AT ALL: it is the host loop below, which is what a donor logo, a
  // donor photo or a donor review snapshot would actually trip. The count is
  // pinned per lane so that a NEW image appearing from anywhere still fails.
  // COUNT MOVED AGAIN 2026-08-12 (the compression pass): the V3 shell renders
  // Riley's avatar twice (the WHAT-YOU-GET tile and the call-Riley door) and the
  // after proof shot twice (the before/after strip and the your-new-website door
  // thumbnail). 2026-08-13: the WSS Connect banner now carries the owner's own
  // funnel graphic (connect-funnel.png) — one more <img>, one more distinct
  // first-party asset. So SEVEN <img> over FIVE distinct assets; the host loop
  // below remains the assertion that matters.
  //
  // COUNT MOVED AGAIN 2026-09-02 (the polish-v2 mock, owner showpiece note):
  // the funnel PNG is RETIRED — the owner read its letter tiles as "plain
  // letters" and ordered a drawn app-frame graphic instead. The frame is pure
  // tables that reuses the WSS mark PNG (the mark now renders twice: header +
  // WSS Connect app bar), so the total stays SEVEN while the DISTINCT set
  // drops to four. The host loop below remains the assertion that matters.
  //
  // COUNT MOVED AGAIN 2026-09-03 (the final-polish pass): the drawn table flag
  // and the 🇺🇸 emoji retire — the owner supplied a real first-party flag
  // raster (/brand/us-flag.png) that renders in THREE spots (brand row, the
  // American-AI story card, the BUILT WITH AMERICAN AI strip). TEN <img> over
  // FIVE distinct assets; the host loop below remains the assertion that
  // matters.
  const imageSources = [...result.htmlPreview.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&"));
  assert.equal(
    imageSources.length,
    proofEmailV3Enabled() ? 10 : 3,
    `unexpected image set: ${JSON.stringify(imageSources)}`,
  );
  assert.equal(
    new Set(imageSources).size,
    proofEmailV3Enabled() ? 5 : 3,
    `unexpected DISTINCT image set: ${JSON.stringify(imageSources)}`,
  );
  assert.ok(imageSources.includes("https://ghost.wss-ai.com/brand/wss-mark-176.png"));
  if (proofEmailV3Enabled()) {
    const markCount = imageSources.filter((src) => src === "https://ghost.wss-ai.com/brand/wss-mark-176.png").length;
    assert.ok(markCount >= 2, "the WSS Connect app-frame graphic reuses the first-party W mark (funnel PNG retired 2026-09-02)");
  }
  assert.equal(
    imageSources.filter((src) => /\/api\/media\/preview-shot/.test(src)).length,
    proofEmailV3Enabled() ? 3 : 2,
    "the before and after proof shots must both render (V3 reuses the after as door 1's thumbnail)",
  );
  for (const src of imageSources) {
    assert.match(src, /^https:\/\/(?:[a-z0-9-]+\.)*wss-ai\.com\//i, `third-party image host: ${src}`);
  }
  // `999` alone also matches the entity &#9997; (the pencil emoji in the steps
  // block), so the count is matched where it would actually be ASSERTED — next
  // to the word "reviews" — rather than as a bare digit run anywhere in the HTML.
  //
  // #4169e1 LEFT THIS LIST 2026-08-12, DELIBERATELY. The owner's compression
  // directive orders the client's own measured accent onto the client's OWN
  // surfaces — the name chip, the frame around their new site's screenshots —
  // against WSS blue for ours ("use their accent for their blocks"). So the
  // measured brand_color now legitimately appears in the shell, routed through
  // design.clientAccent(), which refuses design-lock-forbidden hexes and
  // adjusts only lightness for legibility. What this test still refuses is
  // IDENTITY replacing the shell: donor-hosted imagery, donor reviews, and a
  // fabricated review count. The WSS chrome itself (buttons, price card,
  // tiles) takes PALETTE.accent by code, not by input, and the design-lock
  // suite pins the forbidden hexes.
  assert.doesNotMatch(result.htmlPreview,
    /donor\.example\.test|\b999\b\s*(?:Google\s*)?reviews|999 reviews|Donor review|Canonical review/i);
});

// THE FLAT brand_color NEVER OUTRANKS THE VERIFIED ACCENT (weld 2026-08-20).
// record.brand_color is historically a scraped CTA colour — the 2026-08-03
// stale-proof incident vector — and lib/email.js used to prefer it over the
// accent the build-ready contract proved, so the email could dress itself in a
// button colour the mirror never wore. The composer now asks verifiedBrandOf
// (shipped brand_truth first, then the contract), and the flat field survives
// only as that reader's own last resort for contract-less legacy rows.
test("a verified contract accent beats a stale flat brand_color in the shell", async () => {
  const result = await compose({
    prospectOverrides: {
      record: {
        // The stale scraped CTA colour that used to short-circuit the read.
        brand_color: "#4169e1",
        build_ready: {
          mirror_request: {
            brand: { logo: "https://harborridgeroofing.com/logo.png", accent: "#0B5CAB" },
          },
          brand_evidence: { logo_url: "https://harborridgeroofing.com/logo.png", accent: "#0B5CAB" },
        },
      },
    },
  });
  assert.match(result.htmlPreview, /#0B5CAB/i, "the verified accent dresses the client's surfaces");
  assert.doesNotMatch(result.htmlPreview, /#4169e1/i, "the scraped CTA colour must never outrank it");
});

// MIGRATED 2026-07-31. Was "follow-ups stay consent-first and the only HTML link
// is unsubscribe" — both clauses are the reversed policy (the follow-up claimed
// nothing had been built; the preview link was withheld). The STRUCTURAL half is
// what this test is really for and is asserted unchanged: exactly one <head>,
// one <style>, one <body>, no empty href/src, and no "undefined"/"null" leaking
// into the markup.
test("follow-ups carry the proof-first claim and stay structurally sound", async () => {
  const result = await compose({ step: 2 });
  const hrefs = [...result.htmlPreview.matchAll(/\bhref="([^"]+)"/gi)].map((match) =>
    match[1].replace(/&amp;/g, "&"));

  // MIGRATED 2026-08-10 with the owner-approved follow-up rewrite. The claim
  // being asserted is the same one — this email is about work already done —
  // said in the company's voice instead of a founder's.
  assert.match(result.bodyPreview, /The website WSS Labs built for Harbor Ridge Roofing is ready to review\./);
  assert.doesNotMatch(result.bodyPreview, /I have not built or published anything/i);
  assert.doesNotMatch(result.bodyPreview, /following up|the preview I built/i);
  assert.ok(hrefs.some((href) => /\/api\/outreach\/unsubscribe\?/.test(href)), "unsubscribe must still render");
  for (const href of hrefs) {
    assert.match(
      href,
      /^(?:https:\/\/(?:[a-z0-9-]+\.)*(?:wss-ai\.com|harborridgeroofing\.com)\/|mailto:)/i,
      `unexpected link host: ${href}`,
    );
  }
  assert.equal((result.htmlPreview.match(/<head\b/gi) || []).length, 1);
  // The proof-first shell is fully inline-styled (Gmail strips <style> from the
  // clipped view), so a <style> block is optional — but never duplicated, which
  // is what this assertion was guarding: one shell, not two concatenated.
  assert.ok((result.htmlPreview.match(/<style\b/gi) || []).length <= 1);
  assert.equal((result.htmlPreview.match(/<body\b/gi) || []).length, 1);
  assert.equal((result.htmlPreview.match(/<\/body>/gi) || []).length, 1);
  assert.doesNotMatch(result.htmlPreview, /\b(?:href|src)=""/i);
  assert.doesNotMatch(result.htmlPreview, /\b(?:undefined|null)\b/i);
});
