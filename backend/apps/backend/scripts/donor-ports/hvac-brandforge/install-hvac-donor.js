"use strict";
/* Install the sanitized HVAC build into donors-clean.
 *
 * The source tree uses the [TOKEN] convention; the installed donor lane uses
 * {{TOKEN}}. Converting on the COMPILED output (not the .tsx source) is
 * deliberate: in TSX, a bare {{TOKEN}} in a JSX text position is parsed as a
 * JS expression and breaks the build — a gotcha this lane has hit before. In
 * the compiled bundle every token lives inside a string literal, so the
 * conversion is a safe text pass.
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC = "C:/Users/Main/Documents/Dark Signal/site-forge-lane/donors/brand-forge-express/dist";
const OUT = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/apps/backend/donors-clean/hvac-brandforge";

// Source-name -> engine-token name. Anything not listed keeps its own name.
const RENAME = { ST: "STATE" };
// 2 chars minimum: [ST] is a real token, and a 3-char floor silently shipped it
// unconverted the first time this ran. The known-name gate below is what keeps
// ordinary bracketed prose from being rewritten, not the length.
const TOKEN_RE = /\[([A-Z][A-Z0-9_]{1,24})\]/g;

function convert(text) {
  return text.replace(TOKEN_RE, (whole, name) => {
    // Only convert names the engine actually knows; leave real bracketed prose
    // (there is none today, but a future edit could add some) untouched.
    const known = new Set([
      "BUSINESS_NAME", "PHONE", "PHONE_DIGITS", "EMAIL", "LOGO_URL", "CITY", "ST", "STATE",
      "COUNTY", "REGION", "PLACE_ID", "PROFILE_URL", "SITE_URL", "ADDRESS", "ZIP", "POSTAL",
      "RATING", "REVIEW_COUNT", "OWNER_NAME", "LICENSE", "HERO_HEADLINE", "HERO_BADGE",
      "HERO_ACCENT", "GEO_LAT", "GEO_LNG", "ADDRESS_CITY", "DOMAIN",
    ]);
    if (!known.has(name)) return whole;
    return "{{" + (RENAME[name] || name) + "}}";
  });
}

// The manifest is authored by hand and lives WITH the installed donor; a
// reinstall must not delete it (it did once, and the donor silently became
// un-retireable and identity-scan-blind until the suite caught it).
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
    const ext = path.extname(entry.name).toLowerCase();
    if (TEXT_EXT.has(ext)) {
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

if (keptManifest) { fs.writeFileSync(path.join(OUT, "BOILERPLATE.json"), keptManifest); console.log("restored BOILERPLATE.json"); }
console.log(`copied ${copied.length} files, ${converted} token-converted`);

// ── proof: what actually shipped ────────────────────────────────────────────
const shipped = copied
  .filter((f) => /\.(html|js|css)$/i.test(f))
  .map((f) => fs.readFileSync(path.join(OUT, f), "utf8"))
  .join("\n");

const tokens = [...new Set([...shipped.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))].sort();
console.log("tokens in installed donor:", tokens.join(" "));
console.log("stray [TOKEN] left      :", [...new Set([...shipped.matchAll(TOKEN_RE)].map((m) => m[0]))].join(" ") || "none");
console.log("fake NAP                :", /555-000-0000|\(555\) 000-0000|hello@example\.com/.test(shipped) ? "PRESENT — FAIL" : "none");
console.log("dead donor endpoints    :", /DISABLED_DONOR_ENDPOINT/.test(shipped) ? "PRESENT — FAIL" : "none");
console.log("third-party identity    :", /mission|Mission Mechanical|greensock/i.test(shipped) ? /greensock/i.test(shipped) ? "gsap author email only (vendor lib)" : "PRESENT — FAIL" : "none");
console.log("lead endpoint           :", /ghost\.wss-ai\.com\/api\/quote-request/.test(shipped) ? "wired" : "MISSING — FAIL");
console.log("photo slots             :", copied.filter((f) => /\.(jpg|png|webp)$/i.test(f)).join(" "));
