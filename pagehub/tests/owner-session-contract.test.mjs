import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const handler = require(join(repoRoot, "api", "owner-session.js"));
const { OWNER_SESSION_TTL_SECONDS } = require(join(repoRoot, "api", "lib", "provider-route-auth.js"));

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    return require("C:\\Users\\Main\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright");
  }
}

function captureResponse() {
  const headers = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { return { status: this.statusCode, body, headers }; },
    end(body = "") { return { status: this.statusCode, body, headers }; },
  };
  return { response, headers };
}

async function invoke({ method = "GET", body, cookie = "", remoteAddress } = {}) {
  const { response, headers } = captureResponse();
  let result;
  response.json = function json(value) {
    result = { status: this.statusCode, body: value, headers };
    return result;
  };
  response.end = function end(value = "") {
    result = { status: this.statusCode, body: value, headers };
    return result;
  };
  await handler({ method, headers: cookie ? { cookie } : {}, body,
    socket: remoteAddress ? { remoteAddress } : undefined }, response);
  return result;
}

test("owner login mints only a token-authenticated hardened HttpOnly cookie", async () => {
  const previous = process.env.PAGEHUB_OWNER_TOKEN;
  process.env.PAGEHUB_OWNER_TOKEN = "scoped-owner-fixture-token";
  try {
    const wrong = await invoke({ method: "POST", body: { token: "wrong" } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.has("set-cookie"), false);

    for (const remoteAddress of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      const unauthenticated = await invoke({ remoteAddress });
      assert.deepEqual(unauthenticated.body, { ok: true, authenticated: false });
      assert.equal(unauthenticated.headers.has("set-cookie"), false);
    }

    const login = await invoke({ method: "POST", body: { token: "scoped-owner-fixture-token" } });
    assert.equal(login.status, 200);
    assert.deepEqual(login.body, { ok: true, authenticated: true, expires_in_seconds: OWNER_SESSION_TTL_SECONDS });
    const setCookie = login.headers.get("set-cookie");
    assert.match(setCookie, /^__Host-pagehub_owner_session=[A-Za-z0-9_.-]+;/);
    assert.match(setCookie, new RegExp(`Path=/; Max-Age=${OWNER_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict$`));
    assert.doesNotMatch(setCookie, /scoped-owner-fixture-token/);

    const cookie = setCookie.split(";", 1)[0];
    const check = await invoke({ cookie });
    assert.deepEqual(check.body, { ok: true, authenticated: true });

    const tampered = await invoke({ cookie: `${cookie}x` });
    assert.deepEqual(tampered.body, { ok: true, authenticated: false });

    const logout = await invoke({ method: "DELETE", cookie });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0; HttpOnly; Secure; SameSite=Strict$/);
  } finally {
    if (previous === undefined) delete process.env.PAGEHUB_OWNER_TOKEN;
    else process.env.PAGEHUB_OWNER_TOKEN = previous;
  }
});

test("owner UI uses first-party credentialed session fetches and never embeds or stores either token", async () => {
  const html = await readFile(join(repoRoot, "index.html"), "utf8");
  for (const route of [
    "/api/brightdata-serp-audit",
    "/api/google-places-intake",
    "/api/firecrawl-intake",
    "/api/compile-build-packet",
    "/api/send-intake-packet",
  ]) {
    assert.match(html, new RegExp(`ownerFetch\\(\\"${route.replaceAll("/", "\\/")}\\"`));
  }
  assert.match(html, /fetch\(apiEndpoint\("\/api\/owner-session"\)/);
  const signIn = html.slice(html.indexOf("async function establishOwnerSession"), html.indexOf("async function ensureOwnerSession"));
  assert.match(signIn, /ownerLoginDialog\(\)/);
  assert.doesNotMatch(signIn, /window\.prompt\s*\(/);
  assert.match(html, /credentials:\s*"same-origin"/);
  assert.doesNotMatch(html, /STABLE_API_ORIGIN/);
  assert.doesNotMatch(html, /INTAKE_GENIE_TOKEN|PAGEHUB_OWNER_TOKEN/);
  assert.doesNotMatch(html, /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:owner|token|session)/i);
  const compileFunction = html.slice(
    html.indexOf("async function compileBuildNow"),
    html.indexOf("async function latestCompiledPacket")
  );
  const failureBranch = compileFunction.slice(compileFunction.indexOf("} catch (error)"));
  assert.match(failureBranch, /state\.packet\s*=\s*null/);
  assert.match(failureBranch, /Nothing was marked ready or made sendable/);
  assert.doesNotMatch(failureBranch, /stampPacketState\([^)]*Compiled - ready for admin/);
  assert.doesNotMatch(html, /using local long-form fallback/i);

  const compiledGuard = html.slice(
    html.indexOf("function isCompiledPacket"),
    html.indexOf("function draftChangedSinceCompile")
  );
  assert.match(compiledGuard, /compileJob\?\.status\s*===\s*"complete"/);
  assert.match(compiledGuard, /&&\s*packet\?\.compiled\?\.compileJob\?\.mode\s*===\s*"backend-full-package-compiler"/);
  assert.doesNotMatch(compiledGuard, /preflight\?\.compileState/);

  const localCompiler = html.slice(
    html.indexOf("compileJob: {"),
    html.indexOf("contentFiles,", html.indexOf("compileJob: {"))
  );
  assert.match(localCompiler, /status:\s*"local_draft"/);
  assert.match(localCompiler, /mode:\s*"local-full-package-compiler"/);
  assert.doesNotMatch(localCompiler, /status:\s*"complete"/);

  const compileStart = compileFunction.slice(0, compileFunction.indexOf("try {"));
  assert.ok(compileStart.indexOf('state.compiledSignature = ""') < compileStart.indexOf("generatePacket(false)"));
  assert.ok(compileStart.indexOf("saveDraft(false)") < compileStart.indexOf("generatePacket(false)"));
  assert.match(compileFunction, /state\.packet\s*=\s*stampPacketState\(result\.packet,\s*"Compiled - ready for admin"\)/);

  const latestGuard = html.slice(
    html.indexOf("async function latestCompiledPacket"),
    html.indexOf("function promotePacketState")
  );
  assert.match(latestGuard, /if \(isCompiledPacket\(packet\)\) return packet/);

  const downloadPacketGuard = html.slice(
    html.indexOf("async function downloadPacket"),
    html.indexOf("async function downloadClientForm")
  );
  assert.match(downloadPacketGuard, /await hasLiveOwnerSession\(\)/);
  assert.match(downloadPacketGuard, /draftChangedSinceCompile\(\)/);
  assert.doesNotMatch(downloadPacketGuard, /isAdminMode\(\)/);

  const downloadFormGuard = html.slice(
    html.indexOf("async function downloadClientForm"),
    html.indexOf("async function sendPacketToAdmin")
  );
  assert.match(downloadFormGuard, /await hasLiveOwnerSession\(\)/);
  assert.doesNotMatch(downloadFormGuard, /isAdminMode\(\)/);

  const readiness = html.slice(
    html.indexOf("function updateReadiness"),
    html.indexOf("function icon", html.indexOf("function updateReadiness"))
  );
  assert.match(readiness, /updateSendButtonState\(\)/);
});

async function withOwnerUi(t, run) {
  const { chromium } = loadPlaywright();
  const html = await readFile(join(repoRoot, "index.html"), "utf8");
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/?admin=1`, { waitUntil: "domcontentloaded" });
  return run(page);
}

test("a field edit after compile disables download and creates no packet blob", async t => {
  const result = await withOwnerUi(t, page => page.evaluate(async () => {
    let blobs = 0;
    let downloads = 0;
    let sessionChecks = 0;
    fetch = async path => {
      if (!String(path).includes("/api/owner-session")) throw new Error(`unexpected fetch: ${path}`);
      sessionChecks += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, authenticated: true }) };
    };
    makeZip = () => { blobs += 1; return {}; };
    downloadBlob = () => { downloads += 1; };

    const packet = generatePacket(false);
    packet.compiled.compileJob = {
      ...(packet.compiled.compileJob || {}),
      status: "complete",
      mode: "backend-full-package-compiler"
    };
    state.packet = packet;
    state.compiledSignature = currentDraftSignature();
    updateSendButtonState();
    const beforeEditDisabled = document.querySelector("#downloadPacketBtn").disabled;
    const businessName = document.querySelector('[data-field="businessName"]');
    businessName.value = `${businessName.value} changed`;
    businessName.dispatchEvent(new Event("input", { bubbles: true }));
    const afterEditDisabled = document.querySelector("#downloadPacketBtn").disabled;

    await downloadPacket();
    return { beforeEditDisabled, afterEditDisabled, blobs, downloads, sessionChecks };
  }));

  assert.equal(result.beforeEditDisabled, false);
  assert.equal(result.afterEditDisabled, true, "input handlers must refresh stale-download readiness");
  assert.equal(result.sessionChecks, 1);
  assert.equal(result.blobs, 0, "stale compiled packets must not create a ZIP blob");
  assert.equal(result.downloads, 0, "stale compiled packets must not download");
});

test("an expired owner session creates no packet or client-form blobs", async t => {
  const result = await withOwnerUi(t, page => page.evaluate(async () => {
    let blobs = 0;
    let downloads = 0;
    let sessionChecks = 0;
    const NativeBlob = Blob;
    Blob = class CountingBlob extends NativeBlob {
      constructor(...args) {
        blobs += 1;
        super(...args);
      }
    };
    makeZip = () => { blobs += 1; return {}; };
    downloadBlob = () => { downloads += 1; };
    fetch = async path => {
      if (!String(path).includes("/api/owner-session")) throw new Error(`unexpected fetch: ${path}`);
      sessionChecks += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, authenticated: false }) };
    };

    const packet = generatePacket(false);
    packet.compiled.compileJob = {
      ...(packet.compiled.compileJob || {}),
      status: "complete",
      mode: "backend-full-package-compiler"
    };
    state.packet = packet;
    state.compiledSignature = currentDraftSignature();

    await downloadPacket();
    await downloadClientForm();
    return { blobs, downloads, sessionChecks };
  }));

  assert.equal(result.sessionChecks, 2, "each download must revalidate the live owner session");
  assert.equal(result.blobs, 0, "expired sessions must not create either download blob");
  assert.equal(result.downloads, 0, "expired sessions must not download either artifact");
});

test("local compiler mode cannot enable send or download in the owner UI", async t => {
  const { chromium } = loadPlaywright();
  const html = await readFile(join(repoRoot, "index.html"), "utf8");
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  });

  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/?admin=1`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    let fetchCalls = 0;
    let downloads = 0;
    window.fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized." }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    };
    window.prompt = () => null;
    downloadBlob = () => { downloads += 1; };

    const localPacket = generatePacket(false);
    state.compiledSignature = currentDraftSignature();
    state.lastCompiledAt = new Date().toISOString();
    updateSendButtonState();
    const beforeActions = {
      mode: localPacket.compiled.compileJob.mode,
      status: localPacket.compiled.compileJob.status,
      readiness: localPacket.readiness.status,
      preflight: localPacket.readiness.preflight.status,
      compiled: isCompiledPacket(localPacket),
      score: compiledPackageScore(localPacket),
      sendDisabled: document.querySelector("#emailPacketBtn").disabled,
      downloadDisabled: document.querySelector("#downloadPacketBtn").disabled,
    };

    await emailPacket();
    const fetchesAfterSendAttempt = fetchCalls;
    await downloadPacket();
    return { beforeActions, fetchesAfterSendAttempt, fetchCalls, downloads };
  });

  assert.deepEqual(result.beforeActions, {
    mode: "local-full-package-compiler",
    status: "local_draft",
    readiness: "Needs review",
    preflight: "backend_compile_required",
    compiled: false,
    score: 0,
    sendDisabled: true,
    downloadDisabled: true,
  });
  assert.equal(result.fetchesAfterSendAttempt, 0, "local packet must not reach the send provider");
  assert.equal(result.fetchCalls, 1, "download may only attempt the backend compiler");
  assert.equal(result.downloads, 0, "local packet must never be downloaded as compiled");
});
