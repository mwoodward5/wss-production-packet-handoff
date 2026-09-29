// Internal citations audit — scans the codebase for unverified-claim flag
// words and reports them with severity + reason. Run with:
//   node scripts/audit-citations.mjs
//
// Verified ground truth lives in src/lib/business.ts and the BBB profile
// linked from there. Anything that claims tenure, licensing, ratings, SLAs,
// or volume that isn't backed by those sources is flagged here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src";
const exts = [".tsx", ".ts"];

// [pattern, severity, why]
const RULES = [
  [/\b\d+\+?\s*(years?|yrs?)\s+(of\s+)?(experience|in\s+business)/i, "high", "Tenure claim — not verified by BBB (founded July 2025)."],
  [/\b(licensed\s+and\s+insured|fully\s+insured|fully\s+licensed)\b/i, "high", "License/insurance claim — not published on source site or BBB."],
  [/\b(\d+(\.\d+)?)\s*\/\s*5\s+(stars?|rating)\b/i, "high", "Numeric star rating — only one verified review exists."],
  [/\b5[\s-]?star\s+(service|rated|reviews?|company|contractor)\b/i, "high", "5-star superlative — unverified."],
  [/\b(within|in)\s+(one|1)\s+business\s+day\b/i, "med", "Turnaround SLA — softened to 'promptly' in audit."],
  [/\b(24[\s/-]?7\s+(service|support|availability)|same[\s-]day\s+service)\b/i, "med", "Availability claim — not on source site."],
  [/\b(award[\s-]?winning|industry[\s-]?leading|best\s+in\s+(town|class))\b/i, "med", "Superlative — unverified."],
  [/\bmoney[\s-]?back\s+guarantee\b/i, "med", "Guarantee claim — verify scope."],
  [/\b(hundreds|thousands)\s+of\s+(jobs|projects|customers|homes)\b/i, "high", "Volume claim — unverified."],
  // Schema rule: only flag actual JSON-LD key, not commentary about it.
  [/["']aggregateRating["']\s*:/i, "high", "Schema.org aggregateRating present — must stay removed."],
];

const SKIP = new Set([
  "src/lib/business.ts",
  "src/routeTree.gen.ts",
  "src/router.tsx",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const findings = [];
for (const file of files) {
  const rel = relative(".", file);
  if (SKIP.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Skip lines that are pure single-line comments — they document, not claim.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    // Skip FAQ question lines (`q: "..."`) — those are user prompts, not
    // claims. The corresponding `a:` line is what gets audited for the claim.
    if (/^q:\s*["'`]/.test(trimmed)) return;
    for (const [re, sev, why] of RULES) {
      if (re.test(line)) {
        findings.push({ file: rel, line: i + 1, sev, why, snippet: trimmed.slice(0, 160) });
      }
    }
  });
}

const bySev = { high: 0, med: 0 };
findings.forEach((f) => (bySev[f.sev] = (bySev[f.sev] ?? 0) + 1));

console.log(`\n=== Internal Citations Audit ===`);
console.log(`Scanned ${files.length} files.`);
console.log(`Findings: ${findings.length}  (high=${bySev.high}  med=${bySev.med})\n`);

if (!findings.length) {
  console.log("✅ No unverified-claim flags detected.");
} else {
  for (const f of findings) {
    console.log(`[${f.sev.toUpperCase()}] ${f.file}:${f.line}`);
    console.log(`  why: ${f.why}`);
    console.log(`  ↳   ${f.snippet}\n`);
  }
  process.exitCode = bySev.high > 0 ? 1 : 0;
}
