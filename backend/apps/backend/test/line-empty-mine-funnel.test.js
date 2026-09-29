"use strict";

/**
 * test/line-empty-mine-funnel.test.js — a zero-yield mine must still say why.
 *
 * pickProspects attaches the miner's funnel to the returned array at the
 * bottom of the function, but the "nothing survived" branch returned a bare []
 * before reaching it. Every empty run therefore arrived at the console as
 * mineFunnel:null and drew a mute empty batch. Five consecutive production
 * runs on 2026-08-06 (Omaha, Wichita, Little Rock, Memphis, Nashville) each
 * reported "0 leads" with no stated cause for exactly that reason — while the
 * miner had, in fact, measured and reported the kill at stage 8.
 *
 * The funnel is the operator's whole answer to "why did this produce nothing?"
 * and it is worth more on the empty run than on the successful one.
 */
const test = require("node:test");
const assert = require("node:assert");

const { pickProspects } = require("../lib/line-adapters");

const FUNNEL = [
  { stage: "0_vertical_donor_gate", cost: "free", entered: 1, survived: 1, rejected: {} },
  { stage: "5_email", cost: "free_plus_dns_mx", entered: 15, survived: 4, rejected: { no_email_published: 11 } },
  { stage: "8_dry_run_build_proof", cost: "free_zero_vercel", entered: 4, survived: 0, rejected: { dry_run_invalid_request: 4 } },
];

function minerYielding(rows) {
  return async () => ({ ok: true, mode: "build_ready", funnel: FUNNEL, rows });
}

test("a mine that yields nothing still carries the funnel that explains it", async () => {
  const picked = await pickProspects(
    { target: "plumbing in Nashville TN", count: 100 },
    { mineLeads: minerYielding([]) },
  );
  assert.equal(picked.length, 0);
  assert.deepEqual(picked.funnel, FUNNEL, "the empty run must not drop the funnel");
});

test("rows the miner could not persist are also a zero-yield mine, and still explain themselves", async () => {
  // Rows present, but none of them completed persistence with a build hash —
  // the same early return, reached a different way.
  const picked = await pickProspects(
    { target: "plumbing in Memphis TN", count: 100 },
    {
      mineLeads: minerYielding([
        { prospect_id: "wss-test-a", persistence: "skipped", build_hash: "abc" },
        { prospect_id: "wss-test-b", persistence: "created" }, // no build_hash
      ]),
    },
  );
  assert.equal(picked.length, 0);
  assert.deepEqual(picked.funnel, FUNNEL);
});

test("the funnel reaches the batch the console reads, not just the picker", async () => {
  const runner = require("../lib/line-runner");
  const result = await runner.startBatch(
    { count: 100, target: "plumbing in Nashville TN", lane: "sandbox" },
    {
      pick: (args) => pickProspects(args, { mineLeads: minerYielding([]) }),
      mirror: async () => ({ ok: false, reason: "unreached" }),
    },
  );
  const batch = result.batch || runner.getBatch(result.batchId);
  assert.deepEqual(batch.mineFunnel, FUNNEL);
  assert.equal((batch.rows || []).length, 0);
  // And the stage that actually did the killing is legible from it.
  const closer = batch.mineFunnel.find((f) => f.stage === "8_dry_run_build_proof");
  assert.equal(closer.survived, 0);
  assert.equal(closer.rejected.dry_run_invalid_request, 4);
});

// ---------------------------------------------------------------------------
// THE EMAIL STAGE MUST NAME EVERY ADDRESS IT TURNED DOWN
// ---------------------------------------------------------------------------
// `reason` is rejects[0].reason and rejects are in page order, so which reason
// the funnel counts is decided by where an address sits in the HTML. Apache
// Plumbing's page lists apacheplumbing@cox.net then your@email.com; reversed,
// the funnel would have named the wrong killer and sent an operator hunting a
// domain problem on a site whose only defect is a template placeholder.
const { qualifyEmail } = require("../lib/lead-miner");

test("qualifyEmail reports every rejected address, not only the first", async () => {
  // The third-party address is on a REAL registrable domain, not a reserved TLD:
  // *.test / *.example are placeholder-class by definition (isPlaceholderEmail
  // claims them, correctly), so a reserved TLD here would test the placeholder
  // guard, not the third-party gate this case is about.
  const out = await qualifyEmail({
    emails: ["noreply@apacheplumbingservices.com", "hello@someoneelse.com"],
    siteUrl: "https://apacheplumbingservices.com/",
    resolveMx: async () => [{ exchange: "mx.test" }],
  });
  assert.strictEqual(out.ok, false);
  // The counter key is unchanged — regrouping it would fragment the funnel —
  // and it is still whichever address happened to come first. noreply@ is a role
  // account on the client's own domain, so its honest reason is the localpart, not
  // "placeholder", even though the placeholder guard would also flag the family.
  assert.strictEqual(out.reason, "non_business_localpart");
  const listed = (out.rejected || []).map((r) => `${r.email}=${r.reason}`);
  assert.deepStrictEqual(listed, [
    "noreply@apacheplumbingservices.com=non_business_localpart",
    "hello@someoneelse.com=third_party_domain",
  ]);
});

test("THE FONT-AUTHOR CLASS is still refused: an address on somebody else's domain", async () => {
  // Jul-27: addresses that merely appeared in page source, on domains that were
  // never ours to write to, went out as prospect contacts. That refusal stands.
  const out = await qualifyEmail({
    emails: ["hello@fontauthor.com"],
    siteUrl: "https://apacheplumbingservices.com/",
    resolveMx: async () => [{ exchange: "mx.test" }],
  });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "third_party_domain");
});

test("an address on the client's own domain still qualifies", async () => {
  const out = await qualifyEmail({
    emails: ["office@apacheplumbingservices.com"],
    siteUrl: "https://apacheplumbingservices.com/",
    resolveMx: async () => [{ exchange: "mx.test" }],
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.domain_class, "own_registrable_domain");
});
