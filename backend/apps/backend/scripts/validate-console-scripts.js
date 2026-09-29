"use strict";
// Parse-check every inline <script> in the served /console page.
// Follows the route's own PAGE require so the guard always inspects whatever
// api/admin/console.js actually serves (today lib/console-page; the
// 2026-08-19 login-recovery era served lib/operator-workspace-login-hotfix).
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const routeSource = fs.readFileSync(path.join(__dirname, "../api/admin/console.js"), "utf8");
const pageRequire = routeSource.match(/const PAGE = require\("([^"]+)"\);/);
if (!pageRequire) {
  console.log("cannot find the PAGE require in api/admin/console.js");
  process.exit(1);
}
const page = require(path.join(__dirname, "../api/admin", pageRequire[1]));
const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
let m;
let i = 0;
let bad = 0;
while ((m = re.exec(page))) {
  i++;
  try {
    new vm.Script(m[1]);
    console.log(`script ${i}: OK (${m[1].length} chars)`);
  } catch (e) {
    bad++;
    console.log(`script ${i}: SYNTAX ERROR: ${e.message}`);
    const lines = m[1].split("\n");
    const ln = Number((e.stack.match(/:(\d+)\n/) || [])[1]) || 0;
    if (ln) console.log(`  near line ${ln}: ${String(lines[ln - 1] || "").slice(0, 300)}`);
  }
}
// Also flag regex-escape corruption from the unescaped template literal.
for (const marker of ["/s+ins+", "/w/g,", "/s+nationwide"]) {
  if (page.includes(marker)) console.log(`corrupted-regex marker present: ${marker}`);
}
process.exit(bad ? 1 : 0);
