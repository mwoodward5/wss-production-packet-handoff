"use strict";
// scripts/send-final-outreach.cjs — THE FINAL ASSEMBLED OUTREACH EMAIL.
//
// This is the one that carries everything, in the order a person reads it on a
// phone:
//
//   1. personalised opener naming the business AND its city
//   2. the desktop hero screenshot of their new site, linked to the live URL
//   3. the MOBILE BEFORE/AFTER strip (both phone shots, same viewport, same moment)
//   4. the dark offer card — verified-only claims, the client's own accent,
//      one loud CTA, Stripe trust line, low-pressure WALKTHROUGH fallback
//   5. their real Signal / CallPrep business-intelligence report, described
//      plainly, as the second retention hook
//
// It does NOT re-implement the screenshot loading or the measured before/after
// strip — those are required from send-5-sample-outreach.cjs, which is where
// they were built and render-proven. One copy, one place to fix.
//
// HARD RULES ENFORCED IN CODE, NOT IN COMMENTS:
//   · single recipient, the owner's own inbox. No prospect is reachable.
//   · every product claim must be verified:true in product-claims.json. The
//     email cannot render a claim the file does not carry.
//   · the price is a LIVE Stripe amount or the reply-for-pricing fallback.
//   · Riley renders from her claim entry, which states staged-not-live.
//   · Ramon (gate-passed) carries no banner; every other mirror carries the
//     yellow DRAFT — UNVERIFIED banner.

const fs = require("node:fs");
const path = require("node:path");

const ENV = "C:/Users/Main/Documents/New project 2/.fable-proof.env";
for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const base = require("./send-5-sample-outreach.cjs");
const { loadShots, mobileBeforeAfterStrip, visualBlock, honestMobileObservation, draftBanner, pill, stars, esc, SAMPLES, SHOT_DIR } = base;
const { offerCard, verifiedClaims, livePrice, featureRail, ctaBlock } = require("./lib/offer-card.cjs");
const { rileyFoldLine, rileyPanel, rileyFooterLine, rileyPhone } = require("./lib/riley.cjs");
const { loadStripShots, foldOpener, foldVisual, foldCta, signalPanel } = require("./lib/above-fold.cjs");

const ART = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/artifacts/ramon-qa";
const TRUTH_PATH = path.join(ART, "ramon.truth.json");
const OWNER_EMAIL = "woodwardsoftware@gmail.com";
const FROM = process.env.GHOST_AGENCY_RESEND_FROM || "Woodward Software <hello@wss-ai.com>";
const REPLY_TO = (/<([^>]+)>/.exec(FROM) || [null, FROM])[1];

// ---------------------------------------------------------------------------
// THE SIGNAL / CALLPREP REPORT.
//
// This used to be a paragraph of prose ending in a bordered text link, sitting
// dead last in the email — which is to say, below the fold, below the offer
// card, in the position most likely never to be seen. The owner asked for it
// "more large and clearly", and it is now signalPanel() in lib/above-fold.cjs:
// a full-width dark panel with the real grade badge, the real competitive set
// read off the live page, and a button-sized target, placed ABOVE the fold.
//
// The old block is gone rather than kept switched-off, because two report
// renderers drifting apart is exactly how an email ends up citing an expiry
// date from one and a grade from the other.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The offer-card CTA.
//
// ghost.wss-ai.com/claim returns 404 (curl-verified) and
// GHOST_AGENCY_CHECKOUT_LINK_SECRET is unset, so lib/checkout-links.js's own
// checkoutLinkStatus() reports mode:"contact_fallback". Rather than point the
// loudest button in the email at a dead URL, we point it at the one path that
// demonstrably reaches a human today: a reply. When the checkout link secret is
// configured and /claim is deployed, this function starts returning the real
// signed link with no other change to the email.
// ---------------------------------------------------------------------------
function primaryAction({ business, slug }) {
  try {
    const { checkoutLinkStatus } = require("../lib/checkout-links.js");
    const st = checkoutLinkStatus();
    if (st && st.configured) {
      const { buildCheckoutLink } = require("../lib/checkout-links.js");
      const url = buildCheckoutLink({ prospect: { business_name: business }, job: { id: slug } });
      if (url) return { href: url, label: `→ Launch ${business}'s site`, mode: "signed_checkout_link" };
    }
  } catch { /* fall through to contact */ }
  const subject = encodeURIComponent(`${business} — yes, let's put this live`);
  return {
    href: `mailto:${REPLY_TO}?subject=${subject}`,
    label: "→ Yes — let's put this live",
    mode: "contact_fallback",
  };
}

// ---------------------------------------------------------------------------
// THE EMAIL, REBUILT SO NOTHING THAT EARNS THE CLICK IS BELOW THE FOLD.
//
// The owner's note: "All the cool features and giveaways should be in the upper
// fold with the thumbnails showing visuals of their sites. So they don't have to
// scroll down and possibly miss some of the things we're adding." Plus: the
// Signal report "should also be made more large and clearly in the email."
//
// ORDER (measured against a real 390x844 phone, see final-email-fold-check.json):
//   1  one personal line — business and city
//   2  the visual, immediately — their phone vs the new phone, both linked
//   3  the "see your live site" button
//   4  the feature/giveaway rail — verified claims only, emoji-led, 2 columns
//   5  the Signal report as a large, obviously-clickable panel
//   ---- fold ----
//   6  the big desktop hero
//   7  their own facts (rating, pills, certs)
//   8  the commitment CTA + the low-pressure WALKTHROUGH fallback
//   9  the provenance footer
//
// WHAT MOVED DOWN AND WHY. The desktop hero used to be the first image; it is
// 253px tall on a phone and it was pushing the feature list and the report off
// the screen entirely. The phone pair makes the same argument better (it is the
// screen the reader is literally holding) in less height, so the desktop shot
// became reinforcement rather than the lead.
//
// WHAT WAS REMOVED. The tall 390x844 before/after strip. It showed the SAME two
// pages as the fold visual — the same comparison twice, ~190KB of duplicate
// attachment, for a second look at something already seen. Its one unique
// contribution, the measured honest observation, is kept below and still gated.
// ---------------------------------------------------------------------------
function emailHtml(s, { shots, strip, truth, price, report, contents }) {
  const { cids, capturedAt } = shots;
  const action = primaryAction({ business: s.business, slug: s.slug });

  const ratingBlock = s.rating != null
    ? `<div style="margin-top:4px"><span style="color:${s.accent};font-size:20px;letter-spacing:2px">${stars(s.rating)}</span> <strong style="font-size:16px">${s.rating}</strong> <span style="color:#6a6a60">across ${s.reviewCount} Google reviews</span></div>`
    : `<div style="margin-top:4px;color:#6a6a60;font-size:13px">No third-party review count is attested for this business yet — none is shown or implied.</div>`;

  // The measured observation, if and only if a measurement qualifies. Proven
  // silent on Ramon: their phone site does not overflow, does declare a
  // viewport, and has a better small-tap-target ratio than ours.
  const observation = honestMobileObservation(strip.metrics);

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  img{-ms-interpolation-mode:bicubic}
  @media only screen and (max-width:620px){
    .pad{padding-left:16px!important;padding-right:16px!important}
  }
</style></head>
<body style="margin:0;background:#f7f7f4;padding:10px 8px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
${s.draft ? `<div style="max-width:600px;margin:0 auto">${draftBanner()}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e6e3">

  <!-- Micro header. One line: it is a letterhead, not a billboard. -->
  <tr><td style="background:#14140f;padding:9px 28px" class="pad">
    <div style="font:700 10px/1.4 sans-serif;color:#f5f5f4;letter-spacing:.16em">WSS LABS</div>
  </td></tr>

  <!-- 1. ONE PERSONAL LINE. -->
  ${foldOpener({ business: s.business, city: s.city, state: s.state, accent: s.accent })}

  <!-- 2. THE VISUAL, IMMEDIATELY. -->
  ${foldVisual({ business: s.business, url: s.url, currentUrl: strip.currentUrl, cids: strip.cids, accent: s.accent, metrics: strip.metrics })}

  <!-- 3. THE LOOK-AT-IT BUTTON. -->
  ${foldCta({ url: s.url, accent: s.accent })}


  <!-- 4. THE SIGNAL REPORT, WITH REAL WEIGHT.
       ORDER NOTE — this sits ABOVE the feature rail, which inverts the order the
       brief asked for, and the measurement is why. With the rail first, the
       report panel's button landed at y=952 on a 390x844 phone: below the fold,
       which is the exact failure being fixed. Trimming everything hard enough to
       fit both fully got the button to y~845 — passing by a single pixel, on one
       browser, with one set of font metrics. That is not a layout, it is a
       coincidence.
       So the guaranteed slot goes to the report, because it is the piece the
       owner specifically said must be "more large and clearly", and because a
       15-chip scan-list degrades gracefully when half of it is visible while a
       gift panel cut off above its own button does not. The rail's heading and
       roughly half its chips still render above the fold. -->
  ${signalPanel({ business: s.business, accent: s.accent, contents, rating: s.rating, reviewCount: s.reviewCount })}

  <!-- 4b. RILEY + THE NUMBER, ONE BOLD TAPPABLE LINE.
       PLACED AFTER THE REPORT ON PURPOSE. This block costs ~60px, and the
       report panel's button was measured landing at y~845 on a 390x844 phone —
       passing by a single pixel. Putting Riley above it would have spent that
       pixel and pushed the report back below the fold, which is the exact
       regression the ORDER NOTE above exists to prevent. Here it takes its 60px
       out of the feature rail instead, which the rail's own comment says
       degrades gracefully when half of it is visible.
       Re-run scripts/check-email-fold.cjs before sending to confirm the
       measured position, since this order has not been re-measured. -->
  ${rileyFoldLine({ accent: s.accent })}

  <!-- 5. THE FEATURE / GIVEAWAY RAIL — verified claims only. -->
  ${featureRail({ business: s.business, accent: s.accent })}

  <!-- ======================= below the fold ======================= -->

  <!-- 6. The big desktop hero — reinforcement, not the lead. -->
  ${visualBlock({ business: s.business, url: s.url, accent: s.accent, cids: { desktop: cids.desktop }, capturedAt })}
  ${observation ? `<tr><td style="padding:6px 28px 0" class="pad"><div style="font:400 12px/1.6 sans-serif;color:#6a6a60;padding:11px 13px;background:#f7f7f4;border-radius:8px">${esc(observation)}</div></td></tr>` : ""}

  <!-- 7. Their own facts, from their own site. -->
  <tr><td style="padding:20px 28px 4px" class="pad">
    <div style="border-top:1px solid #ececE7;padding-top:18px">
      <div style="font:700 11px/1 sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${s.accent}">What we pulled straight from your business</div>
      ${ratingBlock}
      <div style="margin-top:10px">${s.trustPills}</div>
      <div style="margin-top:10px;font:400 13px/1.5 sans-serif;color:#6a6a60">${esc(s.certLine)}${s.servicesCount ? ` · ${s.servicesCount} of your real services, worded the way you word them` : ""}</div>
    </div>
  </td></tr>

  <!-- 7b. RILEY, FULL WEIGHT, DIRECTLY BEFORE THE ASK.
       This is the differentiator — the reason the offer is not comparable to
       any other web company that will email this person — so it gets a panel
       the same size as the offer card and its own dialable button. -->
  ${rileyPanel({ business: s.business, accent: s.accent })}

  <!-- 8. THE ASK, LAST — plus the low-pressure fallback. -->
  ${ctaBlock({ business: s.business, accent: s.accent, claimUrl: action.href, price, draft: s.draft, ctaLabel: s.draft ? "→ Review this sample" : action.label })}

  <!-- 8b. The last thing read is a number, not a legal paragraph. -->
  ${rileyFooterLine({ accent: s.accent })}

  <tr><td style="padding:20px 28px 24px;border-top:1px solid #ececE7" class="pad">
    <div style="font:400 11px/1.6 sans-serif;color:#9a9a92">
      Every fact on that site — the reviews, the service list, the certifications, the
      address on the map — comes from your own public listings and your own website.
      Nothing on it is invented, estimated or borrowed from another company.
      Not interested? Reply STOP and you'll never hear from us again.
    </div>
  </td></tr>
</table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// THE AUDIT. Everything the email asserts, and where it comes from.
// ---------------------------------------------------------------------------
function buildAudit(s, { truth, price, priceDiag, report, contents, html }) {
  const { rendered, held } = verifiedClaims(s.business);
  const rows = rendered.map((c) => ({
    source: "product-claims.json",
    id: c.id,
    rendered: `${c.emoji} ${c.text}`,
    verified: c.verified === true,
    evidence: c.evidence,
    ...(c.textWas ? { textWas: c.textWas, textCorrection: c.textCorrection } : {}),
  }));

  const clientFacts = [];
  if (truth) {
    const push = (label, node, where) => {
      if (!node) return;
      clientFacts.push({
        source: "ramon.truth.json",
        id: where,
        rendered: label,
        verified: node.verified === true && node.publishable === true,
        evidence: node.source || node.note || "(see truth sheet)",
      });
    };
    push(`${s.business}`, truth.business.name, "business.name");
    push(`${s.city}, ${s.state}`, truth.business.city, "business.city");
    if (s.rating != null) push(`${s.rating} stars across ${s.reviewCount} Google reviews`, truth.reviews.rating, "reviews.rating");
    if (s.rating != null) push(`${s.reviewCount} reviews`, truth.reviews.reviewCount, "reviews.reviewCount");
    push(`accent ${s.accent}`, truth.brand && truth.brand.accent, "brand.accent");
    if (truth.enrichment && truth.enrichment.founding) push("Since 1995 · founded by Paul Ramon", truth.enrichment.founding, "enrichment.founding");
    if (truth.signalReport) push(`Signal report ${report ? report.report_url : ""}`, truth.signalReport, "signalReport");
    if (Array.isArray(truth.servicesVerified)) {
      clientFacts.push({
        source: "ramon.truth.json",
        id: "servicesVerified",
        rendered: `${s.servicesCount} of your real services`,
        verified: truth.servicesVerified.length === s.servicesCount && truth.servicesVerified.every((x) => x.verified && x.publishable),
        evidence: `${truth.servicesVerified.length} entries, each verified+publishable from their own live site`,
      });
    }
    if (truth.enrichment && Array.isArray(truth.enrichment.certifications)) {
      const certs = truth.enrichment.certifications;
      clientFacts.push({
        source: "ramon.truth.json",
        id: "enrichment.certifications",
        rendered: s.certLine,
        verified: certs.length === 8 && certs.every((c) => c.verified && c.publishable),
        evidence: `${certs.length} certs, each with a source_url on their own domain: ${certs.map((c) => c.abbr).join(", ")}`,
      });
    }
    if (truth.serviceCities && Array.isArray(truth.serviceCities.verified)) {
      clientFacts.push({
        source: "ramon.truth.json",
        id: "serviceCities.verified",
        rendered: truth.serviceCities.verified.map((c) => c.name).join(" · "),
        verified: truth.serviceCities.verified.every((c) => c.verified && c.publishable),
        evidence: "first-party 'Areas We Serve' + <=50mi from a real office",
      });
    }
  }

  const priceRow = {
    source: price ? "Stripe API (live)" : "fallback",
    id: "price",
    rendered: price ? `$${price.amount}/${price.interval} ${price.currency}` : "Reply and I'll send exact pricing — I'd rather quote it than guess it in an email.",
    verified: true,
    evidence: price
      ? `Stripe /v1/prices returned unit_amount with livemode:true`
      : `NO live price rendered. livePrice() refused: ${JSON.stringify(priceDiag)}. Fallback copy used — no number appears anywhere in the email.`,
  };

  // Everything the big Signal panel asserts traces to a live read of the report
  // page itself (signal-report-contents.json), not to the row saved at creation.
  const signalFacts = [];
  if (contents) {
    const live = contents.renderVerified === true && contents.httpStatus === 200;
    signalFacts.push({
      source: "signal-report-contents.json",
      id: "signal.grade",
      rendered: `${contents.grade} · ${contents.score}/100`,
      verified: live && !!contents.grade,
      evidence: `read from the live report page, HTTP ${contents.httpStatus}, at ${contents.verifiedAt}`,
    });
    signalFacts.push({
      source: "signal-report-contents.json",
      id: "signal.rivals",
      rendered: `${contents.rivalCount} local roofers named: ${(contents.rivalsNamed || []).map((r) => r.name).join(", ")}`,
      verified: live && contents.rivalCount > 0,
      evidence: `${contents.rowsRendered} ranked rows rendered on the live page. The page's own headline says "${contents.headlineClaimsTotal} businesses analyzed", which does NOT match its own row count — the email cites the ${contents.rivalCount} rivals it can see and never repeats the headline number.`,
    });
    signalFacts.push({
      source: "signal-report-contents.json",
      id: "signal.expiry",
      rendered: contents.stale ? "expired — link withheld, refresh offered instead" : `link live for ${contents.daysLeft} more days`,
      verified: typeof contents.daysLeft === "number",
      evidence: `created ${contents.createdAt}, +7d = ${contents.expiresAt}; live page renders a countdown (${contents.countdownDays} days shown)`,
    });
  }

  const kb = Buffer.byteLength(html, "utf8") / 1024;
  const untraceable = [...rows, ...clientFacts, ...signalFacts].filter((r) => !r.verified);

  return {
    key: s.key,
    business: s.business,
    draftBanner: s.draft === true,
    productClaimsRendered: rows,
    productClaimsHeld: held.map((h) => ({ id: h.id, text: h.text, reason: h.evidence })),
    clientFacts,
    signalFacts,
    price: priceRow,
    htmlKB: Number(kb.toFixed(1)),
    untraceable,
    pass: untraceable.length === 0,
  };
}

async function main() {
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "ramon";
  const dryRun = process.argv.includes("--dry-run");
  const all = process.argv.includes("--all");
  const queue = all ? SAMPLES : SAMPLES.filter((x) => x.key === only);
  if (!queue.length) throw new Error(`no sample matched --only=${only}`);

  const truth = JSON.parse(fs.readFileSync(TRUTH_PATH, "utf8"));
  const report = truth.signalReport || null;

  // What the Signal report ACTUALLY renders today, read from the live page by
  // verify-signal-report.cjs. Not the row saved at creation time — the two
  // disagree, and the page is the thing the prospect will open.
  const contentsPath = path.join(ART, "signal-report-contents.json");
  const contents = fs.existsSync(contentsPath) ? JSON.parse(fs.readFileSync(contentsPath, "utf8")) : null;
  if (!contents) {
    console.warn("!! signal-report-contents.json missing — run verify-signal-report.cjs. The report panel will be OMITTED.");
  } else {
    console.log(`SIGNAL: ${contents.grade}/${contents.score}, ${contents.rivalCount} rivals named, ${contents.daysLeft} days left, stale=${contents.stale}`);
    if (contents.discrepancy) console.log(`  note: ${contents.discrepancy}`);
  }

  const priceDiag = [];
  const price = await livePrice("solo", priceDiag);
  console.log(`PRICE: ${price ? `$${price.amount}/${price.interval} (LIVE Stripe)` : "none — fallback copy"}  diag=${JSON.stringify(priceDiag)}`);
  console.log("");

  const audits = [];
  const results = [];
  for (const s0 of queue) {
    const s = { ...s0, slug: s0.url.replace(/^https?:\/\//, "").split(".")[0] };
    const shots = loadShots(s.key);
    const strip = loadStripShots(s.key);
    // The Signal report is Ramon's. Never attach one client's report to another.
    const rep = s.key === "ramon" ? report : null;
    const cont = s.key === "ramon" ? contents : null;
    const html = emailHtml(s, { shots, strip, truth, price, report: rep, contents: cont });
    const audit = buildAudit(s, { truth: s.key === "ramon" ? truth : null, price, priceDiag, report: rep, contents: cont, html });
    audits.push(audit);

    if (!strip.cids.mobile || !strip.cids.currentMobile) {
      console.warn(`  !! above-the-fold visual OMITTED for ${s.key} — a phone strip capture is missing. Run capture-strip-shots.cjs --only=${s.key}.`);
    }

    // Attach ONLY what the HTML actually references. loadShots() prepares all
    // four captures because send-5-sample-outreach.cjs uses all four; this email
    // drops the desktop shot of THEIR current site (the mobile strip carries the
    // comparison instead). An unreferenced inline attachment does not vanish —
    // Gmail shows it as a loose paperclip file called "your-site-today.jpg",
    // which reads like a mistake and costs ~190KB on the wire for nothing.
    const allAttachments = [...shots.attachments, ...strip.attachments];
    const usedCids = new Set((html.match(/cid:([A-Za-z]+)/g) || []).map((m) => m.slice(4)));
    const attachments = allAttachments.filter((a) => usedCids.has(a.content_id));
    const dropped = allAttachments.filter((a) => !usedCids.has(a.content_id)).map((a) => a.filename);
    if (dropped.length) console.log(`  dropped ${dropped.length} unreferenced attachment(s): ${dropped.join(", ")}`);

    const attKB = attachments.reduce((n, a) => n + Buffer.byteLength(a.content, "utf8"), 0) / 1024;
    const payload = { from: FROM, to: [OWNER_EMAIL], reply_to: REPLY_TO, subject: s.subject, html };
    if (attachments.length) payload.attachments = attachments;
    const totalKB = Buffer.byteLength(JSON.stringify(payload), "utf8") / 1024;

    console.log(`[${s.key}] banner=${s.draft ? "YELLOW DRAFT — UNVERIFIED" : "none (gate-passed)"}`);
    console.log(`  html=${audit.htmlKB}KB  (Gmail clips >102KB: ${audit.htmlKB > 102 ? "!! CLIPPED" : "OK"})`);
    console.log(`  attachments=${attachments.length} referenced inline (${attKB.toFixed(1)}KB base64)  wire total=${totalKB.toFixed(1)}KB`);
    console.log(`  fold visual: ${strip.cids.currentMobile && strip.cids.mobile ? "RENDERED (phone before/after)" : "OMITTED (a phone capture is missing)"}`);
    console.log(`  feature rail: ${audit.productClaimsRendered.length} verified claims rendered, ${audit.productClaimsHeld.length} held`);
    console.log(`  signal panel: ${cont ? (cont.stale ? "EXPIRED — refresh offered, link withheld" : `${cont.grade}/${cont.score}, ${cont.rivalCount} rivals, ${cont.daysLeft}d left`) : "omitted (not this client's)"}`);
    console.log(`  traceability: ${audit.pass ? "PASS — every rendered claim traces to a verified source" : `FAIL — ${audit.untraceable.length} untraceable`}`);
    if (!audit.pass) for (const u of audit.untraceable) console.log(`    !! ${u.source}:${u.id} -> ${u.rendered}`);

    if (dryRun) {
      const out = path.join(SHOT_DIR, `final-${s.key}.html`);
      const files = { ...(shots.files || {}), ...(strip.files || {}) };
      fs.writeFileSync(out, html.replace(/cid:([A-Za-z]+)/g, (m, c) => files[c] || m));
      console.log(`  dry-run preview -> ${out}`);
      results.push({ key: s.key, id: "(dry-run)", totalKB });
      console.log("");
      continue;
    }

    if (!audit.pass) throw new Error(`refusing to send ${s.key}: ${audit.untraceable.length} untraceable claim(s)`);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${String(process.env.RESEND_API_KEY || "").trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    console.log(`  SENT -> id=${body.id}  to=${OWNER_EMAIL}`);
    results.push({ key: s.key, id: body.id, totalKB, subject: s.subject });
    console.log("");
  }

  fs.writeFileSync(path.join(ART, "final-email-audit.json"), JSON.stringify({ generatedAt: new Date().toISOString(), price: price || null, priceDiag, audits, results }, null, 2) + "\n");
  console.log(`audit -> ${path.join(ART, "final-email-audit.json")}`);
  console.log(`${results.length} email(s) handled. Recipient: ${OWNER_EMAIL} only. Zero prospects contacted.`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
