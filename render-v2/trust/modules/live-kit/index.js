"use strict";

// lib/mirror-engine/kit/index.js — THE RAZZLE DAZZLE KIT LOADER (wave 0).
//
// Contract: RAZZLE-DAZZLE-KIT-CONTRACT.md §2 (the drop-in seam). The owner's
// kit of visual modules (one file, one effect) lands in this folder and rides
// every build through the ONE registration loop in engine.js — a new effect is
// a file drop, never an engine edit.
//
//   kit/<name>.js   -> module.exports = frozen { name, version, activation,
//                       budget, css(ctx), js?(ctx), notes? }
//
// What lives here (zero npm dependencies; node:fs/node:path + the engine's own
// pure trust-layer planners only):
//   modules()          — validated kit modules, sorted by filename (index.js
//                        excluded). A module failing shape validation is
//                        DROPPED with a warning, never fatal (§1.4 fail-soft).
//   activates(mod, {manifest, vertical}) — the opt-in dial (§2.4).
//   buildCtx({...})    — the read-only builder context every module reads
//                        (theming map: AUTHORITY-KIT-PORT-PLAN §2).
//   emit(mod, ctx)     — css()/js() output + byte-level validation (§1.1/§1.2)
//                        + the version banner. Throws on a rejected module so
//                        the engine's fail-soft catch can skip it by name.
//   injectBeforeBodyEnd(files, js, name) — idempotent </body> injection on the
//                        `data-wss-kit="<name>"` marker (§2.5).
//
// CSS rides the engine's own appendToLastCss; this loader never writes files,
// never mutates the build tree on its own, and never throws at load time.

const fs = require("node:fs");
const path = require("node:path");
const trustLayer = require("../trust-layer");
const trustModules = require("../trust-modules");

const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MODES = new Set(["flag", "flag-off", "always", "vertical"]);
const ACTIVATION_STRING_RE = /^(?:always|flag:[a-z0-9_]+|flag-off:[a-z0-9_]+|vertical:[a-z][a-z0-9-]*)$/;

// ---------------------------------------------------------------------------
// shape validation (§1) — runs at load; a failure drops the module, not the build
// ---------------------------------------------------------------------------

function validateModule(mod, filename) {
  const problems = [];
  const base = path.basename(String(filename || ""));
  if (!mod || typeof mod !== "object" || Array.isArray(mod)) {
    return { ok: false, problems: [`${base}: export must be a plain object`] };
  }
  if (!Object.isFrozen(mod)) problems.push("module must be frozen (Object.freeze) — kit modules are shared read-only across builds");
  if (typeof mod.name !== "string" || !NAME_RE.test(mod.name)) problems.push(`bad name ${JSON.stringify(mod.name)} (kebab-case required)`);
  const stem = base.replace(/\.js$/, "");
  if (mod.name !== stem) problems.push(`name "${mod.name}" must equal filename "${stem}.js"`);
  if (!Number.isInteger(mod.version) || mod.version < 1) problems.push("version must be an integer >= 1");

  // activation: object form (§1) or the compact string form ("always" |
  // "flag:<key>" | "vertical:<name>" | "flag-off:<key>").
  let act = null;
  if (typeof mod.activation === "string") {
    if (!ACTIVATION_STRING_RE.test(mod.activation)) {
      problems.push(`bad activation string ${JSON.stringify(mod.activation)}`);
    } else {
      const [mode, arg] = mod.activation.split(":");
      act = mode === "always"
        ? { mode, flag: null, verticals: null }
        : mode === "vertical"
          ? { mode, flag: null, verticals: [arg] }
          : { mode, flag: arg, verticals: null };
    }
  } else if (mod.activation && typeof mod.activation === "object" && !Array.isArray(mod.activation)) {
    act = { mode: mod.activation.mode || "flag", flag: mod.activation.flag || null, verticals: mod.activation.verticals || null };
  } else {
    problems.push("activation must be an object {mode,flag,verticals} or a compact string");
  }
  if (act) {
    if (!MODES.has(act.mode)) problems.push(`unknown activation mode "${act.mode}"`);
    if (act.mode === "flag" || act.mode === "flag-off") {
      if (typeof act.flag !== "string" || !/^kit_[a-z0-9_]+$/.test(act.flag)) {
        problems.push(`flag "${act.flag}" must be kit_<snake_case>`);
      } else if (typeof mod.name === "string" && NAME_RE.test(mod.name) && act.flag !== `kit_${mod.name.replace(/-/g, "_")}`) {
        problems.push(`flag "${act.flag}" must be kit_${mod.name.replace(/-/g, "_")} (flag naming law, §2.4)`);
      }
    }
    if (act.mode === "vertical") {
      if (!Array.isArray(act.verticals) || !act.verticals.length || !act.verticals.every((v) => typeof v === "string" && NAME_RE.test(v))) {
        problems.push("mode 'vertical' requires verticals: [kebab-case, ...]");
      }
    }
  }

  const b = mod.budget;
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    problems.push("budget object is required (§3 restraint law)");
  } else {
    for (const key of ["family", "ambientLoop", "dwell", "stagger", "maxPerViewport"]) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) problems.push(`budget.${key} must be declared (null when n/a)`);
    }
    if (typeof b.family !== "string" || !b.family.trim()) problems.push("budget.family must be a non-empty string");
    for (const key of ["ambientLoop", "dwell", "stagger"]) {
      if (b[key] != null && typeof b[key] !== "string") problems.push(`budget.${key} must be a string or null`);
    }
    if (!Number.isInteger(b.maxPerViewport) || b.maxPerViewport < 1 || b.maxPerViewport > 50) {
      problems.push("budget.maxPerViewport must be an integer 1..50");
    }
  }

  if (typeof mod.css !== "function") problems.push("css(ctx) function is required");
  if (mod.js != null && typeof mod.js !== "function") problems.push("js(ctx) must be a function returning a string or null");

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// discovery — require every kit/*.js (except this loader), sorted, validated
// ---------------------------------------------------------------------------

function loadFrom(dir) {
  const modules = [];
  const warnings = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return { modules, warnings: [`kit dir unreadable: ${e.message}`] };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/\.js$/i.test(entry.name) || entry.name === "index.js") continue;
    const rel = path.join(dir, entry.name);
    let mod = null;
    try {
      mod = require(rel);
    } catch (e) {
      warnings.push(`kit ${entry.name} failed to load: ${e.message}`);
      continue;
    }
    const verdict = validateModule(mod, entry.name);
    if (!verdict.ok) {
      warnings.push(`kit ${entry.name} rejected: ${verdict.problems.join("; ")}`);
      continue;
    }
    modules.push(mod);
  }
  modules.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { modules: Object.freeze(modules), warnings };
}

const LOADED = loadFrom(__dirname);

function modules() {
  return LOADED.modules;
}

function loadWarnings() {
  return LOADED.warnings.slice();
}

// ---------------------------------------------------------------------------
// activation (§2.4) — the motion_floor / photo_bands dial convention
// ---------------------------------------------------------------------------

function activates(mod, { manifest = null, vertical = "" } = {}) {
  if (!mod || typeof mod !== "object") return false;
  let act = mod.activation;
  if (typeof act === "string") {
    if (!ACTIVATION_STRING_RE.test(act)) return false;
    const [mode, arg] = act.split(":");
    act = mode === "always"
      ? { mode, flag: null, verticals: null }
      : mode === "vertical" ? { mode, flag: null, verticals: [arg] } : { mode, flag: arg, verticals: null };
  }
  if (!act || typeof act !== "object") return false;
  const flags = manifest && typeof manifest === "object" ? manifest : {};
  const v = String(vertical || "").toLowerCase();
  switch (act.mode || "flag") {
    case "always":
      return true;
    case "flag":
      return flags[act.flag] === true;
    case "flag-off":
      return flags[act.flag] !== false;
    case "vertical":
      return Boolean(v) && Array.isArray(act.verticals) && act.verticals.some((x) => String(x).toLowerCase() === v);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// the builder context (§2.3 + port-plan §2 theming map)
// ---------------------------------------------------------------------------
// Everything a module may read, resolved to values; a module needing anything
// else brings it as a CSS custom-property fallback chain (var(--wss-accent,
// #111827)), never a new engine dependency. The data arm is HONEST by
// construction: it is the trust layer's own planner output (provenance-gated,
// both-or-neither, no invented stats), never a re-derivation.

function hexToHslTriplet(hex) {
  const m = /^#?([0-9a-f]{6})$/i.test(String(hex || "")) && [String(hex).replace(/^#/, "")];
  if (!m) return null;
  const s = m[0];
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%`;
}

function buildCtx({ facts = {}, phoneDigits = "", palette = null, donor = {}, mode = "dark", content = {}, vertical = "" } = {}) {
  const f = facts && typeof facts === "object" ? facts : {};
  const c = content && typeof content === "object" ? content : {};
  const manifest = (donor && donor.manifest && typeof donor.manifest === "object") ? donor.manifest : {};
  const p = palette && typeof palette === "object" ? palette : {};
  const cp = p.counterpart && typeof p.counterpart === "object" ? p.counterpart : {};

  const aggregate = trustLayer.ratingStripPlan(f);
  const marquee = trustLayer.marqueePlan(Array.isArray(c.reviews) ? c.reviews : []);
  const badges = trustLayer.trustFloatItems(f, c);
  const socials = trustLayer.socialRowItems(f);
  const sourceData = trustModules.slotData({ facts: f, content: c });
  const schedule = trustModules.openNowScheduleOf(sourceData);
  const stats = [];
  if (aggregate) {
    stats.push({ kind: "rating", value: aggregate.rating });
    stats.push({ kind: "review_count", value: aggregate.count });
  }
  const founded = Number(c.founded_year);
  const nowYear = new Date().getUTCFullYear();
  if (Number.isInteger(founded) && founded >= 1800 && founded <= nowYear) {
    stats.push({ kind: "years_in_business", value: nowYear - founded });
  }
  for (const list of [marquee ? marquee.cards : [], badges, socials, stats]) {
    for (const item of list) Object.freeze(item);
    Object.freeze(list);
  }

  const kitCtx = {
    // Palette tokens — the resolved values behind the engine's --wss-* custom
    // properties (port-plan §2). Fallbacks are the port-plan's own, so a module
    // can inline `var(--wss-accent, ${ctx.palette.accent})` coherently.
    palette: Object.freeze({
      accent: p.accent || "#3b82f6",
      accentHsl: hexToHslTriplet(p.accent) || "8 61% 40%",
      accentHover: p.accentHover || p.accent || "#3b82f6",
      accentInk: p.accentInk || "#111827",
      accentText: p.accentText || p.text || "#f4f4f5",
      accentOnSlab: p.accentOnSlab || p.accent || "#3b82f6",
      accentSoft: p.accentSoft || "",
      surface: p.surface || "#0f1115",
      surfaceAlt: p.surfaceAlt || "#181b21",
      text: p.text || "#f4f4f5",
      muted: p.muted || "#9aa3af",
      border: p.border || "#2a2f38",
      slab: p.slab || "#e8e8ea",
      slabInk: p.slabInk || "#14161a",
      slabMuted: p.slabMuted || "",
      gold: "42 95% 54%",
      mode: p.mode === "light" ? "light" : "dark",
      source: p.source || "",
      counterpart: Object.freeze({
        accent: cp.accent || "#3b82f6",
        surface: cp.surface || "#0f1115",
        surfaceAlt: cp.surfaceAlt || "#181b21",
        text: cp.text || "#f4f4f5",
        muted: cp.muted || "#9aa3af",
        border: cp.border || "#2a2f38",
        slab: cp.slab || "#e8e8ea",
      }),
    }),
    business: Object.freeze({
      name: sourceData.business.name,
      city: sourceData.business.city,
      state: sourceData.business.state,
      phone: sourceData.business.phone,
      address: sourceData.business.address,
      services: Object.freeze(sourceData.services.map((name) => Object.freeze({ name }))),
      serviceAreas: Object.freeze(sourceData.serviceArea.slice()),
      reviewAggregate: aggregate ? Object.freeze({ rating: aggregate.rating, count: aggregate.count }) : null,
      timeZone: schedule ? schedule.timeZone : "",
      hours: schedule ? Object.freeze(schedule.hours.map((row) => Object.freeze({ ...row }))) : Object.freeze([]),
    }),
    data: Object.freeze({
      reviews: marquee ? marquee.cards : [],
      badges,
      stats,
      socials,
      aggregate,
    }),
    donor: Object.freeze({
      name: String((donor && donor.name) || ""),
      flags: manifest,
    }),
    mode: Object.freeze({
      dark: mode === "dark",
      reducedMotionRespected: true,
    }),
    // Contract §2.3 compatibility arms (same values, the original spellings).
    manifest,
    vertical: String(vertical || f.industry || manifest.vertical || ""),
    hasPhone: Boolean(phoneDigits),
    theme: mode === "dark" ? "dark" : "light",
  };
  return Object.freeze(kitCtx);
}

// ---------------------------------------------------------------------------
// output validation (§1.1 / §1.2) + emit
// ---------------------------------------------------------------------------

function scriptPayloadProblems(name, js) {
  const problems = [];
  const open = `<script data-wss-kit="${name}">`;
  if (!js.startsWith(open)) problems.push(`js() must start with ${JSON.stringify(open)}`);
  if (!js.endsWith("</script>")) problems.push('js() must end with the closing </script>');
  const opens = (js.match(/<script\b/gi) || []).length;
  const closes = (js.match(/<\/script>/gi) || []).length;
  if (opens !== 1 || closes !== 1) {
    problems.push(`unbalanced script tags in js() (${opens} open, ${closes} close) — payload must escape inner closers as <\\/script>`);
  }
  if (js.includes("{{")) problems.push('js() contains "{{" — an unmapped-token killer at the hydrate gates (§1.2.4)');
  // §1.2.3: the payload must parse as script. acorn is the engine's own gate
  // dependency; if it is somehow absent, degrade to the structural checks above.
  if (opens === 1 && closes === 1 && js.startsWith(open)) {
    const payload = js.slice(open.length, js.length - "</script>".length);
    try {
      const acorn = require("acorn");
      acorn.parse(payload, { ecmaVersion: "latest", sourceType: "script" });
    } catch (e) {
      problems.push(`js() payload does not parse as script: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  return problems;
}

function validateOutput(name, css, js) {
  const problems = [];
  if (css != null && typeof css !== "string") problems.push("css() must return a string or null");
  if (js != null && typeof js !== "string") problems.push("js() must return a string or null");
  const cssText = typeof css === "string" ? css : "";
  const jsText = typeof js === "string" ? js.trim() : "";

  if (cssText.trim()) {
    const opens = (cssText.match(/\{/g) || []).length;
    const closes = (cssText.match(/\}/g) || []).length;
    if (opens !== closes) problems.push(`unbalanced CSS braces (${opens} open, ${closes} close)`);
    if (cssText.includes("{{")) problems.push('css() contains "{{" — an unmapped-token killer at the hydrate gates (§1.2.4)');
    if (/<script\b/i.test(cssText)) problems.push("css() contains a <script tag");
    const animated = /@keyframes\b/i.test(cssText) || /(^|[^-])animation\s*:/i.test(cssText) || /\banimation-name\s*:/i.test(cssText);
    const hasTwin = /prefers-reduced-motion\s*:\s*(no-preference|reduce)/i.test(cssText);
    if (animated && !hasTwin) problems.push("animated css without a prefers-reduced-motion twin (no-preference wrap or reduce twin, §1.1)");
    if (/mask-image/i.test(cssText)) {
      const reduceAt = cssText.search(/prefers-reduced-motion\s*:\s*reduce/i);
      const noPrefAt = cssText.search(/prefers-reduced-motion\s*:\s*no-preference/i);
      const firstMask = cssText.search(/mask-image/i);
      const twinKillsMask = reduceAt !== -1 && /mask-image\s*:\s*none\s*!important/i.test(cssText.slice(reduceAt));
      const insideWrap = noPrefAt !== -1 && firstMask > noPrefAt;
      if (!twinKillsMask && !insideWrap) {
        problems.push("css() paints mask-image but no reduce twin resets it — the half-masked rest state is the 'half the logo missing' defect (§1.1)");
      }
    }
    // Donor-preservation forbidden three (§1.1) — the design-preservation
    // tests scan the combined polish bytes for exactly these.
    if (/grid-template-columns\s*:/i.test(cssText)) problems.push("css() emits grid-template-columns (donor column counts are the donor's)");
    if (/\bh1\b[^{}]*\{[^}]*font-size\s*:\s*clamp/i.test(cssText)) problems.push("css() emits an h1 font-size clamp");
    if (/backdrop-filter\s*:/i.test(cssText)) problems.push("css() emits backdrop-filter (deterministic-translucency law, port-plan §2)");
  }

  if (jsText) problems.push(...scriptPayloadProblems(name, jsText));
  return problems;
}

/** Upgrade identity slots from the EXACT inert JSON that rendered their
 * server HTML. The existing ports' fixed input() omits rating and tenure;
 * their replacement DOM would erase those certified sentences. Keep the
 * ports' activation/CSS, but let the slot payload own factual JS content. */
function factSlotJs(name) {
  return '<script data-wss-kit="' + name + '">(' + function (id) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="' + id + '"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.hasAttribute('data-wss-kit-' + id + '-done')) return;
          const script = root.querySelector('script[data-wss-module-data="' + id + '"]');
          const title = root.querySelector('.wss-kit-slot__title');
          if (!script || !title) return;
          const payload = JSON.parse(script.textContent);
          const lines = id === 'entity-card' ? payload?.lines : payload;
          if (!Array.isArray(lines) || lines.length < 2 ||
              lines.some(line => typeof line !== 'string' || !line.trim())) return;
          const entity = id === 'entity-card';
          const body = document.createElement(entity ? 'article' : 'ul');
          body.className = entity ? 'wss-entity-card__body' : 'wss-quotable-facts-strip__body';
          if (entity) body.setAttribute('aria-label', payload.name);
          for (const line of lines) {
            const item = document.createElement(entity ? 'p' : 'li');
            item.className = entity ? 'wss-entity-card__fact' : 'wss-quotable-facts-strip__fact';
            item.textContent = line;
            body.appendChild(item);
          }
          root.replaceChildren(title, body);
          root.classList.add(entity ? 'wss-entity-card' : 'wss-quotable-facts-strip');
          root.setAttribute('data-wss-kit-' + id + '-done', '1');
          root.setAttribute('data-wss-kit-class', entity ? 'showcase' : 'stats');
        } catch {}
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm, { once: true });
      else arm();
      window.addEventListener('load', arm, { once: true });
      const observer = new MutationObserver(arm);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 6000);
    } catch {}
  }.toString() + ')(' + JSON.stringify(name) + ');</script>';
}

/** emit(mod, ctx) -> { css, js } — banner-wrapped, byte-validated output.
 *  Throws when the module's output breaks a kit law, so the engine's fail-soft
 *  catch can skip THAT module by name and ship the rest (§1.4). */
function emit(mod, ctx) {
  const cssOut = mod.css(ctx);
  if (cssOut != null && typeof cssOut !== "string") throw new Error("css() must return a string or null");
  const rawJs = mod.js ? mod.js(ctx) : null;
  if (rawJs != null && typeof rawJs !== "string") throw new Error("js() must return a string or null");
  const jsOut = rawJs && (mod.name === "entity-card" || mod.name === "quotable-facts-strip")
    ? factSlotJs(mod.name) : rawJs;
  const problems = validateOutput(mod.name, cssOut, jsOut);
  if (problems.length) throw new Error(`output rejected: ${problems.join("; ")}`);
  return {
    css: typeof cssOut === "string" && cssOut.trim()
      ? `\n/* wss-kit:${mod.name}:v${mod.version} */\n${cssOut}\n`
      : null,
    js: typeof jsOut === "string" && jsOut.trim() ? jsOut : null,
  };
}

// ---------------------------------------------------------------------------
// idempotent </body> injection (§2.4/§2.5) — the marker is the guard
// ---------------------------------------------------------------------------

function injectBeforeBodyEnd(files, js, name) {
  const marker = `<script data-wss-kit="${name}"`;
  let pages = 0;
  for (const rel of Object.keys(files)) {
    if (!/\.html?$/i.test(rel)) continue;
    const html = files[rel].toString("utf8");
    if (html.includes(marker)) continue; // idempotent: the page already carries it
    const idx = html.toLowerCase().lastIndexOf("</body>");
    if (idx === -1) continue; // no anchor — skip, never invent one
    files[rel] = Buffer.from(`${html.slice(0, idx)}${js}\n${html.slice(idx)}`, "utf8");
    pages += 1;
  }
  return pages;
}

/** appendCssOnce(files, css, name, appendCss) — the CSS banner is the guard.
 *  Builds rehydrate donor dist from scratch, so a double append cannot
 *  accumulate across rebuilds; this is the defensive in-place twin of the JS
 *  marker anyway (§2.5): if any stylesheet already carries this module's
 *  `wss-kit:<name>:` banner, the append is skipped. `appendCss` is the
 *  engine's own appendToLastCss seam, handed in so this loader never
 *  re-implements stylesheet resolution. */
function appendCssOnce(files, css, name, appendCss) {
  const banner = `/* wss-kit:${name}:`;
  for (const rel of Object.keys(files)) {
    if (!/\.css$/i.test(rel)) continue;
    if (files[rel].toString("utf8").includes(banner)) return false;
  }
  return typeof appendCss === "function" ? Boolean(appendCss(files, css)) : false;
}

/** Presence means the emitted bytes actually found a destination (or
 * the idempotent marker was already there). A nonempty emit() alone is never
 * an applied asset when a stylesheet/body anchor is missing. */
function emitIntoFiles(files, out, name, appendCss) {
  let css = false, js = false;
  if (out.css) {
    const inserted = appendCssOnce(files, out.css, name, appendCss);
    const banner = `/* wss-kit:${name}:`;
    css = inserted || Object.entries(files).some(([rel, bytes]) =>
      /\.css$/i.test(rel) && bytes.toString("utf8").includes(banner));
  }
  if (out.js) {
    const inserted = injectBeforeBodyEnd(files, out.js, name);
    const marker = `<script data-wss-kit="${name}"`;
    js = inserted > 0 || Object.entries(files).some(([rel, bytes]) =>
      /\.html?$/i.test(rel) && bytes.toString("utf8").includes(marker));
  }
  return Object.freeze({ css, js });
}

module.exports = {
  modules,
  activates,
  buildCtx,
  validateModule,
  validateOutput,
  emit,
  injectBeforeBodyEnd,
  appendCssOnce,
  emitIntoFiles,
  loadWarnings,
  loadFrom,
};
