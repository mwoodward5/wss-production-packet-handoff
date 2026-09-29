import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { loadTemplateLibrary } from "../lib/template-library.mjs";
import { templatesPage } from "../views/pages-templates.mjs";

const library = loadTemplateLibrary();
assert.equal(library.source, "lovable-v5-verified");
assert.equal(library.inventory_total, 200);
assert.ok(library.templates.length >= 5);

for (const template of library.templates) {
  assert.match(template.screenshot_url || "", /^\/template-library\/.+\.webp$/);
  assert.match(template.source_url || "", /^https:\/\//);
  assert.notEqual(template.source, "siteforge-seed");
}

const document = new JSDOM(templatesPage({ user: null, library, filters: {} })).window.document;
assert.equal(document.querySelectorAll(".template-card").length, library.templates.length);
assert.equal(document.querySelectorAll(".template-card .tpl-poster").length, library.templates.length);
assert.match(document.body.textContent || "", /Real sites, not wireframes/i);
assert.match(document.body.textContent || "", /200 archived Lovable projects/i);
assert.doesNotMatch(document.body.textContent || "", /6 website styles available/i);

console.log("Verified template library tests: passed");
