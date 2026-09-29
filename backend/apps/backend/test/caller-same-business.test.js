"use strict";

// test/caller-same-business.test.js
//
// Riley could not resolve a caller by phone or by name — only by Client ID —
// because the harvester had written RiverCity Plumbing twice (two place_ids,
// one phone) and the resolver treats two matches as colliding clients.
//
// The refusal to guess is CORRECT and must survive: "United Roofing" really is
// four different companies. What must not survive is treating one business's
// duplicate rows as a collision.

const test = require("node:test");
const assert = require("node:assert");
const { __testables } = require("../lib/site-edit-targets");

const collapse = __testables && __testables.collapseSameBusiness;

test("duplicate rows for ONE business collapse to one, preferring the built preview", { skip: !collapse }, () => {
  const rows = [
    { prospect_id: "place_48ff", business_name: "RiverCity Plumbing", phone: "+19047607837", updated_at: "2026-08-05T07:26:49Z" },
    { prospect_id: "place_47b4", business_name: "RiverCity Plumbing", phone: "(904) 760-7837", preview_url: "https://wss-test-rivercity.wss-ai.com/", updated_at: "2026-08-06T00:53:04Z" },
  ];
  const out = collapse(rows);
  assert.equal(out.length, 1, "same name + same phone is ONE client, not a collision");
  assert.equal(out[0].prospect_id, "place_47b4", "the row with a built preview wins");
});

test("different businesses that share a name still collide", { skip: !collapse }, () => {
  const rows = [
    { prospect_id: "a", business_name: "United Roofing", phone: "+15125550101" },
    { prospect_id: "b", business_name: "United Roofing", phone: "+16145550199" },
  ];
  assert.equal(collapse(rows).length, 2, "a shared name with different phones must stay ambiguous");
});

test("rows with no phone are never merged on name alone", { skip: !collapse }, () => {
  const rows = [
    { prospect_id: "a", business_name: "Acme Plumbing" },
    { prospect_id: "b", business_name: "Acme Plumbing" },
  ];
  assert.equal(collapse(rows).length, 2, "without a phone we cannot PROVE they are the same business");
});

test("the most recent row wins when neither has a preview", { skip: !collapse }, () => {
  const rows = [
    { prospect_id: "old", business_name: "Acme Plumbing", phone: "+15125550101", updated_at: "2026-01-01T00:00:00Z" },
    { prospect_id: "new", business_name: "Acme Plumbing", phone: "+15125550101", updated_at: "2026-08-01T00:00:00Z" },
  ];
  assert.equal(collapse(rows)[0].prospect_id, "new");
});
