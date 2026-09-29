"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { vercelDeploy } = require("../lib/forge");

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = {
  VERCEL_TOKEN: process.env.VERCEL_TOKEN,
  VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
  VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  VERCEL_PROJECT_NAME: process.env.VERCEL_PROJECT_NAME,
};

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function installFetch({
  resolvedProjectId = "prj_customer",
  resolvedProjectName = "customer-site",
  deployedProjectId = resolvedProjectId,
  domainStatus = 200,
  existingDomainProjectId = resolvedProjectId,
  aliasStatus = 200,
  aliases = [],
} = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    const href = String(url);
    calls.push({ href, method, body: options.body || null });

    if (href.includes("/v11/projects?") && method === "POST") {
      return response(409, { error: { code: "project_already_exists" } });
    }
    if (href.includes("/v9/projects/customer-site?") && method === "GET") {
      return response(200, { id: resolvedProjectId, name: resolvedProjectName });
    }
    if (href.includes("/v2/files?") && method === "POST") {
      return response(200, {});
    }
    if (href.includes("/v13/deployments?") && method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.name, "customer-site");
      assert.equal(body.project, resolvedProjectId);
      assert.equal(body.target, "production");
      return response(200, {
        id: "dpl_customer",
        url: "customer-site-abc-wss-labs.vercel.app",
        readyState: "READY",
        projectId: deployedProjectId,
      });
    }
    if (href.includes(`/v10/projects/${resolvedProjectId}/domains?`) && method === "POST") {
      return response(domainStatus, domainStatus === 200 ? {} : { error: { code: "domain_conflict" } });
    }
    if (
      href.includes(`/v9/projects/${resolvedProjectId}/domains/customer-site.wss-ai.com?`)
      && method === "GET"
    ) {
      return response(200, { name: "customer-site.wss-ai.com", projectId: existingDomainProjectId });
    }
    if (href.includes("/v2/deployments/dpl_customer/aliases?") && method === "POST") {
      return response(aliasStatus, aliasStatus === 200 ? {} : { error: { code: "alias_conflict" } });
    }
    if (href.includes("/v2/deployments/dpl_customer/aliases?") && method === "GET") {
      return response(200, { aliases });
    }
    throw new Error(`Unexpected fetch: ${method} ${href}`);
  };
  return calls;
}

test.beforeEach(() => {
  process.env.VERCEL_TOKEN = "test-token";
  process.env.VERCEL_TEAM_ID = "team_test";
  process.env.VERCEL_PROJECT_ID = "prj_WHDPMZW56KiNFpcKt8DGgsUdxwyU";
  process.env.VERCEL_PROJECT_NAME = "ghost-agency-backend";
});

test.afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("rejects the backend project before any Vercel request", async () => {
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error("must not fetch");
  };

  await assert.rejects(
    vercelDeploy({
      files: { "index.html": Buffer.from("safe") },
      projectName: "ghost-agency-backend",
      aliasHost: "customer-site.wss-ai.com",
    }),
    /Refusing to deploy customer files/
  );
  assert.equal(called, false);
});

test("binds the deployment and alias to the resolved customer project ID", async () => {
  const calls = installFetch();
  const result = await vercelDeploy({
    files: { "index.html": Buffer.from("safe") },
    projectName: "customer-site",
    aliasHost: "customer-site.wss-ai.com",
  });

  assert.deepEqual(result, {
    url: "https://customer-site-abc-wss-labs.vercel.app",
    alias: "https://customer-site.wss-ai.com",
  });
  assert.equal(calls.some((call) => call.method === "PATCH"), false);
  assert.equal(calls.some((call) => String(call.body).includes("ssoProtection")), false);
});

test("accepts mirrorBuild file arrays at the Vercel upload boundary", async () => {
  const calls = installFetch();
  const result = await vercelDeploy({
    files: [{ file: "index.html", bytes: Buffer.from("mirror-safe") }],
    projectName: "customer-site",
    aliasHost: "customer-site.wss-ai.com",
  });

  assert.equal(result.alias, "https://customer-site.wss-ai.com");
  const deployment = calls.find((call) => call.href.includes("/v13/deployments?"));
  const manifest = JSON.parse(deployment.body).files;
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].file, "index.html");
  assert.equal(manifest[0].size, Buffer.byteLength("mirror-safe"));
});

test("fails before domain work when Vercel associates the deployment with another project", async () => {
  const calls = installFetch({
    deployedProjectId: "prj_WHDPMZW56KiNFpcKt8DGgsUdxwyU",
  });

  await assert.rejects(
    vercelDeploy({
      files: { "index.html": Buffer.from("safe") },
      projectName: "customer-site",
      aliasHost: "customer-site.wss-ai.com",
    }),
    /unexpected project/
  );
  assert.equal(calls.some((call) => call.href.includes("/domains?")), false);
  assert.equal(calls.some((call) => call.href.includes("/aliases?")), false);
});

test("accepts an alias conflict only when the same deployment already owns the alias", async () => {
  installFetch({
    domainStatus: 409,
    aliasStatus: 409,
    aliases: [{ alias: "customer-site.wss-ai.com" }],
  });

  const result = await vercelDeploy({
    files: { "index.html": Buffer.from("safe") },
    projectName: "customer-site",
    aliasHost: "customer-site.wss-ai.com",
  });
  assert.equal(result.alias, "https://customer-site.wss-ai.com");
});

test("fails the deploy stage when alias assignment is not proven", async () => {
  installFetch({ aliasStatus: 409, aliases: [] });

  await assert.rejects(
    vercelDeploy({
      files: { "index.html": Buffer.from("safe") },
      projectName: "customer-site",
      aliasHost: "customer-site.wss-ai.com",
    }),
    /alias assignment failed: alias_conflict/
  );
});

test("fails before aliasing when the domain belongs to another project", async () => {
  const calls = installFetch({
    domainStatus: 409,
    existingDomainProjectId: "prj_other_customer",
  });

  await assert.rejects(
    vercelDeploy({
      files: { "index.html": Buffer.from("safe") },
      projectName: "customer-site",
      aliasHost: "customer-site.wss-ai.com",
    }),
    /domain assignment failed: domain_conflict/
  );
  assert.equal(
    calls.some((call) => call.method === "POST" && call.href.includes("/aliases?")),
    false
  );
});
