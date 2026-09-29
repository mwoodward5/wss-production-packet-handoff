"use strict";

const { boundedDetailText } = require("../detail-text");
const lineTelemetry = require("../line-telemetry");

// lib/mirror-engine/deploy.js — Vercel deploy path with ALIAS LAST.
//
// Order is the contract: upload (file-hash dedup) -> deploy -> wait READY ->
// byte-diff against the DEPLOY_ID URL -> deep-link test -> only then alias.
// An identity failure after aliasing means briefly serving another company's
// identity on the prospect's future URL; before aliasing it means nothing —
// the deployment URL is unguessable and never persisted.
//
// Quota facts that shape this file (review "unique discoveries"):
//  - Upload quota is load-bearing: 102 files x 1000 mirrors/day = 102,000
//    uploads vs Pro cap 40,000/day. The x-vercel-digest 409 ("already have
//    it") is the dedup that keeps media/fonts/vendor chunks free — donors must
//    concentrate tokens into as few files as possible so the rest hash stable.
//  - Burst ceiling: 120 deployments per 5 minutes on Pro. The throttle below
//    delays instead of 429ing the caller; instance-local, best effort.
//  - `_acme-challenge` on the reserved denylist: Vercel wildcard TLS uses that
//    label — one colliding slug breaks cert renewal for EVERY mirror at once.

const { createHash } = require("node:crypto");

const APEX = "wss-ai.com";
const CHECKPOINT_RESERVE_MS = 30_000;
const DEFAULT_UPLOAD_CONCURRENCY = 12;
const MAX_UPLOAD_CONCURRENCY = 24;
const UPLOAD_CONCURRENCY_ENV = "MIRROR_UPLOAD_CONCURRENCY";

function uploadConcurrency(value = process.env[UPLOAD_CONCURRENCY_ENV]) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_UPLOAD_CONCURRENCY;
  return Math.min(parsed, MAX_UPLOAD_CONCURRENCY);
}

function abortError(reason = "mirror operation aborted") {
  const error = new Error(reason instanceof Error ? reason.message : boundedDetailText(reason));
  error.name = "AbortError";
  return error;
}

function remainingBudget(deadlineAt, reserveMs = CHECKPOINT_RESERVE_MS) {
  const deadline = Number(deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= 0) return Number.POSITIVE_INFINITY;
  return deadline - Date.now() - Math.max(CHECKPOINT_RESERVE_MS, Number(reserveMs) || 0);
}

/** Compose a caller abort, its deadline and a step-local timeout. The earliest
 * boundary always wins, so adding orchestration can never widen an old limit. */
function composeAbortSignal({ signal, deadlineAt, timeoutMs, reserveMs = CHECKPOINT_RESERVE_MS } = {}) {
  if (signal && signal.aborted) return signal;
  const remaining = remainingBudget(deadlineAt, reserveMs);
  const local = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : Number.POSITIVE_INFINITY;
  const waitMs = Math.min(remaining, local);
  if (!signal && !Number.isFinite(waitMs)) return undefined;
  if (waitMs <= 0) return AbortSignal.abort(abortError("mirror deadline reached before checkpoint reserve"));
  const signals = signal ? [signal] : [];
  if (Number.isFinite(waitMs)) {
    signals.push(AbortSignal.timeout(Math.min(2_147_483_647, Math.max(1, Math.ceil(waitMs)))));
  }
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

function fetchOptions(options = {}, limits = {}) {
  return { ...options, signal: composeAbortSignal({ ...limits, signal: limits.signal || options.signal }) };
}

async function abortableDelay(delayMs, limits = {}) {
  const signal = composeAbortSignal(limits);
  if (signal && signal.aborted) throw abortError(signal.reason);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, delayMs));
    if (!signal) return;
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(abortError(signal.reason));
    }, { once: true });
  });
}

// Slugs that may never become {slug}.wss-ai.com. Infrastructure labels first
// (the schema's ^[a-z0-9] already blocks _acme-challenge as a SLUG, but the
// denylist guards the ALIAS layer, where hosts can arrive from other paths).
const RESERVED_SLUGS = new Set([
  "_acme-challenge", "www", "api", "app", "admin", "ghost", "mail", "smtp",
  "imap", "pop", "mx", "webmail", "autodiscover", "autoconfig", "ns1", "ns2",
  "dns", "cdn", "assets", "static", "status", "staging", "dev", "test",
  "dashboard", "console", "callprep", "siteforge", "stripe", "billing",
  "support", "help", "docs", "blog", "vercel", "root", "localhost",
]);

function slugPolicy(slug) {
  const s = String(slug || "").toLowerCase();
  if (RESERVED_SLUGS.has(s)) return { ok: false, reason: "reserved_slug" };
  if (s.startsWith("_")) return { ok: false, reason: "reserved_prefix" };
  // Test namespace gate: until the owner approves real slugs, only wss-test-*
  // may deploy or alias. Flip with MIRROR_ALLOW_REAL_SLUGS=1 (owner action).
  const allowReal = String(process.env.MIRROR_ALLOW_REAL_SLUGS || "").trim() === "1";
  if (!allowReal && !s.startsWith("wss-test-")) {
    return { ok: false, reason: "test_namespace_only" };
  }
  return { ok: true };
}

function aliasHostFor(slug) {
  return `${String(slug).toLowerCase()}.${APEX}`;
}

// ---------------------------------------------------------------------------
// Deploy throttle — 120 deployments / 5 minutes (Pro), instance-local.
// ---------------------------------------------------------------------------
const WINDOW_MS = 5 * 60 * 1000;
const WINDOW_MAX = 110; // headroom under the 120 ceiling for other lanes
const recentDeploys = [];

async function throttleDeploy(now = Date.now(), limits = {}) {
  while (recentDeploys.length && recentDeploys[0] <= now - WINDOW_MS) recentDeploys.shift();
  if (recentDeploys.length >= WINDOW_MAX) {
    const waitMs = recentDeploys[0] + WINDOW_MS - now;
    await abortableDelay(Math.max(50, waitMs), limits);
    return throttleDeploy(Date.now(), limits);
  }
  recentDeploys.push(now);
}

// ---------------------------------------------------------------------------
// vercel.json SPA rewrite (canonical, injected when the donor ships none)
// ---------------------------------------------------------------------------
// Raw Vite dist 404s on every deep link — a symptom identical to the missing-
// chunk bug and easy to misdiagnose. Vercel applies rewrites AFTER the
// filesystem check, so the catch-all can never shadow a real asset; the
// deep-link verification below asserts both directions anyway.
// cleanUrls is load-bearing, not cosmetic: the engine ships real authority
// pages as about.html / service-areas.html / faq.html / team.html, and their
// canonicals and internal links are extensionless. Without cleanUrls the
// blanket catch-all swallows /about and serves the SPA shell — so every
// authority page was a soft-404 while the manifest reported it as shipped.
// A manifest that misreports what is served is the exact class of defect this
// engine exists to end, so the rewrite and cleanUrls travel together.
// Accepts either a flat array of routes (legacy callers) or the shape
// lib/mirror-engine/routes.js derives: { exact:[…], prefixes:[…] }. A route in
// `prefixes` also claims its CHILDREN (`/services/roof-repair`); a route in
// `exact` claims only itself.
function normalizeRoutes(spaRoutes) {
  if (Array.isArray(spaRoutes)) {
    const exact = [];
    const prefixes = [];
    for (const r of spaRoutes) {
      if (typeof r !== "string" || !r.startsWith("/")) continue;
      if (r.endsWith("/*")) prefixes.push(r.slice(0, -2));
      else exact.push(r);
    }
    return { exact, prefixes };
  }
  const o = spaRoutes || {};
  return {
    exact: (o.exact || []).filter((r) => typeof r === "string" && r.startsWith("/")),
    prefixes: (o.prefixes || []).filter((r) => typeof r === "string" && r.startsWith("/")),
  };
}

function spaVercelJson(spaRoutes = []) {
  // cleanUrls 308-REDIRECTS /index.html -> /, so a rewrite whose destination
  // is "/index.html" dead-ends and every SPA path falls through to 404.html —
  // which 404'd all five nav links and blocked every build from aliasing.
  // The destination must be "/" once cleanUrls is on. Proven with two probes:
  // /index.html => 308, /any-spa-route => 404 before this fix.
  // Real files win first (Vercel checks the filesystem before rewrites), so
  // /about -> about.html via cleanUrls. Then each route the mirror actually
  // HAS is rewritten to the SPA shell.
  //
  // THERE IS NO CATCH-ALL FALLBACK ANY MORE. `{"source":"/(.*)"}` answered 200
  // to every URL on every mirror ever deployed from this lane: unknown paths
  // soft-404'd with a shell body, and eight distinct footer links plus
  // /services all resolved to the identical rewrite. An empty route set now
  // means a purely static donor, where a real 404 is the correct answer.
  const { exact, prefixes } = normalizeRoutes(spaRoutes);
  const rewrites = [
    ...prefixes.map((r) => ({ source: r, destination: "/" })),
    ...prefixes.map((r) => ({ source: `${r}/(.*)`, destination: "/" })),
    ...exact.filter((r) => !prefixes.includes(r)).map((r) => ({ source: r, destination: "/" })),
  ];
  return Buffer.from(`${JSON.stringify({ cleanUrls: true, rewrites }, null, 2)}\n`, "utf8");
}

const SPA_VERCEL_JSON = spaVercelJson();

function withSpaRewrite(files, spaRoutes = []) {
  if (files["vercel.json"]) return files;
  return { ...files, "vercel.json": spaVercelJson(spaRoutes) };
}

// ---------------------------------------------------------------------------
// Vercel API steps (split so ALIAS LAST is structural, not a convention)
// ---------------------------------------------------------------------------
function vercelEnv() {
  const token = String(process.env.VERCEL_TOKEN || "").trim();
  const teamId = String(process.env.VERCEL_TEAM_ID || "").trim();
  if (!token || !teamId) throw new Error("VERCEL_TOKEN / VERCEL_TEAM_ID not configured");
  return { token, teamId, q: new URLSearchParams({ teamId }).toString(), auth: { Authorization: `Bearer ${token}` } };
}

const BACKEND_PROJECT_IDS = () => new Set([
  String(process.env.VERCEL_PROJECT_ID || "").trim(),
  "prj_WHDPMZW56KiNFpcKt8DGgsUdxwyU",
].filter(Boolean));
const BACKEND_PROJECT_NAMES = () => new Set([
  String(process.env.VERCEL_PROJECT_NAME || "").trim().toLowerCase(),
  "ghost-agency-backend",
].filter(Boolean));

async function ensureProject(projectName, limits = {}) {
  const { q, auth } = vercelEnv();
  const name = String(projectName || "").trim();
  if (!name) throw new Error("project name required");
  if (BACKEND_PROJECT_NAMES().has(name.toLowerCase())) {
    throw new Error("refusing to deploy customer files to the Ghost backend project");
  }
  const create = await fetch(`https://api.vercel.com/v11/projects?${q}`, fetchOptions({
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name, framework: null }),
  }, limits));
  if (!create.ok && create.status !== 409) {
    const err = await create.json().catch(() => ({}));
    throw new Error(`project ensure failed: ${(err.error && err.error.code) || create.status}`);
  }
  const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(name)}?${q}`, fetchOptions({ headers: auth }, limits));
  const project = await res.json().catch(() => ({}));
  if (!res.ok || !project.id) throw new Error(`project resolve failed: ${res.status}`);
  if (
    String(project.name || "").toLowerCase() !== name.toLowerCase()
    || BACKEND_PROJECT_IDS().has(project.id)
    || BACKEND_PROJECT_NAMES().has(String(project.name || "").toLowerCase())
  ) {
    throw new Error("resolved Vercel project is not the requested isolated customer project");
  }
  // New team projects default to SSO Deployment Protection on *.vercel.app
  // URLs ("all_except_custom_domains"). A customer mirror is a PUBLIC
  // marketing site, and the byte-diff/deep-link verification runs against the
  // deploy_id URL before any alias exists — behind the auth wall every path
  // returns the same interstitial page and verification fails closed (observed
  // live: uniform ~485KB bodies on the first E2E). Turn protection off
  // explicitly for the isolated customer project; the custom-domain alias is
  // public either way, so end-state exposure is unchanged.
  if (project.ssoProtection) {
    const unprotect = await fetch(`https://api.vercel.com/v9/projects/${project.id}?${q}`, fetchOptions({
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ ssoProtection: null }),
    }, limits));
    if (!unprotect.ok) {
      const err2 = await unprotect.json().catch(() => ({}));
      throw new Error(`disable deployment protection failed: ${(err2.error && err2.error.code) || unprotect.status}`);
    }
  }
  return project.id;
}

/** Upload with file-hash dedup: a 409/200 on x-vercel-digest means Vercel
 *  already holds those bytes — no quota spent. Returns the manifest + stats. */
async function uploadFiles(files, limits = {}) {
  const startedAt = Date.now();
  const { q, auth } = vercelEnv();
  const entries = Object.entries(files);
  const manifest = new Array(entries.length);
  let uploaded = 0;
  let deduped = 0;
  let cursor = 0;
  const width = Math.min(uploadConcurrency(), Math.max(1, entries.length));
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= entries.length) return;
      const [rel, buf] = entries[index];
      const sha = createHash("sha1").update(buf).digest("hex");
      const up = await fetch(`https://api.vercel.com/v2/files?${q}`, fetchOptions({
        method: "POST",
        headers: { ...auth, "Content-Type": "application/octet-stream", "x-vercel-digest": sha },
        body: buf,
      }, limits));
      if (up.ok) uploaded++;
      else if (up.status === 409) deduped++;
      else throw new Error(`file upload failed ${rel}: ${up.status}`);
      manifest[index] = { file: rel, sha, size: buf.length };
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()));
  const durationMs = Math.max(0, Date.now() - startedAt);
  if (process.env.VERCEL || process.env.GHOST_AGENCY_PHASE_LOGS === "true") {
    const uploadEvent = {
      event: "mirror_upload_batch",
      files: entries.length,
      uploaded,
      deduped,
      concurrency: width,
      duration_ms: durationMs,
    };
    // Observability volume valve (#596): `reduced` keeps only batches that
    // failed to account for every file — a fully-accounted upload is the
    // happy path. (Hard failures throw before this line already.)
    if (lineTelemetry.shouldLogMirrorUploadBatch(process.env, uploadEvent)) {
      console.log(JSON.stringify(uploadEvent));
    }
  }
  return { manifest, uploaded, deduped, concurrency: width, durationMs };
}

async function createDeployment({ projectName, projectId, manifest, metadata }, limits = {}) {
  const { q, auth } = vercelEnv();
  await throttleDeploy(Date.now(), limits);
  const res = await fetch(`https://api.vercel.com/v13/deployments?${q}`, fetchOptions({
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: projectName,
      project: projectId,
      target: "production",
      files: manifest,
      ...(metadata && Object.keys(metadata).length ? { meta: metadata } : {}),
      projectSettings: { framework: null, buildCommand: null, outputDirectory: null },
    }),
  }, limits));
  const dep = await res.json();
  if (!res.ok) throw new Error(`deployment failed: ${JSON.stringify(dep).slice(0, 300)}`);
  const deployedProjectId = dep.projectId || (dep.project && dep.project.id);
  if (deployedProjectId !== projectId || BACKEND_PROJECT_IDS().has(deployedProjectId)) {
    throw new Error("Vercel deployed customer files to an unexpected project");
  }
  return { id: dep.id, url: dep.url, readyState: dep.readyState };
}

async function waitReady(deployId, { attempts = 30, delayMs = 2000, signal, deadlineAt } = {}) {
  const { q, auth } = vercelEnv();
  for (let i = 0; i < attempts; i++) {
    const s = await fetch(`https://api.vercel.com/v13/deployments/${deployId}?${q}`, fetchOptions({ headers: auth }, { signal, deadlineAt })).then((r) => r.json());
    if (s.readyState === "READY") return s;
    if (s.readyState === "ERROR") throw new Error("deployment state: ERROR");
    await abortableDelay(delayMs, { signal, deadlineAt });
  }
  throw new Error("deployment never reached READY");
}

/**
 * Byte-diff the DEPLOYED assets against the local hydrated tree
 * (acceptance test 8). Pinned to the deploy_id URL, never the alias — CDN
 * propagation on the alias hides regressions. Accept-Encoding: identity
 * because Vercel re-compresses (Content-Encoding: br) and compressed bytes
 * never match local ones.
 */
function probeOrigin(deployUrl) {
  const value = String(deployUrl || "").replace(/\/+$/, "");
  return /^https:\/\//i.test(value) ? value : `https://${value}`;
}

async function byteDiff(deployUrl, files, {
  concurrency = 8, signal, deadlineAt, fetchImpl = fetch,
} = {}) {
  // vercel.json is deployment CONFIG, not served content: requesting
  // /vercel.json falls through its own SPA rewrite and returns index.html.
  // Its effect is verified behaviorally by deepLinkCheck instead.
  const entries = Object.entries(files).filter(([rel]) => rel !== "vercel.json");
  const mismatches = [];
  let checked = 0;
  const work = entries.slice();
  const runner = async () => {
    for (;;) {
      const next = work.shift();
      if (!next) return;
      const [rel, local] = next;
      const res = await fetchImpl(`${probeOrigin(deployUrl)}/${rel}`, {
        headers: { "Accept-Encoding": "identity" },
        signal: composeAbortSignal({ signal, deadlineAt, timeoutMs: 20_000 }),
      });
      if (!res.ok) { mismatches.push({ file: rel, reason: `http_${res.status}` }); continue; }
      const remote = Buffer.from(await res.arrayBuffer());
      checked++;
      if (!remote.equals(local)) mismatches.push({ file: rel, reason: "bytes_differ", local: local.length, remote: remote.length });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, runner));
  return { clean: mismatches.length === 0, checked, mismatches: mismatches.slice(0, 10) };
}

/** Deep-link probe: a routeless path must serve index.html (SPA rewrite), and
 *  a real asset path must serve the asset — filesystem before catch-all. */
async function deepLinkCheck(deployUrl, files, spaRoutes = [], {
  signal, deadlineAt, fetchImpl = fetch,
} = {}) {
  const failures = [];
  const index = files["index.html"];
  // Probe a route the donor actually owns. Probing a random path was wrong
  // once 404.html shipped: an unmatched path SHOULD 404, and asserting it
  // must serve index blocked every build from aliasing.
  const norm = normalizeRoutes(spaRoutes);
  const route = norm.prefixes[0] || norm.exact[0] || null;
  if (route) {
    // WHAT SHOULD THIS ROUTE SERVE? Routes are derived from the FILE TREE, so a
    // prerendered multi-page donor contributes routes that own a real file —
    // concrete-elconstruction ships service-area/index.html. Demanding the SPA
    // shell there failed every concrete build with did_not_serve_index while the
    // route was in fact serving exactly the right page. The check's purpose is
    // "this route serves real content, not a 404 or the wrong page", so the
    // expected body is the route's OWN file when it has one, and the shell only
    // when it does not.
    const rel = route.replace(/^\/+/, "");
    const own = files[`${rel}/index.html`] || files[`${rel}.html`] || null;
    const expected = own || index;
    const expectedName = own ? (files[`${rel}/index.html`] ? `${rel}/index.html` : `${rel}.html`) : "index.html";
    const deep = await fetchImpl(`${probeOrigin(deployUrl)}${route}`, {
      headers: { "Accept-Encoding": "identity" }, signal: composeAbortSignal({ signal, deadlineAt, timeoutMs: 20_000 }),
    });
    if (!deep.ok) failures.push({ probe: "spa_declared_route", route, reason: `http_${deep.status}` });
    else {
      const body = Buffer.from(await deep.arrayBuffer());
      if (!expected || !body.equals(expected)) {
        failures.push({ probe: "spa_declared_route", route, reason: `did_not_serve_${own ? "own_page" : "index"}`, expected: expectedName });
      }
    }
  }
  // An authority page must be a REAL page, not the shell — the bug that made
  // the manifest claim pages it never served.
  const authority = Object.keys(files).find((f) => /^(about|service-areas|faq|team)\.html$/.test(f));
  if (authority) {
    const clean = "/" + authority.replace(/\.html$/, "");
    const res = await fetchImpl(`${probeOrigin(deployUrl)}${clean}`, {
      headers: { "Accept-Encoding": "identity" }, signal: composeAbortSignal({ signal, deadlineAt, timeoutMs: 20_000 }),
    });
    if (!res.ok) failures.push({ probe: "authority_page", route: clean, reason: `http_${res.status}` });
    else {
      const body = Buffer.from(await res.arrayBuffer());
      if (index && body.equals(index)) failures.push({ probe: "authority_page", route: clean, reason: "served_spa_shell" });
    }
  }
  // A real asset must still be served by the filesystem, not a catch-all.
  const assetRel = Object.keys(files).find((f) => f.startsWith("assets/") && /\.(js|css)$/.test(f));
  if (assetRel) {
    const asset = await fetchImpl(`${probeOrigin(deployUrl)}/${assetRel}`, {
      headers: { "Accept-Encoding": "identity" }, signal: composeAbortSignal({ signal, deadlineAt, timeoutMs: 20_000 }),
    });
    if (!asset.ok) failures.push({ probe: "asset_route", reason: `http_${asset.status}` });
    else {
      const body = Buffer.from(await asset.arrayBuffer());
      if (index && body.equals(index)) failures.push({ probe: "asset_route", reason: "catch_all_shadowed_asset" });
    }
  }
  // THE SOFT-404 PROBE. An unknown path must answer 404 with a real body. The
  // blanket catch-all made every mirror answer 200 here, which is why nothing
  // ever caught it: no check asked. Two probes — one bare word, one that looks
  // like a nested route — because the prefix rewrites claim children.
  const unknown = [`/_probe-${Date.now().toString(36)}-not-a-page`, "/definitely/not/a/page"];
  const notFound = [];
  for (const p of unknown) {
    const res = await fetchImpl(`${probeOrigin(deployUrl)}${p}`, {
      headers: { "Accept-Encoding": "identity" }, signal: composeAbortSignal({ signal, deadlineAt, timeoutMs: 20_000 }),
    }).catch((e) => {
      if ((signal && signal.aborted) || (e && e.name === "AbortError")) throw e;
      return { ok: false, status: 0, _err: boundedDetailText(e.message || e) };
    });
    const status = res.status || 0;
    const body = res.arrayBuffer ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
    notFound.push({ path: p, status, bytes: body.length });
    if (status !== 404) failures.push({ probe: "unknown_path_must_404", route: p, reason: `http_${status}` });
    else if (body.length === 0) failures.push({ probe: "unknown_path_must_404", route: p, reason: "empty_404_body" });
    else if (index && body.equals(index)) failures.push({ probe: "unknown_path_must_404", route: p, reason: "served_spa_shell" });
  }

  return {
    clean: failures.length === 0,
    failures,
    probed: { spa_route: route, authority: authority || null, not_found: notFound },
  };
}

/** ALIAS LAST. Only callable with a {slug}.wss-ai.com host; fail closed. */
async function attachAlias({ deployId, projectId, slug }, limits = {}) {
  const { q, auth } = vercelEnv();
  const host = aliasHostFor(slug);
  if (!host.endsWith(`.${APEX}`) || host.split(".").length !== 3) {
    throw new Error(`refusing alias outside *.${APEX}: ${host}`);
  }
  const policy = slugPolicy(slug);
  if (!policy.ok) throw new Error(`refusing alias: ${policy.reason}`);
  const domainRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/domains?${q}`, fetchOptions({
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name: host }),
  }, limits));
  if (!domainRes.ok) {
    const existing = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}/domains/${encodeURIComponent(host)}?${q}`,
      fetchOptions({ headers: auth }, limits),
    );
    const body = await existing.json().catch(() => ({}));
    if (!existing.ok || body.projectId !== projectId) {
      const err = await domainRes.json().catch(() => ({}));
      throw new Error(`domain assignment failed: ${(err.error && err.error.code) || domainRes.status}`);
    }
  }
  const al = await fetch(`https://api.vercel.com/v2/deployments/${deployId}/aliases?${q}`, fetchOptions({
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ alias: host }),
  }, limits));
  if (!al.ok) {
    const listRes = await fetch(`https://api.vercel.com/v2/deployments/${deployId}/aliases?${q}`, fetchOptions({ headers: auth }, limits));
    const listBody = await listRes.json().catch(() => ({}));
    const aliases = Array.isArray(listBody) ? listBody : (listBody.aliases || []);
    const bound = listRes.ok && aliases.some((item) => {
      const v = typeof item === "string" ? item : (item.alias || item.domain || "");
      return String(v).toLowerCase() === host;
    });
    if (!bound) {
      const err = await al.json().catch(() => ({}));
      throw new Error(`alias assignment failed: ${(err.error && err.error.code) || al.status}`);
    }
  }
  return { alias: `https://${host}` };
}

/**
 * Permanently retire one legacy, isolated mirror project.
 *
 * This is deliberately narrower than the deploy path: only the deterministic
 * `wss-test-*` project that owns its exact `slug.wss-ai.com` hostname can be
 * removed.  It can never be pointed at Ghost or at an arbitrary Vercel
 * project.  The caller keeps its durable retirement record when any provider
 * step fails, so a retry resumes teardown instead of recreating the site.
 */
async function retireLegacyProject({ projectName, slug }, limits = {}) {
  const name = String(projectName || "").trim().toLowerCase();
  const policy = slugPolicy(slug);
  const host = policy.ok ? aliasHostFor(slug) : "";
  if (!/^wss-test-[a-z0-9-]+$/.test(name) || !policy.ok || name !== String(slug || "").trim().toLowerCase()) {
    throw new Error("refusing legacy project retirement outside exact wss-test slug identity");
  }
  if (BACKEND_PROJECT_NAMES().has(name)) throw new Error("refusing to retire Ghost backend project");

  const { q, auth } = vercelEnv();
  const projectRes = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(name)}?${q}`,
    fetchOptions({ headers: auth }, limits),
  );
  if (projectRes.status === 404) return { ok: true, project: name, host, alreadyRemoved: true };
  const project = await projectRes.json().catch(() => ({}));
  if (!projectRes.ok || !project.id
    || String(project.name || "").toLowerCase() !== name
    || BACKEND_PROJECT_IDS().has(String(project.id))) {
    throw new Error("legacy project identity could not be proven");
  }

  // Remove the public hostname before deleting the project.  A 404 is
  // idempotent success: a prior attempt may have completed this exact step.
  const domainRes = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(project.id)}/domains/${encodeURIComponent(host)}?${q}`,
    fetchOptions({ method: "DELETE", headers: auth }, limits),
  );
  if (!domainRes.ok && domainRes.status !== 404) {
    const body = await domainRes.json().catch(() => ({}));
    throw new Error(`legacy domain removal failed: ${(body.error && body.error.code) || domainRes.status}`);
  }

  const deleteRes = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(project.id)}?${q}`,
    fetchOptions({ method: "DELETE", headers: auth }, limits),
  );
  if (!deleteRes.ok && deleteRes.status !== 404) {
    const body = await deleteRes.json().catch(() => ({}));
    throw new Error(`legacy project removal failed: ${(body.error && body.error.code) || deleteRes.status}`);
  }
  return { ok: true, project: name, projectId: project.id, host, alreadyRemoved: false };
}

/**
 * Post-alias identity check (handoff §14): assert the public alias actually
 * targets the deployment we just verified. "Vercel READY" is not proof the
 * alias serves the intended bytes — a stale alias once burned a full day of
 * debugging and produced false "deployed clean" claims.
 */
async function aliasTargetCheck({ slug, deployId }, limits = {}) {
  const { q, auth } = vercelEnv();
  const host = aliasHostFor(slug);
  const res = await fetch(`https://api.vercel.com/v4/aliases/${encodeURIComponent(host)}?${q}`, fetchOptions({ headers: auth }, limits));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { clean: false, reason: `alias_lookup_http_${res.status}` };
  const target = body.deploymentId || (body.deployment && body.deployment.id) || "";
  if (target !== deployId) {
    return { clean: false, reason: "alias_targets_other_deployment", expected: deployId, actual: target };
  }
  return { clean: true, deploymentId: target };
}

/** Resolve the deterministic slug alias to a pinned deployment. This is only
 * a resume candidate: callers must still byte-diff every regenerated file and
 * run the deep-link check before they may reuse it. */
async function resolveAliasDeployment({ slug, projectId }, limits = {}) {
  const { q, auth } = vercelEnv();
  const host = aliasHostFor(slug);
  const aliasRes = await fetch(
    `https://api.vercel.com/v4/aliases/${encodeURIComponent(host)}?${q}`,
    fetchOptions({ headers: auth }, limits),
  );
  if (aliasRes.status === 404) return { found: false, reason: "alias_not_found" };
  const alias = await aliasRes.json().catch(() => ({}));
  if (!aliasRes.ok) return { found: false, refused: true, retryable: true, reason: `alias_lookup_http_${aliasRes.status}` };
  const deployId = alias.deploymentId || (alias.deployment && alias.deployment.id) || "";
  const aliasProjectId = alias.projectId
    || (alias.project && alias.project.id)
    || (alias.deployment && alias.deployment.projectId)
    || "";
  if (!deployId) return { found: false, refused: true, retryable: true, reason: "alias_missing_deployment" };
  if (aliasProjectId && aliasProjectId !== projectId) {
    return { found: false, refused: true, reason: "alias_wrong_project", actual_project_id: aliasProjectId };
  }

  const depRes = await fetch(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deployId)}?${q}`,
    fetchOptions({ headers: auth }, limits),
  );
  const dep = await depRes.json().catch(() => ({}));
  if (!depRes.ok) return { found: false, refused: true, retryable: true, reason: `deployment_lookup_http_${depRes.status}` };
  const depProjectId = dep.projectId || (dep.project && dep.project.id) || "";
  if (depProjectId !== projectId || BACKEND_PROJECT_IDS().has(depProjectId)) {
    return { found: false, refused: true, reason: "deployment_wrong_project", actual_project_id: depProjectId };
  }
  if (dep.readyState !== "READY" || !dep.url) {
    return { found: false, refused: true, retryable: true, reason: `deployment_not_ready:${dep.readyState || "unknown"}` };
  }
  return {
    found: true,
    source: "alias",
    deployment: { id: deployId, url: dep.url, readyState: dep.readyState },
    projectId: depProjectId,
  };
}

function deploymentProjectId(dep) {
  return dep && (dep.projectId || (dep.project && dep.project.id) || "");
}

function validDeploymentUrl(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?\.vercel\.app$/i.test(String(value || ""));
}

/** Find work which Vercel accepted before a previous caller died. Metadata is
 * the durable operation checkpoint; both hashes must match exactly. */
async function resolveTaggedDeployment({ projectId, buildHash, operationKeyHmacSha256 }, limits = {}) {
  const operationHash = String(operationKeyHmacSha256 || "").trim();
  const expectedBuildHash = String(buildHash || "").trim();
  if (!operationHash || !expectedBuildHash) return { found: false, reason: "alias_not_found" };
  const { q, auth } = vercelEnv();
  const params = new URLSearchParams(q);
  params.set("projectId", projectId);
  params.set("target", "production");
  params.set("limit", "20");
  const res = await fetch(
    `https://api.vercel.com/v6/deployments?${params.toString()}`,
    fetchOptions({ headers: auth }, limits),
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(body.deployments)) {
    return { found: false, refused: true, retryable: true, reason: `deployment_list_http_${res.status}` };
  }

  const exact = body.deployments.filter((dep) => {
    const meta = dep && dep.meta && typeof dep.meta === "object" ? dep.meta : {};
    return meta.operation_key_hmac_sha256 === operationHash && meta.build_hash === expectedBuildHash;
  });
  if (!exact.length) return { found: false, reason: "alias_not_found" };

  // Two deployments can legitimately share one operation tag when a timed or
  // interrupted build was retried on the SAME durable key. Refusing both as
  // "deployment_metadata_ambiguous" never retried out and exhausted the budget
  // (the live 502 resume_refused cluster). The v6 list is newest-first: take the
  // newest READY twin, else the newest (which then trips the deployment_not_ready
  // branch below and stays retryable). Every candidate still runs the
  // project-isolation + identity checks that follow, so a wrong or foreign
  // artifact is still rejected — this only stops discarding a good resume.
  const dep = exact.find((d) => d && d.readyState === "READY") || exact[0];
  // Vercel's v6 list response calls the deployment identifier `uid`; older
  // fixtures and response variants use `id`. Normalize once and return the
  // real identifier so wait/alias operations never receive undefined.
  const uid = String(dep.uid || "").trim();
  const legacyId = String(dep.id || "").trim();
  const deployId = uid || legacyId;
  const deploymentIdConflict = Boolean(uid && legacyId && uid !== legacyId);
  const depProjectId = deploymentProjectId(dep);
  const depName = String(dep.name || (dep.project && dep.project.name) || "").toLowerCase();
  if (
    depProjectId !== projectId
    || BACKEND_PROJECT_IDS().has(depProjectId)
    || BACKEND_PROJECT_NAMES().has(depName)
  ) {
    return { found: false, refused: true, reason: "deployment_wrong_project", actual_project_id: depProjectId };
  }
  if (dep.readyState !== "READY") {
    return { found: false, refused: true, retryable: true, reason: `deployment_not_ready:${dep.readyState || "unknown"}` };
  }
  if (deploymentIdConflict || !deployId || !validDeploymentUrl(dep.url)) {
    return { found: false, refused: true, reason: "deployment_invalid_identity" };
  }
  return {
    found: true,
    source: "operation_metadata",
    deployment: { id: deployId, url: dep.url, readyState: dep.readyState },
    projectId: depProjectId,
  };
}

module.exports = {
  APEX,
  CHECKPOINT_RESERVE_MS,
  DEFAULT_UPLOAD_CONCURRENCY,
  MAX_UPLOAD_CONCURRENCY,
  UPLOAD_CONCURRENCY_ENV,
  uploadConcurrency,
  composeAbortSignal,
  remainingBudget,
  aliasTargetCheck,
  resolveAliasDeployment,
  resolveTaggedDeployment,
  RESERVED_SLUGS,
  slugPolicy,
  aliasHostFor,
  withSpaRewrite,
  spaVercelJson,
  normalizeRoutes,
  SPA_VERCEL_JSON,
  throttleDeploy,
  ensureProject,
  uploadFiles,
  createDeployment,
  waitReady,
  byteDiff,
  deepLinkCheck,
  attachAlias,
  retireLegacyProject,
};
