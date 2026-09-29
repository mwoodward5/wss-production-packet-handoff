// SiteForge SaaS — data store. JSON-file backed with the same shape as
// app/schema.sql (Postgres/Supabase). Swap by implementing the same interface
// against postgres; every call site goes through this module.
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readdirSync, rmSync, statSync } from "node:fs";
import { readJsonFile, writeJsonFile, nowIso, id, ensureDir } from "./util.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVERLESS_STORE = () => process.env.SITEFORGE_SERVERLESS === "1" || Boolean(process.env.VERCEL);
const DEFAULT_DATA_DIR = SERVERLESS_STORE() ? path.join(tmpdir(), `sf-data-${process.pid}`) : path.join(APP_ROOT, "data");
export const DATA_DIR = process.env.SITEFORGE_DATA_DIR || DEFAULT_DATA_DIR;
export const SITES_DIR = path.join(DATA_DIR, "sites");       // generated site versions
export const PUBLISHED_DIR = path.join(DATA_DIR, "published"); // locally published sites
export const TRY_DIR = path.join(DATA_DIR, "try");            // template try-on previews
const DB_PATH = path.join(DATA_DIR, "db.json");

const TABLES = [
  "users", "sessions", "magic_tokens", "site_projects", "business_profiles",
  "business_assets", "site_generations", "site_qc_reports", "deployments",
  "subscriptions", "entitlements", "edit_requests", "audit_logs", "jobs",
  "dev_inbox", "webhook_events", "leads", "review_requests", "rank_snapshots",
  "client_workspaces", "api_keys", "webhook_deliveries", "failed_leads",
];

let db = null;
let writeTimer = null;
let dirty = false;
let hydratePromise = null;

// Serverless /tmp is memory-backed and bounded by the function's memory. Each
// instance writes to sf-data-<pid>, but Vercel recycles pids across warm
// invocations, so stale sf-data-* dirs from prior instances pile up until a
// build hits ENOSPC ("no space left on device" on intake-genie-cache mkdir —
// the observed root cause of builds never reaching done). At cold start, purge
// sibling sf-data-* dirs that aren't ours and are older than 10 minutes.
let purgedTmp = false;
function purgeStaleTmp() {
  if (purgedTmp || !SERVERLESS_STORE()) return;
  purgedTmp = true;
  try {
    const root = tmpdir();
    const mine = path.basename(DATA_DIR);
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const name of readdirSync(root)) {
      if (!name.startsWith("sf-data-") || name === mine) continue;
      const full = path.join(root, name);
      try {
        if (statSync(full).mtimeMs < cutoff) rmSync(full, { recursive: true, force: true });
      } catch { /* another instance may be mid-write; skip */ }
    }
  } catch { /* best-effort — never block a build on cleanup */ }
}

function load() {
  if (db) return db;
  purgeStaleTmp();
  ensureDir(DATA_DIR); ensureDir(SITES_DIR); ensureDir(PUBLISHED_DIR); ensureDir(TRY_DIR);
  db = readJsonFile(DB_PATH, null) ?? {};
  for (const t of TABLES) db[t] ??= [];
  return db;
}
function persist() {
  dirty = true;
  if (SERVERLESS_STORE()) return;
  // debounce writes; flush is also called on process exit
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; writeJsonFile(DB_PATH, db); }, 50);
}
export function flush() {
  if (!db) return;
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  if (!SERVERLESS_STORE()) writeJsonFile(DB_PATH, db);
}
process.on("exit", flush);

// ---------- serverless (Vercel Blob) persistence ----------
// hydrate() runs once per cold start BEFORE any request; flushRemote() runs
// after each mutating request (awaited by the api wrapper).
async function hydrateOnce() {
  const { BLOB_ENABLED, blobList } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return false;
  load();
  const blobs = (await blobList("db/").catch(() => [])).sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
  if (blobs[0]?.url) {
    const res = await fetch(blobs[0].url, { cache: "no-store" }).catch(() => null);
    const remote = res?.ok ? await res.json().catch(() => null) : null;
    if (remote) {
      db = remote;
      for (const t of TABLES) db[t] ??= [];
      if (!SERVERLESS_STORE()) writeJsonFile(DB_PATH, db);
    }
  }
  dirty = false;
  return true;
}
export function hydrate() {
  // Hydration replaces the module-global database, so it must happen exactly
  // once per cold process. Rehydrating during a long-running stage can replace
  // its live lease with an older Blob snapshot while a status poll overlaps.
  hydratePromise ??= hydrateOnce();
  return hydratePromise;
}
export async function flushRemote() {
  if (!dirty || !db) return;
  const { BLOB_ENABLED, blobPut, blobList, blobDeleteUrls } = await import("./blob-store.mjs");
  if (!BLOB_ENABLED()) return;
  dirty = false;
  if (!SERVERLESS_STORE()) flush();
  try {
    await blobPut(`db/${String(Date.now()).padStart(15, "0")}-${Math.random().toString(36).slice(2, 7)}.json`, JSON.stringify(db), "application/json");
    const old = (await blobList("db/")).sort((a, b) => (a.pathname < b.pathname ? 1 : -1)).slice(3);
    await blobDeleteUrls(old.map((b) => b.url));
  } catch (e) { dirty = true; console.error("[store] blob flush failed:", e.message); }
}

// ---------- generic ----------
export function insert(table, row) {
  const d = load();
  const rec = { id: row.id ?? id(table.slice(0, 4)), created_at: nowIso(), updated_at: nowIso(), ...row };
  d[table].push(rec); persist();
  return rec;
}
export function update(table, idv, patch) {
  const d = load();
  const rec = d[table].find((r) => r.id === idv);
  if (!rec) return null;
  Object.assign(rec, patch, { updated_at: nowIso() }); persist();
  return rec;
}
export function get(table, idv) { return load()[table].find((r) => r.id === idv) ?? null; }
export function find(table, pred) { return load()[table].find(pred) ?? null; }
export function where(table, pred) { return load()[table].filter(pred); }
export function all(table) { return [...load()[table]]; }
export function remove(table, idv) {
  const d = load();
  const i = d[table].findIndex((r) => r.id === idv);
  if (i >= 0) { d[table].splice(i, 1); persist(); return true; }
  return false;
}

// ---------- audit ----------
export function audit(actor_user_id, action, subject, meta = {}) {
  return insert("audit_logs", { actor_user_id, action, subject, meta });
}

// ---------- domain helpers ----------
export function userByEmail(email) {
  const e = String(email).toLowerCase().trim();
  return find("users", (u) => u.email === e);
}
export function projectsOf(userId) {
  return where("site_projects", (p) => p.user_id === userId && p.status !== "deleted")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
export function profileOf(projectId) { return find("business_profiles", (b) => b.project_id === projectId); }
export function assetsOf(projectId) { return where("business_assets", (a) => a.project_id === projectId); }
export function generationsOf(projectId) {
  return where("site_generations", (g) => g.project_id === projectId)
    .sort((a, b) => b.version - a.version);
}
export function latestGeneration(projectId) { return generationsOf(projectId)[0] ?? null; }
export function qcOf(generationId) { return find("site_qc_reports", (q) => q.generation_id === generationId); }
export function deploymentsOf(projectId) {
  return where("deployments", (d) => d.project_id === projectId)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
export function subscriptionOf(userId) {
  return where("subscriptions", (s) => s.user_id === userId && ["active", "trialing"].includes(s.status))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] ?? null;
}
export function entitlementsOf(userId) { return where("entitlements", (e) => e.user_id === userId && e.active); }
export function editRequestsOf(projectId) {
  return where("edit_requests", (e) => e.project_id === projectId)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
export function leadsOf(userId, projectIds = null) {
  const allowed = projectIds ? new Set(projectIds) : null;
  return where("leads", (row) => row.user_id === userId && (!allowed || allowed.has(row.project_id)))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
export function reviewRequestsOf(userId, projectIds = null) {
  const allowed = projectIds ? new Set(projectIds) : null;
  return where("review_requests", (row) => row.user_id === userId && (!allowed || allowed.has(row.project_id)))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
export function rankSnapshotsOf(userId, projectIds = null) {
  const allowed = projectIds ? new Set(projectIds) : null;
  return where("rank_snapshots", (row) => row.user_id === userId && (!allowed || allowed.has(row.project_id)))
    .sort((a, b) => (b.observed_at || b.created_at || "").localeCompare(a.observed_at || a.created_at || ""));
}
export function clientsOf(userId) {
  return where("client_workspaces", (row) => row.user_id === userId && row.status !== "archived")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
export function apiKeysOf(userId) {
  return where("api_keys", (row) => row.user_id === userId && !row.revoked_at)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
export function generationsThisMonth(userId) {
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const iso = monthStart.toISOString();
  return where("site_generations", (g) => g.user_id === userId && g.created_at >= iso && g.status !== "failed").length;
}
export function siteDirFor(projectId, version) { return path.join(SITES_DIR, projectId, `v${version}`); }
