"use strict";

// lib/mirror-engine/scan.js — pre-deploy scans over the HYDRATED output.
//
// Every check here runs against the files the customer will receive
// (acceptance test 1), never against donor source. Two scans gate the deploy:
//
//   tokenScan    — zero raw {{TOKEN}} anywhere (test 6). The hydrator already
//                  hard-fails on this; the scan is the independent backstop.
//   identityScan — zero donor identity atoms survive (tests 2, 3, 5): names,
//                  phones, emails, cities, domains from the donor manifest
//                  (gate-a-scan encodings incl. %20/+/entity/base64 variants),
//                  donor brand asset filenames, and donor asset bytes by md5.
//
// A hit is 500 donor_identity_detected — an engine/donor defect, never a
// caller error, and never a warning.

const { TOKEN_RE } = require("./tokens");
const { scanFiles } = require("../gate-a-scan");
const { donorBrandAssets } = require("../capture-brand");
const { HYDRATE_EXTS } = require("./tokens");
const { clientPlaceAtoms, isClientPlace } = require("./area-fence");
const path = require("node:path");

// A PLACE is the one class of identity atom the client can legitimately share
// with the donor. Two contractors in the same town have the same town; neither
// owns it. When the prospect's OWN verified truth names the place, the words on
// the page are the client's, not residue, and the gate must not fire.
//
// Everything outside this set stays FULLY authoritative and unfilterable:
// name, phone, email, domain, account_ids, zips, asset_md5, donor_brand_asset.
// Those are hard identity — nobody shares a phone number or a domain — and a
// match on one is a leak no matter whose city it sits next to.
//
// `geo` folds to "33 5327396" and can never equal a place name, so the PLACE
// excuse can never reach it. It has its own, coordinate-shaped excuse below
// (isClientGeo): the client's verified pin is their own, and the donor's is
// still a leak.
const CLIENT_SHAREABLE_PLACE_BUCKETS = new Set(["city", "county", "socials", "geo"]);

// concrete-elconstruction's original identity manifest copied a set of Phoenix-
// metro SERVICE MARKETS into `socials`. They are not donor identity: they are
// places the donor template talked about serving. Keeping them in the identity
// atom list makes a legitimate Phoenix/Scottsdale/etc prospect fail after the
// hydrator correctly writes the prospect's own verified city into the page.
//
// Keep this donor-specific and explicit. Actual identity remains gated through
// donor_business_name, donor_phone, donor_email, donor_city (Tempe), county,
// domain, account ids, URLs/handles, and donor asset bytes. This fixes the
// known Arizona false-positive without weakening identity checks for any other
// donor or allowing EL Construction residue through.
const CONCRETE_SERVICE_MARKET_ATOMS = new Set([
  "phoenix",
  "scottsdale",
  "chandler",
  "glendale",
  "avondale",
  "ahwatukee",
  "queen creek",
  "apache junction",
  "paradise valley",
  "arizona",
]);

// FORGE-PLACEHOLDER PROSE IS RESIDUE, AND IT BLOCKS. Glo Med Spa's live About
// section shipped the donor's own admission — "This placeholder copy describes
// the practice's philosophy … the forge engine replaces it with the client's
// real narrative." — because nothing between the donor and the alias treated a
// template sentence as a defect. It is the same class as a raw {{TOKEN}}: the
// scaffolding showing through the paint, on a page presented as the client's
// own. engine.js stripForgePlaceholders blanks the known literals at render;
// this is the fail-closed backstop for whatever a future donor ships. The
// phrases are prose markers ("placeholder copy", not the bare word
// "placeholder"), so Tailwind's placeholder-color utilities and
// <input placeholder=…> attributes can never trip it.
const PLACEHOLDER_RESIDUE = /placeholder\s+copy|forge\s+engine|lorem\s+ipsum/gi;

// THE CLIENT'S OWN VERIFIED COORDINATES (campaign line_mthy1zg2, three live
// kills: mirror_dispatch_failed_before_build -> donor_identity_detected
// {"bucket":"geo","token":"42.4844","file":"index.html"}). Donor geo atoms are
// surveyed at SOURCE precision — plumbing-clean declares "42.4844"/"-91.1232",
// four decimals. The engine writes the CLIENT's verified pin as GEO/GEO_LAT/
// GEO_LNG and as JSON-LD geo (displayCoord, six decimals), so a prospect whose
// pin shares geography with the donor renders bytes that CONTAIN the donor's
// atom as a decimal prefix: an Iowa client at 42.484412,-91.123208 carries
// "42.4844" in every coordinate the page legitimately publishes. The scan's
// substring matcher (correct for digits) then raised a 500 against the client's
// own truth — the same class as BF-5 below, answered the same way: supply the
// client's verified values and excuse only what is CONTAINED in them.
//
// The excuse is narrow by construction:
//   · the token must itself be a decimal coordinate fragment
//     (optional sign, 1-3 integer digits, "." and at least 3 fraction digits),
//     so a bare ZIP, phone or id in the geo list can never ride in;
//   · the client must carry a finite verified latitude/longitude — no client,
//     no excuse, exactly like strict mode;
//   · containment is judged against the values AS RENDERED (String(Number) and
//     the displayCoord six-decimal form with trailing zeros trimmed), because
//     those are the only byte shapes the page can legitimately carry;
//   · a donor coordinate OUTSIDE the client's own pin (a genuine leak — the
//     roofing donor's "40.1581" on an Iowa prospect) matches none of the
//     client's renderings and stays fully fatal.
const COORDINATE_FRAGMENT = /^-?\d{1,3}\.\d{3,}$/;

function clientGeoRenderings(client) {
  const facts = client && client.facts ? client.facts : {};
  const out = [];
  for (const axis of [facts.latitude, facts.longitude]) {
    const n = Number(axis);
    if (!Number.isFinite(n)) continue;
    out.push(String(n));
    // engine.js displayCoord: Number(value.toFixed(6)) — 42.484400 renders
    // "42.4844". Both renderings are legitimate page bytes.
    out.push(String(Number(n.toFixed(6))));
  }
  return out;
}

function isClientGeo(token, renderings) {
  const t = String(token == null ? "" : token).trim();
  if (!COORDINATE_FRAGMENT.test(t)) return false;
  return renderings.some((r) => r.includes(t));
}

function tokenScan(files) {
  const hits = [];
  for (const [rel, buf] of Object.entries(files)) {
    if (!HYDRATE_EXTS.has(path.extname(rel).toLowerCase())) continue;
    const text = buf.toString("utf8");
    for (const m of text.matchAll(TOKEN_RE)) {
      hits.push({ file: rel, token: m[0] });
      if (hits.length >= 20) return { clean: false, hits };
    }
    for (const m of text.matchAll(PLACEHOLDER_RESIDUE)) {
      hits.push({ file: rel, token: m[0], kind: "forge_placeholder_prose" });
      if (hits.length >= 20) return { clean: false, hits };
    }
  }
  return { clean: hits.length === 0, hits };
}

/**
 * identityScan(files, donorManifest, client)
 *
 * donorManifest carries the donor's identity atoms (BOILERPLATE.json fields:
 * name/label/phone/email/city/county/domain/owner/persons[]/asset_md5{}).
 * Donor PERSON names are first-class atoms: "OWNER · M. FORCHIONE" shipped
 * live and PASSED every gate that only knew company-level identity.
 *
 * `client` is OPTIONAL: `{ facts, content }`, the same pair fenceAreasServed()
 * already takes. Omit it and the scan behaves exactly as it always has —
 * strict, with no place ever excused.
 *
 * WHY IT TAKES THE CLIENT AT ALL (BF-5). concrete-elconstruction is a Tempe, AZ
 * donor. Its manifest correctly declares donor_city "Tempe", donor_county
 * "Maricopa County" and a "Maricopa" social atom. A real Tempe prospect's own
 * verified NAP hydrates those same words into the page, and the scan then hard-
 * failed the build with {"bucket":"city","token":"Tempe"} and
 * {"bucket":"socials","token":"Maricopa"} — a 500 raised against the CLIENT's
 * own truth, on live builds. The donor's manifest already carried the note that
 * this donor "must not be used for an Arizona prospect until the manifest can
 * tell donor geography from client geography". This is that telling: the
 * client's independently verified places are supplied, and only a PLACE atom
 * the client themselves verified is excused.
 *
 * The excuse is narrow by construction. It applies to place buckets only, it
 * requires WHOLE-VALUE equality after folding (see isClientPlace), and it never
 * touches name/phone/email/domain/account_ids/zips/asset bytes. The donor's own
 * Google handle "g.page/el-construction-tempe" contains the client's town and
 * still fails, which is the behaviour that matters.
 */
function identityScan(files, donorManifest = {}, client = null) {
  const m = { ...donorManifest };
  // gate-a-scan reads name/phone/email/city/county/domain + list fields; fold
  // donor person names and the display label into extra scan atoms.
  const persons = []
    .concat(m.persons || [], m.owner || [], m.owner_name || [])
    .flat()
    .filter(Boolean)
    .map(String);
  const listAtoms = persons.filter((p) => p.length >= 4);
  const donorName = String(m.name || "").trim().toLowerCase();
  const socials = (m.socials || []).filter((value) => {
    if (donorName !== "concrete-elconstruction") return true;
    return !CONCRETE_SERVICE_MARKET_ATOMS.has(String(value || "").trim().toLowerCase());
  });
  const scanManifest = {
    name: m.donor_business_name || m.business_name || m.identity_name || "",
    phone: m.donor_phone || m.phone || "",
    email: m.donor_email || m.email || "",
    city: m.donor_city || m.city || "",
    county: m.donor_county || m.county || "",
    domain: m.donor_domain || m.domain || "",
    socials: socials.concat(listAtoms),
    zips: m.zips || [],
    geo: m.geo || [],
    account_ids: m.account_ids || [],
    asset_md5: m.asset_md5 || {},
  };
  const asList = Object.entries(files).map(([file, bytes]) => ({ file, bytes }));
  const result = scanFiles(asList, scanManifest);

  // BF-5. Drop the accusations that are really the CLIENT's own verified place
  // or verified coordinates. Done AFTER the scan rather than by pruning atoms
  // beforehand, deliberately: the donor's city stays a live atom for every
  // OTHER build, and what was excused here is recorded on the result instead
  // of vanishing.
  const placeAtoms = client ? clientPlaceAtoms(client) : null;
  const geoRenderings = client ? clientGeoRenderings(client) : [];
  const excused = [];
  // A donor PERSON name is hard identity, but it is carried in the `socials`
  // bucket (see listAtoms above), which the place excuse would otherwise cover.
  // Plenty of first/last names are also town names — "Brandon" is both a donor
  // owner and a town 11mi from Tampa — so without this, a Tampa prospect would
  // silently excuse the donor owner's name and re-open the documented
  // person-name leak (the "OWNER · M. FORCHIONE" class). Never excuse a token
  // that is a donor person atom, whatever bucket it sits in.
  const personAtoms = new Set(
    (Array.isArray(listAtoms) ? listAtoms : [])
      .map((p) => String(p || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (client) {
    result.hits = result.hits.filter((hit) => {
      // The client's own verified pin, above. Judged before the person guard
      // on purpose: a coordinate can never be a person atom, and this branch
      // must stay reachable even when the client carries no place words.
      if (hit.bucket === "geo" && isClientGeo(hit.token, geoRenderings)) {
        excused.push({ ...hit, excuse: "client_verified_geo" });
        return false;
      }
      if (!CLIENT_SHAREABLE_PLACE_BUCKETS.has(hit.bucket)) return true;
      if (!placeAtoms || !placeAtoms.size) return true;
      if (personAtoms.has(String(hit.token || "").trim().toLowerCase())) return true;
      if (!isClientPlace(hit.token, placeAtoms)) return true;
      excused.push(hit);
      return false;
    });
  }
  result.client_places_excused = [...new Set(excused.map((h) => String(h.token)))];

  // Donor brand asset FILES surviving into the output are identity leaks even
  // when no manifest atom matches — the Tekline logo was pixels, not text.
  const survivors = donorBrandAssets(Object.keys(files))
    .filter((rel) => !/^assets\/client-/.test(rel) && rel !== "assets/brand-logo.svg");
  for (const rel of survivors) {
    result.hits.push({ bucket: "donor_brand_asset", token: rel, file: rel });
  }
  result.clean = result.hits.length === 0;
  return result;
}

module.exports = {
  tokenScan,
  identityScan,
  clientGeoRenderings,
  isClientGeo,
  CONCRETE_SERVICE_MARKET_ATOMS,
};
