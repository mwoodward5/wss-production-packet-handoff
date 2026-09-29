"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { Readable } = require("node:stream");

// REGRESSION LOCK (2026-07-28).
//
// buildPreviewForProspect resumes a prospect's persisted `build_dispatch` unless
// options.freshDispatch is set. When that stored dispatch is a COMPLETED job,
// SiteForge returns the existing artifacts and the route answers
// {ok:true, pending:false, status:"previewed"} almost instantly — indistinguishable
// from a real rebuild.
//
// This actually happened: after removing donor identity leaks from the roofing
// template, five live prospects were "rebuilt" twice and the pages never changed,
// because /api/admin/build-preview accepted freshDispatch in its body and then
// silently dropped it. There was no way for an operator to force a rebuild at all.

function loadHandlerWithStub(captured) {
  const resolveFilename = Module._resolveFilename;
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === "../../lib/full-run") {
      return {
        progress: async () => {},
        buildPreviewForProspect: async (prospect, options) => {
          captured.options = options;
          return { ok: true, prospect_id: prospect.prospect_id, business_name: "X" };
        },
      };
    }
    if (id === "../../lib/store") {
      return {
        select: async () => ({ ok: true, data: [{ prospect_id: "p1", business_name: "X" }] }),
      };
    }
    return original.apply(this, arguments);
  };
  delete require.cache[require.resolve("../api/admin/build-preview.js")];
  const handler = require("../api/admin/build-preview.js");
  Module.prototype.require = original;
  Module._resolveFilename = resolveFilename;
  return handler;
}

function fakeReqRes(body) {
  // A REAL Readable: readRawBody consumes the request as a stream, so a plain
  // object with an .on() shim silently yields an empty body and the handler
  // never reaches buildPreviewForProspect.
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = "POST";
  req.headers = {
    "x-admin-token": process.env.GHOST_AGENCY_ADMIN_TOKEN,
    "content-type": "application/json",
  };
  const res = {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload; },
    writeHead(code) { this.statusCode = code; return this; },
  };
  return { req, res };
}

test("build-preview forwards freshDispatch so an operator can force a rebuild", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token-fresh-dispatch";
  const captured = {};
  const handler = loadHandlerWithStub(captured);

  const { req, res } = fakeReqRes({ prospectId: "p1", freshDispatch: true });
  await handler(req, res);
  assert.equal(captured.options?.freshDispatch, true, "freshDispatch must reach buildPreviewForProspect");

  const second = fakeReqRes({ prospectId: "p1", forceFreshDispatch: true });
  await handler(second.req, second.res);
  assert.equal(captured.options?.freshDispatch, true, "forceFreshDispatch is accepted as an alias");

  const third = fakeReqRes({ prospectId: "p1" });
  await handler(third.req, third.res);
  assert.equal(captured.options?.freshDispatch, false, "default stays resume-based, so normal builds are unaffected");
});
