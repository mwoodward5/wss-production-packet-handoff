// factory/lib/recipe-bag.mjs — the Lovable "ingredient bag".
// Recipes harvested (read-only, via MCP) from Mark's Lovable projects live in
// factory/recipes/lovable/*.json. At build time the v7 renderer seed-picks one
// and applies it as OVERRIDES on top of the trade palette + type system:
//   fonts (display/body + google import), accent/accent2 (only when the packet
//   has no scraped brand colors — real brand always wins), radius, and up to
//   two keyframes. Missing/empty dir → empty bag → renderer behaves exactly as
//   before. Nothing here removes estimator/chat/launch-rail/logo/flagship/masks.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BAG_DIR = fileURLToPath(new URL("../recipes/lovable/", import.meta.url));

let _bag = null;
export function loadRecipeBag() {
  if (_bag) return _bag;
  const out = [];
  try {
    if (existsSync(BAG_DIR)) {
      for (const f of readdirSync(BAG_DIR)) {
        if (!f.endsWith(".json") || f === "manifest.json") continue;
        try {
          const r = JSON.parse(readFileSync(path.join(BAG_DIR, f), "utf8"));
          if (r && r.id) out.push(r);
        } catch { /* one bad recipe never kills a build */ }
      }
    }
  } catch { /* missing dir → empty bag */ }
  out.sort((a, b) => String(a.id).localeCompare(String(b.id))); // stable order for seeded pick
  _bag = out;
  return out;
}

// "H S% L%" shadcn triple or #hex → #hex (null when unparseable, e.g. oklch/var()).
export function recipeColorToHex(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]) / 360, sa = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + sa) : l + sa - l * sa;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to2 = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to2(f(h + 1 / 3))}${to2(f(h))}${to2(f(h - 1 / 3))}`;
}

function hexLightness(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || "");
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// full google fonts css2 URL → the fragment baseCss splices into its @import
// (`https://fonts.googleapis.com/css2?family=X&family=Y&display=swap` → `X&family=Y`)
function importFragment(url) {
  if (!url || !/fonts\.googleapis\.com/.test(url)) return null;
  const q = url.split("?")[1];
  if (!q) return null;
  const fams = q.split("&").filter((p) => p.startsWith("family=")).map((p) => p.slice(7));
  if (!fams.length) return null;
  return fams.join("&family=");
}

const SERIFISH = /fraunces|caslon|playfair|newsreader|serif|cormorant|zilla|garamond|lora|crimson/i;

// Seeded pick — prefers recipes whose native mode matches the page mode so the
// harvested palette reads coherently; falls back to the whole bag.
export function pickRecipe(rng, mode) {
  const bag = loadRecipeBag();
  if (!bag.length) return null;
  const withFonts = bag.filter((r) => r?.fonts?.display && r?.fonts?.googleImport);
  const pool = withFonts.filter((r) => r?.palette?.mode === mode);
  const from = pool.length >= 3 ? pool : (withFonts.length ? withFonts : bag);
  return from[Math.floor(rng() * from.length)] || null;
}

// Apply recipe as overrides. Returns { pal, type, css, id } — pass-through when
// recipe is null. Real scraped brand colors (packet.source.brandColors) always
// beat recipe colors.
export function applyRecipe(recipe, { pal, type, packet }) {
  if (!recipe) return { pal, type, css: "", id: null };
  let outPal = pal, outType = type, css = "";

  // ---- fonts ----
  const f = recipe.fonts || {};
  const frag = importFragment(f.googleImport);
  if (f.display && frag) {
    const disp = f.display.replace(/['"]/g, "");
    const body = (f.body || f.display).replace(/['"]/g, "");
    outType = {
      display: `'${disp}', ${SERIFISH.test(disp) ? "Georgia, serif" : "system-ui, sans-serif"}`,
      body: `'${body}', system-ui, sans-serif`,
      import: frag,
    };
  }

  // ---- accent colors (only when no scraped brand palette) ----
  const hasBrand = Boolean(packet?.source?.brandColors?.length);
  if (!hasBrand) {
    const vars = recipe.palette?.vars || {};
    const acc = recipeColorToHex(vars["--primary"]);
    const acc2 = recipeColorToHex(vars["--accent"]) || recipeColorToHex(vars["--secondary"]);
    const okFor = (hex) => {
      const L = hexLightness(hex);
      if (L == null) return false;
      return pal.mode === "light" ? (L >= 0.12 && L <= 0.62) : (L >= 0.38 && L <= 0.88);
    };
    if (acc && okFor(acc)) {
      outPal = { ...pal, accent: acc, accent2: acc2 && okFor(acc2) && acc2 !== acc ? acc2 : pal.accent2 };
    }
  }

  // ---- radius ----
  if (recipe.radius && /^[\d.]+(px|rem|em)$/.test(String(recipe.radius).trim())) {
    css += `:root{--radius:${String(recipe.radius).trim()}}\n.btn{border-radius:var(--radius,999px)}\n.svc,.review{border-radius:calc(var(--radius,14px) + 4px)}\n`;
  }

  // ---- keyframes (max 2, appended verbatim) ----
  for (const kf of (recipe.keyframes || []).slice(0, 2)) {
    if (kf?.css && /^@keyframes\s/.test(kf.css) && kf.css.length < 1300) css += kf.css + "\n";
  }

  return { pal: outPal, type: outType, css, id: recipe.id };
}
