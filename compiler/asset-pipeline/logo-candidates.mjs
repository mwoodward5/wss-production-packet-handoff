// V7 media engine — AI logo candidate generation.
// When no logo is sourced, produce 3 mark candidates for the operator/user to
// pick from. Every candidate carries proposed:true provenance (spec §5) — a
// proposed mark never ships without explicit approval.
//
// Two paths:
//  1. LOVABLE_API_KEY present → image model (Lovable AI Gateway) generates
//     3 raster mark candidates from trade + palette + business name.
//  2. No key → 3 deterministic designed SVG candidates (badge monogram, trade
//     emblem, wordmark). These are procedurally designed, still proposed:true.
// Both paths are labeled source:"ai" in assets.json (generated, not sourced).
import { seedFrom } from "../factory/lib/hero-seed.mjs";
import { glyphFor, mix } from "../factory/lib/ambiance-v7.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function generateLogoCandidates({ name, tradeKey, pal, slug, lovableKey = null }) {
  if (lovableKey) {
    try {
      const ai = await aiCandidates({ name, tradeKey, pal, lovableKey });
      if (ai.length === 3) return ai;
    } catch { /* fall through to procedural */ }
  }
  return proceduralCandidates({ name, tradeKey, pal, slug });
}

// ---------------- procedural (zero-key) path ----------------
// Zero-key procedural name wordmark (badge/glyph + business name). Pure, no
// fetch, no API key — the mark a no-website business ships in its preview
// (data-logo-kind="proposed"; they approve a real logo at activation).
export function proceduralWordmarkSvg({ name, tradeKey, pal }) {
  const glyph = glyphFor(tradeKey);
  const words = String(name).split(/\s+/);
  const top = words.slice(0, Math.ceil(words.length / 2)).join(" ");
  const bottom = words.slice(Math.ceil(words.length / 2)).join(" ");
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 96'>
    <g transform='translate(6 20) scale(.9)' stroke='${pal.accent}'>${glyph}</g>
    <text x='72' y='${bottom ? 44 : 58}' font-family='Georgia,serif' font-size='24' font-weight='700' fill='${pal.mode === "light" ? pal.ink : "#f4f0e7"}'>${esc(top)}</text>
    ${bottom ? `<text x='72' y='72' font-family='Georgia,serif' font-size='24' font-weight='700' fill='${pal.accent}'>${esc(bottom)}</text>` : `<rect x='72' y='66' width='120' height='4' rx='2' fill='${pal.accent}'/>`}</svg>`;
}

export function proceduralCandidates({ name, tradeKey, pal, slug }) {
  const seed = seedFrom(`${slug}-logo`, tradeKey);
  const initials = String(name).split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const glyph = glyphFor(tradeKey);
  const fg = pal.mode === "light" ? "#ffffff" : pal.bg;
  const rot = ["badge", "emblem", "wordmark"];
  // deterministic corner-radius / ring style variation
  const rx = [10, 16, 22][Math.floor(seed.rng() * 3)];
  const ring = seed.rng() > 0.5;

  const badge = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>
    <rect width='96' height='96' rx='${rx}' fill='${pal.accent}'/>
    <g transform='translate(16 8) scale(1)' stroke='${fg}' opacity='.45'>${glyph}</g>
    <text x='48' y='66' font-family='Georgia,serif' font-size='38' font-weight='700' fill='${fg}' text-anchor='middle'>${esc(initials)}</text></svg>`;

  const emblem = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>
    <circle cx='48' cy='48' r='44' fill='${pal.mode === "light" ? pal.ink : pal.accent2}'/>
    ${ring ? `<circle cx='48' cy='48' r='36' fill='none' stroke='${pal.accent}' stroke-width='2.5'/>` : ""}
    <g transform='translate(16 16)' stroke='${pal.accent}'>${glyph}</g></svg>`;

  const wordmark = proceduralWordmarkSvg({ name, tradeKey, pal });

  return [badge, emblem, wordmark].map((svg, i) => ({
    kind: "logo",
    url: `data:image/svg+xml,${encodeURIComponent(svg.replace(/\n\s*/g, " "))}`,
    label: `Proposed mark ${i + 1} — ${rot[i]}`,
    meta: { proposed: true, source: "ai", style: rot[i], trade: tradeKey, note: "Generated candidate — pick one or upload your real logo. Never ships without approval." },
  }));
}

// ---------------- image-model path (Lovable AI Gateway) ----------------
async function aiCandidates({ name, tradeKey, pal, lovableKey }) {
  const styles = ["flat geometric badge", "minimal line emblem", "modern wordmark lockup"];
  const out = [];
  for (const style of styles) {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image",
        stream: false,
        modalities: ["image", "text"],
        messages: [{
          role: "user",
          content: [{ type: "text", text: `Design a ${style} logo for "${name}", a ${tradeKey} business. Brand colors: ${pal.accent} accent on ${pal.bg}. Clean vector look, no photograph, no people, transparent background, centered mark.` }],
        }],
      }),
    });
    if (!r.ok) throw new Error(`gateway ${r.status}`);
    const j = await r.json();
    const c = j.choices?.[0]?.message?.content;
    const img = Array.isArray(c) ? c.find((p) => p.type === "image_url" && p.image_url?.url?.startsWith("data:")) : null;
    if (!img) throw new Error("no image in response");
    out.push({
      kind: "logo", url: img.image_url.url, label: `Proposed mark — ${style}`,
      meta: { proposed: true, source: "ai", style, trade: tradeKey, note: "AI-generated candidate — pick one or upload your real logo." },
    });
  }
  return out;
}
