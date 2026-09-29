import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const v8Modules = [
  "asset-pipeline/firecrawl-gbp-merge.mjs",
  "factory/lib/chromium-runtime.mjs",
  "factory/lib/premier-composer.mjs",
  "factory/lib/premier-map.mjs",
  "factory/lib/premier-media.mjs",
  "factory/pipeline/05-build-v8.mjs",
  "factory/pipeline/premier-visual-contract.mjs",
];

const renderTest = "factory/pipeline/05-build-v8.preview-contact.test.mjs";
const v8Tests = [
  "app/test/chromium-runtime.test.mjs",
  "app/test/generated-site-contract.test.mjs",
  "app/test/ghost-release-contract.test.mjs",
  "app/test/pipeline-scrape-media.test.mjs",
  "app/test/premier-composer.test.mjs",
  "app/test/premier-media-map.test.mjs",
  "app/test/premier-visual-qc.test.mjs",
  "app/test/v8-qc-contract.test.mjs",
  "asset-pipeline/firecrawl-gbp-merge.test.mjs",
  renderTest,
];

const syntaxEntries = ["api/index.mjs", "app/server.mjs", ...v8Modules];
const failures = [];

for (const relativePath of [...syntaxEntries, ...v8Tests]) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    failures.push(`required release file is missing: ${relativePath}`);
  }
}

const staticOutput = path.join(root, "app/public");
if (!existsSync(staticOutput) || !statSync(staticOutput).isDirectory() || readdirSync(staticOutput).length === 0) {
  failures.push("Vercel output directory is missing or empty: app/public");
}

for (const packageName of ["@sparticuz/chromium-min", "playwright-core"]) {
  try {
    require.resolve(packageName);
  } catch {
    failures.push(`required serverless dependency is not installed: ${packageName}`);
  }
}

if (failures.length) {
  console.error(`SITEFORGE V8 RELEASE GATE FAILED\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

await import("./verify-production-ui-lock.mjs");

function runNode(label, args, env = process.env) {
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const relativePath of syntaxEntries) {
  runNode(`syntax ${relativePath}`, ["--check", relativePath]);
}

// Contract tests do not need browser captures; avoid downloading Chromium in the build container.
const testEnv = {
  ...process.env,
  SITEFORGE_SERVERLESS: "1",
  SITEFORGE_CHROMIUM_PACK_URL: "http://release-gate.invalid/chromium-pack.tar",
};
const fastTests = v8Tests.filter((relativePath) => relativePath !== renderTest);
runNode("V8 fast release tests", ["--test", "--test-concurrency=4", ...fastTests], testEnv);

runNode("V8 render contract", ["--test", "--test-concurrency=1", renderTest]);

console.log("SiteForge V8 release gate: passed");
