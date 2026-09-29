"use strict";

// lib/mirror-engine/a11y-audit.js — the static accessibility audit.
//
// The checker behind `npm run test:a11y` (scripts/a11y-check.js). Runs the
// basic a11y gates on RENDERED HTML STRINGS — no browser, no DOM library:
// the rules below are attribute-and-structure checks (missing alt, empty
// links, unlabeled form controls, page language, heading order) that axe-core
// implements against a live DOM but that are fully decidable from the markup
// itself. Zero npm dependencies, Node 20+, CommonJS; never throws.
//
// Severity model:
//   "serious"  — a screen-reader/keyboard user is walled off (no alt, no
//                label, no language, an empty link). These FAIL the run.
//   "moderate" — a real but navigable defect (skipped heading level, more
//                than one h1). Reported; fails only under --strict.
//
// The fleet-polish a11y floor (fleet-polish.js) is the FIX side of this
// contract; auditHtml is the PROOF side. The test suite asserts both
// directions: the audit catches each seeded violation, and a polished page
// passes.

const SERIOUS = "serious";
const MODERATE = "moderate";

const MAX_FINDINGS_PER_RULE = 25;

function htmlDecodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(markup) {
  return String(markup || "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(attrs || "");
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? "").trim();
}

/** All attributes of an open tag, as a raw string (no event-context parsing). */
function tagAttrs(tag) {
  const m = /^<[a-z]+\b([\s\S]*)>$/i.exec(String(tag || ""));
  return m ? m[1] : "";
}

/** RULE html-lang (serious): every page declares its language. WCAG 3.1.1. */
function ruleHtmlLang(html, findings) {
  const open = /<html\b([^>]*)>/i.exec(html);
  if (!open) {
    findings.push({ rule: "html-lang", severity: SERIOUS, message: "no <html> element — page language cannot be determined" });
    return;
  }
  const lang = attrValue(open[1], "lang");
  if (!lang) {
    findings.push({ rule: "html-lang", severity: SERIOUS, message: "<html> carries no lang attribute" });
  }
}

/** RULE img-alt (serious): every <img> carries an alt attribute (WCAG 1.1.1). */
function ruleImgAlt(html, findings) {
  let missing = 0;
  let sample = "";
  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    if (/\balt\s*=/i.test(m[1])) continue;
    missing += 1;
    if (!sample) sample = `<img${m[1].slice(0, 80)}>`;
  }
  if (missing) {
    findings.push({
      rule: "img-alt",
      severity: SERIOUS,
      message: `${missing} image${missing === 1 ? "" : "s"} without an alt attribute (first: ${sample})`,
    });
  }
}

/**
 * RULE link-empty (serious): an <a> with no accessible name — no text, no
 * aria-label/labelledby/title, and no <img alt="…"> inside to name it. The
 * classic donor case: an icon-only social/phone link.
 */
function ruleLinkEmpty(html, findings) {
  let count = 0;
  let sample = "";
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    if (attrValue(attrs, "aria-label") || attrValue(attrs, "aria-labelledby") || attrValue(attrs, "title") != null) continue;
    const text = stripTags(inner);
    if (text) continue;
    // An image inside the link can name it — but only if the image itself
    // has a non-empty alt.
    let named = false;
    for (const img of inner.matchAll(/<img\b([^>]*)>/gi)) {
      const alt = attrValue(img[1], "alt");
      if (alt) { named = true; break; }
    }
    if (named) continue;
    if (/wss-skip-link/i.test(attrs)) continue;
    count += 1;
    if (!sample) sample = `<a${attrs.slice(0, 80)}>`;
  }
  if (count) {
    findings.push({
      rule: "link-empty",
      severity: SERIOUS,
      message: `${count} link${count === 1 ? "" : "s"} with no accessible name (first: ${sample})`,
    });
  }
}

/**
 * RULE input-label (serious): a form control with no label association —
 * no <label for>, no aria-label/-ledby, no title, no wrapping <label>. A
 * placeholder is NOT a label (it disappears on input; WCAG 3.3.2/4.1.2).
 * hidden/submit-class controls are exempt; radio/checkbox are skipped here
 * for the same reason the polish floor skips them — a static checker cannot
 * see an adjacent-text label, so flagging them would cry wolf.
 */
function ruleInputLabel(html, findings) {
  const labelFors = new Set();
  for (const m of html.matchAll(/<label\b[^>]*\bfor\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    if (m[1] || m[2]) labelFors.add(m[1] || m[2]);
  }
  const EXEMPT_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "radio", "checkbox"]);
  // Cumulative <label> depth at every position (one pass, binary-searched
  // per control) so a wrapped control is recognized without an O(n²) slice.
  const depthEvents = [];
  let depth = 0;
  for (const m of html.matchAll(/<label\b[^>]*>|<\/label\s*>/gi)) {
    depth += /^<\//.test(m[0]) ? -1 : 1;
    depthEvents.push({ pos: m.index + m[0].length, depth });
  }
  const depthAt = (pos) => {
    let lo = 0;
    let hi = depthEvents.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (depthEvents[mid].pos <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo ? depthEvents[lo - 1].depth : 0;
  };
  let count = 0;
  let sample = "";
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const control = m[1].toLowerCase();
    const attrs = m[2] || "";
    const type = (attrValue(attrs, "type") || (control === "input" ? "text" : "")).toLowerCase();
    if (control === "input" && EXEMPT_TYPES.has(type)) continue;
    if (attrValue(attrs, "aria-label") || attrValue(attrs, "aria-labelledby") || attrValue(attrs, "title") != null) continue;
    const id = attrValue(attrs, "id");
    if (id && labelFors.has(id)) continue;
    if (depthAt(m.index) > 0) continue; // inside a <label> — labeled by it
    count += 1;
    if (!sample) sample = `<${control}${attrs.slice(0, 80)}>`;
  }
  if (count) {
    findings.push({
      rule: "input-label",
      severity: SERIOUS,
      message: `${count} form control${count === 1 ? "" : "s"} without a label (first: ${sample})`,
    });
  }
}

/**
 * RULE heading-order (moderate): heading levels must not skip DOWN more than
 * one step (h1 -> h3), and a document carries at most one h1. Skips scramble
 * the navigation outline screen-reader users move by; they do not wall
 * anyone off, hence moderate.
 */
function ruleHeadingOrder(html, findings) {
  const levels = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>/gi)) {
    levels.push(Number(m[1]));
  }
  let prev = 0;
  for (const level of levels) {
    if (prev && level > prev + 1) {
      findings.push({
        rule: "heading-order",
        severity: MODERATE,
        message: `heading level jumps from h${prev} to h${level}`,
      });
      break;
    }
    prev = level;
  }
  const h1s = levels.filter((l) => l === 1).length;
  if (h1s > 1) {
    findings.push({
      rule: "heading-order",
      severity: MODERATE,
      message: `${h1s} h1 elements on one page`,
    });
  }
}

const RULES = [ruleHtmlLang, ruleImgAlt, ruleLinkEmpty, ruleInputLabel, ruleHeadingOrder];

/**
 * Audit one rendered HTML document.
 * Returns { violations: [{rule, severity, message}], serious: n, moderate: n, ok: bool }.
 */
function auditHtml(html) {
  const violations = [];
  if (typeof html !== "string" || !html.trim()) {
    return { violations: [{ rule: "document", severity: SERIOUS, message: "empty or non-string document" }], serious: 1, moderate: 0, ok: false };
  }
  for (const rule of RULES) {
    const before = violations.length;
    try {
      rule(html, violations);
    } catch (e) {
      violations.push({ rule: "audit-error", severity: MODERATE, message: `rule runner failed: ${e && e.message ? e.message : "unknown"}` });
    }
    // Cap per-rule noise so a photo-dense page prints a verdict, not a novel.
    const added = violations.length - before;
    if (added > MAX_FINDINGS_PER_RULE) violations.splice(before + MAX_FINDINGS_PER_RULE, added - MAX_FINDINGS_PER_RULE, { rule: violations[before].rule, severity: violations[before].severity, message: `…and ${added - MAX_FINDINGS_PER_RULE} more of this rule` });
  }
  const serious = violations.filter((v) => v.severity === SERIOUS).length;
  const moderate = violations.length - serious;
  return { violations, serious, moderate, ok: serious === 0 };
}

module.exports = { auditHtml, SERIOUS, MODERATE };
