"use strict";

// test/donor-phone-optional.test.js — PHONE IS OPTIONAL, AND THE DONORS KNOW IT.
//
// 2026-08-01 owner directive: outreach is email-only, so requiring the
// prospect's phone rejected qualified leads for a fact the campaign never uses.
// PHONE and PHONE_DIGITS became OPTIONAL tokens.
//
// That change ALONE would have been a defect, because every donor in the
// library leans on the phone as its primary conversion action: header call
// button, hero CTA, sticky mobile bar, footer, tel: hrefs and schema.org
// telephone. A blank optional token does not remove a button — it empties one.
// Left alone, a phone-less build ships:
//
//     <a href="tel:">Call </a>            an anchor that dials nothing
//     "telephone": ""                     a lie in structured data
//     "…and ask for  to start"            the defect that shipped to a customer
//
// So this file asserts the OTHER half of the change: with PHONE blank every
// donor removes the WHOLE construct — the button, its wrapper and its label —
// and the lead form is still there to convert. With PHONE present, nothing
// about the call path changes.
//
// The assertions are deliberately about RENDERED BYTES, not about donor source
// conventions: a donor may guard with data-collapse-if-empty, with a
// [[NEED:…]] phrase marker, or with its own runtime predicate. What is not
// negotiable is what a customer receives.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS = path.join(BACKEND, "donors-clean");

// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-phone-"));

const { loadDonorFiles } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS, REQUIRED_TOKENS, OPTIONAL_TOKENS } = require("../lib/mirror-engine/tokens");
const { collapsePhrases } = require("../lib/mirror-engine/prose");
const { validateFacts } = require("../lib/mirror-engine/facts");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

const DONOR_NAMES = fs.readdirSync(DONORS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(DONORS, e.name, "index.html")))
  .map((e) => e.name);

const PHONE = "(520) 555-0142";
const DIGITS = "5205550142";

function tokenValues({ phone }) {
  const v = {};
  for (const t of ALLOWED_TOKENS) v[t] = "";
  Object.assign(v, {
    BUSINESS_NAME: "Harbor Line Contracting",
    CITY: "Tucson",
    ADDRESS_CITY: "Tucson",
    STATE: "AZ",
    REGION: "AZ",
    HERO_HEADLINE: "Concrete and fencing in Tucson, AZ",
    EMAIL: "hello@harborline.example",
    ADDRESS: "18 Mill Road",
    ZIP: "85701",
    POSTAL: "85701",
    DOMAIN: "wss-test-harbor.wss-ai.com",
    PREVIEW_DOMAIN: "wss-test-harbor.wss-ai.com",
    PREVIEW_URL: "https://wss-test-harbor.wss-ai.com/",
    SITE_URL: "https://wss-test-harbor.wss-ai.com/",
    LOGO_URL: "/assets/brand-logo.svg",
  });
  if (phone) { v.PHONE = PHONE; v.PHONE_DIGITS = DIGITS; }
  return v;
}

function hydrateDonor(name, { phone }) {
  const out = hydrate({ donorFiles: loadDonorFiles(path.join(DONORS, name)), tokenValues: tokenValues({ phone }) });
  assert.equal(out.ok, true, `${name}: hydrate failed — ${out.error} ${JSON.stringify(out.detail || "").slice(0, 600)}`);
  return out.files;
}

const isText = (rel) => /\.(html|js|css|json|txt|xml|svg|webmanifest)$/i.test(rel);

/** Visible text of an HTML file: no <script>/<style>, no tags, entities loose. */
function visibleText(html) {
  return String(html)
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ");
}

// ---------------------------------------------------------------------------
// 1. The token contract itself
// ---------------------------------------------------------------------------
test("PHONE and PHONE_DIGITS are OPTIONAL; six tokens remain REQUIRED", () => {
  assert.ok(OPTIONAL_TOKENS.has("PHONE"), "PHONE must be optional — outreach is email-only");
  assert.ok(OPTIONAL_TOKENS.has("PHONE_DIGITS"), "PHONE_DIGITS must be optional");
  assert.ok(!REQUIRED_TOKENS.has("PHONE"));
  assert.ok(!REQUIRED_TOKENS.has("PHONE_DIGITS"));
  assert.deepEqual(
    [...REQUIRED_TOKENS].sort(),
    ["ADDRESS_CITY", "BUSINESS_NAME", "CITY", "HERO_HEADLINE", "REGION", "STATE"],
  );
});

// ---------------------------------------------------------------------------
// 2. The boundary lets a phone-less prospect through — and still refuses a
//    phone it cannot trust. Optional means "may be absent", not "may be wrong".
// ---------------------------------------------------------------------------
test("validateFacts accepts an absent phone and derives no digits", () => {
  const base = { business_name: "Harbor Line Contracting", industry: "concrete", city: "Tucson", state: "AZ" };
  for (const facts of [base, { ...base, phone: "" }, { ...base, phone: "   " }]) {
    const out = validateFacts({ facts });
    assert.equal(out.ok, true, `blank phone must not be a build failure: ${JSON.stringify(out.detail || "")}`);
    assert.equal(out.phoneDigits, "");
    assert.equal(out.facts.phone, "");
  }
});

test("a phone that IS supplied is still held to exactly 10 NANP digits", () => {
  const base = { business_name: "Harbor Line Contracting", industry: "concrete", city: "Tucson", state: "AZ" };
  const bad = validateFacts({ facts: { ...base, phone: "(509) 842-6611 x102" } });
  assert.equal(bad.ok, false);
  assert.match(bad.detail[0].reason, /extension/);

  const short = validateFacts({ facts: { ...base, phone: "520-555" } });
  assert.equal(short.ok, false);

  const good = validateFacts({ facts: { ...base, phone: PHONE } });
  assert.equal(good.ok, true);
  assert.equal(good.phoneDigits, DIGITS);
});

// ---------------------------------------------------------------------------
// 3. The phrase-marker dual that lets a donor swap the call CTA for the form
// ---------------------------------------------------------------------------
test("[[NEED:!TOKEN]] keeps its fragment only when the token is BLANK", () => {
  const src = "[[NEED:PHONE]]call us[[/NEED]][[NEED:!PHONE]]use the form[[/NEED]]";
  assert.equal(collapsePhrases(src, (t) => t === "PHONE"), "use the form");
  assert.equal(collapsePhrases(src, () => false), "call us");
  assert.throws(() => collapsePhrases("[[NEED:!]]x[[/NEED]]", () => true), /malformed/);
});

// ---------------------------------------------------------------------------
// 4. THE MAIN EVENT — every donor, rendered with no phone at all
// ---------------------------------------------------------------------------
for (const name of DONOR_NAMES) {
  test(`${name}: a phone-less build renders no call construct anywhere`, () => {
    const files = hydrateDonor(name, { phone: false });

    for (const [rel, buf] of Object.entries(files)) {
      if (!isText(rel)) continue;
      const s = buf.toString("utf8");

      // (a) no anchor that dials nothing
      for (const m of s.matchAll(/href\s*[:=]\s*(["'`])tel:\1/g)) {
        assert.fail(`${name}/${rel}: empty tel: href — ${s.slice(Math.max(0, m.index - 90), m.index + 40)}`);
      }
      // …and no `tel:` left dangling with no digits after it in any href
      for (const m of s.matchAll(/href\s*[:=]\s*["'`]tel:\+?1?["'`]/g)) {
        assert.fail(`${name}/${rel}: tel: href with no number — ${m[0]}`);
      }

      // (b) no structured-data telephone with an empty value
      for (const re of [/"telephone"\s*:\s*""/g, /\btelephone\s*:\s*""/g, /"telephone"\s*:\s*"\+?1?"/g]) {
        const m = re.exec(s);
        assert.equal(m, null, `${name}/${rel}: empty schema.org telephone — ${m && m[0]}`);
      }

      // (c) the number must not survive as a bare "+1"
      assert.equal(/["'`]\+1["'`]/.test(s), false, `${name}/${rel}: a bare "+1" is a phone that lost its digits`);
    }

    // (d) no dangling call prose in anything a human reads
    for (const [rel, buf] of Object.entries(files)) {
      if (!/\.html$/i.test(rel)) continue;
      const text = visibleText(buf.toString("utf8"));
      for (const line of text.split(/\n+/)) {
        const t = line.replace(/\s+/g, " ").trim();
        if (!t) continue;
        for (const re of [
          /\bcall\b\s*[.,;:·•|]/i,          // "Call ." / "Call ·"
          /\bcall\b\s+(?:on|us on)\s*[.,]/i, // "Call on ,"
          /\bDirect line\b\s*[·•|]\s*$/i,    // "Direct line ·"
          /\bphone\b\s*[·•|]\s*$/i,
          /\bcall\b\s*$/i,                   // a line that ends on the verb
        ]) {
          assert.equal(re.test(t), false, `${name}/${rel}: dangling call prose — ${JSON.stringify(t.slice(0, 160))}`);
        }
      }
    }
  });

  test(`${name}: with no phone, a lead-form CTA is still on the page`, () => {
    const files = hydrateDonor(name, { phone: false });
    const all = Object.entries(files)
      .filter(([rel]) => isText(rel))
      .map(([, buf]) => buf.toString("utf8"))
      .join("\n");
    // The donors' own conversion routes: a real /contact page, or the on-page
    // quote/contact/estimate section. One of them must survive, or the mirror
    // cannot convert for the customer at all. "estimate" is here because
    // hvac-brandforge names its funnel #estimate — the same construct (a lead
    // form the CTAs point at), a different word for it.
    const hasLeadForm = /["'`]\/contact["'`]/.test(all) || /["'`]\/?#(?:contact|quote|estimate)["'`]/.test(all);
    assert.equal(hasLeadForm, true, `${name}: no lead-form CTA left once the call CTAs collapsed`);
  });

  test(`${name}: with a phone, the call CTA is intact and unchanged`, () => {
    const files = hydrateDonor(name, { phone: true });
    const all = Object.entries(files)
      .filter(([rel]) => isText(rel))
      .map(([, buf]) => buf.toString("utf8"))
      .join("\n");

    // A prerendered donor ships the href in its bytes; a compiled SPA builds it
    // at runtime from the hydrated config, so the dialable form to look for is
    // the tel: literal OR the +1-prefixed config value the anchor is made from.
    assert.ok(
      all.includes(`tel:${DIGITS}`) || all.includes(`tel:+1${DIGITS}`) || all.includes(`+1${DIGITS}`) || all.includes(DIGITS),
      `${name}: a verified phone must still produce a dialable number`,
    );
    assert.ok(all.includes(PHONE), `${name}: the display-form number must still appear`);
  });
}

// ---------------------------------------------------------------------------
// 5. End to end: mirror() itself accepts a prospect with no phone
// ---------------------------------------------------------------------------
test("mirror() builds a phone-less prospect end to end (dry run)", async () => {
  const request = {
    slug: "wss-test-harbor-line-nophone",
    facts: {
      business_name: "Harbor Line Contracting",
      industry: "concrete",
      city: "Tucson",
      state: "AZ",
      email: "hello@harborline.example",
    },
  };
  const res = await mirror(request, { dryRun: true, registry: createRegistry() });
  assert.equal(res.status, 200, `phone-less build was rejected: ${JSON.stringify(res.body).slice(0, 500)}`);

  const withPhone = await mirror(
    { ...request, slug: "wss-test-harbor-line-withphone", facts: { ...request.facts, phone: PHONE } },
    { dryRun: true, registry: createRegistry() },
  );
  assert.equal(withPhone.status, 200, `phone-bearing build was rejected: ${JSON.stringify(withPhone.body).slice(0, 500)}`);
});
