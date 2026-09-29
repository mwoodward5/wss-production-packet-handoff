"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-memo-clients-"));

const {
  mirror,
  signEvidence,
  RENDERER,
  EVIDENCE_SCHEMA,
  QC_CONTRACT,
} = require("../lib/mirror-engine/engine");

test.after(() => {
  fs.rmSync(process.env.MIRROR_CLIENT_ROOT, { recursive: true, force: true });
});

function mirrorRequest(slug) {
  return {
    slug,
    donor: "mirror-donor",
    facts: {
      business_name: "Memo Evidence Roofing",
      industry: "roofing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
    },
  };
}

function memoDeps() {
  return {
    resolveBrandAssets: async () => ({
      ok: true,
      logo: null,
      accent: null,
      mark: { kind: "wordmark" },
      hashes: {},
    }),
    siteEditLog: async () => ({ ok: true, fingerprint: "" }),
  };
}

test("memo replay is re-signed without mutating the cached release evidence", async () => {
  const first = {
    renderer: RENDERER,
    qc_contract: QC_CONTRACT,
    evidence_schema: EVIDENCE_SCHEMA,
    build_hash: "a".repeat(64),
    donor: "mirror-donor",
    slug: "wss-test-memo-evidence-roofing",
    preview_url: "https://wss-test-memo-evidence-roofing.wss-ai.com/",
    revealable: true,
    checks: { render: { status: "passed" } },
  };
  first.evidence_sha = signEvidence(first);

  const cachedSnapshot = structuredClone(first);
  const registry = {
    memoGet() {
      return first;
    },
  };

  const replay = await mirror(mirrorRequest(first.slug), {
    registry,
    deps: memoDeps(),
  });

  assert.equal(signEvidence(first), first.evidence_sha, "the first response remains valid");
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent_replay, true);
  assert.equal(signEvidence(replay.body), replay.body.evidence_sha, "the replay response is signed as returned");
  assert.notEqual(replay.body.evidence_sha, first.evidence_sha, "the replay marker participates in evidence");
  assert.deepEqual(first, cachedSnapshot, "the cached manifest is never mutated");
});

test("tampered memo evidence is refused instead of re-signed", async () => {
  const cached = {
    renderer: RENDERER,
    qc_contract: QC_CONTRACT,
    evidence_schema: EVIDENCE_SCHEMA,
    build_hash: "b".repeat(64),
    donor: "mirror-donor",
    slug: "wss-test-tampered-memo-roofing",
    preview_url: "https://wss-test-tampered-memo-roofing.wss-ai.com/",
    revealable: true,
    checks: { render: { status: "passed" } },
  };
  cached.evidence_sha = signEvidence(cached);
  cached.preview_url = "https://attacker.invalid/";
  const tamperedSnapshot = structuredClone(cached);

  const result = await mirror(mirrorRequest(cached.slug), {
    registry: { memoGet: () => cached },
    deps: memoDeps(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.body.error, "memo_evidence_invalid");
  assert.equal(result.body.detail.length, 1);
  assert.equal(result.body.detail[0].reason, "cached_release_evidence_signature_invalid");
  assert.match(result.body.detail[0].build_hash, /^[0-9a-f]{64}$/);
  assert.equal(result.body.idempotent_replay, undefined);
  assert.deepEqual(cached, tamperedSnapshot, "refusal does not mutate or re-sign corrupt cache state");
  assert.notEqual(signEvidence(cached), cached.evidence_sha, "tampered evidence remains visibly invalid");
});
