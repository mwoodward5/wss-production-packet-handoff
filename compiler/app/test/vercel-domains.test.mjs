import assert from "node:assert/strict";
import { customerProjectName, domainProvisioningReady } from "../lib/vercel-domains.mjs";

assert.equal(customerProjectName({ slug: "woodward-pool-builders" }), "siteforge-woodward-pool-builders");
assert.equal(customerProjectName({ slug: "a".repeat(80) }).length, 52);
const before = process.env.SITEFORGE_VERCEL_TOKEN;
delete process.env.SITEFORGE_VERCEL_TOKEN;
delete process.env.VERCEL_TOKEN;
assert.equal(domainProvisioningReady(), false);
if (before) process.env.SITEFORGE_VERCEL_TOKEN = before;

console.log("Vercel domain adapter tests: passed");
