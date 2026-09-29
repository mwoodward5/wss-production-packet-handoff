#!/usr/bin/env node
"use strict";

// scripts/local-env.cjs — LOCAL-FIRST PARITY SCRIPT for the WSS factory.
//
//   node scripts/local-env.cjs gen      generate .env.local + local TLS certs
//   node scripts/local-env.cjs up       docker compose up -d (waits for health)
//   node scripts/local-env.cjs health   admin health check (x-admin-token)
//   node scripts/local-env.cjs smoke    1-row sandbox campaign end-to-end
//   node scripts/local-env.cjs down     stop the stack
//   node scripts/local-env.cjs all      gen → up → health → smoke
//
// Runs the UNMODIFIED backend against local Postgres/PostgREST/storage-api.
// Provider keys are imported from C:\ghx-worker-env\env.latest when present
// (FIRECRAWL / OPENROUTER / RESEND), otherwise left blank and the smoke run
// stops at the first key-wall with an exact report.

const { execSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(REPO_ROOT, ".env.local");
const TLS_DIR = path.join(REPO_ROOT, ".local", "tls");
const WORKER_ENV_CANDIDATES = [
  "C:\\ghx-worker-env\\env.latest",
  "C:\\ghx-worker-env\\env.production",
  "C:\\ghx-worker-env\\prod-pull.env",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(secret, payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

function readWorkerEnv() {
  // Merge every candidate file; the first non-empty value for a key wins.
  const merged = {};
  let first = null;
  const present = WORKER_ENV_CANDIDATES.filter((candidate) => fs.existsSync(candidate));
  for (const candidate of present) {
    if (!first) first = candidate;
    for (const line of fs.readFileSync(candidate, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (value && !merged[key]) merged[key] = value;
    }
  }
  return { file: present.join(" + ") || null, env: merged };
}

function openssl(args, stdin) {
  const result = spawnSync("openssl", args, { input: stdin, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`openssl ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO_ROOT, stdio: opts.stdio || "pipe", shell: "bash", ...opts });
}

// ---------------------------------------------------------------------------
// gen — .env.local + TLS
// ---------------------------------------------------------------------------
// Provider keys imported from the owner's worker env when present. Anything
// not listed here and not generated stays blank in .env.local so the backend
// degrades to documented dry-run/sandbox behavior instead of failing loudly.
const IMPORT_FROM_WORKER_ENV = [
  "FIRECRAWL_API_KEY",
  "ZAI_AGENTS_KEY",
  "OPENROUTER_API_KEY",
  "RESEND_API_KEY",
  "GHOST_AGENCY_RESEND_RECEIVING_API_KEY",
  "GHOST_AGENCY_LLM_KEY",
  "GHOST_AGENCY_LLM_PROVIDER",
  "GHOST_AGENCY_LLM_MODEL",
  "GHOST_AGENCY_COMPOSE_MODEL",
  "GHOST_AGENCY_ADMIN_TOKEN",
  "CRON_SECRET",
  "GHOST_AGENCY_OWNER_EMAIL",
  "GHOST_AGENCY_SANDBOX_AUTOSEND",
  "GHOST_AGENCY_RESEND_FROM",
  "GHOST_AGENCY_OUTREACH_FROM",
  "GHOST_AGENCY_OUTREACH_REPLY_TO",
  "GHOST_AGENCY_SUPPORT_EMAIL",
  "GHOST_AGENCY_SUPPORT_PHONE",
  "GHOST_AGENCY_POSTAL_ADDRESS",
  "GHOST_AGENCY_SENDER_NAME",
  "GHOST_AGENCY_MIRROR_DONOR_PATH",
  "GHOST_AGENCY_VISUAL_SECRET",
  "GHOST_AGENCY_HERO_VISUAL_GATE_SECRET",
  "GHOST_AGENCY_EDIT_CONFIRM_SECRET",
  "EMAIL_UNSUB_SECRET",
];

function generateEnv() {
  const { file: workerFile, env: worker } = readWorkerEnv();
  const jwtSecret =
    process.env.LOCAL_JWT_SECRET ||
    "super-secret-jwt-token-with-at-least-32-characters-long";

  // Supabase-compatible local keys (role claim drives PostgREST role switch).
  const iat = Math.floor(Date.now() / 1000) - 60;
  const exp = iat + 10 * 365 * 24 * 3600;
  const anonKey = signJwt(jwtSecret, { iss: "supabase", role: "anon", iat, exp });
  const serviceKey = signJwt(jwtSecret, { iss: "supabase", role: "service_role", iat, exp });

  // Auth secrets must be STABLE across regens (containers cache env at
  // creation; a rotating secret 401s the factory-cron sweep). Derive them
  // from the fixed local JWT secret instead of randomness. The worker env's
  // values win when present.
  const stable = (name) =>
    crypto.createHmac("sha256", jwtSecret).update(`wss-localfirst:${name}`).digest("hex");
  const adminToken = worker.GHOST_AGENCY_ADMIN_TOKEN || stable("admin-token");
  const cronSecret = worker.CRON_SECRET || stable("cron-secret");
  const routerSecret = stable("site-router-proxy-secret");
  const previewSecret = stable("site-preview-secret");
  // Mirror-release evidence HMAC key is empty in every worker env pull — it is
  // a local HMAC secret over build evidence, so we mint our own (stable).
  const evidenceKey = stable("mirror-release-evidence-hmac");
  const heroWorkerToken = stable("hero-worker-token");

  // Local CallPrep closure: signal reports served from this machine on the
  // production origin. The gateway's https://callprep.wss-ai.com block fronts
  // the local service (infra/callprep/server.cjs), so the backend's existing
  // CALLPREP_* clients keep working unchanged. A worker-env CALLPREP_SUPABASE_URL
  // (the hosted project) wins explicitly — that is the production-dependency
  // mode, kept opt-in.
  const callprepLocal = {
    "CALLPREP_SUPABASE_URL": "https://callprep.wss-ai.com",
    "CALLPREP_SUPABASE_ANON_KEY": anonKey,
    "CALLPREP_GHOST_ADAPTER_URL": "https://callprep.wss-ai.com/functions/v1/ghost-report-adapter",
    "GHOST_REPORT_ADAPTER_HMAC_SECRET": stable("callprep-adapter-hmac"),
  };
  const callprepImported = [
    "CALLPREP_SUPABASE_URL",
    "CALLPREP_SUPABASE_ANON_KEY",
    "CALLPREP_GHOST_ADAPTER_URL",
    "GHOST_REPORT_ADAPTER_HMAC_SECRET",
  ].every((name) => worker[name]);
  const callprepLines = callprepImported
    ? callprepImported.map((name) => `${name}=${worker[name]}`)
    : Object.entries(callprepLocal).map(([name, value]) => `${name}=${value}`);
  // Optional scan keys for the local api-gateway (blank = the keyed actions
  // answer settled no_<x>_key errors and those categories stay not_provided).
  const scanKeyLines = [
    "GOOGLE_PLACES_KEY", "GOOGLE_PSI_KEY", "PSI_API_KEY",
    "WHATCMS_API_KEY", "CLEARBIT_API_KEY",
  ].map((name) => `${name}=${worker[name] || ""}`);

  // Intake-genie compiler closure: the wss-local-compiler container (compose
  // `compiler` profile, image wss-intake-compiler:local from the private
  // sibling repo wss-intake-compiler-siteforge) serves site compilation on
  // the compose network at http://wss-local-compiler:8787. The token is
  // shared with the compiler's own env — reuse the value already in .env.local
  // when present (regeneration must never rotate it); mint a fresh 64-hex
  // only when absent.
  let intakeGenieToken = null;
  try {
    const m = fs.readFileSync(ENV_FILE, "utf8").match(/^INTAKE_GENIE_TOKEN=(\S+)\s*$/m);
    if (m && m[1]) intakeGenieToken = m[1];
  } catch { /* first gen — nothing to reuse */ }
  if (!intakeGenieToken) intakeGenieToken = crypto.randomBytes(32).toString("hex");

  const lines = [
    "# .env.local — GENERATED by scripts/local-env.cjs. Local-only secrets.",
    `# provider keys imported from: ${workerFile || "NOWHERE (fill manually)"}`,
    "",
    "# --- local supabase surface (JWTs signed with SUPABASE_JWT_SECRET) ---",
    `SUPABASE_JWT_SECRET=${jwtSecret}`,
    `SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    "",
    "# --- factory auth ---",
    `GHOST_AGENCY_ADMIN_TOKEN=${adminToken}`,
    `ADMIN_TOKEN=${adminToken}`,
    `CRON_SECRET=${cronSecret}`,
    "",
    "# --- shared-site serving (site-router ⇄ backend HMAC proxy) ---",
    `WSS_SHARED_SITE_ROUTER_PROXY_SECRET=${routerSecret}`,
    `WSS_SITE_PREVIEW_SECRET=${previewSecret}`,
    `GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY=${evidenceKey}`,
    `GHOST_AGENCY_HERO_WORKER_TOKEN=${heroWorkerToken}`,
    `WSS_SHARED_SERVING_ENABLED=1`,
    `WSS_SHARED_PUBLISH_ENABLED=1`,
    `WSS_SHARED_SITE_ENV=local`,
    `WSS_SITE_ROUTER_ENV=local`,
    // The publish gate and the serving proxy accept only "*", a site UUID, or
    // an exact slug — a domain here matches nothing and silently 403s every
    // site (shared_site_not_allowlisted). Local hosts resolve only inside this
    // machine, so the local default allows every locally-built site.
    `WSS_SHARED_SITE_ALLOWLIST=*`,
    // The storage-api container is profile-gated in docker-compose.yml; without
    // this every compose command (including a bare `up`) skips it and every
    // release fetch 503s at the signed-URL leg.
    `COMPOSE_PROFILES=storage`,
    "",
    ...callprepLines.map((line, index) => (index === 0
      ? `# --- CallPrep signal reports (${callprepImported ? "imported: hosted project (production dependency)" : "local closure on the production origin"}) ---\n${line}`
      : line)),
    ...scanKeyLines,
    "",
    // --- intake-genie compiler (wss-local-compiler, compose `compiler` profile) ---
    "INTAKE_GENIE_BASE_URL=http://wss-local-compiler:8787",
    `INTAKE_GENIE_TOKEN=${intakeGenieToken}`,
    `INTAKE_GENIE_CERTIFICATION_KEY=${stable("intake-genie-certification-key")}`,
    "GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION=1",
    "GHOST_MIRROR_LANE=1",
    "",
    "# --- public URLs (local) ---",
    "GHOST_AGENCY_PUBLIC_URL=https://api.local.wss-ai.test:5443",
    "PUBLIC_APP_URL=https://api.local.wss-ai.test:5443",
    "GHOST_AGENCY_PROOF_PREVIEW_URL=https://api.local.wss-ai.test:5443",
    "",
    "# --- sandbox defaults: NO live prospect sends ---",
    "GHOST_AGENCY_LINE_LIVE_SENDS=0",
    "STRIPE_ALLOW_LIVE=0",
    "STRIPE_TEST_CHECKOUT_ENABLED=0",
    "GHOST_AGENCY_REMOTE_BROWSER=", // local playwright chromium, not Firecrawl CDP
    "",
    "# --- provider keys (blank = feature runs in dry-run/degraded mode) ---",
  ];
  for (const name of IMPORT_FROM_WORKER_ENV) {
    if (["GHOST_AGENCY_ADMIN_TOKEN", "CRON_SECRET"].includes(name)) continue;
    lines.push(`${name}=${worker[name] || ""}`);
  }
  lines.push("");

  // CREDENTIAL PRESERVATION on regeneration: any key already present in
  // .env.local with a nonempty value keeps that exact value. A regen must
  // never silently blank a hand-filled provider key back into dry-run mode.
  let existing = new Map();
  try {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, "$2").trim();
      if (value) existing.set(m[1], m[2].trim());
    }
  } catch { /* first gen — nothing to preserve */ }
  let preserved = 0;
  const finalLines = lines.map((line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) return line;
    const kept = existing.get(m[1]);
    if (kept === undefined || kept === "") return line;
    if (kept === m[2]) return line;
    preserved += 1;
    return `${m[1]}=${kept}`;
  });
  if (preserved) console.log(`[gen] preserved ${preserved} existing nonempty value(s) from the previous .env.local`);

  fs.writeFileSync(ENV_FILE, finalLines.join("\n"), "utf8");
  console.log(`[gen] wrote ${ENV_FILE}`);
  const keyReport = IMPORT_FROM_WORKER_ENV.filter(
    (n) => !["GHOST_AGENCY_ADMIN_TOKEN", "CRON_SECRET"].includes(n),
  ).map((n) => `${n}=${worker[n] ? "SET" : "blank"}`);
  console.log("[gen] provider keys: " + keyReport.join("  "));
  return { worker };
}

function generateTls() {
  fs.mkdirSync(TLS_DIR, { recursive: true });
  const caKey = path.join(TLS_DIR, "ca.key");
  const caCrt = path.join(TLS_DIR, "ca.crt");
  if (!fs.existsSync(caCrt)) {
    openssl(["genrsa", "-out", caKey, "2048"]);
    openssl(
      ["req", "-x509", "-new", "-nodes", "-key", caKey, "-sha256", "-days", "825",
       "-out", caCrt, "-subj", "/CN=WSS Local First CA"],
    );
    console.log("[gen] created local CA (.local/tls/ca.crt)");
  }
  const hosts = [
    ["supabase.local.wss-ai.test", ["supabase.local.wss-ai.test", "localhost"]],
    ["api.local.wss-ai.test", ["api.local.wss-ai.test", "localhost"]],
    ["wild.local.wss-ai.test", ["*.local.wss-ai.test", "local.wss-ai.test"]],
    // Canonical-host closure + local CallPrep: the gateway terminates real
    // *.wss-ai.com hostnames (site previews, callprep.wss-ai.com) with this
    // locally-signed wildcard. Same CA the backend already trusts.
    ["wild.wss-ai.com", ["*.wss-ai.com", "wss-ai.com"]],
  ];
  for (const [name, dns] of hosts) {
    const key = path.join(TLS_DIR, `${name}.key`);
    const crt = path.join(TLS_DIR, `${name}.crt`);
    const csr = path.join(TLS_DIR, `${name}.csr`);
    const ext = path.join(TLS_DIR, `${name}.ext`);
    if (fs.existsSync(crt)) continue;
    fs.writeFileSync(
      ext,
      ["subjectAltName=" + dns.map((d) => `DNS:${d}`).join(","),
       "extendedKeyUsage=serverAuth", "keyUsage=digitalSignature,keyEncipherment",
       "subjectAltName=" + dns.map((d) => `DNS:${d}`).join(",")].join("\n"),
    );
    openssl(["genrsa", "-out", key, "2048"]);
    openssl(["req", "-new", "-key", key, "-out", csr, "-subj", `/CN=${name}`]);
    openssl(["x509", "-req", "-in", csr, "-CA", caCrt, "-CAkey", caKey,
             "-CAcreateserial", "-out", crt, "-days", "825", "-sha256", "-extfile", ext]);
    console.log(`[gen] issued cert for ${dns.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// up / health / smoke
// ---------------------------------------------------------------------------
// Explicit schema order (docker-entrypoint-initdb.d ignores mounted
// directories and repo SQL has cross-file dependencies, so the parity script
// owns schema application). Each file is applied with ON_ERROR_STOP=0;
// sql/*.sql gets a second pass because its files reference each other.
function schemaFiles() {
  const B = path.join(REPO_ROOT, "apps", "backend");
  return {
    supabase: [
      "supabase/ghost-agency-schema.sql",
      "supabase/ghost-agency-main-runtime-addendum.sql",
      "supabase/ghost-agency-cron-addendum.sql",
      "supabase/line-batches.sql",
      "supabase/shared-site-releases.sql",
      "supabase/supervised-held-drafts.sql",
      "supabase/resend-webhook-idempotency.sql",
      "supabase/console-data-performance.sql",
      "supabase/callprep-reports.sql",
    ].map((f) => path.join(B, f)),
    products: fs.readdirSync(path.join(B, "sql")).sort().map((f) => path.join(B, "sql", f)),
    migrations: fs
      .readdirSync(path.join(REPO_ROOT, "db", "migrations"))
      .sort()
      .map((f) => path.join(REPO_ROOT, "db", "migrations", f)),
  };
}

function applySqlFile(file) {
  // psql via docker exec; stdin piping keeps ON_ERROR_STOP=0 semantics.
  const sql = fs.readFileSync(file, "utf8");
  const result = spawnSync(
    "docker",
    ["exec", "-i", "wss-local-db", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=0", "-q"],
    { input: sql, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const errors = (result.stdout + result.stderr).split("\n").filter((l) => l.startsWith("ERROR")).length;
  return errors;
}

function applySchema() {
  const files = schemaFiles();
  let totalErrors = 0;
  for (const f of files.supabase) {
    const e = applySqlFile(f);
    if (e) console.log(`[schema] ${path.basename(f)}: ${e} errors`);
    totalErrors += e;
  }
  for (const f of files.products) totalErrors += applySqlFile(f);
  for (const f of files.migrations) totalErrors += applySqlFile(f);
  // Second pass: product SQL files reference tables created by siblings.
  for (const f of files.products) totalErrors += applySqlFile(f);
  const count = spawnSync("docker", [
    "exec", "wss-local-db", "psql", "-U", "postgres", "-tAc",
    "select count(*) from information_schema.tables where table_schema='public'",
  ], { encoding: "utf8" });
  console.log(`[schema] applied (residual cross-product errors tolerated: ${totalErrors}); public tables: ${(count.stdout || "").trim()}`);
  // PostgREST caches the schema at boot; new tables (e.g. callprep reports)
  // are invisible to REST until the documented reload notification fires.
  spawnSync("docker", ["exec", "wss-local-db", "psql", "-U", "postgres", "-c", "NOTIFY pgrst, 'reload schema';"]);
  console.log("[schema] postgrest schema cache reloaded (NOTIFY pgrst)");
}

function composeUp() {
  // --profile storage is mandatory: the storage-api service is profile-gated,
  // and a profile-less up skips it, leaving every site release unservable.
  sh("docker compose --profile storage --env-file .env.local up -d --build", { stdio: "inherit" });
  console.log("[up] stack started; waiting for backend health…");
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const check = spawnSync(
      "curl",
      ["-fsS", "-m", "5", "http://localhost:3000/api/health"],
      { encoding: "utf8" },
    );
    if (check.status === 0) {
      console.log("[up] backend /api/health OK");
      applySchema();
      ensureStorageBucket();
      return;
    }
    process.stdout.write(".");
    execSync("sleep 4", { shell: "bash", stdio: "ignore" });
  }
  throw new Error("backend did not become healthy within 240s — check: docker compose logs backend");
}

function ensureStorageBucket() {
  // The publisher expects the private wss-site-releases bucket to exist.
  // storage-api creates buckets via REST; idempotent.
  const env = parseEnvFile(ENV_FILE);
  const result = spawnSync("docker", [
    "exec", "wss-local-backend", "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
    "-X", "POST",
    "-H", `Authorization: Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "-H", "Content-Type: application/json",
    "--data", JSON.stringify({ id: "wss-site-releases", name: "wss-site-releases", public: false }),
    "https://supabase.local.wss-ai.test:54321/storage/v1/bucket",
  ], { encoding: "utf8" });
  const code = String(result.stdout || "").trim();
  console.log(`[up] storage bucket wss-site-releases -> HTTP ${code} (409/400 = already exists)`);
}

function parseEnvFile(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.trim().startsWith("#")) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

function health() {
  const env = parseEnvFile(ENV_FILE);
  const token = env.GHOST_AGENCY_ADMIN_TOKEN;
  console.log("[health] GET /api/admin/line (x-admin-token)");
  const result = spawnSync("curl", [
    "-sS", "-m", "30", "-H", `x-admin-token: ${token}`, "http://localhost:3000/api/admin/line",
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`health check failed: ${result.stderr}`);
  const body = JSON.parse(result.stdout);
  const readiness = body.readiness || body.state?.readiness || body;
  console.log("[health] keys: " + Object.keys(body).slice(0, 20).join(","));
  fs.writeFileSync(path.join(REPO_ROOT, "artifacts", "local-health-line.json"), result.stdout);
  return body;
}

function smoke() {
  const env = parseEnvFile(ENV_FILE);
  const token = env.GHOST_AGENCY_ADMIN_TOKEN;
  const post = (path, payload) => {
    const result = spawnSync("curl", [
      "-sS", "-m", "700", "-X", "POST",
      "-H", `x-admin-token: ${token}`, "-H", "Content-Type: application/json",
      "-d", JSON.stringify(payload), `http://localhost:3000${path}`,
    ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return result.stdout || `{"ok":false,"error":"curl_failed"}`;
  };
  console.log("[smoke] starting 3-row sandbox batch, target: all trades nationwide");
  const started = Date.now();
  const start = JSON.parse(post("/api/admin/line", {
    action: "start", lane: "sandbox", count: 3, target: "all trades nationwide",
  }));
  console.log(`[smoke] start -> ${JSON.stringify(start).slice(0, 400)}`);
  if (start.ok === false) throw new Error(`start refused: ${start.error}`);
  const batchId = start.batch?.batchId || start.batchId;
  console.log(`[smoke] batchId=${batchId} (elapsed ${(Date.now() - started) / 1000}s)`);
  fs.writeFileSync(path.join(REPO_ROOT, "artifacts", "local-smoke-start.json"), JSON.stringify(start, null, 2));
  console.log("[smoke] rows now advance via the factory-cron sweep. Poll: GET /api/admin/line");
  console.log("[smoke] milestones to watch: qualified -> built -> gated -> owner proof (sandbox inbox only).");
}

// ---------------------------------------------------------------------------
const command = process.argv[2] || "all";
try {
  if (command === "gen") { generateEnv(); generateTls(); }
  else if (command === "up") { composeUp(); }
  else if (command === "health") { health(); }
  else if (command === "smoke") { smoke(); }
  else if (command === "down") { sh("docker compose down", { stdio: "inherit" }); }
  else if (command === "all") { generateEnv(); generateTls(); composeUp(); health(); smoke(); }
  else throw new Error(`unknown command: ${command}`);
} catch (error) {
  console.error(`[local-env] ${error.message}`);
  process.exit(1);
}
