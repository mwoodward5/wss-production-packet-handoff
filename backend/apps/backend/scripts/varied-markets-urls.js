"use strict";
// Emit the mailable hosts from a run as a --urls file for scripts/mailable-scan.js.
// Only rows the lane called REVEALABLE are written: scanning a refused build
// tells you nothing you did not already know, and pads the denominator.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

const inPath = path.join(ROOT, arg("list", "artifacts/varied-markets-run2.json"));
const outPath = path.join(ROOT, arg("out", "artifacts/varied-markets-urls.txt"));
const rows = JSON.parse(fs.readFileSync(inPath, "utf8"));
const all = arg("all", "") === "true";
const keep = rows.filter((r) => r.url && (all || r.revealable));
fs.writeFileSync(outPath, keep.map((r) => r.url).join("\n") + "\n");
console.log(`${keep.length} host(s) -> ${outPath}`);
for (const r of keep) console.log(`  ${r.revealable ? "revealable" : "REFUSED   "} ${r.name} — ${r.url}`);
const refused = rows.filter((r) => !r.revealable);
if (refused.length) {
  console.log(`\nnot written (${refused.length} refused):`);
  for (const r of refused) console.log(`  ${r.name}: ${r.reason || "unknown"}${r.detail ? ` — ${String(r.detail).slice(0, 120)}` : ""}`);
}
