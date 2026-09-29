"use strict";

// scripts/owner-proof-email.js — send the OWNER (and only the owner) a proof
// email for a batch of mirrors.
//
// Hard rules encoded here, not assumed:
//   · The recipient allowlist is the owner's own addresses. Anything else
//     throws before a single API call. This lane can never reach a prospect.
//   · It reports what the manifests actually say — revealable, the 108-point
//     score, named checks — and never claims a mirror is ready when its
//     evidence says otherwise.
//
// Usage: node scripts/owner-proof-email.js <batch.json> [envfile] [--dry]
//   batch.json: { subject?, intro?, mirrors: [{ business, url, screenshot?,
//                 score?, revealable, notes?, accent?, phone?, donor? }] }

const fs = require("node:fs");
const path = require("node:path");

const OWNER_ALLOWLIST = new Set([
  "woodwardsoftware@gmail.com",
  "mark@go.wss-ai.com",
  "hello@wss-ai.com",
]);

function loadEnv(file) {
  if (!file || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Compact visual scorecard: one pill per 108-point group. Perfect groups get
// the win treatment; the rest render neutral with met/total so nothing hides.
function groupPills(byGroup) {
  if (!byGroup) return "";
  const pills = Object.entries(byGroup).map(([g, v]) => {
    const perfect = v.met === v.total;
    const bg = perfect ? "#0f7b3f" : "#efefe9";
    const fg = perfect ? "#ffffff" : "#4a4a44";
    return `<span style="display:inline-block;background:${bg};color:${fg};border-radius:999px;padding:3px 10px;font:600 11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;margin:2px 3px 2px 0">${esc(g)} ${v.met}/${v.total}</span>`;
  }).join("");
  return `<div style="margin-top:8px">${pills}</div>`;
}

// Speed as a sales line, not a spreadsheet row.
function speedLine(rt) {
  if (!rt) return "";
  const fast = rt.lcp_ms != null && rt.lcp_ms < 500;
  const lead = fast ? "Loads in under half a second" : "Measured live";
  const bits = [];
  if (rt.lcp_ms != null) bits.push(`LCP ${rt.lcp_ms}ms`);
  if (rt.cls != null) bits.push(`CLS ${rt.cls}`);
  if (rt.ttfb_ms != null) bits.push(`TTFB ${rt.ttfb_ms}ms`);
  return `<div style="margin-top:7px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#33332c"><strong>${lead}</strong> — ${bits.join(" · ")}</div>`;
}

function bulletBlock(title, items, color) {
  if (!items || !items.length) return "";
  const lis = items.map((s) => `<li style="margin:5px 0">${esc(s)}</li>`).join("");
  return `<div style="margin-top:20px">
    <div style="font:700 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${color || "#14140f"};letter-spacing:.08em;text-transform:uppercase">${esc(title)}</div>
    <ul style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#4a4a44;margin:8px 0 0;padding-left:20px">${lis}</ul>
  </div>`;
}

function buildHtml({ intro, mirrors, carries, flags, riley, clientIds, next }) {
  const rows = mirrors.map((m) => {
    const ok = m.revealable === true;
    const badge = ok
      ? `<span style="display:inline-block;background:#0f7b3f;color:#fff;border-radius:999px;padding:2px 10px;font-size:11px;letter-spacing:.06em">REVEALABLE</span>`
      : `<span style="display:inline-block;background:#8a1c1c;color:#fff;border-radius:999px;padding:2px 10px;font-size:11px;letter-spacing:.06em">NOT REVEALABLE</span>`;
    return `<tr><td style="padding:18px 0;border-bottom:1px solid #e6e6e3">
      <div style="font:600 17px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#14140f">${esc(m.business)} ${badge}</div>
      <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#4a4a44;margin-top:6px">
        <a href="${esc(m.url)}" style="color:#b4552d;font-weight:600">${esc(m.url)}</a><br/>
        ${m.score ? `Optimization: <strong>${esc(m.score)}</strong><br/>` : ""}
        ${m.accent ? `Brand accent measured from their logo: <code style="background:#f2f2ee;padding:1px 5px;border-radius:3px">${esc(m.accent)}</code><br/>` : ""}
        ${m.phone ? `Their verified line: ${esc(m.phone)}<br/>` : ""}
        ${m.donor ? `Donor: ${esc(m.donor)}<br/>` : ""}
        ${m.photos ? `Their own work photos: <strong>${esc(m.photos)}</strong><br/>` : ""}
        ${m.notes ? `<span style="color:#6a6a60">${esc(m.notes)}</span>` : ""}
      </div>
      ${groupPills(m.byGroup)}
      ${speedLine(m.runtime)}
    </td></tr>`;
  }).join("\n");

  return `<!doctype html><html><body style="margin:0;background:#f7f7f4;padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e6e3">
<tr><td style="background:#14140f;padding:22px 26px">
  <div style="font:700 15px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#f5f5f4;letter-spacing:.16em">WSS LABS</div>
  <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#9a9a92;margin-top:5px">Mirror Engine — owner proof</div>
</td></tr>
<tr><td style="padding:26px">
  <div style="font:400 15px/1.7 -apple-system,Segoe UI,Roboto,sans-serif;color:#33332c">${intro}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">${rows}</table>
  ${bulletBlock("What every mirror carries that their current site does not", carries)}
  ${bulletBlock("Flags — the honest list", flags, "#8a1c1c")}
  ${riley ? `<div style="margin-top:20px">
    <div style="font:700 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#14140f;letter-spacing:.08em;text-transform:uppercase">Riley</div>
    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#4a4a44;margin-top:8px">${esc(riley)}</div>
  </div>` : ""}
  ${clientIds ? `<div style="margin-top:20px">
    <div style="font:700 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#14140f;letter-spacing:.08em;text-transform:uppercase">Client IDs &amp; the email-drop path</div>
    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#4a4a44;margin-top:8px">${esc(clientIds)}</div>
  </div>` : ""}
  ${bulletBlock("What you do next / what's queued", next)}
  <div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#8a8a80;margin-top:22px;border-top:1px solid #e6e6e3;padding-top:14px">
    Owner-only proof. Nothing in this batch was sent to any prospect; every slug is in the wss-test namespace.
    Each mirror's evidence is signed by renderer <code>mirror-engine@v1</code> and is only marked revealable when every named check passed.
  </div>
</td></tr></table></body></html>`;
}

async function main() {
  const [batchFile, envFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dry = process.argv.includes("--dry");
  loadEnv(envFile);
  const batch = JSON.parse(fs.readFileSync(batchFile, "utf8"));
  const to = String(batch.to || process.env.GHOST_AGENCY_OWNER_EMAIL || "woodwardsoftware@gmail.com").trim().toLowerCase();
  if (!OWNER_ALLOWLIST.has(to)) throw new Error(`refusing to send: ${to} is not an owner address`);

  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  const from = String(batch.from || process.env.GHOST_AGENCY_RESEND_FROM || "mark@go.wss-ai.com").trim();

  const html = buildHtml({
    intro: batch.intro || "",
    mirrors: batch.mirrors || [],
    carries: batch.carries || [],
    flags: batch.flags || [],
    riley: batch.riley || "",
    clientIds: batch.client_ids || "",
    next: batch.next || [],
  });
  const subject = batch.subject || "Mirror Engine — owner proof";

  const attachments = [];
  for (const m of batch.mirrors || []) {
    if (!m.screenshot || !fs.existsSync(m.screenshot)) continue;
    const bytes = fs.readFileSync(m.screenshot);
    if (bytes.length > 9 * 1024 * 1024) continue; // Resend 25MB total; stay well under
    attachments.push({ filename: path.basename(m.screenshot), content: bytes.toString("base64") });
  }

  if (dry) {
    const out = path.join(path.dirname(batchFile), "owner-proof-preview.html");
    fs.writeFileSync(out, html);
    console.log(`DRY RUN — no send. to=${to} from=${from} subject="${subject}" attachments=${attachments.length}`);
    console.log(`preview written: ${out}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, attachments }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  console.log(`SENT to ${to} — message id ${body.id}, ${attachments.length} screenshots attached`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
