const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const candidates = [
  path.resolve(__dirname, "../../../scripts/three-kitchen-gate.mjs"),
  path.resolve(__dirname, "../scripts/three-kitchen-gate.mjs"),
];

const gate = candidates.find((file) => existsSync(file));

if (!gate) {
  console.log("Prebuild gate skipped: three-kitchen gate is not bundled in this backend-only deploy context.");
  process.exit(0);
}

const result = spawnSync(process.execPath, [gate], {
  stdio: "inherit",
  cwd: path.dirname(gate),
});

process.exit(result.status || 0);
