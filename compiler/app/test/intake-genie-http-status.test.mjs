import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(path.join(here, "..", "server.mjs"), "utf8");

// REGRESSION LOCK (2026-07-28).
//
// compileMachineRequest() overloads `status`: transport failures carry an HTTP
// NUMBER (401 / 400 / 503) while compile outcomes carry a semantic STRING
// ("blocked", "needs_input", "out_of_scope"). The /api/intake-genie/compile
// route used `result.status || 422`, which only substitutes FALSY values — so a
// truthy "blocked" (intake-genie.mjs:388, :397, :478, the ordinary "more
// business facts are needed" path) was passed to res.writeHead() and threw
// ERR_HTTP_INVALID_STATUS_CODE. Every legitimately-blocked compile surfaced to
// Ghost as an opaque 500, which is why Ghost stayed pinned to a 12-day-old
// Intake Genie deployment that predated the logo-provenance work.

// Mirrors the expression in the route so the intent is asserted, not just the text.
const httpStatusFor = (result) => {
  const code = Number.isInteger(result.status) && result.status >= 100 && result.status <= 599
    ? result.status
    : 422;
  return result.ok === false ? code : 200;
};

test("semantic statuses map to 422, never into writeHead()", () => {
  for (const status of ["blocked", "needs_input", "out_of_scope"]) {
    const code = httpStatusFor({ ok: false, status });
    assert.equal(code, 422, `${status} must become 422`);
    assert.equal(typeof code, "number");
  }
});

test("real HTTP status numbers are preserved", () => {
  assert.equal(httpStatusFor({ ok: false, status: 401 }), 401);
  assert.equal(httpStatusFor({ ok: false, status: 400 }), 400);
  assert.equal(httpStatusFor({ ok: false, status: 503 }), 503);
});

test("missing or malformed status falls back to 422", () => {
  assert.equal(httpStatusFor({ ok: false }), 422);
  assert.equal(httpStatusFor({ ok: false, status: null }), 422);
  assert.equal(httpStatusFor({ ok: false, status: 0 }), 422, "0 is not a valid HTTP code");
  assert.equal(httpStatusFor({ ok: false, status: "422" }), 422, "a numeric STRING is still not a number");
  assert.equal(httpStatusFor({ ok: false, status: 422.5 }), 422, "non-integer is rejected");
});

test("successful compiles are 200", () => {
  assert.equal(httpStatusFor({ ok: true, status: "out_of_scope" }), 200);
  assert.equal(httpStatusFor({ ok: true, status: "needs_input" }), 200);
  assert.equal(httpStatusFor({ ok: true }), 200);
});

test("the compile route itself guards the status type", () => {
  const route = serverSrc.slice(serverSrc.indexOf('"/api/intake-genie/compile"'));
  const line = route.slice(0, route.indexOf("\n}") + 1);
  assert.match(
    line,
    /Number\.isInteger\(result\.status\)\s*&&\s*result\.status >= 100/,
    "the compile route must type-check result.status before using it as an HTTP code",
  );
  assert.doesNotMatch(
    line,
    /\(result\.status \|\| 422\)/,
    "the truthy-only fallback is the bug — a semantic string slips through it",
  );
});
