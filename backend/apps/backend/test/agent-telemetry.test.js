"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { agentTelemetry, telemetryPayload } = require("../lib/agent-telemetry");

test("standardizes the seven required lifecycle events", () => {
  assert.deepEqual(telemetryPayload("agent_01_prospect_miner", "dependency-wait", { dependency: "places" }), {
    actor: "agent_01_prospect_miner", telemetry: "dependency-wait", status: "blocked", dependency: "places",
  });
  assert.throws(() => telemetryPayload("agent", "ready"), /agent_telemetry_invalid/);
});

test("distinguishes never invoked from healthy, blocked, and failed", () => {
  const defs = [["never","Never","none"],["ok","OK","works"],["wait","Wait","waits"],["bad","Bad","fails"]];
  const events = [
    { type: "agent.failed", created_at: "2026-07-18T04:00:00Z", payload: { actor: "bad", telemetry: "failed", code: "boom" } },
    { type: "agent.wait", created_at: "2026-07-18T03:00:00Z", payload: { actor: "wait", telemetry: "dependency-wait", dependency: "preview" } },
    { type: "agent.completed", created_at: "2026-07-18T02:00:00Z", payload: { actor: "ok", telemetry: "completed" } },
  ];
  const rows = agentTelemetry(events, defs);
  assert.deepEqual(rows.map((row) => row.state), ["never-invoked", "healthy", "blocked", "failed"]);
  assert.equal(rows[2].nextDependency, "preview");
  assert.equal(rows[3].lastError.code, "boom");
});
