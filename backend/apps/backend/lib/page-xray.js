"use strict";

// lib/page-xray.js — ONE CAPTURE, THREE LAYERS.
//
// Given a URL, return what a human designer would have in front of them:
// the picture, the structure, and the style. Nothing here judges anything. It
// measures, and every number it reports names the thing it was read off.
//
// =====================================================================
// THE FOUR RECORDED FAILURES THIS EXISTS TO ANSWER
// =====================================================================
// From the owner's own calls, verbatim:
//
//   "I need to know the specific element that represents your logo to make it
//    larger and move it right"
//        -> The caller said "the logo, top left". That is a complete
//           instruction to any human. It failed because nothing in the system
//           could turn a plain-English noun and a position into an element.
//           LAYER 2 + findByName() is that translation, and it answers with
//           EVIDENCE (why each candidate matched) rather than a guess.
//
//   "I can't move whole sections around on the page"
//        -> Sections were never enumerated. There was no list of what is on
//           the page, so there was nothing to move. LAYER 2 is that list:
//           every visible element, its box, its z-order, and a selector that
//           has been PROVEN to resolve back to it.
//
//   "the logo is now stretched and cut off and cropped... the graphic is too
//    big for the box it was given"
//        -> Three distinct, mechanical defects, all invisible to every check
//           the system had: an image whose displayed aspect ratio differs from
//           its natural one is stretched; an image whose box is smaller than
//           its content with overflow hidden is cut off; an element whose rect
//           leaves its parent or the viewport is overhanging. LAYER 3 measures
//           natural vs displayed for every image, so "displayed 2x natural" is
//           a number, not an opinion.
//
//   And measured: the engine reported "landed" for changes with zero visible
//   effect. CSS applied to a selector that matched nothing still reads success.
//        -> So NO SELECTOR LEAVES THIS MODULE UNVERIFIED. Every selector is
//           run back through document.querySelectorAll IN THE PAGE and must
//           return exactly that one element, or it is not emitted at all
//           (selector:null, selector_reason recorded). A selector this module
//           hands out cannot be a selector that matches nothing, because
//           matching exactly one thing is the condition of it being handed out.
//
// =====================================================================
// WHAT IT IS NOT
// =====================================================================
// It is not a gate. It returns no pass/fail and blocks nothing. lib/render-gate
// judges whether a mirror may ship; lib/edit-verify judges whether one edit
// landed. This is the eyes both of them — and Riley, mid-call — look through.
//
// It is not the design brief. lib/design-brief.js (being written in parallel)
// captures a CLIENT'S OWN site to decide what to build. This captures OUR live
// mirror during an edit. Different subject, different consumer, same shapes
// where they overlap: rects are {x,y,w,h} in CSS px, colours are the browser's
// own computed strings with a best-effort sRGB hex beside them, and every
// measurement carries the surface it was read from.
//
// =====================================================================
// WIRING NOTE FOR lib/site-change-plan.js (owned by the riley-flow workflow —
// do not edit it; this is the exact change for whoever does)
// =====================================================================
// 1. THE BROWSER MUST BE PASSED IN, ALWAYS, MID-EDIT.
//    lib/serverless-chromium meters browsers with a semaphore whose default is
//    ONE and whose wait timeout is 300s. runSiteChange already holds a permit
//    from the moment warmBrowser() is created until verifyEditLive closes it.
//    A page-xray that launches its own browser inside that window does not run
//    slowly — it BLOCKS for five minutes and then fails. So:
//
//        const xr = await xray(origin, { browser: await warmBrowser, buildHash });
//
//    Passing a browser is not an optimisation here, it is the contract. When
//    none is passed this module waits `permitWaitMs` (25s) and then returns
//    ok:false with reason "chromium_unavailable" naming this exact fix, rather
//    than hanging past the job's own 240s ceiling.
//
// 2. INVALIDATE AFTER EVERY DEPLOY.
//    Immediately after `deployed = await vercelDeploy(...)`:
//
//        require("./page-xray").invalidate(origin);
//
//    Without a build hash the cache cannot know a deploy happened. It defends
//    itself with a 90s TTL, but 90s of staleness inside an edit is exactly the
//    "verify the delivered artifact" failure this codebase has already paid
//    for twice. One line makes it impossible.
//
// 3. WHERE IT PAYS FOR ITSELF (three places, in order of value):
//    a. buildElementCatalog() currently DETECTS elements by grepping the
//       compiled bundle for strings like /client-logo/ and then offers a
//       hand-written selector. That is why `header a[href="/"]` — a selector
//       matching ZERO elements — reached a live customer's site. Replace the
//       evidence with xray: an entry offered because a RENDERED element was
//       measured at 1280 carries its rect, and its selector has already been
//       proven unique against the live DOM. The catalog's shape does not
//       change; only the warrant behind each entry does.
//    b. A refusal like "Cannot identify logo element" becomes
//       findByName(xr, "the logo top left"), which either returns one candidate
//       with its reasons or returns ambiguous:true with the two it is torn
//       between — and Riley asks which, instead of guessing or refusing.
//    c. After the deploy, defectsOf(xray) answers "is the logo now stretched?"
//       BEFORE the customer has to phone back and say so. edit-verify proves
//       the declaration computed; this proves the result is not broken.
//
// =====================================================================
// COST — measured, not estimated. See scripts/page-xray-live-proof.js.
// =====================================================================
// The numbers that matter are in that script's output and in the final report;
// re-run it against any live mirror to re-measure. The shape of the cost is:
// one navigation dominates, the desktop and mobile pages are navigated in
// PARALLEL so wall-clock is max() not sum(), and a cache hit is a Map lookup.

const { createHash } = require("node:crypto");

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 800;
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;

/** How many visible elements the structure layer returns per viewport. */
const MAX_ELEMENTS = 160;
/** Characters of an element's own text kept for naming and read-back. */
const MAX_TEXT = 110;
/** Per-element crops. Each costs a locator screenshot (~40-120ms). */
const MAX_CROPS = 8;

/**
 * How long to wait for a chromium permit before giving up. lib/serverless-
 * chromium's own wait is 300s, which is longer than any call this runs inside.
 * An honest failure in 25s that names the fix beats a five-minute hang.
 */
const PERMIT_WAIT_MS = 25_000;

/** Cache lifetimes. A build hash is evidence the bytes have not moved. */
const TTL_WITH_BUILD_MS = 15 * 60_000;
const TTL_NO_BUILD_MS = 90_000;
const CACHE_MAX_ENTRIES = 6;

/**
 * Words looked for in id / class / data-* / aria-label. Kept as plain
 * lowercase words rather than regexes so the whole list serialises into the
 * page and the naming rules below stay unit-testable without a browser.
 */
const HINT_WORDS = Object.freeze([
  "logo", "brand", "wordmark", "header", "nav", "navbar", "menu", "hero",
  "banner", "footer", "cta", "btn", "button", "card", "review", "testimonial",
  "rating", "star", "chat", "widget", "form", "contact", "quote", "book",
  "service", "gallery", "map", "phone", "call", "badge", "trust", "faq",
  "floater", "signup", "sticky", "overlay", "modal", "drawer", "slider",
  "carousel", "avatar", "icon", "social",
]);

// ===========================================================================
// PURE HELPERS — no browser, no network. Everything testable lives here.
// ===========================================================================

/** Trailing-slash-insensitive, fragment-free origin+path. Cache keys use it. */
function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return raw.replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function cacheKey(url, buildHash) {
  const hash = String(buildHash || "").trim();
  return `${normalizeUrl(url)}\u0000${hash || "no-build-hash"}`;
}

/**
 * "rgb(255, 102, 0)" -> "#ff6600". "rgba(0,0,0,0)" -> "" with alpha 0.
 *
 * NON-sRGB COMPUTED VALUES RETURN "". Chromium reports a colour authored in
 * oklch as `oklch(0.96 0.032 270.5)` — measured on a live mirror's h1 — and
 * guessing an sRGB approximation for it would put a number in front of an
 * owner that no pixel on the page is. The raw computed string always travels
 * beside the hex and is the authority; the hex is a convenience that is either
 * exactly right or absent.
 */
function toHex(cssColor) {
  const text = String(cssColor || "").trim();
  if (!text) return { hex: "", alpha: null, raw: text };
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hexMatch) {
    let h = hexMatch[1].toLowerCase();
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const alpha = h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 1000) / 1000 : 1;
    return { hex: `#${h.slice(0, 6)}`, alpha, raw: text };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(text);
  if (rgb) {
    const to255 = (v) => Math.max(0, Math.min(255, Math.round(Number(v))));
    const a = rgb[4] === undefined ? 1
      : String(rgb[4]).endsWith("%") ? Number(String(rgb[4]).slice(0, -1)) / 100
        : Number(rgb[4]);
    const hex = `#${[rgb[1], rgb[2], rgb[3]].map((v) => to255(v).toString(16).padStart(2, "0")).join("")}`;
    return { hex, alpha: Number.isFinite(a) ? a : 1, raw: text };
  }
  if (/^transparent$/i.test(text)) return { hex: "", alpha: 0, raw: text };
  // oklch(), color(), lab(), a named colour Chromium did not resolve — honest "".
  return { hex: "", alpha: null, raw: text };
}

/** WCAG relative luminance of an #rrggbb. */
function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Contrast ratio, or null when either colour is not sRGB-parseable. */
function contrastRatio(fgHex, bgHex) {
  const a = luminance(fgHex);
  const b = luminance(bgHex);
  if (a === null || b === null) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * Where a customer would say a box IS. Thirds of the FIRST SCREEN, because
 * "top left" is a statement about what they saw when the page opened.
 * Anything below the fold gets a distance instead of a corner, because
 * "bottom right" said about something 4,000px down means nothing.
 */
function zoneOf(rect, viewport) {
  const vw = Math.max(1, Number(viewport && viewport.width) || DESKTOP_WIDTH);
  const vh = Math.max(1, Number(viewport && viewport.height) || DESKTOP_HEIGHT);
  const cx = Number(rect.x) + Number(rect.w) / 2;
  const cy = Number(rect.y) + Number(rect.h) / 2;
  const col = cx < vw / 3 ? "left" : cx > (vw * 2) / 3 ? "right" : "centre";
  if (cy > vh) {
    const screens = Math.max(1, Math.round(cy / vh));
    return screens <= 1 ? `just below the fold, ${col}` : `${screens} screens down, ${col}`;
  }
  const row = cy < vh / 3 ? "top" : cy > (vh * 2) / 3 ? "bottom" : "middle";
  return `${row} ${col}`;
}

/** Implicit ARIA role for the tags that carry one. "" when there is none. */
const IMPLICIT_ROLE = Object.freeze({
  a: "link", button: "button", img: "img", nav: "navigation", header: "banner",
  footer: "contentinfo", main: "main", form: "form", section: "region",
  aside: "complementary", h1: "heading", h2: "heading", h3: "heading",
  h4: "heading", h5: "heading", h6: "heading", ul: "list", ol: "list",
  li: "listitem", table: "table", input: "textbox", textarea: "textbox",
  select: "combobox", video: "video", iframe: "frame", svg: "graphic",
  p: "paragraph", label: "label",
});

function roleOf(raw) {
  const explicit = String((raw && raw.role) || "").trim().toLowerCase();
  if (explicit) return explicit;
  const tag = String((raw && raw.tag) || "").toLowerCase();
  if (tag === "a" && !raw.href) return "";
  return IMPLICIT_ROLE[tag] || "";
}

/**
 * classifyName(raw) -> { name, nameable, synonyms, cropPriority }
 *
 * The plain-English noun a customer would use. Deliberately conservative: an
 * element that is not confidently one of these gets name:"" and is still
 * returned in the tree, just not offered as something to address by name.
 * Guessing a name is how "the logo" ends up meaning a stock photo.
 *
 * PURE, and driven only by the compact signals the page emits — tag, role,
 * href, src, alt, the matched hint words, and geometry. So every rule below is
 * unit-testable with a literal object and no browser.
 */
function classifyName(raw) {
  const tag = String(raw.tag || "").toLowerCase();
  const hints = new Set((raw.hints || []).map((h) => String(h).toLowerCase()));
  const src = String(raw.src || "").toLowerCase();
  const alt = String(raw.alt || "").toLowerCase();
  const href = String(raw.href || "").toLowerCase();
  const text = String(raw.text || "").trim();
  const rect = raw.rect || { x: 0, y: 0, w: 0, h: 0 };
  const vw = Math.max(1, Number(raw.viewportWidth) || DESKTOP_WIDTH);
  const vh = Math.max(1, Number(raw.viewportHeight) || DESKTOP_HEIGHT);

  const name = (n, priority, ...synonyms) => ({ name: n, nameable: true, synonyms, cropPriority: priority });

  // THE LOGO. Named first and by three independent signals, because it is the
  // single most-asked-about element on any of these pages and the one the
  // system has already failed to identify on a live call. Our own engine
  // always serves the mark at /assets/client-logo.* — see mirror-engine's
  // logoPath — so the src test is a fact about our build, not a heuristic.
  if (tag === "img" || tag === "svg") {
    const looksLogo = /client-logo|brand-logo|logo|wordmark/.test(src)
      || /\blogo\b/.test(alt)
      || hints.has("logo") || hints.has("wordmark");
    if (looksLogo) {
      return name(raw.inHeader ? "logo" : "logo image", 1, "brand", "mark", "wordmark", "brand mark", "company logo");
    }
  }
  if (tag === "img") {
    if (hints.has("avatar") || /avatar|headshot|reviewer/.test(`${src} ${alt}`)) {
      return name("reviewer photo", 6, "avatar", "headshot", "profile picture");
    }
    if (hints.has("icon") || (rect.w <= 48 && rect.h <= 48)) {
      return { name: "icon", nameable: false, synonyms: ["symbol"], cropPriority: 99 };
    }
    return name("photo", 5, "picture", "image", "photograph");
  }
  if (tag === "video") return name("background video", 4, "hero video", "video", "clip");

  // LANDMARKS. A customer says "the top bar" and "the bottom of the page".
  //
  // THE HINT BRANCH IS RESTRICTED TO CONTAINERS, and that restriction is not
  // cosmetic. Measured on the live O'Brien roofing mirror: the header's call
  // button is `<a class="header-cta" href="tel:5205550142">`, its class carries
  // the word "header", and an anchor counts as landmark-ish — so it was named
  // "header" and the page reported TWO of them. A caller saying "the top bar"
  // would have been handed a phone link. A landmark is a box that contains
  // things; an <a> is a thing.
  const CONTAINER = tag === "div" || tag === "section" || tag === "aside";
  if (tag === "header" || raw.role === "banner" || (hints.has("header") && CONTAINER && raw.isLandmarkish)) {
    return name("header", 2, "top bar", "nav bar", "the top of the page", "menu bar");
  }
  if (tag === "footer" || raw.role === "contentinfo") {
    return name("footer", 7, "the bottom", "bottom of the page");
  }
  if (tag === "nav" || raw.role === "navigation") {
    return name("navigation menu", 6, "nav", "menu", "links at the top");
  }
  if (tag === "form") return name("form", 6, "contact form", "quote form", "enquiry form");

  // THE HERO. A full-bleed first section. Recognised by geometry rather than
  // by class, because donors disagree about what they call it and every one of
  // them agrees about where it is and how big it is.
  //
  // THE UPPER BOUND IS LOAD-BEARING. Without it the page's own root wrapper —
  // 1280x13149 on the live Rimrock mirror, i.e. the entire document — matched
  // "starts at the top and is at least half a screen tall" and was offered to a
  // caller as "the hero". Naming the whole page after one of its parts is
  // exactly the wrong-element failure this module exists to prevent, and it also
  // cost a 1.2MB crop of the full page. A hero is about one screen; nothing
  // taller than two is one.
  const fullBleed = rect.w >= vw * 0.9
    && rect.h >= vh * 0.55 && rect.h <= vh * 1.8
    && rect.y <= vh * 0.35;
  if ((tag === "section" || tag === "div") && fullBleed && (raw.id === "top" || hints.has("hero") || raw.index <= 24)) {
    return name("hero", 3, "hero section", "the big image at the top", "top section", "banner");
  }
  if (tag === "section" || raw.role === "region") {
    return { name: "section", nameable: true, synonyms: ["block", "part of the page"], cropPriority: 8 };
  }

  // WORDS. h1 is THE headline; edit-verify's whole existence is a monument to
  // the difference between the headline and the box around it.
  if (tag === "h1") return name("main headline", 3, "headline", "the big text", "title", "heading");
  if (tag === "h2") return name("section heading", 8, "heading", "subheading");
  if (tag === "h3") return name("sub-heading", 9, "heading", "card title", "service name");
  if (/^h[456]$/.test(tag)) return { name: "small heading", nameable: true, synonyms: ["heading"], cropPriority: 10 };

  // CALLS TO ACTION.
  if (href.startsWith("tel:")) {
    return name(raw.inHeader ? "call button" : "phone number", 2, "phone", "phone number", "call us", "the number", "call button");
  }
  if (href.startsWith("mailto:")) return name("email link", 9, "email", "email address");
  if (tag === "button" || raw.role === "button" || (tag === "a" && (hints.has("btn") || hints.has("button") || hints.has("cta")))) {
    return { name: text ? `button "${text.slice(0, 32)}"` : "button", nameable: true, synonyms: ["cta", "the button"], cropPriority: 6 };
  }
  if (tag === "a" && text) {
    return { name: `link "${text.slice(0, 32)}"`, nameable: true, synonyms: ["link"], cropPriority: 12 };
  }

  if (tag === "input" || tag === "textarea" || tag === "select") {
    return { name: `${raw.label || raw.placeholder || "input"} field`, nameable: true, synonyms: ["box", "field"], cropPriority: 10 };
  }
  if (tag === "iframe") {
    return /map|maps\.google|apple/.test(src) ? name("map", 7, "the map", "google map") : { name: "embed", nameable: false, synonyms: [], cropPriority: 99 };
  }
  if (hints.has("chat") || hints.has("widget")) return name("chat widget", 8, "chat", "chat bubble", "the little chat thing");
  if (hints.has("floater") || hints.has("signup")) return name("sign-up panel", 8, "floater", "the panel", "the popup");
  if (hints.has("review") || hints.has("testimonial")) return { name: "review", nameable: true, synonyms: ["testimonial", "rating"], cropPriority: 9 };
  if (tag === "p" && text) return { name: "paragraph", nameable: true, synonyms: ["text", "words", "copy"], cropPriority: 14 };

  return { name: "", nameable: false, synonyms: [], cropPriority: 99 };
}

// ---------------------------------------------------------------------------
// IMAGE GEOMETRY — the stretched / cut off / cropped complaint, as numbers
// ---------------------------------------------------------------------------
/**
 * measureImage(raw) -> null | {natural, displayed, fit, distortion, verdicts[]}
 *
 * THE RULE THAT DECIDES "STRETCHED". An <img> has ONE degree of freedom if it
 * is to stay itself. Pinning both axes distorts it — unless object-fit is
 * contain/cover/scale-down, in which case the browser preserves the picture's
 * own ratio inside the box and the box's ratio proves nothing about the
 * picture. So `fill` (the CSS default) and `none` are the cases where a box
 * ratio different from the natural ratio IS distortion, and they are the only
 * cases reported as such.
 *
 * `cover` gets its own verdict — cropped, with the fraction of the picture the
 * box is hiding — because "cut off and cropped" was a separate complaint from
 * "stretched" on the same call, and they have separate causes and fixes.
 */
function measureImage(raw) {
  const nw = Number(raw.naturalWidth) || 0;
  const nh = Number(raw.naturalHeight) || 0;
  const dw = Number(raw.rect && raw.rect.w) || 0;
  const dh = Number(raw.rect && raw.rect.h) || 0;
  if (!dw || !dh) return null;
  const fit = String(raw.objectFit || "fill").toLowerCase();
  const out = {
    natural: nw && nh ? { w: nw, h: nh } : null,
    displayed: { w: Math.round(dw), h: Math.round(dh) },
    fit,
    scale: nw ? Math.round((dw / nw) * 100) / 100 : null,
    distortion: null,
    hidden_fraction: null,
    verdicts: [],
  };
  // SVG and CSS-sized vectors report naturalWidth 0 or a viewBox size that is
  // not a pixel promise. No natural size is no measurement, never a verdict.
  if (!nw || !nh) {
    out.verdicts.push({ kind: "no_natural_size", detail: `${raw.tag || "img"} reports no intrinsic size (vector or not yet decoded) — aspect cannot be judged` });
    return out;
  }
  const naturalAspect = nw / nh;
  const displayedAspect = dw / dh;
  const ratio = displayedAspect / naturalAspect;
  out.distortion = Math.round(ratio * 1000) / 1000;

  const PRESERVES = new Set(["contain", "cover", "scale-down"]);
  if (!PRESERVES.has(fit) && (ratio > 1.05 || ratio < 1 / 1.05)) {
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    out.verdicts.push({
      kind: "stretched",
      detail: `displayed ${Math.round(dw)}x${Math.round(dh)} against a natural ${nw}x${nh} with object-fit:${fit} — ${ratio > 1 ? "widened" : "squashed"} by ${pct}%`,
    });
  }
  if (fit === "cover" && (ratio > 1.02 || ratio < 1 / 1.02)) {
    // The box shows a window onto the picture; the rest is cropped away.
    const shown = ratio > 1 ? 1 / ratio : ratio;
    out.hidden_fraction = Math.round((1 - shown) * 100) / 100;
    out.verdicts.push({
      kind: "cropped",
      detail: `object-fit:cover in a ${Math.round(dw)}x${Math.round(dh)} box hides about ${Math.round((1 - shown) * 100)}% of a ${nw}x${nh} picture`,
    });
  }
  if (dw > nw * 1.5 && nw > 0) {
    out.verdicts.push({
      kind: "upscaled",
      detail: `drawn at ${Math.round(dw)}px wide from ${nw}px of pixels (${Math.round((dw / nw) * 10) / 10}x) — it will look soft`,
    });
  }
  return out;
}

/**
 * defectsOf(view) -> flat list of measured, mechanical defects.
 *
 * EVERY ENTRY CARRIES ITS MEASUREMENT. That is the whole difference between
 * this and a verifier that says "looks right": a defect here is a pair of
 * numbers and the element they were read off, so a reader can disagree with
 * the threshold without having to re-run anything.
 */
function defectsOf(view) {
  const out = [];
  const at = String((view && view.label) || "");
  for (const el of (view && view.elements) || []) {
    for (const v of (el.image && el.image.verdicts) || []) {
      if (v.kind === "no_natural_size") continue; // an absence, not a defect
      out.push({ kind: v.kind, at, name: el.name || el.tag, selector: el.selector, detail: v.detail });
    }
    const o = el.overflow || {};
    // OVERHANG AND CLIPPING ARE REPORTED ONLY ABOUT THINGS A CUSTOMER CAN NAME.
    //
    // Measured on the live Rimrock mirror: reporting them about every element
    // produced 31 "overhangs_viewport" entries at 390, of which ZERO were
    // defects — they were the header ticker's marquee spans, which are supposed
    // to sit 3,298px to the right of a 390px screen inside a clipping track,
    // and the anonymous <div> that is the track. A list where the real finding
    // (the sign-up panel covering the client's logo) is one line in thirty-two
    // is a list nobody reads, and a verifier nobody reads is the same defect as
    // a verifier that lies.
    //
    // The geometry is already correct — el.overflow is measured on the CLIPPED
    // rect, so a marquee span that is scrolled out of its track does not report
    // as overhanging the page at all. This is the second filter: the recorded
    // complaints are all about named things ("the logo is cut off", "the box
    // it's sitting in is too small"), so an unnamed structural div overhanging
    // its own scroller is noise by construction. Both numbers stay on the
    // element for anyone who wants them.
    // Keyed on HAVING A NAME, not on being addressable: an element clipped
    // entirely out of view loses `nameable` (a caller cannot point at what
    // they cannot see) and that is exactly when "it is cut off" most needs
    // saying.
    if (!el.name) continue;
    if (o.viewport_px > 1) {
      out.push({
        kind: "overhangs_viewport",
        at,
        name: el.name || el.tag,
        selector: el.selector,
        detail: `sticks out ${Math.round(o.viewport_px)}px past the ${o.viewport_side} edge of a ${view.viewport.width}px screen`,
      });
    }
    if (o.clipped_px > 1) {
      out.push({
        kind: "clipped_by_parent",
        at,
        name: el.name || el.tag,
        selector: el.selector,
        detail: `${Math.round(o.clipped_px)}px of it is outside its parent, which has overflow:${o.parent_overflow} — that much is not visible`,
      });
    }
    if (el.topmost === false && el.name) {
      out.push({
        kind: "covered",
        at,
        name: el.name || el.tag,
        selector: el.selector,
        detail: `something else is painted over its centre point: ${el.covered_by}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// findByName — "the logo, top left" -> an element, or an honest question
// ---------------------------------------------------------------------------
const STOPWORDS = new Set(["the", "a", "an", "my", "our", "on", "in", "at", "of", "to", "please", "can", "you", "make", "move", "it", "that", "this", "is", "and"]);

function tokens(phrase) {
  return String(phrase || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

/**
 * findByName(xray, phrase, { limit }) -> { ok, ambiguous, matches:[{…, score, why}] }
 *
 * NEVER RETURNS A SINGLE ANSWER IT IS NOT ENTITLED TO. When the top two
 * candidates are within one point of each other the result is ambiguous:true
 * with both, and the caller's correct move is to ask which one — the same
 * discipline buildAnchorCatalog already applies when two headings share a
 * label. Picking one is exactly the guess this system must never make.
 */
function findByName(xray, phrase, { limit = 4 } = {}) {
  const view = (xray && xray.desktop) || xray || {};
  const elements = (view.elements || []).filter((e) => e.selector);
  const words = tokens(phrase);
  if (!words.length) return { ok: false, reason: "no_words_to_match_on", ambiguous: false, matches: [] };

  const scored = [];
  for (const el of elements) {
    let score = 0;
    const why = [];
    const name = String(el.name || "").toLowerCase();
    const syn = (el.synonyms || []).map((s) => String(s).toLowerCase());
    const zone = String(el.zone || "").toLowerCase();
    const text = String(el.text || "").toLowerCase();

    for (const w of words) {
      if (name === w) { score += 6; why.push(`its name is "${el.name}"`); continue; }
      if (name.includes(w)) { score += 4; why.push(`its name "${el.name}" contains "${w}"`); continue; }
      if (syn.some((s) => s === w || s.includes(w))) { score += 4; why.push(`"${w}" is another word for ${el.name}`); continue; }
      if (zone.includes(w)) { score += 3; why.push(`it is ${el.zone}`); continue; }
      if (String(el.tag).toLowerCase() === w || String(el.role).toLowerCase() === w) { score += 2; why.push(`it is a <${el.tag}>`); continue; }
      if (text && text.includes(w)) { score += 2; why.push(`it reads "${String(el.text).slice(0, 40)}"`); }
    }
    if (!score) continue;
    if (el.nameable) score += 1;
    // Two things a human means by "the" one: it is above the fold, and it is
    // big. Both are tiebreakers only — worth less than a single word match.
    if (el.fold === "above") score += 0.5;
    scored.push({ ...el, score: Math.round(score * 10) / 10, why: [...new Set(why)] });
  }

  scored.sort((a, b) => b.score - a.score || (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h));
  const matches = scored.slice(0, limit);
  if (!matches.length) return { ok: false, reason: "nothing_on_the_page_matched", ambiguous: false, matches: [] };
  const ambiguous = matches.length > 1 && matches[0].score - matches[1].score <= 1;
  return { ok: true, ambiguous, matches };
}

/** One sentence a phone agent can say about an element. */
function describeElement(el) {
  if (!el) return "";
  const what = el.name || `a <${el.tag}>`;
  const size = `${Math.round(el.rect.w)} by ${Math.round(el.rect.h)} pixels`;
  const bits = [`the ${what}, ${el.zone}, ${size}`];
  if (el.text) bits.push(`reading "${String(el.text).slice(0, 60)}"`);
  if (el.image && el.image.natural) {
    bits.push(`the picture itself is ${el.image.natural.w} by ${el.image.natural.h}`);
  }
  for (const v of (el.image && el.image.verdicts) || []) {
    if (v.kind !== "no_natural_size") bits.push(v.detail);
  }
  return `${bits.join(" — ")}.`;
}

// ===========================================================================
// THE IN-PAGE MEASUREMENT
// ===========================================================================
/**
 * Serialised into chromium, so it closes over NOTHING and receives everything
 * as one argument. Returns compact raw signals; all naming, colour conversion
 * and defect judgement happens in Node above, where it can be tested without
 * standing up a browser.
 */
/* c8 ignore start — runs inside chromium; exercised by scripts/page-xray-live-proof.js */
function measureXrayInPage(args) {
  const { maxElements, maxText, hintWords, probeOcclusion } = args;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "BR"]);

  const startedAt = Date.now();
  const startScrollY = window.scrollY;
  window.scrollTo(0, 0);

  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));

  // A generated id is not a stable handle. React/Radix mint "radix-:r7:",
  // bundlers mint "app-3f9c1a2b"; both change on the next build, and a
  // selector that stops matching after a rebuild is the same lie as one that
  // never matched.
  const idLooksStable = (id) => {
    if (!id || id.length > 40) return false;
    if (/[:.]/.test(id)) return false;
    if (/^[a-z]*[-_]?[0-9a-f]{6,}$/i.test(id)) return false;
    if (/^(radix|headlessui|mui|react-aria)/i.test(id)) return false;
    return true;
  };

  const describeShort = (el) => {
    if (!el || !el.tagName) return "";
    const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    const first = String(cls || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${first ? `.${first}` : ""}`;
  };

  const unique = (sel, el) => {
    try {
      const hits = document.querySelectorAll(sel);
      return hits.length === 1 && hits[0] === el;
    } catch { return false; }
  };

  const nthPath = (el, stopAt) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== stopAt && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
      parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(node) + 1})` : tag);
      node = parent;
    }
    return parts;
  };

  /**
   * A selector this element ANSWERS TO. Every candidate below is run back
   * through querySelectorAll before it is returned; a candidate that does not
   * resolve to exactly this one element is discarded, not returned with a
   * caveat. The last resort is a full nth-of-type path from <html>, which
   * always resolves but is positional — reported as stable:false so a caller
   * knows not to persist it across a rebuild.
   */
  // Tags that mean something on their own. On a single-page mirror there is
  // exactly one <h1>, one <header>, one <nav>, one <footer> — measured, and
  // then PROVEN by unique() before it is used. `h1` is also precisely the
  // selector site-change-plan's element catalog already offers for the
  // headline, so an x-ray entry can back a catalog entry with a rendered
  // measurement instead of a grep over the compiled bundle.
  const BARE_TAG_OK = new Set(["h1", "header", "nav", "footer", "main", "form"]);

  // A class token worth naming an element by: a word, not a build artefact.
  // Tailwind's utilities are excluded for free — `flex` is never unique — so
  // uniqueness does the filtering and this only has to reject the tokens that
  // would be unique AND meaningless (hashed module scopes like `_x1f9c2`).
  const tokenLooksStable = (t) => t.length >= 3 && t.length <= 40
    && /^[a-z][a-z0-9_-]*$/i.test(t)
    && !/^[a-z]{0,3}[0-9a-f]{6,}$/i.test(t)
    && !/^(css|sc|jsx|emotion)-/i.test(t);

  // A UNIQUE TOKEN IS NOT A STABLE ONE. Measured on the live Rimrock mirror:
  // the hero paragraph's only unique class was `mt-7`, the quote button's was
  // `justify-between`, the header call link's was `hidden`. Every one of them
  // resolves to exactly one element TODAY, which is why they are used — and
  // every one of them is a Tailwind utility that describes a margin or a
  // display mode, so the next build that nudges that paragraph to mt-8 leaves
  // the selector matching nothing. Emitting them as `stable:true` would be
  // this module telling the same lie it was written to catch, one layer up:
  // a selector that will silently stop matching, sold as one that will not.
  //
  // So they are still emitted (they are correct for this capture, and a crop
  // and a computed-style read both happen NOW) and they are flagged
  // stable:false, which is the flag a caller must consult before persisting a
  // selector into a stored edit that has to survive a rebuild.
  const UTILITY = /^(m|p)[trblxyse]?-|^(w|h|min|max|gap|space|inset|top|left|right|bottom|z|order|col|row|basis|grow|shrink)-|^(text|bg|border|ring|fill|stroke|from|via|to|shadow|opacity|rounded|font|leading|tracking|decoration|indent|align|whitespace|break|list|columns|aspect|object|overflow|overscroll|float|clear|isolate|mix|filter|backdrop|transition|duration|ease|delay|animate|transform|translate|rotate|skew|scale|origin|cursor|select|resize|scroll|snap|touch|will|contain|sr|not)-|^(flex|grid|table|block|inline|hidden|contents|absolute|relative|fixed|sticky|static|visible|invisible|italic|antialiased|uppercase|lowercase|capitalize|truncate|underline|justify|items|content|self|place)(-|$)|[:/[\]]/i;
  const tokenLooksSemantic = (t) => !UTILITY.test(t);

  const selectorFor = (el) => {
    const tag = el.tagName.toLowerCase();

    if (el.id && idLooksStable(el.id)) {
      const sel = `#${cssEscape(el.id)}`;
      if (unique(sel, el)) return { selector: sel, kind: "id", stable: true };
    }

    if (BARE_TAG_OK.has(tag) && unique(tag, el)) {
      return { selector: tag, kind: "tag", stable: true };
    }

    // Semantic attributes: what the element IS, not where it sits. These are
    // the ones that survive a rebuild, and they are conventions of OUR OWN
    // engine (client-logo, tel: CTAs) rather than donor accidents.
    const attrTries = [];
    const src = el.getAttribute && (el.getAttribute("src") || "");
    const href = el.getAttribute && (el.getAttribute("href") || "");
    if (src) {
      const m = /(client-logo|brand-logo)/i.exec(src);
      if (m) attrTries.push(`${tag}[src*="${m[1]}"]`);
      const file = String(src).split("/").pop();
      if (file && file.length <= 60) attrTries.push(`${tag}[src$="${file}"]`);
    }
    if (href && /^(tel:|mailto:)/i.test(href)) attrTries.push(`${tag}[href="${href}"]`);
    for (const key of ["data-testid", "data-test", "data-wss", "data-wss-content", "aria-label", "name"]) {
      const v = el.getAttribute && el.getAttribute(key);
      if (v && v.length <= 60) attrTries.push(`${tag}[${key}="${String(v).replace(/"/g, '\\"')}"]`);
    }
    for (const sel of attrTries) {
      if (unique(sel, el)) return { selector: sel, kind: "semantic", stable: true };
      // Scoped by the nearest landmark: "the logo IN THE HEADER" is both how a
      // person says it and, often, what makes it unique.
      const land = el.closest("header,nav,main,footer,form,section[id]");
      if (land) {
        const landSel = land.id && idLooksStable(land.id)
          ? `${land.tagName.toLowerCase()}#${cssEscape(land.id)}`
          : land.tagName.toLowerCase();
        const scoped = `${landSel} ${sel}`;
        if (unique(scoped, el)) return { selector: scoped, kind: "semantic", stable: true };
      }
    }

    // A NAME THE BUILD GAVE IT. Our own engine stamps semantic classes
    // (wss-brand-name, wss-code, wss-c__neartown) and donors carry a few of
    // their own. A unique one is worth more than any path: it says what the
    // element IS and it survives a re-layout.
    const clsRaw = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    // Semantic tokens are tried FIRST, so a `wss-brand-name` always beats an
    // `mt-7` even when both are unique.
    const clsTokens = String(clsRaw || "").trim().split(/\s+/).filter(tokenLooksStable).slice(0, 12);
    const ordered = [...clsTokens.filter(tokenLooksSemantic), ...clsTokens.filter((t) => !tokenLooksSemantic(t))];
    for (const token of ordered.slice(0, 8)) {
      const sel = `${tag}[class~="${token}"]`;
      if (unique(sel, el)) {
        return { selector: sel, kind: "class", stable: tokenLooksSemantic(token), ...(tokenLooksSemantic(token) ? {} : { unstable_because: `'${token}' is a utility class describing layout, not identity` }) };
      }
    }

    // Landmark + short path. Stable enough to read aloud, positional enough to
    // be honest about: a rebuild that reorders siblings breaks it.
    const land = el.closest("header,nav,main,footer,form,section[id]");
    if (land && land !== el) {
      const landSel = land.id && idLooksStable(land.id)
        ? `${land.tagName.toLowerCase()}#${cssEscape(land.id)}`
        : land.tagName.toLowerCase();
      const path = nthPath(el, land);
      if (path.length && path.length <= 4) {
        const sel = `${landSel} > ${path.join(" > ")}`;
        if (unique(sel, el)) return { selector: sel, kind: "landmark-path", stable: false };
      }
    }
    if (land === el) {
      const sel = land.id && idLooksStable(land.id) ? `${tag}#${cssEscape(land.id)}` : tag;
      if (unique(sel, el)) return { selector: sel, kind: "landmark", stable: true };
    }

    const full = nthPath(el, null);
    if (full.length) {
      const sel = full.join(" > ");
      if (unique(sel, el)) return { selector: sel, kind: "path", stable: false };
    }
    return { selector: null, kind: "", stable: false, reason: "no_candidate_resolved_to_exactly_this_element" };
  };

  const ownText = (el) => {
    let t = "";
    for (const child of el.childNodes) {
      if (child.nodeType === 3) t += child.textContent;
    }
    t = t.replace(/\s+/g, " ").trim();
    if (!t && /^(A|BUTTON|H1|H2|H3|H4|H5|H6|LABEL)$/.test(el.tagName)) {
      t = String(el.innerText || "").replace(/\s+/g, " ").trim();
    }
    return t.slice(0, maxText);
  };

  const hintsOf = (el) => {
    const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    let hay = ` ${String(el.id || "")} ${String(cls || "")} ${String(el.getAttribute("aria-label") || "")} `;
    try { for (const k of Object.keys(el.dataset || {})) hay += ` ${k} ${el.dataset[k]} `; } catch { /* dataset can throw on SVG in old engines */ }
    hay = hay.toLowerCase();
    const out = [];
    for (const w of hintWords) if (hay.includes(w)) out.push(w);
    return out;
  };

  // Cumulative opacity: a parent at 0 hides a child at 1.
  const effectiveOpacity = (el) => {
    let o = 1;
    let node = el;
    let guard = 0;
    while (node && node.nodeType === 1 && guard++ < 40) {
      const v = parseFloat(getComputedStyle(node).opacity);
      if (Number.isFinite(v)) o *= v;
      if (o <= 0.01) return 0;
      node = node.parentElement;
    }
    return o;
  };

  const firstUrl = (value) => {
    const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(String(value || ""));
    return m ? m[2] : "";
  };

  // -------------------------------------------------------------------
  // THE BROWSER CONVERTS THE COLOUR, NOT US
  // -------------------------------------------------------------------
  // These donors author colour in oklch, and getComputedStyle hands back
  // `oklch(0.96 0.032 270.5)` verbatim — measured on a live h1 by
  // lib/edit-verify. An sRGB hex is what a designer, an email and a contrast
  // ratio all need, and approximating one in JS would put a number in front of
  // an owner that no pixel on the page actually is.
  //
  // Canvas 2D fillStyle is a CSS Color 4 parser with an sRGB serialiser built
  // into the engine that painted the page. Assigning an INVALID value leaves
  // fillStyle untouched, so priming with two different colours and requiring
  // the same answer is what distinguishes "converted" from "rejected" — without
  // it an unparseable value would silently read back as whatever was there
  // before, which is the same shape as the no-op that reports success.
  const paintCtx = (() => {
    try { return document.createElement("canvas").getContext("2d"); } catch { return null; }
  })();
  const srgbMemo = new Map();
  const toSrgb = (value) => {
    const v = String(value || "").trim();
    if (!v || !paintCtx) return "";
    if (srgbMemo.has(v)) return srgbMemo.get(v);
    let out = "";
    try {
      paintCtx.fillStyle = "#000000";
      paintCtx.fillStyle = v;
      const a = String(paintCtx.fillStyle);
      paintCtx.fillStyle = "#ffffff";
      paintCtx.fillStyle = v;
      out = a === String(paintCtx.fillStyle) ? a : "";
    } catch { out = ""; }
    srgbMemo.set(v, out);
    return out;
  };

  // The nearest ancestor that actually paints a background. This is what the
  // text is really sitting on, which is the only thing a contrast number can
  // honestly be about.
  const effectiveBackground = (el) => {
    let node = el;
    let guard = 0;
    while (node && node.nodeType === 1 && guard++ < 40) {
      const s = getComputedStyle(node);
      const bg = s.backgroundColor;
      const m = /^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(String(bg));
      const alpha = m && m[1] !== undefined ? Number(m[1]) : 1;
      if (m && alpha > 0.05) return bg;
      if (s.backgroundImage && s.backgroundImage !== "none") return `image:${firstUrl(s.backgroundImage)}`;
      node = node.parentElement;
    }
    return "";
  };

  // -------------------------------------------------------------------
  // WHAT IS ACTUALLY ON SCREEN — the rect after every ancestor has clipped it
  // -------------------------------------------------------------------
  // The naive question "does this box extend past the viewport" produced 31
  // overhang reports on one live mirror and not one of them was a defect. They
  // were the header ticker's marquee spans, sitting 3,298px to the right of a
  // 390px screen INSIDE a track with overflow:hidden — which is how a marquee
  // works. Nothing was visible past the window edge; nothing could be.
  //
  // So the box is intersected with every clipping ancestor first, and the
  // overhang is measured on what survives. That is the rect a person's eye is
  // presented with, and "the logo hangs 17px off the left edge of the header"
  // is a true statement about it while "a marquee span is 3,298px wide" is not.
  //
  // POSITIONING IS HONOURED, not reimplemented. A fixed element escapes
  // ancestor clipping outright; an absolute one escapes clipping by ancestors
  // that are not themselves positioned. Those two rules cover what these pages
  // do. Transform/filter ancestors also capture fixed descendants — an edge
  // this deliberately does not model, so a fixed element inside a transformed
  // parent is reported UNCLIPPED, which can only ever under-report a defect,
  // never invent one.
  const CLIPS = /hidden|clip|auto|scroll/;
  const clipRectOf = (el, rect, position) => {
    let x1 = rect.left; let y1 = rect.top; let x2 = rect.right; let y2 = rect.bottom;
    let clippedBy = "";
    if (position === "fixed") return { x1, y1, x2, y2, clippedBy };
    let node = el.parentElement;
    let guard = 0;
    while (node && node.nodeType === 1 && guard++ < 40) {
      const s = getComputedStyle(node);
      const positioned = s.position !== "static";
      if (CLIPS.test(s.overflowX) || CLIPS.test(s.overflowY)) {
        const p = node.getBoundingClientRect();
        const before = { x1, y1, x2, y2 };
        if (CLIPS.test(s.overflowX)) { x1 = Math.max(x1, p.left); x2 = Math.min(x2, p.right); }
        if (CLIPS.test(s.overflowY)) { y1 = Math.max(y1, p.top); y2 = Math.min(y2, p.bottom); }
        if (!clippedBy && (x1 !== before.x1 || y1 !== before.y1 || x2 !== before.x2 || y2 !== before.y2)) {
          clippedBy = `${describeShort(node)}|${s.overflowX} ${s.overflowY}`;
        }
        if (x2 <= x1 || y2 <= y1) break;
      }
      // An absolutely positioned box is laid out against its nearest positioned
      // ancestor and is not clipped by anything above that one.
      if (position === "absolute" && positioned) break;
      node = node.parentElement;
    }
    return { x1, y1, x2, y2, clippedBy };
  };

  const STACKING = (s) => (
    (s.position !== "static" && s.zIndex !== "auto")
    || parseFloat(s.opacity) < 1
    || s.transform !== "none"
    || s.filter !== "none"
    || s.mixBlendMode !== "normal"
    || s.isolation === "isolate"
    || /paint|layout|strict|content/.test(s.contain || "")
  );

  // COLLECT EVERYTHING VISIBLE, RANK AFTERWARDS.
  //
  // The first version stopped walking at the cap. On the live Rimrock mirror
  // that meant 160 of 197 elements, taken strictly in document order, and the
  // page's photographs — which live below the services block — were never
  // reached at all: the image layer reported TWO images on a page that ships
  // half a dozen. A cap that silently amputates the bottom of the page is a
  // capture that lies about what is on it. So the walk is bounded only by a
  // safety ceiling, and the cap is applied by RANK at the end, then re-sorted
  // into document order so the tree still reads top to bottom.
  const HARD_CEILING = 2000;
  const all = [];
  const liveAll = [];
  let visited = 0;
  let droppedWrapper = 0;

  const walk = (el, depth) => {
    if (all.length >= HARD_CEILING) return;
    if (!el || el.nodeType !== 1 || SKIP.has(el.tagName)) return;
    visited += 1;

    const rects = el.getClientRects();
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const hidden = rects.length === 0
      || style.visibility === "hidden" || style.visibility === "collapse"
      || rect.width < 1 || rect.height < 1
      || el.getAttribute("aria-hidden") === "true"
      || effectiveOpacity(el) === 0;

    if (hidden) {
      // display:none subtrees have no boxes at all; there is nothing below to
      // find. A merely transparent or aria-hidden wrapper may still contain
      // things worth listing, so only a boxless element stops the descent.
      if (rects.length === 0 && style.display === "none") return;
      for (const child of el.children) walk(child, depth + 1);
      return;
    }

    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && String(n.textContent || "").trim());
    const paints = style.backgroundImage !== "none"
      || !/^rgba?\([^)]*,\s*0\s*\)$/.test(style.backgroundColor) && style.backgroundColor !== "transparent"
      || parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderBottomWidth) > 0
      || parseFloat(style.borderLeftWidth) > 0 || parseFloat(style.borderRightWidth) > 0
      || style.boxShadow !== "none";
    const MEDIA = /^(IMG|VIDEO|SVG|CANVAS|IFRAME|PICTURE|INPUT|TEXTAREA|SELECT|BUTTON)$/;
    const LANDMARK = /^(HEADER|NAV|MAIN|FOOTER|SECTION|FORM|ARTICLE|ASIDE|H1|H2|H3|H4|H5|H6|A|P|LI|LABEL)$/;

    // A wrapper that paints nothing, holds no words of its own, and exists
    // only to hold one child of the same size is not something a customer
    // ever names. Dropping it is what turns 3,000 divs into a list a person
    // can read — and it is dropped from the LIST, never from the walk.
    const passthrough = !hasOwnText && !paints
      && !MEDIA.test(el.tagName) && !LANDMARK.test(el.tagName)
      && el.children.length === 1
      && Math.abs(el.children[0].getBoundingClientRect().width - rect.width) < 2
      && Math.abs(el.children[0].getBoundingClientRect().height - rect.height) < 2;

    if (passthrough) {
      droppedWrapper += 1;
      for (const child of el.children) walk(child, depth + 1);
      return;
    }

    const fixed = style.position === "fixed";
    const docRect = {
      x: Math.round((rect.left + (fixed ? 0 : window.scrollX)) * 10) / 10,
      y: Math.round((rect.top + (fixed ? 0 : window.scrollY)) * 10) / 10,
      w: Math.round(rect.width * 10) / 10,
      h: Math.round(rect.height * 10) / 10,
    };

    // What survives every clipping ancestor. Everything below measures THIS,
    // not the layout box, because this is the part a person can see.
    const clip = clipRectOf(el, rect, style.position);
    const visibleW = Math.max(0, clip.x2 - clip.x1);
    const visibleH = Math.max(0, clip.y2 - clip.y1);

    // OVERHANG. Measured against the layout viewport, which is what a stranger
    // looking at the page has. This is the exact shape of the logo that hung
    // 17px off the left edge of the header at every width — and, because it is
    // the clipped rect, NOT the shape of a marquee span parked outside its own
    // track.
    const vw = document.documentElement.clientWidth;
    let viewportPx = 0;
    let viewportSide = "";
    if (visibleW > 0 && visibleH > 0) {
      if (clip.x1 < -1) { viewportPx = -clip.x1; viewportSide = "left"; }
      if (clip.x2 > vw + 1 && (clip.x2 - vw) > viewportPx) { viewportPx = clip.x2 - vw; viewportSide = "right"; }
    }

    // CLIPPED — "the graphic is too big for the box it was given", as a pixel
    // count. Only overflow:hidden/clip counts: a scroller is a box a visitor
    // can move, so content beyond its edge is reachable rather than lost.
    let clippedPx = 0;
    let parentOverflow = "";
    if (clip.clippedBy && /hidden|clip/.test(clip.clippedBy.split("|")[1] || "")) {
      const lost = Math.max(0, clip.x1 - rect.left) + Math.max(0, rect.right - clip.x2)
        + Math.max(0, clip.y1 - rect.top) + Math.max(0, rect.bottom - clip.y2);
      if (lost > 1) { clippedPx = lost; parentOverflow = (clip.clippedBy.split("|")[1] || "").trim(); }
    }

    const effBg = hasOwnText ? effectiveBackground(el) : "";
    const record = {
      index: all.length,
      depth,
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      role: el.getAttribute("role") || "",
      href: el.getAttribute("href") || "",
      src: (el.currentSrc || el.getAttribute("src") || "") || firstUrl(style.backgroundImage),
      alt: el.getAttribute("alt") || "",
      label: el.getAttribute("aria-label") || "",
      placeholder: el.getAttribute("placeholder") || "",
      text: ownText(el),
      hints: hintsOf(el),
      inHeader: Boolean(el.closest("header,nav,[class*=header i],[class*=nav i]")),
      isLandmarkish: LANDMARK.test(el.tagName) || rect.width > vw * 0.8,
      rect: docRect,
      view: { x: Math.round(rect.left * 10) / 10, y: Math.round(rect.top * 10) / 10 },
      fixed,
      style: {
        color: style.color,
        // The engine's own sRGB serialisation of the same value. "" when the
        // engine refused it; the raw computed string above is always the
        // authority and these never replace it, they sit beside it.
        colorSrgb: toSrgb(style.color),
        backgroundColor: style.backgroundColor,
        backgroundColorSrgb: toSrgb(style.backgroundColor),
        backgroundImage: firstUrl(style.backgroundImage),
        effectiveBackground: effBg,
        effectiveBackgroundSrgb: toSrgb(effBg),
        fontFamily: String(style.fontFamily || "").split(",")[0].replace(/["']/g, "").trim(),
        fontFamilyStack: String(style.fontFamily || "").slice(0, 120),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textAlign: style.textAlign,
        textTransform: style.textTransform,
        display: style.display,
        position: style.position,
        zIndex: style.zIndex,
        opacity: style.opacity,
        overflow: `${style.overflowX} ${style.overflowY}`,
        objectFit: style.objectFit,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow === "none" ? "" : String(style.boxShadow).slice(0, 60),
        flexDirection: style.display.includes("flex") ? style.flexDirection : "",
      },
      naturalWidth: el.naturalWidth || el.videoWidth || 0,
      naturalHeight: el.naturalHeight || el.videoHeight || 0,
      objectFit: style.objectFit,
      media: el.tagName === "VIDEO"
        ? { paused: Boolean(el.paused), muted: Boolean(el.muted), loop: Boolean(el.loop), currentSrc: el.currentSrc || "" }
        : null,
      stackingContext: STACKING(style),
      visible: { w: Math.round(visibleW * 10) / 10, h: Math.round(visibleH * 10) / 10 },
      overflow: {
        viewport_px: Math.round(viewportPx * 10) / 10,
        viewport_side: viewportSide,
        clipped_px: Math.round(clippedPx * 10) / 10,
        parent_overflow: parentOverflow,
        clipped_by: clip.clippedBy ? clip.clippedBy.split("|")[0] : "",
      },
      // How much of the element a person can actually see. An element clipped
      // to nothing is listed and marked rather than dropped, because "it is
      // there and you cannot see any of it" is itself an answer somebody may
      // need — but it is never offered as something to address by name.
      interest: (/^(img|video|iframe|canvas|svg)$/.test(el.tagName.toLowerCase()) ? 3 : 0)
        + (LANDMARK.test(el.tagName) ? 2 : 0)
        + (hasOwnText ? 1 : 0),
      topmost: null,
      covered_by: "",
    };
    const sel = selectorFor(el);
    record.selector = sel.selector;
    record.selector_kind = sel.kind;
    record.selector_stable = sel.stable;
    if (sel.unstable_because) record.selector_unstable_because = sel.unstable_because;
    if (!sel.selector) record.selector_reason = sel.reason;

    all.push(record);
    liveAll.push(el);
    for (const child of el.children) walk(child, depth + 1);
  };

  walk(document.body, 0);

  // RANK, THEN CAP, THEN PUT IT BACK IN DOCUMENT ORDER. Media and landmarks
  // survive a cap; anonymous structural boxes are what a cap is for.
  const order = all.map((r, i) => i);
  order.sort((a, b) => (all[b].interest - all[a].interest)
    || ((all[b].rect.w * all[b].rect.h) - (all[a].rect.w * all[a].rect.h)));
  const chosen = order.slice(0, maxElements).sort((a, b) => a - b);
  const kept = chosen.map((i) => all[i]);
  const live = chosen.map((i) => liveAll[i]);

  // ---------------------------------------------------------------------
  // Z-ORDER, ANSWERED THE ONLY WAY IT HAS A TRUE ANSWER
  // ---------------------------------------------------------------------
  // Computing paint order from stacking contexts is a reimplementation of the
  // engine and would be wrong at the edges. elementFromPoint asks the engine
  // itself: at this element's own centre, what does a click hit? An element
  // that is not the answer at its own centre is behind something, and the
  // thing in front is named. Elements never scrolled into view are left null —
  // unmeasured, never assumed visible.
  if (probeOcclusion) {
    const step = Math.max(240, Math.floor(window.innerHeight * 0.9));
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    for (let y = 0; ; y += step) {
      window.scrollTo(0, Math.min(y, maxY));
      const sy = window.scrollY;
      const sx = window.scrollX;
      for (let i = 0; i < kept.length; i += 1) {
        const k = kept[i];
        if (k.topmost !== null) continue;
        const el = live[i];
        // THE RECT IS RE-READ AT PROBE TIME, NOT REUSED FROM THE WALK.
        //
        // The walk measures at scrollY=0. Scrolling to reach an element fires
        // its scroll-triggered reveal, which translates it — so a centre point
        // computed from the walk's coordinates lands where the element USED to
        // be and hits whatever is there now. Measured on the live O'Brien
        // mirror: four paragraphs reported "covered by div.mt-10.space-y-4",
        // their own parent, purely because they had animated into place since
        // the rect was taken. getBoundingClientRect() here is already
        // viewport-relative and already current, which also removes the need
        // to special-case fixed and sticky elements by hand.
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 1 || cy < 1 || cx > window.innerWidth - 1 || cy > window.innerHeight - 1) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (!hit) continue;
        // A descendant answering for its parent is the parent being visible.
        // The reverse is not true, and is the case worth reporting.
        k.topmost = hit === el || el.contains(hit);
        if (!k.topmost) k.covered_by = describeShort(hit);
      }
      if (y >= maxY) break;
    }
    window.scrollTo(0, startScrollY);
  }

  return {
    title: document.title || "",
    url: location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      doc_width: document.documentElement.scrollWidth,
      doc_height: document.documentElement.scrollHeight,
      dpr: window.devicePixelRatio || 1,
    },
    elements: kept,
    counts: {
      visited,
      visible: all.length,
      kept: kept.length,
      dropped_wrappers: droppedWrapper,
      dropped_by_cap: all.length - kept.length,
      capped: all.length > kept.length,
    },
    measure_ms: Date.now() - startedAt,
  };
}

/** Walk the page once to trigger lazy images, then return to the top. */
function primeLazyLoadInPage() {
  return new Promise((resolve) => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.9));
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    let y = 0;
    const tick = () => {
      window.scrollTo(0, Math.min(y, maxY));
      if (y >= maxY) { window.scrollTo(0, 0); setTimeout(resolve, 60); return; }
      y += step;
      setTimeout(tick, 50);
    };
    tick();
  });
}
/* c8 ignore stop */

// ===========================================================================
// THE CACHE
// ===========================================================================
/**
 * Keyed on (url, build_hash). With a build hash a hit is proof the bytes have
 * not moved; without one it is only a bet, so the TTL drops to 90s and every
 * such result says so in `cache.keyed_on`. invalidate(url) is the certainty —
 * see the wiring note at the top: the deploy path must call it.
 */
function createCache({ maxEntries = CACHE_MAX_ENTRIES, now = Date.now } = {}) {
  const map = new Map(); // key -> { value, expiresAt, storedAt }
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= now()) { map.delete(key); return null; }
      // LRU: re-insert so the newest use is last.
      map.delete(key);
      map.set(key, hit);
      return hit;
    },
    set(key, value, ttlMs) {
      map.set(key, { value, storedAt: now(), expiresAt: now() + ttlMs });
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },
    invalidate(url) {
      const prefix = `${normalizeUrl(url)}\u0000`;
      let dropped = 0;
      for (const key of [...map.keys()]) {
        if (key.startsWith(prefix)) { map.delete(key); dropped += 1; }
      }
      return dropped;
    },
    clear() { map.clear(); },
    size: () => map.size,
    _map: map,
  };
}

const defaultCache = createCache();

function invalidate(url) {
  return defaultCache.invalidate(url);
}

// ===========================================================================
// THE CAPTURE
// ===========================================================================

/**
 * A browser, or an honest refusal fast. NEVER a five-minute hang.
 *
 * lib/serverless-chromium meters browsers at one at a time by default and
 * waits 300s for a permit. Inside an edit the caller ALREADY HOLDS that
 * permit, so an unpassed browser here is a deadlock, not a slow path. The race
 * below turns it into a named failure in 25s, and the abandoned promise still
 * closes whatever it eventually produces so no permit is stranded.
 */
async function acquireBrowser({ launch, permitWaitMs }) {
  const launcher = launch || (() => require("./serverless-chromium").launchChromium());
  const wanted = Promise.resolve().then(launcher);
  let timer;
  const gaveUp = new Promise((resolve) => {
    // NOT unref'd, deliberately. When the launcher never settles — a held
    // serverless-chromium permit, exactly the case this guard exists for —
    // this timer is the ONLY thing that can finish the race. unref() tells
    // node it is not a reason to keep the loop alive, so the loop drained
    // first and the await never returned: "Promise resolution is still
    // pending but the event loop has already resolved". The guard against
    // hanging was itself the hang. It cannot leak: clearTimeout below runs
    // on both the win and the timeout path.
    timer = setTimeout(() => resolve("__timeout"), permitWaitMs);
  });
  const winner = await Promise.race([wanted.catch((e) => ({ __error: e })), gaveUp]);
  clearTimeout(timer);
  if (winner === "__timeout") {
    wanted.then((b) => (b && b.close ? b.close() : null)).catch(() => {});
    throw new Error(
      `chromium_unavailable: no browser within ${permitWaitMs}ms. If this is running inside an edit, `
      + "the caller already holds the render permit — pass the open browser as { browser }.",
    );
  }
  if (!winner || winner.__error) throw (winner && winner.__error) || new Error("no_browser");
  return winner;
}

/**
 * Load a page and wait until it has actually painted words.
 *
 * NOT networkidle. These mirrors autoplay a looping hero video, so the network
 * never goes quiet and "wait for idle" is a synonym for "wait for the
 * timeout" — 45s burnt on a page that was ready in 200ms. That lesson is
 * lib/edit-verify's, learned in production, and it is repeated here rather
 * than re-learned.
 */
async function openPage(browser, url, { width, height, timeoutMs, settleMs, isMobile }) {
  const page = await browser.newPage({
    viewport: { width, height },
    ...(isMobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  const res = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
  const status = res ? res.status() : 0;
  await page.waitForFunction(
    () => Boolean(document.body) && document.body.innerText.trim().length > 120,
    null,
    { timeout: Math.min(12000, timeoutMs) },
  ).catch(() => { /* a thin page is still a page; measure what is there */ });
  if (settleMs) await page.waitForTimeout(settleMs);
  return { page, status, finalUrl: page.url() };
}

/** Fold the raw in-page record into the shape consumers read. */
function hydrateElements(raw, viewport) {
  const out = [];
  for (const el of raw.elements || []) {
    const classified = classifyName({ ...el, viewportWidth: viewport.width, viewportHeight: viewport.height });
    // The engine's own sRGB serialisation first — it is the only way an oklch
    // authored colour becomes a hex without anybody approximating anything.
    // toHex on the raw computed string is the fallback for a page whose canvas
    // was unavailable, and it honestly returns "" for a colour it cannot read.
    const color = toHex(el.style.colorSrgb || el.style.color);
    const bg = toHex(el.style.backgroundColorSrgb || el.style.backgroundColor);
    const effBg = toHex(el.style.effectiveBackgroundSrgb || el.style.effectiveBackground);
    const image = /^(img|video|picture|svg)$/.test(el.tag) || el.style.backgroundImage
      ? measureImage(el)
      : null;
    out.push({
      index: el.index,
      depth: el.depth,
      tag: el.tag,
      role: roleOf(el),
      name: classified.name,
      // CLIPPED TO NOTHING IS NOT ADDRESSABLE. A marquee span parked outside
      // its own track keeps its name and its measurements — "it is there and
      // none of it is on screen" is a real answer — but it is never offered as
      // something a caller can point at, because they cannot see it to point.
      nameable: classified.nameable && !(el.visible && (el.visible.w < 4 || el.visible.h < 4)),
      clipped_out: Boolean(el.visible && (el.visible.w < 4 || el.visible.h < 4)),
      synonyms: classified.synonyms,
      // The matched hint words, carried through rather than consumed. classifyName
      // uses them to pick a name and then they were being dropped, which left
      // lib/element-resolve.js unable to hear "the social block" on an element
      // whose class says `social-links` but whose name is only "section".
      // They are evidence (a word that IS in the id/class/data-*/aria-label),
      // not a guess, so they belong on the record.
      hints: Array.isArray(el.hints) ? el.hints : [],
      cropPriority: classified.cropPriority,
      text: el.text,
      selector: el.selector,
      selector_kind: el.selector_kind,
      selector_stable: el.selector_stable,
      ...(el.selector ? {} : { selector_reason: el.selector_reason || "" }),
      rect: el.rect,
      // What survives every clipping ancestor — see clipRectOf. When this is
      // smaller than rect, part of the element is not on screen at all.
      visible: el.visible,
      view: el.view,
      fixed: el.fixed,
      zone: zoneOf(el.fixed ? { ...el.rect, x: el.view.x, y: el.view.y } : el.rect, viewport),
      fold: (el.fixed ? el.view.y : el.rect.y) < viewport.height ? "above" : "below",
      z: {
        index: el.style.zIndex,
        stacking_context: el.stackingContext,
        document_order: el.index,
      },
      topmost: el.topmost,
      covered_by: el.covered_by,
      style: {
        ...el.style,
        colorHex: color.hex,
        backgroundColorHex: bg.hex,
        backgroundAlpha: bg.alpha,
        effectiveBackgroundHex: effBg.hex,
      },
      contrast: el.text && color.hex && effBg.hex ? contrastRatio(color.hex, effBg.hex) : null,
      image,
      media: el.media,
      overflow: el.overflow,
      src: el.src,
      alt: el.alt,
      href: el.href,
    });
  }
  return out;
}

/**
 * xray(url, options) -> the three layers.
 *
 * @param {string}  url
 * @param {object}  options
 *   browser        AN ALREADY-OPEN chromium. Pass it mid-edit — see the wiring
 *                  note at the top of this file. Not closed here; only a
 *                  browser this function opened is closed by it.
 *   buildHash      what build this is a picture OF. Enables the long cache.
 *   crops          per-element crops (default true), maxCrops caps the count.
 *   mobile         also capture 390 (default true). Navigated IN PARALLEL, so
 *                  it costs max(desktop, mobile), not the sum.
 *   shots          full-page pictures (default true). false = structure only,
 *                  which is the cheapest useful call.
 *   cache          injectable; defaults to the module-level LRU.
 *
 * NEVER THROWS. An unreachable page comes back { ok:false, reason }, because a
 * capture that cannot see must say so rather than take the call down.
 */
async function xray(url, {
  browser = null,
  buildHash = "",
  crops = true,
  maxCrops = MAX_CROPS,
  maxElements = MAX_ELEMENTS,
  mobile = true,
  shots = true,
  probeOcclusion = true,
  timeoutMs = 25_000,
  settleMs = 500,
  permitWaitMs = PERMIT_WAIT_MS,
  imageType = "jpeg",
  imageQuality = 78,
  cache = defaultCache,
  ttlMs = null,
  launch = null,
  now = Date.now,
  useCache = true,
} = {}) {
  const t0 = now();
  const target = String(url || "").trim();
  if (!target) return { ok: false, url: "", reason: "no_url" };

  const key = cacheKey(target, buildHash);
  if (useCache) {
    const hit = cache.get(key);
    if (hit) {
      return {
        ...hit.value,
        cache: {
          ...hit.value.cache,
          hit: true,
          age_ms: now() - hit.storedAt,
          served_in_ms: now() - t0,
        },
      };
    }
  }

  let ownBrowser = null;
  const timings = { launch_ms: 0, open_ms: 0, measure_ms: 0, shots_ms: 0, crops_ms: 0, total_ms: 0 };
  try {
    let br = browser;
    if (!br) {
      const tl = now();
      ownBrowser = await acquireBrowser({ launch, permitWaitMs });
      br = ownBrowser;
      timings.launch_ms = now() - tl;
    }

    const measureArgs = { maxElements, maxText: MAX_TEXT, hintWords: HINT_WORDS, probeOcclusion };

    const captureView = async ({ label, width, height, isMobile, withCrops }) => {
      const opened = await openPage(br, target, { width, height, timeoutMs, settleMs, isMobile });
      const { page } = opened;
      try {
        await page.evaluate(primeLazyLoadInPage).catch(() => {});
        const raw = await page.evaluate(measureXrayInPage, measureArgs);
        const elements = hydrateElements(raw, raw.viewport);
        const view = {
          label,
          status: opened.status,
          final_url: opened.finalUrl,
          title: raw.title,
          viewport: raw.viewport,
          counts: raw.counts,
          elements,
          shot: null,
          crops: [],
          measure_ms: raw.measure_ms,
        };
        view.defects = defectsOf(view);

        if (shots) {
          const ts = now();
          const buffer = await page.screenshot({
            fullPage: true,
            type: imageType,
            ...(imageType === "jpeg" ? { quality: imageQuality } : {}),
            animations: "disabled",
          });
          view.shot = { buffer, bytes: buffer.length, sha256: sha256(buffer), type: imageType, full_page: true };
          view.shot_ms = now() - ts;
        }

        if (withCrops && crops) {
          const tc = now();
          // AT MOST TWO CROPS OF ANY ONE THING. Measured: a page with five
          // tel: links spent five of its eight crops photographing phone
          // numbers and never got to the hero or the headline. The crop budget
          // exists to show a person what is on the page, and five pictures of
          // the same noun is not that.
          const perName = new Map();
          const wanted = elements
            .filter((e) => e.selector && e.nameable && e.cropPriority < 90
              && e.rect.w >= 12 && e.rect.h >= 12
              && e.visible && e.visible.w >= 12 && e.visible.h >= 12)
            .sort((a, b) => a.cropPriority - b.cropPriority || (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h))
            .filter((e) => {
              const n = perName.get(e.name) || 0;
              if (n >= 2) return false;
              perName.set(e.name, n + 1);
              return true;
            })
            .slice(0, maxCrops);
          for (const el of wanted) {
            try {
              const buf = await page.locator(el.selector).first().screenshot({
                type: imageType,
                ...(imageType === "jpeg" ? { quality: imageQuality } : {}),
                animations: "disabled",
                timeout: 4000,
              });
              view.crops.push({
                name: el.name,
                selector: el.selector,
                index: el.index,
                rect: el.rect,
                buffer: buf,
                bytes: buf.length,
                sha256: sha256(buf),
                type: imageType,
              });
            } catch (e) {
              // A crop that will not take is recorded, never silently dropped:
              // an element playwright cannot photograph through the selector
              // this module minted is evidence about the selector.
              view.crops.push({ name: el.name, selector: el.selector, index: el.index, error: String((e && e.message) || e).slice(0, 120) });
            }
          }
          view.crops_ms = now() - tc;
        }
        return view;
      } finally {
        await page.close().catch(() => {});
      }
    };

    const tOpen = now();
    // PARALLEL. Two pages against one browser: the second navigation hits a
    // warm HTTP cache and the wall clock is max(), not sum(). This is the
    // single biggest reason the whole capture stays inside a phone call.
    const [desktop, mobileView] = await Promise.all([
      captureView({ label: "1280", width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT, isMobile: false, withCrops: true }),
      mobile
        ? captureView({ label: "390", width: MOBILE_WIDTH, height: MOBILE_HEIGHT, isMobile: true, withCrops: false })
        : Promise.resolve(null),
    ]);
    timings.open_ms = now() - tOpen;
    timings.measure_ms = (desktop.measure_ms || 0) + ((mobileView && mobileView.measure_ms) || 0);
    timings.shots_ms = (desktop.shot_ms || 0) + ((mobileView && mobileView.shot_ms) || 0);
    timings.crops_ms = desktop.crops_ms || 0;
    timings.total_ms = now() - t0;

    if (desktop.status !== 200) {
      return { ok: false, url: target, status: desktop.status, reason: `http_${desktop.status}`, timings };
    }

    const result = {
      ok: true,
      url: target,
      final_url: desktop.final_url,
      status: desktop.status,
      title: desktop.title,
      build_hash: String(buildHash || "") || null,
      captured_at: new Date(now()).toISOString(),
      timings,
      desktop,
      mobile: mobileView,
      // Promoted for the common case — a caller mid-edit wants the desktop
      // view and does not want to spell `.desktop.` every time.
      elements: desktop.elements,
      defects: [...desktop.defects, ...((mobileView && mobileView.defects) || [])],
      shot: desktop.shot,
      mobile_shot: mobileView && mobileView.shot,
      crops: desktop.crops,
      cache: {
        hit: false,
        key,
        keyed_on: buildHash ? "url+build_hash" : "url_only",
        ...(buildHash ? {} : {
          risk: "no build hash — a deploy inside the TTL would not be seen. "
            + "The deploy path must call require('./page-xray').invalidate(url).",
        }),
      },
    };

    if (useCache) cache.set(key, result, ttlMs || (buildHash ? TTL_WITH_BUILD_MS : TTL_NO_BUILD_MS));
    return result;
  } catch (e) {
    timings.total_ms = now() - t0;
    return { ok: false, url: target, reason: String((e && e.message) || e).slice(0, 300), timings };
  } finally {
    if (ownBrowser) await ownBrowser.close().catch(() => {});
  }
}

/**
 * catalog(xray, { limit }) -> the addressable elements, and nothing else.
 *
 * WHY THIS EXISTS SEPARATELY FROM withoutBuffers. A full record of a real
 * mirror is 1.1MB of JSON — measured on the live Rimrock capture — because 160
 * elements each carry their complete computed style. That is the right shape
 * for a designer's view and the wrong shape for everything else: a planner
 * prompt, an event row, a log line. This is the ~4KB view: what is on the page,
 * what it is called, where it sits, and the selector that has been proven to
 * reach it.
 *
 * `stable` is the field a caller MUST consult before persisting a selector into
 * a stored edit. false means it is correct right now and will not survive a
 * rebuild — see the utility-class note in selectorFor.
 */
function catalog(result, { limit = 40 } = {}) {
  const view = (result && result.desktop) || result || {};
  return (view.elements || [])
    .filter((e) => e.selector && e.nameable && e.name)
    .sort((a, b) => a.cropPriority - b.cropPriority || a.index - b.index)
    .slice(0, limit)
    .map((e) => ({
      name: e.name,
      selector: e.selector,
      stable: Boolean(e.selector_stable),
      zone: e.zone,
      size: `${Math.round(e.rect.w)}x${Math.round(e.rect.h)}`,
      ...(e.text ? { text: String(e.text).slice(0, 60) } : {}),
      ...(e.topmost === false ? { covered_by: e.covered_by } : {}),
    }));
}

/**
 * The same object with every image buffer replaced by its digest. What goes in
 * a log, an event row or a model prompt — never the megabytes.
 */
function withoutBuffers(result) {
  if (!result || typeof result !== "object") return result;
  const strip = (shot) => (shot && shot.buffer ? { ...shot, buffer: undefined, has_buffer: true } : shot);
  const stripView = (v) => (v ? {
    ...v,
    shot: strip(v.shot),
    crops: (v.crops || []).map(strip),
  } : v);
  return {
    ...result,
    desktop: stripView(result.desktop),
    mobile: stripView(result.mobile),
    shot: strip(result.shot),
    mobile_shot: strip(result.mobile_shot),
    crops: (result.crops || []).map(strip),
  };
}

module.exports = {
  xray,
  invalidate,
  findByName,
  describeElement,
  defectsOf,
  catalog,
  withoutBuffers,
  // pure, exported for tests
  normalizeUrl,
  cacheKey,
  toHex,
  luminance,
  contrastRatio,
  zoneOf,
  roleOf,
  classifyName,
  measureImage,
  hydrateElements,
  createCache,
  tokens,
  // in-page, exported so a caller with its own page can run the measurement
  // against a browser it already owns without going through xray()
  measureXrayInPage,
  primeLazyLoadInPage,
  // constants
  HINT_WORDS,
  MAX_ELEMENTS,
  MAX_CROPS,
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  TTL_WITH_BUILD_MS,
  TTL_NO_BUILD_MS,
  _cache: defaultCache,
};
