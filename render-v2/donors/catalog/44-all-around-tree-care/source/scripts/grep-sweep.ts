#!/usr/bin/env bun
/**
 * grep-sweep — fails if any placeholder or known previous-client
 * strings remain in src/ after intake has been applied.
 * Usage: bun run scripts/grep-sweep.ts
 */
import { execSync } from "node:child_process";

const FORBIDDEN = [
  "{{BUSINESS_NAME}}", "{{TAGLINE}}", "{{SHORT_DESCRIPTION}}",
  "{{SERVICE_AREA_LABEL}}", "{{PHONE}}", "{{EMAIL}}", "{{SHORT_NAME}}",
  "{{FULL_ADDRESS}}",
  // Previous-client tombstones — extend per remix:
  "Pinnacle Home Services", "pinnaclehomeservices", "Murphy, TX",
];

let failed = 0;
for (const needle of FORBIDDEN) {
  try {
    const out = execSync(
      `rg -n --hidden -g '!node_modules' -g '!.lovable' -g '!intake' -g '!scripts/grep-sweep.ts' --fixed-strings ${JSON.stringify(needle)} src public 2>/dev/null || true`,
      { encoding: "utf8" },
    ).trim();
    if (out) {
      console.error(`\n✗ Forbidden string "${needle}" found:\n${out}`);
      failed++;
    }
  } catch { /* rg returns non-zero when no matches */ }
}
if (failed) {
  console.error(`\nsweep failed: ${failed} forbidden strings still present.`);
  process.exit(1);
}
console.log("✓ sweep clean — no placeholders or known client strings remain.");
