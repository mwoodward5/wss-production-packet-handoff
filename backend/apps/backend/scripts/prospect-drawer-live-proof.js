"use strict";

// Prove the drawer against PRODUCTION, not against a test double.
//
// It drives the real admin endpoints on ghost.wss-ai.com with a real prospect
// from the real gallery, saves a real note, reads it back, and prints what an
// operator would see. Contact values are shown as a shape (kind + length), so
// this transcript proves the field arrived without printing anybody's details.

require("./brightdata-edit-proof/env").loadEnv();

const BASE = "https://ghost.wss-ai.com";
const TOKEN = process.env.GHOST_AGENCY_ADMIN_TOKEN;

async function call(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "x-admin-token": TOKEN,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: response.status, json };
}

function shape(value) {
  if (value === null || value === undefined || value === "") return "EMPTY";
  if (typeof value === "string") {
    if (/@/.test(value)) return `email present (${value.length} chars)`;
    if (/^[+(]?\d[\d\s().-]{6,}$/.test(value)) return `phone present (${value.length} chars)`;
    return `"${value.length > 60 ? `${value.slice(0, 60)}…` : value}"`;
  }
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function main() {
  if (!TOKEN) { console.log("NO ADMIN TOKEN IN ENV"); return; }

  const gallery = await call("/api/admin/gallery-data");
  console.log("gallery-data:", gallery.status, "builds:", gallery.json?.builds?.length);
  const candidates = (gallery.json?.builds || []).filter((row) => row.prospectId && !row.archived);
  console.log("non-archived cards with an id:", candidates.length);
  if (!candidates.length) { console.log("nothing to open"); return; }

  let printed = 0;
  for (const card of candidates.slice(0, 3)) {
    const detail = await call("/api/admin/prospect-detail", { prospectId: card.prospectId });
    console.log(`\n================ ${card.businessName} ================`);
    console.log("HTTP", detail.status, "| sources:", JSON.stringify(detail.json?.sources));
    if (detail.status !== 200) { console.log(JSON.stringify(detail.json).slice(0, 300)); continue; }
    const d = detail.json.detail;
    console.log("status shown to operator :", d.statusPlain);
    console.log("HOW TO REACH THEM");
    console.log("  person        :", shape(d.contact.person));
    console.log("  phone         :", shape(d.contact.phone));
    console.log("  email         :", shape(d.contact.email));
    console.log("  address       :", shape(d.contact.address));
    console.log("  their website :", shape(d.contact.theirWebsite));
    console.log("  google listing:", d.contact.googleListing ? "present" : "EMPTY");
    console.log("  socials       :", shape(d.contact.socials));
    console.log("  hours         :", shape(d.contact.hours));
    console.log("REPUTATION      :", d.reputation.sentence);
    console.log("WHY WE PICKED THEM");
    console.log("  tier/score    :", d.pick.tierPlain || "(none)", d.pick.score == null ? "" : `· ${d.pick.score}/100`, "·", d.pick.lanePlain || "");
    (d.pick.reasons || []).forEach((reason) => console.log("   -", reason));
    console.log("WHAT IS WRONG WITH THEIR SITE");
    console.log("  grades        : site", JSON.stringify(d.siteProblems.websiteGrade), "overall", JSON.stringify(d.siteProblems.overallGrade));
    (d.siteProblems.signals || []).forEach((signal) => console.log("   -", signal));
    console.log("OUR WORK");
    console.log("  mirror        :", d.ourWork.mirrorUrl || "EMPTY");
    console.log("  report        :", d.ourWork.reportUrl || "EMPTY");
    console.log("  template      :", d.ourWork.donor || "EMPTY");
    console.log("HISTORY        :", (d.history || []).length, "event(s)");
    (d.history || []).slice(0, 4).forEach((entry) => console.log("   -", entry.when, entry.what, entry.detail ? `(${entry.detail})` : ""));
    console.log("NOTES          :", (d.notes || []).length);
    console.log("SEND ROUTING");
    console.log("  headline      :", d.send.headline);
    console.log("  recipient     :", d.send.recipient);
    console.log("  business email:", d.send.businessEmail ? "present, and NOT the recipient" : "none on file");
    console.log("  recipient === business email? ", d.send.recipient === d.send.businessEmail);
    console.log("  live sends on :", d.send.liveSendsOn, "| outreach paused:", d.send.deliveryPauseActive);
    console.log("  reasons       :", JSON.stringify(d.send.reasons));
    printed += 1;
  }

  // A real note, written and read back through the live endpoints.
  const target = candidates[0];
  const noteText = `Live drawer proof ${new Date().toISOString()}`;
  const wrote = await call("/api/admin/prospect-note", { prospectId: target.prospectId, note: noteText });
  console.log("\nNOTE WRITE:", wrote.status, JSON.stringify(wrote.json).slice(0, 200));
  const reread = await call("/api/admin/prospect-detail", { prospectId: target.prospectId });
  const notes = reread.json?.detail?.notes || [];
  console.log("NOTE READ BACK:", notes.length, "note(s); newest matches what we wrote:", notes[0]?.text === noteText, "| stamped", notes[0]?.when);

  const empty = await call("/api/admin/prospect-note", { prospectId: target.prospectId, note: "   " });
  console.log("EMPTY NOTE REFUSED:", empty.status, JSON.stringify(empty.json).slice(0, 140));

  const noAuth = await fetch(`${BASE}/api/admin/prospect-detail`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospectId: target.prospectId }),
  });
  console.log("NO-TOKEN DETAIL CALL:", noAuth.status, (await noAuth.text()).slice(0, 120));

  console.log("\nprinted", printed, "records");
}

main().catch((error) => { console.error("FAILED", error && error.message); process.exitCode = 1; });
