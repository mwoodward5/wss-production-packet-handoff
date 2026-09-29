"use strict";

// ---------------------------------------------------------------------------
// test/checkout-loop.test.js — CAN A BUSINESS ACTUALLY PAY US, AND FOR HOW MUCH.
//
// Three defects met in one place on 2026-08-08, and all three are the same
// shape: a thing that was built, and then never connected to the thing that
// needed it.
//
//   A. FOUR PRICES FOR ONE PRODUCT. The proof email said $149/mo with a $500
//      setup fee waived. The sign-up panel on the mirror that email links to
//      said $199/mo with a $499 fee. The follow-up step-1 fallback said $199.
//      The same business could read two numbers inside one minute.
//
//   B. NO WAY TO PAY. buildCheckoutLink() has existed since the SiteForge lane
//      and had no caller on the mirror path; the panel's checkoutUrl was fed
//      only by GHOST_AGENCY_CHECKOUT_URL, which has never been set in
//      production; and the proof email had no checkout surface at all. Stripe,
//      the webhook, fulfilment and the domain purchase were all live and
//      unreachable.
//
//   C. LINKS THAT NEVER EXPIRED. All three signed-link modules tested expiry
//      with `Number(payload.exp) < Date.now()`. `Number(undefined)` is NaN and
//      `NaN < n` is FALSE, so a token minted without an `exp` passed the check
//      forever — a permanent bearer credential for as long as the secret lived.
//      Harmless while nothing minted checkout links. Not harmless now.
//
// The tests below hold each of those shut, and they are written against the
// SHIPPED artifacts — the composed email, the rendered panel, the verifier —
// never against the intention. A QC pass is not proof; the rendered bytes are.
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { afterEach, test } = require("node:test");

const {
  buildCheckoutLink,
  prospectCheckoutUrl,
  verifyCheckoutLink,
  CHECKOUT_URL_ENV_NAME,
  CHECKOUT_SECRET_ENV_NAME,
} = require("../lib/checkout-links");
const { verifyReportLink, buildReportLink } = require("../lib/report-links");
const { verifyRevealLink, buildRevealLink } = require("../lib/reveal-links");
const { buildSignupFloater, resolveSignupConfig } = require("../lib/mirror-engine/signup-floater");
const { resolveBuildableDonor } = require("../lib/lead-miner");

const SECRET = "checkout-loop-test-secret";
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  global.fetch = originalFetch;
});

function visibleText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&#36;/g, "$")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function hrefs(html) {
  return [...new Set([...String(html).matchAll(/\bhref="([^"]+)"/gi)]
    .map((m) => m[1].replace(/&amp;/g, "&")))];
}

/**
 * Mint a token by hand so a payload the real builders would never produce — one
 * with NO `exp` — can still carry a VALID signature. That is the whole point:
 * the signature was never the hole. A holder of the secret (a leaked older
 * token shape, a hand-rolled link, a truncated payload) got a credential that
 * outlived every TTL the code claimed to enforce.
 */
function signedToken(payload, prefix) {
  const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(`${prefix}${token}`).digest("base64url");
  return { token, sig };
}

// ===========================================================================
// C. AN EXPIRY THAT IS NOT A NUMBER IS AN EXPIRED ONE
// ===========================================================================

const LINK_MODULES = [
  {
    name: "checkout",
    prefix: "",
    secretEnv: CHECKOUT_SECRET_ENV_NAME,
    verify: verifyCheckoutLink,
    base: { v: 1, job_id: "mirror-acme", prospect_id: "acme" },
  },
  {
    name: "report",
    prefix: "report:",
    secretEnv: "GHOST_AGENCY_REPORT_LINK_SECRET",
    verify: verifyReportLink,
    base: { v: 1, prospect_id: "acme", business_name: "Acme" },
  },
  {
    name: "reveal",
    prefix: "reveal:",
    secretEnv: "GHOST_AGENCY_REPORT_LINK_SECRET",
    verify: verifyRevealLink,
    base: { v: 1, prospect_id: "acme", preview_url: "https://acme.wss-ai.com/" },
  },
];

for (const mod of LINK_MODULES) {
  test(`${mod.name} links: a token with NO expiry is refused, not honoured forever`, () => {
    process.env[mod.secretEnv] = SECRET;
    const { token, sig } = signedToken(mod.base, mod.prefix);
    const out = mod.verify(token, sig);
    // BEFORE THE FIX this returned { ok: true }: NaN < Date.now() is false, so
    // the "is it in the past" branch answered "no" for a value that does not
    // exist. The token was valid until the secret rotated.
    assert.equal(out.ok, false, `${mod.name} honoured an expiry-less token`);
    assert.equal(out.reason, "expired");
  });

  test(`${mod.name} links: a non-numeric expiry is refused too`, () => {
    process.env[mod.secretEnv] = SECRET;
    // Every one of these coerces to NaN, and every one of them used to pass.
    for (const exp of ["", "soon", null, {}, [], "2026-08-08", Infinity, NaN]) {
      const { token, sig } = signedToken({ ...mod.base, exp }, mod.prefix);
      const out = mod.verify(token, sig);
      assert.equal(out.ok, false, `${mod.name} honoured exp=${JSON.stringify(exp)}`);
      assert.equal(out.reason, "expired");
    }
  });

  test(`${mod.name} links: a real future expiry still works, a past one still does not`, () => {
    process.env[mod.secretEnv] = SECRET;
    const future = signedToken({ ...mod.base, exp: Date.now() + 60_000 }, mod.prefix);
    assert.equal(mod.verify(future.token, future.sig).ok, true, `${mod.name} rejected a live token`);

    const past = signedToken({ ...mod.base, exp: Date.now() - 60_000 }, mod.prefix);
    const expired = mod.verify(past.token, past.sig);
    assert.equal(expired.ok, false);
    assert.equal(expired.reason, "expired");
  });
}

test("the real builders still mint links their own verifiers accept", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  process.env.GHOST_AGENCY_REPORT_LINK_SECRET = SECRET;
  const prospect = {
    prospect_id: "acme-roofing-ventura",
    business_name: "Acme Roofing",
    city: "Ventura",
    industry: "roofing",
    preview_url: "https://acme-roofing-ventura.wss-ai.com/",
  };

  const checkout = new URL(buildCheckoutLink({ prospect, job: { id: "job-1" } }));
  assert.equal(
    verifyCheckoutLink(checkout.searchParams.get("token"), checkout.searchParams.get("sig")).ok,
    true,
  );
  const report = new URL(buildReportLink(prospect));
  assert.equal(
    verifyReportLink(report.searchParams.get("token"), report.searchParams.get("sig")).ok,
    true,
  );
  const reveal = new URL(buildRevealLink(prospect));
  assert.equal(
    verifyRevealLink(reveal.searchParams.get("token"), reveal.searchParams.get("sig")).ok,
    true,
  );
});

// ===========================================================================
// B. A REAL BUY LINK — AND FAIL CLOSED WHEN IT CANNOT BE A REAL ONE
// ===========================================================================

const PROSPECT = Object.freeze({
  prospect_id: "acme-roofing-ventura",
  business_name: "Acme Roofing",
  industry: "roofing",
  city: "Ventura",
  state: "CA",
});

test("no signing secret means NO button — never a link that 401s on click", () => {
  delete process.env[CHECKOUT_SECRET_ENV_NAME];
  delete process.env[CHECKOUT_URL_ENV_NAME];
  assert.equal(prospectCheckoutUrl({ prospect: PROSPECT }), "");
});

test("no prospect identity means NO button — a checkout attached to nobody is not a sale", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  delete process.env[CHECKOUT_URL_ENV_NAME];
  assert.equal(prospectCheckoutUrl({ prospect: {} }), "");
  assert.equal(prospectCheckoutUrl({ prospect: { business_name: "Acme Roofing" } }), "");
});

test("with a secret and a prospect the minted link is signed, ours, and about THEM", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  delete process.env[CHECKOUT_URL_ENV_NAME];
  process.env.GHOST_AGENCY_API_URL = "https://ghost.wss-ai.com";

  const url = new URL(prospectCheckoutUrl({ prospect: PROSPECT }));
  assert.equal(url.origin, "https://ghost.wss-ai.com");
  assert.equal(url.pathname, "/api/checkout-link");

  // The route that receives the click must accept it. Anything less than this
  // assertion is "we rendered a URL", which is not the same claim.
  const check = verifyCheckoutLink(url.searchParams.get("token"), url.searchParams.get("sig"));
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.equal(check.payload.prospect_id, "acme-roofing-ventura");
  assert.equal(check.payload.business_name, "Acme Roofing");
  // Stable per prospect, so a rebuild or a second email addresses one job row
  // rather than opening a second.
  assert.equal(check.payload.job_id, "mirror-acme-roofing-ventura");
  assert.equal(prospectCheckoutUrl({ prospect: PROSPECT }).split("?")[0], url.href.split("?")[0]);
});

test("checkout bytes are stable inside one UTC epoch week and rotate at its boundary", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  delete process.env[CHECKOUT_URL_ENV_NAME];
  process.env.GHOST_AGENCY_API_URL = "https://ghost.wss-ai.com";

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const currentBucketStart = Math.floor(Date.now() / weekMs) * weekMs;
  const input = { prospect: PROSPECT, job: { id: "mirror-acme-roofing-ventura" } };
  const firstNow = currentBucketStart + 1;
  const lastNow = currentBucketStart + weekMs - 1;
  const first = buildCheckoutLink({ ...input, now: firstNow });
  const sameBucket = buildCheckoutLink({ ...input, now: () => lastNow });
  const nextBucket = buildCheckoutLink({ ...input, now: currentBucketStart + weekMs });

  assert.equal(sameBucket, first, "same prospect/job/secret changed bytes inside one bucket");
  assert.notEqual(nextBucket, first, "the next epoch-week bucket did not rotate the signed URL");

  for (const [urlString, mintedAt] of [[first, firstNow], [sameBucket, lastNow], [nextBucket, currentBucketStart + weekMs]]) {
    const url = new URL(urlString);
    const check = verifyCheckoutLink(url.searchParams.get("token"), url.searchParams.get("sig"));
    assert.equal(check.ok, true, JSON.stringify(check));
    const remaining = check.payload.exp - mintedAt;
    assert.ok(remaining >= 42 * 24 * 60 * 60 * 1000, `TTL below 42 days: ${remaining}`);
    assert.ok(remaining <= 49 * 24 * 60 * 60 * 1000, `TTL above 49 days: ${remaining}`);
  }
});

test("checkout minting fails closed when the injected clock is not finite", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  const input = { prospect: PROSPECT, job: { id: "mirror-acme-roofing-ventura" } };
  const overflow = Number.MAX_SAFE_INTEGER - (7 * 7 * 24 * 60 * 60 * 1000) + 1;
  for (const now of [NaN, Infinity, -1, overflow, "", "not-a-time", Symbol("clock"), () => { throw new Error("clock unavailable"); }]) {
    assert.equal(buildCheckoutLink({ ...input, now }), "");
  }
});

test("checkout expiry is valid one millisecond before its boundary and expired at it", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  const url = new URL(buildCheckoutLink({ prospect: PROSPECT, job: { id: "expiry-boundary" } }));
  const token = url.searchParams.get("token");
  const sig = url.searchParams.get("sig");
  const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  const realNow = Date.now;
  try {
    Date.now = () => payload.exp - 1;
    assert.equal(verifyCheckoutLink(token, sig).ok, true);
    Date.now = () => payload.exp;
    assert.deepEqual(verifyCheckoutLink(token, sig), { ok: false, reason: "expired" });
    Date.now = () => payload.exp + 1;
    assert.deepEqual(verifyCheckoutLink(token, sig), { ok: false, reason: "expired" });
  } finally {
    Date.now = realNow;
  }
});

test("an explicitly configured checkout URL still wins — an operator decision is not overridden", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  process.env[CHECKOUT_URL_ENV_NAME] = "https://buy.wss-ai.com/local-growth";
  assert.equal(prospectCheckoutUrl({ prospect: PROSPECT }), "https://buy.wss-ai.com/local-growth");
  // ...but only if it is a real https URL. A half-set variable is not a link.
  process.env[CHECKOUT_URL_ENV_NAME] = "buy.wss-ai.com";
  assert.match(prospectCheckoutUrl({ prospect: PROSPECT }), /^https:\/\/ghost\.wss-ai\.com\/api\/checkout-link\?/);
});

// ===========================================================================
// A + B ON THE PANEL — the surface the prospect meets on their own new site
// ===========================================================================

test("the sign-up panel carries a working buy button, minted for this prospect", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  delete process.env[CHECKOUT_URL_ENV_NAME];
  process.env.GHOST_AGENCY_API_URL = "https://ghost.wss-ai.com";
  delete process.env.GHOST_AGENT_PHONE;
  delete process.env.GHOST_AGENCY_AGENT_PHONE;

  const resolved = resolveSignupConfig({ prospect: PROSPECT, slug: "wss-test-acme-roofing-ventura" });
  // No Riley line configured here on purpose: the checkout half ALONE is now
  // enough to show a panel, which it never was before, because the only source
  // of a checkout URL was a variable nobody had set.
  assert.equal(resolved.ok, true, resolved.reason);
  assert.match(resolved.signup.checkoutUrl, /^https:\/\/ghost\.wss-ai\.com\/api\/checkout-link\?/);

  const html = buildSignupFloater(resolved.signup);
  const buyHref = hrefs(html).find((h) => h.includes("/api/checkout-link"));
  assert.ok(buyHref, `the panel rendered no buy link: ${hrefs(html).join(", ")}`);
  const url = new URL(buyHref);
  assert.equal(
    verifyCheckoutLink(url.searchParams.get("token"), url.searchParams.get("sig")).ok,
    true,
    "the panel rendered a link its own verifier refuses",
  );
});

test("the observed prospect-to-signup path is byte-stable across one epoch week", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  delete process.env[CHECKOUT_URL_ENV_NAME];
  process.env.GHOST_AGENCY_API_URL = "https://ghost.wss-ai.com";
  const realNow = Date.now;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const bucketStart = Math.floor(realNow() / weekMs) * weekMs;
  try {
    Date.now = () => bucketStart + 1;
    const first = resolveSignupConfig({ prospect: PROSPECT, slug: "wss-test-acme-roofing-ventura" });
    Date.now = () => bucketStart + weekMs - 1;
    const last = resolveSignupConfig({ prospect: PROSPECT, slug: "wss-test-acme-roofing-ventura" });
    assert.equal(first.ok, true, first.reason);
    assert.equal(last.ok, true, last.reason);
    assert.equal(last.signup.checkoutUrl, first.signup.checkoutUrl);
  } finally {
    Date.now = realNow;
  }
});

test("with neither a Riley line nor any way to pay, the panel names BOTH missing halves", () => {
  delete process.env[CHECKOUT_SECRET_ENV_NAME];
  delete process.env[CHECKOUT_URL_ENV_NAME];
  delete process.env.GHOST_AGENT_PHONE;
  delete process.env.GHOST_AGENCY_AGENT_PHONE;

  const resolved = resolveSignupConfig({ prospect: PROSPECT, slug: "s" });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.signup, null);
  // An operator has to know WHICH variable to set, and there are now two ways
  // to satisfy the checkout half.
  assert.match(resolved.reason, /GHOST_AGENCY_CHECKOUT_URL/);
  assert.match(resolved.reason, /GHOST_AGENCY_CHECKOUT_LINK_SECRET/);
  assert.match(resolved.reason, /Riley/);
});

// ===========================================================================
// A. ONE PRICE, ON EVERY SURFACE THIS REPO RENDERS
// ===========================================================================

test("the sign-up panel quotes $149 and a waived $500 setup fee — not $199/$499", () => {
  const html = buildSignupFloater({
    clientId: "WSS-7A3980",
    rileyTel: "tel:+19493395562",
    domain: "wss-test-acme-roofing-ventura.wss-ai.com",
  });
  const text = visibleText(html);
  assert.match(text, /\$149/);
  assert.match(text, /\$500 setup fee/);
  // The old numbers must be gone from the SHIPPED BYTES, markup and script
  // alike — the collapsed pill is server-rendered too, and it is what shows in
  // a screenshot of the page.
  assert.doesNotMatch(html, /199|499/);
  assert.match(html, /\$149 site plan|&#36;149 site plan/);
});

test("the V2 offer card — the step-1 fallback lane — quotes the same $149", () => {
  const { composeOutreachEmailV2 } = require("../lib/outreach-email-v2");
  const composed = composeOutreachEmailV2({
    businessName: "Acme Roofing",
    city: "Ventura",
    industry: "roofing",
    footer: { postal: "655 S Main St, Suite 200, Orange, CA 92868", unsubscribe: "https://ghost.wss-ai.com/api/outreach/unsubscribe?t=x" },
    cta: { previewUrl: "https://acme-roofing-ventura.wss-ai.com/" },
  });
  const html = typeof composed === "string" ? composed : composed.html;
  const text = visibleText(html);
  assert.match(text, /\$149/);
  assert.doesNotMatch(text, /\$199|\$499/);
});

// ===========================================================================
// B. THE PROOF EMAIL — composed through the REAL send path, twice
// ===========================================================================

function configureSendEnvironment() {
  process.env.EMAIL_UNSUB_SECRET = "checkout-loop-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@wss-ai.com";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  process.env.GHOST_AGENCY_API_URL = "https://ghost.wss-ai.com";
  delete process.env.GHOST_AGENCY_PROOF_EMAIL_V3;
  global.fetch = async () => {
    throw new Error("composing a dry-run email must not reach the network");
  };
}

const SENDABLE = Object.freeze({
  prospect_id: "harbor-ridge-lane",
  business_name: "Harbor Ridge Roofing",
  city: "Ventura",
  industry: "roofing",
  email: "owner@harborridgeroofing.com",
  preview_url: "https://harbor-ridge-roofing.wss-ai.com/",
  current_website: "https://harborridgeroofing.com/",
  before_shot_source_url: "https://www.harborridgeroofing.com/",
});

async function composeProofEmail() {
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({ prospect: SENDABLE, sequence: 1, step: 1, dryRun: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

test("the proof email carries a signed buy button, in BOTH MIME halves", async () => {
  configureSendEnvironment();
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  delete process.env[CHECKOUT_URL_ENV_NAME];

  const result = await composeProofEmail();
  const buyHref = hrefs(result.htmlPreview).find((h) => h.includes("/api/checkout-link"));
  assert.ok(buyHref, `no buy button in the proof email: ${hrefs(result.htmlPreview).join(" | ")}`);

  const url = new URL(buyHref);
  assert.equal(url.origin, "https://ghost.wss-ai.com");
  const check = verifyCheckoutLink(url.searchParams.get("token"), url.searchParams.get("sig"));
  assert.equal(check.ok, true, "the email shipped a checkout link the route would refuse");
  assert.equal(check.payload.prospect_id, "harbor-ridge-lane");

  // The label a reader sees, and the same link in the plain-text half — a
  // button one client renders and another cannot see is two different emails.
  assert.match(visibleText(result.htmlPreview), /START MY PLAN/);
  assert.ok(result.composedText.includes(buyHref), "the text half lost the buy link");
});

test("with no signing secret the proof email ships NO button at all", async () => {
  configureSendEnvironment();
  delete process.env[CHECKOUT_SECRET_ENV_NAME];
  delete process.env[CHECKOUT_URL_ENV_NAME];

  const result = await composeProofEmail();
  assert.equal(hrefs(result.htmlPreview).some((h) => h.includes("/api/checkout-link")), false);
  assert.doesNotMatch(result.htmlPreview, /START MY PLAN/);
  // And nothing empty is left behind where the button was.
  assert.doesNotMatch(result.htmlPreview, /\b(?:href|src)=""/i);
});

test("the proof email states one price, and it is $149 with the $500 fee waived", async () => {
  configureSendEnvironment();
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  const result = await composeProofEmail();
  const visible = visibleText(result.htmlPreview);

  for (const half of [visible, result.composedText]) {
    assert.match(half, /\$149/);
    assert.match(half, /\$500 setup fee/);
    assert.doesNotMatch(half, /\$199|\$499/);
  }
});

test("the buy link is the only payment surface, and it is on OUR host", async () => {
  configureSendEnvironment();
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  const result = await composeProofEmail();

  // THIS REPLACES A BLANKET `doesNotMatch(/checkout/)`. That assertion encoded
  // "no payment link, ever", which was the right rule while the email showed a
  // price and offered no way to act on it. The rule that actually protects a
  // prospect is narrower and stronger: the ONLY payment destination may be our
  // own signed checkout route. A third-party payment host in a cold email —
  // buy.stripe.com, a Payment Link, PayPal — is still refused outright, and
  // now it is refused by name rather than as a side effect.
  assert.doesNotMatch(
    result.htmlPreview,
    /buy\.stripe\.com|checkout\.stripe\.com|paypal|venmo|cash\.app|\bsquareup\b/i,
  );
  for (const href of hrefs(result.htmlPreview)) {
    assert.match(
      href,
      /^(?:https:\/\/(?:[a-z0-9-]+\.)*(?:wss-ai\.com|harborridgeroofing\.com)\/|tel:\+[0-9]+$|mailto:)/i,
      `the proof email linked a host that is not ours: ${href}`,
    );
  }
});

// ===========================================================================
// D. A DONOR THAT MUST NOT MEET A STRANGER AGAIN
// ===========================================================================

test("medspa-luma's bundle stays clean; the donor is owner-barred for line campaigns, not retired", () => {
  // This test used to assert the opposite — that med spa stays retired. The
  // donor was un-retired on 2026-08-12 (BOILERPLATE.json unretired_note) after
  // the exact cure the retirement reason demanded: the 'Placeholder review
  // text.' testimonials by A./B./C. Client were removed from the bundle and
  // the empty reviews section renders null. A retirement is a condition, not
  // a verdict (same rule as landscaping below), so the lock now holds the
  // CONDITION: the invented customers must stay out of every renderable byte.
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "donors-clean", "medspa-luma");
  const renderable = [path.join(dir, "index.html")];
  const assetsDir = path.join(dir, "assets");
  for (const name of fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : []) {
    if (/\.(js|css|html)$/.test(name)) renderable.push(path.join(assetsDir, name));
  }
  assert.ok(renderable.length >= 2, "the bundle went missing rather than getting clean");
  for (const file of renderable) {
    const bytes = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(bytes, /[A-C]\.\s*Client/, `${path.basename(file)} still carries an invented customer`);
    assert.doesNotMatch(bytes, /Placeholder review text/i, `${path.basename(file)} still carries the placeholder testimonial`);
  }

  // Owner directive 2026-08-31: medspa-luma is one of the two suspected bad
  // apples excluded from fresh line campaigns (lib/donor-exclusions.js). The
  // refusal is a selection decision, NOT a retirement — the manifest is clean,
  // and the env override re-includes the donor the moment it is asked to.
  const out = resolveBuildableDonor("med spa");
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(out.reason, "donor_unavailable_for_vertical");
  assert.deepEqual(out.excludedDonors, ["medspa-luma"]);

  process.env.GHOST_AGENCY_DONOR_EXCLUSIONS = "none";
  try {
    const reIncluded = resolveBuildableDonor("med spa");
    assert.equal(reIncluded.ok, true, JSON.stringify(reIncluded));
    assert.equal(reIncluded.donor, "medspa-luma");
  } finally {
    delete process.env.GHOST_AGENCY_DONOR_EXCLUSIONS;
  }
});

test("landscaping is back — the six missing images that closed it now exist", () => {
  // This test used to assert the opposite. landscaping-evergreen was closed to
  // outreach on 2026-08-08 for referencing images/photo-1..6.svg against an
  // EMPTY images/ directory — six guaranteed 404s per mirror. The donor was
  // rebuilt the same day; a retirement is a condition, not a verdict, so the
  // lock now holds the CONDITION rather than the flag.
  //
  // Landscaping is the largest single supply gap the miner finds (209 of 1,231
  // stored rows), so a stale retirement here is expensive: it is the one
  // vertical where staying shut costs the most volume.
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "donors-clean", "landscaping-evergreen");
  const slots = JSON.parse(fs.readFileSync(path.join(dir, "BOILERPLATE.json"), "utf8")).photo_slots || [];
  assert.ok(slots.length >= 6, "the gallery slots went missing rather than getting filled");
  for (const slot of slots) {
    assert.ok(fs.existsSync(path.join(dir, slot)), `${slot} still has no bytes behind it`);
  }

  const out = resolveBuildableDonor("landscaping");
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.donor, "landscaping-evergreen");
});

test("retiring a donor did not close the verticals the line actually runs on", () => {
  // A retirement that quietly took the working lanes with it would be a far
  // worse outage than the defects it fixed.
  for (const vertical of ["plumbing", "roofing", "hvac", "concrete", "fencing", "landscaping"]) {
    const out = resolveBuildableDonor(vertical);
    assert.equal(out.ok, true, `${vertical} went dark: ${JSON.stringify(out)}`);
  }
  // Tattoo is NOT closed by a retirement — it is owner-barred for fresh line
  // campaigns (lib/donor-exclusions.js, 2026-08-31) and must refuse with the
  // NAMED cause so the decision stays greppable instead of reading as an
  // accidental outage.
  const tattoo = resolveBuildableDonor("tattoo");
  assert.equal(tattoo.ok, false, JSON.stringify(tattoo));
  assert.equal(tattoo.reason, "donor_unavailable_for_vertical");
  assert.deepEqual(tattoo.excludedDonors, ["tattoo-aurelia"]);
});
