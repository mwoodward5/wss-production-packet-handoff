"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { auditCatalog } = require("./catalog-audit.cjs");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wss-catalog-audit-test-"));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function fixture(donors, { count } = {}) {
  const root = path.join(TMP, `case-${++seq}`);
  const entries = [];
  for (const d of donors) {
    const key = d.key;
    const dir = path.join(root, "donors", "catalog", key);
    const files = d.files || { "index.html": "<!doctype html><div id=root></div>", "assets/index-a1.js": "console.log(1);\n" };
    const tree = sha(`tree:${key}`);
    const manifest = {
      key, category: d.category, vertical: d.category, renderer: "spa-v2",
      bundle: { tree_sha256: tree, files: Object.fromEntries(Object.entries(files).map(([p, c]) => [p, sha(c)])) },
      content_render_targets: d.targets || {
        services: [{ path: "/", selector: "section#services" }],
        reviews: [{ path: "/", selector: "#root > div" }],
      },
    };
    fs.mkdirSync(path.join(dir, "bundle"), { recursive: true });
    for (const [p, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, "bundle", p)), { recursive: true });
      fs.writeFileSync(path.join(dir, "bundle", p), c);
    }
    // If the auditor ever required/executed donor code, this would throw.
    fs.writeFileSync(path.join(dir, "mapping.cjs"), "throw new Error('donor code must not execute');\n");
    fs.writeFileSync(path.join(dir, "donor.json"), JSON.stringify(d.mutateManifest ? d.mutateManifest(manifest) : manifest));
    entries.push({
      key, vertical: d.vertical || d.category, implementation_status: "WSS_ADAPTED", bundle: d.pin || tree,
      source_import_verified: true, client_bindings_verified: true,
      runtime_eligible: d.runtime ?? false, visual_parity_verified: false,
    });
  }
  const catalogPath = path.join(root, "catalog.json");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(catalogPath, JSON.stringify({ schema: "wss-donor-catalog-v2", count: count ?? entries.length, donors: entries }));
  return { root, catalogPath, donorDir: (k) => path.join(root, "donors", "catalog", k) };
}
const codes = (r) => r.issues.map((i) => i.code);

test("valid catalog is clean, derives coverage from data, and reports limits honestly", () => {
  const fx = fixture([
    { key: "01-a", category: "landscaping" },
    { key: "02-b", category: "concrete", runtime: true },
    { key: "03-c", category: "landscaping" },
  ]);
  const before = fs.readFileSync(fx.catalogPath);
  const r = auditCatalog({ rootDir: fx.root, catalogPath: fx.catalogPath });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.deepEqual(Object.keys(r.coverage), ["concrete", "landscaping"]);
  assert.deepEqual(r.coverage.landscaping.donors, ["01-a", "03-c"]);
  assert.deepEqual(r.coverage.concrete.runtimeEligibleFlagged, ["02-b"]);
  assert.equal(r.donors[0].flags.runtime_eligible, false, "flags are reported, not flipped");
  assert.equal(r.donors[0].flags.visual_parity_verified, false);
  assert.equal(r.donors[0].files.verified, 2);
  assert.deepEqual(r.donors[0].renderTargets.declaredChannels, ["reviews", "services"]);
  assert.equal(r.donors[0].renderTargets.selectorRenderingVerified, false);
  assert.equal(r.aggregateTreeHash.recomputed, false);
  assert.equal(r.productionReadiness, "not_assessed");
  assert.ok(fs.readFileSync(fx.catalogPath).equals(before), "catalog bytes unchanged");
});

test("corrupt bundle bytes are detected by exact SHA-256", () => {
  const fx = fixture([{ key: "01-a", category: "landscaping" }]);
  fs.appendFileSync(path.join(fx.donorDir("01-a"), "bundle", "index.html"), " ");
  const r = auditCatalog({ rootDir: fx.root, catalogPath: fx.catalogPath });
  assert.equal(r.ok, false);
  const issue = r.issues.find((i) => i.code === "bundle_file_hash_mismatch");
  assert.equal(issue.detail.path, "index.html");
  assert.notEqual(issue.detail.expected, issue.detail.actual);
});

test("missing mapping, manifest, bundle file and donor directory are reported", () => {
  const fx = fixture([
    { key: "01-a", category: "x" }, { key: "02-b", category: "x" },
    { key: "03-c", category: "x" }, { key: "04-d", category: "x" },
  ]);
  fs.rmSync(path.join(fx.donorDir("01-a"), "mapping.cjs"));
  fs.rmSync(path.join(fx.donorDir("02-b"), "donor.json"));
  fs.rmSync(path.join(fx.donorDir("03-c"), "bundle", "assets", "index-a1.js"));
  fs.rmSync(fx.donorDir("04-d"), { recursive: true });
  const r = auditCatalog({ rootDir: fx.root, catalogPath: fx.catalogPath });
  assert.deepEqual(r.donors.map((d) => d.issueCodes), [
    ["mapping_missing"], ["manifest_missing"], ["bundle_file_missing"], ["donor_dir_missing"],
  ]);
  assert.deepEqual(r.coverage.x.cleanDonors, []);
});

test("category mismatch and bundle pin mismatch are separate findings", () => {
  const fx = fixture([
    { key: "01-a", category: "landscaping", vertical: "concrete" },
    { key: "02-b", category: "concrete", pin: "f".repeat(64) },
  ]);
  const r = auditCatalog({ rootDir: fx.root, catalogPath: fx.catalogPath });
  assert.ok(r.donors[0].issueCodes.includes("category_mismatch"));
  assert.deepEqual(r.donors[1].issueCodes, ["bundle_pin_mismatch"]);
  assert.equal(r.donors[1].bundlePin.matches, false);
});

test("duplicate keys, count mismatch, unsafe keys and malformed entries are reported", () => {
  const fx = fixture([{ key: "01-a", category: "x" }], { count: 34 });
  const cat = JSON.parse(fs.readFileSync(fx.catalogPath, "utf8"));
  cat.donors.push({ ...cat.donors[0] }, { ...cat.donors[0], key: "../escape" }, "garbage");
  fs.writeFileSync(fx.catalogPath, JSON.stringify(cat));
  const r = auditCatalog({ rootDir: fx.root, catalogPath: fx.catalogPath });
  const c = codes(r);
  assert.ok(c.includes("catalog_count_mismatch"));
  assert.ok(c.includes("duplicate_key"));
  assert.ok(c.includes("donor_key_unsafe_or_missing"));
  assert.ok(c.includes("catalog_entry_malformed"));
  assert.equal(r.catalog.entryCount, 4);
});

test("malformed or missing services render targets are rejected; optional channels reported", () => {
  const fx = fixture([
    { key: "01-a", category: "x", targets: { services: [{ path: "/", selector: "  " }], faqs: [{ path: "/", selector: "#f" }] } },
    { key: "02-b", category: "x", targets: { reviews: [{ path: "/", selector: "#r" }] } },
    { key: "03-c", category: "x", targets: { services: [{ path: "/", selector: "#s" }], hours: "footer li" } },
  ]);
  const r = auditCatalog({ rootDir: fx.root, catalogPath: fx.catalogPath });
  assert.ok(r.donors[0].issueCodes.includes("render_target_malformed"));
  assert.deepEqual(r.donors[0].renderTargets.declaredChannels, ["faqs"]);
  assert.ok(r.donors[1].issueCodes.includes("services_render_target_missing"));
  assert.deepEqual(r.donors[2].renderTargets.malformedChannels, ["hours"]);
});

test("traversal, absolute paths and symlink escapes are refused without reading outside", (t) => {
  const outside = path.join(TMP, "outside-secret.txt");
  fs.writeFileSync(outside, "secret");
  const fx = fixture([{ key: "01-a", category: "x", mutateManifest: (m) => {
    m.bundle.files["../../../../outside-secret.txt"] = sha("secret");
    m.bundle.files["/etc/passwd"] = sha("x");
    m.bundle.files["C:/Windows/win.ini"] = sha("x");
    m.bundle.files["assets\\..\\x.js"] = sha("x");
    return m;
  } }]);
  let r = auditCatalog({ rootDir: fx.root, catalogPath: fx.catalogPath });
  const unsafe = r.issues.filter((i) => i.code === "unsafe_bundle_path").map((i) => i.detail.reason).sort();
  assert.deepEqual(unsafe, ["absolute_path", "absolute_path", "backslash_separator", "traversal_or_empty_segment"]);

  const link = path.join(fx.donorDir("01-a"), "bundle", "link.txt");
  try { fs.symlinkSync(outside, link); } catch { t.skip("symlinks not permitted on this host"); return; }
  const m = JSON.parse(fs.readFileSync(path.join(fx.donorDir("01-a"), "donor.json"), "utf8"));
  m.bundle.files = { "index.html": m.bundle.files["index.html"], "link.txt": sha("secret") };
  fs.writeFileSync(path.join(fx.donorDir("01-a"), "donor.json"), JSON.stringify(m));
  r = auditCatalog({ rootDir: fx.root, catalogPath: fx.catalogPath });
  const esc = r.issues.find((i) => i.code === "bundle_path_escape");
  assert.equal(esc.detail.path, "link.txt");
  assert.equal(fs.readFileSync(outside, "utf8"), "secret");
});

test("unreadable catalog and missing arguments fail closed", () => {
  assert.ok(codes(auditCatalog({})).includes("root_dir_missing"));
  const r = auditCatalog({ rootDir: TMP, catalogPath: path.join(TMP, "nope.json") });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes("catalog_unreadable"));
});

test("CLI prints JSON and uses exit codes 0/1/2", () => {
  const cli = path.join(__dirname, "catalog-audit.cjs");
  const fx = fixture([{ key: "01-a", category: "x" }]);
  const ok = spawnSync(process.execPath, [cli, `--root=${fx.root}`, `--catalog=${fx.catalogPath}`], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  fs.rmSync(path.join(fx.donorDir("01-a"), "mapping.cjs"));
  const bad = spawnSync(process.execPath, [cli, `--root=${fx.root}`, `--catalog=${fx.catalogPath}`], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(spawnSync(process.execPath, [cli], { encoding: "utf8" }).status, 2);
});
