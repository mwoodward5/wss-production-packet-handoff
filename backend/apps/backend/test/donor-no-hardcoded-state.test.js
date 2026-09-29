"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const forge = require("../lib/forge.js");

// REGRESSION LOCK (2026-07-29).
//
// The donor operated in Washington and its state was hardcoded throughout. The
// JS bundle was de-hardcoded, but index.html was MISSED — including <title> and
// every og:/twitter: tag. Live proof: sunset-roofing-llc-tucson.wss-ai.com
// served a correct bundle ("Tucson, AZ") while its page title and social
// preview said "Tucson, WA" 14 times, for an Arizona business.
//
// This scans EVERY hydrated file, not just the bundle, because that asymmetry
// is precisely what hid the defect.

const BOILERPLATES = path.join(__dirname, "..", "boilerplates");
const HYDRATED = /\.(html|js|css|json|txt|svg|xml|webmanifest)$/i;

test("no donor ships a hardcoded US state literal", () => {
  const offenders = [];
  for (const donor of fs.readdirSync(BOILERPLATES)) {
    const dir = path.join(BOILERPLATES, donor);
    if (!fs.statSync(dir).isDirectory()) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!HYDRATED.test(e.name)) continue;
        const text = fs.readFileSync(full, "utf8");
        const hits = text.match(/,\s(?:WA|OH|TX|AZ|CA|FL|NY|NC)\b/g) || [];
        if (hits.length) {
          offenders.push(`${donor}/${path.relative(dir, full)}: ${hits.length}x ${hits[0].trim()}`);
        }
      }
    };
    walk(dir);
  }
  assert.deepEqual(offenders, [], "state must come from {{STATE}}, never a literal");
});

test("a hydrated page renders the prospect's real state everywhere", () => {
  const files = forge.hydrateBoilerplate({
    boilerplate: "roofing-tekline",
    prospect: {
      business_name: "Sunset Roofing, LLC",
      phone: "(520) 400-1741",
      city: "Tucson",
      state: "AZ",
      county: "Pima County",
      industry: "roofing",
      preview_host: "x.wss-ai.com",
    },
    dossier: {},
  });
  for (const [rel, buf] of Object.entries(files)) {
    if (!HYDRATED.test(rel)) continue;
    const text = buf.toString("utf8");
    assert.doesNotMatch(text, /Tucson, WA/, `donor state survived in ${rel}`);
  }
  const html = files["index.html"].toString("utf8");
  assert.match(html, /<title>[^<]*Tucson, AZ<\/title>/, "the page title is the customer's first impression");
});

test("our own agency phone is not treated as a customer contradiction", () => {
  // The preview carries a WSS sales overlay with Riley's line. It will never be
  // in a prospect's dossier, and it blocked a real mirror on 9493395562.
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "forge.js"), "utf8");
  assert.match(src, /ourPhones/, "the audit must exempt our own numbers");
  assert.match(src, /if \(ourPhones\.has\(p\)\) continue;/);
});
