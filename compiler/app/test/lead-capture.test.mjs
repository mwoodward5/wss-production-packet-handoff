import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { wireLeadCapture } from "../lib/lead-capture.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "sf-lead-wire-"));
writeFileSync(path.join(dir, "index.html"), '<form class="quote-form" action="mailto:hello@example.com" method="get"><input name="name"></form>');
const result = wireLeadCapture(dir, { project: { id: "proj_test", lead_token: "secret" }, publicUrl: "https://siteforge.example/" });
const html = readFileSync(path.join(dir, "index.html"), "utf8");
assert.deepEqual(result, { files: 1, forms: 1 });
assert.match(html, /action="https:\/\/siteforge\.example\/api\/leads\/proj_test" method="post"/);
assert.match(html, /name="lead_token" value="secret"/);
assert.doesNotMatch(html, /mailto:/);

console.log("Lead capture wiring tests: passed");
