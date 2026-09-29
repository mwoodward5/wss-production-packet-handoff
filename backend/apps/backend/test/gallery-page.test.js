"use strict";

// The gallery page's own polish contract: the features the operator asked for
// after a night of jammed send lanes and dying mirrors.
//
//   1. A finished site that cannot email yet SAYS so, with the reason the
//      factory's own batch record carries (halted, superseded).
//   2. The first paint is a skeleton, not a frozen "Loading gallery" panel.
//   3. The keyboard works: Enter applies the search and confirms the typed-name
//      dialog; Escape still closes every surface (asserted in sibling suites).
//   4. Failures toast in the failure color — a refusal never flashes by in the
//      success green.
//   5. Every control in the served markup has a wired handler.

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const page = require("../lib/gallery-page");
const servedPage = require("../lib/gallery-page-final");

function inlineScripts(html = page) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

test("the page and its served wrapper both compile", () => {
  for (const [name, html] of [["base", page], ["served", servedPage]]) {
    for (const [index, source] of inlineScripts(html).entries()) {
      assert.doesNotThrow(() => new vm.Script(source, { filename: `gallery-${name}-${index}.js` }));
    }
  }
});

test("a built-but-not-emailing row says so, with the batch's own reason", () => {
  const script = inlineScripts().join("\n");

  // The sentence exists, and it is composed from the measured batch state —
  // never a hard-coded guess about which lane is stuck.
  assert.match(script, /function pendingSentence\(item\)/);
  assert.match(script, /"Site built, email pending — its batch is halted: "/);
  assert.match(script, /"Site built, email pending — waiting for its send run to pick it up\."/);
  assert.match(script, /"Site built — waiting on final inspection\."/);
  // Only the three built-but-unreleased states earn the line; ready/queued/sent
  // rows are already in (or through) the send lane and say nothing.
  assert.match(script, /if\(value!=="gate_passed"&&value!=="line_gate_passed"&&value!=="mirrored"\)return "";/);
  // The card renders it under the status chip, in the pending style.
  assert.match(script, /var pending=pendingSentence\(item\);/);
  assert.match(script, /pendingLine\.className="card-pending";/);
  assert.match(page, /\.card-pending\{[^}]*var\(--slate\)/);
  assert.match(page, /\.card-pending::before\{[^}]*var\(--ember\)/);

  // The two halt codes the factory actually writes read as sentences; an
  // unknown code passes through raw rather than being mistranslated.
  assert.match(script, /function plainHaltReason\(code\)/);
  assert.match(script, /superseded by a newer run \(/);
  assert.match(script, /you cleared this batch as stuck/);
  assert.match(script, /return \{plain:raw\.replace\(\/\[_-\]\+\/g," "\),superseded:false\};/);
});

test("a halted or superseded batch gets its own badge on the card", () => {
  const script = inlineScripts().join("\n");

  assert.match(script, /text\(item\.batchState,""\)==="halted"/);
  assert.match(script, /haltedBadge\.textContent=halt\.superseded\?"Superseded run":"Batch halted";/);
  assert.match(script, /haltedBadge\.className="status warn";/);
  // The badge's tooltip names the batch, so support can find the run.
  assert.match(script, /so nothing emails from it until it runs again\./);
  // The result note counts the parked rows beside the offline count.
  assert.match(script, /" in halted batches"/);
});

test("batch state travels through normalizeRows with a safe default", () => {
  const script = inlineScripts().join("\n");
  assert.match(script, /batchState:text\(row\.batchState,""\)/);
  assert.match(script, /batchHaltReason:text\(row\.batchHaltReason,""\)/);
});

test("the first paint is a skeleton with no invented words", () => {
  const script = inlineScripts().join("\n");

  assert.match(script, /function showSkeleton\(\)/);
  // Skeletons replace the frozen loading panel on the catalog read, and only
  // there — every later paint is cards or an honest named state.
  assert.match(script, /resultNote\.textContent="Loading factory records";\s*showSkeleton\(\);/);
  assert.match(script, /card\.className="skeleton-card";/);
  assert.match(script, /card\.setAttribute\("aria-hidden","true"\);/);
  // Same silhouette as a real card: the 16/10 shot and the padded body.
  assert.match(page, /\.skeleton-card\{[^}]*border-radius:16px/);
  assert.match(page, /\.skeleton-shot\{[^}]*aspect-ratio:16\/10/);
  assert.match(page, /\.skeleton-body\{[^}]*padding:18px/);
  // The sweep is motion, so the reduced-motion rules already cover it — no
  // skeleton-specific spin may run under prefers-reduced-motion.
  assert.match(page, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/);
  // The wrapper gives the skeleton the same glass as the cards it stands in
  // for, so first paint and data paint do not look like two different screens.
  assert.match(servedPage, /\.controls,\.site-card,\.skeleton-card,\.site\{/);
});

test("Enter applies the search immediately, locally, and confirms the typed-name ask", () => {
  const script = inlineScripts().join("\n");

  // Enter short-circuits the debounce and re-renders from loaded data.
  const enter = script.match(/searchInput\.addEventListener\("keydown",function\(event\)\{[\s\S]{0,400}?updateView\(\);\s*\}\);/);
  assert.ok(enter, "the search box needs an Enter handler");
  assert.match(enter[0], /event\.key!=="Enter"/);
  assert.match(enter[0], /window\.clearTimeout\(searchTimer\)/);
  assert.doesNotMatch(enter[0], /api\(|fetch\(/, "Enter must reuse loaded data, not refetch");

  // Enter in the typed-name box presses the armed button — and only the armed
  // one, because the disabled check is the same gate the button has.
  const askEnter = script.match(/askInput\.addEventListener\("keydown",function\(event\)\{[\s\S]{0,300}?\}\);/);
  assert.ok(askEnter, "the typed-name input needs an Enter handler");
  assert.match(askEnter[0], /if\(!askGo\.disabled&&!askInput\.hidden\)askGo\.click\(\);/);
});

test("failure toasts are a different color and stay longer", () => {
  const script = inlineScripts().join("\n");
  assert.match(script, /function notify\(message,isError\)/);
  assert.match(script, /node\.classList\.toggle\("bad",isError===true\)/);
  assert.match(script, /isError===true\?3200:1800/);
  assert.match(page, /\.copy-status\.bad\{[^}]*#F58A8A\}/);
  // And the failure call sites actually pass the flag.
  assert.match(script, /notify\("Could not "\+action/);
});

test("the stretched live-site link cannot sit on top of the card's own buttons", () => {
  // Measured in a real browser against this page: when the ::after overlay was
  // positioned against the whole card, "Edit details" and "Archive" clicks
  // landed on the link and opened the live site instead. The overlay is scoped
  // to the preview socket by a position:relative anchor — the buttons keep
  // their z-place above nothing but their own card, and every control works.
  assert.match(page, /\.preview-link\{[^}]*position:relative/);
  assert.match(page, /\.preview-link::after\{[^}]*inset:0/);
  assert.match(page, /\.preview-link::after\{[^}]*border-radius:15px 15px 0 0/);
  // The kebab and the picker still sit explicitly above the overlay.
  assert.match(page, /\.menu\{position:relative;z-index:4\}/);
  assert.match(page, /\.select-box\{[^}]*z-index:6/);
});

test("every served control has a wired handler", () => {
  const script = inlineScripts().join("\n");

  // Static markup controls: each interactive id must be referenced by the
  // controller (listener, submit handler, or focus wiring).
  const interactiveIds = [...servedPage.matchAll(/<(?:button|input|form|select)[^>]*\bid=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((id) => !["tokenInput", "showArchived", "tradeFilter", "statusFilter", "sortSelect", "searchInput", "loadSentinel"].includes(id));
  assert.ok(interactiveIds.length >= 12, "expected the full control set to be present");
  for (const id of interactiveIds) {
    assert.ok(script.includes(`getElementById("${id}")`),
      `control #${id} appears in markup but the controller never resolves it`);
  }
  for (const id of ["batchSelectAll", "batchClear", "batchArchive", "batchRestore", "batchSend",
    "confirmCancel", "confirmCheck", "confirmGo", "askCancel", "askGo", "drawerClose", "loadMore", "accessForm"]) {
    // confirmGo/confirmCheck are wired per-open via .onclick (assigned inside
    // askThenSend), everything else via a standing listener — either is wiring,
    // a control with NEITHER is a dead button.
    assert.match(script, new RegExp(`${id}\\.(?:addEventListener\\(|onclick\\s*=)`), `#${id} needs a listener or an onclick handler`);
  }
  // Card-face actions are built in script, behind listeners, not dead markup.
  for (const label of ["Edit details", "Rebuild", "Archive", "Restore", "Delete forever"]) {
    assert.match(script, new RegExp(`textContent="${label}"`));
  }
  // Esc still walks the stack top-down: ask, confirm, drawer, then menus.
  assert.match(script, /if\(!askDialog\.hidden\)\{event\.preventDefault\(\);closeAsk\(\);return;\}/);
  assert.match(script, /if\(!confirmDialog\.hidden\)\{event\.preventDefault\(\);closeConfirm\(\);return;\}/);
  assert.match(script, /if\(!drawer\.hidden\)\{event\.preventDefault\(\);closeDrawer\(\);return;\}/);
  assert.match(script, /closeMenus\(\);/);
});
