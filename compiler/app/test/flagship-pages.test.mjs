import assert from "node:assert/strict";
import { growthHubPage, reportPage, studioConsolePage } from "../views/pages-flagship.mjs";

const report = reportPage({
  project: { name: "Woodward Pool Builders" },
  profile: { business_name: "Woodward Pool Builders", city: "Mission Viejo" },
  generation: { version: 4, qc_grade: "A", status: "done" },
  qc: { score: 100, results: [{ name: "base-qc", pass: true, detail: "11/11" }] },
  reportUrl: "https://siteforge.example/report/token",
});
assert.match(report, /Woodward Pool Builders/);
assert.match(report, /100\/100/);
assert.doesNotMatch(report, /fake metric/i);

const growth = growthHubPage({
  user: { id: "user_1", email: "owner@example.com" },
  projects: [{ id: "project_1", user_id: "user_1" }],
  leads: [{ project_id: "project_1", user_id: "user_1", name: "Ada Lead", status: "new" }],
  reviews: [],
  ranks: [],
  ent: { plan_name: "Pro" },
});
assert.match(growth, /Ada Lead/);
assert.match(growth, /Connect your Google page or another review source/);

const studio = studioConsolePage({
  user: { id: "user_1", name: "Woodward Studio" },
  clients: [{ id: "project_1", name: "Pool client", status: "published", grade: "A" }],
  apiKeys: [{ id: "key_1", name: "Production", prefix: "sf_live_example" }],
  ent: { plan_name: "Agency" },
  csrf: "csrf-token",
});
assert.match(studio, /POST \/api\/v1\/forge/);
assert.match(studio, /api\/studio\/keys\/key_1\/revoke/);
assert.doesNotMatch(studio, /secret_hash/);

console.log("Flagship page tests: passed");
