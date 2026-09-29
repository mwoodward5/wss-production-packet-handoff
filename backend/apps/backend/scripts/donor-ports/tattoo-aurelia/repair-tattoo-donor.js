"use strict";

/**
 * scripts/donor-ports/tattoo-aurelia/repair-tattoo-donor.js
 *
 * TWO DONOR DEFECTS, FOUND ON A LIVE CUSTOMER PAGE 2026-08-11.
 *
 * 1. THE DONOR'S OWN MARKET, PUBLISHED AS THE CLIENT'S.
 *    wss-test-monolith-tattoo-co-nashville — a NASHVILLE tattoo studio —
 *    published South Congress, Cedar Park, Round Rock and Pflugerville as areas
 *    served. All four are Austin, Texas. The sanitiser tokenised the donor's
 *    city to {{CITY}} and left the four SUBURBS as literals, in three places
 *    that all have to agree:
 *
 *      · the JSON-LD `areaServed` array in all 7 prerendered pages,
 *      · the visible "Areas Served" rail in visit/index.html,
 *      · the `areasServed` array inside the client bundle, which re-renders
 *        that rail on every client-side navigation.
 *
 *    The list also carried {{CITY}} TWICE, which rendered "Nashville Nashville
 *    Downtown Nashville …" on the live page.
 *
 *    All three surfaces are rewritten together, and that is not tidiness: the
 *    prerendered HTML and the bundle's render must produce the same DOM or
 *    React tears the tree down on hydration (the concrete donor's manifest
 *    records the same lesson). Changing one without the other trades a donor
 *    leak for a #418.
 *
 * 2. AN HTML PAGE SERVED AS AN IMAGE, CARRYING THE DONOR'S REAL IDENTITY.
 *    og-home.jpg is not a JPEG. It is an 8,244-byte HTML document left over
 *    from the port, and it still contains AURELIA INK, aureliaink.com, Austin
 *    and the donor's 512 phone number — shipped at /og-home.jpg on every mirror
 *    built from this donor. The identity scan never saw it because it is named
 *    like a binary asset.
 *
 *    The prerendered pages already point og:image at the real hero poster; only
 *    the bundle still asks for /og-home.jpg. So the file is deleted and the
 *    bundle is repointed at the poster — no 404, and a social crawler gets an
 *    actual image.
 *
 * Idempotent: running it twice changes nothing the second time. Prints a
 * before/after count per file so the edit is auditable rather than asserted.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const DONOR = path.resolve(__dirname, "../../../donors-clean/tattoo-aurelia");
const HERO_POSTER = "/assets/hero-poster-Cn6qxxe4.jpg";

/** The donor's own market, verbatim. Only these four are removed. */
const DONOR_TOWNS = ["South Congress", "Cedar Park", "Round Rock", "Pflugerville"];

const REPLACEMENTS = [
  // JSON-LD, as it appears escaped inside the prerendered HTML.
  {
    what: "jsonld_area_served",
    find: '\\"areaServed\\":[{\\"@type\\":\\"City\\",\\"name\\":\\"{{CITY}}\\"},{\\"@type\\":\\"City\\",\\"name\\":\\"{{CITY}}\\"},{\\"@type\\":\\"City\\",\\"name\\":\\"Downtown {{CITY}}\\"},{\\"@type\\":\\"City\\",\\"name\\":\\"South Congress\\"},{\\"@type\\":\\"City\\",\\"name\\":\\"Cedar Park\\"},{\\"@type\\":\\"City\\",\\"name\\":\\"Round Rock\\"},{\\"@type\\":\\"City\\",\\"name\\":\\"Pflugerville\\"}]',
    to: '\\"areaServed\\":[{\\"@type\\":\\"City\\",\\"name\\":\\"{{CITY}}\\"},{\\"@type\\":\\"City\\",\\"name\\":\\"Downtown {{CITY}}\\"}]',
  },
  // The same array unescaped, in case a page ships it raw.
  {
    what: "jsonld_area_served_plain",
    find: '"areaServed":[{"@type":"City","name":"{{CITY}}"},{"@type":"City","name":"{{CITY}}"},{"@type":"City","name":"Downtown {{CITY}}"},{"@type":"City","name":"South Congress"},{"@type":"City","name":"Cedar Park"},{"@type":"City","name":"Round Rock"},{"@type":"City","name":"Pflugerville"}]',
    to: '"areaServed":[{"@type":"City","name":"{{CITY}}"},{"@type":"City","name":"Downtown {{CITY}}"}]',
  },
  // The visible rail on /visit.
  {
    what: "visible_area_rail",
    find: '<span class="tag">{{CITY}}</span><span class="tag">{{CITY}}</span><span class="tag">Downtown {{CITY}}</span><span class="tag">South Congress</span><span class="tag">Cedar Park</span><span class="tag">Round Rock</span><span class="tag">Pflugerville</span>',
    to: '<span class="tag">{{CITY}}</span><span class="tag">Downtown {{CITY}}</span>',
  },
  // The client bundle's data, which renders that rail after hydration.
  {
    what: "bundle_areas_served",
    find: "areasServed:[`{{CITY}}`,`{{CITY}}`,`Downtown {{CITY}}`,`South Congress`,`Cedar Park`,`Round Rock`,`Pflugerville`]",
    to: "areasServed:[`{{CITY}}`,`Downtown {{CITY}}`]",
  },
  // The OG image the bundle asks for.
  { what: "og_image_path", find: "/og-home.jpg", to: HERO_POSTER },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function main() {
  const apply = !process.argv.includes("--dry-run");
  const files = walk(DONOR);
  let edits = 0;

  for (const file of files) {
    const rel = path.relative(DONOR, file).replace(/\\/g, "/");
    if (rel === "og-home.jpg") continue;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch { continue; }
    let out = text;
    const hits = [];
    for (const r of REPLACEMENTS) {
      if (!out.includes(r.find)) continue;
      const n = out.split(r.find).length - 1;
      out = out.split(r.find).join(r.to);
      hits.push(`${r.what}x${n}`);
    }
    if (out === text) continue;
    edits += 1;
    const before = createHash("sha256").update(text).digest("hex").slice(0, 8);
    const after = createHash("sha256").update(out).digest("hex").slice(0, 8);
    console.log(`${apply ? "rewrote" : "would rewrite"} ${rel}  ${before}->${after}  ${hits.join(" ")}`);
    if (apply) fs.writeFileSync(file, out, "utf8");
  }

  const og = path.join(DONOR, "og-home.jpg");
  if (fs.existsSync(og)) {
    console.log(`${apply ? "deleted" : "would delete"} og-home.jpg (${fs.statSync(og).size} bytes of HTML carrying AURELIA INK / aureliaink.com / Austin)`);
    if (apply) fs.unlinkSync(og);
  }

  // PROVE IT, don't assert it: re-read the tree and count what is left.
  const residue = [];
  for (const file of walk(DONOR)) {
    const rel = path.relative(DONOR, file).replace(/\\/g, "/");
    // BOILERPLATE.json is the manifest whose JOB is to declare the donor's
    // identity atoms so the identity scan can refuse them. It is excluded here
    // for that reason — and it is separately proven not to ship: a live fetch of
    // /BOILERPLATE.json on three mirrors returns 404.
    if (rel === "BOILERPLATE.json") continue;
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const town of DONOR_TOWNS) {
      if (text.includes(town)) residue.push(`${rel}:${town}`);
    }
    for (const atom of ["AURELIA INK", "aureliaink", "(512) 555-0148"]) {
      if (text.includes(atom)) residue.push(`${rel}:${atom}`);
    }
  }
  console.log(`files changed: ${edits}`);
  console.log(`donor town / identity residue in tree: ${residue.length}`);
  for (const r of residue.slice(0, 20)) console.log("  RESIDUE", r);
  if (apply && residue.length) process.exitCode = 1;
}

main();
