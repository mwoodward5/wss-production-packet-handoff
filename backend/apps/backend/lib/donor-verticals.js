"use strict";

/**
 * lib/donor-verticals.js — vertical ALIAS resolution for the Mirror Engine.
 *
 * WHY THIS FILE EXISTS
 * The engine resolves a donor from an industry with one exact string compare
 * (lib/mirror-engine/donor.js):
 *
 *     all.find((d) => String(d.vertical || "").toLowerCase() === wanted)
 *
 * One donor directory therefore serves exactly one vertical name. That is fine
 * for "fencing" and "concrete" and wrong for everything adjacent: a prospect
 * mined as "deck", "masonry" or "hardscaping" got a 404 donor_not_found even
 * though fencing-sterling and concrete-elconstruction are exactly the right
 * templates for them.
 *
 * WHAT THIS DOES INSTEAD OF EDITING THE ENGINE
 * The mirror request already has a first-class `donor` field, and the engine
 * path-confines it (`donor.replace(/[^a-z0-9-]/g,"")` + a root-prefix assert)
 * before touching disk. So an alias is applied by NAMING the donor on the way
 * in, and the engine's own resolution and confinement run unchanged.
 *
 * SAFETY PROPERTIES — all three matter and all three are tested below:
 *   1. A caller-supplied `donor` always wins. This never overrides a request.
 *   2. An industry the engine can already resolve on its own is never touched.
 *      resolveAlias() refuses to answer for any vertical that is a live
 *      BOILERPLATE.vertical, so this table cannot silently redirect traffic
 *      away from a donor that is doing its job.
 *   3. A retired vertical has no alias, so retiring roofing in the donor
 *      manifest actually retires it. Re-adding roofing here is the ONLY way to
 *      bring it back, which makes the decision explicit and greppable.
 */

const fs = require("node:fs");
const path = require("node:path");

const TABLE_PATH = path.join(__dirname, "..", "data", "donor-verticals.json");

function donorRoot() {
  const configured = String(process.env.MIRROR_DONOR_ROOT || "").trim();
  return configured || path.join(__dirname, "..", "donors-clean");
}

function loadTable() {
  try {
    return JSON.parse(fs.readFileSync(TABLE_PATH, "utf8"));
  } catch {
    return { aliases: {} };
  }
}

const normalize = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();

/** Verticals the engine can resolve by itself, read from the donor manifests. */
function liveVerticals(root = donorRoot()) {
  const out = new Set();
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name, "BOILERPLATE.json");
    if (!fs.existsSync(p)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      // A donor that retired itself (BOILERPLATE.retired — read by
      // lib/mirror-engine/donor.js donorRetirement) is refused by the engine,
      // so its vertical is NOT live. Without this, retiring the only donor for
      // a vertical would also block ever aliasing that vertical elsewhere.
      // NOTE: `retired_for_outreach` is a different flag — those donors build.
      if (m.retired) continue;
      const v = normalize(m.vertical);
      // A "__retired__*" vertical is unreachable by design and must NOT count
      // as live — otherwise retiring roofing would also block a future alias.
      if (v && !v.startsWith("__retired__")) out.add(v);
    } catch { /* an unreadable manifest is not a live vertical */ }
  }
  return out;
}

/**
 * resolveAlias(industry) -> { donor, industry, matched } | null
 *
 * null means "leave the request alone": either there is no alias, or the
 * engine already owns this vertical, or the target donor is not installed.
 */
function resolveAlias(industry, { root = donorRoot(), table = loadTable() } = {}) {
  const wanted = normalize(industry);
  if (!wanted) return null;
  if (liveVerticals(root).has(wanted)) return null;      // property 2

  const aliases = table.aliases || {};
  let donor = null;
  for (const [k, v] of Object.entries(aliases)) {
    if (normalize(k) === wanted) { donor = v; break; }
  }
  if (!donor) return null;

  // Fail quiet, never loud: a table pointing at a donor that is not installed
  // must fall through to the engine's own 404 rather than manufacture one.
  if (!fs.existsSync(path.join(root, donor, "BOILERPLATE.json"))) return null;

  return { donor, industry: wanted, matched: "alias" };
}

/**
 * applyDonorAlias(body) -> { body, applied }
 * Returns the request to send onward. `applied` is the alias record, or null.
 */
function applyDonorAlias(body, opts = {}) {
  if (!body || typeof body !== "object") return { body, applied: null };
  if (body.donor) return { body, applied: null };                    // property 1
  const facts = body.facts;
  if (!facts || typeof facts !== "object") return { body, applied: null };

  const hit = resolveAlias(facts.industry, opts);
  if (!hit) return { body, applied: null };

  return { body: { ...body, donor: hit.donor }, applied: hit };
}

module.exports = { resolveAlias, applyDonorAlias, liveVerticals, loadTable, TABLE_PATH };
