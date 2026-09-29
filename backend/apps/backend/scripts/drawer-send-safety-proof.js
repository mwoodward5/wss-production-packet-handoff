"use strict";

// Can the gallery's send button be pointed at a business? Try to make it
// happen, against PRODUCTION, and print what the send path resolves to.
//
// Every attempt uses dryRun so the machine composes the real email and passes
// every real gate without handing anything to Resend. What we are proving is
// the RECIPIENT the send path resolves to, which is decided before delivery.

require("./brightdata-edit-proof/env").loadEnv();

const BASE = "https://ghost.wss-ai.com";
const TOKEN = process.env.GHOST_AGENCY_ADMIN_TOKEN;

async function call(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-admin-token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  try { return { status: response.status, json: JSON.parse(text) }; } catch { return { status: response.status, json: { raw: text.slice(0, 300) } }; }
}

async function main() {
  const gallery = await fetch(`${BASE}/api/admin/gallery-data`, { headers: { "x-admin-token": TOKEN } });
  const cards = (await gallery.json()).builds.filter((row) => row.prospectId && !row.archived);
  const target = cards[0];
  const detail = await call("/api/admin/prospect-detail", { prospectId: target.prospectId });
  const businessEmail = detail.json.detail.contact.email;
  const owner = detail.json.detail.send.recipient;
  console.log("target       :", target.businessName);
  console.log("their address:", `${businessEmail.slice(0, 3)}*** @${businessEmail.split("@")[1]}`);
  console.log("owner inbox  :", owner);
  console.log("live sends on:", detail.json.detail.send.liveSendsOn, "| paused:", detail.json.detail.send.deliveryPauseActive);
  console.log("");

  // Attempt 1 — exactly what the button sends.
  // Attempts 2-5 — every override a hostile or careless caller might try.
  const attempts = [
    ["what the button sends", { prospectId: target.prospectId, dryRun: true }],
    ["plus to=<the business>", { prospectId: target.prospectId, dryRun: true, to: businessEmail }],
    ["plus email/ownerEmail overrides", { prospectId: target.prospectId, dryRun: true, email: businessEmail, ownerEmail: businessEmail, owner_email: businessEmail }],
    ["plus cc and bcc", { prospectId: target.prospectId, dryRun: true, cc: [businessEmail], bcc: [businessEmail] }],
    ["plus internalOwnerProof:false", { prospectId: target.prospectId, dryRun: true, internalOwnerProof: false }],
  ];

  for (const [label, body] of attempts) {
    const result = await call("/api/admin/send-mirror-proof", body);
    const send = result.json && result.json.send;
    console.log(`${label.padEnd(34)} HTTP ${result.status}`);
    console.log(`  resolved recipient : ${send && send.to ? send.to : "(none)"}   [owner starts "${owner.slice(0, 3)}", business starts "${businessEmail.slice(0, 3)}"]`);
    console.log(`  delivery lane      : ${send && send.deliveryLane}`);
    console.log(`  cc / bcc           : ${JSON.stringify(send && send.cc)} / ${JSON.stringify(send && send.bcc)}`);
    console.log(`  mode               : ${send && send.mode}   blocked: ${send && send.blocked ? send.blocked : "no"}`);
    const reachedBusiness = Boolean(send && send.to && send.to.startsWith(businessEmail.slice(0, 3)) && !owner.startsWith(businessEmail.slice(0, 3)));
    console.log(`  REACHED A BUSINESS : ${reachedBusiness ? "YES — STOP" : "no"}`);
    console.log("");
  }
}

main().catch((error) => { console.error("FAILED", error && error.message); process.exitCode = 1; });
