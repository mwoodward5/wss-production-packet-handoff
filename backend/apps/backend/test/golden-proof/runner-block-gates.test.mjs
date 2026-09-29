// test/golden-proof/runner-block-gates.test.mjs
// Verifies that the owner-local runner blocks correctly when credentials
// are missing and when Stripe is not test-mode. Pure offline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.resolve(TEST_DIR, "..", "..", "scripts", "golden-proof", "owner-local-golden-proof.mjs");

function runWithEnv(env, extraArgs = []) {
  const out = mkdtempSync(path.join(tmpdir(), "gpr-"));
  const r = spawnSync("node", [RUNNER, "--out", out, ...extraArgs], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
  const telemetryPath = path.join(out, "run-telemetry.json");
  const telemetry = existsSync(telemetryPath) ? JSON.parse(readFileSync(telemetryPath, "utf8")) : null;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, telemetry, outDir: out };
}

test("blocks when no environment variables are set", () => {
  const r = runWithEnv({});
  assert.equal(r.code, 2);
  assert.ok(r.telemetry.blocked, "expected blocked telemetry entry");
  assert.equal(r.telemetry.blocked.reason, "missing_required_credentials");
  assert.ok(r.telemetry.env_missing.includes("GHOST_AGENCY_ADMIN_TOKEN"));
});

test("blocks when Stripe key is not test mode", () => {
  const env = {
    GHOST_AGENCY_ADMIN_TOKEN: "x",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "srv-x",
    GHOST_AGENCY_SITEFORGE_BUILD_URL: "https://siteforge-app-seven.vercel.app/api/build",
    GHOST_AGENCY_SITEFORGE_BUILD_TOKEN: "sf-x",
    GHOST_AGENCY_INTAKE_GENIE_URL: "https://intake-genie.example.com",
    GHOST_AGENCY_INTAKE_GENIE_TOKEN: "ig-x",
    STRIPE_SECRET_KEY: "sk_live_wouldbeblockedeverywhere",
    STRIPE_LOCAL_GROWTH_PRICE_ID: "price_x",
    GHOST_AGENCY_OWNER_ONE_PROSPECT_ID: "prosp_x",
  };
  const r = runWithEnv(env);
  assert.equal(r.code, 3);
  assert.equal(r.telemetry.blocked.reason, "stripe_not_test_mode");
});

test("env inspection redacts values (never echoes secrets)", () => {
  const env = {
    GHOST_AGENCY_ADMIN_TOKEN: "TOP_SECRET_TOKEN_SHOULD_NEVER_APPEAR",
  };
  const r = runWithEnv(env);
  const raw = JSON.stringify(r.telemetry);
  assert.equal(raw.includes("TOP_SECRET_TOKEN_SHOULD_NEVER_APPEAR"), false, "runner leaked env value into telemetry");
  assert.equal(r.telemetry.env.required.GHOST_AGENCY_ADMIN_TOKEN, "[present:redacted]");
});
