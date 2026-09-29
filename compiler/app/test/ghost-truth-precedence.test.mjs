import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveGhostInputHint,
  resolveGhostTruthFact,
} from "../lib/ghost-truth-precedence.mjs";

const freshIdentity = {
  name: "New Business",
  city: "New City",
  state: "NV",
  category: "New Category",
  phone: "702-555-0100",
  email: "new@example.com",
  address: "200 New Street",
  latlng: { lat: 36.1716, lng: -115.1391 },
  services: ["New Service"],
  website: "https://new.example",
  gbp_url: "https://maps.google.com/?cid=new",
  asset_url: "https://drive.google.com/new",
};

const staleProspect = {
  name: "Old Business",
  city: "Old City",
  state: "CA",
  category: "Old Category",
  phone: "310-555-0100",
  email: "old@example.com",
  address: "100 Old Street",
  latlng: { lat: 34.0522, lng: -118.2437 },
  services: ["Old Service"],
  website: "https://old.example",
  gbp_url: "https://maps.google.com/?cid=old",
  asset_url: "https://drive.google.com/old",
};

function identityTruth(values, extra = {}) {
  return {
    identity: Object.fromEntries(
      Object.entries(values).map(([field, value]) => [field, { value, ...extra }]),
    ),
  };
}

test("owner-locked identity values beat stale prospect hints and compiled facts", () => {
  const truth = identityTruth(freshIdentity, { owner_locked: true });

  for (const field of Object.keys(freshIdentity)) {
    assert.deepEqual(
      resolveGhostInputHint({
        field,
        prospectValue: staleProspect[field],
        priorCompiledValue: staleProspect[field],
        truth,
      }),
      freshIdentity[field],
      `${field} owner lock must beat the stale top-level prospect hint`,
    );
    assert.deepEqual(
      resolveGhostTruthFact({
        field,
        compiledValue: staleProspect[field],
        truth,
      }),
      freshIdentity[field],
      `${field} owner lock must beat stale compiled discovery`,
    );
  }
});

test("fresh compiled facts win when identity fields are not owner locked", () => {
  const truth = identityTruth(staleProspect, { verified: true });

  for (const field of Object.keys(freshIdentity)) {
    assert.deepEqual(
      resolveGhostTruthFact({
        field,
        compiledValue: freshIdentity[field],
        truth,
      }),
      freshIdentity[field],
      `${field} should use the fresh compiler fact`,
    );
  }
});

test("Ghost identity fallback is verified or empty", () => {
  assert.equal(
    resolveGhostTruthFact({
      field: "phone",
      compiledValue: "",
      truth: identityTruth({ phone: "702-555-0100" }),
    }),
    "",
  );
  assert.equal(
    resolveGhostTruthFact({
      field: "phone",
      compiledValue: "",
      truth: identityTruth({ phone: "702-555-0100" }, { source: "business-site" }),
    }),
    "702-555-0100",
  );
});

test("unverified identity cannot replace a prior compiled discovery hint", () => {
  assert.equal(
    resolveGhostInputHint({
      field: "name",
      prospectValue: "",
      priorCompiledValue: "Acme Lawn Services",
      truth: identityTruth({ name: "Tekline Roofing" }),
    }),
    "Acme Lawn Services",
  );
  assert.equal(
    resolveGhostInputHint({
      field: "website",
      prospectValue: "",
      priorCompiledValue: "https://acmelawn.example",
      truth: identityTruth({ website: "https://tekline.example" }),
    }),
    "https://acmelawn.example",
  );
});
