import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pollVercelDeployment, publishToVercel, verifyPublicPublishArtifacts } from "../lib/engine-adapter.mjs";

const MIB = 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function withVercelConfig(work) {
  const beforeToken = process.env.SITEFORGE_VERCEL_TOKEN;
  const beforeTeam = process.env.SITEFORGE_VERCEL_TEAM_ID;
  process.env.SITEFORGE_VERCEL_TOKEN = "test-token";
  process.env.SITEFORGE_VERCEL_TEAM_ID = "team_test";
  return Promise.resolve()
    .then(work)
    .finally(() => {
      if (beforeToken === undefined) delete process.env.SITEFORGE_VERCEL_TOKEN;
      else process.env.SITEFORGE_VERCEL_TOKEN = beforeToken;
      if (beforeTeam === undefined) delete process.env.SITEFORGE_VERCEL_TEAM_ID;
      else process.env.SITEFORGE_VERCEL_TEAM_ID = beforeTeam;
    });
}

test("customer publisher uploads a 4 MiB asset and verifies READY preview and report artifacts", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "siteforge-vercel-publisher-"));
  const originalFetch = globalThis.fetch;
  const uploads = [];
  const requests = [];
  try {
    writeFileSync(path.join(dir, "index.html"), "<main>Preview</main>");
    writeFileSync(path.join(dir, "hero.bin"), Buffer.alloc(4 * MIB));
    writeFileSync(path.join(dir, "qc-report.html"), "<main>Report</main>");
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/v2/files")) {
        uploads.push({ length: Number(init.headers["Content-Length"]), digest: init.headers["x-vercel-digest"] });
        return json({});
      }
      if (url.includes("/v13/deployments?") && init.method === "POST") {
        const body = JSON.parse(init.body);
        assert.ok(body.files.some((file) => file.file === "hero.bin" && file.size === 4 * MIB));
        assert.ok(body.files.some((file) => file.file === "qc-report.html"));
        return json({ id: "dpl_customer", url: "customer-preview.vercel.app" });
      }
      if (url.includes("/v13/deployments/dpl_customer")) return json({ id: "dpl_customer", url: "customer-preview.vercel.app", readyState: "READY" });
      if (url === "https://customer-preview.vercel.app/" || url === "https://customer-preview.vercel.app/qc-report.html") return new Response("ok", { status: 200 });
      if (url.includes("/v9/projects/")) return json({});
      throw new Error(`Unexpected request: ${url}`);
    };

    const result = await withVercelConfig(() => publishToVercel({ slug: "customer-preview" }, { site_dir: dir }));
    assert.equal(result.skipped, false);
    assert.equal(result.url, "https://customer-preview.vercel.app");
    assert.equal(result.preview_url, "https://customer-preview.vercel.app/");
    assert.equal(result.report_url, "https://customer-preview.vercel.app/qc-report.html");
    assert.ok(uploads.some((upload) => upload.length === 4 * MIB && upload.digest));
    assert.ok(requests.includes("https://customer-preview.vercel.app/"));
    assert.ok(requests.includes("https://customer-preview.vercel.app/qc-report.html"));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("customer publisher fails closed on a Vercel ERROR state or timeout", async () => {
  await assert.rejects(
    pollVercelDeployment({ deploymentId: "dpl_error", teamId: "team_test", token: "test", fetchImpl: async () => json({ readyState: "ERROR" }) }),
    /ended in ERROR/,
  );
  await assert.rejects(
    pollVercelDeployment({ deploymentId: "dpl_timeout", teamId: "team_test", token: "test", timeoutMs: 0, fetchImpl: async () => json({ readyState: "BUILDING" }) }),
    /timed out/,
  );
});

test("customer publisher rejects missing or unreachable report artifacts", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "siteforge-vercel-publisher-"));
  try {
    writeFileSync(path.join(dir, "index.html"), "<main>Preview</main>");
    await assert.rejects(
      withVercelConfig(() => publishToVercel({ slug: "customer-preview" }, { site_dir: dir })),
      /qc-report\.html is missing/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  await assert.rejects(
    verifyPublicPublishArtifacts({ url: "https://customer-preview.vercel.app", timeoutMs: 0, fetchImpl: async () => new Response("not found", { status: 404 }) }),
    /public artifact is not reachable/,
  );
});
