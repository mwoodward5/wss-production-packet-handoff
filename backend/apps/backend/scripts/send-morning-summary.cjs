"use strict";
// scripts/send-morning-summary.cjs — the Step 6 morning-ready handoff.
// Owner's inbox only. Nothing deployed, nothing published, no prospect ever touched.

const fs = require("node:fs");
const ENV = "C:/Users/Main/Documents/New project 2/.fable-proof.env";
for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const OWNER = "woodwardsoftware@gmail.com";
const FROM = process.env.GHOST_AGENCY_RESEND_FROM || "Woodward Software <hello@wss-ai.com>";
const A = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/artifacts/ramon-qa";
const V2 = "C:/Users/Main/AppData/Local/Temp/claude/C--Users-Main-Documents-Dark-Signal/67b321d0-5f9f-4840-972e-9c1870c1885a/scratchpad/falcon-v2";

function section(title, rows) {
  return `<tr><td style="padding:22px 28px 4px">
    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#B4552D">${title}</div>
    <div style="margin-top:10px;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,sans-serif;color:#33332c">${rows}</div>
  </td></tr>`;
}
const ok = (s) => `<span style="color:#0f7b3f;font-weight:700">✓</span> ${s}`;
const held = (s) => `<span style="color:#b58900;font-weight:700">⏸</span> ${s}`;
const bad = (s) => `<span style="color:#8a1c1c;font-weight:700">✗</span> ${s}`;

const html = `<!doctype html><html><body style="margin:0;background:#f7f7f4;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e6e3">
<tr><td style="background:#14140f;padding:24px 28px">
  <div style="font:700 13px/1 sans-serif;color:#f5f5f4;letter-spacing:.18em">WSS LABS</div>
  <div style="font:400 12px/1.4 sans-serif;color:#9a9a92;margin-top:6px">Morning-ready handoff — autonomous overnight pass</div>
</td></tr>
<tr><td style="padding:22px 28px 4px">
  <div style="background:#fff4d6;border:1px solid #e6c66b;border-radius:8px;padding:12px 16px;font:700 13px/1.5 sans-serif;color:#7a5a00">
    Nothing deployed. Nothing published to VAPI. Zero prospects contacted. Everything below is staged, waiting on your two triggers.
  </div>
</td></tr>

${section("1 · Ramon certifications — 8, all sourced", `
  ${ok("NSA, MRCA, NTRCA, TRI, RCAT, CTRCA, BBB")} — owner read of visible copy, ramonroofing.com/about-us<br/>
  ${ok("GAF Authorized Roofer (cert #8)")} — found as a heading on 8 of their own service pages, page-type-weighted as a credential, exact wording owner-confirmed<br/>
  ${ok("Blocked correctly: Master Elite")} — never claimed by the client, stays out<br/>
  ${ok("Founded 1995, Paul Ramon")} — visible About-page copy; \"since 1993\" (blog-only noise) dropped
`)}

${section("2 · Step 1 — the two open Gate-4A defects", `
  ${ok("Falcon CSS classes: GONE")} — case-insensitive grep for \"falcon\" across every class, id, data-attr, filename and comment in src/: <strong>zero hits</strong>. .logo-falcon → .logo-mark; .btn-falcon removed entirely.<br/>
  ${ok("Broken nav route: FIXED")} — every link now points at /gutters-siding-trim (confirmed in source, in the built JS bundle, and via live HTTP fetch). Also added the missing route to sitemap.xml.<br/>
  ${ok("Gate 4A itself: PASS, exit 0")} — plus a real infra bug found and fixed inside the gate script (it was closing its own test server before reading the stylesheet, which had been masking the true result as a false failure).
`)}

${section("3 · Full regression — 13 gates, all unpiped, all exit 0", `
  <table width="100%" style="font:400 13px/1.6 sans-serif;color:#4a4a44;border-collapse:collapse">
    <tr><td style="padding:2px 0">tsc --noEmit</td><td>0</td></tr>
    <tr><td style="padding:2px 0">vite build</td><td>0</td></tr>
    <tr><td style="padding:2px 0">hydrate-ramon</td><td>0</td></tr>
    <tr><td style="padding:2px 0">donor-identity-zero (Gate 4A)</td><td>0</td></tr>
    <tr><td style="padding:2px 0">donor-identity-zero positive control</td><td>0</td></tr>
    <tr><td style="padding:2px 0">scrub-verify</td><td>0</td></tr>
    <tr><td style="padding:2px 0">scrub negative control</td><td>0</td></tr>
    <tr><td style="padding:2px 0">scrub positive control</td><td>0</td></tr>
    <tr><td style="padding:2px 0">gate4b zero-token / zero-Falcon</td><td>0</td></tr>
    <tr><td style="padding:2px 0">riley-prompt-gate</td><td>0</td></tr>
    <tr><td style="padding:2px 0">form-delivery-assert (write+read-back)</td><td>0</td></tr>
    <tr><td style="padding:2px 0">map-paint-assert</td><td>0</td></tr>
    <tr><td style="padding:2px 0">riley-tools-smoke</td><td>0</td></tr>
  </table>
  <div style="margin-top:8px">${ok("Hero scale")}: home 108vh→64vh (target was ~62), internals 93-96vh→46vh. Zero horizontal overflow at 390px. Zero console errors across 14 renders (7 routes × desktop+mobile).</div>
  <div style="margin-top:6px">${ok("Trust bar now live")}: found it wasn't wired into the page at all (a merge collision between two parallel build passes silently dropped it) — fixed, and it now renders all 8 cert badges, real testimonials, and animated counters (31 yrs / 4.9★ / 85 reviews / 8 associations) that correctly count up on scroll.</div>
`)}

${section("4 · The other 4 mirrors — correctly held in DRAFT", `
  Ran the new reusable Gate 4A against all 4 live mirrors. None leak Falcon identity — but none fully clear, so all 4 correctly keep the yellow DRAFT — UNVERIFIED banner, per your instruction:<br/><br/>
  ${bad("Lyons Roofing")} — map query only says "Tucson, AZ", omits the business name (same defect class as the old blank-map bug); a duplicated "Replacement Replacement" text bug on 6 routes.<br/>
  ${bad("Music City Roofers")} — same map-query-omits-name issue.<br/>
  ${bad("Kingdom Plumbing")} — same map-query-omits-name issue.<br/>
  ${bad("ENCO Plumbing")} — same map-query-omits-name issue, plus a duplicated "Hours Hours" text bug on /service-areas.<br/><br/>
  None of these are Falcon leaks — they're pre-existing production bugs the new gate just surfaced. Not touched tonight; flagging for a separate pass.
`)}

${section("5 · The 5 sample emails", `
  Sent to your inbox (woodwardsoftware@gmail.com) only — subjects: Ramon (verified), and 4× [SAMPLE] drafts for Lyons/Music City/Kingdom/ENCO with the yellow DRAFT banner. Riley's publish state was re-checked before writing — still unpublished, so every email says "staged and ready to test," never "call now and talk to him."
`)}

${section("6 · Queued behind your two triggers", `
  <strong>"approved to deploy"</strong> → pushes 3 backend files: quote-request.js (lead capture, already write+read-back proven), site-edit-targets.js (Riley's wss-test resolver), run-edit-job.js (owner completion email). Until you say this, a customer filling Ramon's form today still doesn't reach anyone.<br/><br/>
  <strong>"approved to publish Riley"</strong> → pushes riley.system.md (gate-passed, 8 tools built, transfer_to_team correctly dropped for lack of a real roster) to the VAPI assistant. No API call has been made.<br/><br/>
  <strong>100-batch</strong> → still fully held. Nothing sent beyond this inbox.
`)}

<tr><td style="padding:20px 28px 26px;border-top:1px solid #ececE7;margin-top:10px">
  <div style="font:400 12px/1.6 sans-serif;color:#9a9a92">Reply "approved to deploy" and/or "approved to publish Riley" to release either. Everything else stays held until you say so.</div>
</td></tr>
</table>
</body></html>`;

async function main() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");

  const attachPaths = [
    `${V2}/artifacts/final3-1440-home.png`,
    `${V2}/artifacts/final3-390-home.png`,
  ];
  const attachments = [];
  for (const p of attachPaths) {
    if (!fs.existsSync(p)) continue;
    const bytes = fs.readFileSync(p);
    if (bytes.length > 9 * 1024 * 1024) continue;
    attachments.push({ filename: require("path").basename(p), content: bytes.toString("base64") });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [OWNER],
      subject: "Morning handoff — Ramon gate-passed, 4 mirrors held, 2 triggers waiting",
      html,
      attachments,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  console.log(`SENT summary -> id=${body.id}, attachments=${attachments.length}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
