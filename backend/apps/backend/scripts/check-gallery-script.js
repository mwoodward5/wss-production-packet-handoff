"use strict";

// Parse-check the browser JavaScript embedded in lib/gallery-page.js. The page
// is a template literal, so a syntax error inside it is invisible to require()
// and only shows up as a blank page in a real browser.

const vm = require("node:vm");
const PAGE = require("../lib/gallery-page");

const scripts = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (!scripts.length) {
  console.error("NO <script> BLOCK FOUND");
  process.exit(1);
}

let failed = false;
scripts.forEach((source, index) => {
  try {
    new vm.Script(source, { filename: `gallery-inline-${index}.js` });
    console.log(`script ${index}: parses (${source.length} chars)`);
  } catch (error) {
    failed = true;
    console.error(`script ${index}: SYNTAX ERROR — ${error.message}`);
  }
});

// Cheap sanity checks the parser cannot make.
const required = [
  "openDrawer", "closeDrawer", "renderDrawer", "renderContactBlock",
  "renderPickBlock", "renderSiteBlock", "renderWorkBlock", "renderSendBlock",
  "renderNotesBlock", "renderHistoryBlock", "detailRow", "whenText",
];
for (const name of required) {
  if (!PAGE.includes(`function ${name}(`)) {
    failed = true;
    console.error(`MISSING FUNCTION: ${name}`);
  }
}

// Every element the script reaches for must exist in the markup.
for (const id of ["detailDrawer", "drawerScrim", "drawerTitle", "drawerSub", "drawerBody", "drawerClose", "detailsTemplate"]) {
  if (!PAGE.includes(`id="${id}"`)) {
    failed = true;
    console.error(`MISSING ELEMENT ID: ${id}`);
  }
}

// No data may be injected as HTML.
const innerHtmlWithData = /innerHTML\s*=\s*[^"']/.test(PAGE.replace(/innerHTML\s*=\s*""/g, ""));
if (innerHtmlWithData) {
  failed = true;
  console.error("innerHTML is being assigned something other than an empty string");
}

console.log(failed ? "FAILED" : "OK");
process.exit(failed ? 1 : 0);
