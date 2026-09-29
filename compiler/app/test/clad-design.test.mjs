import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { landing } from "../views/page-home-prompt.mjs";

const dom = new JSDOM(landing({ user: null }));
const document = dom.window.document;
const form = document.querySelector("#intake-genie-form.prompt-composer");

assert.ok(document.querySelector(".prompt-hero-video"), "cinematic hero media is required");
assert.ok(form, "the single AI intake composer is required");
assert.equal(form.querySelectorAll("textarea").length, 1, "intake must remain one natural-language prompt");
assert.equal(form.querySelectorAll('input[name="name"], input[name="city"], input[name="category"], select[name="state"]').length, 0, "breadcrumb fields must not replace the AI composer");
assert.equal(form.dataset.endpoint, "/api/try/intake");
assert.ok(form.querySelector("[data-voice-button]"), "voice intake is required");
assert.ok(form.querySelector('input[type="file"][accept*=".zip"]'), "ZIP and media intake is required");
assert.ok(form.querySelector("[data-drive-button]"), "Google Drive intake is required");
assert.deepEqual([...form.querySelectorAll("[data-source-chip]")].map((chip) => chip.dataset.sourceChip), ["website", "gbp", "social", "asset", "files"]);
assert.match(form.textContent || "", /Make my free preview/i);

console.log("AI intake design contract tests: passed");
