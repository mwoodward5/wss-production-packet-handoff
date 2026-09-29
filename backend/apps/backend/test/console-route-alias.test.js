const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Vercel serves the owner console at /console", () => {
  const configPath = path.join(__dirname, "..", "vercel.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.ok(
    config.rewrites?.some(
      (rewrite) =>
        rewrite.source === "/console" &&
        rewrite.destination === "/api/admin/console",
    ),
    "expected /console to rewrite to /api/admin/console",
  );
});
