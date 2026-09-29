"use strict";
// The GHOST_AGENCY_EMAIL_V2 dark-launch gate: flag off is byte-identical legacy,
// flag on renders v2 from the record, and any v2 failure (broken record, missing
// signed unsubscribe URL) falls back to legacy instead of blocking the send.

const test = require("node:test");
const assert = require("node:assert/strict");

const { composeProspectEmail } = require("../lib/email/compose-v2-switch.cjs");

const SIGNED_UNSUB = "https://ghost.wss-ai.com/api/unsubscribe?t=signed-token-abc";

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function validRecord() {
  return {
    client_id: "client-test-123",
    business_name: "Harbor Plumbing",
    industry: "plumbing",
    city: "Costa Mesa",
    preview_url: "https://example.com/preview",
    identity: {
      name: "Harbor Plumbing",
      phone: "949-555-0100",
    },
    build_ready: {
      brand_evidence: {
        accent: "#1a73e8",
        logo_url: "https://example.com/logo.png",
      },
      mirror_request: {
        content: {
          reviews: [
            {
              author: "Jordan",
              text: "Service was completed as scheduled.",
              rating: 5,
            },
          ],
        },
      },
    },
    proof_shots: {
      old_captured_url: "https://example.com/old.png",
      new_captured_url: "https://example.com/new.png",
    },
  };
}

test("flag off calls legacy renderer untouched", () => {
  withEnv("GHOST_AGENCY_EMAIL_V2", "false", () => {
    let legacyCalls = 0;
    const record = validRecord();

    const result = composeProspectEmail(record, {
      unsubscribeUrl: SIGNED_UNSUB,
      legacyRender(input) {
        legacyCalls += 1;
        assert.equal(input, record);
        return { html: "<p>legacy html</p>", text: "legacy text" };
      },
    });

    assert.equal(legacyCalls, 1);
    assert.deepEqual(result, {
      html: "<p>legacy html</p>",
      text: "legacy text",
      engine: "legacy",
    });
  });
});

test("flag on renders v2 with business name and the SIGNED unsubscribe URL", () => {
  withEnv("GHOST_AGENCY_EMAIL_V2", "true", () =>
    withEnv("GHOST_AGENT_PHONE_DISPLAY", "(949) 555-0199", () => {
      let legacyCalls = 0;
      const record = validRecord();

      const result = composeProspectEmail(record, {
        unsubscribeUrl: SIGNED_UNSUB,
        legacyRender() {
          legacyCalls += 1;
          return { html: "<p>legacy html</p>", text: "legacy text" };
        },
      });

      assert.equal(legacyCalls, 0);
      assert.equal(result.engine, "v2");
      assert.match(result.html, /Harbor Plumbing/);
      assert.doesNotMatch(result.html, /\{\{/);
      assert.ok(
        result.html.includes(SIGNED_UNSUB),
        "html must carry the caller's signed unsubscribe URL",
      );
      assert.ok(
        !result.html.includes("https://wss-ai.com/u/"),
        "html must not carry a self-minted unsubscribe URL",
      );
    }),
  );
});

test("flag on with broken record falls back to legacy renderer", () => {
  withEnv("GHOST_AGENCY_EMAIL_V2", "true", () => {
    let legacyCalls = 0;
    const brokenRecord = { client_id: "broken-client" };

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const result = composeProspectEmail(brokenRecord, {
        unsubscribeUrl: SIGNED_UNSUB,
        legacyRender(input) {
          legacyCalls += 1;
          assert.equal(input, brokenRecord);
          return { html: "<p>legacy fallback</p>", text: "legacy fallback" };
        },
      });

      assert.equal(legacyCalls, 1);
      assert.equal(result.engine, "legacy");
    } finally {
      console.warn = originalWarn;
    }
  });
});

test("flag on without a signed unsubscribe URL refuses v2 and falls back", () => {
  withEnv("GHOST_AGENCY_EMAIL_V2", "true", () => {
    let legacyCalls = 0;

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const result = composeProspectEmail(validRecord(), {
        legacyRender() {
          legacyCalls += 1;
          return { html: "<p>legacy fallback</p>", text: "legacy fallback" };
        },
      });

      assert.equal(legacyCalls, 1);
      assert.equal(result.engine, "legacy");
    } finally {
      console.warn = originalWarn;
    }
  });
});
