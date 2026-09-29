import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CATALOG = require("../recipes/lovable-runtime/hero-patterns.json");
const DEFAULT_TRADE = "default";
const FORBIDDEN = /(?:https?:\/\/|www\.|(?:[A-Za-z]:[\\/])|(?:^|[\\/])(?:src|app|public|node_modules|worktrees)(?:[\\/]|$)|(?:github|gitlab|bitbucket)\.com|@|\b(?:api|endpoint|secret|token|password|client[_ -]?name)\b)/i;

export function getLovablePatternCatalog() {
  return CATALOG;
}

export function normalizeTrade(value) {
  const trade = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (!trade) return DEFAULT_TRADE;
  const knownTrades = [...new Set(CATALOG.patterns.flatMap((pattern) => pattern.trades))]
    .filter((candidate) => candidate !== DEFAULT_TRADE)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  return knownTrades.find((candidate) => trade === candidate || trade.includes(candidate)) ?? trade;
}

export function pickLovablePattern(input, tradeValue) {
  const request = typeof input === "string" ? { slug: input, trade: tradeValue } : (input || {});
  const slug = String(request.slug ?? request.id ?? "site").trim() || "site";
  const trade = normalizeTrade(request.trade ?? request.category);
  const candidates = CATALOG.patterns.filter((pattern) => pattern.trades.includes(trade));
  const pool = (candidates.length ? candidates : CATALOG.patterns).slice().sort(comparePatterns);
  return selectWeighted(pool, hash(`${slug}::${trade}`));
}

export const pickHeroPattern = pickLovablePattern;
export const pickPattern = pickLovablePattern;

export function getLovablePattern(id) {
  return CATALOG.patterns.find((pattern) => pattern.id === id) ?? null;
}

export function validateLovablePatternCatalog(catalog = CATALOG) {
  const errors = [];
  if (catalog?.schema !== "siteforge-lovable-runtime-catalog-v2") errors.push("schema");
  if (!Array.isArray(catalog?.patterns) || catalog.patterns.length === 0) errors.push("patterns");
  const ids = new Set();
  for (const pattern of catalog?.patterns ?? []) {
    if (!pattern.id || ids.has(pattern.id)) errors.push(`duplicate-id:${pattern.id || "missing"}`);
    ids.add(pattern.id);
    if (!Array.isArray(pattern.trades) || !pattern.trades.includes(DEFAULT_TRADE)) errors.push(`trades:${pattern.id}`);
    for (const [key, value] of walkEntries(pattern)) {
      if (FORBIDDEN.test(key) || FORBIDDEN_KEY.test(key)) errors.push(`unsanitized:${pattern.id}`);
      for (const string of walkStrings(value)) if (FORBIDDEN.test(string)) errors.push(`unsanitized:${pattern.id}`);
    }
  }
  for (const value of walkStrings(catalog?.policy)) if (FORBIDDEN.test(value)) errors.push("unsanitized:policy");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function assertSanitizedLovablePatternCatalog(catalog = CATALOG) {
  const result = validateLovablePatternCatalog(catalog);
  if (!result.valid) throw new Error(`Invalid Lovable pattern catalog: ${result.errors.join(", ")}`);
  return catalog;
}

function comparePatterns(a, b) {
  return (a.priority - b.priority) || a.id.localeCompare(b.id);
}

function selectWeighted(patterns, seed) {
  const total = patterns.reduce((sum, pattern) => sum + Math.max(1, Number(pattern.weight) || 1), 0);
  let cursor = seed % total;
  for (const pattern of patterns) {
    cursor -= Math.max(1, Number(pattern.weight) || 1);
    if (cursor < 0) return pattern;
  }
  return patterns[patterns.length - 1];
}

function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function* walkStrings(value) {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const item of value) yield* walkStrings(item);
  else if (value && typeof value === "object") for (const item of Object.values(value)) yield* walkStrings(item);
}

function* walkEntries(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    yield [key, item];
    if (item && typeof item === "object") yield* walkEntries(item);
  }
}

const FORBIDDEN_KEY = /(?:^|[_-])(?:client|source|repository|url|path|endpoint|credential|secret|token|name)(?:$|[_-])/i;

assertSanitizedLovablePatternCatalog();
