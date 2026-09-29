// V7 media engine — procedural per-trade ambiance textures + trade glyphs.
// POLICY (RENDERER_V7_BRIEF §1): generated imagery is ambiance/texture ONLY.
// It is labeled source:"ai" in assets.json, carries data-media-source="ai-ambiance"
// in the DOM, and is NEVER presented as the customer's real jobs, never people,
// never fake before/afters. Real packet photos always outrank these textures.
// Everything here is DETERMINISTIC from the layout seed — no Math.random.

const round = (n) => Math.round(n * 100) / 100;

// Per-trade ambiance recipe: texture mode + tuning. Modes are parametric
// feTurbulence compositions that read as material, not as a photograph.
export const AMBIANCE = {
  "pool service": { mode: "caustics", label: "pool-water texture" },
  roofing:        { mode: "slate",    label: "slate roofline texture" },
  landscaping:    { mode: "contour",  label: "terraced-garden contour texture" },
  plumbing:       { mode: "flow",     label: "brushed-metal flow texture" },
  electrical:     { mode: "circuit",  label: "circuit-glow texture" },
  hvac:           { mode: "waves",    label: "airflow gradient texture" },
  excavation:     { mode: "strata",   label: "earth-strata texture" },
  painting:       { mode: "brush",    label: "brushed-pigment texture" },
  fencing:        { mode: "grain",    label: "cedar-grain texture" },
  "tree care":    { mode: "canopy",   label: "leaf-canopy texture" },
  concrete:       { mode: "speckle",  label: "aggregate texture" },
  cleaning:       { mode: "bokeh",    label: "soft-light texture" },
  solar:          { mode: "panels",   label: "panel-glint texture" },
  default:        { mode: "mesh",     label: "material-mesh texture" },
};

export function ambianceFor(tradeKey) {
  return AMBIANCE[tradeKey] ?? AMBIANCE.default;
}

// Build the ambiance SVG for a trade. `pal` is the v-palette {bg,ink,accent,accent2,mode}.
// `seed` is the deterministic seed object from seedFrom(). Returns inline SVG markup.
export function ambianceSvg(tradeKey, pal, seed, { width = 1000, height = 640, cls = "hero-media ambiance" } = {}) {
  const recipe = ambianceFor(tradeKey);
  const s = ((seed.seed >>> 0) % 977) + 3; // feTurbulence seed, deterministic (seed.seed is signed)
  const id = `amb${s}`;
  const body = TEXTURES[recipe.mode]({ pal, seed, s, id, width, height });
  return `<svg class="${cls}" data-media-source="ai-ambiance" data-ai-media="1" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Abstract ${recipe.label} — generated ambiance, not a job photo">${body}</svg>`;
}

// ---------------- texture library (all deterministic) ----------------
const TEXTURES = {
  caustics: ({ pal, s, id, width, height }) => `
    <defs>
      <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${mix(pal.accent, "#0a3b52", 0.35)}"/><stop offset=".55" stop-color="${pal.accent}"/><stop offset="1" stop-color="${mix(pal.accent, "#03202e", 0.5)}"/>
      </linearGradient>
      <filter id="${id}f" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="turbulence" baseFrequency="0.012 0.028" numOctaves="2" seed="${s}" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="60"/>
      </filter>
      <filter id="${id}spec"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.05" numOctaves="3" seed="${s + 7}" result="n2"/>
        <feSpecularLighting in="n2" surfaceScale="3.2" specularConstant="1.1" specularExponent="14" lighting-color="#dff4ff" result="sp"><feDistantLight azimuth="235" elevation="58"/></feSpecularLighting>
        <feComposite in="sp" in2="SourceAlpha" operator="in"/></filter>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#${id}g)"/>
    <g filter="url(#${id}f)" opacity=".5">${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="${(s * 37 + i * 219) % width}" cy="${90 + i * 118}" rx="${230 + (s + i * 53) % 90}" ry="${34 + (s * (i + 2)) % 26}" fill="#ffffff" opacity=".16"/>`).join("")}</g>
    <rect width="${width}" height="${height}" filter="url(#${id}spec)" opacity=".55"/>`,

  slate: ({ pal, s, id, width, height }) => {
    const rows = 7, cols = 9, rw = width / cols, rh = height / rows;
    let cells = "";
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const off = (r % 2) * (rw / 2), j = ((s + r * 31 + c * 17) % 13) / 13;
      cells += `<rect x="${round(c * rw - off)}" y="${round(r * rh)}" width="${round(rw - 3)}" height="${round(rh - 3)}" rx="2" fill="${mix(pal.ink, pal.accent, 0.12 + j * 0.22)}" opacity="${round(0.85 + j * 0.15)}"/>`;
    }
    return `<rect width="${width}" height="${height}" fill="${pal.ink}"/>${cells}
    <defs><filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="2" seed="${s}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".14"/></feComponentTransfer></filter></defs>
    <rect width="${width}" height="${height}" filter="url(#${id}n)"/>`;
  },

  grain: ({ pal, s, id, width, height }) => `
    <defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${mix(pal.accent, "#6b4423", 0.5)}"/><stop offset="1" stop-color="${mix(pal.accent2, "#3d2914", 0.45)}"/></linearGradient>
    <filter id="${id}f"><feTurbulence type="turbulence" baseFrequency="0.004 0.09" numOctaves="4" seed="${s}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="26"/></filter></defs>
    <rect width="${width}" height="${height}" fill="url(#${id}g)"/>
    <g filter="url(#${id}f)">${Array.from({ length: 14 }, (_, i) => `<line x1="0" y1="${i * (height / 13)}" x2="${width}" y2="${i * (height / 13)}" stroke="${mix(pal.ink, "#2a1a0c", 0.5)}" stroke-width="${1 + ((s + i) % 3)}" opacity=".38"/>`).join("")}</g>`,

  contour: ({ pal, s, id, width, height }) => `
    <rect width="${width}" height="${height}" fill="${mix(pal.bg, pal.accent, 0.18)}"/>
    <g fill="none">${Array.from({ length: 9 }, (_, i) => `<path d="M -40 ${60 + i * 68} C ${200 + (s * (i + 1)) % 120} ${10 + i * 68}, ${430 - (s * i) % 90} ${130 + i * 68}, ${660} ${50 + i * 68} S ${960} ${110 + i * 68}, ${width + 40} ${60 + i * 68}" stroke="${i % 2 ? pal.accent : pal.accent2}" stroke-width="${i % 3 === 0 ? 2.4 : 1.3}" opacity="${round(0.5 - i * 0.035)}"/>`).join("")}</g>
    <defs><filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency=".5" seed="${s}"/><feComponentTransfer><feFuncA type="linear" slope=".08"/></feComponentTransfer></filter></defs><rect width="${width}" height="${height}" filter="url(#${id}n)"/>`,

  flow: ({ pal, s, id, width, height }) => `
    <defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(pal.accent, pal.ink, 0.25)}"/><stop offset=".5" stop-color="${pal.accent}"/><stop offset="1" stop-color="${mix(pal.accent2, pal.ink, 0.3)}"/></linearGradient>
    <filter id="${id}f"><feTurbulence type="turbulence" baseFrequency="0.002 0.04" numOctaves="3" seed="${s}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="42"/></filter></defs>
    <rect width="${width}" height="${height}" fill="url(#${id}g)"/>
    <g filter="url(#${id}f)" opacity=".45">${Array.from({ length: 10 }, (_, i) => `<line x1="-20" y1="${i * (height / 9)}" x2="${width + 20}" y2="${i * (height / 9) + ((s + i * 29) % 60) - 30}" stroke="#ffffff" stroke-width="${0.8 + (i % 3)}" opacity=".33"/>`).join("")}</g>`,

  circuit: ({ pal, s, id, width, height }) => {
    let traces = "";
    for (let i = 0; i < 8; i++) {
      const y = 50 + i * 72, xm = 120 + ((s * (i + 3)) % 500);
      traces += `<path d="M 0 ${y} H ${xm} L ${xm + 46} ${y - 46} H ${xm + 300} L ${xm + 340} ${y} H ${width}" fill="none" stroke="${i % 2 ? pal.accent : pal.accent2}" stroke-width="1.6" opacity=".5"/><circle cx="${xm}" cy="${y}" r="4.5" fill="${pal.accent}" opacity=".9"/>`;
    }
    return `<rect width="${width}" height="${height}" fill="${mix(pal.ink, "#0c0d12", 0.5)}"/>${traces}
    <defs><filter id="${id}glow"><feGaussianBlur stdDeviation="7"/></filter></defs><g filter="url(#${id}glow)" opacity=".6">${traces}</g>`;
  },

  waves: ({ pal, s, id, width, height }) => `
    <defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(pal.bg, pal.accent, 0.3)}"/><stop offset="1" stop-color="${mix(pal.accent, pal.ink, 0.25)}"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#${id}g)"/>
    <g fill="none">${Array.from({ length: 8 }, (_, i) => `<path d="M -30 ${100 + i * 66} q ${180 + (s * i) % 80} ${-64 - (s % 30)} ${420} 0 t ${420} 0 t ${420} 0" stroke="#ffffff" stroke-width="${1.2 + (i % 2)}" opacity="${round(0.3 - i * 0.02)}"/>`).join("")}</g>`,

  strata: ({ pal, s, id, width, height }) => {
    const bands = ["#8a5a2b", "#a9713a", "#6e4a26", "#c2925c", "#553a1f", "#96683a"];
    let g = "";
    for (let i = 0; i < 9; i++) {
      const y = i * (height / 8), amp = 14 + ((s * (i + 1)) % 22);
      g += `<path d="M 0 ${y} C ${width * 0.3} ${y - amp}, ${width * 0.6} ${y + amp}, ${width} ${y - amp / 2} V ${height} H 0 Z" fill="${mix(bands[i % bands.length], pal.accent, 0.15)}" opacity=".9"/>`;
    }
    return `${g}<defs><filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency=".7" seed="${s}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".12"/></feComponentTransfer></filter></defs><rect width="${width}" height="${height}" filter="url(#${id}n)"/>`;
  },

  brush: ({ pal, s, id, width, height }) => `
    <rect width="${width}" height="${height}" fill="${mix(pal.bg, pal.accent2, 0.2)}"/>
    <defs><filter id="${id}f"><feTurbulence type="turbulence" baseFrequency="0.003 0.06" numOctaves="3" seed="${s}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="34"/></filter></defs>
    <g filter="url(#${id}f)">${Array.from({ length: 7 }, (_, i) => `<rect x="-30" y="${i * (height / 6) - 12}" width="${width + 60}" height="${height / 7}" fill="${i % 2 ? pal.accent : pal.accent2}" opacity="${round(0.34 - i * 0.02)}"/>`).join("")}</g>`,

  canopy: ({ pal, s, id, width, height }) => `
    <rect width="${width}" height="${height}" fill="${mix(pal.bg, pal.accent, 0.22)}"/>
    <defs><filter id="${id}f"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="${s}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="46"/></filter></defs>
    <g filter="url(#${id}f)">${Array.from({ length: 12 }, (_, i) => `<circle cx="${(s * 43 + i * 173) % width}" cy="${(s * 29 + i * 131) % height}" r="${60 + (s * (i + 1)) % 70}" fill="${i % 2 ? pal.accent : mix(pal.accent, pal.ink, 0.3)}" opacity=".3"/>`).join("")}</g>`,

  speckle: ({ pal, s, id, width, height }) => `
    <rect width="${width}" height="${height}" fill="${mix(pal.bg, "#9a958c", 0.5)}"/>
    <defs><filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${s}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".5"/></feComponentTransfer></filter>
    <filter id="${id}n2"><feTurbulence type="fractalNoise" baseFrequency=".08" seed="${s + 3}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".2"/></feComponentTransfer></filter></defs>
    <rect width="${width}" height="${height}" filter="url(#${id}n)" opacity=".5"/><rect width="${width}" height="${height}" filter="url(#${id}n2)"/>`,

  bokeh: ({ pal, s, id, width, height }) => `
    <defs><radialGradient id="${id}g"><stop offset="0" stop-color="${mix(pal.bg, "#ffffff", 0.7)}"/><stop offset="1" stop-color="${mix(pal.bg, pal.accent, 0.25)}"/></radialGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#${id}g)"/>
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="${(s * 61 + i * 199) % width}" cy="${(s * 41 + i * 149) % height}" r="${24 + (s * (i + 2)) % 60}" fill="${i % 3 ? "#ffffff" : pal.accent}" opacity="${round(0.1 + ((s + i) % 5) * 0.03)}"/>`).join("")}`,

  panels: ({ pal, s, id, width, height }) => {
    const cols = 8, rows = 5, cw = width / cols, ch = height / rows;
    let cells = "";
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const j = ((s + r * 19 + c * 7) % 11) / 11;
      cells += `<rect x="${round(c * cw + 3)}" y="${round(r * ch + 3)}" width="${round(cw - 6)}" height="${round(ch - 6)}" rx="3" fill="${mix("#12233b", pal.accent, 0.1 + j * 0.3)}"/><line x1="${round(c * cw + 6)}" y1="${round(r * ch + 6)}" x2="${round(c * cw + cw * 0.5)}" y2="${round(r * ch + ch * 0.4)}" stroke="#cfe6ff" stroke-width="1.4" opacity="${round(0.2 + j * 0.4)}"/>`;
    }
    return `<rect width="${width}" height="${height}" fill="#0d1b2e"/>${cells}`;
  },

  mesh: ({ pal, s, id, width, height }) => `
    <rect width="${width}" height="${height}" fill="${mix(pal.bg, pal.accent, 0.16)}"/>
    <g fill="none" stroke="${pal.accent}" opacity=".3">${Array.from({ length: 7 }, (_, i) => `<circle cx="${width / 2 + ((s * (i + 1)) % 120) - 60}" cy="${height / 2}" r="${50 + i * 52}" stroke-width="${i % 2 ? 1 : 2}"/>`).join("")}</g>
    <g fill="none" stroke="${pal.accent2}" opacity=".25">${Array.from({ length: 6 }, (_, i) => `<line x1="${i * (width / 5)}" y1="0" x2="${i * (width / 5) + ((s * i) % 90) - 45}" y2="${height}" stroke-width="1.2"/>`).join("")}</g>
    <defs><filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency=".55" seed="${s}"/><feComponentTransfer><feFuncA type="linear" slope=".1"/></feComponentTransfer></filter></defs><rect width="${width}" height="${height}" filter="url(#${id}n)"/>`,
};

// ---------------- trade glyphs (for logo candidates + accents) ----------------
// Simple, ownable marks — one path each, drawn for a 64×64 box.
export const GLYPHS = {
  "pool service": `<path d="M8 40 q8 -8 16 0 t16 0 t16 0 M8 50 q8 -8 16 0 t16 0 t16 0 M20 30 a12 12 0 0 1 24 0" fill="none" stroke-width="4.5" stroke-linecap="round"/>`,
  roofing: `<path d="M8 42 L32 16 L56 42 M18 42 L32 27 L46 42" fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  landscaping: `<path d="M32 52 V30 M32 36 C20 36 14 26 14 16 C26 16 32 24 32 34 M32 30 C32 20 40 12 50 12 C50 24 44 30 32 30" fill="none" stroke-width="4" stroke-linecap="round"/>`,
  plumbing: `<path d="M32 10 C22 24 16 32 16 41 a16 16 0 0 0 32 0 C48 32 42 24 32 10 Z" fill="none" stroke-width="4.5" stroke-linejoin="round"/>`,
  electrical: `<path d="M36 8 L18 36 H30 L26 56 L46 26 H34 Z" fill="none" stroke-width="4" stroke-linejoin="round"/>`,
  hvac: `<path d="M32 32 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M32 22 C40 14 52 18 50 28 M42 38 C52 42 50 54 40 54 M22 42 C14 50 4 44 8 34 M22 26 C14 20 18 8 28 10" fill="none" stroke-width="4" stroke-linecap="round"/>`,
  excavation: `<path d="M8 50 H40 M14 50 L22 30 H38 L44 42 M38 30 L48 18 L56 24 L50 34" fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  painting: `<path d="M14 12 H42 V24 H14 Z M42 16 H52 V30 H30 V38 M26 38 H34 V54 H26 Z" fill="none" stroke-width="4" stroke-linejoin="round"/>`,
  fencing: `<path d="M14 18 V52 M32 18 V52 M50 18 V52 M8 28 H56 M8 42 H56 M14 18 L14 12 M32 18 L32 12 M50 18 L50 12" fill="none" stroke-width="4" stroke-linecap="round"/>`,
  "tree care": `<path d="M32 54 V34 M32 38 L22 28 M32 32 L42 22 M32 26 a14 14 0 1 1 .1 0" fill="none" stroke-width="4" stroke-linecap="round"/>`,
  concrete: `<path d="M10 44 L28 44 L34 30 L54 30 M10 52 H54 M38 30 V20 H50 V30" fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  cleaning: `<path d="M20 10 L26 24 L40 30 L26 36 L20 50 L14 36 L0 30 L14 24 Z" transform="translate(12 2)" fill="none" stroke-width="4" stroke-linejoin="round"/>`,
  solar: `<path d="M16 40 L24 20 H48 L40 40 Z M20 26 H44 M18 33 H42 M8 50 H52" fill="none" stroke-width="3.6" stroke-linejoin="round"/>`,
  default: `<path d="M32 8 L54 20 V44 L32 56 L10 44 V20 Z M32 20 L43 26 V38 L32 44 L21 38 V26 Z" fill="none" stroke-width="4" stroke-linejoin="round"/>`,
};

export function glyphFor(tradeKey) { return GLYPHS[tradeKey] ?? GLYPHS.default; }

// ---------------- color mix helper (hex only, srgb) ----------------
export function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  if (!pa || !pb) return a;
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
function hex(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
  if (!m) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}
