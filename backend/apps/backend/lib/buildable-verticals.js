"use strict";

/**
 * lib/buildable-verticals.js — what the factory can truthfully build right now.
 *
 * The console's vertical dropdown was a hand-maintained list of <option> tags.
 * Every donor added since then (landscaping, then hvac) was invisible in the
 * UI until somebody remembered to edit the HTML, so the operator could not mine
 * a vertical the factory had been able to build for days. This reads the donor
 * manifests instead, which is the same source lib/donor-verticals.js treats as
 * the authority, so a donor installed into donors-clean is offerable the moment
 * it lands — no second edit, no drift.
 *
 * A donor that retired itself (BOILERPLATE.retired) is not buildable and is
 * omitted. `retired_for_outreach` is a DIFFERENT flag — those donors still
 * build, they just are not used for cold outreach — so they stay listed and
 * carry the flag for the caller to render.
 */

const fs = require("node:fs");
const path = require("node:path");
const { isDonorExcluded } = require("./donor-exclusions");

function donorRoot() {
  const configured = String(process.env.MIRROR_DONOR_ROOT || "").trim();
  return configured || path.join(__dirname, "..", "donors-clean");
}

/** "med spa" -> "Med Spa", "hvac" -> "HVAC" */
function titleCase(vertical) {
  const special = { hvac: "HVAC", "med spa": "Med Spa" };
  const key = String(vertical || "").toLowerCase();
  if (special[key]) return special[key];
  return key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * buildableVerticals() -> [{ vertical, label, donor, outreachRetired, donorExcluded }]
 * Sorted alphabetically by label. One entry per vertical; if two donors claim
 * the same vertical the live one wins, matching the engine's own find().
 */
function buildableVerticals({ root = donorRoot() } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const seen = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, "BOILERPLATE.json");
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      continue; // an unreadable manifest is not a buildable vertical
    }
    if (manifest.retired) continue;
    const vertical = String(manifest.vertical || "").trim().toLowerCase();
    if (!vertical || vertical.startsWith("__retired__")) continue;
    // `unretired` REVERSES a retirement — plumbing and roofing were both closed
    // on 2026-07-30 and reopened on 2026-08-04 ("turn on everything"), keeping
    // retired_on as history. Reading retired_on alone labelled the two most
    // productive verticals "build only" on the operator's own dashboard, which
    // is worse than a cosmetic bug: it tells him he cannot mine the vertical he
    // was about to mine. lib/lead-miner is the authority and it only refuses on
    // retired_for_outreach, so match it exactly.
    const outreachRetired = manifest.unretired
      ? false
      : Boolean(manifest.retired_for_outreach);
    // DONOR EXCLUSIONS (lib/donor-exclusions.js): an owner-barred donor is
    // closed to line-campaign selection. `retired_for_outreach` means "stop
    // mining this category"; an exclusion means "this template is off for
    // fresh campaigns" — a different decision with a different escape hatch
    // (GHOST_AGENCY_DONOR_EXCLUSIONS), so it rides its own flag.
    const donorExcluded = isDonorExcluded(entry.name);
    // When two donors claim one vertical — which happens the moment a
    // replacement lands and the old one is superseded rather than deleted —
    // the LIVE one must be the one named here. First-wins alone would report
    // whichever directory sorts first, and the console would tell the operator
    // hvac ships from a donor that outreach can no longer use. An excluded
    // donor loses the seat the same way: rank outreach-live above
    // outreach-retired, and not-excluded above excluded.
    const rank = (retiredFlag, excludedFlag) => (retiredFlag ? 2 : 0) + (excludedFlag ? 1 : 0);
    const prior = seen.get(vertical);
    if (prior && rank(prior.outreachRetired, prior.donorExcluded) <= rank(outreachRetired, donorExcluded)) continue;
    seen.set(vertical, {
      vertical,
      label: titleCase(vertical),
      donor: entry.name,
      outreachRetired,
      donorExcluded,
    });
  }

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

module.exports = { buildableVerticals, titleCase };
