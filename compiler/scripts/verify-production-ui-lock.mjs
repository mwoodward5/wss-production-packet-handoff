import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Preview-environment short-circuit — codex feature branches must be able
// to deploy previews without touching the UI lock. The lock still applies
// to Production deploys (VERCEL_ENV === 'production'), which is where the
// canonical UI contract is enforced.
if (process.env.VERCEL && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  console.log(`SiteForge production UI lock: skipped for non-production environment (VERCEL_ENV=${process.env.VERCEL_ENV})`);
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(root, "app/config/production-ui-lock.json"), "utf8"));
const failures = [];

for (const [relative, expected] of Object.entries(lock.files)) {
  const content = readFileSync(path.join(root, relative));
  const actual = createHash("sha256").update(content).digest("hex");
  if (actual !== expected) failures.push(`${relative} changed (${actual}); update the production UI lock deliberately after visual approval`);
}

const home = readFileSync(path.join(root, "app/views/page-home-prompt.mjs"), "utf8");
const gallery = readFileSync(path.join(root, "app/views/pages-templates.mjs"), "utf8");
for (const marker of ["intake-genie-form", "prompt-composer", 'data-source-chip="website"', "data-voice-button", ".zip"]) {
  if (!home.includes(marker)) failures.push(`approved AI intake marker missing: ${marker}`);
}
if (home.includes("clad-prompt-bar")) failures.push("forbidden four-field CLAD intake returned");
for (const marker of ["Real sites, not wireframes", "template-card", "Visit finished site"]) {
  if (!gallery.includes(marker)) failures.push(`approved example-gallery marker missing: ${marker}`);
}

if (process.env.VERCEL) {
  const productionRef = String(process.env.VERCEL_GIT_COMMIT_REF || "").trim();
  if (process.env.VERCEL_ENV === "production" && productionRef && productionRef !== lock.canonical_branch) {
    failures.push(`production deploys require Git branch ${lock.canonical_branch}; Vercel received ${productionRef}`);
  }
} else {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
    const remotes = execFileSync("git", ["remote", "-v"], { cwd: root, encoding: "utf8" });
    if (branch !== lock.canonical_branch) failures.push(`production deploys require branch ${lock.canonical_branch}; current branch is ${branch || "detached"}`);
    if (!remotes.includes(lock.canonical_repository)) failures.push(`canonical GitHub remote is missing: ${lock.canonical_repository}`);
  } catch (error) {
    failures.push(`could not verify canonical git checkout: ${error.message}`);
  }
}

if (failures.length) {
  console.error("SITEFORGE PRODUCTION UI LOCK FAILED\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("SiteForge production UI lock: verified");
