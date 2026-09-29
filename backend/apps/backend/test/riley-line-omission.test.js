"use strict";

// REGRESSION LOCK (2026-07-31) — DEFECT 3 of the Flint Plumbing proof email.
//
// The email rendered "(949) 339-5562" under a Riley CTA. Nobody chose to publish
// that number: lib/email.js carried
//
//     const DEFAULT_AGENT_PHONE = "+19493395562";
//     ... process.env.GHOST_AGENCY_AGENT_PHONE || DEFAULT_AGENT_PHONE
//
// so the constant took over the instant the environment variable was unset. A
// phone number pinned in source outlives the line it names, and then it gets
// mailed to strangers.
//
// What this file locks:
//   1. no literal phone number remains in the rendering path;
//   2. with nothing configured the CTA and the phone line are OMITTED — not
//      blank, not "tel:", not "call me at ." — and the surrounding prose still
//      reads as a sentence;
//   3. Riley's number is resolved PER CLIENT, and the client's own NAP phone is
//      explicitly not a candidate for it.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  AGENT_PHONE_ENV_NAMES,
  CLIENT_RILEY_PHONE_FIELDS,
  NON_RILEY_PHONE_FIELDS,
  agencyAgentPhone,
  normalizePhone,
  resolveRileyLine,
} = require("../lib/riley-line");
const { buildActivationEmail } = require("../lib/email");
const { localCompose } = require("../lib/supervised-held-drafts");
const { render } = require("../lib/email-templates");
const proofEmail = require("../scripts/send-flint-proof-email.cjs");

const backendRoot = path.join(__dirname, "..");
const PHONE_ENV_VARS = [
  "GHOST_AGENT_PHONE",
  "GHOST_AGENCY_AGENT_PHONE",
  "GHOST_AGENCY_SENDER_PHONE",
];

/** Run `fn` with an exact phone-env state, then restore whatever was there. */
function withPhoneEnv(values, fn) {
  const prior = new Map(PHONE_ENV_VARS.map((k) => [k, process.env[k]]));
  try {
    for (const key of PHONE_ENV_VARS) delete process.env[key];
    for (const [key, value] of Object.entries(values || {})) process.env[key] = value;
    return fn();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// 1. the fallback is gone
// ---------------------------------------------------------------------------

test("no phone-number literal survives in the rendering path", () => {
  // A NANP literal in any of these files is the exact defect. The forge.js
  // ignore-list is excluded on purpose: it is a suppression set for QC, never
  // rendered — and it is asserted separately below.
  const files = [
    "lib/email.js",
    "lib/riley-line.js",
    "lib/supervised-held-drafts.js",
    "lib/email-templates.js",
    "lib/outreach-email-v2.js",
    "scripts/send-flint-proof-email.cjs",
    "boilerplates/roofing-tekline/floater.js",
  ];
  const LITERAL = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}|\+1\d{10}/;
  for (const rel of files) {
    const full = path.join(backendRoot, rel);
    if (!fs.existsSync(full)) continue;
    const hit = LITERAL.exec(fs.readFileSync(full, "utf8"));
    assert.equal(hit, null, `${rel} carries a literal phone number (${hit && hit[0]}) — it will outlive the line`);
  }
});

test("DEFAULT_AGENT_PHONE no longer exists and the env names are the two real ones", () => {
  const src = fs.readFileSync(path.join(backendRoot, "lib", "email.js"), "utf8");
  // (the name may survive in the comment that explains why it is gone)
  assert.doesNotMatch(src, /const\s+DEFAULT_AGENT_PHONE/);
  assert.doesNotMatch(src, /\|\|\s*DEFAULT_AGENT_PHONE/);
  // GHOST_AGENT_PHONE is the owner's name for it; GHOST_AGENCY_AGENT_PHONE is
  // the name the rest of the codebase already reads. No third name.
  assert.deepEqual([...AGENT_PHONE_ENV_NAMES], ["GHOST_AGENT_PHONE", "GHOST_AGENCY_AGENT_PHONE"]);
});

test("agencyAgentPhone resolves from configuration only", () => {
  withPhoneEnv({}, () => {
    assert.equal(agencyAgentPhone(), "", "unset must resolve to nothing, never to a constant");
  });
  withPhoneEnv({ GHOST_AGENT_PHONE: "(512) 555-0184" }, () => {
    assert.equal(agencyAgentPhone(), "(512) 555-0184");
  });
  withPhoneEnv({ GHOST_AGENCY_AGENT_PHONE: "+15125550184" }, () => {
    assert.equal(agencyAgentPhone(), "+15125550184", "the pre-existing env name must keep working");
  });
  withPhoneEnv({ GHOST_AGENT_PHONE: "(512) 555-0184", GHOST_AGENCY_AGENT_PHONE: "+15125550199" }, () => {
    assert.equal(agencyAgentPhone(), "(512) 555-0184", "GHOST_AGENT_PHONE takes precedence");
  });
  withPhoneEnv({ GHOST_AGENT_PHONE: "call the office" }, () => {
    assert.equal(agencyAgentPhone(), "", "an undialable value must omit, not render");
  });
});

test("normalizePhone refuses anything that cannot be dialled", () => {
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone("{{PHONE}}"), null, "an unsubstituted token is not a number");
  assert.equal(normalizePhone("555-0184"), null);
  assert.deepEqual(normalizePhone("(512) 555-0184").display, "(512) 555-0184");
  assert.equal(normalizePhone("512.555.0184").e164, "+15125550184");
  assert.equal(normalizePhone("+15125550184").telHref, "tel:+15125550184");
});

// ---------------------------------------------------------------------------
// 2. fail closed — omission, not a blank
// ---------------------------------------------------------------------------

test("activation email omits the phone entirely when none is configured", () => {
  withPhoneEnv({}, () => {
    const out = buildActivationEmail({
      businessName: "Acme Roofing",
      ownerEmail: "owner@example.com",
      pin: "123456",
      jobId: "job_omission",
    });

    assert.doesNotMatch(out.html, /tel:/, "no empty tel: href may be rendered");
    assert.doesNotMatch(out.html, /\d{3}[-.\s]\d{4}/, "no phone-shaped text may be rendered");
    assert.doesNotMatch(out.text, /\d{3}[-.\s]\d{4}/);
    // and the prose must still be a sentence, not "Riley at  and watch".
    assert.match(out.html, /Call, text or email Riley and watch your site update\./);
    assert.match(out.text, /Call, text, or email Riley and watch your site update\./);
    assert.doesNotMatch(out.html, / at\s*(?:<[^>]*>\s*)*and /);
    assert.doesNotMatch(out.text, / at\s+and /);
  });
});

test("activation email renders a configured number, under either env name", () => {
  for (const name of AGENT_PHONE_ENV_NAMES) {
    withPhoneEnv({ [name]: "+15125550184" }, () => {
      const out = buildActivationEmail({ businessName: "Acme Roofing", pin: "123456" });
      assert.match(out.html, /href="tel:\+15125550184"/, `${name} must reach the CTA`);
      assert.match(out.html, /\(512\) 555-0184/);
      assert.match(out.text, /Riley at \(512\) 555-0184/);
    });
  }
});

test("supervised draft drops its call line rather than printing a stale number", () => {
  withPhoneEnv({}, () => {
    const draft = localCompose({ dryRun: true, prospect: { business_name: "Cedar Plumbing", city: "Irvine" } });
    assert.doesNotMatch(draft.body, /Call me/, "no number => no offer to call");
    assert.doesNotMatch(draft.body, /\d{3}[-.\s]\d{4}/);
    assert.match(draft.body, /— Mark Woodward, Mission Viejo, CA/, "the rest of the draft is untouched");
  });
  withPhoneEnv({ GHOST_AGENCY_SENDER_PHONE: "(512) 555-0184" }, () => {
    const draft = localCompose({ dryRun: true, prospect: { business_name: "Cedar Plumbing", city: "Irvine" } });
    assert.match(draft.body, /Call me: \(512\) 555-0184\./);
  });
});

test("the sequence template drops its call line instead of failing the send", () => {
  const base = {
    business_name: "Cedar Plumbing",
    city: "Irvine",
    industry: "plumbing",
    sender_name: "Mark Woodward",
  };

  const without = render(1, 1, base);
  assert.deepEqual(without.missing, [], "an absent phone must not block the whole campaign");
  assert.doesNotMatch(without.body, /Prefer to talk it through/);
  assert.doesNotMatch(without.body, /__MISSING_/);
  assert.doesNotMatch(without.body, /\[\[IF:|\[\[\/IF\]\]/, "the marker itself must never reach a reader");
  assert.doesNotMatch(without.body, /\n\n\n/, "and it must not leave a hole where the line was");
  assert.match(without.body, /— Mark Woodward, Mission Viejo, CA$/);

  const with_ = render(1, 1, { ...base, sender_phone: "(512) 555-0184" });
  assert.match(with_.body, /Prefer to talk it through\? Call me: \(512\) 555-0184\./);
  assert.doesNotMatch(with_.body, /\[\[IF:|\[\[\/IF\]\]/);
});

// ---------------------------------------------------------------------------
// 3. per-client resolution
// ---------------------------------------------------------------------------

test("Riley's number comes from the client, and the client's own NAP line is refused", () => {
  const facts = { phone: "(512) 971-2445", business_name: "Flint Plumbing LLC" };
  const provenance = { phone: { value: "(512) 971-2445", class: "nap" } };

  // The client's front desk is a verified number — and still not Riley's.
  const napOnly = resolveRileyLine({ client: { phone: "(512) 971-2445" }, facts, provenance });
  assert.equal(napOnly.phone, null);
  assert.equal(napOnly.reason, "no_client_riley_line");
  for (const field of NON_RILEY_PHONE_FIELDS) {
    assert.equal(
      resolveRileyLine({ client: { [field]: "(512) 971-2445" } }).phone,
      null,
      `${field} holds the client's own line — it must never be published as Riley's`,
    );
  }

  // A line provisioned FOR the client is used, and named in `source`.
  for (const field of CLIENT_RILEY_PHONE_FIELDS) {
    const hit = resolveRileyLine({ client: { [field]: "(512) 555-0184" } });
    assert.equal(hit.phone, "+15125550184");
    assert.equal(hit.display, "(512) 555-0184");
    assert.equal(hit.source, `client:${field}`);
  }
});

test("a per-client line beats the agency line; an unverified fact loses to omission", () => {
  withPhoneEnv({ GHOST_AGENT_PHONE: "+15125550199" }, () => {
    const perClient = resolveRileyLine({ client: { riley_phone: "(512) 555-0184" }, allowAgencyLine: true });
    assert.equal(perClient.phone, "+15125550184");
    assert.equal(perClient.source, "client:riley_phone");

    // Agency line only when a caller explicitly speaks for the agency.
    assert.equal(resolveRileyLine({ client: {} }).phone, null);
    assert.equal(resolveRileyLine({ client: {}, allowAgencyLine: true }).source, "env:GHOST_AGENT_PHONE");
  });
  withPhoneEnv({}, () => {
    assert.equal(resolveRileyLine({ client: {}, allowAgencyLine: true }).phone, null);
  });

  // A verified-facts field with no provenance entry is not verified.
  const unverified = resolveRileyLine({
    facts: { riley_phone: "(512) 555-0184" },
    provenance: { phone: { class: "nap" } },
  });
  assert.equal(unverified.phone, null);
  assert.match(unverified.reason, /no_provenance/);
});

// ---------------------------------------------------------------------------
// 4. the proof email itself
// ---------------------------------------------------------------------------

test("the proof email omits the whole CTA when the client has no Riley line", () => {
  const html = proofEmail.buildHtml({ speedLine: "Loads in 0.3s", ratingLine: "" });
  const text = proofEmail.buildText({ speedLine: "Loads in 0.3s", ratingLine: "" });

  assert.doesNotMatch(html, /tel:/);
  assert.doesNotMatch(html, /\d{3}[-.\s]\d{4}/);
  assert.doesNotMatch(html, /Riley now/, "no CTA button at all — not an empty one");
  assert.doesNotMatch(html, /Just give her your business name/, "its follow-on instruction goes with it");
  assert.doesNotMatch(text, /Riley now/);
  assert.doesNotMatch(text, /\d{3}[-.\s]\d{4}/);

  // Everything the audit KEEPS is still there.
  assert.match(html, /\[INTERNAL TEST — Riley edit execution UNPROVEN\. Not for prospect send\.\]/);
  assert.match(text, /\[INTERNAL TEST — Riley edit execution UNPROVEN\. Not for prospect send\.\]/);
  for (const [, benefit] of proofEmail.RILEY_BENEFITS) {
    assert.ok(text.includes(benefit), `benefit card dropped: ${benefit}`);
  }
});

test("the proof email renders exactly the client's line when there is one", () => {
  const rileyLine = { phone: "+15125550184", display: "(512) 555-0184", telHref: "tel:+15125550184" };
  const html = proofEmail.buildHtml({ rileyLine, speedLine: "", ratingLine: "" });
  const text = proofEmail.buildText({ rileyLine, speedLine: "", ratingLine: "" });

  assert.match(html, /href="tel:\+15125550184"/);
  // 2026-09-02: "Text or call" narrowed to "Call" (voice-only VAPI line) and
  // Riley's pronouns corrected to he/him.
  assert.match(html, /Call Riley now: \(512\) 555-0184/);
  assert.match(html, /Just give him your business name/);
  assert.match(text, /Call Riley now: \(512\) 555-0184/);
  assert.doesNotMatch(html, /949/, "the retired agency line may never reappear");
});

test("Riley is framed as the owner's developer, not a customer chatbot", () => {
  const html = proofEmail.buildHtml({ speedLine: "", ratingLine: "" });
  const text = proofEmail.buildText({ speedLine: "", ratingLine: "" });

  // grid item 15 — was "Riley (AI assistant)"; 2026-09-02 "text or call" narrowed
  // to "call" (Riley's line is voice-only, no SMS provisioning)
  assert.doesNotMatch(html, /Riley \(AI assistant\)/);
  assert.match(html, /Riley — your private web developer: call to change your site/);
  assert.match(text, /Riley — your private web developer: call to change your site/);
  assert.doesNotMatch(html, /text or call/);
  assert.doesNotMatch(text, /text or call/);

  // grid item 3 — was "Voice & AI answers", which read as a bot answering customers
  assert.doesNotMatch(html, /Voice &(?:amp;)? AI answers/);
  assert.match(html, /Written for voice search &amp; AI results/);
  assert.match(text, /Written for voice search & AI results/);

  // education block
  assert.match(html, /Meet Riley — your private web developer\./);
  assert.match(html, /Not a chatbot for your customers\./);
});

test("the tekline floater ships no number and hides its CTA without one", () => {
  const src = fs.readFileSync(
    path.join(backendRoot, "boilerplates", "roofing-tekline", "floater.js"),
    "utf8",
  );
  assert.doesNotMatch(src, /tel:\+?1?\d{10}/, "a pinned tel: link outlives the line");
  assert.match(src, /RILEY_TEL\s*\?/, "the Riley button must be conditional on a resolved line");
  // and it must not smuggle in a {{TOKEN}} — an unmapped token hard-fails the
  // hydrator and a mapped one would need the whole token contract widened.
  assert.doesNotMatch(src, /\{\{RILEY[A-Z_]*\}\}/);
});
