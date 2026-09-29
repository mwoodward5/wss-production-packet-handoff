"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const page = require("../lib/console-page");
const approved = fs.readFileSync(path.join(__dirname, "..", "design", "console-redesign-approved.html"), "utf8");

function firstStyle(source) {
  const match = source.match(/<style>([\s\S]*?)<\/style>/i);
  assert.ok(match, "page must contain the approved stylesheet");
  return match[1].replace(/\r/g, "");
}

/**
 * The owner-approved snapshot predates the bounded Launch repair. Keep the
 * rest of that stylesheet byte-pinned, but promote this one already-shipped
 * replacement into the approved comparison so the regression test protects
 * the grid instead of demanding the horizontal-overflow defect back.
 */
function withBoundedLaunchApproved(style) {
  const oldLaunch = "  .launch{display:flex;gap:12px;flex-wrap:wrap;align-items:stretch}\n";
  const boundedLaunch = [
    "  .launch{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px;align-items:stretch;min-width:0}",
    "  .launch>*{min-width:0;max-width:100%;box-sizing:border-box}",
    "  .launch #laneMode{grid-column:span 3}",
    "  .launch #mineVertical{grid-column:span 3}",
    "  .launch #mineLocation{grid-column:span 6}",
    "  .launch .launchBtn{grid-column:span 3;width:100%}",
    "",
  ].join("\n");
  const oldNote = "  .launch-note{background:var(--carbon);border:1px solid var(--hair);border-radius:12px;padding:12px 16px;font-size:13px;color:var(--slate);flex:1;min-width:260px;line-height:1.55}\n";
  const boundedNote = "  .launch-note{grid-column:1/-1;background:var(--carbon);border:1px solid var(--hair);border-radius:12px;padding:12px 16px;font-size:13px;color:var(--slate);min-width:0;line-height:1.55;overflow-wrap:anywhere}\n";

  assert.match(style, /\.launch\{display:flex;/, "approved snapshot must still contain the legacy Launch rule before normalization");
  assert.match(style, /\.launch-note\{[^}]*flex:1;min-width:260px/, "approved snapshot must still contain the legacy Launch note rule before normalization");
  return style.replace(oldLaunch, boundedLaunch).replace(oldNote, boundedNote);
}

function markupClasses(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bclass="([^"]+)"/g)) {
    match[1].trim().split(/\s+/).filter(Boolean).forEach((name) => names.add(name));
  }
  return names;
}

function classVocabulary(source) {
  const names = markupClasses(source);
  for (const match of source.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) names.add(match[1]);
  return names;
}

// ---------------------------------------------------------------------------
// CAMPAIGN-FLOW REDESIGN, 2026-08-16. Owner verdict after two translation
// passes: "there is NO WORKFLOW. No A, B, C, 1, 2, 3 feel. I'm bombarded by
// the tool." The byte-pinned approved stylesheet still ships untouched (it
// owns the design tokens), but the STATIC INVENTORY above it is now the
// workflow front door: the glance deck, ONE Start-a-new-campaign card with a
// numbered 1-2-3 wizard and ONE GO button, then the run. The dashboard
// inventory the old tests pinned (assembly line, funnel card, gates card,
// model capacity, last car, Riley, what-unlocks-next, three-span footer) is
// deliberately gone from the owner face.
// ---------------------------------------------------------------------------

test("the owner-approved stylesheet still ships, byte-for-byte", () => {
  assert.equal(
    firstStyle(page),
    withBoundedLaunchApproved(firstStyle(approved)),
    "approved CSS changed outside the bounded Launch repair",
  );
});

test("the static front door is the campaign workflow, in order", () => {
  const staticMarkup = page.slice(0, page.indexOf("<script>"));

  // One section heading for the wizard, one for the sites list — nothing else.
  const headings = [...staticMarkup.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, "").trim());
  assert.deepEqual(
    headings.filter((heading) => heading !== "Morning Report"),
    ["Start a new campaign", "Sites in this campaign"],
  );
  const operationsMarkup = staticMarkup.slice(
    staticMarkup.indexOf('id="tabPanelOperations"'),
    staticMarkup.indexOf('id="tabPanelLine"'),
  );
  assert.deepEqual([...operationsMarkup.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].trim()), ["Morning Report"]);

  // The numbered rail, then the three steps, exactly once each.
  assert.match(staticMarkup, /<ol class="wz-rail" id="wzRail"/);
  const steps = [...staticMarkup.matchAll(/<section class="wz-step" id="(wzStep\d)" data-wstep="(\d)"([^>]*)>/g)];
  assert.deepEqual(steps.map((match) => [match[1], Number(match[2])]), [["wzStep1", 1], ["wzStep2", 2], ["wzStep3", 3]]);
  assert.equal(steps.filter((match) => /hidden/.test(match[3])).length, 2, "exactly one step is visible at a time");
  for (const question of ["Who are we reaching?", "How many websites?", "Practice or real?"]) {
    assert.ok(staticMarkup.includes(question), `the rail names its step: ${question}`);
  }
  // ONE GO button, and it is the only Start button on the page.
  assert.match(staticMarkup, /<button id="goButton" class="btn wz-go" type="button" disabled>Start my campaign<\/button>/);
});

test("the dashboard inventory the owner called clutter is retired from the static face", () => {
  const staticMarkup = page.slice(0, page.indexOf("<script>"));
  for (const retired of [
    "The assembly line",
    "Model capacity",
    "Gates &amp; safety",
    "Qualification funnel",
    "Last car off the line",
    "What unlocks next",
    "WSS LABS · LIVE COCKPIT",
  ]) {
    assert.ok(!staticMarkup.includes(retired), `retired from the owner face: ${retired}`);
  }
  // The footer keeps exactly one line — the safety promise.
  const footer = staticMarkup.slice(staticMarkup.indexOf("<footer>"), staticMarkup.indexOf("</footer>") + 9);
  assert.equal((footer.match(/<span(?:\s|>)/g) || []).length, 1);
  assert.match(footer, /NOTHING SENDS WITHOUT YOUR APPROVAL/);
});

test("console exposes exactly the four approved Mine launch buttons", () => {
  const markup = page.slice(0, page.indexOf("<script>"));
  // 2026-08-16 plain-words redesign: "Run N sites" deliberately renamed
  // "Build N" (owner instruction — the reader is a layman, not a developer).
  const buttons = [...markup.matchAll(/<button\b([^>]*)>(Build (\d+))<\/button>/g)]
    .filter((match) => /(?:^|\s)launchBtn(?:\s|$)/.test((match[1].match(/class="([^"]+)"/) || [])[1] || ""))
    .map((match) => ({
      className: (match[1].match(/class="([^"]+)"/) || [])[1] || "",
      count: Number((match[1].match(/data-n="(\d+)"/) || [])[1]),
      label: match[2],
    }));

  assert.deepEqual(buttons, [
    // Mine 10 added on owner instruction 2026-08-04 (quick beta runs).
    { className: "btn launchBtn", count: 10, label: "Build 10" },
    { className: "btn launchBtn", count: 50, label: "Build 50" },
    { className: "btn launchBtn", count: 100, label: "Build 100" },
    { className: "btn ghost launchBtn", count: 500, label: "Build 500" },
  ]);
});

test("no approved class silently disappears from the page's vocabulary", () => {
  const liveClasses = classVocabulary(page);
  const missingClasses = [...markupClasses(approved)].filter((name) => !liveClasses.has(name));
  assert.deepEqual(missingClasses, [], `approved classes missing from live console: ${missingClasses.join(", ")}`);
});

test("the approved signal-W mark is copied rather than regenerated", () => {
  assert.match(page, /<path d="M12 24 L21 42 L30 26 L39 42 L50 20"/);
  assert.match(page, /<rect width="64" height="64" rx="15" fill="#131318"><\/rect>/);
  assert.match(page, /stroke-width="5\.5"/);
  assert.match(page, /<circle cx="50" cy="20" r="7" fill="#34D399" opacity="0\.22"><\/circle>/);
  assert.match(page, /<circle cx="50" cy="20" r="4" fill="#34D399"><\/circle>/);
});
