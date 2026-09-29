"use strict";

// lib/edit-confirm.js — the confirmation both doors into the edit engine share.
//
// Riley's phone tool and the dashboard chat panel now mint and verify with ONE
// implementation. These tests fix the properties that make the shared version
// safe to use from two places at once: a confirmation is bound to the exact
// (slug, business, domain, instruction) it was read back for, it expires, and
// a rejection names the credential that actually failed.
//
// Fails before this change: lib/edit-confirm.js did not exist — the logic was
// private to api/vapi-tools/site-edit.js and unreachable from the chat door.

const test = require("node:test");
const assert = require("node:assert/strict");

const confirmPath = require.resolve("../lib/edit-confirm");

const SECRET = "edit-confirm-test-secret-0123456789";
const FACTS = {
  siteSlug: "wss-test-flint-plumbing-s5",
  businessName: "Flint Plumbing LLC",
  domain: "wss-test-flint-plumbing-s5.wss-ai.com",
  instruction: "Make the phone number in the header bigger.",
};

function withSecret(run) {
  const saved = process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET;
  process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET = SECRET;
  delete require.cache[confirmPath];
  const mod = require(confirmPath);
  try {
    return run(mod);
  } finally {
    if (saved === undefined) delete process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET;
    else process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET = saved;
    delete require.cache[confirmPath];
  }
}

test("a token minted for one change confirms that change and nothing else", () => {
  withSecret((m) => {
    const token = m.mintConfirmToken(FACTS);
    assert.ok(token.length > 40, "a real signed token, not an empty string");
    assert.equal(m.verifyConfirmToken(token, FACTS).ok, true);

    // Every one of the four bound facts, changed one at a time.
    const swaps = [
      ["siteSlug", "wss-test-someone-else", "slug_mismatch"],
      ["businessName", "Someone Else Ltd", "business_mismatch"],
      ["domain", "someone-else.wss-ai.com", "domain_mismatch"],
      ["instruction", "Delete the contact section.", "instruction_mismatch"],
    ];
    for (const [field, value, reason] of swaps) {
      const got = m.verifyConfirmToken(token, { ...FACTS, [field]: value });
      assert.equal(got.ok, false, `${field} must not verify against a different value`);
      assert.equal(got.reason, reason);
    }
  });
});

test("a tampered signature is refused", () => {
  withSecret((m) => {
    const token = m.mintConfirmToken(FACTS);
    const [payload, sig] = token.split(".");
    const flipped = `${payload}.${sig.slice(0, -1)}${sig.slice(-1) === "A" ? "B" : "A"}`;
    assert.equal(m.verifyConfirmToken(flipped, FACTS).reason, "bad_signature");
    assert.equal(m.verifyConfirmToken("not-a-token", FACTS).reason, "malformed_token");
  });
});

test("a confirmation expires", () => {
  withSecret((m) => {
    const realNow = Date.now;
    const token = m.mintConfirmToken(FACTS);
    try {
      Date.now = () => realNow() + m.CONFIRM_TTL_MS + 1000;
      assert.equal(m.verifyConfirmToken(token, FACTS).reason, "expired");
    } finally {
      Date.now = realNow;
    }
  });
});

test("the six-character code is speakable and bound to the same four facts", () => {
  withSecret((m) => {
    const code = m.mintConfirmCode(FACTS);
    assert.match(code, /^[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{6}$/, "no O/0, I/1 or S/5 — this gets read down a phone");
    assert.equal(m.confirmCodeValid(code, FACTS), true);
    assert.equal(m.confirmCodeValid(code, { ...FACTS, instruction: "something else" }), false);
    assert.equal(m.confirmCodeValid(code, { ...FACTS, businessName: "Another Co" }), false);
    // Case and spacing are how a code survives being read aloud and typed back.
    assert.equal(m.confirmCodeValid(code.toLowerCase(), FACTS), true);
    assert.equal(m.confirmCodeValid(`${code.slice(0, 3)} ${code.slice(3)}`, FACTS), true);
  });
});

test("verifyEditConfirmation names the credential that actually failed", () => {
  withSecret((m) => {
    const token = m.mintConfirmToken(FACTS);
    const code = m.mintConfirmCode(FACTS);

    assert.equal(m.verifyEditConfirmation({ confirmToken: token, facts: FACTS }).ok, true);
    assert.equal(m.verifyEditConfirmation({ confirmCode: code, facts: FACTS }).ok, true);

    // A bad CODE must not be reported as a malformed TOKEN — that diagnostic
    // sends whoever debugs the next failed change to the wrong half.
    const badCode = m.verifyEditConfirmation({ confirmCode: "ZZZZZZ", facts: FACTS });
    assert.equal(badCode.ok, false);
    assert.equal(badCode.reason, "confirm_code_invalid");

    const badToken = m.verifyEditConfirmation({ confirmToken: "garbage", facts: FACTS });
    assert.equal(badToken.reason, "malformed_token");

    // Nothing at all is not a confirmation.
    assert.equal(m.verifyEditConfirmation({ facts: FACTS }).ok, false);
  });
});

test("no secret means no confirmation is ever minted or accepted", () => {
  const saved = {
    a: process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET,
    b: process.env.VAPI_TOOL_SECRET,
    c: process.env.VAPI_WEBHOOK_SECRET,
    d: process.env.GHOST_AGENCY_ADMIN_TOKEN,
  };
  delete process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET;
  delete process.env.VAPI_TOOL_SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  delete require.cache[confirmPath];
  try {
    const m = require(confirmPath);
    assert.equal(m.mintConfirmToken(FACTS), "");
    assert.equal(m.mintConfirmCode(FACTS), "");
    assert.equal(m.verifyConfirmToken("anything", FACTS).reason, "no_confirm_secret");
    assert.equal(m.confirmCodeValid("ABCDEF", FACTS), false);
  } finally {
    for (const [key, value] of [
      ["GHOST_AGENCY_EDIT_CONFIRM_SECRET", saved.a],
      ["VAPI_TOOL_SECRET", saved.b],
      ["VAPI_WEBHOOK_SECRET", saved.c],
      ["GHOST_AGENCY_ADMIN_TOKEN", saved.d],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[confirmPath];
  }
});

test("the phone tool uses the shared module rather than its own copy", () => {
  const fs = require("node:fs");
  // The confirm primitives are required by the tool core
  // (lib/site-edit-core.js) since the route became the transport shell for the
  // one proxy door (api/vapi-tools/riley.js).
  const src = fs.readFileSync(require.resolve("../lib/site-edit-core.js"), "utf8");
  assert.match(src, /require\("\.\/edit-confirm"\)/);
  assert.doesNotMatch(src, /function mintConfirmCode/, "a second copy of the confirmation is how the two doors drift apart");
  assert.doesNotMatch(src, /function verifyConfirmToken/);
});
