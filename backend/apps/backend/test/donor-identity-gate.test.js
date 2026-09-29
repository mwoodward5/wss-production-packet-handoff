"use strict";

// test/donor-identity-gate.test.js — THE IDENTITY GATE MUST ACTUALLY FIRE.
//
// The defect this locks down: lib/mirror-engine/scan.js identityScan() builds
// its scan atoms ONLY from BOILERPLATE.json fields (donor_business_name,
// donor_phone, donor_email, donor_city, donor_county, donor_domain, persons[],
// socials[], zips[], geo[], account_ids[]). concrete-elconstruction declared
// NONE of them, so lib/gate-a-scan.js built an empty token list, scanFiles()
// returned clean:true for ANY bytes, and engine.js still reported
// identity_scan:{status:"passed"}. A gate that cannot fail is not a gate — and
// it was indistinguishable from a real pass in the build manifest.
//
// A donor manifest never ships (hydrate.js drops BOILERPLATE.json from the
// output tree), so declaring the donor's identity here leaks nothing. It is
// read from disk by donor.js readManifest() purely to feed this scan.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { identityScan } = require("../lib/mirror-engine/scan");
const { scanFiles } = require("../lib/gate-a-scan");

const DONOR_ROOT = path.join(__dirname, "..", "donors-clean");
const readManifest = (name) =>
  JSON.parse(fs.readFileSync(path.join(DONOR_ROOT, name, "BOILERPLATE.json"), "utf8"));

const ATOM_FIELDS = [
  "donor_business_name", "business_name", "identity_name",
  "donor_phone", "phone", "donor_email", "email",
  "donor_city", "city", "donor_county", "county", "donor_domain", "domain",
  "persons", "owner", "owner_name", "socials", "zips", "geo", "account_ids",
];
const hasAtoms = (m) => ATOM_FIELDS.some((f) => {
  const v = m[f];
  if (Array.isArray(v)) return v.some((x) => x && String(x).length >= 4);
  return v && String(v).length >= 4;
});

test("EVERY installed donor declares identity atoms — an inert gate can never ship again", () => {
  const donors = fs.readdirSync(DONOR_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(DONOR_ROOT, e.name, "BOILERPLATE.json")))
    .map((e) => e.name);
  assert.ok(donors.length >= 5, `expected the donor library, found ${donors.length}`);
  for (const name of donors) {
    assert.ok(hasAtoms(readManifest(name)),
      `${name}/BOILERPLATE.json declares no identity atoms — identityScan would return clean:true for any bytes`);
  }
});

test("a shadowed-identity build is BLOCKED, not silently passed", () => {
  const manifest = readManifest("concrete-elconstruction");
  // A hydrated output that leaked the donor's own NAP back into the tree.
  const leaked = {
    "index.html": Buffer.from(
      "<html><body><footer>EL Construction &middot; (480) 256-2343 &middot; " +
      "elconstructionaz@gmail.com &middot; Tempe &middot; Maricopa County &middot; " +
      "elconstructionaz.com &middot; 85281</footer></body></html>", "utf8"),
  };
  const result = identityScan(leaked, manifest);
  assert.strictEqual(result.clean, false, "identityScan passed a build carrying the donor's own identity");
  const buckets = [...new Set(result.hits.map((h) => h.bucket))].sort();
  for (const expected of ["name", "phone", "email", "city", "county", "domain", "zips"]) {
    assert.ok(buckets.includes(expected), `no ${expected} hit — buckets were ${buckets.join(",")}`);
  }
});

test("the clean installed donor still passes — the atoms cause no false positives", () => {
  for (const name of ["concrete-elconstruction", "fencing-sterling"]) {
    const dir = path.join(DONOR_ROOT, name);
    const files = {};
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name !== "BOILERPLATE.json") {
          files[path.relative(dir, full).split(path.sep).join("/")] = fs.readFileSync(full);
        }
      }
    })(dir);
    const result = identityScan(files, readManifest(name));
    assert.strictEqual(result.clean, true,
      `${name} tripped its own gate: ${JSON.stringify(result.hits.slice(0, 5))}`);
  }
});

test('word-boundary matching: "Tempe" must not fire on "temperature"', () => {
  // The trap that kept the real donor city out of the manifest. Concrete cure
  // and control-joint copy legitimately says "temperature"; a substring matcher
  // reported every one of them and would have hard-failed every concrete build.
  const copy = [{ file: "a.html", bytes: Buffer.from(
    "All concrete moves as it cures and as temperature changes. In temperature extremes, cure with blankets.", "utf8") }];
  assert.strictEqual(scanFiles(copy, { city: "Tempe" }).clean, true,
    '"temperature" was matched as the donor city "Tempe"');

  // ...but the real city, in every shape it actually ships in, must still fire.
  for (const leak of ["Serving Tempe and the East Valley", "Tempe, AZ 85281", "/service-area/tempe"]) {
    const files = [{ file: "a.html", bytes: Buffer.from(leak, "utf8") }];
    assert.strictEqual(scanFiles(files, { city: "Tempe" }).clean, false,
      `real donor-city leak went undetected: ${leak}`);
  }
});

test("multi-word alphabetic atoms still match, and digits keep substring matching", () => {
  const county = [{ file: "a.html", bytes: Buffer.from("Crews across all of Maricopa County", "utf8") }];
  assert.strictEqual(scanFiles(county, { county: "Maricopa County" }).clean, false);

  // A ZIP embedded in a longer string must still be caught: word boundaries are
  // meaningless for digit runs, so those keep substring semantics.
  const zip = [{ file: "a.html", bytes: Buffer.from('{"postalCode":"85281"}', "utf8") }];
  assert.strictEqual(scanFiles(zip, { zips: ["85281"] }).clean, false);
});
