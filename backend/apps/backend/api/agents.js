"use strict";

const { requireAdmin } = require("../lib/admin-auth");
const { methodGuard, sendJson } = require("../lib/http");

const AGENTS = [
  ["agent_00_orchestrator", "Routes the full local website growth machine"],
  ["agent_01_prospect_miner", "LeadMiner intake and scored prospect queue"],
  ["agent_02_enrichment", "Firecrawl/Bright Data/GBP enrichment normalization"],
  ["agent_03_report", "Rocket SERPs + CallPrep visibility report packet"],
  ["agent_04_packet_compiler", "Build packet, content contract, and proof manifest"],
  ["agent_05_site_builder", "WSS Labs/DreamForge build dispatch"],
  ["agent_06_qc_gatekeeper", "Copy bans, media checks, accessibility, launch proof"],
  ["agent_07_consent_registrar", "Consent, suppression, and outreach gates"],
  ["agent_08_billing", "Stripe checkout, webhook, entitlement, delivery ledger"],
  ["agent_09_delivery_domain", "Launch handoff, domain, receipt, support path"],
  ["agent_10_support_edits", "Post-sale edit ticket intake and QC rerun"],
  ["agent_11_retention", "Monthly customer summary and renewal protection"],
  ["agent_12_media_video", "Veo/Gemini/media asset prompts and proof handling"],
  ["agent_13_email_sequencer", "Resend drip sequencing with CAN-SPAM brakes"],
];

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdmin(req, res)) return;
  sendJson(res, 200, {
    ok: true,
    agents: AGENTS.map(([id, role]) => ({ id, role })),
    boundary: "Internal Woodward-owned operating system. Customers buy managed websites, not the machine.",
  });
};
