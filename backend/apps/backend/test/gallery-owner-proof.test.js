"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const page = require("../lib/gallery-page");
// What api/admin/gallery actually serves: the same safety-owned page with the
// presentation-only wrapper (a wording swap and one <style>) applied on top.
// The markup assertions above read the base page; the shell test compares the
// served bytes against the wrapper, because that is what reaches the browser.
const servedPage = require("../lib/gallery-page-final");
const galleryPageHandler = require("../api/admin/gallery");
const { createGalleryDataHandler, lastSendIndex, safeGalleryRow, shotCacheWindow } = require("../api/admin/gallery-data");

const SAFE_ROW_KEYS = [
  "archived",
  "businessName",
  "campaign",
  "city",
  // A timestamp and a one-word kind. Never an address, never a subject line —
  // the contact-free assertion below still has to hold with these present.
  "lastSentAt",
  "lastSentKind",
  "previewUrl",
  "prospectId",
  "reportUrl",
  "sendable",
  "shotUrl",
  "state",
  "status",
  "updatedAt",
  "vertical",
].sort();

function inlineScripts(html = page) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function fakeJsonRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    raw: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(payload = "") {
      this.raw = String(payload || "");
      this.body = this.raw ? JSON.parse(this.raw) : null;
    },
  };
}

function fakeTextRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(payload = "") { this.body = String(payload || ""); },
  };
}

function request(method = "GET", token = "") {
  return {
    method,
    url: "/api/admin/gallery-data",
    headers: token ? { "x-admin-token": token } : {},
  };
}

function payloadKeys(value, keys = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => payloadKeys(item, keys));
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      payloadKeys(item, keys);
    }
  }
  return keys;
}

test("gallery inline controller parses and keeps the operator token in one header", () => {
  const scripts = inlineScripts();
  assert.ok(scripts.length > 0, "gallery must include an inline controller");
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `gallery-inline-${index}.js` }));
  });

  const script = scripts.join("\n");
  assert.match(script, /["']wsl_admin_token["']/);
  assert.match(script, /headers\[["']x-admin-token["']\]\s*=\s*token\(\)/);
  assert.match(script, /api\(["']\/api\/admin\/gallery-data["']\)/);
  assert.equal((script.match(/\/api\/admin\/gallery-data/g) || []).length, 3,
    "three mentions, still two requests: the first paint, the live-refresh timer, "
      + "and the campaign clock's path CHECK inside the api() wrap — it repaints "
      + "the clock from snapshots already in flight and never fetches on its own");
  // The rule this count protects is unchanged — TYPING must never hit the
  // network. The second occurrence is the live-refresh lane, which exists
  // because the page was a static snapshot: a site that finished building
  // after the operator opened the tab never appeared until a manual reload.
  // Guard the original intent directly rather than by counting: the search
  // handler and the render path must contain no fetch of their own.
  const searchHandler = script.slice(script.indexOf("searchInput.addEventListener"));
  const untilRender = searchHandler.slice(0, searchHandler.indexOf("updateView();") + 13);
  assert.ok(!/api\(|fetch\(/.test(untilRender),
    "search and tab changes must reuse loaded data, not refetch it");
  // URL state is allowed for VIEW params only — the token must never touch the
  // URL in either direction (never read from it, never written into it). The
  // trade/status/age/campaign reads belong to the shared enterprise filter
  // bar that operator-nav injects; they are view params all the same.
  const urlParams = [...script.matchAll(/params\.get\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(urlParams)].sort(), ["age", "archived", "campaign", "q", "sort", "status", "tab", "trade"],
    "URL state carries only view params, never token material");
  assert.match(script, /history\.replaceState/, "view state persists via replaceState so refresh keeps the view");
  assert.doesNotMatch(script, /history\.pushState/);
  assert.doesNotMatch(script, /location\.hash|decodeURIComponent\(/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^)]*params/);
  assert.doesNotMatch(page, /[?&#](?:t|token|admin_token)=/i);

  // THE PAGE WRITES, BUT ONLY THROUGH NAMED DOORS.
  //
  // This assertion used to read "this page never uses a write verb at all",
  // which was true while the gallery was a read-only catalog. The operator
  // drawer (2026-08-11) added record reads, notes, and owner-proof sends; the
  // owner-powers redesign (2026-08-16) added gallery-manage (archive, restore,
  // the five-field notes edit, and an archived-only delete that requires the
  // business name typed back and is refused server-side otherwise) plus the
  // one-card rebuild through the dedicated no-send rebuild-mirror door. The rule
  // stays in the stricter, still-checkable form — every write goes to one of
  // exactly these five admin routes, and nothing else writes at all.
  const writeTargets = [...script.matchAll(/api\(\s*["']([^"']+)["']\s*,\s*\{/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(writeTargets)].sort(), [
    "/api/admin/gallery-manage",
    "/api/admin/prospect-detail",
    "/api/admin/prospect-note",
    "/api/admin/rebuild-mirror",
    "/api/admin/send-mirror-proof",
  ], "the only writes this page may make are: read one record, save a note, mail the owner a proof, correct or archive a record, start one rebuild");
  assert.doesNotMatch(script, /method\s*:\s*["'](?:PUT|PATCH|DELETE)["']/i,
    "nothing on this page may replace or destroy a record through a raw verb — deletion goes through gallery-manage's guarded action only");
  // The one send route is the owner-proof route. No campaign, batch, or
  // approval endpoint is reachable from THE GALLERY'S OWN CONTROLLER. The rule
  // is scoped to that block because the shared operator-nav snippet at the top
  // of every console page now polls GET /api/admin/line for its live-run
  // ticker; that is a read on a route the gallery itself still cannot start
  // work through, and the two assertions below hold it to being a read.
  const controller = scripts.find((source) => source.includes('api("/api/admin/gallery-data")'));
  assert.ok(controller, "the gallery's own controller block is gone");
  assert.doesNotMatch(controller, /api\/admin\/(?:run-campaign|full-run|approve-held-drafts|line\b)/);
  // Nowhere on the page — nav included — may a campaign/approval route be
  // called at all, and the nav's line poll must stay a bare GET: no method,
  // no body, so it cannot become a start or an approval by a later edit.
  assert.doesNotMatch(script, /api\/admin\/(?:run-campaign|full-run|approve-held-drafts)\b/);
  const linePolls = [...script.matchAll(/fetch\(\s*["']\/api\/admin\/line["']\s*,\s*(\{[\s\S]{0,200}?\})\s*\)/g)]
    .map((match) => match[1]);
  assert.equal(linePolls.length, (script.match(/\/api\/admin\/line\b/g) || []).length,
    "every mention of the line route on this page is the nav's fetch call");
  for (const options of linePolls) {
    assert.doesNotMatch(options, /\bmethod\b|\bbody\b/i, "the nav's line poll is a read, not a write");
  }
});

test("gallery exposes the honest two-tab, client-side search and 60-card contract", () => {
  const script = inlineScripts().join("\n");

  assert.match(page, />\s*Clients\s*</);
  assert.match(page, />\s*All builds\s*</);
  assert.match(page, /No paying customers yet/);
  assert.match(page, /<input\b[^>]*\btype=["']search["'][^>]*>/i);
  assert.match(script, /\w+\.addEventListener\(["']input["'],\s*function\([^)]*\)\{[^}]*state\.query=/);
  assert.match(script, /\.filter\(/);
  for (const field of ["businessName", "city", "state", "vertical"]) assert.match(script, new RegExp(`\\b${field}\\b`));
  assert.match(script, /haystack=\[[^\]]*prospectId/,
    "pasting a prospect slug into search must match — the ID is part of the haystack");

  const archivedInput = page.match(/<input\b[^>]*\bid=["']showArchived["'][^>]*>/i);
  assert.ok(archivedInput, "All builds needs a show-archived checkbox");
  assert.match(archivedInput[0], /type=["']checkbox["']/i);
  assert.doesNotMatch(archivedInput[0], /\bchecked\b/i, "archived builds must be hidden by default");
  assert.match(script, /getElementById\(["']showArchived["']\)/);
  assert.match(script, /\w+\.checked/);
  assert.match(script, /\.archived\b/);

  assert.match(script, /(?:const|let|var)\s+PAGE_SIZE\s*=\s*60\b/);
  assert.match(script, /\+=\s*PAGE_SIZE\b/);
  assert.match(script, /\.slice\(0\s*,\s*[\w.]+\)/);
});

test("cards use static lazy screenshots and exactly the real menu actions", () => {
  const script = inlineScripts().join("\n");
  assert.doesNotMatch(page, /<iframe\b/i);
  assert.match(script, /\.loading\s*=\s*["']lazy["']/i);
  assert.match(script, /(?:\.onerror\s*=|addEventListener\(["']error["'])/);
  assert.match(page, /(?:shotnone|shot-empty|No preview image|Preview unavailable)/i);

  // THE SEND IS IN THE KEBAB. The owner opened this menu looking for it and
  // found five read-only actions; the send was two clicks deeper, inside the
  // drawer, below four other blocks. Both spellings are here because a card
  // that has already been sent offers to send it AGAIN rather than saying
  // nothing about what already happened.
  const actions = [...script.matchAll(/menuItem\(["']([^"']+)["']\s*,/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(actions)].sort(),
    ["copy-id", "copy-site", "details", "open-report", "open-site", "resend-proof", "send-proof"]);
  for (const label of [
    "Email this proof to me", "Email it to me again",
    "Open website", "Open report", "Copy site link", "Copy prospect ID", "Everything we know",
  ]) assert.match(page, new RegExp(label));
  // Delete exists now, but ONLY as the guarded archived-card action: it is
  // built in script behind item.archived, never as static markup an active
  // card could render, and there is still no Rename anywhere.
  assert.doesNotMatch(page, />\s*(?:Delete|Rename)\b/i);
  assert.match(script, /textContent="Delete forever"/);
  assert.match(script, /if\(item\.archived\)\{/);

  // Both send items route through the shared confirm-then-send path, so
  // neither can become a one-click send by a later edit.
  assert.match(script, /menuItem\(["']send-proof["'],function\(\)\{askThenSend\(\[item\]\);\}\)/);
  assert.match(script, /menuItem\(["']resend-proof["'],function\(\)\{askThenSend\(\[item\]\);\}\)/);
  // Offered only where the server said the route would take it, and FIRST in
  // the panel rather than under the read-only actions.
  assert.match(script, /if\(canSendItem\(item\)\)\{\s*if\(text\(item\.lastSentAt,""\)\)/);
  assert.ok(script.indexOf('menuItem("send-proof"') < script.indexOf('menuItem("details"'),
    "the send must sit above the read-only actions, not under them");

  assert.match(script, /setAttribute\(["']aria-haspopup["']\s*,\s*["']menu["']\)/);
  assert.match(script, /setAttribute\(["']aria-expanded["']/);
  assert.match(script, /setAttribute\(["']role["']\s*,\s*["']menu["']\)/);
  assert.match(page, /role=["']menuitem["']/, "menuitem role rides on the templates once, not re-set per clone");
  assert.match(script, /(?:event|e)\.key\s*===?\s*["']Escape["']/);
  assert.match(script, /document\.addEventListener\(["']click["']/);
  assert.match(page, /aria-live=[\\"']polite[\\"']/);
});

test("the owner-powers redesign: screenshot-first cards, plain lines, real actions, guarded delete", () => {
  const script = inlineScripts().join("\n");

  // SCREENSHOT FIRST, NAME BIG, THEN EXACTLY TWO PLAIN LINES. The preview is
  // the card's top (aspect-locked), the name is the loudest text on it, line
  // one reads "Trade · City, ST", and line two is the plain status chip.
  assert.match(page, /\.business-name\{[^}]*font-size:19px/);
  assert.match(page, /\.preview\{[^}]*aspect-ratio:16\/10/);
  assert.match(script, /join\(" · "\)\s*\|\|\s*"Trade and city not set/);
  assert.match(script, /var chip=voiceChip\(item\);/);
  assert.match(script, /status\.textContent=chip\.label;/);

  // THE ACTIONS, ON THE FACE OF THE CARD, IN PLAIN WORDS. The four things the
  // owner does to a website are labeled buttons, not icons behind a kebab.
  for (const label of ["Open website", "Edit details", "Rebuild", "Archive"]) {
    assert.match(script, new RegExp(`textContent="${label}"`));
  }
  // An archived card swaps Archive for Restore + Delete forever. Delete is
  // never offered on an active card, and the button is only constructed
  // inside the archived branch.
  assert.match(script, /textContent="Restore"/);
  assert.match(script, /if\(item\.archived\)\{[\s\S]{0,1600}?textContent="Delete forever"/);

  // THE INLINE EDITOR: five fields, no invented ones, no page navigation, and
  // the server's returned record is the truth the card re-renders from.
  assert.match(script, /function openEditor\(article,item\)/);
  for (const field of ["Business name", "Trade", "City", "State", "Your private notes"]) {
    assert.match(script, new RegExp(`"${field}"`));
  }
  assert.match(script, /payload\.business_name=/);
  assert.match(script, /payload\.industry=/);
  assert.match(script, /payload\.notes=/);
  assert.ok(script.includes('var payload={action:"notes",prospectId:id};'),
    "the edit posts to gallery-manage's notes action, five fields and nothing else");
  assert.match(script, /result&&result\.ok&&result\.site/);
  assert.match(script, /copy\.businessName=text\(result\.site\.businessName/);
  // An untouched notes box cannot wipe notes it has never seen: notes ride
  // along only once they are known (typed now, or returned by a save).
  assert.match(script, /item\.notesKnown===true\)payload\.notes=/);

  // THE TYPED-NAME DELETE GUARD. The destructive button stays disabled until
  // the typed name matches the card's, and the request carries the name for
  // the server to check a second time. No undo is invented: the endpoint
  // returns none, so the toast says "deleted forever" and nothing softer.
  assert.match(script, /typedName:name,/);
  assert.match(script, /askGo\.disabled=typed!==wanted\|\|askBusy;/);
  assert.match(script, /action:"delete",prospectId:id,confirm:name/);
  assert.match(script, /payload\.deleted\|\|payload\.teardownPending/);
  assert.match(script, /retired forever\./);

  // THE BULK BAR carries the reversible pair beside the owner-proof send,
  // and its send button's label names the destination.
  assert.match(page, /id="batchArchive"/);
  assert.match(page, /id="batchRestore"/);
  assert.match(page, />Email proofs to me</);
  assert.match(script, /runBatchManage\("archive"/);
  assert.match(script, /runBatchManage\("restore"/);

  // FILTERS IN PLAIN WORDS. "Show only…" trades, statuses as "plain (code)".
  assert.match(page, /Show only/);
  assert.match(page, /id="tradeFilter"/);
  assert.match(page, /id="statusFilter"/);
  assert.match(script, /chipLabelWithCode\(\{status:key\}\)/);

  // THE EMPTY STATE hands the owner one honest next step, not a dead end.
  assert.match(script, /Find new customers/);
  assert.match(script, /href:"\/console"/);

  // NO PREVIEW IS NEVER A FAKE: the honest tile says a screenshot comes at
  // inspection, and the fallback stays our own mark and words.
  assert.match(page, /No preview yet — one is captured at inspection/);
});

test("gallery carries the console tokens and mobile/accessibility guards", () => {
  for (const token of ["--carbon", "--ice", "--signal", "--hair", "--mono", "--sans"]) assert.match(page, new RegExp(token));
  assert.match(page, /\*\s*\{\s*box-sizing\s*:\s*border-box/i);
  assert.match(page, /overflow-x\s*:\s*hidden/i);
  assert.match(page, /min-width\s*:\s*0/i);
  assert.match(page, /:focus-visible/i);
  assert.match(page, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/i);
  const mobileBreakpoints = [...page.matchAll(/@media\s*\(max-width\s*:\s*(\d+)px\)/gi)].map((match) => Number(match[1]));
  assert.ok(mobileBreakpoints.some((width) => width >= 390 && width <= 600), "390px needs a narrow-screen layout breakpoint");
  assert.match(page, /grid-template-columns\s*:\s*1fr/i);
  assert.doesNotMatch(page, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(page, /<link[^>]+\bhref=["']https?:/i);
});

test("gallery polish: clickable cards, sticky dock, board cards, sort, calm re-renders", () => {
  const script = inlineScripts().join("\n");

  // The whole card is the open-live-site gesture (new tab, reverse-tabnabbing safe);
  // the kebab keeps the secondary actions.
  assert.match(script, /preview-link/);
  assert.match(script, /\.target=["']_blank["']/);
  const rels = [...script.matchAll(/\.rel=["']([^"']+)["']/g)].map((match) => match[1]);
  assert.ok(rels.length >= 2 && rels.every((rel) => rel.includes("noopener")),
    "every programmatic _blank link must carry noopener");
  assert.match(page, /\.preview-link::after\{[^}]*inset:0/,
    "the stretched link covers the preview surface (scoped to the shot so the card-face buttons stay clickable)");
  assert.match(page, /\.preview-link:focus-visible/, "card link needs a visible keyboard focus ring");

  // Card feet: the unreadable 9px slug is gone, and the board status pill is
  // filled, readable, and uses the board's neutral/green/amber/rose/violet
  // semantics. (The data-prospect-id ATTRIBUTE stays — the enterprise overlay
  // keys its card actions off it — but no slug is ever printed as card text.)
  assert.doesNotMatch(page, />\s*prospect-id\s*</i);
  assert.doesNotMatch(page, /class=["'][^"']*prospect-id/);
  assert.match(page, /\.gallery\{[^}]*gap:16px/);
  assert.match(page, /@media\(max-width:480px\)\{[\s\S]*?\.gallery\{gap:12px\}/);
  assert.match(page, /\.site-card\{[^}]*border-radius:16px/);
  assert.match(page, /\.site-card:hover\{[^}]*translateY\(-3px\)[^}]*border-color:rgba\(255,255,255,\.14\)/);
  assert.doesNotMatch(page, /\.site-card:hover\{[^}]*box-shadow/);
  assert.match(page, /\.preview-link::after\{[^}]*border-radius:15px 15px 0 0/,
    "the overlay matches the preview socket's own corners");
  assert.match(page, /\.preview\{[^}]*border-radius:15px 15px 0 0/);
  assert.match(page, /\.card-body\{[^}]*padding:18px/);
  assert.match(page, /\.status\{[^}]*padding:4px 9px[^}]*border:0[^}]*border-radius:999px[^}]*background:rgba\(255,255,255,\.07\)[^}]*font:600 11\.5px\/1 var\(--sans\)/);
  assert.match(page, /\.status::before\{[^}]*width:6px[^}]*height:6px/);
  for (const tone of ["ok", "warn", "bad", "done"]) {
    assert.match(page, new RegExp(`\\.status\\.${tone}\\{[^}]*background:rgba\\(`));
  }
  assert.match(script, /archived\)\|\|\/\(\?:\^\|\[_ -\]\)completed\?\(\?:\$\|\[_ -\]\)\/\.test\(value\)\)return ["']done["']/,
    "archived and completed records share the violet board status");
  assert.match(page, /Copy prospect ID/, "the ID stays reachable from the kebab");

  // Sticky dock: html owns overflow-x; body must NOT re-clip it or sticky dies.
  assert.match(page, /html\{[^}]*overflow-x:hidden/);
  assert.doesNotMatch(page, /body\{[^}]*overflow-x:hidden/);
  assert.match(page, /\.controls\{position:sticky/);

  // Search: debounced, and re-renders never replay the entry animation.
  assert.match(script, /SEARCH_DEBOUNCE\s*=\s*120\b/);
  assert.match(script, /animation\s*=\s*["']none["']/);

  // Equal card feet: flex column card with the foot pinned to the bottom.
  assert.match(page, /\.site-card\{[^}]*flex-direction:column/);
  assert.match(page, /\.card-foot\{[^}]*margin-top:auto/);

  // Verticals render display-cased, never as raw DB tokens.
  assert.match(script, /HVAC/);

  // `line_queued` is a post-build outreach state. The card must not imply the
  // site still waits to be built, and an empty dated timeline must not deny a
  // mirror URL the same drawer just rendered above it. The plain label now
  // comes from the shared voice snapshot (operator-voice when present, the
  // page's fallback otherwise), so the owner reads English, never "Line Queued".
  assert.match(page, /"line_queued":\{"label":"/);
  assert.match(script, /var VOICE=\{"source":"(?:operator-voice|gallery-fallback)"/);
  assert.ok(page.includes("Waiting in line to be built") || page.includes("Waiting for your OK"),
    "line_queued must render as an English sentence in every voice");
  assert.match(page, /✓ Passed final inspection/, "the gate-passed chip carries its green-dot plain label");
  assert.match(script, /A site URL is on file above, but no dated build or send events were recorded/);
  assert.doesNotMatch(script, /Nothing has been sent or built for this business yet/);
  assert.match(script, /A successful Line build state and site URL are still on file/);
  assert.match(script, /no later successful-build timestamp is stored here, so it remains unresolved/);

  // Sort control: the three real options, no server round-trip.
  const sortSelect = page.match(/<select[^>]*id=["']sortSelect["'][\s\S]*?<\/select>/i);
  assert.ok(sortSelect, "dock needs the sort select");
  for (const value of ["newest", "name", "vertical"]) {
    assert.match(sortSelect[0], new RegExp(`value=["']${value}["']`));
  }
  assert.match(script, /localeCompare/);

  // Archive visibility: the count is surfaced next to the toggle.
  assert.match(page, /id=["']archivedCount["']/);

  // Load-more: IntersectionObserver is primary; the manual button must not
  // double-fire alongside it.
  assert.match(script, /loadMore\.hidden\s*=\s*true/);
});

test("every gallery thumbnail has a branded first-paint fallback and validated image swap", () => {
  const script = inlineScripts().join("\n");

  // The fallback is the official WSS signal mark, not the old generic window.
  assert.match(script, /M12 24 L21 42 L30 26 L39 42 L50 20/);
  assert.match(script, /galleryPreviewSignal["']\+\(\+\+previewMarkSequence\)/,
    "each fallback SVG needs a unique gradient id");
  assert.match(script, /start\.setAttribute\(["']stop-color["'],["']#4A6CF7["']\)/);
  assert.match(script, /end\.setAttribute\(["']stop-color["'],["']#8B5CF6["']\)/);
  assert.match(script, /path\.setAttribute\(["']stroke["'],["']url\(#["']\+gradientId\+["']\)["']\)/);
  assert.match(script, /glow\.setAttribute\(["']r["'],["']7["']\)/);
  assert.match(script, /glow\.setAttribute\(["']fill["'],["']#34D399["']\)/);
  assert.match(script, /dot\.setAttribute\(["']r["'],["']4["']\)/);
  assert.match(script, /dot\.setAttribute\(["']fill["'],["']#34D399["']\)/);
  assert.doesNotMatch(script, /inner\.appendChild\(icon\(["']M3 5h18v14H3zM3 9h18M8 5v4["']\)\)/,
    "the preview fallback must not use the old generic window icon");
  assert.match(page, /\.preview-empty\{[^}]*radial-gradient[^}]*linear-gradient/);

  // Every socket starts on the visible fallback. A valid >=50px image swaps
  // in; errors and junk dimensions stay on the fallback with no broken icon.
  assert.match(script, /preview\.dataset\.previewState=["']fallback["']/);
  assert.match(page, /\.preview img\{[^}]*visibility:hidden/,
    "the lazy image stays loadable while the fallback covers it");
  assert.match(page, /\.preview\[data-preview-state="image"\] img\{visibility:visible\}/);
  assert.doesNotMatch(script, /image\.hidden=true/,
    "display:none can prevent a lazy image from ever loading");
  assert.match(script, /function setPreviewState\(preview,image,fallback,ready\)/);
  assert.match(script, /fallback\.hidden=true;\s*preview\.dataset\.previewState=["']image["']/);
  assert.match(script, /fallback\.hidden=false;\s*preview\.dataset\.previewState=["']fallback["']/);
  // The handlers may relabel the empty tile on their way through (a 1x1 spacer
  // means "never captured", a network error means "unavailable"), but the
  // readiness decision itself is still the only thing that flips the socket.
  assert.match(script, /addEventListener\(["']error["'],function\(\)\{[\s\S]{0,200}?setPreviewState\(preview,image,fallback,false\);/);
  assert.match(script, /var ready=image\.naturalWidth>=50&&image\.naturalHeight>=50;/);
  assert.match(script, /addEventListener\(["']load["'],function\(\)\{[\s\S]{0,400}?setPreviewState\(preview,image,fallback,ready\);/);
  assert.doesNotMatch(script, /fallback\.hidden=true;\s*var image=/,
    "the fallback must stay visible while a lazy image is still loading");
});

test("the public gallery shell renders its client-side token gate without a request header", async () => {
  const res = fakeTextRes();
  await galleryPageHandler({ method: "GET", url: "/gallery", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/html/);
  assert.equal(res.body, servedPage);
  assert.match(res.body, /type=["']password["']/);
  // This is the actual handler output, not merely the editable base template.
  // A Gallery rebuild is an operator-only, no-send queue operation; it must
  // never drift back to the consent-gated preview builder.
  const rebuildScript = res.body.slice(res.body.indexOf("function askRebuild"));
  assert.match(rebuildScript, /api\/admin\/rebuild-mirror/);
  assert.doesNotMatch(rebuildScript, /api\/admin\/build-preview/);
  assert.doesNotMatch(rebuildScript, /forceFreshDispatch\s*:\s*true/);

  const rejected = fakeJsonRes();
  await galleryPageHandler({ method: "POST", url: "/gallery", headers: {} }, rejected);
  assert.equal(rejected.statusCode, 405);
});

test("gallery data requires x-admin-token and returns only signed, contact-free rows", async (t) => {
  const priorToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "gallery-test-token";
  t.after(() => {
    if (priorToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorToken;
  });

  const prospects = [
    {
      prospect_id: "p-slug",
      owner_email: "slug-owner@private.test",
      phone: "+1-555-0101",
      status: "built",
      updated_at: "2026-08-02T00:00:00.000Z",
      business_name: "Slug Plumbing",
      city: "Tulsa",
      state: "OK",
      industry: "plumbing",
      preview_url: "https://unrelated-preview.wss-ai.com",
      report_url: "https://reports.wss-ai.com/p-slug",
      desired_domain: "paid-domain.example",
    },
    {
      prospect_id: "p-archived",
      owner_email: "archived@private.test",
      status: "archived_legacy",
      updated_at: "2026-08-05T00:00:00.000Z",
      business_name: "Old Roofing",
      city: "Dallas",
      state: "TX",
      industry: "roofing",
      preview_url: "https://paid-archived.wss-ai.com",
    },
    {
      prospect_id: "p-email",
      owner_email: "EMAIL-CLIENT@PRIVATE.TEST",
      status: "ready",
      updated_at: "2026-08-03T00:00:00.000Z",
      business_name: "Email HVAC",
      city: "Mesa",
      state: "AZ",
      industry: "hvac",
      preview_url: "https://email-client.wss-ai.com",
      report_url: "https://reports.wss-ai.com/p-email",
    },
    {
      prospect_id: "p-free",
      owner_email: "free@private.test",
      phone: "+1-555-0103",
      status: "built",
      updated_at: "2026-08-04T00:00:00.000Z",
      business_name: "Free Electric",
      city: "Reno",
      state: "NV",
      industry: "electrical",
      preview_url: "https://free-build.wss-ai.com",
    },
    {
      prospect_id: "p-no-mirror",
      owner_email: "no-mirror@private.test",
      status: "new",
      updated_at: "2026-08-06T00:00:00.000Z",
      business_name: "No Mirror Yet",
      phone: "+1-555-0199",
    },
  ];
  const access = [
    { job_id: "paid-slug-job", site_slug: "paid-domain-example", owner_email: "other@private.test" },
    { job_id: "paid-email-job", site_slug: "other", owner_email: "email-client@private.test" },
    { job_id: "paid-archive-job", site_slug: "paid-archived", owner_email: "archived@private.test" },
    { job_id: "prospect-free", site_slug: "free-build", owner_email: "free@private.test" },
  ];
  const selects = [];
  const signed = [];
  const handler = createGalleryDataHandler({
    select: async (table, query) => {
      selects.push({ table, query });
      if (table === "ghost_agency_prospects") return { ok: true, data: prospects };
      // The Line's own row table is read now too, so that mirrors built through
      // a batch surface even before the prospect row catches up. Answering it
      // (with nothing) keeps this the HEALTHY path — a throw here would quietly
      // turn every assertion below into a degraded-read test.
      if (table === "ghost_agency_line_batch_rows") return { ok: true, data: [] };
      // Batch state (halted/superseded) is the same kind of optional read.
      if (table === "ghost_agency_line_batches") return { ok: true, data: [] };
      if (table === "ghost_agency_dashboard_access") return { ok: true, data: access };
      if (table === "ghost_agency_events") return { ok: true, data: [] };
      if (table === "ghost_agency_email_log") return { ok: true, data: [] };
      throw new Error(`unexpected table: ${table}`);
    },
    signedVisualPath: (args) => {
      signed.push(args);
      return `/api/admin/proof-shot?preview=${encodeURIComponent(args.previewUrl)}`;
    },
  });

  const missing = fakeJsonRes();
  await handler(request("GET"), missing);
  assert.equal(missing.statusCode, 401);
  assert.equal(selects.length, 0, "authentication must happen before either data read");

  const post = fakeJsonRes();
  await handler(request("POST", "gallery-test-token"), post);
  assert.equal(post.statusCode, 405);
  assert.equal(selects.length, 0, "the endpoint is GET-only and read-only");

  const res = fakeJsonRes();
  await handler(request("GET", "gallery-test-token"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.builds.map((row) => row.prospectId), ["p-archived", "p-free", "p-email", "p-slug"]);
  assert.deepEqual(res.body.clients.map((row) => row.prospectId), ["p-email", "p-slug"],
    "paid joins work by email or the desired-domain site slug, while archived and prospect-* access rows stay out");
  assert.equal(res.body.builds.find((row) => row.prospectId === "p-archived").archived, true);
  assert.equal(res.body.builds.find((row) => row.prospectId === "p-free").reportUrl, "");

  for (const row of [...res.body.clients, ...res.body.builds]) {
    assert.deepEqual(Object.keys(row).sort(), SAFE_ROW_KEYS);
    assert.match(row.shotUrl, /^\/api\/admin\/proof-shot\?/);
    assert.match(row.shotUrl, /[?&]c=\d{8}$/,
      "shot URLs must rotate a daily cache window so re-captured screenshots surface within a day");
    assert.doesNotMatch(row.shotUrl, /<iframe/i);
  }
  assert.equal(payloadKeys(res.body).some((key) => /(?:e-?mail|phone)/i.test(key)), false);
  assert.doesNotMatch(JSON.stringify(res.body), /private\.test|555-01/);
  assert.deepEqual(signed.map(({ kind }) => kind), ["new", "new", "new", "new"]);
  assert.deepEqual(signed.map(({ previewUrl }) => previewUrl), res.body.builds.map((row) => row.previewUrl));

  // Eight reads: the three the page cannot render without (prospects, the
  // Line's own built rows, and the paid-access join) and the five that only
  // decorate a card or the page frame (the Line batches' halted state, the
  // two send histories, the ONE-row campaign-clock read off the newest active
  // batch, and the prospect bank's read-only per-vertical census — a
  // two-scalar projection on the prospects table; a failed read leaves the
  // gallery standing with bankRead:false). Nothing else is touched.
  assert.deepEqual(selects.map(({ table }) => table),
    ["ghost_agency_prospects", "ghost_agency_line_batch_rows", "ghost_agency_line_batches", "ghost_agency_dashboard_access", "ghost_agency_events", "ghost_agency_email_log", "ghost_agency_line_batches", "ghost_agency_prospects"]);
  const bankCensusQuery = new URLSearchParams(selects[7].query.replace(/^\?/, ""));
  assert.equal(bankCensusQuery.get("record->>bank_status"), "eq.banked",
    "the census counts banked rows only — reserved/exhausted are working capital");
  assert.match(bankCensusQuery.get("select") || "", /^prospect_id,vertical:record->prospect_bank->>vertical$/,
    "the census projects two scalars, never the contact-bearing record blob");
  const prospectQuery = new URLSearchParams(selects[0].query.replace(/^\?/, ""));
  assert.equal(prospectQuery.get("order"), "updated_at.desc");
  assert.equal(prospectQuery.get("limit"), "500");
  assert.equal(prospectQuery.get("preview_url"), "not.is.null");
  assert.match(selects[0].query, /preview_url=not\.is\.null&status=not\.in\.\(retiring,retired\)&order=updated_at\.desc&limit=500/);
  const prospectSelect = prospectQuery.get("select").split(",");
  assert.ok(prospectSelect.includes("desired_domain:record->>desired_domain"), "join needs only the desired-domain scalar projection");
  // LIVE FAILURE, LEFT STANDING ON PURPOSE. Commit 33695be ("Show live Line
  // builds in Gallery") added the whole `record` blob to PROSPECT_QUERY, and
  // api/admin/gallery-data.js now reads record.owner_email / record.business_name
  // out of it. Until that commit this assertion was reachable and green; since
  // then the table-list mismatch a few lines below hid it. This is a product
  // change in api/admin/gallery-data.js, not a stale string — the fix belongs
  // there (project the scalars it actually needs), not here. The response is
  // still contact-free (asserted above), so what regressed is the width of the
  // server-side read, not what reaches the browser.
  assert.equal(prospectSelect.includes("record"), false, "the large contact-bearing record blob must not be selected");
  assert.equal(prospectSelect.includes("phone"), false);
  // The paid-access join moved again: the Line-row read landed at index 1 and
  // the Line-batch (halted/superseded) annotation at index 2, so the join is
  // now selects[3] — an index assert would silently drift otherwise.
  const accessSelect = selects[3];
  assert.equal(accessSelect.table, "ghost_agency_dashboard_access");
  const accessQuery = new URLSearchParams(accessSelect.query.replace(/^\?/, ""));
  assert.equal(accessQuery.get("job_id"), "not.like.prospect-*");
  assert.equal(accessQuery.get("limit"), "500");
  assert.match(accessSelect.query, /job_id=not\.like\.prospect-\*&limit=500/);
});

test("gallery shot URLs carry the daily cache window in the preview-shot `c` param", () => {
  // The signed key is HMAC-of-preview-URL only and the endpoint serves
  // week-long immutable cache headers, so a backfilled JPEG would hide behind
  // cached spacers for up to 7 days. `c` is the endpoint's hex-validated
  // fingerprint param (and part of its warm-cache key): rotating it daily
  // bounds staleness at 24h. Both stamps tolerate a midnight rollover.
  const stamps = [shotCacheWindow()];
  const row = { prospect_id: "p1", status: "built", business_name: "Biz", preview_url: "https://x.wss-ai.com" };

  const withQuery = safeGalleryRow(row, () => "/api/media/preview-shot?k=abc&s=sig&v=new");
  const bare = safeGalleryRow(row, () => "/signed/x");
  stamps.push(shotCacheWindow());

  assert.match(stamps[0], /^\d{8}$/);
  assert.match(stamps[0], /^[0-9a-f]{6,64}$/i, "the stamp must satisfy preview-shot's `c` validation regex");
  assert.ok(stamps.some((stamp) => withQuery.shotUrl === `/api/media/preview-shot?k=abc&s=sig&v=new&c=${stamp}`),
    `got ${withQuery.shotUrl}`);
  assert.ok(stamps.some((stamp) => bare.shotUrl === `/signed/x?c=${stamp}`), `got ${bare.shotUrl}`);
  assert.equal(shotCacheWindow(new Date("2026-08-08T23:59:59.000Z")), "20260808");

  assert.equal(safeGalleryRow(row, () => "").shotUrl, null, "an unsignable shot stays an honest null, never a bare bust param");
  assert.equal(safeGalleryRow({ ...row, preview_url: "" }, () => "/x").shotUrl, null);
});

test("gallery data still caps an over-returning source at 500 newest builds", async (t) => {
  const priorToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "gallery-cap-token";
  t.after(() => {
    if (priorToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorToken;
  });

  const prospects = Array.from({ length: 505 }, (_, index) => ({
    prospect_id: `p${index}`,
    status: "built",
    updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    business_name: `Build ${index}`,
    preview_url: `https://build-${index}.wss-ai.com`,
  }));
  const handler = createGalleryDataHandler({
    select: async (table) => ({
      ok: true,
      data: table === "ghost_agency_prospects" ? prospects : [],
    }),
    signedVisualPath: ({ previewUrl }) => `/signed/${new URL(previewUrl).hostname}`,
  });
  const res = fakeJsonRes();
  await handler(request("GET", "gallery-cap-token"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.builds.length, 500);
  assert.equal(res.body.builds[0].prospectId, "p504");
  assert.equal(res.body.builds[499].prospectId, "p5");
});

test("the card says when it was last emailed, and only when that is a measured fact", () => {
  const script = inlineScripts().join("\n");
  const now = new Date();
  const rows = [
    { prospect_id: "p-proof", status: "built", business_name: "Proofed", preview_url: "https://a.wss-ai.com" },
    { prospect_id: "p-never", status: "built", business_name: "Never", preview_url: "https://b.wss-ai.com" },
  ];
  const index = lastSendIndex({
    proofRows: [
      { prospect_id: "p-proof", created_at: "2026-08-09T10:00:00.000Z" },
      { prospect_id: "p-proof", created_at: "2026-08-02T10:00:00.000Z" },
    ],
    emailLogRows: [{ prospect_id: "p-proof", sent_at: "2026-07-27T10:00:00.000Z" }],
  });
  const sign = ({ previewUrl }) => `/signed/${new URL(previewUrl).hostname}`;

  const proofed = safeGalleryRow(rows[0], sign, index);
  assert.equal(proofed.lastSentAt, "2026-08-09T10:00:00.000Z", "the NEWEST send wins, not the first row seen");
  assert.equal(proofed.lastSentKind, "proof");
  const never = safeGalleryRow(rows[1], sign, index);
  assert.equal(never.lastSentAt, "", "a business with no send carries no date, not a fabricated one");
  assert.equal(never.lastSentKind, "");

  // A real prospect send is labelled as one. The two channels are never merged
  // into a single unattributed "emailed" — one of them means a business was
  // contacted and the other explicitly means it was not.
  const businessNewer = lastSendIndex({
    proofRows: [{ prospect_id: "p1", created_at: "2026-07-01T00:00:00.000Z" }],
    emailLogRows: [{ prospect_id: "p1", sent_at: "2026-08-01T00:00:00.000Z" }],
  });
  assert.deepEqual(businessNewer.get("p1"), { when: "2026-08-01T00:00:00.000Z", kind: "business" });
  assert.match(script, /"Emailed the business":"Proof emailed to you"/);

  // Rows with no usable timestamp or id contribute nothing rather than a
  // "Invalid Date" line on a card.
  const junk = lastSendIndex({ proofRows: [{ prospect_id: "", created_at: "x" }, { created_at: "2026-01-01" }] });
  assert.equal(junk.size, 0);
  assert.ok(now instanceof Date);
});

test("gallery data reports the ONE destination, and a failed history read never blanks the catalogue", async (t) => {
  const priorToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "gallery-send-token";
  t.after(() => {
    if (priorToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorToken;
  });

  const prospects = [
    { prospect_id: "p-ok", status: "line_queued", business_name: "Sendable", updated_at: "2026-08-09T00:00:00.000Z", preview_url: "https://sendable.wss-ai.com" },
    // A non-wss host is exactly what api/admin/send-mirror-proof refuses, so
    // the card must not offer the action at all.
    { prospect_id: "p-bad-host", status: "line_queued", business_name: "Wrong Host", updated_at: "2026-08-08T00:00:00.000Z", preview_url: "https://siteforge-app-rocketsites.vercel.app/try/x/" },
  ];
  const queries = [];
  function handlerWith(historyOk) {
    return createGalleryDataHandler({
      env: { GHOST_AGENCY_OWNER_EMAIL: "owner@example.test" },
      select: async (table, query) => {
        queries.push({ table, query });
        if (table === "ghost_agency_prospects") return { ok: true, data: prospects };
        if (table === "ghost_agency_dashboard_access") return { ok: true, data: [] };
        if (!historyOk) throw new Error("history source down");
        if (table === "ghost_agency_events") return { ok: true, data: [{ prospect_id: "p-ok", created_at: "2026-08-10T12:00:00.000Z" }] };
        if (table === "ghost_agency_email_log") return { ok: true, data: [] };
        throw new Error(`unexpected table: ${table}`);
      },
      signedVisualPath: ({ previewUrl }) => `/signed/${new URL(previewUrl).hostname}`,
    });
  }

  const res = fakeJsonRes();
  await handlerWith(true)(request("GET", "gallery-send-token"), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.send, {
    recipient: "owner@example.test",
    canSend: true,
    headline: "Every email on this page goes to owner@example.test — your own inbox. The business is never emailed.",
  });
  // lineHistoryRead is false here because this fixture's select() answers only
  // the tables it declares; the point of `sources` is that the page is TOLD
  // which reads landed, and an unread one is reported as unread rather than
  // silently rendered as "nothing was ever built". batchStateRead is false for
  // the same reason — the batch annotation degrades to silence, never blocks.
  // bankRead is true because this fixture's prospects table answers the bank
  // census read too (its rows simply carry no bank dimension: an empty census).
  // campaignTimingRead is false the same way as batchStateRead: this fixture's
  // select() never answers the campaign-clock read, so the clock strip stays
  // hidden.
  assert.deepEqual(res.body.sources, { proofHistoryRead: true, sendHistoryRead: true, lineHistoryRead: false, batchStateRead: false, campaignTimingRead: false, bankRead: true });
  const byId = Object.fromEntries(res.body.builds.map((row) => [row.prospectId, row]));
  assert.equal(byId["p-ok"].sendable, false,
    "a prospect preview without a matching signed Line release is display-only");
  assert.equal(byId["p-ok"].lastSentAt, "2026-08-10T12:00:00.000Z");
  assert.equal(byId["p-bad-host"].sendable, false, "a host the send route refuses must not be offered a send");

  // The proof query filters on the event type the send route writes, and asks
  // for two scalars — never the payload body, which is where addresses live.
  const proofQuery = queries.find(({ table, query }) => table === "ghost_agency_events" && /mirror_proof_sent/.test(query));
  assert.ok(proofQuery, "the proof history must be read from the operator event channel");
  assert.match(proofQuery.query, /select=prospect_id:payload->>prospect_id,created_at/);
  assert.doesNotMatch(proofQuery.query, /select=[^&]*\bpayload\b(?!->>)/);

  // Every optional read down: the gallery still lists every build and simply
  // reports that it could not look, rather than 503-ing or implying nothing
  // was ever sent. The bank census follows its fixture's prospects answer
  // like the healthy pass above, so bankRead stays true here.
  const degraded = fakeJsonRes();
  await handlerWith(false)(request("GET", "gallery-send-token"), degraded);
  assert.equal(degraded.statusCode, 200);
  assert.equal(degraded.body.builds.length, 2);
  assert.deepEqual(degraded.body.sources, { proofHistoryRead: false, sendHistoryRead: false, lineHistoryRead: false, batchStateRead: false, campaignTimingRead: false, bankRead: true });
  assert.equal(degraded.body.builds.every((row) => row.lastSentAt === ""), true);

  // No owner inbox configured: the page is told it cannot send, in words.
  const unconfigured = fakeJsonRes();
  await createGalleryDataHandler({
    env: {},
    select: async (table) => ({ ok: true, data: table === "ghost_agency_prospects" ? prospects : [] }),
    signedVisualPath: ({ previewUrl }) => `/signed/${new URL(previewUrl).hostname}`,
  })(request("GET", "gallery-send-token"), unconfigured);
  assert.equal(unconfigured.body.send.canSend, false);
  assert.match(unconfigured.body.send.headline, /no owner inbox is configured/i);
});

test("the batch is the same gated single send, run once per business, and says so before the press", () => {
  const script = inlineScripts().join("\n");

  // ONE ROUTE. The batch does not get a bulk endpoint of its own — it loops
  // the same owner-proof route, so every gate that guards one send guards all
  // of them and there is no second code path to keep honest. The rehearsal is
  // the SAME loop with dryRun:true, not a second implementation. (prospectIds
  // bodies exist on this page now, but only for gallery-manage's reversible
  // archive/restore — the send body below stays one prospect at a time.)
  assert.equal((script.match(/api\("\/api\/admin\/send-mirror-proof"/g) || []).length, 2,
    "the drawer button and the batch runner, both on the one owner-proof route");
  assert.doesNotMatch(script, /send-mirror-proof-batch/);
  assert.doesNotMatch(script, /send-mirror-proof[\s\S]{0,160}prospectIds/);
  assert.match(script, /body:JSON\.stringify\(\{prospectId:item\.prospectId,dryRun:check===true\}\)/);
  assert.match(script, /confirmGo\.onclick=function\(\)\{runSend\(list,rows,false\);\}/);
  assert.match(script, /confirmCheck\.onclick=function\(\)\{runSend\(list,rows,true\);\}/);
  // A rehearsal must not mark anything as sent, and must say nothing went.
  assert.match(script, /if\(!check\)markSent\(item,""\)/);
  assert.match(script, /Nothing was sent/);
  assert.match(script, /check\?"Would refuse":"Refused"/);
  assert.match(script, /check\?"Would not send — ":"Not sent — "/);

  // Refusal codes reach the owner as sentences, from the one shared table.
  assert.match(script, /var REFUSALS=\{/);
  assert.match(script, /REFUSALS\[code\]/);
  assert.ok(script.includes("it needs re-shooting"),
    "the commonest real refusal (57 of 80) must read as a sentence, not a code");

  // The confirmation answers the two questions worth answering: how many, and
  // to whom. Both come from the server's routing block, never a literal.
  assert.match(script, /confirmTitle\.textContent=many/);
  assert.match(script, /state\.routing\.recipient\+" — your own inbox"/);
  assert.match(script, /None of these "\+list\.length\.toLocaleString\(\)\+" businesses is emailed/);
  // Nothing runs by opening the dialog: runSend is reachable only from the two
  // confirm buttons, one of which cannot send.
  assert.equal((script.match(/runSend\(/g) || []).length, 3,
    "runSend is defined once and called from exactly the send button and the check button");

  // A refusal is attributed to the business it belongs to and the run
  // continues, so 11 sent and 1 refused is reported as exactly that.
  assert.match(script, /row\.status\.textContent=wordFail;/);
  assert.match(script, /\.finally\(function\(\)\{\s*report\(\);\s*step\(index\+1\);/);
  assert.match(script, /failed\?[\s\S]{0,120}refused/);

  // Selection now serves the management bar as well as the send batch, so a
  // checkbox rides on every card that names a business; what gets SENT is
  // still filtered to cards the route accepts, and "pick all" means what is
  // on screen — not everything the snapshot holds.
  assert.match(script, /if\(text\(item\.prospectId,""\)\)\{\s*var picker=/);
  assert.match(script, /var list=\(items\|\|\[\]\)\.filter\(canSendItem\)/);
  assert.match(script, /activeRows\(\)\.slice\(0,state\.visibleLimit\)\.forEach\(function\(item\)\{/);
  assert.match(script, /MAX_BATCH=100/);
  assert.match(script, /if\(list\.length>MAX_BATCH\)list=list\.slice\(0,MAX_BATCH\)/);

  // The dialog cannot be dismissed out from under a run in progress.
  assert.match(script, /function closeConfirm\(\)\{\s*if\(sendInFlight\)return;/);

  // What sent is unpicked; what was refused stays picked. Driven in Chromium:
  // a batch of three with one deliberate refusal leaves the bar reading
  // "1 site picked", so closing the panel hands back exactly the leftovers.
  assert.match(script, /if\(rows\[position\]\.status\.textContent==="Sent"\)setPicked\(item,false\);/);
  assert.match(script, /function syncPickedBoxes\(\)/);
  assert.equal((script.match(/syncPickedBoxes\(\)/g) || []).length, 4,
    "one definition, and every selection change the operator did not click goes through it");

  // The page-level statement of destination is the server's sentence, not a
  // hard-coded address that could drift.
  assert.match(page, /id=["']ownerNote["']/);
  assert.match(script, /ownerNote\.textContent=state\.routing\.headline/);
});

test("vercel routes /gallery to the self-contained gallery shell", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(config.rewrites.some((rewrite) => rewrite.source === "/gallery" && rewrite.destination === "/api/admin/gallery"));
});
