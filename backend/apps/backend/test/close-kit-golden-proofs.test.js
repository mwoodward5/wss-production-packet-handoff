"use strict";
// The Close Kit's four modules each carry their own `--test` golden proof — that
// is how they were graded and adversarially reviewed before they were allowed
// near this repo. Moving them in without running those proofs in CI would let
// them rot silently, so this file is the seam: it shells each module's own proof
// and fails the suite if any of them stops being green.
//
// STAGED, NOT WIRED (see side/close-kit/WELD.md): nothing in the send path
// imports these yet. The Close Kit only GENERATES text — proposal, onboarding
// sequence, objection playbook — and the consent law still applies at the seam
// where a caller eventually stages any of it. Generating is not sending.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MODULES = [
  "close-kit-adapter.js",
  "close-kit-proposal.js",
  "close-kit-onboarding.js",
  "close-kit-objections.js",
];

const DIR = path.join(__dirname, "..", "lib", "close-kit");

for (const mod of MODULES) {
  test(`close-kit golden proof: ${mod}`, () => {
    const run = spawnSync(process.execPath, [path.join(DIR, mod), "--test"], {
      encoding: "utf8",
      timeout: 60_000,
    });

    const output = `${run.stdout || ""}${run.stderr || ""}`;

    assert.equal(
      run.status,
      0,
      `${mod} --test exited ${run.status}\n${output.slice(-1500)}`,
    );

    // A proof that prints nothing is not a proof. Require visible PASS lines and
    // no FAIL line — these modules print one line per assertion by design.
    const passes = (output.match(/^\s*PASS/gm) || []).length;
    assert.ok(passes > 0, `${mod} --test produced no PASS lines:\n${output.slice(0, 800)}`);
    assert.ok(
      !/^\s*(FAIL|not ok)\b/m.test(output),
      `${mod} --test reported a failure:\n${output.slice(-1500)}`,
    );
  });
}

test("close-kit modules expose the contracts WELD.md promises", () => {
  const adapter = require(path.join(DIR, "close-kit-adapter.js"));
  const proposal = require(path.join(DIR, "close-kit-proposal.js"));
  const onboarding = require(path.join(DIR, "close-kit-onboarding.js"));
  const objections = require(path.join(DIR, "close-kit-objections.js"));

  assert.equal(typeof adapter.recordToCloseKitInput, "function");
  assert.equal(typeof proposal.buildProposal, "function");
  assert.equal(typeof proposal.proposalSections, "function");
  assert.equal(typeof onboarding.onboardingSequence, "function");
  assert.equal(typeof onboarding.sequencePlan, "function");
  assert.equal(typeof objections.objectionPlaybook, "function");
  assert.equal(typeof objections.refute, "function");
});

test("an empty record refuses honestly instead of inventing facts", () => {
  const { recordToCloseKitInput } = require(path.join(DIR, "close-kit-adapter.js"));

  // The lane's standing law: absent data degrades to a stated refusal with the
  // missing fields NAMED, never to confident filler. The adapter answers
  // {ok, input, warnings} — ok:false is the refusal, and every omission has to
  // announce itself so a reader can see what the proposal will leave out.
  const out = recordToCloseKitInput({});

  assert.equal(out.ok, false, "an empty record cannot report ok:true");
  assert.equal(out.input.business.name, "", "no business name may be invented");
  assert.equal(out.input.proof.ready, false, "proof cannot be ready without shots");
  assert.deepEqual(out.input.services, [], "services may not be conjured");
  assert.deepEqual(out.input.reviews.sampleQuotes, [], "review quotes may not be conjured");
  assert.ok(
    out.warnings.some((w) => /business_name missing/.test(w)),
    "the missing business name must be named in warnings, not swallowed",
  );

  // The offer is a decree, not a discovery (WELD.md): $149/mo, no setup fee.
  // It is the one field allowed to be present without a record to read it from.
  assert.equal(out.input.offer.monthly, 149);
  assert.equal(out.input.offer.setup, 0);
});
