/**
 * lib/brand-scrape.js — extract a prospect's real logo + dominant brand color
 * from their current website. Used by the mirror lane to bind each site's brand
 * instead of rendering the donor's defaults (the Tekline bleed).
 */
"use strict";

const { URL } = require("node:url");

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; } finally { clearTimeout(t); }
}

function extractLogo(html, baseUrl) {
  // look for the header logo: <img> in header/nav with logo-ish src or alt
  const patterns = [
    /<img[^>]+src=["']([^"']*(?:logo|brand)[^"']*\.(?:png|jpg|jpeg|svg|webp))["'][^>]*>/i,
    /<img[^>]+(?:alt|title)=["'][^"']*(?:logo|brand)[^"']*["'][^>]+src=["']([^"']+)["']/i,
    /<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      try {
        return new URL(m[1], baseUrl).href;
      } catch { /* relative URL failed */ }
    }
  }
  return "";
}

function extractDominantColor(html) {
  // look for theme-color meta, brand-color CSS vars, or the most common hex in the first 2000 chars of style
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']?(#[0-9a-fA-F]{3,8})["']?/i);
  if (theme) return theme[1];
  const cssVar = html.match(/--(?:accent|primary|brand|main|color)[^:]*:\s*(#[0-9a-fA-F]{3,8})/i);
  if (cssVar) return cssVar[1];
  // most common hex in inline styles
  const hexes = html.match(/#[0-9a-fA-F]{6}\b/g) || [];
  if (hexes.length) {
    const counts = {};
    for (const h of hexes) counts[h] = (counts[h] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    // skip pure black/white/gray
    for (const [hex] of sorted) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min > 30) return hex; // has color, not grayscale
    }
  }
  return "";
}

function extractPalette(html) {
  // collect hex colors, rank by frequency, prefer saturated brand hues (not gray/black/white)
  const hexes = html.match(/#[0-9a-fA-F]{6}\b/g) || [];
  const counts = {};
  for (const h of hexes) {
    const hex = h.toLowerCase();
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 40) continue; // grayscale
    counts[hex] = (counts[hex] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : "";
}

async function scrapeBrandIdentity(siteUrl) {
  if (!siteUrl) return { logo_url: "", primary_color: "" };
  let url = siteUrl;
  if (!url.startsWith("http")) url = "https://" + url;
  const html = await fetchText(url);
  if (!html) return { logo_url: "", primary_color: "" };
  const logo_url = extractLogo(html, url);
  let primary_color = extractDominantColor(html);
  // fetch linked CSS files — brand colors usually live there, not inline
  const cssHrefs = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi)].map((m) => m[1]).slice(0, 4);
  let cssText = "";
  for (const href of cssHrefs) {
    try { cssText += await fetchText(new URL(href, url).href, 10000); } catch { /* skip */ }
  }
  if (!primary_color || primary_color.length < 6) {
    primary_color = extractPalette(html + cssText);
  }
  return { logo_url, primary_color };
}

module.exports = { scrapeBrandIdentity };
