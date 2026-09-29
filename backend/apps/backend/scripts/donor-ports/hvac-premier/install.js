"use strict";
/* Install the sanitized HVAC Premier build into donors-clean.
 *
 * Source convention is [TOKEN]; the installed donor lane uses the double-brace
 * form. The conversion runs on the COMPILED output, never on .tsx source: a
 * bare double-brace token in a JSX text position is a parse error, and this
 * lane has lost a day to that before.
 *
 * Run AFTER `npx vite build` in the donor source tree.
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC = "C:/Users/Main/Documents/Dark Signal/site-forge-lane/donors/hvac-premier-src/dist";
const OUT = path.join(__dirname, "..", "..", "..", "donors-clean", "hvac-premier");

// Source-name -> engine-token name. Anything unlisted keeps its own name.
const RENAME = { ST: "STATE" };
// Two chars minimum: [ST] is a real token and a three-char floor silently
// shipped it unconverted the first time this pattern was used.
const TOKEN_RE = /\[([A-Z][A-Z0-9_]{1,24})\]/g;
const KNOWN = new Set([
  "BUSINESS_NAME", "PHONE", "PHONE_DIGITS", "EMAIL", "LOGO_URL", "CITY", "ST", "STATE",
  "COUNTY", "REGION", "PLACE_ID", "PROFILE_URL", "SITE_URL", "ADDRESS", "ADDRESS_CITY",
  "ZIP", "POSTAL", "RATING", "REVIEW_COUNT", "OWNER_NAME", "LICENSE", "HERO_HEADLINE",
  "HERO_BADGE", "HERO_ACCENT", "GEO_LAT", "GEO_LNG", "DOMAIN",
]);

const convert = (text) => text.replace(TOKEN_RE, (whole, name) =>
  (KNOWN.has(name) ? "{{" + (RENAME[name] || name) + "}}" : whole));

// The manifest is authored by hand and lives WITH the installed donor; a
// reinstall must not delete it.
let keptManifest = null;
try { keptManifest = fs.readFileSync(path.join(OUT, "BOILERPLATE.json")); } catch { /* first install */ }
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const TEXT_EXT = new Set([".html", ".js", ".css", ".json", ".txt", ".xml", ".svg", ".webmanifest"]);
const copied = [];
let converted = 0;

(function walk(dir, rel) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      fs.mkdirSync(path.join(OUT, relPath), { recursive: true });
      walk(from, relPath);
      continue;
    }
    if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) {
      const before = fs.readFileSync(from, "utf8");
      const after = convert(before);
      if (after !== before) converted++;
      fs.writeFileSync(path.join(OUT, relPath), after);
    } else {
      fs.copyFileSync(from, path.join(OUT, relPath));
    }
    copied.push(relPath);
  }
})(SRC, "");

if (keptManifest) fs.writeFileSync(path.join(OUT, "BOILERPLATE.json"), keptManifest);
console.log(`copied ${copied.length} files, ${converted} token-converted${keptManifest ? ", manifest preserved" : ""}`);

// ── proof: what actually shipped ────────────────────────────────────────────
const shipped = copied
  .filter((f) => /\.(html|js|css)$/i.test(f))
  .map((f) => fs.readFileSync(path.join(OUT, f), "utf8"))
  .join("\n");

const IDENTITY = [
  ["Texan", /Texan/i], ["Waller", /Waller/i], ["their phone", /832[^0-9]?473[^0-9]?7554|\+?18324737554/],
  ["their email", /pywaller@yahoo\.com/i], ["their domain", /texanshvac/i],
  ["their place id", /ChIJySEI8YvTRoYRpOmeY_OruKU/],
  ["neighbour towns", /Hockley|Prairie View|Hempstead|Magnolia|Tomball|Cypress|Brookshire|Pattison|Pinehurst/i],
];
console.log("\ntokens in installed donor:", [...new Set([...shipped.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))].sort().join(" "));
console.log("stray [TOKEN] left      :", [...new Set([...shipped.matchAll(TOKEN_RE)].map((m) => m[0]))].join(" ") || "none");
let clean = true;
for (const [label, re] of IDENTITY) {
  const hit = re.test(shipped);
  if (hit) clean = false;
  console.log(`${label.padEnd(24)}: ${hit ? "PRESENT — FAIL" : "none"}`);
}
console.log("images shipped          :", copied.filter((f) => /\.(jpg|png|webp|mp4)$/i.test(f)).join(" ") || "(none)");
console.log(clean ? "\nIDENTITY CLEAN" : "\nIDENTITY LEAK — do not install");
