"use strict";

// test/placeholder-email.test.js — A PLACEHOLDER IS NOT A MAILBOX.
//
// THE INCIDENT. Two live prospect rows carried "your@email.com" and
// "name@email.com" — the input-placeholder text of a contact form, scraped
// verbatim out of the page source. Both would hard-bounce, and neither was
// caught: the Places capture path (extractEmail) filtered crawler/platform
// domains but not these, and the send-time normalizer does not reject
// "@email.com".
//
// THE RULE. A lead whose only email is a placeholder is UNCONTACTABLE and must
// be treated exactly like a lead with no email at all: never captured, never
// scored contactable, never qualified for a send. isPlaceholderEmail is the one
// predicate asked at each of those gates, so this pins the list it enforces.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MIRROR_DONOR_ROOT = require("node:path").join(__dirname, "..", "boilerplates");
const { isPlaceholderEmail, extractEmail } = require("../lib/lead-miner");

// Every one of these is a scrape artifact, a reserved domain, or a form-field
// stand-in — never a real business recipient.
const PLACEHOLDERS = [
  // The two that actually shipped.
  "your@email.com",
  "name@email.com",
  // Local-part placeholders, on any domain.
  "your@acmehvac.com",
  "test@acmehvac.com",
  "example@acmehvac.com",
  "sample@acmehvac.com",
  "placeholder@acmehvac.com",
  "youremail@gmail.com",
  "your.email@gmail.com",
  "your-name@gmail.com",
  "firstname@gmail.com",
  "lastname@gmail.com",
  // noreply family.
  "noreply@acmehvac.com",
  "no-reply@acmehvac.com",
  "donotreply@acmehvac.com",
  "do-not-reply@acmehvac.com",
  // Placeholder / reserved DOMAINS, on any local part.
  "info@email.com",
  "contact@yourdomain.com",
  "hello@yoursite.com",
  "office@mysite.com",
  "team@website.com",
  "owner@example.com",
  "owner@example.org",
  "owner@sub.example.com",
  "owner@anything.test",
  "owner@anything.invalid",
  "root@localhost",
];

// Real, contactable business addresses. NONE of these may be flagged.
const REAL = [
  "info@acmehvac.com",
  "john@smithplumbing.com",
  "office@wilbournmccabe.com",
  "mark@woodwardlabs.io",
  "contact@riverside-roofing.net",
  "hello@indoorcomfortteam.com",
  "owner@acme.com",
  "service@stlouis-hvac.com", // "email"/"example"/etc. appear NOWHERE — a real STL domain
  "dispatch@name-brand-plumbing.com", // "name" only as a substring, not the whole local part
];

test("every placeholder is flagged", () => {
  for (const email of PLACEHOLDERS) {
    assert.equal(isPlaceholderEmail(email), true, `should flag placeholder: ${email}`);
  }
});

test("no real business address is flagged", () => {
  for (const email of REAL) {
    assert.equal(isPlaceholderEmail(email), false, `should NOT flag real address: ${email}`);
  }
});

test("non-address input is not flagged (leaves the shape decision to the caller)", () => {
  for (const value of ["", "   ", "not-an-email", "@nolocal.com", "trailing@", null, undefined]) {
    assert.equal(isPlaceholderEmail(value), false, `unexpected flag for: ${JSON.stringify(value)}`);
  }
});

test("extractEmail drops a placeholder to null and keeps a real address", () => {
  // A page that publishes only a placeholder yields NO email — same as no email.
  assert.equal(extractEmail('<a href="mailto:your@email.com">Email us</a>'), null);
  assert.equal(extractEmail('<a href="mailto:name@email.com">Email us</a>'), null);
  // A real address still comes through untouched.
  assert.equal(extractEmail('<a href="mailto:Info@AcmeHVAC.com">Email</a>'), "info@acmehvac.com");
  // The original smoke case is unchanged: junk image src ignored, real mail kept.
  assert.equal(
    extractEmail('<a href="mailto:Owner@Acme.com">Email</a><img src="x@test.png">'),
    "owner@acme.com",
  );
  // A page with a real address AND a placeholder keeps the real one.
  assert.equal(
    extractEmail('<a href="mailto:your@email.com">x</a><a href="mailto:info@acmehvac.com">y</a>'),
    "info@acmehvac.com",
  );
});
