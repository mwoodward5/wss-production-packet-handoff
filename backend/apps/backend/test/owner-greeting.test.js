"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  firstNameOf,
  verifiedOwnerFirstName,
  emailGreetingName,
  dashboardWelcomeName,
} = require("../lib/owner-greeting");

test("firstNameOf takes the first token, ignores single-char noise", () => {
  assert.equal(firstNameOf("John Smith"), "John");
  assert.equal(firstNameOf("  Maria  De La Cruz "), "Maria");
  assert.equal(firstNameOf("J Smith"), "");
  assert.equal(firstNameOf(""), "");
  assert.equal(firstNameOf(null), "");
});

test("verified owner name is used ONLY when owner_name_verified is true", () => {
  assert.equal(
    verifiedOwnerFirstName({ owner_name: "John Smith", owner_name_verified: true }),
    "John",
  );
  assert.equal(verifiedOwnerFirstName({ owner_name: "John Smith", owner_name_verified: "true" }), "John");
  // unverified / missing flag => never used
  assert.equal(verifiedOwnerFirstName({ owner_name: "John Smith" }), "");
  assert.equal(verifiedOwnerFirstName({ owner_name: "John Smith", owner_name_verified: false }), "");
  assert.equal(verifiedOwnerFirstName({ owner_name: "Carl", owner_name_verified: "1" }), "");
});

test("email greeting: verified -> first name, else '<business> team', else 'there'", () => {
  assert.equal(
    emailGreetingName({ owner_name: "John Smith", owner_name_verified: true }, "Family Heating & Cooling"),
    "John",
  );
  // dormant / unverified -> business name WITH "team" (NOT the unverified name,
  // NOT 'there'): "Hi Family Heating & Cooling team," is the natural greeting
  // when no owner is verified — the copy every outreach greeting used before the
  // owner-name feature.
  assert.equal(
    emailGreetingName({ owner_name: "John Smith" }, "Family Heating & Cooling"),
    "Family Heating & Cooling team",
  );
  assert.equal(emailGreetingName({}, "Acme Plumbing"), "Acme Plumbing team");
  assert.equal(emailGreetingName({}, ""), "there");
});

test("email greeting canonical path: array of candidate sources", () => {
  const sources = [
    { category: "hvac" },
    { owner_name: "Jane Doe", owner_name_verified: true },
    { business_name: "Doe HVAC" },
  ];
  assert.equal(emailGreetingName(sources, "Doe HVAC"), "Jane");
  // none verified in the array -> business name WITH "team"
  assert.equal(emailGreetingName([{ owner_name: "Jane Doe" }, { city: "Tulsa" }], "Doe HVAC"), "Doe HVAC team");
});

test("dashboard welcome: verified -> first name, else business name, else ''", () => {
  assert.equal(
    dashboardWelcomeName({ owner_name: "John Smith", owner_name_verified: true }, "Family Heating"),
    "John",
  );
  assert.equal(dashboardWelcomeName({ owner_name: "John Smith" }, "Family Heating"), "Family Heating");
  assert.equal(dashboardWelcomeName({}, ""), "");
});
