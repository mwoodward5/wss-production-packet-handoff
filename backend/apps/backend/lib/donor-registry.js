/**
 * lib/donor-registry.js — backend bridge to the donor registry data file.
 * pickDonor(vertical, metro, excludeIds) + gateA(manifest, corpus) — the rotation
 * rule + contamination lookup the mirror lane calls. No deps.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Serverless-safe fallback: a copy of the registry packaged into the deploy
// at apps/backend/data/donor-registry.json. The absolute workspace path only
// exists on the owner's Windows box; on Vercel the packaged copy is used.
const PACKAGED_REGISTRY_PATH = path.join(__dirname, "..", "data", "donor-registry.json");

function registryPath() {
  return process.env.GHOST_AGENCY_DONOR_REGISTRY_PATH || PACKAGED_REGISTRY_PATH;
}

function loadRegistry() {
  const p = registryPath();
  if (!fs.existsSync(p)) return { donors: [] };
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function pickDonor(vertical, metro, excludeIds = []) {
  const reg = loadRegistry();
  const cands = [];
  for (const d of reg.donors || []) {
    if (d.vertical !== vertical) continue;
    if (!d.donor_manifest) continue;
    const used = new Set((d.last_used_metros || []).map((u) => String(u.metro || "").toLowerCase()));
    if (used.has(String(metro).toLowerCase())) continue;
    if (excludeIds.includes(d.donor_id)) continue;
    cands.push(d);
  }
  if (!cands.length) return null;
  const lru = (d) => {
    const uses = d.last_used_metros || [];
    const last = uses.reduce((m, u) => (u.date > m ? u.date : m), "");
    return [uses.length, last || "0000-00-00"];
  };
  cands.sort((a, b) => {
    const [al, ad] = lru(a);
    const [bl, bd] = lru(b);
    return al - bl || (ad < bd ? -1 : ad > bd ? 1 : 0);
  });
  const c = cands[0];
  return {
    donor_id: c.donor_id,
    source: c.source,
    stack: c.stack,
    quality_tier: c.quality_tier,
    page_type: c.page_type,
    donor_manifest: c.donor_manifest,
  };
}

function gateA(donorManifest, corpus) {
  const hits = [];
  const lower = String(corpus || "").toLowerCase();
  const m = donorManifest || {};
  const tokens = [];
  for (const k of ["name", "phone", "email", "city", "county", "domain"]) {
    const v = m[k];
    if (v && String(v).length >= 4) tokens.push([k, String(v)]);
  }
  for (const k of ["zips", "geo", "socials", "account_ids"]) {
    for (const v of m[k] || []) {
      if (v && String(v).length >= 4) tokens.push([k, String(v)]);
    }
  }
  for (const [bucket, tok] of tokens) {
    if (lower.includes(tok.toLowerCase())) hits.push({ bucket, token: tok });
  }
  return hits;
}

module.exports = { pickDonor, gateA, loadRegistry };
