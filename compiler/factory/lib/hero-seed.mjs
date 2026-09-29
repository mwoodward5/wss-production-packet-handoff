// Deterministic per-site layout seed derived from slug + trade.
// Same inputs → same output. This is where "controlled uniqueness" lives.
import crypto from "node:crypto";

export function seedFrom(slug, trade) {
  const h = crypto.createHash("sha256").update(`${slug}::${trade}`).digest();
  // Convert to a seedable RNG state (mulberry32)
  const seed = h.readUInt32BE(0) ^ h.readUInt32BE(4);
  const rng = mulberry32(seed);
  return {
    seed,
    rng,
    zOrder: shuffle([1, 2, 3, 4, 5, 6, 7, 8], rng),
    blobPoints: blob8(rng),
    smoothnessBand: pick(["taut", "flowing", "loose"], rng),
    headlineCols: 5 + Math.floor(rng() * 4), // 5..8
    motifQuadrant: pick(["tl", "tr", "bl", "br"], rng),
    motifScale: pick([0.6, 0.85, 1.1], rng),
    hueRotate: Math.floor(rng() * 40) - 20, // -20..+20 deg
    cadence: pick(["snap", "flow", "hold"], rng),
  };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// 8-point blob for hero mask. Catmull-Rom spline points around a unit circle
// with per-point radius jitter.
function blob8(rng) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = 0.7 + rng() * 0.35;
    pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  return pts;
}

// Emit an SVG <path d> string for the blob, scaled to a 1000x1000 viewBox.
export function blobToPath(points) {
  const s = 500; // scale
  const c = 500; // center
  const p = points.map(([x, y]) => [c + x * s * 0.85, c + y * s * 0.85]);
  // Simple closed Catmull-Rom → cubic Bezier
  let d = `M ${p[0][0]} ${p[0][1]}`;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n];
    const p1 = p[i];
    const p2 = p[(i + 1) % n];
    const p3 = p[(i + 2) % n];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d + " Z";
}
