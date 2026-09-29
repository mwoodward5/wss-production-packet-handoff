"use strict";

// lib/visual-verify.js — DID IT ACTUALLY CHANGE?
//
// =====================================================================
// THE SENTENCE THIS FILE EXISTS TO STOP
// =====================================================================
// From the owner's recorded calls, in his customers' own words:
//
//   "the logo is now stretched and cut off and cropped... the graphic is
//    too big for the box it was given"
//
// Nobody looked at the result. The rule applied, the deploy went READY, the
// job said done, and the person on the phone was staring at a mangled logo
// while being told it was live.
//
// And the quieter one, measured in production (job edit_1786235976776_etudr8):
// the CSS applied to an element that matched, the bytes changed, every gate
// passed — and the headline on the page was the same colour it had always
// been. The customer was told "Done — it's live on your site now."
//
// =====================================================================
// WHAT THIS MODULE IS, AND WHAT IT IS NOT
// =====================================================================
// lib/edit-verify.js already answers: DID THE RULE TAKE? For every declaration
// the plan wrote, it reads the computed style of the elements the selector
// matched and compares against intent. That is a necessary check and it is not
// this one.
//
// A rule can take perfectly and change nothing a human can see:
//   · `width:400px` on an inline <span> — computes, does nothing
//   · a colour set to the colour it already was
//   · a margin on an element inside a box exactly its own size
//   · an edge still serving yesterday's bytes
// And a rule can take AND wreck the page: the logo really is twice as big,
// and it is also squashed, overflowing its header, and sitting on the phone
// number.
//
//   edit-verify   : "the declaration is computing on the matched elements"
//   visual-verify : "the page is measurably different, in the way they asked,
//                    and nothing else broke"
//
// The second question is answered by photographing the page BEFORE, changing
// it, photographing it AFTER, and subtracting. Nothing else can answer it.
//
// =====================================================================
// THE ORDER OF OPERATIONS IS THE WHOLE DESIGN
// =====================================================================
// 1. MEASURE. A resize is proven by two different numbers for a dimension. A
//    move is proven by two different positions. A colour change is proven by
//    two different computed colours. Every verdict below carries the pair of
//    numbers it was read off, so a reader can disagree with a threshold
//    without re-running anything.
// 2. ONLY THEN LOOK. Vision is asked one question — does the result LOOK
//    right — and it is asked about a photograph of the thing that changed.
//
// VISION MAY ACCUSE, IT MAY NOT ACQUIT. It can turn CHANGED_AS_ASKED into
// CHANGED_BUT_WRONG by naming a problem. It can never turn CHANGED_BUT_WRONG
// into CHANGED_AS_ASKED, and it can never produce or erase NO_VISIBLE_CHANGE.
// Measurement is evidence; a model's opinion of a JPEG is not, and the one
// direction where being wrong is cheap is the direction of caution.
//
// =====================================================================
// THE VERDICTS
// =====================================================================
//   CHANGED_AS_ASKED   measured different, different in the direction asked,
//                      and no new defect. The ONLY verdict on which Riley is
//                      allowed to say "that's live, hit refresh".
//   CHANGED_BUT_WRONG  something changed, and it is not what was asked or it
//                      broke something. Carries `wrong[]`, each entry with its
//                      measurement. Riley names it and offers to put it back.
//   NO_VISIBLE_CHANGE  the page is measurably identical. THIS IS THE ONE THAT
//                      MATTERS. It is the current silent failure, and it is
//                      reported, never swallowed — the caller is looking at
//                      the page and already knows.
//   COULD_NOT_LOOK     not a verdict about the change: a verdict about our
//                      ability to see. A capture that failed, or an edge still
//                      serving the old bytes. Reporting this as
//                      NO_VISIBLE_CHANGE would be inventing a measurement,
//                      which is the exact defect this module exists to catch.
//                      It matches lib/edit-verify's `unconfirmed`, and like it,
//                      it is never spoken as done and never triggers a
//                      rollback on a suspicion.
//
// =====================================================================
// THE TRAP THAT NEARLY SHIPPED IN THIS FILE
// =====================================================================
// A CDN still serving the old bytes produces a page that is genuinely,
// measurably identical. That is a true statement about the page and a lie
// about the edit. So when the caller passes the job marker, its ABSENCE is
// COULD_NOT_LOOK / page_still_serving_old_bytes — never NO_VISIBLE_CHANGE.
// See markerPresent below and the wiring note at the foot of this file.
//
// =====================================================================
// AND THE ONE THAT DID SHIP, UNTIL THE PAGE WAS ACTUALLY MEASURED
// =====================================================================
// The first live run of this module reported CHANGED_BUT_WRONG for a resize
// that was perfectly correct, and blamed it for moving a button it never
// touched. The cause was an assumption written into this file as a comment —
// that two captures of an unchanged page are identical.
//
// They are not. Measured, four captures of the live Rimrock mirror with no
// edit of any kind between them (scripts/visual-verify-noise-probe.js):
//
//   metric      unstable/total   max drift with NO edit
//   x            0/137            0px
//   w            0/137            0px
//   h            0/137            0px
//   font_px      0/137            0px
//   colour       0/137            0px
//   text/src     0/137            0px
//   y           11/137          228px      <-- and up to 26px on other runs
//
// plus one to two `covered` defects appearing and disappearing per capture
// pair, because that check point-samples what is painted over an element's
// centre and these pages animate.
//
// A longer settle makes it WORSE, not better (capture 1 vs 2 at settle=2500ms:
// 127 elements differing, 226.9px) — so this is not a font finishing loading,
// it is scroll-triggered animation and a scroll offset landing on elements
// inside a fixed header. It cannot be waited out.
//
//   THE RULE ADOPTED: NEVER ATTRIBUTE A DIFFERENCE THIS PAGE MAKES ON ITS OWN.
//
// The page is measured TWICE before the edit. The difference between those two
// captures is this page's own noise, per element and per metric, and nothing
// inside that band is ever attributed to the edit. Nothing is hard-coded — not
// "y is unreliable", not a list of animated selectors — because the next donor
// will flap somewhere else. The control measures whatever this page does.
//
// The control capture costs nothing on the clock: it happens BEFORE the edit,
// alongside the planner call, which is slower than both captures put together.
//
// WHAT THIS HONESTLY DOES NOT SOLVE: two captures give one sample of the noise,
// and a page that flaps only occasionally can flap for the first time in the
// after capture. That is why a metric inside the band produces `met: null` and
// a COULD_NOT_LOOK, never a confident pass — an unmeasurable page is reported
// as unmeasurable.

const { splitDeclarations } = require("./edit-verify");

const VERDICTS = {
  AS_ASKED: "CHANGED_AS_ASKED",
  WRONG: "CHANGED_BUT_WRONG",
  NONE: "NO_VISIBLE_CHANGE",
  BLIND: "COULD_NOT_LOOK",
};

// ---------------------------------------------------------------------------
// Thresholds. Every one of these is a claim, so every one of them is named,
// reported in the output, and defensible on its own.
// ---------------------------------------------------------------------------

/** The FLOOR under every threshold, for the case where no control capture was
 *  taken and this page's own noise is therefore unknown. It is a floor, not a
 *  threshold: where a control exists, the measured band raises it. */
const MOVE_PX = 2;
const SIZE_PX = 2;
/** How much room a measured noise band is given beyond what was observed. Two
 *  captures are one sample; a page that drifted 4px once can drift 6px next
 *  time. 1.5x + 1px is slack bought cheaply, and it only ever makes the module
 *  quieter about attributing change, never louder. */
const NOISE_SAFETY = 1.5;
const NOISE_SLACK_PX = 1;
/** Type size is reported to one decimal; half a pixel is below anything a
 *  person can see and above float noise. */
const FONT_PX = 0.5;
/** How far a picture's displayed shape may drift from its own before it is
 *  called distorted. Same 5% page-xray uses, deliberately — one threshold for
 *  one idea, so the two modules can never disagree about a logo. */
const ASPECT_TOLERANCE = 0.05;
/** WCAG AA for body text. Below this, words on a background are hard to read. */
const CONTRAST_FLOOR = 4.5;
/** An element that is not the target moving by more than this is collateral. */
const COLLATERAL_PX = 3;
const MAX_COLLATERAL_REPORTED = 6;
/** A page is a page; a report nobody reads is the same as no report. */
const MAX_WRONG_REPORTED = 8;

const VISION_MODEL = "claude-opus-5";
const VISION_MAX_TOKENS = 400;
const VISION_TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Getting at the two captures
// ---------------------------------------------------------------------------

/** The desktop element list of a page-xray result, whichever shape it arrives in. */
function elementsOf(xr) {
  if (!xr) return [];
  if (Array.isArray(xr.elements)) return xr.elements;
  if (xr.desktop && Array.isArray(xr.desktop.elements)) return xr.desktop.elements;
  return [];
}

/**
 * Both viewports, as comparable units. Mobile is included because the
 * regressions the owner hit are disproportionately mobile ones — a logo that
 * fits a 1280 header and overhangs a 390 screen is the recorded complaint, and
 * a verifier that only ever looks at the desktop capture cannot see it.
 */
function viewsOf(xr) {
  const out = [];
  if (!xr) return out;
  const desktop = xr.desktop || (Array.isArray(xr.elements) ? { label: "1280", elements: xr.elements, defects: xr.defects || [], crops: xr.crops || [] } : null);
  if (desktop) out.push({ label: desktop.label || "1280", elements: desktop.elements || [], defects: desktop.defects || [], crops: desktop.crops || [] });
  if (xr.mobile) out.push({ label: xr.mobile.label || "390", elements: xr.mobile.elements || [], defects: xr.mobile.defects || [], crops: xr.mobile.crops || [] });
  return out;
}

/**
 * matchIn(elements, el) — the same thing, in the other capture.
 *
 * SELECTOR FIRST, AND ALMOST ALWAYS ONLY. lib/page-xray mints selectors that
 * were proven to resolve to exactly one element on a fresh page load (160/160
 * on the live proof), so the selector IS the identity across two captures.
 *
 * `index` is deliberately NOT used. It is an identity within one capture, not
 * an array offset and not stable across a change that reorders the DOM — a
 * swap moves two elements past each other by definition, and matching on
 * document order would report both of them as "gone".
 */
function matchIn(elements, el) {
  if (!el) return null;
  const list = Array.isArray(elements) ? elements : [];
  if (el.selector) {
    const hit = list.find((e) => e.selector === el.selector);
    if (hit) return hit;
  }
  // A selector built out of a utility class can legitimately not survive a
  // rebuild (page-xray marks those selector_stable:false), and only then is a
  // fallback justified.
  //
  // A STABLE SELECTOR THAT NOW MATCHES NOTHING MEANS THE THING IS GONE, and
  // saying so is the point. Falling back unconditionally was worse than
  // useless: the live mirror carries the SAME logo file in the header and in
  // the footer, so deleting the header logo left exactly one element with that
  // src and the fallback confidently returned the FOOTER logo — a different
  // thing, in a different place, which would then have been measured, compared
  // and reported as though the header logo were fine. Caught by the test named
  // "the thing is gone and nobody asked for that".
  if (el.selector_stable !== false) return null;
  if (el.src) {
    const bySrc = list.filter((e) => e.src === el.src && e.tag === el.tag && e.zone === el.zone);
    if (bySrc.length === 1) return bySrc[0];
  }
  if (el.name) {
    const byName = list.filter((e) => e.name === el.name && e.tag === el.tag && e.role === el.role && e.zone === el.zone);
    if (byName.length === 1) return byName[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// measure — one flat, comparable record per element
// ---------------------------------------------------------------------------

function num(v) {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function round(v, dp = 0) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const f = 10 ** dp;
  return Math.round(Number(v) * f) / f;
}

/**
 * Everything about an element that a customer could possibly mean by "it
 * changed", in one flat shape so the diff is a loop rather than a pile of
 * special cases.
 */
function measure(el) {
  if (!el) return null;
  const rect = el.rect || { x: 0, y: 0, w: 0, h: 0 };
  const style = el.style || {};
  const image = el.image || null;
  const overflow = el.overflow || {};
  return {
    selector: el.selector || "",
    name: el.name || el.tag || "",
    tag: el.tag || "",
    // Document coordinates for anything in normal flow; viewport coordinates
    // for a fixed element, which is what page-xray records and the right
    // answer for both — a fixed header does not "move" when the page grows.
    x: round(rect.x, 1),
    y: round(rect.y, 1),
    w: round(rect.w, 1),
    h: round(rect.h, 1),
    right: round(rect.x + rect.w, 1),
    bottom: round(rect.y + rect.h, 1),
    // The raw viewport position, in the single consistent space every element
    // in one capture was measured in. Not comparable across captures on its
    // own — it moves with the scroll — but the difference between two of them
    // is, which is what rel_x/rel_y below are built from.
    view_x: round(el.view && el.view.x, 1),
    view_y: round(el.view && el.view.y, 1),
    // Filled in by compare(), which is the only place with the element list
    // needed to work out what this thing sits inside.
    rel_x: null,
    rel_y: null,
    rel_box: "",
    // What survives every clipping ancestor. When this is smaller than w/h,
    // part of it is not on screen — which is precisely "cut off".
    visible_w: round(el.visible && el.visible.w, 1),
    visible_h: round(el.visible && el.visible.h, 1),
    font_px: round(num(style.fontSize), 1),
    weight: String(style.fontWeight || ""),
    colour: String(style.colorHex || ""),
    background: String(style.backgroundColorHex || ""),
    effective_background: String(style.effectiveBackgroundHex || ""),
    background_image: String(style.backgroundImage || ""),
    contrast: el.contrast === null || el.contrast === undefined ? null : round(el.contrast, 2),
    opacity: round(num(style.opacity), 2),
    display: String(style.display || ""),
    text: String(el.text || "").trim(),
    src: String(el.src || ""),
    href: String(el.href || ""),
    order: el.z && Number.isFinite(el.z.document_order) ? el.z.document_order : null,
    zone: String(el.zone || ""),
    fold: String(el.fold || ""),
    topmost: el.topmost,
    covered_by: String(el.covered_by || ""),
    // Picture geometry — the aspect story, kept whole.
    natural: image && image.natural ? { ...image.natural } : null,
    displayed: image && image.displayed ? { ...image.displayed } : null,
    fit: image ? String(image.fit || "") : "",
    distortion: image && image.distortion !== null && image.distortion !== undefined ? image.distortion : null,
    hidden_fraction: image ? image.hidden_fraction : null,
    overflow_viewport_px: round(overflow.viewport_px, 1) || 0,
    overflow_viewport_side: String(overflow.viewport_side || ""),
    overflow_clipped_px: round(overflow.clipped_px, 1) || 0,
    clipped_by: String(overflow.clipped_by || ""),
  };
}

/**
 * relativeTo(elements, el) -> where this thing sits INSIDE the box around it.
 *
 * WHY OFFSET AND NOT POSITION. `y` is the one metric these mirrors will not
 * hold still on: measured across four captures with no edit, 11 of 137 elements
 * drifted vertically by up to 228px, because page-xray adds the scroll offset
 * to anything not itself `position:fixed` — and the logo inside a fixed header
 * is exactly that. Its offset within the header does not move when the page
 * scrolls, so the offset is the honest measurement of "did it move".
 *
 * Containment is tested in `view` space (raw viewport coordinates), which is
 * the one space in which every element of a single capture was measured at the
 * same instant. Doing it in document space compares a fixed header's viewport
 * rect against its child's scroll-shifted one and finds no parent at all.
 */
function relativeTo(elements, el) {
  if (!el || !el.view) return null;
  const x = el.view.x;
  const y = el.view.y;
  const w = (el.rect && el.rect.w) || 0;
  const h = (el.rect && el.rect.h) || 0;
  let best = null;
  for (const other of elements || []) {
    if (other === el || !other.view || !other.rect) continue;
    if (other.selector && el.selector && other.selector === el.selector) continue;
    const ox = other.view.x;
    const oy = other.view.y;
    const ow = other.rect.w;
    const oh = other.rect.h;
    if (ow * oh <= w * h) continue;
    if (ox > x + 0.5 || oy > y + 0.5 || ox + ow < x + w - 0.5 || oy + oh < y + h - 0.5) continue;
    if (!best || ow * oh < best.rect.w * best.rect.h) best = other;
  }
  if (!best) return null;
  return {
    selector: best.selector || "",
    name: best.name || best.tag || "",
    rel_x: round(x - best.view.x, 1),
    rel_y: round(y - best.view.y, 1),
  };
}

/** Attach the offset, using a box named in the before capture so that both
 *  sides are measured against the same thing. */
function withRelative(m, elements, el, boxSelector = "") {
  if (!m) return m;
  let box = null;
  if (boxSelector) {
    const named = (elements || []).find((e) => e.selector === boxSelector);
    if (named && named.view) {
      box = { selector: named.selector, name: named.name || named.tag, rel_x: round(m.view_x - named.view.x, 1), rel_y: round(m.view_y - named.view.y, 1) };
    }
  }
  if (!box) box = relativeTo(elements, el);
  if (!box) return m;
  m.rel_x = box.rel_x;
  m.rel_y = box.rel_y;
  m.rel_box = box.selector;
  m.rel_box_name = box.name;
  return m;
}

/** The metrics a delta is computed over, and what counts as a real difference. */
const NUMERIC_METRICS = [
  ["x", MOVE_PX, "moved sideways"],
  ["y", MOVE_PX, "moved up or down"],
  ["rel_x", MOVE_PX, "moved sideways inside the box it sits in"],
  ["rel_y", MOVE_PX, "moved up or down inside the box it sits in"],
  ["w", SIZE_PX, "got wider or narrower"],
  ["h", SIZE_PX, "got taller or shorter"],
  ["font_px", FONT_PX, "changed type size"],
  ["visible_w", SIZE_PX, "changed how much of it is on screen"],
  ["visible_h", SIZE_PX, "changed how much of it is on screen"],
];
const STRING_METRICS = [
  ["colour", "changed colour"],
  ["background", "changed background"],
  // What is actually BEHIND the words, which is not the same as the element's
  // own background-color: a heading with a transparent background over a hero
  // photograph has neither its colour nor its background change when the thing
  // behind it does, and readability is decided by exactly that pair.
  ["effective_background", "changed what is behind it"],
  ["text", "changed wording"],
  ["src", "changed picture"],
  ["href", "changed where it links"],
  ["weight", "changed weight"],
  ["display", "changed how it is laid out"],
];

/**
 * deltaOf(before, after, noise) -> every measured difference, with both numbers.
 *
 * This is the evidence for the single most important verdict in the module.
 * An empty list is NOT "we could not tell" — it is a positive measurement that
 * the thing is exactly as it was, and it is the whole basis of
 * NO_VISIBLE_CHANGE.
 *
 * `noise` is the band this page moves on its own (see noiseBandOf). A
 * difference inside the band is recorded with `within_noise:true` and is NOT
 * counted as a difference — the live mirror moves its own logo 228px vertically
 * between two identical captures, and an edit that did nothing must not inherit
 * the credit for that.
 */
function deltaOf(before, after, noise = null) {
  const out = [];
  if (!before || !after) return out;
  const bandFor = (metric) => (noise && noise.band ? noise.band(before.selector, metric) : null);
  for (const [metric, floor, plain] of NUMERIC_METRICS) {
    const a = before[metric];
    const b = after[metric];
    if (a === null || b === null || a === undefined || b === undefined) continue;
    const by = round(b - a, 1);
    const band = bandFor(metric);
    const threshold = band === null ? floor : Math.max(floor, band * NOISE_SAFETY + NOISE_SLACK_PX);
    if (Math.abs(by) >= threshold) out.push({ metric, from: a, to: b, by, plain, threshold: round(threshold, 1) });
    else if (Math.abs(by) >= floor) {
      out.push({ metric, from: a, to: b, by, plain, threshold: round(threshold, 1), within_noise: true });
    }
  }
  for (const [metric, plain] of STRING_METRICS) {
    const a = before[metric];
    const b = after[metric];
    if (!a && !b) continue;
    if (String(a) === String(b)) continue;
    const band = bandFor(metric);
    // For a string metric the band is 1 when the control saw it change on its
    // own, and a metric that changes on its own says nothing about an edit.
    if (band) out.push({ metric, from: a, to: b, plain, within_noise: true });
    else out.push({ metric, from: a, to: b, plain });
  }
  return out;
}

/** The differences that are actually attributable — what "it changed" means. */
function realDelta(delta) {
  return (delta || []).filter((d) => !d.within_noise);
}

// ---------------------------------------------------------------------------
// The control — what this page does when nobody touches it
// ---------------------------------------------------------------------------

const NOISE_METRICS = [
  ...NUMERIC_METRICS.map(([m]) => m),
  ...STRING_METRICS.map(([m]) => m),
  "contrast", "distortion", "opacity",
];

/**
 * WHICH METRICS A PAGE-WIDE BAND APPLIES TO, and why it is these and only these.
 *
 * When these pages misbehave they REFLOW: a paragraph rewraps by one line and
 * every element below it moves down. Measured on the live mirror, one run in
 * three: 11 elements shifting together by 26px with no edit at all.
 *
 * A reflow RELOCATES everything downstream, so a drift seen anywhere on the
 * page is evidence about position everywhere on it — an element that held still
 * during the control has simply not had its turn.
 *
 * A reflow RESIZES only the specific things that rewrap. It cannot change the
 * height of an <img> with a height on it. Applying one paragraph's 26px height
 * drift to the logo made a correct +25px resize unverifiable and produced a
 * COULD_NOT_LOOK on a change that plainly worked — so size, type size and
 * colour keep the per-element band, which for the logo is a measured zero
 * across every capture taken of it.
 *
 * rel_x/rel_y stay per-element on purpose: cancelling the page-level shift is
 * the entire reason they exist, and handing them the page-level band would
 * throw away the one positional measurement that survives a reflow.
 */
const PAGE_WIDE_METRICS = new Set(["x", "y"]);

/**
 * noiseBandOf(a, b) -> this page's own instability, measured.
 *
 * Two captures of the SAME page with NOTHING done between them. Everything
 * that differs, differs for reasons an edit cannot be blamed for.
 *
 * Returns:
 *   band(selector, metric)  the observed drift, or 0 when it held still
 *   flapping                defect keys that appeared in one and not the other
 *   measured                false when no control was taken — the caller is
 *                           told, rather than being allowed to assume a band
 *                           of zero was measured when it was merely absent
 *   summary                 what moved, for the record
 */
function noiseBandOf(a, b) {
  if (!a || !b || a.ok === false || b.ok === false) {
    return { measured: false, band: () => null, flapping: new Set(), summary: { unstable_elements: 0, worst: null, metrics: {} } };
  }
  const bySelector = new Map();
  const metrics = {};
  let worst = null;
  const elsB = elementsOf(b);
  for (const ea of elementsOf(a)) {
    if (!ea.selector) continue;
    const eb = matchIn(elsB, ea);
    const ma = measure(ea);
    if (!eb) {
      // An element that is not in the second capture of an unchanged page is
      // itself instability, and the loudest kind: it must never read as "the
      // edit deleted it".
      bySelector.set(ea.selector, { __missing: true });
      continue;
    }
    const mb = measure(eb);
    const per = {};
    for (const metric of NOISE_METRICS) {
      const va = ma[metric];
      const vb = mb[metric];
      if (va === null || vb === null || va === undefined || vb === undefined) continue;
      if (typeof va === "number" && typeof vb === "number") {
        const drift = Math.abs(vb - va);
        if (drift > 0) {
          per[metric] = round(drift, 1);
          metrics[metric] = Math.max(metrics[metric] || 0, round(drift, 1));
          if (!worst || drift > worst.drift) worst = { name: ma.name, selector: ma.selector, metric, drift: round(drift, 1) };
        }
      } else if (String(va) !== String(vb)) {
        per[metric] = 1;
        metrics[metric] = 1;
      }
    }
    if (Object.keys(per).length) bySelector.set(ea.selector, per);
  }

  const keysA = new Set();
  for (const v of viewsOf(a)) for (const d of v.defects) keysA.add(defectKey(d));
  const keysB = new Set();
  for (const v of viewsOf(b)) for (const d of v.defects) keysB.add(defectKey(d));
  const flapping = new Set();
  for (const k of keysA) if (!keysB.has(k)) flapping.add(k);
  for (const k of keysB) if (!keysA.has(k)) flapping.add(k);
  // A defect KIND that came and went on its own is unreliable on this page for
  // every element, not only the one it happened to land on. Measured: `covered`
  // flaps on one to three elements per control pair on the live mirror and
  // never lands on the same ones twice, because it point-samples what is
  // painted over an element's centre while the page is animating. The first
  // clean live run of this proof was demoted to CHANGED_BUT_WRONG by a
  // `covered` flap on an element the edit never touched. Deriving the kinds
  // from the control beats naming them: the next donor will flap elsewhere.
  const flappyKinds = new Set();
  for (const k of flapping) {
    const kind = String(k).split("|")[1];
    if (kind) flappyKinds.add(kind);
  }

  return {
    measured: true,
    /**
     * THE BAND IS PAGE-WIDE AS WELL AS PER-ELEMENT, and that is the fix for the
     * flakiness two control captures alone could not cure.
     *
     * Measured: with a per-element band only, one run in three came back with a
     * wrong verdict, and a different one each time — because two captures are a
     * single sample and the elements that happen to drift are not the same ones
     * twice. But the CAUSE is not per-element: it is a scroll offset and a page
     * full of scroll-triggered animation, which is a property of the page. So
     * if any element drifted 234px vertically with nothing done to it, this
     * page does not hold `y` still for anything, and an element that held still
     * during the control has simply not had its turn yet.
     *
     * The honest consequence is that `y` becomes unusable for attribution on
     * pages like this one — which is true, and is why rel_y (offset inside the
     * box the element sits in) exists: it cancels the scroll and keeps a real
     * band of its own.
     */
    band(selector, metric) {
      const global = PAGE_WIDE_METRICS.has(metric) ? (metrics[metric] || 0) : 0;
      const per = bySelector.get(selector);
      if (!per) return global;
      if (per.__missing) return Infinity;
      return Math.max(per[metric] || 0, global);
    },
    missing(selector) {
      const per = bySelector.get(selector);
      return Boolean(per && per.__missing);
    },
    flapping,
    flappyKinds,
    summary: {
      unstable_elements: bySelector.size,
      total_elements: elementsOf(a).length,
      worst,
      metrics,
      flapping_defects: flapping.size,
      flappy_kinds: [...flappyKinds],
    },
  };
}

/** The stand-in for "no control was taken". Says so, rather than reporting a
 *  measured band of zero it never measured. */
const NO_NOISE = {
  measured: false,
  band: () => null,
  missing: () => false,
  flapping: new Set(),
  flappyKinds: new Set(),
  summary: { unstable_elements: 0, total_elements: 0, worst: null, metrics: {}, flapping_defects: 0, flappy_kinds: [] },
};

// ---------------------------------------------------------------------------
// What was asked for — expectations, derived from the plan rather than guessed
// ---------------------------------------------------------------------------

/**
 * wantsFromCss("height:144px;width:auto") -> { height: 144, width: null, … }
 *
 * The declared CSS is the only machine-readable statement of intent in the
 * whole pipeline, so where it exists it is the authority. `auto`, `%` and
 * anything else non-pixel deliberately produce NO expectation rather than a
 * guessed one — "the browser works it out" is not a number to check against,
 * and a fabricated target is worse than none.
 *
 * lib/edit-verify's splitDeclarations is reused rather than re-written: one
 * declaration parser means the two verifiers can never disagree about what a
 * plan said.
 */
function wantsFromCss(css) {
  const out = {};
  for (const d of splitDeclarations(css)) {
    const v = String(d.value).trim();
    const px = /^-?\d+(\.\d+)?px$/i.test(v) ? parseFloat(v) : null;
    switch (d.property) {
      case "width": if (px !== null) out.w = px; break;
      case "height": if (px !== null) out.h = px; break;
      case "font-size": if (px !== null) out.font_px = px; break;
      case "color": out.colour_declared = v; break;
      case "background-color": out.background_declared = v; break;
      case "margin-left": if (/auto/i.test(v)) out.push_right = true; break;
      case "margin-right": if (/auto/i.test(v)) out.push_left = true; break;
      default: break;
    }
  }
  // margin-left:auto AND margin-right:auto is centring, not a push either way.
  if (out.push_right && out.push_left) {
    out.centre = true;
    delete out.push_right;
    delete out.push_left;
  }
  return out;
}

/**
 * readRequest(request) -> a normalised statement of what was asked.
 *
 * Accepts a lib/element-resolve Resolution verbatim — the same object that
 * told the caller "I'll make the logo twice as big" is the object checked
 * against, which is the point. Also accepts a plain
 * { verb, selector, css, expect } for callers that never went through resolve.
 */
function readRequest(request) {
  const req = request || {};
  const target = req.target && (req.target.el || req.target);
  const partner = req.partner && (req.partner.el || req.partner);
  const geometry = req.geometry || null;
  const plan = req.plan || null;
  const css = String(req.css || (geometry && geometry.css_hint) || (plan && plan.css_hint) || "");
  return {
    utterance: String(req.utterance || ""),
    verb: String((req.verb && req.verb.kind) || req.verb || "unknown"),
    selector: String(req.selector || (target && target.selector) || ""),
    partnerSelector: String(req.partnerSelector || (partner && partner.selector) || ""),
    target: target || null,
    partner: partner || null,
    geometry,
    plan,
    css,
    expect: req.expect || null,
  };
}

/**
 * expectationsFor(req, before) -> [{ id, what, metric, from, want, … }]
 *
 * WHAT MAKES AN EXPECTATION HONEST: it is derived from a number the planner
 * already committed to out loud, never from re-reading the customer's words
 * here. If the plan did not commit to a number, the expectation is a DIRECTION
 * ("further right than it was"), which is still a measurement and still
 * falsifiable. If it committed to nothing at all, there is no expectation and
 * the module says so instead of inventing a target it can then declare met.
 */
function expectationsFor(request, before) {
  const req = readRequest(request);
  const out = [];
  if (!before) return out;
  const wants = { ...wantsFromCss(req.css), ...(req.expect || {}) };

  const push = (e) => { out.push({ met: null, ...e }); };

  // --- explicit pixel targets, from the declared CSS or the geometry --------
  const g = req.geometry || {};
  const proposed = g.proposed || {};

  const wantW = wants.w !== undefined ? wants.w : (proposed.w !== undefined ? proposed.w : null);
  const wantH = wants.h !== undefined ? wants.h : (proposed.h !== undefined ? proposed.h : null);
  const wantFont = wants.font_px !== undefined ? wants.font_px
    : (proposed.font_px !== undefined ? proposed.font_px : null);

  // `what` IS SPOKEN. It is a bare verb phrase with no numbers in it, because
  // it lands in Riley's mouth as "it didn't ${what}" and the recorded failure
  // on these calls is internal vocabulary reaching a customer. `stated` carries
  // the arithmetic, for the job record and for a developer reading a log.
  if (wantFont !== null) {
    push({
      id: "font_px",
      metric: "font_px",
      what: wantFont > (before.font_px || 0) ? "get any bigger" : "get any smaller",
      stated: `type size ${before.font_px} -> ${wantFont}`,
      from: before.font_px,
      want: wantFont,
      tolerance: Math.max(FONT_PX, wantFont * 0.02),
    });
  }
  if (wantH !== null) {
    push({
      id: "h",
      metric: "h",
      what: wantH > (before.h || 0) ? "get any taller" : "get any shorter",
      stated: `height ${before.h} -> ${wantH}`,
      from: before.h,
      want: wantH,
      // 2% or 2px, whichever is larger: browsers round sub-pixel layout, and a
      // logo asked for 144 that lands on 143.5 did what it was told.
      tolerance: Math.max(SIZE_PX, wantH * 0.02),
    });
  }
  if (wantW !== null) {
    push({
      id: "w",
      metric: "w",
      what: wantW > (before.w || 0) ? "get any wider" : "get any narrower",
      stated: `width ${before.w} -> ${wantW}`,
      from: before.w,
      want: wantW,
      tolerance: Math.max(SIZE_PX, wantW * 0.02),
    });
  }

  // --- directions, when nobody committed to a number -----------------------
  const dir = (req.plan && req.plan.direction) || (wants.push_right && "right") || (wants.push_left && "left") || (wants.centre && "middle") || "";
  if (req.verb === "move" && dir) {
    if (dir === "right" || dir === "left") {
      push({
        id: "moved_sideways",
        metric: "x",
        what: `move over to the ${dir}`,
        stated: `x from ${before.x}, expected to ${dir === "right" ? "increase" : "decrease"}`,
        from: before.x,
        want: { direction: dir === "right" ? "increase" : "decrease" },
        tolerance: MOVE_PX,
      });
    } else if (dir === "top" || dir === "bottom") {
      // A VERTICAL MOVE IS CHECKED AGAINST ITS CONTAINER, NOT THE DOCUMENT.
      // Measured on the live mirror: `y` is the one unstable metric on these
      // pages (11/137 elements, up to 228px, with no edit at all) because a
      // scroll offset lands on elements inside a fixed header. Offset from the
      // box the element sits in cancels that out exactly — the whole header
      // moving does not change where the logo sits inside it.
      push({
        id: "moved_vertically",
        metric: "rel_y",
        what: `move ${dir === "top" ? "up" : "down"}`,
        stated: `offset inside its box from ${before.rel_y}, expected to ${dir === "top" ? "decrease" : "increase"}`,
        from: before.rel_y,
        want: { direction: dir === "top" ? "decrease" : "increase" },
        tolerance: MOVE_PX,
      });
    } else if (dir === "middle") {
      push({
        id: "centred",
        metric: "x",
        what: "move towards the middle",
        stated: `x from ${before.x}`,
        from: before.x,
        want: { direction: "any" },
        tolerance: MOVE_PX,
      });
    }
  }

  // --- a colour, when one was named ----------------------------------------
  if (req.verb === "restyle" || wants.colour_declared || wants.background_declared) {
    const isPicture = Boolean(before.natural) || /^(img|svg|video|picture)$/.test(before.tag);
    push({
      id: "looks_different",
      metric: isPicture ? "any" : "colour",
      what: isPicture ? "look any different" : "change colour",
      stated: isPicture ? "any measurable difference on the picture" : `colour from ${before.colour}`,
      from: isPicture ? null : before.colour,
      want: { direction: "different" },
    });
  }

  // --- words -----------------------------------------------------------------
  if (req.verb === "retext" && req.expect && req.expect.text) {
    push({ id: "text", metric: "text", what: "change what it says", stated: `should read "${req.expect.text}"`, from: before.text, want: req.expect.text });
  }

  // --- a picture swapped out ------------------------------------------------
  if (req.verb === "replace_image") {
    push({ id: "src", metric: "src", what: "swap to the new picture", stated: `src from ${before.src}`, from: before.src, want: { direction: "different" } });
  }

  // --- gone ------------------------------------------------------------------
  if (req.verb === "hide") {
    push({ id: "gone", metric: "present", what: "come off the page", stated: "should not be found after the change", from: true, want: false });
  }

  // --- two things exchanged -------------------------------------------------
  if (req.verb === "swap") {
    push({ id: "swapped", metric: "pair", what: "change places with the other one", stated: "the two should end up on opposite sides of each other", from: null, want: { direction: "exchanged" } });
  }
  if (req.verb === "reorder") {
    const rel = (req.plan && req.plan.relation) || "below";
    push({ id: "reordered", metric: "pair", what: `move ${rel} the other one`, stated: `should end up ${rel} the anchor`, from: null, want: { relation: rel } });
  }

  return out;
}

/**
 * judge(expectations, before, after, ctx) — fill in `got` and `met`.
 *
 * A `met` of null is not a pass. It means the measurement needed was not
 * available, and it is carried through to the verdict as "not proven", never
 * quietly counted as success.
 */
function judge(expectations, before, after, ctx = {}) {
  const partnerBefore = ctx.partnerBefore || null;
  const partnerAfter = ctx.partnerAfter || null;
  const noise = ctx.noise || NO_NOISE;
  for (const e of expectations) {
    // THE BAND COMES FIRST, ALWAYS. A metric this page moves on its own can
    // neither prove nor disprove anything, and saying so is the only honest
    // answer available. Anything else is reading a number off a coin toss.
    const band = noise.band(before && before.selector, e.metric);
    if (band !== null && band !== 0 && Number.isFinite(band)) {
      const need = band * NOISE_SAFETY + NOISE_SLACK_PX;
      const moved = after && typeof after[e.metric] === "number" && typeof e.from === "number"
        ? Math.abs(after[e.metric] - e.from) : null;
      if (moved === null || moved < need) {
        e.got = after ? after[e.metric] : null;
        e.met = null;
        e.unreliable = true;
        e.evidence = `this measurement is not stable on this page — it moved ${band}px on its own between two captures with no change at all, so a ${moved === null ? "difference" : `${round(moved, 1)}px difference`} here proves nothing`;
        continue;
      }
    }
    if (e.metric === "present") {
      const present = Boolean(after);
      e.got = present;
      e.met = present === e.want;
      e.evidence = present ? "still on the page" : "not found on the page any more";
      continue;
    }
    if (!after) { e.got = null; e.met = null; e.evidence = "the thing itself was not found in the second capture"; continue; }

    if (e.metric === "pair") {
      if (!partnerBefore || !partnerAfter) { e.got = null; e.met = null; e.evidence = "the other one was not measured on both sides"; continue; }
      if (e.want && e.want.direction === "exchanged") {
        // They have swapped when each has moved towards where the other was.
        const gapBefore = partnerBefore.x - before.x;
        const gapAfter = partnerAfter.x - after.x;
        const flipped = Math.sign(gapBefore) !== 0 && Math.sign(gapAfter) === -Math.sign(gapBefore);
        e.got = { before_gap: round(gapBefore, 1), after_gap: round(gapAfter, 1) };
        e.met = flipped;
        e.evidence = `it sat ${Math.abs(round(gapBefore, 1))}px to the ${gapBefore > 0 ? "left" : "right"} of the other one and now sits ${Math.abs(round(gapAfter, 1))}px to the ${gapAfter > 0 ? "left" : "right"}`;
      } else {
        const rel = (e.want && e.want.relation) || "below";
        const wasBelow = before.y > partnerBefore.y;
        const isBelow = after.y > partnerAfter.y;
        e.got = { was_below: wasBelow, is_below: isBelow };
        e.met = rel === "below" ? isBelow && !wasBelow : !isBelow && wasBelow;
        e.evidence = `it was ${wasBelow ? "below" : "above"} the other one and is now ${isBelow ? "below" : "above"} it`;
      }
      continue;
    }

    if (e.metric === "any") {
      const d = realDelta(deltaOf(before, after, noise));
      e.got = d.length;
      e.met = d.length > 0;
      e.evidence = d.length ? d.map((x) => `${x.metric} ${x.from} -> ${x.to}`).join(", ") : "every measurement is identical";
      continue;
    }

    const got = after[e.metric];
    e.got = got;

    if (e.want && typeof e.want === "object" && e.want.direction) {
      const from = e.from;
      if (e.want.direction === "different") {
        e.met = String(got) !== String(from);
        e.evidence = `${from || "(none)"} -> ${got || "(none)"}`;
      } else if (from === null || got === null) {
        e.met = null;
        e.evidence = "not measured on both sides";
      } else {
        const by = round(got - from, 1);
        const enough = Math.abs(by) >= (e.tolerance || MOVE_PX);
        e.met = e.want.direction === "any" ? enough
          : e.want.direction === "increase" ? (enough && by > 0)
            : (enough && by < 0);
        e.evidence = `${from} -> ${got} (${by > 0 ? "+" : ""}${by}px)`;
      }
      continue;
    }

    if (typeof e.want === "number") {
      if (got === null || got === undefined) { e.met = null; e.evidence = "not measured after the change"; continue; }
      const off = round(got - e.want, 1);
      e.met = Math.abs(got - e.want) <= (e.tolerance || SIZE_PX);
      e.evidence = `asked for ${e.want}, measured ${got}${off ? ` (${off > 0 ? "+" : ""}${off})` : " (exact)"}`;
      continue;
    }

    // A literal string target, e.g. new wording.
    e.met = String(got).trim() === String(e.want).trim();
    e.evidence = `reads "${String(got).slice(0, 60)}"`;
  }
  return expectations;
}

// ---------------------------------------------------------------------------
// The regressions the owner actually hit
// ---------------------------------------------------------------------------

/** Key a page-xray defect so the same defect on both sides cancels out. */
function defectKey(d) {
  return `${d.at}|${d.kind}|${d.selector || d.name}`;
}

/**
 * newDefects(before, after) — defects the change INTRODUCED.
 *
 * Diffing rather than listing is what makes this usable. The live mirror
 * carries pre-existing defects (a manufacturer badge with no natural size, a
 * marquee overhanging its own track); reporting those against an edit that did
 * not cause them is how a report becomes noise, and a report nobody reads is
 * the same defect as a verifier that lies.
 */
function newDefects(beforeXr, afterXr, noise = NO_NOISE) {
  const was = new Set();
  for (const v of viewsOf(beforeXr)) for (const d of v.defects) was.add(defectKey(d));
  const out = [];
  for (const v of viewsOf(afterXr)) {
    for (const d of v.defects) {
      const key = defectKey(d);
      if (was.has(key)) continue;
      // A defect that came and went between two captures of the UNCHANGED page
      // is not something this edit did. Measured: `covered` flaps on one to two
      // elements per capture pair on the live mirror, because it point-samples
      // what is painted over an element's centre and these pages animate.
      if (noise.flapping && noise.flapping.has(key)) continue;
      // Not dropped — a kind this page proved it can produce unprompted is
      // still worth recording, it just cannot be the reason a customer's change
      // is rolled back.
      let unreliable = Boolean(noise.flappyKinds && noise.flappyKinds.has(d.kind));

      // AND THE CAUSAL TEST, which is stronger than any noise sample. If the
      // element this defect is about did not change in a single measured way,
      // the edit cannot have caused the defect. A `covered` finding on a
      // headline that is the same size, in the same place, in the same colour
      // as it was before a logo resize is something the page did, and charging
      // it to the edit rolls back a customer's correct change for a fault that
      // was never theirs. This is what the first stable-looking run of the live
      // proof got wrong, twice, in different places.
      if (!unreliable && d.selector) {
        const wasEl = elementsOf(beforeXr).find((e) => e.selector === d.selector);
        const isEl = wasEl ? matchIn(elementsOf(afterXr), wasEl) : null;
        if (wasEl && isEl && realDelta(deltaOf(measure(wasEl), measure(isEl), noise)).length === 0) {
          unreliable = true;
        }
      }
      out.push({ ...d, ...(unreliable ? { unreliable: true } : {}) });
    }
  }
  return out;
}

/**
 * regressionsFor(before, after) — the four classes, measured on the target.
 *
 * Named after the complaints, not after the CSS: "stretched", "cut off",
 * "sticking out", "hard to read". Each one carries the pair of numbers.
 */
/**
 * A page-xray defect kind, said the way the person on the phone would say it.
 *
 * The first live run had Riley reading out "main headline on the 390 view:
 * covered". That is the recorded failure mode of this whole system — internal
 * vocabulary escaping onto a call — arriving through a channel nobody thought
 * to check, because the string came from another module's defect list rather
 * than from a sentence anyone wrote for a customer.
 */
function plainDefect(d) {
  const name = d.name || "it";
  const where = d.at === "390" ? " on phones" : d.at === "1280" ? " on a computer screen" : "";
  switch (d.kind) {
    case "stretched": return `the ${name} has come out of shape${where}`;
    case "cropped": return `part of the ${name} is being cut off${where}`;
    case "upscaled": return `the ${name} is being blown up bigger than the picture it is made from, so it will look soft`;
    case "overhangs_viewport": return `the ${name} is hanging off the edge of the screen${where}`;
    case "clipped_by_parent": return `part of the ${name} is outside the box it sits in${where}, so you cannot see all of it`;
    case "covered": return `something else is sitting on top of the ${name}${where}`;
    default: return `there is a problem with the ${name}${where}`;
  }
}

function regressionsFor(before, after, noise = NO_NOISE) {
  const out = [];
  if (!before || !after) return out;

  // 1. THE LOGO IS STRETCHED. A picture whose displayed shape no longer
  //    matches its own. Compared against BEFORE, so a donor that always drew
  //    it slightly off is not blamed on this edit.
  const wasOff = before.distortion === null ? 0 : Math.abs(before.distortion - 1);
  const isOff = after.distortion === null ? 0 : Math.abs(after.distortion - 1);
  if (after.distortion !== null && isOff > ASPECT_TOLERANCE && isOff > wasOff + 0.01) {
    const pct = Math.round(isOff * 100);
    out.push({
      kind: "stretched",
      blocking: true,
      plain: `it has come out ${after.distortion > 1 ? "stretched wide" : "squashed"} — ${pct}% out of shape`,
      detail: `displayed ${after.displayed ? `${after.displayed.w}x${after.displayed.h}` : `${after.w}x${after.h}`}`
        + `${after.natural ? ` against a picture that is ${after.natural.w}x${after.natural.h}` : ""}`
        + ` with object-fit:${after.fit || "fill"} — shape ratio ${before.distortion === null ? "(not measured before)" : before.distortion} -> ${after.distortion}`,
    });
  }

  // 2. IT IS CUT OFF. More of it outside its own box than there was.
  // EVERY `plain` BELOW IS SPOKEN, so none of them carries a pixel count. The
  // numbers are all in `detail`, which goes on the record. Riley reading "it
  // now sticks 60px off the right of the screen" to a plumber is the same
  // defect as "I need to know the specific element that represents your logo".
  if (after.overflow_clipped_px > before.overflow_clipped_px + 1) {
    out.push({
      kind: "cut_off",
      blocking: true,
      plain: `part of it is now outside the box it sits in, so you cannot see all of it`,
      detail: `${Math.round(after.overflow_clipped_px)}px clipped by ${after.clipped_by || "its parent"}: ${before.overflow_clipped_px}px -> ${after.overflow_clipped_px}px`,
    });
  }

  // 3. IT IS STICKING OFF THE SCREEN.
  if (after.overflow_viewport_px > before.overflow_viewport_px + 1) {
    out.push({
      kind: "off_screen",
      blocking: true,
      plain: `it now hangs off the ${after.overflow_viewport_side || "right"}-hand edge of the screen`,
      detail: `overhang ${before.overflow_viewport_px}px -> ${after.overflow_viewport_px}px`,
    });
  }

  // 4. YOU CANNOT READ IT ANY MORE.
  if (before.contrast !== null && after.contrast !== null
    && before.contrast >= CONTRAST_FLOOR && after.contrast < CONTRAST_FLOOR) {
    out.push({
      kind: "hard_to_read",
      blocking: true,
      plain: `the words are hard to read against what is behind them now`,
      detail: `contrast ${before.contrast}:1 -> ${after.contrast}:1 against ${after.effective_background || "its background"} (${CONTRAST_FLOOR}:1 is the readable floor)`,
    });
  }

  // 5. SOMETHING IS SITTING ON TOP OF IT. The recorded live finding on this
  //    very mirror was our own sign-up panel painted over the client's logo.
  if (before.topmost !== false && after.topmost === false) {
    const unreliable = Boolean(noise.flappyKinds && noise.flappyKinds.has("covered"));
    out.push({
      kind: "covered",
      blocking: !unreliable,
      plain: `something else is now sitting on top of the ${before.name || "it"}`,
      detail: `covered by ${after.covered_by || "another element"}`
        + (unreliable ? " — NOTE: this page produced covered findings on its own between two captures with no change at all, so it is recorded, not charged to this edit" : ""),
    });
  }

  // 6. IT IS BIGGER THAN THE PICTURE IT IS MADE OF. Not blocking — soft is a
  //    judgement, not a break — but it is exactly what "the graphic is too big
  //    for the box it was given" turns into when the box wins.
  if (after.natural && after.natural.w && after.w > after.natural.w * 1.5
    && !(before.natural && before.w > before.natural.w * 1.5)) {
    out.push({
      kind: "soft",
      blocking: false,
      plain: `it is being blown up bigger than the picture it is made from, so it will look a bit soft`,
      detail: `${Math.round(after.w)}px wide from ${after.natural.w}px of picture (${round(after.w / after.natural.w, 1)}x)`,
    });
  }

  return out;
}

/**
 * collateralMoves(beforeXr, afterXr, target) — what else moved.
 *
 * SURPRISE IS THE THING BEING MEASURED, NOT MOVEMENT. Making a logo taller
 * pushes everything below it down; that is what layout is, and reporting fifty
 * elements as damage would bury the one that matters. So movement is graded by
 * whether flow can explain it:
 *
 *   · an element that sat BEFORE the target in document order, and is not an
 *     ancestor of it, has no business moving. That is `surprising`, and it is
 *     what "something else moved that should not have" means.
 *   · everything after it moving is `expected`, counted and reported, never
 *     treated as a defect on its own.
 */
function collateralMoves(beforeXr, afterXr, target, noise = NO_NOISE) {
  const beforeEls = elementsOf(beforeXr);
  const afterEls = elementsOf(afterXr);
  const targetOrder = target && target.order !== null ? target.order : Infinity;
  const targetSelector = (target && target.selector) || "";

  const moved = [];
  for (const b of beforeEls) {
    if (!b.selector || b.selector === targetSelector) continue;
    if (!b.name) continue; // anonymous structural boxes are not what a person means by "something else"
    const a = matchIn(afterEls, b);
    if (!a) continue;
    const mb = measure(b);
    const ma = measure(a);
    const dx = round(ma.x - mb.x, 1);
    const dy = round(ma.y - mb.y, 1);
    // The floor for THIS element, not a global one. The live mirror moves its
    // own call button 4-23px between two identical captures; reporting that as
    // damage done by an edit is how the first live run of this module accused a
    // correct resize of touching a button it never went near.
    const bandX = noise.band(b.selector, "x");
    const bandY = noise.band(b.selector, "y");
    if (bandX === Infinity || bandY === Infinity) continue; // it flaps in and out on its own
    const floorX = bandX === null ? COLLATERAL_PX : Math.max(COLLATERAL_PX, bandX * NOISE_SAFETY + NOISE_SLACK_PX);
    const floorY = bandY === null ? COLLATERAL_PX : Math.max(COLLATERAL_PX, bandY * NOISE_SAFETY + NOISE_SLACK_PX);
    if (Math.abs(dx) < floorX && Math.abs(dy) < floorY) continue;
    // An ancestor growing around the target is the target's own change seen
    // from outside, not a second event.
    const encloses = mb.x <= (target ? target.x : 0) && mb.y <= (target ? target.y : 0)
      && mb.right >= (target ? target.right : 0) && mb.bottom >= (target ? target.bottom : 0);
    const order = mb.order === null ? Infinity : mb.order;
    const surprising = order < targetOrder && !encloses;
    moved.push({
      name: mb.name,
      selector: mb.selector,
      dx,
      dy,
      surprising,
      encloses,
      plain: `${mb.name} moved ${Math.abs(dx) >= COLLATERAL_PX ? `${Math.abs(dx)}px ${dx > 0 ? "right" : "left"}` : ""}${Math.abs(dx) >= COLLATERAL_PX && Math.abs(dy) >= COLLATERAL_PX ? " and " : ""}${Math.abs(dy) >= COLLATERAL_PX ? `${Math.abs(dy)}px ${dy > 0 ? "down" : "up"}` : ""}`,
    });
  }
  moved.sort((a, b) => (Number(b.surprising) - Number(a.surprising)) || (Math.abs(b.dx) + Math.abs(b.dy)) - (Math.abs(a.dx) + Math.abs(a.dy)));
  return {
    total: moved.length,
    surprising: moved.filter((m) => m.surprising).length,
    worst: moved.slice(0, MAX_COLLATERAL_REPORTED),
  };
}

// ---------------------------------------------------------------------------
// compare — the whole judgement, pure, no browser
// ---------------------------------------------------------------------------

/**
 * compare(beforeXr, afterXr, request, options) -> report
 *
 * Pure. Two page-xray results and a statement of what was asked, in; a verdict
 * with its measurements, out. Every rule in this module is testable through
 * this function without launching anything.
 *
 * options.markerPresent  false means the page is serving bytes that predate
 *                        the edit — see the header. null/undefined means
 *                        nobody checked, and it is not held against the page.
 */
function compare(beforeXr, afterXr, request, options = {}) {
  const req = readRequest(request);
  const t = { verdict: VERDICTS.BLIND, reason: "", utterance: req.utterance, verb: req.verb, selector: req.selector };

  const beforeOk = beforeXr && beforeXr.ok !== false && elementsOf(beforeXr).length > 0;
  const afterOk = afterXr && afterXr.ok !== false && elementsOf(afterXr).length > 0;
  if (!beforeOk || !afterOk) {
    return {
      ...t,
      reason: !beforeOk
        ? `no_before_capture${beforeXr && beforeXr.reason ? `:${beforeXr.reason}` : ""}`
        : `no_after_capture${afterXr && afterXr.reason ? `:${afterXr.reason}` : ""}`,
      before: null, after: null, delta: [], expectations: [], wrong: [], collateral: null, newDefects: [],
    };
  }

  // THE STALE-EDGE TRAP. An unchanged page is a true measurement and a false
  // conclusion when the page being measured is the old one.
  if (options.markerPresent === false) {
    return {
      ...t,
      reason: "page_still_serving_old_bytes",
      before: null, after: null, delta: [], expectations: [], wrong: [], collateral: null, newDefects: [],
    };
  }

  const beforeEls = elementsOf(beforeXr);
  const afterEls = elementsOf(afterXr);

  // THE CONTROL. Two captures of the page with nothing done between them; the
  // difference is what this page does on its own and is never charged to the
  // edit. When there is no control, the band is not zero — it is UNKNOWN, and
  // that is what NO_NOISE reports.
  const noise = options.control ? noiseBandOf(beforeXr, options.control) : NO_NOISE;

  const beforeEl = req.target
    ? (matchIn(beforeEls, req.target) || req.target)
    : beforeEls.find((e) => e.selector === req.selector) || null;
  if (!beforeEl) {
    return {
      ...t,
      reason: `target_not_in_before_capture:${req.selector || "(no selector)"}`,
      before: null, after: null, delta: [], expectations: [], wrong: [], collateral: null, newDefects: [],
    };
  }
  const afterEl = matchIn(afterEls, beforeEl);

  const before = withRelative(measure(beforeEl), beforeEls, beforeEl);
  const after = withRelative(measure(afterEl), afterEls, afterEl, before.rel_box);
  const delta = deltaOf(before, after, noise);

  const partnerBeforeEl = req.partner ? (matchIn(beforeEls, req.partner) || req.partner) : null;
  const partnerAfterEl = partnerBeforeEl ? matchIn(afterEls, partnerBeforeEl) : null;
  const partnerBefore = withRelative(measure(partnerBeforeEl), beforeEls, partnerBeforeEl);
  const partnerAfter = partnerBefore ? withRelative(measure(partnerAfterEl), afterEls, partnerAfterEl, partnerBefore.rel_box) : null;
  const partnerDelta = deltaOf(partnerBefore, partnerAfter, noise);

  const expectations = judge(expectationsFor(request, before), before, after, { partnerBefore, partnerAfter, noise });
  const regressions = regressionsFor(before, after, noise);
  const introduced = newDefects(beforeXr, afterXr, noise);
  const collateral = collateralMoves(beforeXr, afterXr, before, noise);

  const report = {
    ...t,
    before,
    after,
    partner: partnerBefore ? { before: partnerBefore, after: partnerAfter, delta: partnerDelta } : null,
    delta,
    expectations,
    regressions,
    newDefects: introduced,
    collateral,
    noise: noise.summary ? { measured: noise.measured, ...noise.summary } : { measured: false },
    wrong: [],
    thresholds: { MOVE_PX, SIZE_PX, FONT_PX, ASPECT_TOLERANCE, CONTRAST_FLOOR, COLLATERAL_PX, NOISE_SAFETY },
  };

  // -------------------------------------------------------------------------
  // The verdict. Order matters, and this order is the argument.
  // -------------------------------------------------------------------------

  // 1. It is not on the page at all any more, and nobody asked for that.
  if (!afterEl && req.verb !== "hide") {
    report.verdict = VERDICTS.WRONG;
    report.reason = "target_gone";
    report.wrong = [{
      kind: "gone",
      blocking: true,
      plain: `${before.name} is not on the page any more`,
      detail: `${before.selector} matched one element before the change and none after it`,
    }];
    return report;
  }

  // 2. NOTHING MOVED. The measurement that the current system cannot make and
  //    therefore cannot report. Note it is decided on the DELTA, before any
  //    expectation is consulted: an expectation can be trivially "met" by a
  //    page that was already in the asked-for state, and telling someone their
  //    change is live because it was already true is the same lie in a nicer
  //    hat.
  const attributable = realDelta(delta);
  const partnerAttributable = realDelta(partnerDelta);
  const nothingMoved = attributable.length === 0 && partnerAttributable.length === 0;

  // 2a. THE PAGE WOULD NOT HOLD STILL LONG ENOUGH TO BE MEASURED. If the only
  //     measurement an expectation rests on is one this page moves on its own,
  //     there is no answer to give — and "no answer" is a real answer that this
  //     system already knows how to handle. It must not be dressed up as either
  //     a pass or a no-op. Note this is checked BEFORE the no-change branch:
  //     a page whose target metric is pure noise cannot support the claim that
  //     nothing happened either.
  const unreliableBlocking = expectations.filter((e) => e.unreliable);
  if (expectations.length && unreliableBlocking.length === expectations.length) {
    report.verdict = VERDICTS.BLIND;
    report.reason = "page_not_stable_enough_to_measure";
    report.wrong = [{
      kind: "unmeasurable",
      blocking: true,
      plain: `${before.name} does not hold still on this page long enough to measure`,
      detail: unreliableBlocking.map((e) => e.evidence).join("; "),
    }];
    return report;
  }

  if (nothingMoved) {
    const alreadyThere = expectations.filter((e) => e.met === true);
    report.verdict = VERDICTS.NONE;
    report.reason = alreadyThere.length ? "already_looked_like_that" : "no_measured_difference";
    report.wrong = [{
      kind: "no_change",
      blocking: true,
      plain: alreadyThere.length
        ? `${before.name} already looked like that before the change — nothing on the page is different`
        : `${before.name} is exactly as it was`,
      detail: `every measured property is identical: ${before.w}x${before.h} at ${before.x},${before.y}`
        + `${before.font_px ? `, ${before.font_px}px type` : ""}${before.colour ? `, ${before.colour}` : ""}`,
    }];
    // Something else on the page moving while the target did not is a
    // different and worse story than a no-op, and it gets said out loud.
    if (collateral.total > 0) {
      // Recorded, NOT blocking, and the verdict stays NO_VISIBLE_CHANGE. See
      // the collateral note below: these pages move things on their own, and
      // the sentence a customer needs to hear — "the bit you asked about has
      // not changed" — is true either way.
      report.wrong.push({
        kind: "other_things_moved",
        blocking: false,
        plain: `the part you asked about did not change, though ${collateral.total} other thing${collateral.total === 1 ? "" : "s"} on the page sat differently`,
        detail: `${collateral.worst.map((m) => m.plain).join("; ")} — this page reflows on its own, so this is recorded rather than charged to the edit`,
      });
    }
    return report;
  }

  // 3. Something changed. Was it what was asked for?
  const failed = expectations.filter((e) => e.met === false);
  const unproven = expectations.filter((e) => e.met === null);
  const wrong = [];

  for (const e of failed) {
    wrong.push({
      kind: "not_what_was_asked",
      blocking: true,
      // `what` is a bare verb phrase and carries no numbers — this sentence
      // ends up in Riley's mouth. The arithmetic lives in `detail`.
      plain: `it didn't ${e.what}`,
      detail: `${e.stated ? `${e.stated} — ` : ""}${e.evidence}`,
    });
  }
  for (const r of regressions) wrong.push(r);
  for (const d of introduced.slice(0, 4)) {
    wrong.push({
      kind: `new_${d.kind}`,
      // `upscaled` is softness, a judgement, not a break. `unreliable` is a
      // kind the control caught this page producing on its own.
      blocking: d.kind !== "upscaled" && !d.unreliable,
      plain: plainDefect(d),
      detail: `${d.detail}${d.unreliable ? " — NOTE: this page produced this same kind of finding on its own between two captures with no change at all, so it is recorded, not charged to this edit" : ""}`,
    });
  }
  // COLLATERAL IS EVIDENCE, NEVER A ROLLBACK TRIGGER, and that is a measured
  // decision rather than a cautious one.
  //
  // "Something else moved that should not have" is a real complaint and this
  // measures it. But on these mirrors the page moves things by itself: one
  // control run in three showed 11 elements shifting together by 26px with
  // nothing done to them, because a paragraph rewrapped. Blocking on collateral
  // meant rolling back a customer's correct logo resize because a headline
  // three screens below it had moved on its own — which is a worse failure than
  // the one it was guarding against, and it is the failure this system already
  // has a reputation for.
  //
  // The genuinely damaging cases do not rely on this signal: something knocked
  // off the screen, out of its box, or under another element arrives as a new
  // DEFECT, which is blocking and is causally filtered against the element's
  // own measurements.
  if (collateral.surprising > 0) {
    wrong.push({
      kind: "other_things_moved",
      blocking: false,
      plain: `${collateral.surprising} thing${collateral.surprising === 1 ? "" : "s"} further up the page also sat differently`,
      detail: `${collateral.worst.filter((m) => m.surprising).map((m) => m.plain).join("; ")} — recorded, not charged to this edit: this page reflows on its own`,
    });
  }

  report.wrong = wrong.slice(0, MAX_WRONG_REPORTED);

  if (wrong.some((w) => w.blocking)) {
    report.verdict = VERDICTS.WRONG;
    report.reason = wrong.find((w) => w.blocking).kind;
    return report;
  }

  // 4. Nothing was asked for that could be checked. Changed, but we cannot say
  //    it changed AS ASKED — and we will not say it.
  if (expectations.length === 0 || (expectations.every((e) => e.met !== true) && unproven.length)) {
    // Unproven because the PAGE would not hold still is a different fact from
    // unproven because nobody stated a checkable target, and they get different
    // endings: the first is COULD_NOT_LOOK (nothing is wrong, we simply cannot
    // see), the second is CHANGED_BUT_WRONG (something happened and no part of
    // it can be tied to the request).
    if (unproven.length && unproven.every((e) => e.unreliable)) {
      report.verdict = VERDICTS.BLIND;
      report.reason = "page_not_stable_enough_to_measure";
      report.wrong = [{
        kind: "unmeasurable",
        blocking: true,
        plain: `${before.name} does not hold still on this page long enough to measure`,
        detail: unproven.map((e) => e.evidence).join("; "),
      }];
      return report;
    }
    report.verdict = VERDICTS.WRONG;
    report.reason = "change_not_verifiable";
    report.wrong = [{
      kind: "not_verifiable",
      blocking: true,
      plain: "the page did change, but not in the way you asked for",
      detail: expectations.length
        ? expectations.map((e) => `${e.stated || e.what}: ${e.evidence || "not measured"}`).join("; ")
        : `no measurable target was stated for a ${req.verb}`,
    }];
    return report;
  }

  report.verdict = VERDICTS.AS_ASKED;
  report.reason = "measured";
  return report;
}

// ---------------------------------------------------------------------------
// Vision — asked second, and only ever allowed to make the verdict worse
// ---------------------------------------------------------------------------

function visionPrompt(report) {
  const b = report.before || {};
  const a = report.after || {};
  return `A business owner asked for one change to their own website${report.utterance ? `. They said: "${report.utterance}"` : ""}.

Image 1 is ${b.name || "the part of the page"} BEFORE the change, ${Math.round(b.w || 0)} by ${Math.round(b.h || 0)} pixels.
Image 2 is the same thing AFTER, ${Math.round(a.w || 0)} by ${Math.round(a.h || 0)} pixels.

Do not judge whether the change is what they asked for — that has already been measured. Judge only whether the RESULT looks acceptable on a real website.

Answer with JSON only, no other text and no XML tags of any kind:
{"looks_right": true | false, "problems": ["<short plain phrase>", …], "because": "<one short sentence in plain words a non-designer would use>"}

Use problems only for things you can actually see in image 2: squashed or stretched out of shape, cut off at an edge, overlapping something else, text too small or too faint to read, badly misaligned. An empty list with looks_right true is the right answer for a result that is simply fine. If image 2 is too small or unclear to judge, say looks_right true and leave problems empty — guessing at a fault costs this business owner their change.`;
}

function readVisionAnswer(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return {
      looks_right: parsed.looks_right !== false,
      problems: Array.isArray(parsed.problems) ? parsed.problems.map((p) => String(p).slice(0, 80)).slice(0, 4) : [],
      because: String(parsed.because || "").slice(0, 160),
    };
  } catch {
    return null;
  }
}

/** Same shape and same reasoning as lib/element-resolve's caller: raw fetch,
 *  injectable, thinking off because someone is on the phone. */
async function defaultVision({ prompt, images, timeoutMs = VISION_TIMEOUT_MS, fetchImpl = fetch, model = VISION_MODEL }) {
  const key = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) return { ok: false, reason: "anthropic_key_unset" };

  const content = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.media_type || "image/jpeg", data: img.base64 },
  }));
  content.push({ type: "text", text: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: VISION_MAX_TOKENS,
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        messages: [{ role: "user", content }],
      }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, reason: `anthropic_${(json && json.error && json.error.type) || res.status}` };
    const usage = json.usage || {};
    return {
      ok: true,
      text: (json.content || []).map((c) => c.text || "").join(""),
      model,
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
      },
    };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "vision_timeout" : `vision_unreachable:${String((e && e.message) || e).slice(0, 60)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * applyVision(report, answer) — fold a vision answer into a measured report.
 *
 * THE ASYMMETRY IS THE POINT, and it is enforced here rather than trusted to
 * the caller: a problem it names is added to `wrong` and can demote
 * CHANGED_AS_ASKED to CHANGED_BUT_WRONG. Nothing it says can promote a verdict,
 * and nothing it says can touch NO_VISIBLE_CHANGE, which is arithmetic.
 */
function applyVision(report, answer) {
  if (!report || !answer) return report;
  report.vision = answer;
  if (report.verdict !== VERDICTS.AS_ASKED) return report;
  const problems = (answer.problems || []).filter(Boolean);
  if (answer.looks_right !== false && !problems.length) return report;
  report.verdict = VERDICTS.WRONG;
  report.reason = "looks_wrong";
  report.wrong = [
    ...report.wrong,
    {
      kind: "looks_wrong",
      blocking: true,
      from: "vision",
      plain: problems.length ? problems.join("; ") : (answer.because || "it does not look right on the page"),
      detail: `judged by eye on the before/after crops${answer.because ? `: ${answer.because}` : ""} — measurements all passed, so this is an appearance problem rather than a wrong measurement`,
    },
  ];
  return report;
}

// ---------------------------------------------------------------------------
// What Riley says
// ---------------------------------------------------------------------------

/**
 * sayForVerdict(report, opts) -> the sentence, verbatim.
 *
 * NO JARGON REACHES A PHONE CALL. The recorded failure — "I need to know the
 * specific element that represents your logo" — is what happens when internal
 * vocabulary escapes. Everything below names things the way the person on the
 * phone named them.
 *
 * "That's live, go ahead and hit refresh" appears exactly once in this file and
 * is reachable from exactly one verdict.
 */
function sayForVerdict(report, { canUndo = true, undone = null } = {}) {
  const r = report || {};
  const thing = (r.before && r.before.name) ? `the ${r.before.name}` : "it";
  const worst = (r.wrong || []).find((w) => w.blocking) || (r.wrong || [])[0] || null;

  if (r.verdict === VERDICTS.AS_ASKED) {
    return "That's done — it's live on your site now. Go ahead and hit refresh, you'll see it.";
  }

  if (r.verdict === VERDICTS.NONE) {
    // The caller is looking at the page. Anything other than saying so plainly
    // is a sentence they can immediately disprove.
    if (r.reason === "already_looked_like_that") {
      return `I've had a proper look at your page and ${thing} was already like that — so nothing's actually different. Tell me what you're seeing and I'll get it right.`;
    }
    return `I put that through, but I've looked at your live page and ${thing} hasn't actually changed — it's exactly as it was. I'm not going to tell you it's done when you're looking straight at it. Let me get someone on our team onto it.`;
  }

  if (r.verdict === VERDICTS.BLIND) {
    if (r.reason === "page_still_serving_old_bytes") {
      return "That's gone out, but your page is still showing me the old version, so I can't confirm it yet. Give it a couple of minutes and refresh — if it's still not there, ring me back and I'll chase it.";
    }
    return "That's gone out, but I couldn't get onto your page to check it actually shows — so I won't call it done. Someone on our team is looking now.";
  }

  // CHANGED_BUT_WRONG
  const problem = worst ? worst.plain : "it hasn't come out right";
  if (undone === true) {
    return `I got that on there, but ${problem} — so I've put it straight back the way it was. Nothing's changed on your site. Do you want me to try it a different way?`;
  }
  if (undone === false) {
    return `I got that on there, but ${problem} — and putting it back didn't go through either. I'm not going to guess at where your site stands. Someone on our team is on it right now.`;
  }
  if (canUndo) {
    return `I've got that on there, but ${problem}. Do you want me to put it straight back the way it was?`;
  }
  return `I've got that on there, but ${problem}. I'll get someone on our team to sort it properly.`;
}

/** The one-line version for a job row, a log, or the dashboard. */
function summarize(report) {
  const r = report || {};
  return {
    verdict: r.verdict || VERDICTS.BLIND,
    reason: r.reason || "",
    ok: r.verdict === VERDICTS.AS_ASKED,
    changed: Boolean(r.delta && r.delta.length),
    // The pair of measurements, so a row in a table carries its own evidence.
    measured: r.before && r.after
      ? {
        before: `${r.before.w}x${r.before.h} at ${r.before.x},${r.before.y}${r.before.font_px ? ` ${r.before.font_px}px` : ""}${r.before.colour ? ` ${r.before.colour}` : ""}`,
        after: `${r.after.w}x${r.after.h} at ${r.after.x},${r.after.y}${r.after.font_px ? ` ${r.after.font_px}px` : ""}${r.after.colour ? ` ${r.after.colour}` : ""}`,
      }
      : null,
    wrong: (r.wrong || []).map((w) => ({ kind: w.kind, plain: w.plain, detail: w.detail })),
    say: sayForVerdict(r),
  };
}

// ---------------------------------------------------------------------------
// The live side — capture, crop, and the whole thing end to end
// ---------------------------------------------------------------------------

/**
 * cropElements(url, selectors, opts) -> [{ selector, buffer, bytes, sha256 }]
 *
 * WHY THIS EXISTS SEPARATELY FROM page-xray's crops. page-xray photographs the
 * highest-priority elements up to a budget; the thing a customer just asked
 * about may not be among them. A before/after pair is worthless if the BEFORE
 * picture was never taken — and once the deploy has happened it can never be
 * taken again. So the capture that matters is requested by name.
 */
async function cropElements(url, selectors, {
  browser = null,
  width = 1280,
  height = 900,
  timeoutMs = 20_000,
  settleMs = 400,
  imageType = "jpeg",
  imageQuality = 80,
  launch = null,
} = {}) {
  const wanted = (Array.isArray(selectors) ? selectors : [selectors]).filter(Boolean);
  if (!wanted.length) return [];
  const crypto = require("crypto");
  let own = null;
  let br = browser;
  try {
    if (!br) {
      const launcher = launch || (() => require("./serverless-chromium").launchChromium());
      own = await launcher();
      br = own;
    }
    const page = await br.newPage({ viewport: { width, height } });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(settleMs);
      const out = [];
      for (const selector of wanted) {
        try {
          const buffer = await page.locator(selector).first().screenshot({
            type: imageType,
            ...(imageType === "jpeg" ? { quality: imageQuality } : {}),
            animations: "disabled",
            timeout: 5000,
          });
          out.push({
            selector,
            buffer,
            bytes: buffer.length,
            sha256: crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16),
            type: imageType,
          });
        } catch (e) {
          // Recorded, never dropped: a selector chromium cannot photograph is
          // evidence about the selector.
          out.push({ selector, error: String((e && e.message) || e).slice(0, 120) });
        }
      }
      return out;
    } finally {
      await page.close().catch(() => {});
    }
  } catch (e) {
    return wanted.map((selector) => ({ selector, error: String((e && e.message) || e).slice(0, 120) }));
  } finally {
    if (own) await own.close().catch(() => {});
  }
}

/** Pull the crop of one selector out of a page-xray result, if it took one. */
function cropFor(xr, selector) {
  if (!xr || !selector) return null;
  for (const v of viewsOf(xr)) {
    const hit = (v.crops || []).find((c) => c.selector === selector && c.buffer);
    if (hit) return hit;
  }
  return null;
}

/**
 * captureBefore(url, opts) -> a page-xray result that is GUARANTEED to carry a
 * picture of the things about to change.
 *
 * Call this before the edit, with the selectors the plan is about to touch.
 * The extra crop pass is skipped entirely when page-xray already photographed
 * them, which on the live mirror it usually has.
 */
async function captureBefore(url, { selectors = [], browser = null, xrayImpl = null, control = true, ...opts } = {}) {
  const runXray = xrayImpl || require("./page-xray").xray;
  const xr = await runXray(url, { browser, useCache: false, ...opts });
  if (!xr || xr.ok === false) return xr;
  const missing = selectors.filter((s) => s && !cropFor(xr, s));
  if (missing.length) {
    const extra = await cropElements(url, missing, { browser, launch: opts.launch });
    const view = xr.desktop || xr;
    view.crops = [...(view.crops || []), ...extra.filter((c) => c.buffer)];
    xr.crops = view.crops;
    xr.crops_topped_up = extra.map((c) => ({ selector: c.selector, ok: Boolean(c.buffer), error: c.error || null }));
  }
  // THE CONTROL — a second look at the SAME unchanged page. Structure only: no
  // screenshots, no crops, because all it is ever asked is which measurements
  // this page holds still on. That is the cheapest capture page-xray takes, and
  // it buys the one thing without which none of the later numbers mean
  // anything. See the noise section at the top of this file for what happens
  // without it.
  if (control) {
    const second = await runXray(url, { browser, useCache: false, ...opts, crops: false, shots: false });
    if (second && second.ok !== false) {
      Object.defineProperty(xr, "control", { value: second, enumerable: false, configurable: true });
      // `measured` has to ride along. Without it a caller reading xr.noise sees
      // a summary full of real numbers and no way to tell a measured band from
      // an absent one — which is the same shape of lie this module exists to
      // catch, in the module's own reporting. The first live run printed
      // "control NOT MEASURED" while silently applying a 325px band it had in
      // fact measured.
      xr.noise = { measured: true, ...noiseBandOf(xr, second).summary };
    } else {
      xr.noise = { measured: false, reason: (second && second.reason) || "control_capture_failed" };
    }
  }
  return xr;
}

/**
 * verifyChange({ url, request, before, … }) -> the report, with pictures.
 *
 * NEVER THROWS. A verifier that takes the call down is worse than no verifier;
 * an honest COULD_NOT_LOOK is a real answer this system already knows how to
 * handle.
 *
 * `before` is the x-ray taken BEFORE the change. It is a required input and
 * cannot be recovered afterwards: pass the one the resolver already took (it
 * is in page-xray's cache and costs ~0ms to fetch again by URL), or one from
 * captureBefore.
 */
async function verifyChange({
  url,
  request,
  before,
  control = null,
  browser = null,
  marker = null,
  markerPresent = null,
  useVision = true,
  vision = null,
  fetchImpl = fetch,
  xrayImpl = null,
  buildHash = "",
  now = Date.now,
  ...xrayOpts
} = {}) {
  const t0 = now();
  const timings = { marker_ms: 0, after_ms: 0, compare_ms: 0, crops_ms: 0, vision_ms: 0, total_ms: 0 };
  try {
    const req = readRequest(request);

    // The edge check first: it is one cheap request and it decides whether the
    // expensive capture is even worth taking.
    let sawMarker = markerPresent;
    if (marker && sawMarker === null) {
      const tm = now();
      sawMarker = await checkMarker(url, marker, fetchImpl);
      timings.marker_ms = now() - tm;
    }

    // The page as it is NOW. The cache is bypassed on purpose — the whole
    // point of this call is that the page just changed, and a cache hit here
    // would hand back a picture of the page before the edit and call it after.
    const runXray = xrayImpl || require("./page-xray").xray;
    const ta = now();
    const after = await runXray(url, { browser, buildHash, useCache: false, ...xrayOpts });
    timings.after_ms = now() - ta;

    const tc = now();
    const report = compare(before, after, request, {
      markerPresent: sawMarker,
      // captureBefore hangs the control off the before capture, so the common
      // caller passes one object and gets the control for free.
      control: control || (before && before.control) || null,
    });
    timings.compare_ms = now() - tc;
    report.url = url;
    report.marker_present = sawMarker;

    // The pictures. Before comes from the capture taken before the change —
    // there is no second chance at it — and after is taken now, of the same
    // selector, so the pair is genuinely of one thing at two times.
    const selector = report.before ? report.before.selector : req.selector;
    if (selector) {
      const beforeCrop = cropFor(before, selector);
      let afterCrop = cropFor(after, selector);
      if (!afterCrop && report.verdict !== VERDICTS.BLIND) {
        const tcr = now();
        const got = await cropElements(url, [selector], { browser, ...xrayOpts });
        timings.crops_ms = now() - tcr;
        afterCrop = got.find((c) => c.buffer) || null;
      }
      // A CROP OF A COVERED ELEMENT IS NOT A PICTURE OF THAT ELEMENT.
      //
      // Found by opening the committed crops and looking at them. Playwright
      // photographs the REGION an element occupies, so anything painted on top
      // is what comes out. On the live Rimrock mirror the file written as
      // "the logo, before" is almost entirely our own WSS Labs sign-up floater,
      // which sits over the client's mark at 1280 — and the same panel covers
      // the left edge of their headline.
      //
      // The measurements are unaffected: those come from the DOM, and the logo
      // really did go 141x72 -> 190x97. But asking a model "does this logo look
      // right" while showing it a picture of our own sign-up panel is worse
      // than not asking, so the crop is labelled and the eye is not asked.
      const covered = (report.after && report.after.topmost === false)
        || (report.before && report.before.topmost === false);
      const coveredBy = (report.after && report.after.covered_by) || (report.before && report.before.covered_by) || "";
      report.crops = {
        before: beforeCrop ? { sha256: beforeCrop.sha256, bytes: beforeCrop.bytes, type: beforeCrop.type, buffer: beforeCrop.buffer, shows_target: !covered, ...(covered ? { covered_by: coveredBy } : {}) } : null,
        after: afterCrop ? { sha256: afterCrop.sha256, bytes: afterCrop.bytes, type: afterCrop.type, buffer: afterCrop.buffer, shows_target: !covered, ...(covered ? { covered_by: coveredBy } : {}) } : null,
      };
    }

    // Only now, and only on an otherwise-clean result: there is nothing for an
    // eye to add to a page that already failed a measurement, and a call is
    // waiting.
    if (useVision && report.verdict === VERDICTS.AS_ASKED
      && report.crops && report.crops.before && report.crops.after
      && report.crops.after.shows_target === false) {
      report.vision = {
        ok: false,
        reason: "target_is_covered_so_the_crop_is_not_of_it",
        covered_by: report.crops.after.covered_by || "",
      };
    } else if (useVision && report.verdict === VERDICTS.AS_ASKED
      && report.crops && report.crops.before && report.crops.after) {
      const tv = now();
      const call = vision || defaultVision;
      const answer = await call({
        prompt: visionPrompt(report),
        images: [
          { base64: report.crops.before.buffer.toString("base64"), media_type: report.crops.before.type === "png" ? "image/png" : "image/jpeg" },
          { base64: report.crops.after.buffer.toString("base64"), media_type: report.crops.after.type === "png" ? "image/png" : "image/jpeg" },
        ],
      });
      timings.vision_ms = now() - tv;
      if (answer && answer.ok) {
        const read = readVisionAnswer(answer.text);
        if (read) applyVision(report, { ...read, usage: answer.usage, model: answer.model });
        else report.vision = { ok: false, reason: "unreadable_answer" };
      } else {
        // Vision being unavailable NEVER changes a measured verdict. It is
        // recorded as an absence so nobody later reads a clean pass as
        // "an eye checked it".
        report.vision = { ok: false, reason: (answer && answer.reason) || "vision_unavailable" };
      }
    }

    timings.total_ms = now() - t0;
    report.timings = timings;
    report.say = sayForVerdict(report);
    return report;
  } catch (e) {
    timings.total_ms = now() - t0;
    const report = {
      verdict: VERDICTS.BLIND,
      reason: `verifier_failed:${String((e && e.message) || e).slice(0, 160)}`,
      url,
      before: null, after: null, delta: [], expectations: [], wrong: [], collateral: null, newDefects: [],
      timings,
    };
    report.say = sayForVerdict(report);
    return report;
  }
}

/** Is the job's own marker in the bytes the edge is serving right now? */
async function checkMarker(url, marker, fetchImpl = fetch) {
  if (!marker) return null;
  try {
    const bust = `${url}${url.includes("?") ? "&" : "?"}_vv=${Date.now()}`;
    const res = await fetchImpl(bust, { headers: { "cache-control": "no-cache", pragma: "no-cache" } });
    if (!res.ok) return null;
    const text = await res.text();
    return text.includes(marker);
  } catch {
    return null;
  }
}

/** The same report with every image buffer replaced by its digest — what goes
 *  in a job row, a log line or a model prompt, never the megabytes. */
function withoutBuffers(report) {
  if (!report) return report;
  const out = { ...report };
  if (out.crops) {
    out.crops = {
      before: out.crops.before ? { sha256: out.crops.before.sha256, bytes: out.crops.before.bytes, type: out.crops.before.type } : null,
      after: out.crops.after ? { sha256: out.crops.after.sha256, bytes: out.crops.after.bytes, type: out.crops.after.type } : null,
    };
  }
  return out;
}

// ===========================================================================
// WIRING NOTE FOR lib/site-change-plan.js — owned elsewhere, do not edit here
// ===========================================================================
//
// runSiteChange() currently answers "did the rule take" and stops. Two edits
// give it "did the customer's page actually change".
//
// ---------------------------------------------------------------------------
// 1. TAKE THE BEFORE PICTURE — in runSiteChange, in Phase 2, immediately after
//    `const elements = buildElementCatalog(fileTexts, scanText);` (~line 2594)
//    and BEFORE anything is applied. It must not be later than this: once the
//    deploy has happened the before picture is gone for good.
//
//      const liveOrigin = aliasHost ? `https://${String(aliasHost).replace(/^https?:\/\//, "")}` : "";
//      // Never rejects, never blocks the plan: a page we cannot photograph
//      // becomes an honest COULD_NOT_LOOK later, not a dead job.
//      const beforeShot = liveOrigin
//        ? require("./visual-verify").captureBefore(liveOrigin, {
//            selectors: [],            // fill in once the plan names its target
//            mobile: true,
//            crops: true,
//            control: true,            // DEFAULT, and leave it on — see below
//          }).catch(() => null)
//        : null;
//
//    Start it as a PROMISE here and await it at step 2. It overlaps the planner
//    call, which is the slowest phase in the job, so on the measured numbers
//    (7.7s for both captures against a multi-second model call) it costs the job
//    nothing at all.
//
//    `control: true` MAKES captureBefore LOOK TWICE, and it is the single load-
//    bearing option in this whole file. The second look is structure-only (no
//    screenshots, no crops) and is what the verdicts are subtracted against.
//    Turn it off and every threshold falls back to a floor that these pages
//    walk straight through: measured on the live Rimrock mirror, one capture in
//    three shows 11 elements moving 26px and the logo's y wandering by 228px
//    with no edit at all. The control rides on the returned object as a
//    non-enumerable `control` property and verifyChange picks it up on its own,
//    so there is nothing else to thread through.
//
//    If the plan's target selector is known before this point — it is whenever
//    the request came through lib/element-resolve, where resolve() already
//    x-rayed the page — pass `resolution.target.selector` in `selectors` so the
//    before crop of the thing being changed is guaranteed. There is no second
//    chance at a before picture once the deploy has happened.
//
//    NOTE captureBefore passes useCache:false deliberately. A cached capture
//    cannot be a control for itself — two reads of one LRU entry are identical
//    by construction and would report a measured noise band of zero.
//
// ---------------------------------------------------------------------------
// 2. COMPARE, right after the existing edit-verify block (~line 3182, after
//    `const verdict = summarizeVerification(measurement);`). Order matters:
//    edit-verify decides whether the declaration computes; this decides whether
//    the page is different. Run this one second and hand it edit-verify's
//    marker finding so a stale edge cannot masquerade as "nothing changed":
//
//      const visual = await Promise.race([
//        require("./visual-verify").verifyChange({
//          url: origin,
//          request: resolution || { verb: planVerb, selector: primarySelector, css: appliedCss },
//          before: await beforeShot,
//          browser: warmBrowser ? await warmBrowser : null,   // NB: it is a promise, and can resolve to { __error }
//          markerPresent: measurement && measurement.markerPresent,
//          buildHash: deployed.url,        // makes the after-capture cache-safe
//          useVision: true,
//        }),
//        new Promise((r) => setTimeout(() => r({ verdict: "COULD_NOT_LOOK", reason: "visual_verify_timed_out" }), 45_000)),
//      ]);
//
//    `browser`: warmBrowser is a PROMISE that deliberately never rejects and can
//    resolve to `{ __error }`. Await it and pass null unless it is a real
//    browser, or the capture will fail on a shape it did not expect.
//
//    `request`: pass the lib/element-resolve Resolution verbatim when there is
//    one — the object that said "I'll make the logo twice as big" is the object
//    this checks against. Otherwise `{ verb, selector, css }` where css is the
//    declaration text the plan wrote (composeOverrideCss's output for that op).
//
// ---------------------------------------------------------------------------
// 3. WHAT THE JOB RECORD CARRIES. Add one key beside the existing `verified`:
//
//      visual: require("./visual-verify").withoutBuffers({
//        verdict,          // CHANGED_AS_ASKED | CHANGED_BUT_WRONG | NO_VISIBLE_CHANGE | COULD_NOT_LOOK
//        reason,
//        before, after,    // the two flat measurement records — the evidence
//        delta,            // every measured difference, with both numbers
//        expectations,     // what was asked, and whether each was met
//        wrong,            // every fault, each with its measurement
//        collateral,       // { total, surprising, worst[] } — evidence, never blocking
//        newDefects,       // defects this edit INTRODUCED (before/after diff)
//        noise,            // KEEP THIS. What the page did on its own, and so the
//                          // justification for every threshold above it. A verdict
//                          // stored without it cannot be argued with later.
//        crops,            // { before:{sha256,bytes,shows_target}, after:{…} }
//        vision,           // the eye's answer, or why there wasn't one
//        timings,
//      })
//
//    withoutBuffers is not optional. A raw report carries two JPEGs and job rows
//    are read back into memory in bulk.
//
//    Persist the crop BUFFERS to the proof bucket beside the job (the same place
//    proof shots go) and keep only the digests in the row. A before/after pair a
//    human can look at is the difference between "we measured it" and "here it
//    is".
//
//    HONOUR crops.shows_target WHEN YOU DISPLAY THEM. false means something is
//    painted over the element and the picture is of that instead — on the live
//    Rimrock mirror our own WSS Labs sign-up floater covers the client's logo at
//    1280, so the file written as "the logo, before" is mostly our panel. The
//    measurements are unaffected (they come from the DOM), but a before/after
//    pair shown to an operator as the logo, which is not the logo, is a new lie
//    in the same family as the one this module exists to end. Label it or do not
//    show it.
//
// ---------------------------------------------------------------------------
// 4. WHAT IT CHANGES ABOUT THE ENDING. The existing rollback branch keys on
//    edit-verify's `not_landed`. Extend the condition, and only this way round:
//
//      const mustRollBack = verdict.status === "not_landed"
//        || visual.verdict === "NO_VISIBLE_CHANGE"
//        || visual.verdict === "CHANGED_BUT_WRONG";
//
//    NO_VISIBLE_CHANGE: the customer's site is carrying an edit that does
//    nothing. It goes back, exactly as not_landed does today, and for the same
//    reason.
//    CHANGED_BUT_WRONG: it did something and the something is wrong — this is
//    the stretched-logo call. Roll back and OFFER, do not just announce.
//    COULD_NOT_LOOK: never rolls back. Not being able to see the page is not
//    evidence the edit is bad, and undoing a customer's change on a suspicion is
//    its own kind of damage. It is simply never reported as done.
//
//    And the sentence:
//
//      say: visual.verdict === "COULD_NOT_LOOK"
//        ? sayForVerdict(verdict, { reverted })            // edit-verify's, unchanged
//        : require("./visual-verify").sayForVerdict(visual, { undone: reverted });
//
//    "That's done — it's live on your site now. Go ahead and hit refresh" is
//    reachable from CHANGED_AS_ASKED and from nowhere else in this file.
//
// ---------------------------------------------------------------------------
// 5. COST, MEASURED (see scripts/visual-verify-live-proof.js). The after
//    capture is the only new work on the critical path: 3-5s against a live
//    mirror with a warm browser, structure-only 1.7-2.6s. The before capture
//    overlaps the planner and is free. Vision adds ~2-4s and only ever runs on
//    a result that already passed every measurement, which is the case where
//    the customer is about to be told it is done — the one worth spending on.

module.exports = {
  // the whole thing
  verifyChange,
  captureBefore,
  cropElements,
  checkMarker,

  // pure — every rule above is testable without a browser
  compare,
  measure,
  deltaOf,
  realDelta,
  noiseBandOf,
  relativeTo,
  withRelative,
  matchIn,
  expectationsFor,
  judge,
  wantsFromCss,
  readRequest,
  regressionsFor,
  newDefects,
  collateralMoves,
  applyVision,
  sayForVerdict,
  summarize,
  withoutBuffers,
  cropFor,
  elementsOf,
  viewsOf,

  // vision
  visionPrompt,
  readVisionAnswer,
  defaultVision,

  VERDICTS,
  MOVE_PX,
  SIZE_PX,
  FONT_PX,
  ASPECT_TOLERANCE,
  CONTRAST_FLOOR,
  COLLATERAL_PX,
};
