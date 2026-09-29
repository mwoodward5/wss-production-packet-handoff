"use strict";

const assert = require("node:assert/strict");
const { answerCrewProfileFromCanonical, prospectRequest } = require("../lib/intake-genie-client");

const request = prospectRequest({
  prospect_id: "acme",
  business_name: "Acme Plumbing",
  description: "Please answer after-hours calls and notify the owner.",
}, { buildPreview: false });
assert.match(request.description, /after-hours calls/);
assert.equal(request.build_preview, false);

const profile = answerCrewProfileFromCanonical({
  facts: {
    name: "Acme Plumbing",
    city: "Fresno",
    state: "ca",
    category: "plumbing",
    services: ["Drain cleaning", "Water heaters"],
    booking_url: "https://calendly.com/acme/book",
  },
  assets: [
    { kind: "hours", label: "Mon-Fri 8am-5pm" },
    { kind: "logo", url: "https://example.com/logo.png" },
  ],
  evidence: [{ field: "name" }],
});
assert.equal(profile.state, "CA");
assert.equal(profile.hours, "Mon-Fri 8am-5pm");
assert.equal(profile.booking_url, "https://calendly.com/acme/book");
assert.equal(profile.logo_url, "https://example.com/logo.png");

console.log("AnswerCrew import self-test: passed");
