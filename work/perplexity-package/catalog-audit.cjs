#!/usr/bin/env node
"use strict";

// Read-only WSS donor catalog auditor. It never writes, never requires or
// executes donor JavaScript, and never treats catalog membership, a clean
// audit, or a declared selector as production readiness or rendered content.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CATALOG_SCHEMA = "wss-donor-catalog-v2";
const HEX64 = /^[0-9a-f]{64}$/i;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FLAG_FIELDS = [
  "source_import_verified", "client_bindings_verified", "runtime_eligible", "visual_parity_verified",
];
const LIMITS = [
  "aggregate bundle tree hash was not recomputed; only catalog-vs-manifest tree pins were compared",
  "individual declared bundle files were hashed with SHA-256 over exact bytes",
  "render targets are statically validated; no selector was proven to render content",
  "donor JavaScript (mapping.cjs, bundle assets) was not required or executed",
  "catalog membership and a clean audit are not production readiness",
  "eligibility flags are reported as-is and never modified",
];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function unsafeRelPath(p) {
  if (typeof p !== "string" || p.length === 0) return "empty_or_non_string";
  if (p.includes("\0")) return "nul_byte";
  if (p.includes("\\")) return "backslash_separator";
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || path.isAbsolute(p)) return "absolute_path";
  if (p.split("/").some((s) => s === "" || s === "." || s === "..")) return "traversal_or_empty_segment";
  return null;
}

function within(parent, child) {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  return !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..";
}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

function realOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return { error: `unreadable: ${e.code || e.message}` }; }
  try { return { value: JSON.parse(text) }; } catch (e) { return { error: `invalid_json: ${e.message}` }; }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// Resolve `p` and confirm (after following symlinks) it stays inside `realParent`.
function contained(p, realParent) {
  const st = lstatOrNull(p);
  if (!st) return { exists: false };
  const real = realOrNull(p);
  if (!real || !within(realParent, real)) return { exists: true, escapes: true, symlink: st.isSymbolicLink() };
  const target = fs.statSync(real);
  return { exists: true, escapes: false, symlink: st.isSymbolicLink(), real, isFile: target.isFile(), isDir: target.isDirectory() };
}

function validTarget(t) {
  return isPlainObject(t)
    && typeof t.path === "string" && t.path.startsWith("/") && !t.path.split("/").includes("..")
    && typeof t.selector === "string" && t.selector.trim().length > 0;
}

function auditRenderTargets(targets, add) {
  const out = { servicesValid: false, declaredChannels: [], malformedChannels: [], selectorRenderingVerified: false };
  if (!isPlainObject(targets)) {
    add("render_targets_missing", "content_render_targets must be an object");
    return out;
  }
  if (!Array.isArray(targets.services) || targets.services.length === 0) {
    add("services_render_target_missing", "content_render_targets.services must be a nonempty array");
  }
  for (const channel of Object.keys(targets).sort()) {
    const list = targets[channel];
    if (!Array.isArray(list)) {
      out.malformedChannels.push(channel);
      add("render_target_malformed", { channel, reason: "not_an_array" });
      continue;
    }
    if (list.length === 0) continue;
    const bad = list.map((t, i) => (validTarget(t) ? -1 : i)).filter((i) => i >= 0);
    if (bad.length) {
      out.malformedChannels.push(channel);
      add("render_target_malformed", { channel, indexes: bad });
      continue;
    }
    out.declaredChannels.push(channel);
    if (channel === "services") out.servicesValid = true;
  }
  return out;
}

function auditDonor(entry, index, ctx, issues) {
  const key = isPlainObject(entry) && typeof entry.key === "string" ? entry.key : null;
  const donorIssues = [];
  const add = (code, detail = null) => {
    const issue = { key, index, code, detail };
    donorIssues.push(issue);
    issues.push(issue);
  };
  const report = {
    index, key, status: "issues",
    catalogVertical: null, manifestCategory: null, manifestVertical: null, renderer: null,
    implementationStatus: null, flags: {},
    bundlePin: { catalog: null, manifest: null, matches: false },
    presence: { donorDir: false, manifest: false, mapping: false, bundleDir: false },
    files: { declared: 0, verified: 0, mismatched: 0, missing: 0, unsafe: 0, results: [] },
    renderTargets: null,
  };

  if (!isPlainObject(entry)) { add("catalog_entry_malformed", "entry is not an object"); return finish(); }
  if (!key || !SAFE_KEY.test(key)) { add("donor_key_unsafe_or_missing", entry.key ?? null); return finish(); }
  if (ctx.seen.has(key)) add("duplicate_key", { firstIndex: ctx.seen.get(key) });
  else ctx.seen.set(key, index);

  report.catalogVertical = typeof entry.vertical === "string" && entry.vertical ? entry.vertical : null;
  if (!report.catalogVertical) add("catalog_vertical_missing");
  report.implementationStatus = typeof entry.implementation_status === "string" ? entry.implementation_status : null;
  if (!report.implementationStatus) add("implementation_status_missing");
  for (const f of FLAG_FIELDS) {
    report.flags[f] = Object.prototype.hasOwnProperty.call(entry, f) ? entry[f] : null;
    if (typeof entry[f] !== "boolean") add("flag_not_boolean", { flag: f, value: entry[f] ?? null });
  }
  report.bundlePin.catalog = typeof entry.bundle === "string" ? entry.bundle : null;
  if (!report.bundlePin.catalog || !HEX64.test(report.bundlePin.catalog)) add("catalog_bundle_pin_malformed");

  if (!ctx.realCatalogDir) { add("donor_catalog_dir_missing", ctx.catalogDir); return finish(); }
  const donorDir = path.join(ctx.catalogDir, key);
  const dir = contained(donorDir, ctx.realCatalogDir);
  if (!dir.exists) { add("donor_dir_missing", donorDir); return finish(); }
  if (dir.escapes) { add("donor_dir_escapes_catalog", donorDir); return finish(); }
  if (!dir.isDir) { add("donor_dir_not_directory", donorDir); return finish(); }
  report.presence.donorDir = true;

  const mapping = contained(path.join(donorDir, "mapping.cjs"), dir.real);
  if (!mapping.exists) add("mapping_missing");
  else if (mapping.escapes) add("mapping_escapes_donor_dir");
  else if (!mapping.isFile) add("mapping_not_file");
  else report.presence.mapping = true;

  const bundle = contained(path.join(donorDir, "bundle"), dir.real);
  if (!bundle.exists) add("bundle_dir_missing");
  else if (bundle.escapes) add("bundle_dir_escapes_donor_dir");
  else if (!bundle.isDir) add("bundle_not_directory");
  else report.presence.bundleDir = true;

  const mf = contained(path.join(donorDir, "donor.json"), dir.real);
  if (!mf.exists) { add("manifest_missing"); return finish(); }
  if (mf.escapes) { add("manifest_escapes_donor_dir"); return finish(); }
  const parsed = mf.isFile ? readJson(mf.real) : { error: "not_a_file" };
  if (parsed.error || !isPlainObject(parsed.value)) {
    add("manifest_malformed", parsed.error || "manifest is not an object");
    return finish();
  }
  report.presence.manifest = true;
  const manifest = parsed.value;
  if (manifest.key !== key) add("manifest_key_mismatch", { manifest: manifest.key ?? null });
  report.manifestCategory = typeof manifest.category === "string" && manifest.category ? manifest.category : null;
  report.manifestVertical = typeof manifest.vertical === "string" ? manifest.vertical : null;
  report.renderer = typeof manifest.renderer === "string" ? manifest.renderer : null;
  if (!report.manifestCategory) add("manifest_category_missing");
  else if (report.catalogVertical && report.manifestCategory !== report.catalogVertical) {
    add("category_mismatch", { catalogVertical: report.catalogVertical, manifestCategory: report.manifestCategory });
  }
  if (report.manifestVertical !== null && report.catalogVertical && report.manifestVertical !== report.catalogVertical) {
    add("vertical_mismatch", { catalogVertical: report.catalogVertical, manifestVertical: report.manifestVertical });
  }

  const mb = isPlainObject(manifest.bundle) ? manifest.bundle : null;
  report.bundlePin.manifest = mb && typeof mb.tree_sha256 === "string" ? mb.tree_sha256 : null;
  if (!report.bundlePin.manifest || !HEX64.test(report.bundlePin.manifest)) add("manifest_tree_pin_malformed");
  report.bundlePin.matches = Boolean(report.bundlePin.catalog && report.bundlePin.manifest
    && report.bundlePin.catalog.toLowerCase() === report.bundlePin.manifest.toLowerCase());
  if (report.bundlePin.catalog && report.bundlePin.manifest && !report.bundlePin.matches) add("bundle_pin_mismatch");

  const declared = mb && isPlainObject(mb.files) ? mb.files : null;
  if (!declared || Object.keys(declared).length === 0) add("bundle_files_not_declared");
  for (const rel of declared ? Object.keys(declared).sort() : []) {
    const expected = declared[rel];
    const result = { path: rel, expected: typeof expected === "string" ? expected : null, actual: null, status: "unchecked" };
    report.files.results.push(result);
    report.files.declared += 1;
    const unsafe = unsafeRelPath(rel);
    if (unsafe) { result.status = "unsafe_path"; report.files.unsafe += 1; add("unsafe_bundle_path", { path: rel, reason: unsafe }); continue; }
    if (!report.presence.bundleDir) { result.status = "bundle_dir_unavailable"; report.files.missing += 1; continue; }
    const f = contained(path.join(bundle.real, ...rel.split("/")), bundle.real);
    if (!f.exists) { result.status = "missing"; report.files.missing += 1; add("bundle_file_missing", { path: rel }); continue; }
    if (f.escapes) { result.status = "path_escape"; report.files.unsafe += 1; add("bundle_path_escape", { path: rel, symlink: f.symlink }); continue; }
    if (!f.isFile) { result.status = "not_a_file"; report.files.missing += 1; add("bundle_entry_not_file", { path: rel }); continue; }
    result.actual = sha256File(f.real);
    if (!result.expected || !HEX64.test(result.expected)) {
      result.status = "declared_hash_malformed"; report.files.mismatched += 1;
      add("bundle_file_hash_malformed", { path: rel });
    } else if (result.expected.toLowerCase() !== result.actual) {
      result.status = "hash_mismatch"; report.files.mismatched += 1;
      add("bundle_file_hash_mismatch", { path: rel, expected: result.expected, actual: result.actual });
    } else {
      result.status = "verified"; report.files.verified += 1;
    }
  }

  report.renderTargets = auditRenderTargets(manifest.content_render_targets, add);
  return finish();

  function finish() {
    report.status = donorIssues.length === 0 ? "clean" : "issues";
    report.issueCodes = [...new Set(donorIssues.map((i) => i.code))];
    return report;
  }
}

function auditCatalog({ rootDir, catalogPath } = {}) {
  const issues = [];
  const report = {
    schema: "wss-donor-catalog-audit-v1",
    ok: false,
    rootDir: typeof rootDir === "string" && rootDir ? path.resolve(rootDir) : null,
    catalogPath: typeof catalogPath === "string" && catalogPath ? path.resolve(catalogPath) : null,
    catalog: { schema: null, declaredCount: null, entryCount: null, countMatches: false },
    aggregateTreeHash: { recomputed: false, note: "aggregate tree-hash algorithm is not defined for this auditor; only pins were compared" },
    productionReadiness: "not_assessed",
    limits: LIMITS,
    donors: [],
    coverage: {},
    issues,
  };
  const top = (code, detail = null) => issues.push({ key: null, index: null, code, detail });
  if (!report.rootDir) top("root_dir_missing");
  if (!report.catalogPath) top("catalog_path_missing");
  if (!report.rootDir || !report.catalogPath) return report;

  const parsed = readJson(report.catalogPath);
  if (parsed.error) { top("catalog_unreadable", parsed.error); return report; }
  const catalog = parsed.value;
  if (!isPlainObject(catalog)) { top("catalog_malformed", "catalog is not an object"); return report; }
  report.catalog.schema = catalog.schema ?? null;
  if (catalog.schema !== CATALOG_SCHEMA) top("catalog_schema_unexpected", { expected: CATALOG_SCHEMA, actual: catalog.schema ?? null });
  report.catalog.declaredCount = Number.isInteger(catalog.count) ? catalog.count : null;
  if (report.catalog.declaredCount === null) top("catalog_count_malformed", catalog.count ?? null);
  if (!Array.isArray(catalog.donors)) { top("catalog_donors_not_array"); return report; }
  report.catalog.entryCount = catalog.donors.length;
  report.catalog.countMatches = report.catalog.declaredCount === catalog.donors.length;
  if (report.catalog.declaredCount !== null && !report.catalog.countMatches) {
    top("catalog_count_mismatch", { declared: report.catalog.declaredCount, entries: catalog.donors.length });
  }

  const catalogDir = path.join(report.rootDir, "donors", "catalog");
  const ctx = { catalogDir, realCatalogDir: realOrNull(catalogDir), seen: new Map() };
  report.donors = catalog.donors.map((entry, i) => auditDonor(entry, i, ctx, issues));

  const coverage = new Map();
  for (const d of report.donors) {
    if (!d.key || !SAFE_KEY.test(d.key)) continue;
    const category = d.manifestCategory || d.catalogVertical || "unknown";
    if (!coverage.has(category)) coverage.set(category, { donors: [], cleanDonors: [], runtimeEligibleFlagged: [], visualParityFlagged: [] });
    const c = coverage.get(category);
    c.donors.push(d.key);
    if (d.status === "clean") c.cleanDonors.push(d.key);
    if (d.flags.runtime_eligible === true) c.runtimeEligibleFlagged.push(d.key);
    if (d.flags.visual_parity_verified === true) c.visualParityFlagged.push(d.key);
  }
  report.coverage = Object.fromEntries([...coverage.entries()].sort(([a], [b]) => a.localeCompare(b)));
  report.ok = issues.length === 0;
  return report;
}

function parseArgs(argv) {
  const out = { unknown: [] };
  for (const a of argv) {
    const m = /^--(root|catalog)=(.+)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else out.unknown.push(a);
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root || !args.catalog || args.unknown.length) {
    process.stderr.write("usage: node catalog-audit.cjs --root=<path> --catalog=<path>\n");
    process.exitCode = 2;
  } else {
    const result = auditCatalog({ rootDir: args.root, catalogPath: args.catalog });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  }
}

module.exports = { auditCatalog, CATALOG_SCHEMA };
