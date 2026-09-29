// SiteForge SaaS — shared utilities. Zero dependencies, Node 22+.
import { createHmac, createHash, randomBytes, timingSafeEqual as tse } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

export const nowIso = () => new Date().toISOString();
export const id = (prefix) => `${prefix}_${randomBytes(9).toString("base64url")}`;
export const token = (bytes = 24) => randomBytes(bytes).toString("base64url");
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const privatePreviewKey = (businessName, entropy = token(8)) => {
  const business = kebab(businessName || "business").slice(0, 42) || "business";
  const suffix = String(entropy).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 16) || token(8).toLowerCase();
  return `${business}-${suffix}`;
};

export function hmacSign(value, secret) {
  return `${value}.${createHmac("sha256", secret).update(value).digest("base64url")}`;
}
export function hmacVerify(signed, secret) {
  if (typeof signed !== "string") return null;
  const i = signed.lastIndexOf(".");
  if (i < 1) return null;
  const value = signed.slice(0, i);
  const expected = hmacSign(value, secret);
  const a = Buffer.from(signed), b = Buffer.from(expected);
  if (a.length !== b.length || !tse(a, b)) return null;
  return value;
}
export function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && tse(ba, bb);
}

// ---------- HTML ----------
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const escAttr = esc;

// ---------- cookies ----------
export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function cookie(name, value, { maxAge = 60 * 60 * 24 * 30, httpOnly = true, path: p = "/", sameSite = "Lax", secure = false } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${p}; SameSite=${sameSite}; Max-Age=${maxAge}`;
  if (httpOnly) c += "; HttpOnly";
  if (secure) c += "; Secure";
  return c;
}

// ---------- body parsing ----------
export function readBody(req, limit = 1024 * 512) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("payload too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
export async function readJson(req) {
  const raw = await readBody(req);
  try { return JSON.parse(raw.toString("utf8") || "{}"); } catch { throw new Error("invalid JSON body"); }
}
export async function readForm(req) {
  const raw = (await readBody(req)).toString("utf8");
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

// ---------- validation ----------
export function need(obj, fields) {
  const missing = fields.filter((f) => obj[f] == null || String(obj[f]).trim() === "");
  if (missing.length) { const e = new Error(`Missing required fields: ${missing.join(", ")}`); e.status = 400; throw e; }
}
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ""));
export const isUrl = (s) => { try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } };
export const clampStr = (s, n = 300) => String(s ?? "").slice(0, n);
export const kebab = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// ---------- rate limiting (fixed window, in-memory) ----------
const buckets = new Map();
export function rateLimit(key, { max = 10, windowMs = 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count += 1;
  if (buckets.size > 10000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  return { ok: b.count <= max, remaining: Math.max(0, max - b.count), reset: b.reset };
}

// ---------- atomic JSON file ----------
export function readJsonFile(fp, fallback = null) {
  try { return JSON.parse(readFileSync(fp, "utf8")); } catch { return fallback; }
}
export function writeJsonFile(fp, data) {
  mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, fp);
}
export function ensureDir(dir) { mkdirSync(dir, { recursive: true }); return dir; }
export { existsSync };

// ---------- misc ----------
export function ipOf(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}
export function fmtMoney(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
export function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return iso; }
}
export function daysFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString(); }
