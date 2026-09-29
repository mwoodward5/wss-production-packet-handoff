"use strict";

/**
 * test/every-required-module-is-deployed.test.js
 *
 * THE INCIDENT, 2026-08-11. Riley was dead in production and every local test
 * was green.
 *
 *   POST /api/vapi-tools/lookup-prospect   -> 500 FUNCTION_INVOCATION_FAILED
 *   POST /api/vapi-tools/request-site-change -> 500 FUNCTION_INVOCATION_FAILED
 *   POST /api/vapi-tools/research            -> 200
 *   POST /api/admin/line {action:"start"}    -> 500 "Cannot find module './service-harvest'"
 *
 * The discriminator: the three dead routes all required a file that EXISTS ON
 * DISK and is NOT TRACKED BY GIT. Vercel deploys the repository, not the
 * developer's working tree, so `lib/riley-call-memory.js` and
 * `lib/mirror-engine/service-harvest.js` were simply absent from the lambda.
 * `node --test` passed because the files are right there locally, and the
 * routes that did not need them kept answering 200 — so the deployment looked
 * healthy from every angle except the one that mattered.
 *
 * api/vapi-tools/research.js even carries a hand-written try/catch around one
 * of them, with a comment naming this exact failure ("Cannot find module") on a
 * previous deployment. A workaround in one file is not a fix for the class: the
 * two files that took the hard require stayed broken for as long as the module
 * stayed uncommitted, and nothing in the suite could say so.
 *
 * So this test walks the require graph from apps/backend/api and asserts that
 * every relative require resolves to a path `git ls-files` knows about. It is
 * the only test here that can tell the difference between "works on this
 * machine" and "exists in the deployment".
 *
 * A module that is deliberately optional (loaded inside try/catch and allowed
 * to be absent) is exempted BY NAME below, so the exemption is a decision
 * somebody made on purpose rather than a hole the scan quietly grew.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const BACKEND = path.resolve(__dirname, "..");
const REPO = path.resolve(BACKEND, "..", "..");
const API = path.join(BACKEND, "api");

/**
 * Requires that are ALLOWED not to resolve, because the caller loads them
 * inside a try/catch and behaves correctly when they are missing.
 *   lib/agents/stages — api/cron/nightly-pipeline.js loadStages() returns null.
 * Anything not on this list must resolve AND be tracked.
 */
const OPTIONAL_SPECIFIERS = new Set(["../../lib/agents/stages"]);

function trackedPaths() {
  const out = execFileSync("git", ["ls-files"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return new Set(
    out.split(/\r?\n/).filter(Boolean).map((p) => path.resolve(REPO, p).toLowerCase()),
  );
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.json`, path.join(base, "index.js")];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch { /* keep looking */ }
  }
  return null;
}

function jsFilesUnder(dir) {
  const found = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(p);
      } else if (entry.name.endsWith(".js")) {
        found.push(p);
      }
    }
  };
  walk(dir);
  return found;
}

/** Every file reachable from the API surface, plus how it was reached. */
function crawl() {
  const seen = new Set();
  const problems = [];
  const queue = jsFilesUnder(API);

  while (queue.length) {
    const file = queue.pop();
    const key = file.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let src;
    try { src = fs.readFileSync(file, "utf8"); } catch { continue; }

    for (const match of src.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const spec = match[1];
      const target = resolveRelative(file, spec);
      if (!target) {
        if (!OPTIONAL_SPECIFIERS.has(spec)) {
          problems.push({ kind: "unresolvable", importer: file, spec });
        }
        continue;
      }
      problems.push({ kind: "resolved", importer: file, spec, target });
      queue.push(target);
    }
  }
  return { reached: seen, problems };
}

test("every module the API requires is committed, not just present on this machine", () => {
  const tracked = trackedPaths();
  assert.ok(tracked.size > 100, `git ls-files returned ${tracked.size} paths — the scan cannot be trusted`);

  const { reached, problems } = crawl();
  assert.ok(reached.size > 200, `only ${reached.size} files reached from apps/backend/api — the crawl is broken`);

  const untracked = new Map();
  const unresolvable = [];
  for (const p of problems) {
    if (p.kind === "unresolvable") { unresolvable.push(p); continue; }
    if (tracked.has(p.target.toLowerCase())) continue;
    const rel = path.relative(REPO, p.target).replace(/\\/g, "/");
    if (!untracked.has(rel)) untracked.set(rel, new Set());
    untracked.get(rel).add(path.relative(REPO, p.importer).replace(/\\/g, "/"));
  }

  if (unresolvable.length) {
    const lines = unresolvable.map((p) => `  ${path.relative(REPO, p.importer).replace(/\\/g, "/")} requires ${p.spec} — no such file`);
    assert.fail(`require() targets that do not exist at all:\n${lines.join("\n")}`);
  }

  if (untracked.size) {
    const lines = [...untracked.entries()].map(([target, importers]) =>
      `  ${target}\n${[...importers].map((i) => `      required by ${i}`).join("\n")}`);
    assert.fail(
      "These modules exist locally but are NOT in git, so they will NOT be in the Vercel\n"
      + "deployment. Every route that requires one answers 500 FUNCTION_INVOCATION_FAILED\n"
      + `in production while passing every test here:\n${lines.join("\n")}\n`
      + "Fix: git add them. (This is the 2026-08-11 Riley outage.)",
    );
  }
});

test("the optional-module exemption list stays honest", () => {
  // An entry here must be loaded defensively. If somebody converts one of these
  // into a hard require, the exemption becomes a licence for the same outage.
  for (const spec of OPTIONAL_SPECIFIERS) {
    const importers = jsFilesUnder(API).filter((f) => fs.readFileSync(f, "utf8").includes(spec));
    assert.ok(importers.length > 0, `${spec} is exempted but nothing requires it — delete the exemption`);
    for (const file of importers) {
      const src = fs.readFileSync(file, "utf8");
      const idx = src.indexOf(`require("${spec}")`) >= 0
        ? src.indexOf(`require("${spec}")`)
        : src.indexOf(`require('${spec}')`);
      const window = src.slice(Math.max(0, idx - 400), idx);
      assert.ok(
        /\btry\s*\{/.test(window),
        `${path.relative(REPO, file)} requires the exempted ${spec} WITHOUT a try/catch — `
        + "either load it defensively or commit it.",
      );
    }
  }
});
