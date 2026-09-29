"use strict";

// Production repair for one narrow sourcing seam.
//
// The packet-aware shelf paths in line-adapters already know that a LeadMiner
// truth packet with real identity but build_ready:false is `needs_fill`, not a
// dead contract. All-Trades refill can also receive the same persisted packet
// through a generic pick path, where rowToLineRow applies the mined-contract
// check and labels it build_ready_contract_incomplete. That is how the current
// production run rejected real packets such as Pacific Plumbing Co before the
// existing AI-fill builder ever saw them.
//
// This wrapper does NOT make incomplete ordinary prospects buildable. It reloads
// only rows that the base picker already selected, requires the canonical
// LeadMiner packet source plus a real business/place/trade identity, and then
// applies the same flags the packet shelf already uses. mirrorProspect still
// reloads the canonical record and independently re-checks packet identity.

const adapters = require("./line-adapters");
const { select: storeSelect } = require("./store");
const { inferTrade } = require("./trade-inference");

const PROSPECTS = "ghost_agency_prospects";
const INCOMPLETE = /^build_ready_contract_incomplete:/;

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function packetBasics(row = {}) {
  const record = objectOf(row.record) || {};
  const truth = objectOf(record.truth_packet) || {};
  const lead = objectOf(truth.mirror_ready) || {};
  const businessName = text(row.business_name || row.businessName || lead.business_name || record.business_name);
  let vertical = text(row.industry || row.vertical || lead.industry || truth.industry || record.industry);
  if (!vertical) {
    // The export can drop the industry LABEL while still carrying the client's
    // own published service list. Derive the trade from those services (the
    // same inference the builder uses) so a label-less-but-services-confident
    // packet is admitted to the needs_fill path instead of being rejected as
    // build_ready_contract_incomplete. Only a CONFIDENT inference counts, and
    // only when the label is genuinely empty — a present-but-nonstandard label
    // is left untouched. Downstream (line-adapters, donorFor, multiTrade, NAP
    // and render gates) still re-verify every admitted packet.
    const services = Array.isArray(lead.services) && lead.services.length
      ? lead.services
      : (Array.isArray(truth.services) ? truth.services : []);
    const inferred = inferTrade({ label: "", services, businessName });
    if (inferred && inferred.confident && inferred.trade) vertical = text(inferred.trade);
  }
  return {
    businessName,
    city: text(row.city || lead.city || record.city),
    state: text(row.state || lead.state || record.state),
    vertical,
  };
}

function recoverablePacket(row = {}) {
  const record = objectOf(row.record) || {};
  if (record.truth_packet_source !== "leadminer_mirror_ready") return false;
  if (!objectOf(record.truth_packet)) return false;
  if (record.build_ready === true) return false;
  const basic = packetBasics(row);
  return Boolean(basic.businessName && basic.city && basic.state && basic.vertical);
}

function prospectQuery(ids = []) {
  const escaped = ids.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(",");
  return `?select=*&prospect_id=in.(${escaped})&limit=${ids.length}`;
}

async function reload(ids, select = storeSelect) {
  if (!ids.length) return [];
  const result = await select(PROSPECTS, prospectQuery(ids)).catch(() => null);
  return result && result.ok === true && Array.isArray(result.data) ? result.data : [];
}

function preserveFunnel(source, target) {
  if (source && Object.prototype.hasOwnProperty.call(source, "funnel")) target.funnel = source.funnel;
  return target;
}

function createProductionPick(dependencies = {}) {
  const pick = dependencies.pick || adapters.pickProspects;
  const select = dependencies.select || storeSelect;
  if (typeof pick !== "function") throw new TypeError("line_production_pick_invalid");

  return async function productionPick(input = {}, runtime = {}) {
    const picked = await pick(input, runtime);
    if (!Array.isArray(picked) || !picked.length) return picked;

    const candidates = picked.filter((row) => INCOMPLETE.test(text(row && row.contractIssue)) && text(row && row.prospectId));
    if (!candidates.length) return picked;

    const persisted = await reload([...new Set(candidates.map((row) => text(row.prospectId)))], runtime.select || select);
    const byId = new Map(persisted.map((row) => [text(row.prospect_id), row]));

    const repaired = picked.map((row) => {
      if (!INCOMPLETE.test(text(row && row.contractIssue))) return row;
      const canonical = byId.get(text(row && row.prospectId));
      if (!canonical || !recoverablePacket(canonical)) return row;
      const basic = packetBasics(canonical);
      return {
        ...row,
        businessName: row.businessName || basic.businessName,
        city: row.city || basic.city,
        state: row.state || basic.state,
        vertical: row.vertical || basic.vertical,
        contractIssue: "",
        leadminerQualified: true,
        needs_fill: true,
      };
    });
    return preserveFunnel(picked, repaired);
  };
}

module.exports = {
  INCOMPLETE,
  packetBasics,
  recoverablePacket,
  preserveFunnel,
  createProductionPick,
};
