"use strict";

// scripts/design-brief.js — look at a client's site the way a designer would,
// and write down what you actually saw.
//
//   node scripts/design-brief.js https://theirsite.com
//   node scripts/design-brief.js https://theirsite.com --no-vision
//   node scripts/design-brief.js https://theirsite.com --out artifacts/design-briefs/custom --json
//
// Writes to artifacts/design-briefs/<host>/ :
//   brief.json        the contract in lib/design-brief.js, verbatim
//   full-page.png     what the pixel histogram measured the surface from
//   desktop-0.jpg     what the vision pass was shown
//   desktop-1.jpg
//   mobile-0.jpg
//   loud-N-<kind>.png a clipped picture of each loud element, at its MEASURED
//                     rectangle — so a human can check the brief against the
//                     page rather than taking its word
//
// Flags:
//   --no-vision   measured half only (no API key needed, no spend)
//   --no-crops    skip the loud-element clips
//   --no-fonts    skip the servable-stylesheet lookup
//   --model X     override the vision model
//   --json        print the brief as JSON instead of the human summary
//   --out DIR     write somewhere other than artifacts/design-briefs/<host>
//
// The summary prints MEASURED CANDIDATES next to the chosen values on purpose.
// A brief that only shows its conclusions cannot be argued with; showing the
// shortlist vision picked from is how an operator catches a bad pick in two
// seconds instead of finding it on a customer's live site.
//
// Keys: OPENROUTER_API_KEY or ANTHROPIC_API_KEY. On a developer box the
// breadcrumb env file supplies them; its absence is not an error, it just means
// the run is measured-only unless the environment already carries a key.

const fs = require("node:fs");
const path = require("node:path");

const { buildDesignBrief } = require("../lib/design-brief");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, dflt = "") => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};

const url = argv.find((a) => /^https?:\/\//i.test(a)) || "";
if (!url) {
  console.error("usage: node scripts/design-brief.js <url> [--no-vision] [--no-crops] [--json] [--out DIR]");
  process.exit(2);
}

// Best-effort secret load. A missing breadcrumb file is normal off the dev box.
if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  try {
    require("./brightdata-edit-proof/env").loadEnv();
  } catch { /* environment already carries whatever it carries */ }
}

const hostSlug = (() => {
  try { return new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "-"); }
  catch { return "site"; }
})();
const outDir = path.resolve(value("out", path.join(__dirname, "..", "artifacts", "design-briefs", hostSlug)));

// --- terminal dressing (escapes written as , never as raw bytes) ------
const ESC = "[";
// ESC above is a literal escape byte + "[". Every colour below is composed
// from it, so the codes live in ONE place instead of being sprinkled through
// the strings as invisible bytes that no later edit can safely match on.
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const OFF = `${ESC}0m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const dim = (s) => `${DIM}${s}${OFF}`;
const bold = (s) => `${BOLD}${s}${OFF}`;

const swatch = (hex) => {
  if (!hex) return "";
  const int = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(int)) return "";
  const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
  const ink = 0.299 * r + 0.587 * g + 0.114 * b > 140 ? 30 : 255;
  return `${ESC}48;2;${r};${g};${b}m${ESC}38;2;${ink};${ink};${ink}m ${hex} ${OFF}`;
};

const MARK = { measured: "M", seen: "S", derived: "D", absent: "-" };

function line(brief, field, label, render) {
  const p = brief.provenance[field] || { source: "absent", confidence: 0, note: "" };
  const raw = brief[field];
  const shown = p.source === "absent" || raw == null || raw === "" || (Array.isArray(raw) && !raw.length)
    ? dim("(absent)")
    : (render ? render(raw) : String(raw));
  const conf = p.source === "absent" ? "    " : String(p.confidence).padEnd(4);
  return `  [${MARK[p.source] || "?"}] ${conf} ${label.padEnd(14)} ${shown}${p.note ? `\n              ${dim(p.note)}` : ""}`;
}

function summarize(brief) {
  const out = [];
  out.push("");
  out.push(bold(brief.title || brief.finalUrl));
  out.push(dim(`${brief.finalUrl} · ${brief.version} · ${brief.durationMs}ms`));
  out.push("");
  out.push(`${bold("SURFACE")}   [M]easured [S]een [D]erived  (confidence)`);
  out.push(line(brief, "mode", "mode"));
  out.push(line(brief, "surface", "background", swatch));
  out.push(line(brief, "text", "body text", swatch));
  out.push(line(brief, "muted", "muted text", swatch));
  out.push(line(brief, "border", "border", swatch));
  out.push("");
  out.push(bold("ACCENT"));
  out.push(line(brief, "accent", "accent", swatch));
  out.push(line(brief, "accentText", "accent (text)", swatch));
  out.push(line(brief, "accentHover", "accent (hover)", swatch));
  for (const adj of brief.colorAdjustments || []) {
    out.push(`      ${YELLOW}! adjusted for text use:${OFF} ${swatch(adj.original)} ${adj.ratioBefore}:1 -> ${swatch(adj.adjusted)} ${adj.ratioAfter}:1 (target ${adj.target}:1)`);
    out.push(`        ${dim(`brief.accent still carries the brand colour ${adj.original}`)}`);
  }
  out.push("");
  out.push(`${bold("MEASURED ACCENT CANDIDATES")} ${dim("(vision chose from exactly this list)")}`);
  if (!brief.measurements.accentCandidates.length) out.push(`      ${dim("(no action element carried a colour)")}`);
  for (const c of brief.measurements.accentCandidates) {
    const chosen = brief.accent === c.hex ? `${GREEN}<- chosen${OFF}` : "";
    out.push(`      [${c.index}] ${swatch(c.hex)} ${String(c.role).padEnd(4)} x${String(c.count).padEnd(3)} ${c.labels.slice(0, 2).map((l) => `"${l}"`).join(" ")} ${chosen}`);
  }
  out.push("");
  out.push(bold("TYPE"));
  out.push(line(brief, "fontDisplay", "display", (v) => `${v}  ${dim((brief.fontWeights.display || []).join(", "))}`));
  out.push(line(brief, "fontBody", "body", (v) => `${v}  ${dim((brief.fontWeights.body || []).join(", "))}`));
  out.push(line(brief, "fontHref", "servable"));
  out.push(line(brief, "typographyCharacter", "character"));
  out.push("");
  out.push(bold("FEEL"));
  out.push(line(brief, "temperature", "temperature"));
  out.push(line(brief, "character", "character", (v) => `${v}${brief.characterWords ? ` ${dim(`— ${brief.characterWords}`)}` : ""}`));
  out.push("");
  out.push(`${bold("MEASURED LOUD CANDIDATES")} ${dim("(what the page shouts, before any judgement)")}`);
  if (!brief.measurements.loudCandidates.length) out.push(`      ${dim("(nothing measured as loud)")}`);
  for (const c of brief.measurements.loudCandidates.slice(0, 8)) {
    const flags = `${c.pinned ? "pinned " : "       "}${c.inFirstViewport ? "fold " : "     "}`;
    out.push(`      [${c.index}] ${String(`${Math.round(c.fontSize)}px`).padEnd(6)}${flags}"${c.text.slice(0, 60)}"`);
  }
  out.push("");
  out.push(`${bold("LOUDEST ON THE PAGE")} ${dim("(judged, then verified against the page's own text)")}`);
  if (!brief.loudElements.length) out.push(`      ${dim("(none survived verification)")}`);
  for (const [i, el] of brief.loudElements.entries()) {
    const badge = el.isClaim ? `${YELLOW}CLAIM${OFF}` : "     ";
    const verified = el.textVerified ? `${GREEN}DOM${OFF}` : dim("img");
    out.push(`   ${i}. ${badge} ${verified} ${String(el.kind).padEnd(14)} "${el.text.slice(0, 70)}"`);
    out.push(`              ${dim(`confidence ${el.confidence} · crop ${el.rect ? `${el.rect.x},${el.rect.y} ${el.rect.width}x${el.rect.height}` : el.crop.band} (${el.crop.source})`)}`);
  }
  out.push("");
  out.push(`${bold("IDENTITY IMAGES")} ${dim("(their crew / van / premises / work — URLs measured)")}`);
  if (!brief.identityImages.length) out.push(`      ${dim("(none)")}`);
  for (const img of brief.identityImages) {
    out.push(`      ${String(img.what).padEnd(14)} ${img.width}x${img.height} ${img.sameOrigin ? "own-domain" : `${YELLOW}off-domain${OFF}`} ${img.url.slice(0, 84)}`);
  }
  if (brief.heroImage) {
    out.push("");
    out.push(`${bold("HERO")}  ${brief.heroImage.width}x${brief.heroImage.height} ${brief.heroImage.kind}  ${brief.heroImage.url.slice(0, 90)}`);
  }
  out.push("");
  out.push(`${bold("HERO SLOGAN")} ${dim("(their own first sentence — the h1's first line when it builds)")}`);
  out.push(brief.heroSlogan
    ? `      "${brief.heroSlogan.display}" ${dim(`(${brief.heroSlogan.source}${brief.heroSlogan.fontSize ? `, ${brief.heroSlogan.fontSize}px` : ""})`)}`
    : `      ${dim("(none — the headline will compose from their name)")}`);
  // Printed next to the refusals on purpose: "REFUSED logo third_party_mark"
  // without saying which mark WAS chosen is half a story, and the half that
  // matters is whether we landed on the client's own.
  out.push("");
  const logo = brief.measurements.logo;
  out.push(`${bold("LOGO")}  ${logo
    ? `${logo.naturalWidth}x${logo.naturalHeight} ${logo.inHeader ? "in header" : "on page"} ${dim(`(chosen from ${logo.candidates} eligible)`)}\n      ${logo.url.slice(0, 90)}`
    : dim("(none — every logo-shaped image was somebody else's mark, or there were none)")}`);
  out.push("");
  out.push(`${bold("CARRY OVER")} ${dim("(what a customer would miss if it were gone)")}`);
  if (!brief.carryOver.length) out.push(`      ${dim("(none)")}`);
  for (const c of brief.carryOver) {
    out.push(`      ${c.anchored ? `${GREEN}*${OFF}` : dim("*")} ${c.what} ${dim(`— ${c.why}`)}`);
  }
  if ((brief.refusals || []).length) {
    out.push("");
    out.push(`${BOLD}${RED}REFUSED${OFF} ${dim("(said by the model or the markup, and not allowed into the brief)")}`);
    for (const r of brief.refusals) out.push(`      ${String(r.field).padEnd(16)} ${r.reason}  ${dim(r.detail)}`);
  }
  out.push("");
  return out.join("\n");
}

(async () => {
  const started = Date.now();
  process.stderr.write(`rendering ${url} …\n`);

  const result = await buildDesignBrief(url, {
    vision: !flag("no-vision"),
    crops: !flag("no-crops"),
    fonts: !flag("no-fonts"),
    model: value("model", ""),
  });

  if (!result.ok) {
    console.error(`FAILED: ${result.reason}`);
    process.exit(1);
  }

  const { brief, evidence } = result;

  fs.mkdirSync(outDir, { recursive: true });
  for (const shot of evidence.shots || []) {
    fs.writeFileSync(path.join(outDir, `${shot.id}.jpg`), shot.buffer);
  }
  if (evidence.fullPng) fs.writeFileSync(path.join(outDir, "full-page.png"), evidence.fullPng);

  const written = [];
  const serialisable = {
    ...brief,
    loudElements: brief.loudElements.map((el, i) => {
      if (!el.cropImage) return el;
      const name = `loud-${i}-${String(el.kind).replace(/[^a-z0-9_]/gi, "")}.png`;
      fs.writeFileSync(path.join(outDir, name), el.cropImage);
      written.push(name);
      const { cropImage, ...rest } = el;
      return { ...rest, crop: { ...rest.crop, file: name } };
    }),
  };
  fs.writeFileSync(path.join(outDir, "brief.json"), JSON.stringify(serialisable, null, 2));

  if (flag("json")) {
    console.log(JSON.stringify(serialisable, null, 2));
  } else {
    console.log(summarize(serialisable));
    console.log(dim(`wrote ${outDir}`));
    console.log(dim(`  brief.json, full-page.png, ${(evidence.shots || []).length} screens${written.length ? `, ${written.length} crops` : ""}`));
    const v = brief.vision || {};
    const u = v.usage || null;
    const spend = u
      ? ` · ${u.inputTokens}in/${u.outputTokens}out ${u.costUsd != null ? `$${u.costUsd.toFixed(4)}` : "$? (model not priced)"}`
      : "";
    console.log(dim(`  vision: ${v.attempted ? (v.ok ? `${v.provider}/${v.model}${v.ms ? ` ${v.ms}ms` : ""}${spend}` : `UNAVAILABLE (${v.reason})`) : "skipped"} · total ${Date.now() - started}ms`));
  }
})().catch((e) => {
  console.error(`design-brief crashed: ${(e && e.stack) || e}`);
  process.exit(1);
});
