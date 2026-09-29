"use strict";

// lib/edit-verify.js — DID THE CHANGE ACTUALLY HAPPEN?
//
// =====================================================================
// THE MEASURED LIE THIS FILE EXISTS TO END
// =====================================================================
// Production, 2026-08-09, job edit_1786235976776_etudr8. A customer typed
// "Make the main headline text bright orange" into the dashboard chat. The job
// finished status=done, applied=true, selectors=["section#top"], and the panel
// told them: "Done — it's live on your site now."
//
// The rendered page:
//   section#top  color = rgb(255,102,0)            <- the CSS really did apply
//   h1           color = oklch(0.96 0.032 270.5)   <- UNCHANGED
//   h1 class     = "... text-bone ..."             <- a utility class wins
//   elements rendering #ff6600 inside the headline: 0
//
// The headline was still white. Every gate in site-change-plan.js passed,
// legitimately: the plan was valid, the selector was in the element catalog,
// the bytes changed, the archive matched, the deploy went READY. Not one of
// those facts is "the customer can see the change", and the only place that
// question can be answered is the rendered page.
//
// =====================================================================
// WHY IT DID NOT TAKE, AND THE RULE ADOPTED IN RESPONSE
// =====================================================================
// Measured in Chromium against the live mirror, injecting each candidate rule
// into the page and reading the h1's computed colour back:
//
//   section#top { color:#ff6600 }                 -> h1 oklch(0.96 …)  NO
//   h1 { color:#ff6600 }                          -> h1 rgb(255,102,0) YES
//   section#top h1 { color:#ff6600 }              -> h1 rgb(255,102,0) YES
//
// So this is NOT a specificity problem, and !important is NOT the fix. The
// mirrors compile their utilities into `@layer utilities` (verified: the
// stylesheet carries CSSLayerBlockRule "utilities"), and an UNLAYERED
// declaration — which is exactly what applyStyleOverride writes into <head> —
// outranks any layered one at any specificity. A bare `h1 { … }` already wins.
//
// What cannot be won is INHERITANCE. `color` on section#top only ever supplies
// a value to descendants that have none of their own, and every headline on
// these donors carries its own `text-*` utility. A rule on an ancestor is not a
// weaker version of a rule on the element; it is a rule about a different
// element that the element in question never consults.
//
//   THE RULE: AIM, DO NOT FORCE.
//   An inherited text property (colour, font, size, spacing, alignment) is set
//   on the element that HOLDS THE WORDS. The element catalog now offers those
//   elements — h1, h2, h3, p — so the planner can name them, and the planner
//   contract says so in as many words. Containers keep their own honest job:
//   backgrounds, filters, borders, padding, layout.
//
// Blanket !important was deliberately NOT adopted. It would have made this one
// case appear fixed while leaving the ancestor/descendant confusion in place —
// `section#top { color:#ff6600 !important }` STILL loses to `.text-bone`,
// because important-ness does not create inheritance. It trades a visible bug
// for an invisible one, which is the brief's own warning.
//
// =====================================================================
// AND WHEN AIM IS NOT ENOUGH — THE PART THAT MAKES THE REPORT HONEST
// =====================================================================
// Aiming better raises the hit rate. It cannot make a guarantee, because the
// next donor may carry an inline style, an !important utility, or a script that
// re-paints after load. So nothing here is trusted: after the deploy the page is
// RENDERED, and for every declaration the plan wrote we compare INTENT against
// the COMPUTED STYLE of the elements the selector actually matches.
//
// The comparison never parses a CSS value by hand. For each matched element the
// declaration is applied inline with !important, the computed value is read back
// as `want`, and the inline style is restored. `want` is therefore the exact
// computed string this declaration produces ON THAT ELEMENT — correct for every
// colour space, unit, percentage and keyword, with no colour parser to get
// wrong. The check is then a string comparison against what the page is
// actually rendering.
//
// If it did not take, the job is NOT done and the customer is told so.

/** Text properties that INHERIT — the ones an ancestor rule silently loses. */
const TEXT_INHERITED = new Set([
  "color",
  "font",
  "font-family",
  "font-size",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-indent",
  "text-shadow",
  "text-transform",
  "text-wrap",
  "word-spacing",
  "white-space",
  "-webkit-text-fill-color",
  "-webkit-text-stroke-color",
]);

/** How many matched elements / text runs one check will measure. */
const MAX_ELEMENTS = 12;
const MAX_LEAVES = 80;
const MAX_BLOCKERS = 4;

// ---------------------------------------------------------------------------
// Declaration parsing — what did this plan actually ask for?
// ---------------------------------------------------------------------------

/** Split on `ch` at depth 0, respecting parens, brackets and quotes. */
function splitTop(text, ch) {
  const out = [];
  let depth = 0;
  let quote = "";
  let buf = "";
  for (const c of String(text)) {
    if (quote) {
      buf += c;
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (c === ch && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += c;
  }
  out.push(buf);
  return out;
}

const PROPERTY_RE = /^-{0,2}[a-z][a-z0-9-]*$/;

/**
 * splitDeclarations("color:#ff6600; filter: saturate(1.4) !important")
 *   -> [{property:"color", value:"#ff6600", important:false}, …]
 *
 * Anything that is not a property/value pair is DROPPED rather than guessed at.
 * validateOverrideCss has already refused the shapes that matter (bare
 * declarations, at-rules, off-catalog selectors); this is only reading back what
 * survived, so a fragment it cannot understand simply goes unverified rather
 * than failing an edit that is fine.
 */
function splitDeclarations(text) {
  const out = [];
  for (const chunk of splitTop(String(text || ""), ";")) {
    const s = chunk.trim();
    if (!s) continue;
    const parts = splitTop(s, ":");
    if (parts.length < 2) continue;
    const property = parts[0].trim().toLowerCase();
    let value = parts.slice(1).join(":").trim();
    let important = false;
    if (/!\s*important\s*$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important\s*$/i, "").trim();
    }
    if (!property || !value) continue;
    if (!PROPERTY_RE.test(property)) continue;
    out.push({ property, value, important });
  }
  return out;
}

/**
 * declaredIntents(rules) -> [{ selector, property, value, important, inherited }]
 *
 * `rules` is what validateOverrideCss already returned: [{selector, declarations}].
 * One intent per (selector branch × declaration), because that is the grain at
 * which "did it take" has an answer.
 */
function declaredIntents(rules) {
  const out = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const decls = splitDeclarations(rule && rule.declarations);
    if (!decls.length) continue;
    for (const branch of splitTop(String((rule && rule.selector) || ""), ",")) {
      const selector = branch.replace(/\s+/g, " ").trim();
      if (!selector) continue;
      for (const d of decls) {
        out.push({
          selector,
          property: d.property,
          value: d.value,
          important: d.important,
          inherited: TEXT_INHERITED.has(d.property),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The in-page measurement. Serialised to the browser, so it closes over nothing.
// ---------------------------------------------------------------------------
/* c8 ignore start — runs inside chromium, exercised by the live proof */
function measureInPage({ intents, texts, orderings, heroVideos, marker, maxElements, maxLeaves, maxBlockers, textInherited }) {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "HEAD"]);

  const norm = (s) => String(s || "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const read = (el, prop) => {
    try { return String(getComputedStyle(el).getPropertyValue(prop) || "").trim(); } catch { return ""; }
  };

  // The exact computed value THIS declaration produces on THIS element. No
  // colour parsing, no unit maths: the browser is asked directly and its answer
  // is put back the way it was found.
  const probeWant = (el, prop, value) => {
    const had = el.getAttribute("style");
    try {
      el.style.setProperty(prop, value, "important");
      // An invalid value is a silent no-op in setProperty. Detecting it here is
      // what stops "color: bright-orange" from measuring as a perfect match
      // against the colour the page already had.
      const accepted = String(el.style.getPropertyValue(prop) || "").trim() !== "";
      return { want: read(el, prop), accepted };
    } catch {
      return { want: "", accepted: false };
    } finally {
      if (had === null) el.removeAttribute("style"); else el.setAttribute("style", had);
    }
  };

  const describe = (el) => {
    const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${String(cls).trim().split(/\s+/).slice(0, 3).join(".")}` : ""}`;
  };

  // Elements that DIRECTLY carry visible words. These are what an inherited
  // text property is really about — the section is not what anybody looks at.
  const textLeaves = (root) => {
    const found = [];
    const walk = (node) => {
      if (found.length >= maxLeaves) return;
      if (SKIP_TAGS.has(node.tagName)) return;
      let own = false;
      for (const child of node.childNodes) {
        if (child.nodeType === 3 && String(child.textContent || "").trim()) { own = true; break; }
      }
      if (own && node.getClientRects().length) found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(root);
    return found;
  };

  const checks = [];
  for (const intent of intents) {
    const check = {
      selector: intent.selector,
      property: intent.property,
      value: intent.value,
      inherited: Boolean(intent.inherited),
      matched: 0,
      took: 0,
      verdict: "",
      want: "",
      got: "",
      blockers: [],
    };
    let els = [];
    try {
      els = [...document.querySelectorAll(intent.selector)];
    } catch {
      check.verdict = "selector_invalid";
      checks.push(check);
      continue;
    }
    check.matched = els.length;
    if (!els.length) {
      check.verdict = "selector_matched_nothing";
      checks.push(check);
      continue;
    }

    // VERIFY WHAT A VISITOR CAN SEE. A selector can also match an element that is
    // display:none at this viewport (these donors ship a duplicate mobile call
    // button), and getComputedStyle on a display:none element reports used values
    // like height as "auto" no matter what the rule says — which would fail a
    // perfectly good edit. Rendered elements are the subject; the hidden ones are
    // only consulted when there is nothing else.
    const rendered = els.filter((el) => el.getClientRects().length);
    const sample = (rendered.length ? rendered : els).slice(0, maxElements);
    check.rendered = rendered.length;

    const first = probeWant(sample[0], intent.property, intent.value);
    check.want = first.want;
    check.got = read(sample[0], intent.property);
    if (!first.accepted) {
      // "color: bright-orange" is not a colour. setProperty drops it silently,
      // so without this the probe would measure the page's existing colour
      // against itself and call the no-op a perfect match.
      check.verdict = "invalid_value";
      checks.push(check);
      continue;
    }
    if (!check.want && !check.got) {
      // A shorthand the engine cannot read back. Say so; never call it a pass.
      check.verdict = "unmeasurable";
      checks.push(check);
      continue;
    }

    // WHY `want` IS RE-PROBED PER ELEMENT. A relative value computes differently
    // on different elements — line-height:1.5 resolves against each element's own
    // font-size, height:50% against each parent. Comparing every element to a
    // single container-computed string would fail edits that are working.
    const took = (el, inheritedFrom) => {
      const got = read(el, intent.property);
      if (inheritedFrom && got === inheritedFrom) return { ok: true, got };
      const own = probeWant(el, intent.property, intent.value);
      return { ok: own.accepted && got === own.want, got };
    };

    // MOST OF WHAT IT GOVERNS, MEASURED IN WORDS — not all of it, and never
    // just some of it. Both extremes were tried against the live page and both
    // are wrong:
    //   "every run of text must take"  fails the CORRECT rule. The real headline
    //     is <h1>Plumbing in Parkville. <span shimmer>Done</span>
    //     <span gold-badge>right.</span></h1> — two words are deliberately a
    //     gradient and a badge, so h1{color:#ff6600} turns the headline orange
    //     and leaves those two alone. That is the change working. Rolling it
    //     back and calling it a failure would be a worse lie than the first one.
    //   "any run of text must take" passes the DEFECT. section#top governs ~600
    //     characters; a single eyebrow span with no colour class of its own
    //     would be enough to wave through a headline that never changed.
    // So the verdict follows the TEXT: a change to an inherited text property
    // has to reach most of the words it governs. Below half is reported, with
    // the exact fraction, rather than being smoothed either way.
    const verdictFrom = (hits, total) => (hits === 0 ? "did_not_take" : hits * 2 < total ? "partly_took" : "took");

    const isTextInherited = textInherited.includes(intent.property);
    if (isTextInherited) {
      // Set on a container, an inherited property reaches only the words that
      // have no value of their own. So the measurement is on the WORDS — this is
      // the whole reason section#top{color:#ff6600} was reported as a success
      // while the headline stayed white.
      let leaves = [];
      for (const el of sample) leaves = leaves.concat(textLeaves(el));
      if (leaves.length) {
        check.leaves = leaves.length;
        let hits = 0;
        let chars = 0;
        let hitChars = 0;
        for (const leaf of leaves) {
          const words = String(leaf.textContent || "").replace(/\s+/g, " ").trim();
          chars += words.length;
          const r = took(leaf, check.want);
          if (r.ok) { hits += 1; hitChars += words.length; continue; }
          if (check.blockers.length < maxBlockers) {
            check.blockers.push({ el: describe(leaf), got: r.got, text: words.slice(0, 48) });
          }
        }
        check.took = hits;
        check.chars = chars;
        check.tookChars = hitChars;
        check.verdict = verdictFrom(hitChars, chars);
        checks.push(check);
        continue;
      }
    }

    let hits = 0;
    for (const el of sample) {
      const r = took(el, null);
      if (r.ok) { hits += 1; continue; }
      if (check.blockers.length < maxBlockers) check.blockers.push({ el: describe(el), got: r.got, text: "" });
    }
    check.took = hits;
    check.verdict = verdictFrom(hits, sample.length);
    checks.push(check);
  }

  const haystack = `${norm(document.body ? document.body.innerText : "")} ${norm(document.title)}`;
  const textChecks = (texts || []).map((t) => ({
    kind: t.kind,
    expected: t.expected,
    found: haystack.includes(norm(t.expected)),
  }));

  // A REORDER'S CLAIM IS ORDER, not presence. A moved section's heading is on
  // the page before AND after the move — the only question a customer can ask
  // is "is it above the other one now?", and that is answered by walking the
  // live DOM and comparing document position. A heading that cannot be found
  // exactly once proves nothing either way (unconfirmed); a heading found with
  // the sections in the wrong order is a proven miss (not_landed, rolled
  // back).
  const orderChecks = (orderings || []).map((o) => {
    const find = (t) => {
      const want = norm(t);
      if (!want) return null;
      const hits = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
        .filter((el) => norm(el.textContent) === want);
      return hits.length === 1 ? hits[0] : null;
    };
    const a = find(o.before);
    const b = find(o.after);
    if (!a || !b) {
      return { before: o.before, after: o.after, verdict: "heading_not_found" };
    }
    const ordered = Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { before: o.before, after: o.after, verdict: ordered ? "ordered" : "wrong_order" };
  });

  // A HERO VIDEO'S CLAIM IS THE LADDER AND THE ELEMENT. The page carries its
  // own source of truth — <script id="hero-video-ladder">{…}</script> — and
  // the donor's walker arms its top rung onto the marked
  // video[data-hero-video]. "Done" therefore means BOTH: the ladder hands the
  // new clip to the page AND a hero video element is present to receive it.
  // src is read leniently (the walker arms it asynchronously, and a visitor
  // with reduced-motion opted out arms nothing): an element with no src yet is
  // "not armed yet" — unconfirmed, retried — while a dead flag or a ladder
  // that still names the old clip is a proven miss.
  const heroChecks = (heroVideos || []).map((h) => {
    const expected = String((h && h.expected) || "").replace(/^\/+/, "");
    const island = document.getElementById("hero-video-ladder");
    let top = null;
    let readable = false;
    if (island) {
      try {
        const parsed = JSON.parse(island.textContent || "{}");
        if (parsed && Array.isArray(parsed.sources)) {
          top = parsed.sources.length ? String(parsed.sources[0] || "").replace(/^\/+/, "") : "";
          readable = true;
        }
      } catch { /* an unparseable ladder proves nothing either way */ }
    }
    const video = document.querySelector("video[data-hero-video]");
    const src = video ? String(video.getAttribute("src") || "").replace(/^\/+/, "") : null;
    return {
      expected,
      ladderFound: Boolean(island),
      ladderReadable: readable,
      ladderTop: top,
      videoPresent: Boolean(video),
      videoSrc: src,
      armed: Boolean(video && video.getAttribute("data-hero-armed") === "1"),
      dead: Boolean(video && video.getAttribute("data-hero-dead") === "1"),
    };
  });

  return {
    checks,
    textChecks,
    orderChecks,
    heroChecks,
    markerPresent: marker ? document.documentElement.outerHTML.includes(marker) : null,
    bodyChars: document.body ? String(document.body.innerText || "").length : 0,
  };
}
/* c8 ignore stop */

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------
const NOT_LANDED_VERDICTS = new Set([
  "selector_matched_nothing",
  "selector_invalid",
  "invalid_value",
  "did_not_take",
  "partly_took",
]);

/**
 * summarizeVerification(measurement) -> { ok, status, reason, detail }
 *
 * Three endings, and only one of them may ever be spoken as "it's live":
 *
 *   landed      every declaration is computing on the page, and every new
 *               wording is readable on it. This is the ONLY success.
 *   not_landed  a declaration provably did nothing. The bytes are on the site
 *               and the customer cannot see the change they asked for, so the
 *               plan is rolled back and the failure is spoken plainly.
 *   unconfirmed we could not see the page (no browser, page did not load, the
 *               edge is still serving the old bytes) or could not read the
 *               property back. NOT a failure — and NOT a success either. It is
 *               never reported as done, and nothing is rolled back on a
 *               suspicion.
 */
function summarizeVerification(measurement) {
  if (!measurement || measurement.ok === false) {
    return {
      ok: false,
      status: "unconfirmed",
      reason: (measurement && measurement.reason) || "could_not_render",
      detail: null,
    };
  }
  const checks = Array.isArray(measurement.checks) ? measurement.checks : [];
  const textChecks = Array.isArray(measurement.textChecks) ? measurement.textChecks : [];
  const orderChecks = Array.isArray(measurement.orderChecks) ? measurement.orderChecks : [];

  if (measurement.markerPresent === false) {
    return { ok: false, status: "unconfirmed", reason: "page_still_serving_old_bytes", detail: null };
  }

  const failed = checks.filter((c) => NOT_LANDED_VERDICTS.has(c.verdict));
  if (failed.length) {
    const worst = failed[0];
    return {
      ok: false,
      status: "not_landed",
      reason: worst.verdict,
      detail: {
        selector: worst.selector,
        property: worst.property,
        value: worst.value,
        want: worst.want,
        got: worst.got,
        matched: worst.matched,
        took: worst.took,
        blockers: worst.blockers || [],
      },
      failedCount: failed.length,
    };
  }

  // A reorder that provably did not move: both headings readable on the live
  // page and still in the old order. Same treatment as a declaration that
  // provably did nothing — rolled back, spoken plainly.
  const wrongOrder = orderChecks.filter((c) => c.verdict === "wrong_order");
  if (wrongOrder.length) {
    return {
      ok: false,
      status: "not_landed",
      reason: "section_order_wrong_on_the_page",
      detail: { before: wrongOrder[0].before, after: wrongOrder[0].after },
      failedCount: wrongOrder.length,
    };
  }

  // THE HERO VIDEO VERDICTS. Three endings again, and the ladder is the
  // page's own answer: a ladder readable and naming the new clip with a hero
  // video element on the page is the ONLY success; a ladder that still names
  // the old clip, or a hero video element that is not on the page, is a
  // proven miss (rolled back like any other did_not_take); a video that is
  // simply not armed YET is an honest "could not look just now", and the
  // caller retries.
  const heroChecks = Array.isArray(measurement.heroChecks) ? measurement.heroChecks : [];
  const heroMiss = heroChecks.find((c) =>
    !c.ladderFound
    || !c.ladderReadable
    || (c.ladderTop || "") !== (c.expected || "")
    || !c.videoPresent
    || (c.dead && c.videoSrc !== c.expected));
  if (heroMiss) {
    return {
      ok: false,
      status: "not_landed",
      reason: !heroMiss.ladderFound ? "hero_video_ladder_missing"
        : !heroMiss.ladderReadable ? "hero_video_ladder_unreadable"
          : (heroMiss.ladderTop || "") !== (heroMiss.expected || "") ? "hero_video_not_in_ladder"
            : !heroMiss.videoPresent ? "hero_video_element_missing"
              : "hero_video_failed_to_arm",
      detail: { expected: heroMiss.expected, ladderTop: heroMiss.ladderTop, videoSrc: heroMiss.videoSrc },
      failedCount: heroChecks.length,
    };
  }
  const heroWaiting = heroChecks.find((c) => c.videoSrc !== c.expected && !c.armed);
  if (heroWaiting) {
    return {
      ok: false,
      status: "unconfirmed",
      reason: "hero_video_not_armed_yet",
      detail: { expected: heroWaiting.expected, videoSrc: heroWaiting.videoSrc },
    };
  }

  const unreadable = checks.filter((c) => c.verdict === "unmeasurable");
  const missingText = textChecks.filter((t) => !t.found);
  if (missingText.length) {
    return {
      ok: false,
      status: "unconfirmed",
      reason: "new_wording_not_visible_on_the_pages_checked",
      detail: { expected: missingText[0].expected },
    };
  }
  const unseenOrder = orderChecks.filter((c) => c.verdict !== "ordered");
  if (unseenOrder.length) {
    return {
      ok: false,
      status: "unconfirmed",
      reason: "could_not_read_back_section_order",
      detail: { before: unseenOrder[0].before, after: unseenOrder[0].after },
    };
  }
  if (unreadable.length) {
    return {
      ok: false,
      status: "unconfirmed",
      reason: `could_not_read_back_${unreadable[0].property}`,
      detail: { selector: unreadable[0].selector, property: unreadable[0].property },
    };
  }
  return { ok: true, status: "landed", reason: "", detail: null, checked: checks.length + textChecks.length + orderChecks.length };
}

/**
 * The sentence the customer hears. Written here, next to the verdict that
 * produces it, so the two cannot drift.
 *
 * "Nothing on your site changed" is only ever said when a rollback is CONFIRMED.
 * A rollback that itself failed gets its own sentence, because the one claim we
 * must never make is one we did not check.
 */
function sayForVerdict(summary, { reverted = null } = {}) {
  if (summary.status === "not_landed") {
    if (reverted === true) {
      return "I couldn't get that change to actually show up on your page — your site's own styling kept overriding it — so I've put everything back exactly as it was. Nothing on your site has changed, and I've passed this to someone on our team to do by hand.";
    }
    if (reverted === false) {
      return "That change didn't take on your page, and putting it back didn't complete either — so I'm not going to tell you where your site stands. Someone on our team is on it right now. Please don't re-send it in the meantime.";
    }
    return "That change didn't take on your page, and I'm not going to pretend otherwise. Someone on our team is picking it up now.";
  }
  return "Your change went out, but I couldn't confirm on your live page that it actually shows — so I won't call it done. Someone on our team is checking it now.";
}

// ---------------------------------------------------------------------------
// The live read
// ---------------------------------------------------------------------------
/**
 * verifyEditLive({ origin, intents, texts, orderings, marker, routes })
 *
 * ONE browser, reused across attempts. The retries exist for edge propagation —
 * a deploy that is READY and aliased can still serve the previous bytes from an
 * edge for a few seconds, and reporting THAT as "your change did nothing" would
 * be a fresh lie in the opposite direction. So a marker miss is a retry, not a
 * verdict, and only a page that is provably serving the new bytes gets to fail
 * an edit.
 *
 * Never throws. A browser that will not launch is an `unconfirmed`, which the
 * caller reports honestly and never rolls back on.
 */
async function verifyEditLive({
  origin,
  intents = [],
  texts = [],
  orderings = [],
  heroVideos = [],
  marker = null,
  routes = [],
  attempts = 2,
  waitMs = 4000,
  launch = null,
  // An ALREADY-LAUNCHED browser (or a promise for one). runSiteChange starts
  // chromium while the deploy is in flight — see warmBrowser() there — because
  // in a lambda the cold start is comparable to the deploy itself and the two
  // do not need each other. Whoever passes it owns nothing: this closes it.
  browser: warm = null,
  sleep = null,
  now = () => Date.now(),
} = {}) {
  const base = String(origin || "").replace(/\/+$/, "");
  if (!base) return { ok: false, reason: "no_live_origin" };
  if (!intents.length && !texts.length && !orderings.length && !heroVideos.length) return { ok: true, checks: [], textChecks: [], orderChecks: [], heroChecks: [], markerPresent: null, skipped: "nothing_to_verify" };

  const rest = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const launcher = launch || (() => require("./serverless-chromium").launchChromium());

  let browser;
  try {
    browser = warm ? await warm : await launcher();
    if (!browser || browser.__error) throw (browser && browser.__error) || new Error("no browser");
  } catch (e) {
    return { ok: false, reason: `chromium_launch_failed: ${String((e && e.message) || e).slice(0, 200)}` };
  }

  const args = {
    intents,
    texts,
    orderings,
    heroVideos,
    marker,
    maxElements: MAX_ELEMENTS,
    maxLeaves: MAX_LEAVES,
    maxBlockers: MAX_BLOCKERS,
    textInherited: [...TEXT_INHERITED],
  };

  try {
    const page = await browser.newPage();
    let last = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let measurement = null;
      try {
        // NOT networkidle. These mirrors autoplay a looping hero video, and a
        // page whose network never goes quiet makes "wait for idle" a synonym
        // for "wait for the timeout" — 45s burnt per attempt, three attempts, on
        // a page that was ready in 200ms. `load` plus an explicit wait for the
        // app to have painted words is the readiness this check actually needs.
        const res = await page.goto(`${base}/?wss-verify=${now()}`, { waitUntil: "load", timeout: 25000 });
        const status = res ? res.status() : 0;
        if (status !== 200) {
          last = { ok: false, reason: `http_${status}` };
        } else {
          await page.waitForFunction(
            () => Boolean(document.body) && document.body.innerText.trim().length > 200,
            null,
            { timeout: 15000 },
          );
          measurement = await page.evaluate(measureInPage, args);
          last = { ok: true, attempt, ...measurement };
        }
      } catch (e) {
        last = { ok: false, reason: `render_error: ${String((e && e.message) || e).slice(0, 200)}` };
      }

      if (last.ok) {
        // Old bytes at the edge — look again rather than blaming the edit.
        const stale = marker && measurement && measurement.markerPresent === false;
        if (!stale) {
          // A wording that is not on the home page may legitimately live on
          // another route of the same compiled app. Look there before saying we
          // could not find it.
          const missing = (measurement.textChecks || []).some((t) => !t.found);
          if (missing && routes.length) {
            for (const route of routes.slice(0, 2)) {
              try {
                const r = await page.goto(`${base}${route}?wss-verify=${now()}`, { waitUntil: "load", timeout: 25000 });
                if (!r || r.status() !== 200) continue;
                await page.waitForFunction(
                  () => Boolean(document.body) && document.body.innerText.trim().length > 200,
                  null,
                  { timeout: 15000 },
                ).catch(() => {});
                const extra = await page.evaluate(measureInPage, { ...args, intents: [], marker: null });
                for (let i = 0; i < measurement.textChecks.length; i += 1) {
                  if (!measurement.textChecks[i].found && extra.textChecks[i] && extra.textChecks[i].found) {
                    measurement.textChecks[i].found = true;
                    measurement.textChecks[i].foundOn = route;
                  }
                }
              } catch { /* a route that will not load simply proves nothing */ }
              if (!measurement.textChecks.some((t) => !t.found)) break;
            }
            last = { ok: true, attempt, ...measurement };
          }
          const verdict = summarizeVerification(last);
          if (verdict.ok || verdict.status === "not_landed") return last;
        }
      }
      if (attempt < attempts) await rest(waitMs);
    }
    return last || { ok: false, reason: "no_measurement" };
  } catch (e) {
    return { ok: false, reason: `verify_error: ${String((e && e.message) || e).slice(0, 200)}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  TEXT_INHERITED,
  NOT_LANDED_VERDICTS,
  splitTop,
  splitDeclarations,
  declaredIntents,
  summarizeVerification,
  sayForVerdict,
  verifyEditLive,
  measureInPage,
};
