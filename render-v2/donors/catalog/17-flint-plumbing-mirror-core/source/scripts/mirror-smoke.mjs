#!/usr/bin/env node
/**
 * MIRROR:TOOLING — blank-config smoke test.
 *   bun run mirror:smoke
 * Temporarily swaps trust.config.ts for the blank config, builds, and restores.
 * A mirror is only safe to ship if the template survives a client with almost
 * no harvested data: every widget must render null instead of an empty shell.
 */
import { copyFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const target = "src/trust.config.ts";
const backup = "src/trust.config.ts.smoke-backup";

const blank = `import { blankTrustConfig, defineTrustConfig } from "@/trust-widgets/trust.config";
export const trustConfig = defineTrustConfig({
  ...blankTrustConfig,
  business: { ...blankTrustConfig.business, name: "Smoke Test Co", url: "https://example.com" },
});
export type { TrustConfig } from "@/trust-widgets/trust.config";
`;

if (!existsSync(target)) {
  console.error("src/trust.config.ts not found");
  process.exit(1);
}

copyFileSync(target, backup);
let code = 0;
try {
  writeFileSync(target, blank);
  execSync("bun run build", { stdio: "inherit" });
  console.log("\nmirror:smoke passed — the template builds against a near-empty config.");
} catch {
  code = 1;
  console.error("\nmirror:smoke FAILED — a widget depends on data that may not exist.");
} finally {
  copyFileSync(backup, target);
  rmSync(backup);
}
process.exit(code);
