"use strict";
// scripts/lib/above-fold.cjs
// -----------------------------------------------------------------------------
// The blocks that make the FIRST SCREENFUL carry the value.
//
// THE FAILURE MODE THIS FIXES. A prospect opens the email on a phone, sees a
// paragraph and a button, and never scrolls — so the screenshots, the feature
// list and the free report, which are the entire reason to click, are never
// seen. Everything here is sized against a real 390x844 phone viewport and the
// order is: one line, the picture, what they get, the report, then the ask.
//
// WHAT IS DELIBERATELY *NOT* HERE: the desktop hero, the long-form claim prose,
// and the client-facts block. They are good content but they are second-screen
// content, and every pixel they take above the fold costs something that earns
// the click.
// -----------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

const SHOT_DIR = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/artifacts/ramon-qa/email-shots";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * The SHORT phone pair (390x620) captured by capture-strip-shots.cjs.
 * Returns cids only for shots that exist AND succeeded — a failed capture omits
 * the panel rather than showing one phone or a stand-in.
 */
function loadStripShots(key) {
  const mp = path.join(SHOT_DIR, "strip-manifest.json");
  if (!fs.existsSync(mp)) return { attachments: [], cids: {}, metrics: {} };
  const man = JSON.parse(fs.readFileSync(mp, "utf8"));
  const rec = man.shots && man.shots[key];
  if (!rec) return { attachments: [], cids: {}, metrics: {} };

  const want = [
    { field: "currentMobile", cid: "foldBefore", file: `${rec.slug}-current-mobile-strip.jpg`, name: "your-site-today-on-a-phone.jpg" },
    { field: "mobile", cid: "foldAfter", file: `${rec.slug}-mobile-strip.jpg`, name: "your-new-site-on-a-phone.jpg" },
  ];
  const attachments = [], cids = {}, files = {}, metrics = {};
  for (const w of want) {
    const shot = rec[w.field];
    if (!shot || !shot.ok) continue;
    const abs = path.join(SHOT_DIR, w.file);
    if (!fs.existsSync(abs)) continue;
    attachments.push({
      filename: w.name,
      content: fs.readFileSync(abs).toString("base64"),
      content_type: "image/jpeg",
      content_id: w.cid,
    });
    cids[w.field] = w.cid;
    files[w.cid] = w.file;
    metrics[w.field] = shot.metrics || null;
  }
  return { attachments, cids, files, metrics, capturedAt: man.capturedAt, viewport: man.viewport, liveUrl: rec.liveUrl, currentUrl: rec.currentUrl };
}

/**
 * 1. ONE SHORT PERSONAL LINE. Business and city, then the single fact that
 *    matters. Not a paragraph — a paragraph here is 90px of fold spent on
 *    throat-clearing.
 */
function foldOpener({ business, city, state, accent }) {
  return `<tr><td style="padding:13px 28px 9px" class="pad">
    <div style="font:700 18px/1.25 sans-serif;color:#14140f">
      ${esc(business)} — ${esc(city)}${state ? `, ${esc(state)}` : ""}
    </div>
    <div style="font:400 13px/1.45 sans-serif;color:#5a5a52;margin-top:4px">
      I built you a new website — it's live. Here it is next to yours.
    </div>
  </td></tr>`;
}

/**
 * 2. THE VISUAL, IMMEDIATELY. Their site today and the new one, side by side on
 *    a phone, both linked.
 *
 * FAIRNESS. Both shots come from the identical capture path at the identical
 * 390x620 viewport (see capture-strip-shots.cjs). They render at the same
 * percentage width, same aspect, same border, same corner radius, and neither is
 * cropped or scrolled relative to the other.
 *
 * THE CONSENT-OVERLAY DISCLOSURE. Their site shows a cookie notice to a
 * first-time visitor, and it covers a measured share of their shot. Shortening
 * the capture to fit the fold RAISED that share (32% at 844px tall, 43% at
 * 620px) while ours has no overlay at all — an advantage created by our own
 * framing choice, not by their design. So when the measured coverage is
 * material we say so in plain words underneath. The alternative — quietly
 * shipping a "before" that is half cookie banner — is winning an argument with
 * a photograph we composed.
 */
function foldVisual({ business, url, currentUrl, cids, accent, metrics }) {
  if (!cids.currentMobile || !cids.mobile) return "";

  const beforeHost = currentUrl ? currentUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  const afterHost = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const overlayPct = (metrics && metrics.currentMobile && metrics.currentMobile.consentOverlayPctOfViewport) || 0;

  // NO host caption under each phone. The full new-site URL wrapped to two lines
  // here and cost ~30px of fold to repeat something the button underneath, the
  // image link itself, and the desktop-hero caption below all already carry.
  const phone = (label, cid, alt, href, labelColor) => `
    <td width="49%" valign="top" style="width:49%;padding:0">
      <!-- FIXED-HEIGHT LABEL. The "before" label carries their domain and wraps
           to two lines while "after" does not; without a fixed box the two
           phones start 12px apart, which is both ugly and a break of the
           same-size-same-position rule the comparison depends on. -->
      <div style="font:700 9px/1.3 sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${labelColor};margin-bottom:5px;height:24px;overflow:hidden">${esc(label)}</div>
      <a href="${esc(href)}" style="display:block;text-decoration:none">
        <img src="cid:${cid}" width="148" height="235" alt="${esc(alt)}"
             style="display:block;width:100%;max-width:148px;height:auto;border-radius:10px;border:1px solid #dededa;background:#fff" />
      </a>
    </td>`;

  return `<tr><td style="padding:0 28px 8px" class="pad">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed">
      <tr>
        ${phone(`Your site today · ${beforeHost}`, cids.currentMobile, `Screenshot of the current ${business} website at ${beforeHost} as it renders on a phone`, currentUrl || url, "#9a9a92")}
        <td width="2%" style="width:2%">&nbsp;</td>
        ${phone("The one I built you", cids.mobile, `Screenshot of the new ${business} website at ${afterHost} as it renders on a phone — tap to open the live site`, url, accent)}
      </tr>
    </table>
    <div style="font:400 9px/1.4 sans-serif;color:#a8a8a0;margin-top:5px">
      Same screen size, same moment, neither one cropped.${overlayPct >= 15 ? ` Yours includes the cookie notice a first-time visitor sees — about ${overlayPct}% of the shot.` : ""}
    </div>
  </td></tr>`;
}

/** The "look at it" button. Distinct from the closing commitment CTA. */
function foldCta({ url, accent }) {
  return `<tr><td style="padding:8px 28px 0" class="pad">
    <a href="${esc(url)}" style="display:block;text-align:center;background:${accent};color:#fff;font:700 15px/1 sans-serif;text-decoration:none;padding:15px;border-radius:9px">
      See your live site →
    </a>
  </td></tr>`;
}

/**
 * 4. THE SIGNAL REPORT, GIVEN REAL WEIGHT.
 *
 * A large, obviously-clickable panel that shows what the report actually
 * contains, sourced from signal-report-contents.json — which is written by
 * verify-signal-report.cjs reading the LIVE page, not from the row that was
 * saved when the report was created. Those two disagree: the saved row holds one
 * competitor, the page renders eight.
 *
 * WHAT IT WILL AND WON'T SAY:
 *  · it names the rivals it can actually see rendered, and counts them
 *  · it does NOT repeat the page's own "of 9 businesses" headline, which does
 *    not match the 8 rows underneath it
 *  · if the report has expired it says so and does NOT link it. A dead gift is
 *    worse than no gift.
 */
function signalPanel({ business, accent, contents, rating, reviewCount }) {
  if (!contents || contents.renderVerified !== true) return "";

  const stale = contents.stale === true || (typeof contents.daysLeft === "number" && contents.daysLeft < 1);
  const rivals = Array.isArray(contents.rivalsNamed) ? contents.rivalsNamed : [];
  const you = contents.clientRow;

  // Expired: say it plainly, offer the refresh, link nothing.
  if (stale) {
    return `<tr><td style="padding:16px 28px 4px" class="pad">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6;border:1px solid #e2e0d8;border-radius:13px">
        <tr><td style="padding:18px 20px">
          <div style="font:700 10px/1 sans-serif;letter-spacing:.13em;text-transform:uppercase;color:#8a8a80">Your Signal report</div>
          <div style="font:700 16px/1.35 sans-serif;color:#14140f;margin-top:8px">Your report has expired — reply and I'll run a fresh one</div>
          <div style="font:400 12px/1.55 sans-serif;color:#6a6a60;margin-top:7px">
            Signal links stay live for 7 days. Rather than send you a dead link, I'll re-run it —
            just reply <strong>REPORT</strong> and it's yours, free, no signup.
          </div>
        </td></tr>
      </table>
    </td></tr>`;
  }

  const rivalNames = rivals.map((r) => r.name).join(" · ");
  const days = contents.daysLeft;

  // The report renders the top three ranks as medal glyphs. Passing that through
  // verbatim reads as "Ranks you 🥇 against 7 local roofers" — a picture where a
  // word belongs. The artifact keeps the raw glyph; only the sentence is
  // normalised, and an unrecognised rank falls through unchanged.
  const MEDAL = { "🥇": "#1", "🥈": "#2", "🥉": "#3" };
  const rankLabel = you ? MEDAL[you.rank] || you.rank : null;

  return `<tr><td style="padding:8px 28px 2px" class="pad">
    <a href="${esc(contents.report_url)}" style="display:block;text-decoration:none;color:inherit">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#14140f;border-radius:12px">
      <tr><td style="padding:14px 16px 12px">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="62" valign="top" style="width:62px">
              <table role="presentation" cellpadding="0" cellspacing="0" width="54" style="background:${accent};border-radius:9px">
                <tr><td align="center" style="padding:7px 0 8px">
                  <div style="font:800 22px/1 sans-serif;color:#fff">${esc(contents.grade)}</div>
                  <div style="font:600 9px/1 sans-serif;color:#fff;margin-top:3px">${esc(contents.score)}/100</div>
                </td></tr>
              </table>
            </td>
            <td valign="top">
              <div style="font:700 10px/1.2 sans-serif;letter-spacing:.11em;text-transform:uppercase;color:${accent}">✦ Free gift #2 — no signup</div>
              <div style="font:700 16px/1.25 sans-serif;color:#fff;margin-top:4px">Your Signal report is ready</div>
              <div style="font:400 11px/1.4 sans-serif;color:#b9b9b2;margin-top:3px">
                How ${esc(business)} shows up online${rating != null ? ` — your ${esc(rating)}★ from ${esc(reviewCount)} reviews` : ""}.
              </div>
            </td>
          </tr>
        </table>

        ${rivals.length ? `<div style="font:400 11px/1.45 sans-serif;color:#a8a8a0;margin-top:10px;padding:9px 10px;background:#1f1f1a;border-radius:7px">
          <strong style="color:#fff">Ranks you${rankLabel ? ` ${esc(rankLabel)}` : ""} against ${esc(rivals.length)} local roofers, by name:</strong>
          ${esc(rivalNames)}
        </div>` : ""}

        <div style="display:block;text-align:center;background:${accent};color:#fff;font:700 15px/1 sans-serif;padding:14px;border-radius:8px;margin-top:11px">
          Open your Signal report →
        </div>

        <div style="font:400 9px/1.4 sans-serif;color:#8a8a82;margin-top:6px;text-align:center">
          Free, no card${typeof days === "number" ? ` · live for ${esc(days)} more day${days === 1 ? "" : "s"}` : ""}. Speed, SEO and social read <em>pending</em>, not zero — that scan hasn't run yet.
        </div>

      </td></tr>
    </table>
    </a>
  </td></tr>`;
}

module.exports = { loadStripShots, foldOpener, foldVisual, foldCta, signalPanel, SHOT_DIR };
