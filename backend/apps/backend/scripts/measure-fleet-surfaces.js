"use strict";

// scripts/measure-fleet-surfaces.js — MEASURE, do not guess.
//
// Renders (a) the prospect's OWN current website and (b) our live mirror of it,
// then reports the real computed background of each: is it light or dark, what
// is the dominant surface colour, what is the accent.
//
// The owner's claim is "eighty or ninety percent of the clients we are
// mirroring have white backgrounds" while every mirror ships dark. This script
// exists so the default is chosen from the fleet's actual numbers.

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decodePngToRgba } = require("../lib/png-decode");

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : path.join(__dirname, "..", "artifacts", "fleet-surfaces.json");
const LIMIT = Number(process.argv.includes("--limit") ? process.argv[process.argv.indexOf("--limit") + 1] : 40);
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "";

/**
 * --persist — WRITE THE MEASUREMENT BACK, which is the half that was missing.
 *
 * This script has produced the right number since the day it was written and
 * then thrown it away into a JSON file. lib/mirror-engine/engine.js reads
 * `request.client_surface`; nothing ever wrote one; so every build defaulted to
 * light and theme.js's dark branch was unreachable in production. See
 * lib/client-surface.js for the read half and for what it refuses.
 *
 * It writes ONE key — record.client_surface — and merges rather than replacing
 * the record, because this row also carries the build contract.
 */
const PERSIST = process.argv.includes("--persist");

async function rest(query) {
  const r = await fetch(`${BASE}/rest/v1/${query}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return []; }
}

/** Store the reading on the prospect, in the shape lib/client-surface.js reads. */
async function persistSurface(id, record, measured) {
  const surface = {
    mode: measured.mode,
    basis: measured.basis,
    brightShare: measured.brightShare,
    darkShare: measured.darkShare,
    surface: measured.surface,
    chars: measured.chars,
    url: measured.url,
    measured_at: new Date().toISOString(),
  };
  const body = JSON.stringify({ record: { ...(record && typeof record === "object" ? record : {}), client_surface: surface } });
  const r = await fetch(`${BASE}/rest/v1/ghost_agency_prospects?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json", Prefer: "return=minimal" },
    body,
  });
  return { ok: r.ok, status: r.status, surface };
}

// --- colour maths -----------------------------------------------------------

function parseCssColor(value) {
  const s = String(value || "").trim();
  let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const i = parseInt(m[1], 16);
    return { r: (i >> 16) & 255, g: (i >> 8) & 255, b: i & 255, a: 1 };
  }
  return null;
}

function toHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance. */
function relLum({ r, g, b }) {
  const f = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * THE ONLY READING THAT CANNOT LIE: the rendered pixels.
 *
 * Two DOM-based attempts each produced a confident wrong answer before this.
 * Ranking background-colours by element area called every mirror "light",
 * because <body> covers 100% of the viewport while sitting behind the hero.
 * Point-sampling with elementFromPoint then called Right Way Heating's grey
 * page "#000000", because a zero-opacity full-screen overlay is still the
 * topmost element at every point it covers.
 *
 * So decode the screenshot and count pixels. `median` is the light/dark call —
 * robust to a dark nav bar over a white page, and to a photo hero, in a way
 * that a single dominant bucket is not. `dominant` is the biggest quantised
 * bucket, which is the surface colour a designer would name.
 */
function pixelSurface(pngBytes) {
  const img = decodePngToRgba(pngBytes);
  if (!img) return null;
  const { width, height, data } = img;
  const step = Math.max(1, Math.round(Math.min(width, height) / 160));
  const lums = [];
  const buckets = new Map();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 200) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      lums.push(relLum({ r, g, b }));
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let e = buckets.get(key);
      if (!e) buckets.set(key, (e = { r: 0, g: 0, b: 0, n: 0 }));
      e.r += r; e.g += g; e.b += b; e.n++;
    }
  }
  if (!lums.length) return null;
  lums.sort((a, b) => a - b);
  const median = lums[Math.floor(lums.length / 2)];
  const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((e) => ({
    hex: toHex({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }),
    share: e.n / lums.length,
  }));
  return {
    median: Number(median.toFixed(4)),
    dominant: top[0].hex,
    dominantShare: Number(top[0].share.toFixed(3)),
    // Share of the frame that is genuinely bright / genuinely dark. A page that
    // is 70% near-white with a dark navbar and a dark footer strip is LIGHT,
    // and these two numbers say so without argument.
    brightShare: Number((lums.filter((l) => l >= 0.5).length / lums.length).toFixed(3)),
    darkShare: Number((lums.filter((l) => l <= 0.12).length / lums.length).toFixed(3)),
    top,
  };
}

/**
 * The light/dark verdict, from pixels.
 *
 * Deliberately NOT a median split at 0.5. A light marketing page routinely
 * carries a photographic hero, a dark nav and a dark footer, which drags a
 * median down without making the page dark to a human. The call is: more than
 * half the frame genuinely bright => light; a third or more genuinely dark and
 * very little bright => dark; anything else is `mid` and gets looked at.
 */
function classify(px) {
  if (!px) return null;
  if (px.brightShare >= 0.5) return "light";
  if (px.darkShare >= 0.35 && px.brightShare < 0.25) return "dark";
  if (px.median >= 0.45) return "light";
  if (px.median <= 0.12) return "dark";
  return "mid";
}

// --- the measurement, run inside the page ----------------------------------
//
// WHAT A PERSON ACTUALLY SEES, not what the DOM contains.
//
// The first version of this ranked background-colours by the AREA of the
// element declaring them, and it produced a confident, wrong answer: every one
// of our mirrors came back "light #fcfcfd", because <body> is #fcfcfd and body
// covers 100% of the viewport BY DEFINITION. It sits behind the hero. The paint
// on top — the thing the owner is looking at — was #071222 at 88% coverage,
// second in the ranking and ignored.
//
// So sample by POINT, not by element: walk a grid over the first screenful,
// ask elementFromPoint what is on top there, then climb to the nearest ancestor
// with an opaque background. That is the colour arriving at the eye at that
// pixel. Ranking those samples cannot be fooled by stacking order, because
// stacking order is exactly what elementFromPoint resolves.

const MEASURE = `() => {
  const opaque = (c) => {
    const m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)\\s*(?:[,/]\\s*([\\d.]+))?/i.exec(c || "");
    if (!m) return null;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (a < 0.9) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  };
  // Climb until something paints an opaque background. An element with a
  // background-IMAGE stops the climb too and reports as "media", because a hero
  // photo is neither the light surface nor the dark one and counting the colour
  // behind it would describe a surface nobody can see.
  const paintAt = (x, y) => {
    let el = document.elementFromPoint(x, y);
    let hops = 0;
    while (el && hops++ < 24) {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return { media: true };
      const c = opaque(cs.backgroundColor);
      if (c) return c;
      el = el.parentElement;
    }
    const c = opaque(getComputedStyle(document.body).backgroundColor)
      || opaque(getComputedStyle(document.documentElement).backgroundColor);
    return c || null;
  };

  const COLS = 24, ROWS = 16;
  const tally = new Map();
  let media = 0, samples = 0;
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const x = Math.round(((i + 0.5) / COLS) * innerWidth);
      const y = Math.round(((j + 0.5) / ROWS) * innerHeight);
      const p = paintAt(x, y);
      samples++;
      if (!p) continue;
      if (p.media) { media++; continue; }
      const key = p.r + "," + p.g + "," + p.b;
      tally.set(key, (tally.get(key) || 0) + 1);
    }
  }
  const ranked = [...tally.entries()].sort((x, y) => y[1] - x[1])
    .map(([k, v]) => ({ rgb: k.split(",").map(Number), coverage: v / samples }));
  const mediaShare = media / samples;

  // Body copy colour: the most common colour among real paragraphs.
  const textTally = new Map();
  for (const el of document.querySelectorAll("p, li, span, div")) {
    const t = (el.textContent || "").trim();
    if (t.length < 40) continue;
    if (el.children.length > 2) continue;
    const c = getComputedStyle(el).color;
    textTally.set(c, (textTally.get(c) || 0) + t.length);
  }
  const text = [...textTally.entries()].sort((a, b) => b[1] - a[1])[0];

  const html = getComputedStyle(document.documentElement);
  return {
    htmlBg: html.backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    htmlClass: document.documentElement.className || "",
    colorScheme: html.colorScheme || "",
    ranked: ranked.slice(0, 6),
    mediaShare,
    textColor: text ? text[0] : null,
    title: document.title || "",
    chars: (document.body.innerText || "").length,
  };
}`;

// A FRESH PAGE PER TARGET, deliberately.
//
// Reusing one page lost 21 of 30 measurements to
// "Navigation to X is interrupted by another navigation to Y": these are
// marketing sites full of deferred redirects and consent scripts that fire a
// location change seconds after load, and the NEXT goto inherits the abort.
// A page per URL costs ~200ms and makes every row a real reading.
async function measure(ctx, url, shotPath) {
  const t0 = Date.now();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  try {
    return await measureOn(page, url, t0, shotPath);
  } finally {
    await page.close().catch(() => {});
  }
}

async function measureOn(page, url, t0, shotPath) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000); // let a SPA paint
  const raw = await page.evaluate(eval(`(${MEASURE})`));

  // TWO BANDS, because they answer two different questions.
  //
  // HERO = the first screenful. It is what the outreach email's thumbnail
  // shows, and it is dark on most marketing sites by design — a full-bleed
  // photograph with white type over it. Judging the site by the hero calls
  // almost everyone dark, which is how the previous pass reported 16 "dark"
  // clients whose dominant colour was literally #ffffff.
  //
  // PAPER = the content sections below the fold. That is the surface the donor
  // token --background actually controls, and it is the thing the owner is
  // describing when he says "smooth white". This is the deciding measurement.
  const hero = await page.screenshot().catch(() => null);
  const vh = 900;
  const pageHeight = await page.evaluate("document.body.scrollHeight").catch(() => vh);
  let paper = null;
  if (pageHeight > vh * 1.4) {
    // fullPage is REQUIRED with a clip below the fold. Without it Playwright
    // clamps the clip to the viewport and silently returns the hero again —
    // which is why an earlier run reported heroMode identical to mode on all
    // 45 rows, and called sites whose dominant colour was #ffffff "dark".
    paper = await page
      .screenshot({ fullPage: true, clip: { x: 0, y: vh, width: 1280, height: Math.min(vh * 3, pageHeight - vh) } })
      .catch(() => null);
  }

  if (shotPath && hero) {
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath, hero);
    if (paper) fs.writeFileSync(shotPath.replace(/\.png$/, "--paper.png"), paper);
  }

  const heroPx = hero ? pixelSurface(hero) : null;
  const paperPx = paper ? pixelSurface(paper) : null;
  // No content below the fold (a one-screen site) — the hero IS the page.
  const decide = paperPx || heroPx;
  const surface = decide ? parseCssColor(decide.dominant) : null;
  const textRgb = parseCssColor(raw.textColor);
  return {
    url,
    ms: Date.now() - t0,
    title: raw.title.slice(0, 80),
    chars: raw.chars,
    htmlClass: raw.htmlClass.slice(0, 60),
    colorScheme: raw.colorScheme,
    // PIXEL TRUTH — the verdict comes from the PAPER, not the hero.
    mode: classify(decide),
    basis: paperPx ? "paper" : "hero-only",
    surface: decide ? decide.dominant : null,
    surfaceLum: decide ? Number(relLum(parseCssColor(decide.dominant)).toFixed(4)) : null,
    median: decide ? decide.median : null,
    brightShare: decide ? decide.brightShare : null,
    darkShare: decide ? decide.darkShare : null,
    top: decide ? decide.top : [],
    heroMode: classify(heroPx),
    heroSurface: heroPx ? heroPx.dominant : null,
    heroBright: heroPx ? heroPx.brightShare : null,
    // DOM readings, kept for tracing WHY (which token/class produced it).
    domRanked: raw.ranked.slice(0, 4).map((e) => ({ hex: toHex({ r: e.rgb[0], g: e.rgb[1], b: e.rgb[2] }), cov: Number(e.coverage.toFixed(3)) })),
    domBodyBg: raw.bodyBg,
    mediaShare: Number((raw.mediaShare || 0).toFixed(3)),
    text: textRgb ? toHex(textRgb) : null,
    textContrast: surface && textRgb ? Number(contrast(surface, textRgb).toFixed(2)) : null,
  };
}

async function main() {
  const rows = await rest(
    `ghost_agency_prospects?select=id,business_name,industry,city,state,current_website,preview_url,record` +
    `&preview_url=not.is.null&order=updated_at.desc&limit=400`,
  );
  if (!Array.isArray(rows) || !rows.length) {
    console.error("no prospect rows", JSON.stringify(rows).slice(0, 300));
    process.exit(1);
  }

  const pick = (row, keys) => {
    for (const k of keys) {
      const v = k.split(".").reduce((a, p) => (a && typeof a === "object" ? a[p] : undefined), row);
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };

  const seen = new Set();
  const targets = [];
  for (const row of rows) {
    const own = pick(row, [
      "current_website", "record.current_website", "record.website", "record.website_url",
      "record.build_ready.source_url", "record.source_url",
    ]);
    if (!own || !/^https?:\/\//i.test(own)) continue;
    let host;
    try { host = new URL(own).hostname.replace(/^www\./, ""); } catch { continue; }
    if (seen.has(host)) continue;
    if (ONLY && !String(row.business_name || "").toLowerCase().includes(ONLY.toLowerCase())) continue;
    seen.add(host);
    targets.push({
      id: row.id,
      name: row.business_name || "",
      industry: row.industry || pick(row, ["record.vertical", "record.industry"]),
      own,
      mirror: pick(row, ["preview_url", "record.preview_url"]),
      record: row.record || {},
    });
    if (targets.length >= LIMIT) break;
  }

  console.log(`targets: ${targets.length} distinct client hosts (of ${rows.length} rows)`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    colorScheme: "light",
  });
  const shotDir = path.join(path.dirname(OUT), "fleet-surface-shots");

  const results = [];
  for (const t of targets) {
    const rec = { ...t, client: null, mirrorMeasured: null, error: null };
    const safe = String(t.name || t.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    try {
      rec.client = await measure(ctx, t.own, path.join(shotDir, `${safe}--client.png`));
    } catch (e) {
      rec.error = String(e.message || e).split("\n")[0].slice(0, 120);
    }
    if (t.mirror && /^https?:\/\//i.test(t.mirror)) {
      try {
        rec.mirrorMeasured = await measure(ctx, t.mirror, path.join(shotDir, `${safe}--mirror.png`));
      } catch (e) { rec.mirrorError = String(e.message || e).split("\n")[0].slice(0, 120); }
    }
    // The write half. Only a real reading of a real page is stored — a bot wall
    // measures 99.7% bright and would teach the engine that every guarded site
    // is white. lib/client-surface.js refuses it again on read; refusing it
    // twice costs nothing and a wrong colour costs a send.
    if (PERSIST && rec.client && rec.client.mode && rec.client.chars > 200) {
      try {
        const w = await persistSurface(t.id, t.record, rec.client);
        rec.persisted = w;
      } catch (e) { rec.persisted = { ok: false, error: String(e.message || e).slice(0, 120) }; }
    } else if (PERSIST) {
      rec.persisted = { ok: false, skipped: rec.client ? `only_${rec.client.chars}_chars` : "no_reading" };
    }

    results.push(rec);
    const c = rec.client;
    const m = rec.mirrorMeasured;
    console.log(
      `${(rec.name || "?").slice(0, 26).padEnd(26)} ${c ? String(c.mode).padEnd(5) : "FAIL ".padEnd(5)} ` +
      `paper=${c && c.surface ? c.surface : "-------"} bright=${c ? String(c.brightShare).padEnd(5) : "-"} hero=${c ? String(c.heroMode).padEnd(5) : "-"} ` +
      `| mirror ${m ? String(m.mode).padEnd(5) : "-".padEnd(5)} paper=${m && m.surface ? m.surface : "-------"} bright=${m ? m.brightShare : "-"} ` +
      `${rec.persisted ? (rec.persisted.ok ? "| stored " : `| NOT STORED ${rec.persisted.skipped || rec.persisted.status || rec.persisted.error} `) : ""}`
      + `${rec.error ? "ERR " + rec.error : ""}`,
    );
  }
  await browser.close();

  const ok = results.filter((r) => r.client && r.client.mode && r.client.chars > 200);
  const light = ok.filter((r) => r.client.mode === "light").length;
  const dark = ok.filter((r) => r.client.mode === "dark").length;
  const mid = ok.filter((r) => r.client.mode === "mid").length;
  const mirrors = results.filter((r) => r.mirrorMeasured && r.mirrorMeasured.mode);
  const summary = {
    measured_at: new Date().toISOString(),
    attempted: results.length,
    usable: ok.length,
    client_light: light,
    client_dark: dark,
    client_mid: mid,
    client_light_pct: ok.length ? Number(((light / ok.length) * 100).toFixed(1)) : null,
    mirrors_measured: mirrors.length,
    mirror_light: mirrors.filter((r) => r.mirrorMeasured.mode === "light").length,
    mirror_dark: mirrors.filter((r) => r.mirrorMeasured.mode === "dark").length,
    mirror_mid: mirrors.filter((r) => r.mirrorMeasured.mode === "mid").length,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`written: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
