"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { boundedDetailText } = require("../lib/detail-text");
const { describeRefusal } = require("../lib/line-adapters");
const { fleetRecordSystemHold } = require("../lib/mirror-lane-build");
const { ourWorkOf } = require("../lib/prospect-detail");
const lineState = require("../lib/line-state");

const LIB = path.join(__dirname, "..", "lib");
const source = (rel) => fs.readFileSync(path.join(LIB, rel), "utf8");

const INVENTORY = [
  ["line-adapters.js", "refusal cause values", "boundedDetailText(why)"],
  ["line-adapters.js", "not_revealable detail array", "refusal.detail.map((entry) => boundedDetailText(entry))"],
  ["line-adapters.js", "refusal reason head", "boundedDetailText(refusal.reason || \"mirror_build_not_revealable\")"],
  ["line-adapters.js", "refusal structured detail", "const what = boundedDetailText(rawWhat)"],
  ["line-adapters.js", "refusal scalar detail", "return boundedDetailText(entry);"],
  ["line-adapters.js", "dispatch decision string preserved", "const refusalReasonForDecision = String(refusal?.reason || \"\").trim()"],
  ["line-adapters.js", "dispatch refusal reason", "boundedDetailText(refusal?.reason || \"\").trim()"],
  ["line-adapters.js", "dispatch fallback code", "boundedDetailText(out?.blocked?.[0] || out?.reason || \"dispatch_absent\")"],
  ["line-adapters.js", "CAS dynamic Error", "new Error(boundedDetailText(result?.error || result?.mode || \"compare_and_swap_missed\"))"],
  ["line-adapters.js", "persist-hold thrown object", "vertical_hold_persist_failed:${boundedDetailText(error?.message || error, 160)}"],
  ["line-adapters.js", "mining failure object", "mining_failed: ${boundedDetailText((mined && (mined.error || mined.message || mined.mode)) || \"unknown\")}"],
  ["line-adapters.js", "dispatch thrown reason", "dispatch_threw: ${boundedDetailText((e && e.message) || e, 200)}"],
  ["line-adapters.js", "dispatch thrown detail", "detail: boundedDetailText((e && e.message) || e, 300)"],
  ["line-adapters.js", "system-hold reason", "boundedDetailText(out.reason || out.system_hold?.code || \"mirror_system_hold\")"],
  ["line-adapters.js", "native release reason/detail", "detail: boundedDetailText(nativeBuild.reason || \"\", 300)"],

  ["mirror-lane-build.js", "social detail catch", "detail: boundedDetailText((e && e.message) || e, 160)"],
  ["mirror-lane-build.js", "record reason catch", "reason: boundedDetailText((error && error.message) || error, 200)"],
  ["mirror-lane-build.js", "runtime unavailable", "reason: boundedDetailText((e && e.message) || e, 160)"],
  ["mirror-lane-build.js", "runtime threw", "reason: boundedDetailText((e && e.message) || e, 200)"],
  ["mirror-lane-build.js", "fleet read thrown", "fleetReadSystemHold(boundedDetailText(e?.message || e || \"fleet_read_threw\"))"],
  ["mirror-lane-build.js", "fleet returned reason", "? boundedDetailText(fleet.reason)"],
  ["mirror-lane-build.js", "fleet record returned reason", "boundedDetailText(recorded.reason)"],
  ["mirror-lane-build.js", "fleet hold detail", "boundedDetailText(detail || code).trim().slice(0, 160)"],
  ["mirror-lane-build.js", "bounded release cause", "return boundedDetailText(value).trim().slice(0, 120)"],
  ["mirror-lane-build.js", "reconciliation detail", "return boundedDetailText(value)"],
  ["mirror-lane-build.js", "sameness decision normalization preserved", "problems.map((problem) => String(problem || \"\"))"],
  ["mirror-lane-build.js", "sameness failure detail list", "rawProblems.map((problem) => boundedDetailText(problem || \"\"))"],
  ["mirror-lane-build.js", "trust lookup catch", "trustLookup = { status: \"threw\", reason: boundedDetailText((e && e.message) || e, 200) }"],

  ["mirror-fleet-identity.js", "fleet read thrown reason", "reason: boundedDetailText(error && error.message ? error.message : error, 160)"],
  ["mirror-fleet-identity.js", "fleet write returned reason", "reason: boundedDetailText(\n          result?.error?.code || result?.reason || result?.mode || \"fleet_identity_write_unconfirmed\""],
  ["mirror-fleet-identity.js", "record thrown object", "message: boundedDetailText(error?.message || error)"],
  ["mirror-fleet-identity.js", "retry-claim thrown object", "reason: boundedDetailText(error?.message || error, 160)"],

  ["mirror-engine/deploy.js", "AbortSignal.reason dynamic Error", "reason instanceof Error ? reason.message : boundedDetailText(reason)"],
  ["mirror-engine/deploy.js", "deploy catch evidence", "_err: boundedDetailText(e.message || e)"],

  ["prospect-detail.js", "retained last_build_error", "reason: firstFailureText(last.reason, last.message)"],
  ["prospect-detail.js", "retained build_dispatch", "reason: firstFailureText(dispatch.reason, dispatch.error)"],

  ["line-state.js", "terminal row reason", "reason: boundedDetailText(patch.reason || row.reason || \"\")"],
  ["line-state.js", "terminal row history reason", "reason: boundedDetailText(patch.reason || \"\")"],
  ["line-state.js", "nonterminal recorded reason", "patch.reason !== undefined ? boundedDetailText(patch.reason) : row.reason"],

  ["full-run.js", "check problems", "check.problems.slice(0, 6).map((problem) => boundedDetailText(problem))"],
  ["full-run.js", "check reason", "parts.push(boundedDetailText(check.reason))"],
  ["full-run.js", "first-attempt problems/reason", "boundedDetailText(fa.reason) || \"no detail\""],
  ["full-run.js", "hero enqueue refusal", "boundedDetailText(result?.reason || result?.error || \"hero_remaster_enqueue_refused\")"],
  ["full-run.js", "Intake Genie result Error", "new Error(boundedDetailText(result.error || \"Intake Genie did not return a canonical packet.\"))"],
  ["full-run.js", "scope Error", "new Error(boundedDetailText(result.packet.scope?.message || \"Prospect is outside Intake Genie scope.\"))"],
  ["full-run.js", "needs-input Error", "new Error(boundedDetailText(result.packet.question || result.packet.error || \"Intake Genie needs more facts before building.\"))"],
  ["full-run.js", "full-run catch array", "[boundedDetailText(error && error.message ? error.message : error, 300)]"],
  ["full-run.js", "dispatch catch", "dispatch.error = error.message || boundedDetailText(error)"],

  ["design-brief.js", "model refusal detail", "detail: boundedDetailText(detail || \"\", 200)"],
  ["design-brief.js", "capture failure", "capture_failed: ${boundedDetailText((error && error.message) || error, 200)}"],
  ["design-brief.js", "Anthropic catch", "anthropic:${m}:${boundedDetailText((e && e.message) || e, 60)}"],
  ["design-brief.js", "OpenRouter catch", "openrouter:${m}:${boundedDetailText((e && e.message) || e, 60)}"],
  ["design-brief.js", "font lookup catch", "font lookup failed: ${boundedDetailText((e && e.message) || e, 80)}"],
];

test("shared detail serializer never flattens objects to [object Object] and preserves strings verbatim", () => {
  assert.equal(boundedDetailText("exact failure text"), "exact failure text");
  assert.equal(boundedDetailText({ code: "write_failed", detail: { status: 503 } }), '{"code":"write_failed","detail":{"status":503}}');
  assert.equal(boundedDetailText(["one", { reason: "two" }]), 'one ;; {"reason":"two"}');
  assert.equal(boundedDetailText(null), "");
  assert.equal(boundedDetailText(undefined), "");
  const circular = {}; circular.self = circular;
  assert.equal(boundedDetailText(circular), "[unserializable object]");
  assert.equal(boundedDetailText(circular).includes("[object Object]"), false);
});

test("every issue #538 inventory site is pinned to the one shared serializer", () => {
  for (const [file, site, needle] of INVENTORY) {
    assert.ok(source(file).includes(needle), `${file}: ${site} must route through boundedDetailText`);
  }
});

test("line refusal object cause/detail render JSON and strings remain verbatim", () => {
  const causeRendered = describeRefusal({ reason: "invalid_request", cause: { publish: { code: "alias_refused", status: 409 } } });
  assert.match(causeRendered, /\{"code":"alias_refused","status":409\}/);
  assert.equal(causeRendered.includes("[object Object]"), false);
  const detailRendered = describeRefusal({ reason: "invalid_request", detail: [{ path: "/brand/logo", reason: { code: "bad_logo", expected: "https" } }] });
  assert.match(detailRendered, /\{"code":"bad_logo","expected":"https"\}/);
  assert.equal(detailRendered.includes("[object Object]"), false);
  assert.equal(describeRefusal({ reason: "plain_refusal", detail: ["plain detail"] }), "plain_refusal — plain detail");
});

test("mirror fleet hold object detail renders JSON and string detail stays verbatim", () => {
  const objectHold = fleetRecordSystemHold({ code: "fleet_write_failed", nested: { status: 503 } });
  assert.match(objectHold.body.detail[0].reason, /\{"code":"fleet_write_failed","nested":\{"status":503\}\}/);
  assert.equal(objectHold.body.detail[0].reason.includes("[object Object]"), false);
  assert.equal(fleetRecordSystemHold("plain fleet failure").body.detail[0].reason, "plain fleet failure");
});

test("retained operator problem object reason renders JSON and string stays verbatim", () => {
  const row = { prospect_id: "p_issue_538", status: "packeted", record: { last_build_error: { reason: { code: "mirror_failed", status: 503 }, at: "2026-09-01T01:00:00.000Z" } } };
  assert.equal(ourWorkOf(row).problem, '{"code":"mirror_failed","status":503}');
  assert.equal(ourWorkOf(row).problem.includes("[object Object]"), false);
  row.record.last_build_error.reason = "plain retained failure";
  assert.equal(ourWorkOf(row).problem, "plain retained failure");
});

test("line-state serializes object-valued recorded reasons without changing state decisions", () => {
  const row = lineState.newRow({ prospectId: "p538", now: "2026-09-01T00:00:00.000Z" });
  const failed = lineState.advanceRow(row, "error", { reason: { code: "build_failed", status: 503 }, now: "2026-09-01T00:01:00.000Z" });
  assert.equal(failed.ok, true);
  assert.equal(failed.row.status, "error");
  assert.equal(failed.row.reason, '{"code":"build_failed","status":503}');
  assert.equal(failed.row.history.at(-1).reason, '{"code":"build_failed","status":503}');
  assert.equal(failed.row.reason.includes("[object Object]"), false);

  const plain = lineState.advanceRow(lineState.newRow({ prospectId: "p539" }), "error", { reason: "plain row failure" });
  assert.equal(plain.row.reason, "plain row failure");
  assert.equal(plain.row.history.at(-1).reason, "plain row failure");
});


test("issue 538 keeps legacy decision normalization outside presentation serializers", () => {
  const adapters = source("line-adapters.js");
  assert.match(adapters, /const refusalReasonForDecision = String\(refusal\?\.reason \|\| ""\)\.trim\(\)/);
  assert.match(adapters, /hasDurableBuildIdentity && refusalReasonForDecision === "not_revealable"/);

  const lane = source("mirror-lane-build.js");
  assert.match(lane, /function samenessProblems[\s\S]*problems\.map\(\(problem\) => String\(problem \|\| ""\)\)/);
  assert.match(lane, /function samenessFailureDetail[\s\S]*rawProblems\.map\(\(problem\) => boundedDetailText\(problem \|\| ""\)\)/);

  const fleet = source("mirror-fleet-identity.js");
  assert.match(fleet, /function bounded\(value, length\)[\s\S]*JSON\.stringify\(value\)[\s\S]*return text\.trim\(\)\.slice\(0, length\)/);
});
