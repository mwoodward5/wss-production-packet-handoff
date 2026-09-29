"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hasFrozenVisualIdentity,
  visualIdentityPatch,
  applyVisualIdentity,
  freezeVisualIdentity,
} = require("../lib/line-identity-freeze");

const baseRequest = () => ({
  slug: "wss-test-acme-hvac-austin",
  donor: "hvac-clean",
  facts: {
    business_name: "Acme HVAC",
    industry: "hvac",
    city: "Austin",
    state: "TX",
    current_website: "https://acme.example/",
  },
  brand: { logo: "https://acme.example/logo.png", accent: "#ffcc00" },
});

const brief = {
  version: "design-brief-v1",
  capturedAt: "2026-08-19T06:00:00.000Z",
  finalUrl: "https://acme.example/",
  mode: "light",
  surface: "#f7f5ef",
  accent: "#d79b00",
  fontDisplay: "Anton",
  fontBody: "Inter",
  fontHref: "https://fonts.googleapis.com/css2?family=Anton:wght@400;600;700;800&family=Inter:wght@400;600;700;800&display=swap",
  measurements: { visibleTextChars: 1600 },
};

test("measured client typography and surface become frozen MirrorRequest identity", () => {
  const patch = visualIdentityPatch(brief);
  const request = applyVisualIdentity(baseRequest(), patch);
  assert.equal(request.brand.fonts.display, "Anton");
  assert.equal(request.brand.fonts.body, "Inter");
  assert.equal(request.brand.site_accent, "#d79b00");
  assert.equal(request.client_surface.mode, "light");
  assert.equal(request.client_surface.surface, "#f7f5ef");
  assert.equal(hasFrozenVisualIdentity(request), true);
});

test("unservable or under-observed typography/surface remains absent rather than guessed", () => {
  const patch = visualIdentityPatch({
    ...brief,
    fontHref: "",
    measurements: { visibleTextChars: 40 },
  });
  const request = applyVisualIdentity(baseRequest(), patch);
  assert.equal(request.brand.fonts, undefined);
  assert.equal(request.client_surface, undefined);
});

test("identity is measured once and CAS-frozen into the durable build request", async () => {
  let calls = 0;
  let persisted = null;
  const request = baseRequest();
  const prospect = {
    prospect_id: "acme",
    updated_at: "2026-08-19T05:00:00.000Z",
    record: { build_ready: { mirror_request: request } },
  };
  const out = await freezeVisualIdentity(prospect, request, {
    buildDesignBrief: async () => { calls += 1; return { ok: true, brief }; },
    conditionalUpdate: async (_table, _key, _id, _where, patch) => {
      persisted = patch;
      return { ok: true, updated: true };
    },
  });
  assert.equal(calls, 1);
  assert.equal(out.persisted, true);
  assert.equal(out.request.brand.fonts.display, "Anton");
  assert.equal(persisted.record.build_ready.mirror_request.client_surface.mode, "light");
  assert.equal(persisted.record.design_brief.fontDisplay, "Anton");

  const second = await freezeVisualIdentity(prospect, out.request, {
    buildDesignBrief: async () => { throw new Error("must not remeasure"); },
  });
  assert.equal(second.reason, "already_frozen");
});
