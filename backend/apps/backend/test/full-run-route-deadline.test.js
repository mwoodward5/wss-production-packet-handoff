"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const routePath = require.resolve("../api/admin/full-run");
const authPath = require.resolve("../lib/admin-auth");
const httpPath = require.resolve("../lib/http");
const fullRunPath = require.resolve("../lib/full-run");

function cachedModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports };
}

test("full-run route starts the owner deadline before auth and body parsing", async (t) => {
  const targets = [routePath, authPath, httpPath, fullRunPath];
  const previous = new Map(targets.map((target) => [target, require.cache[target]]));
  const originalDateNow = Date.now;
  let now = 1_000;
  let capturedInput;
  let responseBody;
  t.after(() => {
    Date.now = originalDateNow;
    for (const target of targets) {
      delete require.cache[target];
      if (previous.get(target)) require.cache[target] = previous.get(target);
    }
  });

  Date.now = () => now;
  require.cache[authPath] = cachedModule(authPath, {
    requireAdmin: () => {
      now = 10_000;
      return true;
    },
  });
  require.cache[httpPath] = cachedModule(httpPath, {
    methodGuard: () => true,
    readJson: async () => {
      now = 20_000;
      return {
        sandboxMode: true,
        ownerProofResend: true,
        ownerProofDeadlineAt: 999_999_999,
      };
    },
    sendJson: (_res, _status, body) => {
      responseBody = body;
    },
    handleError: (_res, error) => {
      throw error;
    },
  });
  require.cache[fullRunPath] = cachedModule(fullRunPath, {
    runFullSystem: async (input) => {
      capturedInput = input;
      return { ok: true };
    },
  });
  delete require.cache[routePath];

  const handler = require(routePath);
  await handler({ method: "POST" }, {});

  assert.equal(capturedInput.ownerProofDeadlineAt, 286_000);
  assert.deepEqual(responseBody, { ok: true });
});
