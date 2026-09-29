"use strict";

// Public branded growth report. Signed link (see lib/report-links.js) so only
// the prospect who received the email can open it. Renders from the signed
// payload, refreshed from ghost_agency_prospects when available. Never shows
// internal terms. noindex.

const { verifyReportLink } = require("../lib/report-links");
const { select } = require("../lib/store");
const { onReportViewed } = require("../lib/hot-view");
const { agencyAgentPhone } = require("../lib/email");

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// DIY roadmap: for every gap we name, we hand over the actual fix — free.
// That's the trust play: most owners see the work involved and ask us to do it.
const ROADMAP = [
  [/no website listed/i, "Claim your Google Business Profile at google.com/business, add your website (or your new preview once it's live), and fill every field - hours, services, photos."],
  [/failed to load|website failed/i, "Log into your hosting account and check if the plan lapsed or the domain expired. If you're not sure who hosts it, reply and we'll find out for you - no charge."],
  [/non-https/i, "Ask your hosting company to enable the free SSL certificate (Let's Encrypt). It takes them minutes and removes the 'Not secure' warning in Chrome."],
  [/slow first html|slow.*response/i, "Compress your images (tinypng.com, free), remove unused plugins, and ask your host about caching. Target: your site visible in under 2 seconds on a phone."],
  [/missing meta description/i, "Add a 150-character description of what you do and where to every page's meta description - that's the text Google shows under your name in results."],
  [/no obvious logo/i, "Put your logo (even a simple one - canva.com is free) in the site header on every page, and upload it to your Google Business Profile."],
  [/thin visible media|candidate images/i, "Add 10-15 photos of real jobs: before/after shots are the highest-converting content a local business can post. Phone photos are fine."],
  [/low review count/i, "Text your last 10 happy customers your Google review link (find it in your Business Profile under 'Ask for reviews'). Two sentences: thanks + the link."],
];
function roadmapFor(weaknesses = []) {
  const steps = [];
  for (const w of weaknesses) {
    const hit = ROADMAP.find(([re]) => re.test(String(w)));
    if (hit && !steps.includes(hit[1])) steps.push(hit[1]);
  }
  steps.push("Get listed consistently: same exact business name, address, and phone on Google, Yelp, Facebook, and your site. AI assistants like ChatGPT and Google's AI results pull from these - inconsistency makes them skip you.");
  return steps.slice(0, 6);
}

function classify(w) {
  return /failed|non-https|no website|broken|missing/i.test(w) ? "#ff7269" : "#ffd05f";
}

function page(p) {
  const weaknesses = (p.weaknesses || []).slice(0, 6);
  const strengths = [];
  if (p.rating >= 4.4) strengths.push(`Strong reputation: ${p.rating}★ across ${p.review_count} Google reviews`);
  if (p.review_count >= 20) strengths.push("Review volume most competitors nearby don't have");
  if (!strengths.length) strengths.push("A real local track record buyers can verify on Google");
  const row = (t, c) => `<li style="display:flex;gap:12px;align-items:baseline;background:#0b1a2b;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:13px 16px;margin:0 0 10px"><span style="width:10px;height:10px;border-radius:99px;flex:none;background:${c}"></span><span>${esc(t)}</span></li>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.business_name)} — Local Growth Report | WSS Labs</title>
<meta name="robots" content="noindex,nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;background:#0A0F1E;color:#E8ECF8;font:16px/1.6 Inter,system-ui,sans-serif}.shell{width:min(860px,calc(100% - 40px));margin-inline:auto}h1{font:700 clamp(28px,5vw,42px)/1.12 Fraunces,serif;margin:34px 0 8px}h2{font:700 23px Fraunces,serif;margin:0 0 12px}.sub{color:#9fb0c3;max-width:62ch}ul{list-style:none;padding:0;margin:0}</style>
</head><body><div class="shell">
<header style="padding:24px 0;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:14px;flex-wrap:wrap">
<svg width="44" height="44" viewBox="0 0 64 64" style="width:44px;height:44px;border-radius:12px" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#131318"/><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="#4A6CF7" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="20" r="4" fill="#4A6CF7"/></svg>
<div><b style="font:700 19px Fraunces,serif;letter-spacing:.06em;color:#E8ECF8">WSS<span style="color:#7f93b3;font-weight:600;letter-spacing:.2em;font-size:14px"> LABS</span></b><small style="color:#9fb0c3;display:block;font-size:12px">Local Growth Report — prepared for ${esc(p.business_name)}</small></div>
${agencyAgentPhone() ? `<a href="tel:${agencyAgentPhone().replace(/[^+\d]/g, "")}" style="margin-left:auto;background:linear-gradient(90deg,#00E5FF22,#7C5CFF33);border:1px solid rgba(124,92,255,.45);color:#f7f4ea;text-decoration:none;border-radius:999px;padding:9px 18px;font:600 13px Inter,system-ui,sans-serif">Questions? Call ${esc(agencyAgentPhone())}</a>` : ""}
</header>
<h1>${esc(p.business_name)}: what buyers in ${esc(p.city || "your area")} see today.</h1>
<p class="sub">We reviewed how ${esc(p.business_name)} shows up when a local customer searches for a ${esc(p.industry || "local service")} in ${esc(p.city || "your area")} — your Google profile, your current site, and what's standing between you and the next call.</p>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin:30px 0">
<div style="background:#0b1a2b;border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:18px"><b style="font:700 26px Fraunces,serif;display:block">${p.rating ? `${p.rating}★` : "—"}</b><span style="color:#9fb0c3;font-size:13px">Google rating (${p.review_count || 0} reviews)</span></div>
<div style="background:#0b1a2b;border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:18px"><b style="font:700 26px Fraunces,serif;display:block">${weaknesses.length}</b><span style="color:#9fb0c3;font-size:13px">Fixable visibility gaps found</span></div>
<div style="background:#0b1a2b;border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:18px"><b style="font:700 26px Fraunces,serif;display:block">${p.website ? "Live" : "None"}</b><span style="color:#9fb0c3;font-size:13px">Current website</span></div>
</div>
<section style="margin:34px 0"><h2>What's already working</h2><ul>${strengths.map((s) => row(s, "#59d99d")).join("")}</ul></section>
<section style="margin:34px 0"><h2>What's costing you calls</h2><ul>${weaknesses.length ? weaknesses.map((w) => row(w, classify(w))).join("") : row("Your current web presence isn't converting the reputation you've already earned.", "#ffd05f")}</ul></section>
<section style="margin:34px 0"><h2>Your fix-it-yourself roadmap</h2>
<p class="sub" style="margin:0 0 14px">Everything below is yours to do, free, no strings. Print it, hand it to your nephew, whatever works. (Fair warning: it's a few weekends of work - which is exactly why our clients have us do it.)</p>
<ol style="margin:0;padding-left:20px;color:#c9d4e0;font-size:15px">${roadmapFor(p.weaknesses || []).map((step) => `<li style="margin:0 0 12px">${esc(step)}</li>`).join("")}</ol></section>
${p.preview_url ? `<div style="background:linear-gradient(135deg,rgba(255,208,95,.12),rgba(255,114,105,.10));border:1px solid rgba(255,208,95,.35);border-radius:20px;padding:26px;margin:38px 0">
<h2 style="margin-top:0">We already built your new site.</h2>
<p class="sub">Not a mockup — a finished preview, designed around your reviews, your services, and ${esc(p.city || "local")} searches. If you like it, launch includes hosting, same-day edits, and a real human on the other end.</p>
<p style="margin:16px 0 0"><a href="${esc(p.preview_url)}" style="display:inline-flex;align-items:center;min-height:48px;padding:14px 24px;border-radius:999px;font-weight:700;text-decoration:none;background:linear-gradient(135deg,#7c5cff,#b06ef7);color:#06101c">See your new website</a></p>
</div>` : ""}
<footer style="border-top:1px solid rgba(255,255,255,.08);color:#9fb0c3;font-size:13px;padding:26px 0;margin-top:44px">Prepared by WSS Labs · a Woodward Software Systems company · Sources: public Google Business Profile + your public website. This page is private to ${esc(p.business_name)} and not indexed. Reply to our email any time with questions — or say "not interested" and we'll close the file.</footer>
</div></body></html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.statusCode = 405;
    return res.end("Method not allowed");
  }
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const check = verifyReportLink(req.query?.token, req.query?.sig);
  if (!check.ok) {
    res.statusCode = check.reason === "expired" ? 410 : 401;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end("<!doctype html><meta name=\"robots\" content=\"noindex\"><body style=\"font-family:system-ui;background:#0A0F1E;color:#E8ECF8;display:grid;place-items:center;min-height:100vh\"><p>This report link has expired. Reply to our email and we'll send a fresh one.</p>");
  }
  const p = { ...check.payload };
  // Max-momentum: they are reading the report right now — fire-and-forget the
  // hot-view trigger (agent drafts outreach while they're warm).
  onReportViewed({ prospectId: p.prospect_id, source: "api_report" }).catch(() => {});
  try {
    const found = await select(
      "ghost_agency_prospects",
      `?select=business_name,city,industry,preview_url,record&prospect_id=eq.${encodeURIComponent(p.prospect_id)}&limit=1`,
    );
    const row = found.ok && Array.isArray(found.data) && found.data[0] ? found.data[0] : null;
    if (row) {
      const rec = row.record && typeof row.record === "object" ? row.record : {};
      p.business_name = row.business_name || p.business_name;
      p.city = row.city || p.city;
      p.industry = row.industry || p.industry;
      p.preview_url = row.preview_url || p.preview_url;
      p.rating = Number(rec.rating || p.rating) || p.rating;
      p.review_count = Number(rec.review_count || rec.reviewCount || p.review_count) || p.review_count;
      const w = rec.weaknesses || rec.weaknessReasons;
      if (Array.isArray(w) && w.length) p.weaknesses = w.slice(0, 6);
    }
  } catch { /* fall back to signed payload */ }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(page(p));
};
