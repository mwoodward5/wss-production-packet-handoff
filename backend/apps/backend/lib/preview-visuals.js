"use strict";

// In-house preview visuals (owner directive 2026-07-24): email proof images must
// come from OUR infrastructure, never s0.wp.com/mshots — Gmail doesn't auto-load
// third-party remote images, and the hero image carries the whole "we built
// your site" proof. Playwright is an OPTIONAL dev/heavy dependency: it is
// required lazily inside the capture path, so serverless cold starts never pay
// for it and every failure mode degrades gracefully (never a 500 at send time).

const { createHmac } = require("node:crypto");
// The one writer of the "take our panels off the page" flag. proof-storage has
// no dependencies of its own beyond node:crypto, so this costs a cold start
// nothing — and it is the difference between photographing the client's site
// and photographing our sign-up card sitting on top of it.
const { suppressOurPanelsUrl } = require("./proof-storage");

const VISUAL_SECRET = () =>
  String(process.env.GHOST_AGENCY_VISUAL_SECRET || process.env.EMAIL_UNSUB_SECRET || "").trim();

// ---------- URL signing (same pattern family as reveal-links) ----------

function signVisualKey(key) {
  const secret = VISUAL_SECRET();
  if (!secret) return "";
  return createHmac("sha256", secret).update(String(key)).digest("base64url").slice(0, 24);
}

// THE KEY IS A URL CARRIER, NOT A DIGEST. api/media/preview-shot decodes these
// base64url segments back into the URL and derives the storage path from the
// RESULT — so a truncated segment does not degrade the key, it silently
// addresses a DIFFERENT PAGE. The cap used to be 96 base64 characters, which is
// exactly 72 bytes of URL; longer URLs decoded to a prefix
// ("https://siteforge-app-seven.vercel.app/try/canyon-roofing-llc-swappehf2-y/"
// came back as "…swappehf2-"), hashed to an object nobody ever wrote, and
// served the 42-byte spacer forever behind a healthy HTTP 200. Measured on the
// live store: 21 rows in that state.
//
// 512 characters is 384 bytes of URL — far past any real preview host — and
// overflow now REFUSES the key instead of corrupting it, so the caller renders
// an honest "no screenshot" rather than an image that can never resolve. The
// cap is a no-op for every URL at or under 72 bytes, so every key and signature
// already in a sent email is byte-for-byte unchanged.
const MAX_URL_SEGMENT = 512;

function encodeUrlSegment(value) {
  const encoded = Buffer.from(String(value)).toString("base64url");
  return encoded.length > MAX_URL_SEGMENT ? null : encoded;
}

function visualCacheKey({ kind = "new", previewUrl = "", currentWebsite = "", nonce = "" } = {}) {
  const preview = encodeUrlSegment(previewUrl);
  const current = encodeUrlSegment(currentWebsite);
  if (preview === null || current === null) return "";
  return [
    String(kind).slice(0, 8),
    preview,
    current,
    String(nonce).slice(0, 24),
  ].join(".");
}

// Mirrors the line-email-assets gate: accepts both shared-release UUIDs and
// real Vercel identifiers (dpl_... / project ids) used by mirror-built rows.
const SHARED_ID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const SHARED_BUILD_HASH_RE = /^[0-9a-f]{64}$/;

function normalizeVisualProofIdentity(proofIdentity) {
  if (proofIdentity === undefined || proofIdentity === null) {
    return { active: false, valid: true };
  }
  if (!proofIdentity || typeof proofIdentity !== "object" || Array.isArray(proofIdentity)) {
    return { active: true, valid: false, reason: "shared_proof_identity_malformed" };
  }
  const siteId = proofIdentity.site_id;
  const releaseId = proofIdentity.release_id;
  const buildHash = proofIdentity.build_hash;
  if (typeof siteId !== "string" || typeof releaseId !== "string" || typeof buildHash !== "string") {
    return { active: true, valid: false, reason: "shared_proof_identity_incomplete" };
  }
  if (!SHARED_ID_RE.test(siteId) || !SHARED_ID_RE.test(releaseId) || !SHARED_BUILD_HASH_RE.test(buildHash)) {
    return { active: true, valid: false, reason: "shared_proof_identity_malformed" };
  }
  return {
    active: true,
    valid: true,
    site_id: siteId,
    release_id: releaseId,
    build_hash: buildHash,
  };
}

function visualProofSignatureInput({ key = "", si = "", ri = "", bh = "" } = {}) {
  return JSON.stringify([String(key), "wss-proof-identity-v1", String(si), String(ri), String(bh)]);
}

function encodeProofIdentity(proofIdentity) {
  const normalized = normalizeVisualProofIdentity(proofIdentity);
  if (!normalized.active || !normalized.valid) return normalized;
  return {
    ...normalized,
    si: Buffer.from(normalized.site_id, "utf8").toString("base64url"),
    ri: Buffer.from(normalized.release_id, "utf8").toString("base64url"),
    bh: Buffer.from(normalized.build_hash, "utf8").toString("base64url"),
  };
}

function decodeProofField(value, maxBytes) {
  if (typeof value !== "string" || !value || value.length > maxBytes * 2 || !/^[A-Za-z0-9_-]+$/.test(value)) return "";
  try {
    const decoded = Buffer.from(value, "base64url");
    if (!decoded.length || decoded.length > maxBytes || decoded.toString("base64url") !== value) return "";
    return decoded.toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Verify the legacy visual signature or the complete immutable shared-release
 * tuple carried beside it. The tuple is signed as one canonical payload, so a
 * caller cannot switch a site, release, or build hash while keeping the URL.
 */
function verifySignedVisualRequest({ k = "", s = "", si, ri, bh } = {}) {
  const identityParts = [si, ri, bh];
  const identitySupplied = identityParts.some((value) => value !== undefined && value !== null);
  if (!identitySupplied) {
    return verifyVisualSignature(k, s)
      ? { ok: true, legacy: true, proofIdentity: null }
      : { ok: false, reason: "bad_signature" };
  }
  if (identityParts.some((value) => typeof value !== "string" || !value)) {
    return { ok: false, reason: "shared_proof_identity_incomplete" };
  }
  const proofIdentity = {
    site_id: decodeProofField(si, 36),
    release_id: decodeProofField(ri, 36),
    build_hash: decodeProofField(bh, 64),
  };
  const normalized = normalizeVisualProofIdentity(proofIdentity);
  if (!normalized.valid) return { ok: false, reason: normalized.reason };
  const signatureInput = visualProofSignatureInput({ key: k, si, ri, bh });
  if (!verifyVisualSignature(signatureInput, s)) return { ok: false, reason: "bad_signature" };
  return { ok: true, legacy: false, proofIdentity: normalized };
}

function signedVisualPath({ kind, previewUrl, currentWebsite, nonce, proofIdentity } = {}) {
  const key = visualCacheKey({ kind, previewUrl, currentWebsite, nonce });
  // No representable key means no honest URL to hand out. Returning a path
  // built on an empty key would only mint a link that always 403s.
  if (!key) return "";
  const encodedIdentity = encodeProofIdentity(proofIdentity);
  if (encodedIdentity.active && !encodedIdentity.valid) return "";
  const signatureInput = encodedIdentity.active
    ? visualProofSignatureInput({ key, si: encodedIdentity.si, ri: encodedIdentity.ri, bh: encodedIdentity.bh })
    : key;
  const sig = signVisualKey(signatureInput);
  if (!sig) return "";
  // `kind` is baked into the signed key, but the ROUTE selects which screenshot
  // to serve from the `v` parameter alone (defaulting to "new"). Without this,
  // the before and after images resolve to the same picture — a before/after
  // comparison showing the new site twice.
  //
  // The "-mobile" pair is proof-storage's own append-only variant list: the
  // phone frame is a DIFFERENT PICTURE of the same URL (the reflow is the whole
  // claim), and line-proof-shots has been storing it since 2026-08-08. This
  // list refusing it was the one hop that kept the mobile shot out of email.
  const variant = ["old", "new", "gif", "old-mobile", "new-mobile", "face-0", "face-1"].includes(String(kind)) ? String(kind) : "new";
  const qs = new URLSearchParams({ k: key, s: sig, v: variant });
  if (encodedIdentity.active) {
    qs.set("si", encodedIdentity.si);
    qs.set("ri", encodedIdentity.ri);
    qs.set("bh", encodedIdentity.bh);
  }
  return `/api/media/preview-shot?${qs.toString()}`;
}

function verifyVisualSignature(key, sig) {
  if (!key || !sig) return false;
  const expected = signVisualKey(key);
  if (!expected) return false;
  // Constant-time-ish compare without leaking length timing meaningfully.
  return expected.length === String(sig).length && expected === String(sig);
}

// ---------- Capture (lazy Playwright, optional) ----------

let _playwrightTried = false;
let _playwright = null;

function loadPlaywright() {
  if (_playwrightTried) return _playwright;
  _playwrightTried = true;
  try {
    // Optional dependency: present in the visual-worker environment, absent in
    // the default serverless deploy. Never crash when missing.
    // eslint-disable-next-line global-require
    _playwright = require("playwright");
  } catch {
    _playwright = null;
  }
  return _playwright;
}

// Navigate and wait for the page to actually be a PAGE.
//
// "domcontentloaded" fires as soon as the HTML parser finishes — which on a
// React mirror is BEFORE the client renders anything. Screenshots taken at that
// moment captured the donor's pre-hydration frame: the generic template shell,
// not the prospect's site. "networkidle" waits for the client render to settle,
// which is the picture the email is actually claiming to show.
//
// Some pages (analytics beacons, polling widgets, live chat) never reach idle.
// That must not cost us the shot: the navigation itself has still happened, so
// on an idle timeout we settle briefly and shoot anyway. A navigation that got
// nowhere at all (bad DNS, refused) still throws, as it should.
async function gotoSettled(page, url, { timeout = 30000 } = {}) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout });
  } catch (err) {
    const landed = String(page.url() || "");
    if (!landed || landed === "about:blank") throw err;
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  }
}

/**
 * Hide cookie/consent banners and their dimming backdrops IN OUR SCREENSHOT.
 *
 * WHY THIS IS NOT "ACCEPTING COOKIES": it clicks nothing. No Allow, no Deny, no
 * Customize. No consent cookie is written, no consent signal is transmitted, no
 * state is created on the prospect's site. It is a local `display:none` in a
 * throwaway browser context — the same thing that happens visually when a real
 * visitor dismisses the banner, minus the decision. We are not entitled to make
 * a privacy choice on a stranger's site, and we do not make one.
 *
 * WHY IT IS NEEDED: Flint Plumbing's BeTheme #mfn-consent-mode banner is server-
 * rendered into the HTML, so it cannot be blocked at the network layer, and it
 * ships with a full-viewport dimmer. The "YOUR SITE TODAY" frame was 60% cookie
 * modal over a greyed-out page — a picture of a dialog, not of their website.
 *
 * DELIBERATELY NARROW. Only OUR "before" shots of a third-party site get this;
 * our own built mirror is always photographed exactly as it ships. An element is
 * removed only if it BOTH names itself consent-ish AND is a floating, high
 * z-index layer — so a footer "Cookie Policy" link, which matches the keyword
 * but is neither floating nor stacked, is left alone.
 */
async function suppressConsentOverlays(page) {
  return page.evaluate(() => {
    const KEYWORD = /(cookie|consent|gdpr|ccpa|privacy-(banner|popup|notice))/i;
    const hidden = [];
    const floating = (cs) => ["fixed", "sticky", "absolute"].includes(cs.position);
    const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.classList.length ? `.${[...el.classList].slice(0, 2).join(".")}` : ""}`;

    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (!floating(cs)) continue;
      if ((Number(cs.zIndex) || 0) < 1000) continue;
      const idcls = `${el.id} ${el.className}`;
      const r = el.getBoundingClientRect();

      // (a) the banner itself: names itself consent-ish and floats above the page
      if (KEYWORD.test(idcls) && r.width > 120 && r.height > 60) {
        el.style.setProperty("display", "none", "important");
        hidden.push(label(el));
        continue;
      }
      // (b) the dimmer that came with it: a full-viewport, TEXT-FREE tinted sheet.
      //     Requiring "no text" is what stops this from blanking a real hero.
      const coversViewport = r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
      const tinted = cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
      if (coversViewport && tinted && !el.innerText.trim() && cs.display !== "none" && Number(cs.opacity) > 0) {
        el.style.setProperty("display", "none", "important");
        hidden.push(label(el));
      }
    }

    // Banners routinely lock the page; unlock so the shot is the real layout.
    for (const el of [document.documentElement, document.body]) {
      el.style.setProperty("overflow", "visible", "important");
      el.style.setProperty("position", "static", "important");
    }
    return hidden;
  }).catch(() => []);
}

// NOT fullPage. This returns exactly one WHOLE viewport frame at the requested
// size — the complete 1200x900 (or 375x812) picture, never a slice of it. The
// email must display it at its natural aspect ratio; clipping it to fit a box
// in the template is what "cropped" means and is what the owner rejected.
//
// `mobile` is not a resize. A responsive site keys off the UA and the device
// pixel ratio as well as the width, so a 375px-wide DESKTOP context can render
// the desktop layout squeezed — which would show the owner a picture of a bug
// that does not exist. isMobile/hasTouch/deviceScaleFactor make it a real phone.
async function captureJpeg(browser, url, { width = 1200, height = 900, timeout = 30000, mobile = false, dismissConsent = false } = {}) {
  const context = await browser.newContext(
    mobile
      ? {
        viewport: { width, height },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            + "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      }
      : { viewport: { width, height } },
  );
  const page = await context.newPage();
  try {
    await gotoSettled(page, url, { timeout });
    await page.waitForTimeout(1200);
    if (dismissConsent) {
      const hidden = await suppressConsentOverlays(page);
      if (hidden.length) {
        captureJpeg.lastSuppressed = hidden;
        await page.waitForTimeout(350); // let the reflow settle before shooting
      }
    }
    // WHERE IT LANDED, not where we aimed. A redirect to a parked page, a
    // resold domain or a franchise portal produces a perfectly valid JPEG of
    // somebody else's website, and the object key — derived from the URL we
    // REQUESTED — cannot tell the difference. Recording the final URL is what
    // lets proof-storage.capturedShotBelongsTo() refuse that picture later.
    captureJpeg.lastFinalUrl = String(page.url() || url);
    return await page.screenshot({ type: "jpeg", quality: 82 });
  } finally {
    await context.close().catch(() => {});
  }
}

// Filmstrip fallback: 3 scrolled frames stacked vertically into ONE jpeg via
// Playwright itself (no ffmpeg dependency). If a real animated GIF encoder is
// configured later, it plugs in behind the same interface.
async function captureFilmstrip(browser, url, { timeout = 30000 } = {}) {
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: 1200, height: 900 });
    await gotoSettled(page, url, { timeout });
    await page.waitForTimeout(1000);
    const frames = [];
    for (let i = 0; i < 3; i++) {
      frames.push(await page.screenshot({ type: "jpeg", quality: 75 }));
      await page.mouse.wheel(0, 500).catch(() => {});
      await page.waitForTimeout(600);
    }
    return frames;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Generate the visual set for a prospect. Always resolves; every failure mode
 * returns { ok:false, reason } instead of throwing so the email path degrades
 * to text-first selling (the template already handles missing visuals).
 *
 * `mobile:true` additionally captures a 375x812 phone frame of each site, so a
 * before/after email can prove the reflow instead of asserting it.
 *
 * @returns {Promise<{ok:boolean, reason?:string, oldJpeg?:Buffer, newJpeg?:Buffer, oldMobileJpeg?:Buffer, newMobileJpeg?:Buffer, gifFrames?:Buffer[]}>}
 */
async function generatePreviewVisuals({ currentWebsite = "", previewUrl = "", mobile = false, playwright = null } = {}) {
  if (!/^https:\/\//i.test(previewUrl)) return { ok: false, reason: "preview_url_missing" };
  // `playwright` is injectable for ONE reason: so a test can assert WHICH URL
  // this function actually navigates to. That mattered on 2026-08-10, when it
  // turned out this path — the capture half behind
  // scripts/capture-proof-shots.js — photographed our mirror with no panel
  // suppression at all, and nothing anywhere could have caught it.
  const pw = playwright || loadPlaywright();
  if (!pw) return { ok: false, reason: "playwright_unavailable" };

  const PHONE = { width: 375, height: 812, mobile: true };

  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true });
    const out = { ok: true };
    // dismissConsent applies to the PROSPECT'S site only. Our own build is
    // photographed exactly as it ships — if it ever grew an overlay, the owner
    // needs to see that, not a cleaned-up version of it.
    if (/^https:\/\//i.test(currentWebsite)) {
      captureJpeg.lastFinalUrl = "";
      out.oldJpeg = await captureJpeg(browser, currentWebsite, { dismissConsent: true }).catch(() => undefined);
      // The identity record for the "before" shot. Carried out of here so the
      // uploader can store it beside the image and the email can be refused
      // when it turns out to be a picture of a stranger's site.
      out.oldFinalUrl = out.oldJpeg ? String(captureJpeg.lastFinalUrl || "") : "";
      if (mobile) out.oldMobileJpeg = await captureJpeg(browser, currentWebsite, { ...PHONE, dismissConsent: true }).catch(() => undefined);
      out.suppressedOverlays = captureJpeg.lastSuppressed || [];
    }
    // OUR mirror, so our own panels come off first. The sign-up card opens by
    // default on a desktop now (mirror-engine/signup-floater.js), and this
    // capture runs at 1200x900 — without the flag every "your new site" image
    // this script uploads would be a picture of the client's ID card and our
    // price, mailed to the prospect as a picture of their business.
    const ourShotUrl = suppressOurPanelsUrl(previewUrl);
    captureJpeg.lastFinalUrl = "";
    out.newJpeg = await captureJpeg(browser, ourShotUrl).catch(() => undefined);
    out.newFinalUrl = out.newJpeg ? String(captureJpeg.lastFinalUrl || "") : "";
    if (mobile) out.newMobileJpeg = await captureJpeg(browser, ourShotUrl, PHONE).catch(() => undefined);
    out.gifFrames = await captureFilmstrip(browser, ourShotUrl).catch(() => undefined);
    if (!out.newJpeg && !out.gifFrames) return { ok: false, reason: "capture_failed" };
    return out;
  } catch (err) {
    return { ok: false, reason: "capture_failed", error: String(err && err.message || err).slice(0, 160) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// 1x1 transparent GIF spacer — the graceful 200-response when capture is
// unavailable (email clients render an invisible pixel; the text-first
// template still carries the sale).
const SPACER_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

module.exports = {
  signVisualKey,
  visualCacheKey,
  signedVisualPath,
  verifyVisualSignature,
  verifySignedVisualRequest,
  normalizeVisualProofIdentity,
  visualProofSignatureInput,
  generatePreviewVisuals,
  loadPlaywright,
  SPACER_GIF,
};
