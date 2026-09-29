"use strict";

const assert = require("node:assert/strict");
const {
  isShimmerRescue,
  shimmerCss,
  injectBeforeHeadEnd,
  applyShimmer,
  rescueComplexEdits,
} = require("../lib/complex-edit-rescue");

(async () => {
  const capabilityJob = {
    job_id: "edit_shimmer_1",
    site_slug: "demo-hvac",
    instruction: "make my hero text shimmer with a shine effect going through it",
    status: "refused",
    updated_at: new Date().toISOString(),
    result: {
      reason: "shimmer/shine text animation not achievable with static style_override",
      say: "I can't add an animated shimmer effect.",
    },
  };
  assert.equal(isShimmerRescue(capabilityJob), true);
  assert.equal(isShimmerRescue({
    ...capabilityJob,
    result: { reason: "unsourced licensed and insured claim" },
  }), false, "truth/safety refusals must never enter rescue");
  assert.equal(isShimmerRescue({
    ...capabilityJob,
    instruction: "make the footer shimmer",
  }), false, "the rescue is deliberately limited to hero text");

  const css = shimmerCss("edit_a/b");
  assert.match(css, /@keyframes wss-riley-shimmer-edit_a-b/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /section#top h1/);
  const injected = injectBeforeHeadEnd("<html><head><title>x</title></head><body></body></html>", css, "edit_a/b");
  assert.match(injected, /data-wss-complex-rescue="edit_a\/b"/);
  assert.equal(injectBeforeHeadEnd(injected, css, "edit_a/b"), injected, "same job is idempotent");

  const archive = {
    "index.html": Buffer.from("<html><head></head><body><div id=\"root\"></div></body></html>"),
    "assets/index-demo.js": Buffer.from('const hero={id:"top",children:"Demo Heating"};'),
  };
  const uploads = [];
  const deploys = [];
  const applied = await applyShimmer(capabilityJob, {
    resolveSiteEditTarget: async () => ({ projectName: "demo-project", aliasHost: "demo-hvac.wss-ai.com" }),
    listAll: async () => Object.keys(archive),
    download: async (_slug, rel) => Buffer.from(archive[rel]),
    upload: async (_slug, rel, buf) => {
      archive[rel] = Buffer.from(buf);
      uploads.push(rel);
    },
    vercelDeploy: async ({ files, projectName, aliasHost }) => {
      deploys.push({ index: files["index.html"].toString("utf8"), projectName, aliasHost });
      return { url: "demo-deploy.vercel.app", alias: aliasHost };
    },
    liveHasMarker: async () => true,
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.rescued, true);
  assert.deepEqual(applied.changedFiles, ["index.html"]);
  assert.deepEqual(uploads, ["index.html"]);
  assert.equal(deploys.length, 1);
  assert.match(archive["index.html"].toString("utf8"), /wss-complex-rescue edit_shimmer_1/);

  // A live verification failure must deploy the exact original bytes back and
  // must NOT persist the proposed bytes to the source archive.
  const original = Buffer.from("<html><head></head><body></body></html>");
  const rollbackArchive = {
    "index.html": Buffer.from(original),
    "assets/index-demo.js": Buffer.from('const hero={id:"top"};'),
  };
  const rollbackDeploys = [];
  await assert.rejects(() => applyShimmer(capabilityJob, {
    resolveSiteEditTarget: async () => ({ projectName: "demo-project", aliasHost: "demo-hvac.wss-ai.com" }),
    listAll: async () => Object.keys(rollbackArchive),
    download: async (_slug, rel) => Buffer.from(rollbackArchive[rel]),
    upload: async (_slug, rel, buf) => { rollbackArchive[rel] = Buffer.from(buf); },
    vercelDeploy: async ({ files }) => {
      rollbackDeploys.push(files["index.html"].toString("utf8"));
      return { url: "demo-deploy.vercel.app", alias: "demo-hvac.wss-ai.com" };
    },
    liveHasMarker: async () => false,
  }), /did not serve the rescue marker/);
  assert.equal(rollbackDeploys.length, 2, "proposed deploy + rollback deploy");
  assert.match(rollbackDeploys[0], /wss-complex-rescue/);
  assert.equal(rollbackDeploys[1], original.toString("utf8"));
  assert.equal(rollbackArchive["index.html"].toString("utf8"), original.toString("utf8"));

  // Pin the production PostgREST edge: a conditional PATCH can apply and still
  // report updated:false. The one-shot claim token read-back proves ownership.
  const row = JSON.parse(JSON.stringify(capabilityJob));
  const writes = [];
  const rescued = await rescueComplexEdits({
    max: 1,
    deps: {
      select: async (_table, query) => {
        if (query.startsWith("status=eq.refused")) return { ok: true, data: row.status === "refused" ? [row] : [] };
        return { ok: true, data: [row] };
      },
      conditionalUpdate: async (_table, _key, _value, _filters, patch) => {
        row.status = patch.status;
        row.result = patch.result;
        row.updated_at = patch.updated_at;
        return { ok: true, updated: false };
      },
      upsertRow: async (_table, patch) => {
        Object.assign(row, patch);
        writes.push(patch);
        return { ok: true };
      },
      recordEvent: async () => ({ ok: true }),
      resolveSiteEditTarget: async () => ({ projectName: "demo-project", aliasHost: "demo-hvac.wss-ai.com" }),
      listAll: async () => ["index.html", "assets/index-demo.js"],
      download: async (_slug, rel) => rel === "index.html"
        ? Buffer.from("<html><head></head><body></body></html>")
        : Buffer.from('const hero={id:"top"};'),
      upload: async () => {},
      vercelDeploy: async () => ({ url: "demo-deploy.vercel.app", alias: "demo-hvac.wss-ai.com" }),
      liveHasMarker: async () => true,
    },
  });
  assert.equal(rescued.rescued, 1);
  assert.equal(row.status, "done");
  assert.equal(writes.at(-1).status, "done");

  console.log("complex-edit-rescue tests OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
