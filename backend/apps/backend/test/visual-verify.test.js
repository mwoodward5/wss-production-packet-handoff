"use strict";

// test/visual-verify.test.js
//
// Every rule in lib/visual-verify.js, exercised without a browser.
//
// The cases marked LIVE are ones the fixtures could not have found and the
// live proof did (scripts/visual-verify-live-proof.js, against
// wss-test-rimrock-plumbing-billings.wss-ai.com). They are pinned here so the
// next person to touch a threshold has to argue with a measurement.

const test = require("node:test");
const assert = require("node:assert/strict");

const V = require("../lib/visual-verify");
const { mirrorXray } = require("./fixtures/mirror-xray");

// ---------------------------------------------------------------------------
// helpers — build an "after" capture by mutating a copy of the before
// ---------------------------------------------------------------------------

function clone(xr) {
  const copy = JSON.parse(JSON.stringify(xr));
  copy.desktop.elements = copy.elements;
  return copy;
}

/** Change one element (found by selector) in a cloned capture. */
function mutate(xr, selector, patch) {
  const copy = clone(xr);
  for (const el of copy.elements) {
    if (el.selector !== selector) continue;
    Object.assign(el, patch);
    if (patch.rect) el.view = { x: patch.rect.x, y: patch.rect.y };
  }
  return copy;
}

/** Shift every element vertically — what a reflow or a scroll offset does. */
function shiftPage(xr, dy) {
  const copy = clone(xr);
  for (const el of copy.elements) {
    el.rect = { ...el.rect, y: el.rect.y + dy };
    el.view = { x: el.view.x, y: el.view.y + dy };
  }
  return copy;
}

const LOGO = 'header img[src*="client-logo"]';

function resizeRequest(before, { w, h, css }) {
  const el = before.elements.find((e) => e.selector === LOGO);
  return {
    utterance: "make the logo bigger",
    verb: "resize",
    target: el,
    geometry: { kind: "box", current: { w: el.rect.w, h: el.rect.h }, proposed: { w, h }, property: "height", css_hint: css || `height:${h}px;width:auto` },
  };
}

// ---------------------------------------------------------------------------
// measure / delta
// ---------------------------------------------------------------------------

test("measure carries the numbers a verdict is built from", () => {
  const xr = mirrorXray();
  const el = xr.elements.find((e) => e.selector === LOGO);
  const m = V.measure(el);
  assert.equal(m.selector, LOGO);
  assert.equal(m.w, el.rect.w);
  assert.equal(m.h, el.rect.h);
  assert.ok(m.natural, "a picture keeps its natural size");
  assert.equal(m.distortion, el.image.distortion);
});

test("deltaOf reports both numbers, not a boolean", () => {
  const before = V.measure({ rect: { x: 0, y: 0, w: 100, h: 50 }, style: {}, selector: "x" });
  const after = V.measure({ rect: { x: 0, y: 0, w: 200, h: 50 }, style: {}, selector: "x" });
  const d = V.deltaOf(before, after);
  const w = d.find((e) => e.metric === "w");
  assert.deepEqual([w.from, w.to, w.by], [100, 200, 100]);
});

test("a sub-threshold wobble is not a change", () => {
  const before = V.measure({ rect: { x: 0, y: 0, w: 100, h: 50 }, style: {}, selector: "x" });
  const after = V.measure({ rect: { x: 0.5, y: 0, w: 100, h: 50 }, style: {}, selector: "x" });
  assert.equal(V.deltaOf(before, after).length, 0);
});

test("matchIn finds the same element by selector and never by index", () => {
  const before = mirrorXray();
  // A swap reorders the DOM: the same element now sits at a different index.
  const after = clone(before);
  after.elements.reverse();
  const el = before.elements.find((e) => e.selector === LOGO);
  const found = V.matchIn(after.elements, el);
  assert.equal(found.selector, LOGO, "identity is the selector, which survives a reorder");
});

// ---------------------------------------------------------------------------
// LIVE — the page's own noise, and the control that measures it
// ---------------------------------------------------------------------------

test("LIVE: a page that shifts on its own does not get an edit blamed for it", () => {
  const before = mirrorXray();
  const control = shiftPage(before, 26); // the measured reflow on the live mirror
  const after = shiftPage(before, 26);

  const req = resizeRequest(before, { w: 141, h: 72, css: "" });
  const report = V.compare(before, after, req, { control });
  assert.equal(report.verdict, V.VERDICTS.NONE, "vertical drift alone is not a change");
  const y = report.delta.find((d) => d.metric === "y");
  assert.ok(y && y.within_noise, "the drift is recorded, and marked as the page's own");
});

test("LIVE: the vertical band is page-wide, because a reflow moves everything", () => {
  const before = mirrorXray();
  // Only ONE element drifts during the control...
  const control = mutate(before, "footer", { rect: { ...before.elements.find((e) => e.selector === "footer").rect, y: 1692 + 30 } });
  const noise = V.noiseBandOf(before, control);
  // ...but every element inherits the band, because the cause is the page.
  assert.ok(noise.band(LOGO, "y") >= 30, "y is banded page-wide");
  assert.equal(noise.band(LOGO, "h"), 0, "height is NOT — a reflow cannot resize an img with a height on it");
});

test("LIVE: a 25px height change survives a 26px page reflow", () => {
  // The bug this pins: a global band over every metric made a correct resize
  // unverifiable and returned COULD_NOT_LOOK on a change that plainly worked.
  const before = mirrorXray();
  const control = shiftPage(before, 26);
  const logo = before.elements.find((e) => e.selector === LOGO);
  const after = mutate(shiftPage(before, 26), LOGO, {
    rect: { ...logo.rect, y: logo.rect.y + 26, w: 190, h: 97 },
    image: { ...logo.image, displayed: { w: 190, h: 97 }, distortion: 1.0, natural: logo.image.natural, fit: "contain", verdicts: [] },
  });
  const report = V.compare(before, after, resizeRequest(before, { w: 190, h: 97 }), { control });
  assert.equal(report.verdict, V.VERDICTS.AS_ASKED);
});

test("noiseBandOf reports whether it measured anything at all", () => {
  assert.equal(V.noiseBandOf(mirrorXray(), null).measured, false);
  assert.equal(V.noiseBandOf(mirrorXray(), mirrorXray()).measured, true);
  // An absent control must never read as a measured band of zero.
  assert.equal(V.noiseBandOf(mirrorXray(), null).band(LOGO, "y"), null);
});

test("LIVE: a defect KIND the page produces on its own never blocks", () => {
  const before = mirrorXray();
  before.desktop.defects = [];
  // control: the same page produces a `covered` finding unprompted
  const control = clone(before);
  control.desktop.defects = [{ kind: "covered", at: "1280", name: "footer", selector: "footer", detail: "flapped" }];

  const logo = before.elements.find((e) => e.selector === LOGO);
  const after = mutate(before, LOGO, { rect: { ...logo.rect, w: 190, h: 97 }, image: { ...logo.image, displayed: { w: 190, h: 97 }, distortion: 1.0, verdicts: [] } });
  // and now `covered` turns up on a DIFFERENT element after the edit
  after.desktop.defects = [{ kind: "covered", at: "1280", name: "section heading", selector: "main > section:nth-of-type(2) h2", detail: "something over it" }];

  const report = V.compare(before, after, resizeRequest(before, { w: 190, h: 97 }), { control });
  assert.equal(report.verdict, V.VERDICTS.AS_ASKED, "a flappy kind is recorded, not charged to the edit");
  assert.ok(report.newDefects.some((d) => d.unreliable), "and it is still on the record");
});

test("LIVE: a defect on an element that did not change cannot be this edit's fault", () => {
  const before = mirrorXray();
  before.desktop.defects = [];
  const control = clone(before); // a perfectly stable control — no flapping at all
  const logo = before.elements.find((e) => e.selector === LOGO);
  const after = mutate(before, LOGO, { rect: { ...logo.rect, w: 190, h: 97 }, image: { ...logo.image, displayed: { w: 190, h: 97 }, distortion: 1.0, verdicts: [] } });
  // the headline is untouched — same size, same place, same colour — yet a
  // defect appears on it
  after.desktop.defects = [{ kind: "covered", at: "1280", name: "main headline", selector: "h1", detail: "something over it" }];

  const report = V.compare(before, after, resizeRequest(before, { w: 190, h: 97 }), { control });
  assert.equal(report.verdict, V.VERDICTS.AS_ASKED);
  assert.ok(report.newDefects[0].unreliable, "causally impossible, so not blocking");
});

// ---------------------------------------------------------------------------
// what was asked for
// ---------------------------------------------------------------------------

test("wantsFromCss reads pixel targets and refuses to invent one from `auto`", () => {
  const w = V.wantsFromCss("height:144px;width:auto;max-width:100%");
  assert.equal(w.h, 144);
  assert.equal(w.w, undefined, "auto is not a number to check against");
});

test("wantsFromCss reads a push from margin auto, and centring from both", () => {
  assert.equal(V.wantsFromCss("margin-left:auto;margin-right:0").push_right, true);
  assert.equal(V.wantsFromCss("margin-left:auto;margin-right:auto").centre, true);
});

test("expectations speak in plain words with no numbers in them", () => {
  const before = mirrorXray();
  const m = V.measure(before.elements.find((e) => e.selector === LOGO));
  const exp = V.expectationsFor(resizeRequest(before, { w: 190, h: 97 }), m);
  assert.ok(exp.length);
  for (const e of exp) {
    assert.ok(!/\d/.test(e.what), `"${e.what}" must carry no numbers — it is spoken`);
    assert.ok(e.stated, "the arithmetic lives in `stated`");
  }
});

test("a type-size request is checked on the type size, not the box", () => {
  const before = mirrorXray();
  const h1 = before.elements.find((e) => e.selector === "h1");
  const m = V.measure(h1);
  const exp = V.expectationsFor({
    verb: "resize", target: h1,
    geometry: { kind: "type_size", proposed: { font_px: 64 }, css_hint: "font-size:64px" },
  }, m);
  assert.equal(exp[0].metric, "font_px");
  assert.equal(exp[0].want, 64);
});

test("a vertical move is checked against the box it sits in, not the document", () => {
  const before = mirrorXray();
  const el = before.elements.find((e) => e.selector === LOGO);
  const m = V.withRelative(V.measure(el), before.elements, el);
  const exp = V.expectationsFor({ verb: "move", target: el, plan: { direction: "bottom" } }, m);
  assert.equal(exp[0].metric, "rel_y", "document y is the one metric these pages will not hold still");
});

test("relativeTo cancels a page-wide scroll shift", () => {
  const before = mirrorXray();
  const shifted = shiftPage(before, 200);
  const a = before.elements.find((e) => e.selector === LOGO);
  const b = shifted.elements.find((e) => e.selector === LOGO);
  const ra = V.relativeTo(before.elements, a);
  const rb = V.relativeTo(shifted.elements, b);
  assert.equal(ra.rel_y, rb.rel_y, "the offset inside its box does not move when the page does");
});

// ---------------------------------------------------------------------------
// the verdicts
// ---------------------------------------------------------------------------

test("CHANGED_AS_ASKED: measured, in the direction asked, nothing broken", () => {
  const before = mirrorXray();
  const logo = before.elements.find((e) => e.selector === LOGO);
  const after = mutate(before, LOGO, {
    rect: { ...logo.rect, w: 190, h: 97 },
    image: { ...logo.image, displayed: { w: 190, h: 97 }, distortion: 1.0, verdicts: [] },
  });
  const report = V.compare(before, after, resizeRequest(before, { w: 190, h: 97 }), { control: clone(before) });
  assert.equal(report.verdict, V.VERDICTS.AS_ASKED);
  assert.ok(report.expectations.every((e) => e.met === true));
});

test("NO_VISIBLE_CHANGE: the page is measurably identical", () => {
  const before = mirrorXray();
  const report = V.compare(before, clone(before), resizeRequest(before, { w: 190, h: 97 }), { control: clone(before) });
  assert.equal(report.verdict, V.VERDICTS.NONE);
  assert.equal(report.reason, "no_measured_difference");
  assert.equal(report.delta.length, 0);
});

test("NO_VISIBLE_CHANGE wins even when the expectation is trivially satisfied", () => {
  // Asked for the colour it already was. Every check passes and the customer
  // sees nothing — telling them it is live is the same lie in a nicer hat.
  const before = mirrorXray();
  const h1 = before.elements.find((e) => e.selector === "h1");
  const report = V.compare(before, clone(before), {
    verb: "restyle", target: h1, plan: { intent: { kind: "recolour" }, colour: "white" },
  }, { control: clone(before) });
  assert.equal(report.verdict, V.VERDICTS.NONE);
});

test("CHANGED_BUT_WRONG: the logo is stretched — the recorded complaint", () => {
  const before = mirrorXray();
  const logo = before.elements.find((e) => e.selector === LOGO);
  const after = mutate(before, LOGO, {
    rect: { ...logo.rect, w: 509, h: 97 },
    image: { ...logo.image, displayed: { w: 509, h: 97 }, distortion: 2.673, verdicts: [] },
  });
  const report = V.compare(before, after, resizeRequest(before, { w: 509, h: 97 }), { control: clone(before) });
  assert.equal(report.verdict, V.VERDICTS.WRONG);
  const stretched = report.wrong.find((w) => w.kind === "stretched");
  assert.ok(stretched, "the shape change is named");
  assert.match(stretched.detail, /2\.673/, "and carries the measurement it was read off");
});

test("CHANGED_BUT_WRONG: it grew, but not to what was asked", () => {
  const before = mirrorXray();
  const logo = before.elements.find((e) => e.selector === LOGO);
  const after = mutate(before, LOGO, {
    rect: { ...logo.rect, w: 150, h: 76 },
    image: { ...logo.image, displayed: { w: 150, h: 76 }, distortion: 1.0, verdicts: [] },
  });
  const report = V.compare(before, after, resizeRequest(before, { w: 400, h: 200 }), { control: clone(before) });
  assert.equal(report.verdict, V.VERDICTS.WRONG);
  assert.match(report.wrong[0].plain, /didn't/, "said as a plain sentence");
  assert.ok(!/\dpx/.test(report.wrong[0].plain), "and with no pixel counts in the spoken half");
});

test("CHANGED_BUT_WRONG: part of it is now outside its box", () => {
  const before = mirrorXray();
  const logo = before.elements.find((e) => e.selector === LOGO);
  const after = mutate(before, LOGO, {
    rect: { ...logo.rect, w: 509, h: 97 },
    image: { ...logo.image, displayed: { w: 509, h: 97 }, distortion: 1.0, verdicts: [] },
    overflow: { viewport_px: 0, viewport_side: "", clipped_px: 139, parent_overflow: "hidden", clipped_by: "header" },
  });
  const report = V.compare(before, after, resizeRequest(before, { w: 509, h: 97 }), { control: clone(before) });
  assert.equal(report.verdict, V.VERDICTS.WRONG);
  assert.ok(report.wrong.some((w) => w.kind === "cut_off"));
});

test("CHANGED_BUT_WRONG: the words are no longer readable", () => {
  const before = mirrorXray();
  const h1 = before.elements.find((e) => e.selector === "h1");
  h1.contrast = 12.4;
  h1.style = { ...h1.style, colorHex: "#141414", effectiveBackgroundHex: "#ffffff" };
  const after = mutate(before, "h1", {
    contrast: 1.6,
    style: { ...h1.style, colorHex: "#fafafa", effectiveBackgroundHex: "#ffffff" },
  });
  const report = V.compare(before, after, {
    verb: "restyle", target: h1, plan: { intent: { kind: "recolour" }, colour: "white" }, css: "color:#fafafa",
  }, { control: clone(before) });
  assert.equal(report.verdict, V.VERDICTS.WRONG);
  const bad = report.wrong.find((w) => w.kind === "hard_to_read");
  assert.ok(bad);
  assert.match(bad.detail, /12\.4.*1\.6/, "both ratios, so the threshold can be argued with");
});

test("CHANGED_BUT_WRONG: the thing is gone and nobody asked for that", () => {
  const before = mirrorXray();
  const after = clone(before);
  after.elements = after.elements.filter((e) => e.selector !== LOGO);
  after.desktop.elements = after.elements;
  const report = V.compare(before, after, resizeRequest(before, { w: 190, h: 97 }), { control: clone(before) });
  assert.equal(report.verdict, V.VERDICTS.WRONG);
  assert.equal(report.reason, "target_gone");
});

test("COULD_NOT_LOOK: a stale edge is never reported as 'nothing changed'", () => {
  const before = mirrorXray();
  const report = V.compare(before, clone(before), resizeRequest(before, { w: 190, h: 97 }), { markerPresent: false });
  assert.equal(report.verdict, V.VERDICTS.BLIND);
  assert.equal(report.reason, "page_still_serving_old_bytes");
});

test("COULD_NOT_LOOK: a capture that failed is not a measurement", () => {
  const before = mirrorXray();
  const report = V.compare(before, { ok: false, reason: "http_503" }, resizeRequest(before, { w: 190, h: 97 }));
  assert.equal(report.verdict, V.VERDICTS.BLIND);
  assert.match(report.reason, /no_after_capture/);
});

test("COULD_NOT_LOOK: a metric the page will not hold still on proves nothing", () => {
  const before = mirrorXray();
  const logo = before.elements.find((e) => e.selector === LOGO);
  // the control shows this element's own height wandering by 40px
  const control = mutate(before, LOGO, { rect: { ...logo.rect, h: logo.rect.h + 40 } });
  const after = mutate(before, LOGO, { rect: { ...logo.rect, h: logo.rect.h + 25 } });
  const report = V.compare(before, after, {
    verb: "resize", target: logo,
    geometry: { kind: "box", proposed: { h: logo.rect.h + 25 }, property: "height", css_hint: `height:${logo.rect.h + 25}px` },
  }, { control });
  assert.equal(report.verdict, V.VERDICTS.BLIND);
  assert.equal(report.reason, "page_not_stable_enough_to_measure");
});

test("LIVE: collateral movement is recorded and never rolls a change back", () => {
  // Blocking on this rolled back a correct logo resize because a headline three
  // screens below had moved on its own.
  const before = mirrorXray();
  const logo = before.elements.find((e) => e.selector === LOGO);
  let after = mutate(before, LOGO, {
    rect: { ...logo.rect, w: 190, h: 97 },
    image: { ...logo.image, displayed: { w: 190, h: 97 }, distortion: 1.0, verdicts: [] },
  });
  const head = after.elements.find((e) => e.selector === "h1");
  after = mutate(after, "h1", { rect: { ...head.rect, y: head.rect.y + 40 } });

  const report = V.compare(before, after, resizeRequest(before, { w: 190, h: 97 }), { control: clone(before) });
  assert.equal(report.verdict, V.VERDICTS.AS_ASKED);
  assert.ok(report.collateral.total > 0, "it is still measured and reported");
  assert.ok(report.wrong.every((w) => !w.blocking), "just never a reason to undo their change");
});

// ---------------------------------------------------------------------------
// vision — may accuse, may not acquit
// ---------------------------------------------------------------------------

test("vision can demote a clean pass when it sees a problem", () => {
  const report = { verdict: V.VERDICTS.AS_ASKED, wrong: [] };
  V.applyVision(report, { looks_right: false, problems: ["the logo is squashed"], because: "it looks flattened" });
  assert.equal(report.verdict, V.VERDICTS.WRONG);
  assert.equal(report.wrong[0].from, "vision");
});

test("vision cannot promote a failed measurement", () => {
  const report = { verdict: V.VERDICTS.WRONG, reason: "stretched", wrong: [{ kind: "stretched", blocking: true, plain: "out of shape" }] };
  V.applyVision(report, { looks_right: true, problems: [], because: "looks fine to me" });
  assert.equal(report.verdict, V.VERDICTS.WRONG, "a model's opinion of a JPEG does not overturn arithmetic");
});

test("vision cannot turn NO_VISIBLE_CHANGE into anything else", () => {
  const report = { verdict: V.VERDICTS.NONE, reason: "no_measured_difference", wrong: [] };
  V.applyVision(report, { looks_right: false, problems: ["looks wrong"], because: "" });
  assert.equal(report.verdict, V.VERDICTS.NONE);
});

test("readVisionAnswer survives a reply that is not clean JSON", () => {
  assert.equal(V.readVisionAnswer("here you go {\"looks_right\":false,\"problems\":[\"cut off\"]} cheers").looks_right, false);
  assert.equal(V.readVisionAnswer("no json at all"), null);
});

// ---------------------------------------------------------------------------
// what Riley says
// ---------------------------------------------------------------------------

const JARGON = /(\b(element|selector|css|div|dom|node|class name|xpath|attribute|markup|viewport|pixels?)\b|\d\s*px\b|#[0-9a-f]{6}\b)/i;

test("'hit refresh' is reachable from CHANGED_AS_ASKED and nowhere else", () => {
  const say = (verdict) => V.sayForVerdict({ verdict, wrong: [{ blocking: true, plain: "it came out out of shape" }], before: { name: "logo" } });
  assert.match(say(V.VERDICTS.AS_ASKED), /hit refresh/i);
  for (const v of [V.VERDICTS.WRONG, V.VERDICTS.NONE, V.VERDICTS.BLIND]) {
    assert.ok(!/hit refresh/i.test(say(v)), `${v} must never promise a refresh`);
  }
});

test("NO_VISIBLE_CHANGE says so plainly — the caller is looking at the page", () => {
  const say = V.sayForVerdict({ verdict: V.VERDICTS.NONE, reason: "no_measured_difference", before: { name: "logo" }, wrong: [] });
  assert.match(say, /hasn't actually changed|exactly as it was/i);
});

test("CHANGED_BUT_WRONG offers to put it back", () => {
  const say = V.sayForVerdict({ verdict: V.VERDICTS.WRONG, before: { name: "logo" }, wrong: [{ blocking: true, plain: "it has come out stretched wide" }] });
  assert.match(say, /put it (straight )?back/i);
});

test("every sentence Riley can say is free of developer words", () => {
  const reports = [
    { verdict: V.VERDICTS.AS_ASKED, wrong: [], before: { name: "logo" } },
    { verdict: V.VERDICTS.NONE, reason: "no_measured_difference", wrong: [], before: { name: "main headline" } },
    { verdict: V.VERDICTS.NONE, reason: "already_looked_like_that", wrong: [], before: { name: "logo" } },
    { verdict: V.VERDICTS.BLIND, reason: "page_still_serving_old_bytes", wrong: [], before: { name: "logo" } },
    { verdict: V.VERDICTS.BLIND, reason: "verifier_failed", wrong: [], before: { name: "logo" } },
    { verdict: V.VERDICTS.WRONG, wrong: [{ blocking: true, plain: "part of it is outside the box it sits in" }], before: { name: "logo" } },
  ];
  for (const r of reports) {
    for (const opts of [{}, { undone: true }, { undone: false }, { canUndo: false }]) {
      const say = V.sayForVerdict(r, opts);
      const hit = say.match(JARGON);
      assert.equal(hit, null, `"${say}" contains "${hit && hit[0]}"`);
    }
  }
});

test("LIVE: a page-xray defect is translated before it reaches a phone call", () => {
  // Riley read out "main headline on the 390 view: covered" on the first live
  // run — internal vocabulary arriving through another module's defect list.
  const before = mirrorXray();
  before.desktop.defects = [];
  const control = clone(before);
  const logo = before.elements.find((e) => e.selector === LOGO);
  const after = mutate(before, LOGO, {
    rect: { ...logo.rect, w: 190, h: 97 },
    image: { ...logo.image, displayed: { w: 190, h: 97 }, distortion: 1.0, verdicts: [] },
    overflow: { viewport_px: 60, viewport_side: "right", clipped_px: 0, parent_overflow: "", clipped_by: "" },
  });
  after.desktop.defects = [{ kind: "overhangs_viewport", at: "390", name: "logo", selector: LOGO, detail: "sticks out 60px" }];
  const report = V.compare(before, after, resizeRequest(before, { w: 190, h: 97 }), { control });
  const say = V.sayForVerdict(report);
  assert.equal(say.match(JARGON), null, `"${say}"`);
  assert.match(say, /screen|off the edge|hanging/i);
});

// ---------------------------------------------------------------------------
// the record
// ---------------------------------------------------------------------------

test("summarize carries the measurement pair, not just a word", () => {
  const before = mirrorXray();
  const logo = before.elements.find((e) => e.selector === LOGO);
  const after = mutate(before, LOGO, { rect: { ...logo.rect, w: 190, h: 97 }, image: { ...logo.image, displayed: { w: 190, h: 97 }, distortion: 1, verdicts: [] } });
  const s = V.summarize(V.compare(before, after, resizeRequest(before, { w: 190, h: 97 }), { control: clone(before) }));
  assert.equal(s.ok, true);
  assert.match(s.measured.before, new RegExp(`${logo.rect.w}x${logo.rect.h}`));
  assert.match(s.measured.after, /190x97/);
});

test("withoutBuffers strips the megabytes and keeps the digests", () => {
  const report = {
    verdict: V.VERDICTS.AS_ASKED,
    crops: {
      before: { sha256: "aaa", bytes: 10, type: "jpeg", buffer: Buffer.from("x") },
      after: { sha256: "bbb", bytes: 20, type: "jpeg", buffer: Buffer.from("y") },
    },
  };
  const out = V.withoutBuffers(report);
  assert.equal(out.crops.before.buffer, undefined);
  assert.equal(out.crops.before.sha256, "aaa");
  assert.ok(report.crops.before.buffer, "the original is left alone");
});

test("readRequest takes an element-resolve resolution verbatim", () => {
  const before = mirrorXray();
  const el = before.elements.find((e) => e.selector === LOGO);
  const req = V.readRequest({
    utterance: "make the logo twice as big",
    verb: { kind: "resize", supported: true },
    target: { el, score: 13.5 },
    geometry: { css_hint: "height:144px;width:auto" },
  });
  assert.equal(req.verb, "resize");
  assert.equal(req.selector, LOGO);
  assert.equal(req.css, "height:144px;width:auto");
});

test("compare never throws on rubbish input", () => {
  for (const args of [[null, null, null], [{}, {}, {}], [mirrorXray(), null, { verb: "resize" }]]) {
    const r = V.compare(...args);
    assert.ok(r.verdict, "there is always a verdict, even if it is COULD_NOT_LOOK");
  }
});
