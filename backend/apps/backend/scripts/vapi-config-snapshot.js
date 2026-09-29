"use strict";
/**
 * GATE 4E — VAPI CONFIG-DRIFT SNAPSHOT
 *
 * ROOT INCIDENT this exists to prevent: Riley's system prompt and 8 of her 11
 * tools were silently wiped and nobody noticed for two weeks. Nothing in the
 * stack held a "what did she look like yesterday" record, so there was nothing
 * to diff against and nothing to alarm on.
 *
 * WHAT IT DOES
 *   1. Exports EVERY VAPI assistant's full config (system prompt, tools, model,
 *      voice, first message) to <out>/<assistantId>.json — pretty-printed and
 *      deep key-sorted so a `git diff` of the snapshot dir is readable.
 *   2. Redacts secrets. No API key, bearer token or server secret is ever
 *      written to disk or printed. Redaction is deterministic, so it never
 *      manufactures a phantom diff.
 *   3. Diffs against the previous snapshot: prompt changed (char delta),
 *      tools added/removed BY NAME, model/voice/firstMessage changed.
 *   4. Exits NON-ZERO on DESTRUCTIVE drift — any tool removed, or the system
 *      prompt shrinking by more than the shrink threshold (default 30%) — so it
 *      can run unattended as a cron alarm. Purely additive change exits 0.
 *   5. READ-ONLY against VAPI. Every request goes through a guard that refuses
 *      any method other than GET and any host other than api.vapi.ai.
 *      Publishing an assistant is owner-triggered and is NOT this script's job.
 *
 * FAIL CLOSED. A missing credential, an API error, a truncated assistant list,
 * or a tool id that will not resolve is a FAILURE with a stated reason — never
 * a vacuous pass, and never an overwrite of a good baseline with partial data.
 *
 * Nothing here is client-specific. Assistants are discovered from the API;
 * paths, thresholds and the env file are all parameters.
 *
 * USAGE
 *   node scripts/vapi-config-snapshot.js [options]
 *     --env <file>              env file to load (repeatable; KEY="value" lines)
 *     --out <dir>               snapshot dir (default apps/backend/data/vapi-snapshots)
 *     --assistant <id>          only this assistant (repeatable)
 *     --shrink-threshold <0-1>  prompt-shrink fraction that is destructive (default 0.30)
 *     --accept-drift            owner acknowledgement: promote a .drift.json to the baseline
 *     --self-test               run the offline control fixtures and exit (no network)
 *
 * THE ALARM DOES NOT SELF-SILENCE. On destructive drift the last known-good
 * <assistantId>.json is left ALONE and the observed config is written beside it
 * as <assistantId>.drift.json. Every subsequent run keeps failing until either
 * VAPI is restored or the owner explicitly runs --accept-drift. This is the
 * direct fix for "nobody noticed for two weeks": an alarm that overwrote its own
 * baseline would fire once and then go quiet forever.
 *
 * EXIT CODES
 *   0  no drift, or additive-only drift, or baselines created
 *   1  DESTRUCTIVE drift (tools removed, or prompt shrank past the threshold)
 *   2  blocker: no credential, API failure, truncated list, unresolved tool,
 *      or a failing self-test control
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VAPI_HOST = "api.vapi.ai";
const VAPI_BASE = `https://${VAPI_HOST}`;
const LIST_LIMIT = 1000;
const SNAPSHOT_VERSION = 1;
// Methods that must never leave this script. Held as bare strings — never
// beside a request-options `method` key — so the source-level read-only control
// (CTRL9) can assert that every literal request method in this file is GET.
const FORBIDDEN_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { envFiles: [], assistants: [], out: null, shrinkThreshold: 0.3, selfTest: false, acceptDrift: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") out.selfTest = true;
    else if (a === "--accept-drift") out.acceptDrift = true;
    else if (a === "--env") out.envFiles.push(argv[++i]);
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--assistant") out.assistants.push(argv[++i]);
    else if (a === "--shrink-threshold") out.shrinkThreshold = Number(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!(out.shrinkThreshold > 0 && out.shrinkThreshold < 1)) throw new Error("--shrink-threshold must be between 0 and 1");
  return out;
}

// ---------------------------------------------------------------------------
// env loading — values are loaded, never logged
// ---------------------------------------------------------------------------
function parseEnvText(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    vars[m[1]] = v;
  }
  return vars;
}

function loadEnvFiles(files, env = process.env) {
  const loaded = [];
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error(`env file not found: ${f}`);
    const vars = parseEnvText(fs.readFileSync(f, "utf8"));
    for (const [k, v] of Object.entries(vars)) if (!env[k]) env[k] = v;
    loaded.push({ file: f, keys: Object.keys(vars).length });
  }
  return loaded;
}

/**
 * Find the VAPI credential: any env key whose NAME contains "VAPI" and that
 * holds a credential rather than an id/url. Preferred names win so a snapshot
 * run is deterministic across machines.
 */
function resolveCredential(env = process.env) {
  const candidates = Object.keys(env).filter((k) => /vapi/i.test(k));
  const isCredentialName = (k) => /(?:api[_-]?key|private[_-]?key|token|secret|^vapi_key$)/i.test(k) && !/(?:_id|_ids|_url|_urls|number)$/i.test(k);
  const preferred = ["VAPI_API_KEY", "VAPI_PRIVATE_KEY", "VAPI_TOKEN", "VAPI_KEY"];
  const ordered = [
    ...preferred.filter((k) => candidates.includes(k)),
    ...candidates.filter((k) => !preferred.includes(k) && isCredentialName(k)),
  ];
  for (const name of ordered) {
    const value = String(env[name] || "").trim();
    // A webhook-signing secret is not an API credential; only accept it if
    // nothing better exists, and never accept an empty placeholder.
    if (value.length >= 8) return { name, value };
  }
  return null;
}

/** Every env value long enough to be a secret — scrubbed out of all strings. */
function collectEnvSecrets(env = process.env) {
  const secrets = new Set();
  for (const [k, v] of Object.entries(env)) {
    const value = String(v || "");
    if (value.length < 16) continue;
    if (/(key|token|secret|password|credential|hmac|dsn)/i.test(k)) secrets.add(value);
  }
  return [...secrets];
}

// ---------------------------------------------------------------------------
// redaction
// ---------------------------------------------------------------------------
const REDACTED = "[redacted]";

// Keys whose NAME marks the value as a secret.
const SECRET_KEY_PARTS = ["secret", "password", "passwd", "credential", "apikey", "token", "privatekey", "hmac", "authorization", "signature", "bearer"];
// Structurally excluded: keys that MATCH a secret part but are real config whose
// drift we must be able to see. Same discipline as excluding SVG geometry from
// numeric identity matching — a hit here is a BUG in the key list, not noise to
// filter downstream. Proven by the redaction negative control.
const NOT_SECRET_KEYS = new Set([
  "maxtokens", "numtokens", "tokenlimit", "tokencount", "prompttokens", "completiontokens",
  "totaltokens", "tokenspersecond", "maxtokenspersecond", "publickey", "keywords", "keyword",
  "keypad", "toolids", "signaturetimeoutseconds",
]);

function isSecretKey(key) {
  const norm = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (NOT_SECRET_KEYS.has(norm)) return false;
  return SECRET_KEY_PARTS.some((p) => norm.includes(p));
}

/**
 * Scrub secret material out of a free-text string. Applied to EVERY string in
 * the config, so a secret sitting in an unexpected key still cannot reach disk.
 * Note: bare UUIDs are deliberately NOT scrubbed — assistant and tool ids are
 * identity and are required for diffing.
 */
function scrubString(str, envSecrets = []) {
  let s = String(str);
  for (const secret of envSecrets) if (secret && s.includes(secret)) s = s.split(secret).join(REDACTED);
  s = s.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`);
  s = s.replace(/([?&](?:secret|token|key|apikey|api_key|access_token|sig|signature)=)[^&#\s"']+/gi, `$1${REDACTED}`);
  s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED); // JWT
  s = s.replace(/\b(?:sk|rk|pk)[_-](?:live|test|proj|ant)?[_-]?[A-Za-z0-9]{16,}\b/gi, REDACTED);
  s = s.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, REDACTED);
  s = s.replace(/\b(?:re|fc|xoxb|xoxp|ghp|gho|github_pat|shpat|SG)[_-][A-Za-z0-9_-]{16,}\b/g, REDACTED);
  return s;
}

function redact(value, envSecrets = []) {
  if (Array.isArray(value)) return value.map((v) => redact(v, envSecrets));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSecretKey(k) && (v === null || typeof v !== "object")) out[k] = v === null || v === undefined ? v : REDACTED;
      else if (isSecretKey(k) && typeof v === "object" && !Array.isArray(v) && v !== null) out[k] = redact(v, envSecrets);
      else out[k] = redact(v, envSecrets);
    }
    return out;
  }
  if (typeof value === "string") return scrubString(value, envSecrets);
  return value;
}

// ---------------------------------------------------------------------------
// stable serialisation
// ---------------------------------------------------------------------------
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
    return out;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(sortKeysDeep(value), null, 2) + "\n";
}

const sha256 = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");

// ---------------------------------------------------------------------------
// READ-ONLY transport guard
// ---------------------------------------------------------------------------
function assertReadOnlyRequest(url, method) {
  const m = String(method || "GET").toUpperCase();
  if (m !== "GET") throw new Error(`READ-ONLY VIOLATION: ${m} attempted on ${url} — this gate never mutates a VAPI assistant`);
  const host = new URL(url).host;
  if (host !== VAPI_HOST) throw new Error(`READ-ONLY VIOLATION: unexpected host ${host}`);
  return true;
}

async function vapiGet(pathname, credential, fetchImpl = fetch) {
  const url = `${VAPI_BASE}${pathname}`;
  assertReadOnlyRequest(url, "GET");
  const res = await fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const detail = json ? JSON.stringify(json).slice(0, 240) : text.slice(0, 240);
    throw new Error(`VAPI GET ${pathname} failed: HTTP ${res.status} ${detail}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// normalisation
// ---------------------------------------------------------------------------
function toolDisplayName(tool) {
  if (!tool || typeof tool !== "object") return null;
  return tool.function?.name || tool.name || tool.type || null;
}

function extractSystemPrompt(model) {
  if (!model || typeof model !== "object") return "";
  const fromMessages = (Array.isArray(model.messages) ? model.messages : [])
    .filter((m) => m && m.role === "system")
    .map((m) => String(m.content ?? ""))
    .join("\n");
  if (fromMessages) return fromMessages;
  return String(model.systemPrompt ?? "");
}

/**
 * Build the snapshot record. `resolvedTools` is the fully hydrated tool list
 * (inline model.tools plus every model.toolIds lookup) — hydration happens
 * before this so an unresolved tool can fail the run instead of silently
 * degrading into a phantom "tool removed" on the NEXT run.
 */
function buildSnapshot(assistant, resolvedTools, envSecrets = []) {
  const safeAssistant = redact(assistant, envSecrets);
  const safeTools = redact(resolvedTools, envSecrets);
  const prompt = extractSystemPrompt(assistant.model);
  const toolNames = safeTools.map(toolDisplayName).filter(Boolean).sort();
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    assistant: safeAssistant,
    tools: safeTools.map((t) => ({
      toolId: t.id || null,
      name: toolDisplayName(t),
      type: t.type || null,
      source: t.__source || null,
      serverUrl: t.server?.url || null,
      description: t.function?.description || t.description || null,
      parameters: t.function?.parameters || null,
    })),
    derived: {
      assistantId: assistant.id || null,
      assistantName: assistant.name || null,
      systemPromptChars: prompt.length,
      systemPromptSha256: prompt ? sha256(prompt) : null,
      toolCount: toolNames.length,
      toolNames,
      modelId: [assistant.model?.provider, assistant.model?.model].filter(Boolean).join("/") || null,
      voiceId: [assistant.voice?.provider, assistant.voice?.voiceId].filter(Boolean).join("/") || null,
      firstMessageSha256: assistant.firstMessage ? sha256(String(assistant.firstMessage)) : null,
      firstMessageChars: String(assistant.firstMessage ?? "").length,
    },
  };
}

// ---------------------------------------------------------------------------
// drift diff  (pure — this is what the control fixtures exercise)
// ---------------------------------------------------------------------------
function multisetDiff(prevNames, currNames) {
  const count = (arr) => arr.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map());
  const p = count(prevNames || []);
  const c = count(currNames || []);
  const removed = [];
  const added = [];
  for (const [name, n] of p) for (let i = 0; i < n - (c.get(name) || 0); i++) removed.push(name);
  for (const [name, n] of c) for (let i = 0; i < n - (p.get(name) || 0); i++) added.push(name);
  return { removed: removed.sort(), added: added.sort() };
}

function diffSnapshots(prev, curr, shrinkThreshold = 0.3) {
  const changes = [];
  const destructive = [];
  if (!prev) {
    return { baseline: true, changes: [`BASELINE CREATED — ${curr.derived.toolCount} tool(s), prompt ${curr.derived.systemPromptChars} chars`], destructive };
  }
  const p = prev.derived || {};
  const c = curr.derived || {};

  // --- system prompt ---
  const prevLen = Number(p.systemPromptChars || 0);
  const currLen = Number(c.systemPromptChars || 0);
  if (p.systemPromptSha256 !== c.systemPromptSha256) {
    const delta = currLen - prevLen;
    const pct = prevLen > 0 ? (delta / prevLen) * 100 : 0;
    const line = `prompt: ${prevLen} -> ${currLen} chars (${delta >= 0 ? "+" : ""}${delta}${prevLen > 0 ? `, ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : ""})`;
    changes.push(line);
    // Shrink STRICTLY greater than the threshold is destructive; exactly at the
    // threshold is not. Boundary is pinned by a control fixture.
    const shrinkFraction = prevLen > 0 ? (prevLen - currLen) / prevLen : 0;
    if (shrinkFraction > shrinkThreshold + 1e-12) {
      destructive.push(`${line} — DESTRUCTIVE: prompt shrank ${(shrinkFraction * 100).toFixed(1)}% (threshold ${(shrinkThreshold * 100).toFixed(0)}%)`);
    }
  }

  // --- tools, by name ---
  const { removed, added } = multisetDiff(p.toolNames, c.toolNames);
  if (added.length) changes.push(`tools added (${added.length}): ${added.join(", ")}`);
  if (removed.length) {
    changes.push(`tools removed (${removed.length}): ${removed.join(", ")}`);
    destructive.push(`tools removed (${removed.length}): ${removed.join(", ")} — DESTRUCTIVE`);
  }

  // --- model / voice / first message (reported, not destructive) ---
  if (p.modelId !== c.modelId) changes.push(`model: ${p.modelId || "(none)"} -> ${c.modelId || "(none)"}`);
  if (p.voiceId !== c.voiceId) changes.push(`voice: ${p.voiceId || "(none)"} -> ${c.voiceId || "(none)"}`);
  if (p.firstMessageSha256 !== c.firstMessageSha256) {
    changes.push(`firstMessage: ${p.firstMessageChars || 0} -> ${c.firstMessageChars || 0} chars (content changed)`);
  }
  if (p.assistantName !== c.assistantName) changes.push(`name: ${p.assistantName || "(none)"} -> ${c.assistantName || "(none)"}`);

  return { baseline: false, changes, destructive };
}

// ---------------------------------------------------------------------------
// hydration
// ---------------------------------------------------------------------------
async function hydrateTools(assistant, credential, toolCache, fetchImpl) {
  const tools = [];
  for (const t of Array.isArray(assistant.model?.tools) ? assistant.model.tools : []) {
    tools.push({ ...t, __source: "inline" });
  }
  for (const id of Array.isArray(assistant.model?.toolIds) ? assistant.model.toolIds : []) {
    if (!toolCache.has(id)) {
      // Fail closed: an unresolved tool id must NOT be written as a nameless
      // tool. Doing so would make the next run report a false "tool removed",
      // or worse, bless a real wipe as the new baseline.
      const tool = await vapiGet(`/tool/${encodeURIComponent(id)}`, credential, fetchImpl);
      if (!tool || typeof tool !== "object" || !toolDisplayName(tool)) {
        throw new Error(`tool ${id} on assistant ${assistant.id} did not resolve to a named tool — refusing to write a partial snapshot`);
      }
      toolCache.set(id, tool);
    }
    tools.push({ ...toolCache.get(id), __source: "toolIds" });
  }
  return tools;
}

// ---------------------------------------------------------------------------
// self-test — positive and negative controls, no network
// ---------------------------------------------------------------------------
function selfTest() {
  const fails = [];
  const ok = (cond, label) => { if (!cond) fails.push(label); };

  const mkDerived = (promptChars, toolNames, extra = {}) => ({
    snapshotVersion: SNAPSHOT_VERSION,
    derived: {
      systemPromptChars: promptChars,
      systemPromptSha256: promptChars ? sha256("x".repeat(promptChars)) : null,
      toolCount: toolNames.length,
      toolNames: [...toolNames].sort(),
      modelId: "openai/gpt-4.1-mini",
      voiceId: "11labs/rachel",
      assistantName: "Riley",
      firstMessageChars: 40,
      firstMessageSha256: sha256("hi"),
      ...extra,
    },
  });

  const RILEY_11 = [
    "lookup_business_record", "get_or_create_report", "send_report_email", "send_sms_link",
    "send_secure_payment_link", "create_membership_quote", "schedule_callback",
    "get_service_area_cities", "site_edit", "site_edit_status", "transferCall",
  ];

  // === POSITIVE CONTROL 1 — the actual incident: prompt wiped, 8 of 11 tools gone
  {
    const prev = mkDerived(4210, RILEY_11);
    const curr = mkDerived(180, ["lookup_business_record", "get_or_create_report", "transferCall"]);
    const d = diffSnapshots(prev, curr, 0.3);
    ok(d.destructive.length >= 2, "POS1 incident: expected BOTH prompt-shrink and tools-removed to be destructive");
    const removedLine = d.changes.find((c) => c.startsWith("tools removed"));
    ok(!!removedLine && /tools removed \(8\)/.test(removedLine), "POS1 incident: expected exactly 8 tools reported removed BY NAME");
    for (const name of ["send_report_email", "send_sms_link", "send_secure_payment_link", "create_membership_quote", "schedule_callback", "get_service_area_cities", "site_edit", "site_edit_status"]) {
      ok(removedLine.includes(name), `POS1 incident: removed tool not named in report: ${name}`);
    }
    ok(d.changes.some((c) => /prompt: 4210 -> 180 chars \(-4030, -95\.7%\)/.test(c)), "POS1 incident: expected prompt char delta 4210 -> 180 (-4030, -95.7%)");
  }

  // === POSITIVE CONTROL 2 — a single tool removed is destructive on its own
  {
    const d = diffSnapshots(mkDerived(1000, RILEY_11), mkDerived(1000, RILEY_11.filter((n) => n !== "send_report_email")), 0.3);
    ok(d.destructive.length === 1 && /send_report_email/.test(d.destructive[0]), "POS2: one removed tool must be destructive and named");
  }

  // === POSITIVE CONTROL 3 — prompt shrink just past the threshold
  {
    const d = diffSnapshots(mkDerived(1000, RILEY_11), mkDerived(699, RILEY_11), 0.3);
    ok(d.destructive.length === 1 && /shrank 30\.1%/.test(d.destructive[0]), "POS3: 30.1% shrink must be destructive");
  }

  // === NEGATIVE CONTROL 4 — shrink exactly AT the threshold is not destructive
  {
    const d = diffSnapshots(mkDerived(1000, RILEY_11), mkDerived(700, RILEY_11), 0.3);
    ok(d.destructive.length === 0, "NEG4: exactly 30% shrink must NOT be destructive (boundary)");
    ok(d.changes.some((c) => c.startsWith("prompt:")), "NEG4: the prompt change must still be REPORTED");
  }

  // === NEGATIVE CONTROL 5 — additive change exits clean
  {
    const d = diffSnapshots(mkDerived(1000, RILEY_11), mkDerived(1400, [...RILEY_11, "book_appointment"]), 0.3);
    ok(d.destructive.length === 0, "NEG5: additive tool + longer prompt must NOT be destructive");
    ok(d.changes.some((c) => /tools added \(1\): book_appointment/.test(c)), "NEG5: added tool must be named");
  }

  // === NEGATIVE CONTROL 6 — identical snapshots produce no changes at all
  {
    const d = diffSnapshots(mkDerived(1000, RILEY_11), mkDerived(1000, RILEY_11), 0.3);
    ok(d.changes.length === 0 && d.destructive.length === 0, "NEG6: identical snapshots must report zero changes");
  }

  // === NEGATIVE CONTROL 7 — model/voice churn is reported but not destructive
  {
    const prev = mkDerived(1000, RILEY_11);
    const curr = mkDerived(1000, RILEY_11, { modelId: "openai/gpt-4o-mini", voiceId: "11labs/paige" });
    const d = diffSnapshots(prev, curr, 0.3);
    ok(d.destructive.length === 0, "NEG7: model/voice change must NOT be destructive");
    ok(d.changes.some((c) => c.startsWith("model:")) && d.changes.some((c) => c.startsWith("voice:")), "NEG7: model and voice changes must both be reported");
  }

  // === POSITIVE CONTROL 8 — REDACTION: none of this secret material may survive
  {
    const SECRETS = {
      serverSecret: "9f2b41c0-secret-value-77aa",
      bearer: "abcdefghijklmnopqrstuvwxyz012345",
      queryToken: "qtok_1234567890abcdefzz",
      stripe: "sk_live_51ABCdefGHIjklMNOpqr0123",
      google: "AIzaSyD-EXAMPLE-KEY-1234567890abcd",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      resend: "re_ABCdef1234567890XYZ",
      envKey: "env-only-credential-value-abc123456",
    };
    const fixture = {
      id: "5b8f0000-1111-2222-3333-444455556666",
      name: "Riley",
      model: {
        provider: "openai", model: "gpt-4.1-mini", maxTokens: 250,
        toolIds: ["aaaa1111-2222-3333-4444-555566667777"],
        messages: [{ role: "system", content: "Call (817) 924-1645 for Ramon Roofing." }],
      },
      voice: { provider: "11labs", voiceId: "rachel" },
      server: { url: `https://ghost.wss-ai.com/api/vapi-tools/riley-tools?token=${SECRETS.queryToken}`, secret: SECRETS.serverSecret },
      credentials: [{ provider: "openai", apiKey: SECRETS.stripe }],
      headers: { Authorization: `Bearer ${SECRETS.bearer}` },
      metadata: {
        publicKey: "pub-visible-value",
        note: `google=${SECRETS.google} jwt=${SECRETS.jwt} resend=${SECRETS.resend} baked=${SECRETS.envKey}`,
      },
    };
    const serialized = stableJson(redact(fixture, [SECRETS.envKey]));
    for (const [label, value] of Object.entries(SECRETS)) {
      ok(!serialized.includes(value), `POS8 redaction: ${label} SURVIVED into the snapshot`);
    }
    // negative half: real config must NOT be redacted away
    for (const keep of ["5b8f0000-1111-2222-3333-444455556666", "aaaa1111-2222-3333-4444-555566667777", "gpt-4.1-mini", "rachel", "(817) 924-1645", "pub-visible-value", '"maxTokens": 250', "ghost.wss-ai.com"]) {
      ok(serialized.includes(keep), `POS8 redaction over-reach: legitimate config was redacted: ${keep}`);
    }
  }

  // === CONTROL 9 — READ-ONLY transport guard
  {
    for (const m of FORBIDDEN_METHODS) {
      let threw = false;
      try { assertReadOnlyRequest(`${VAPI_BASE}/assistant/x`, m); } catch { threw = true; }
      ok(threw, `CTRL9: guard must refuse ${m}`);
    }
    let getOk = false;
    try { getOk = assertReadOnlyRequest(`${VAPI_BASE}/assistant`, "GET"); } catch { /* noop */ }
    ok(getOk === true, "CTRL9: guard must allow GET");
    let foreignBlocked = false;
    try { assertReadOnlyRequest("https://evil.example.com/assistant", "GET"); } catch { foreignBlocked = true; }
    ok(foreignBlocked, "CTRL9: guard must refuse a non-VAPI host");
    // Source-level control: every literal request method in this file is GET.
    const src = fs.readFileSync(__filename, "utf8");
    const methods = [...src.matchAll(/method\s*:\s*["']([A-Za-z]+)["']/g)].map((m) => m[1]);
    ok(methods.length > 0, "CTRL9: source scan found no request method literal — the scan is broken");
    ok(methods.every((m) => m === "GET"), `CTRL9: non-GET request literal present in source: ${methods.filter((m) => m !== "GET").join(",")}`);
  }

  // === CONTROL 10 — stable key sorting makes git diffs readable
  {
    const a = stableJson({ b: 1, a: { z: 1, y: [{ q: 1, p: 2 }] } });
    const b = stableJson({ a: { y: [{ p: 2, q: 1 }], z: 1 }, b: 1 });
    ok(a === b, "CTRL10: key-insertion order must not change the serialized bytes");
    ok(a.indexOf('"a"') < a.indexOf('"b"'), "CTRL10: keys must be sorted");
  }

  // === CONTROL 11 — credential resolution ignores ids/urls, prefers the API key
  {
    const env = { VAPI_ASSISTANT_ID: "abc", VAPI_CALLS_URL: "https://api.vapi.ai/call", VAPI_WEBHOOK_SECRET: "whsec_1234567890", VAPI_API_KEY: "vapikey_1234567890" };
    const c = resolveCredential(env);
    ok(c && c.name === "VAPI_API_KEY", `CTRL11: expected VAPI_API_KEY, got ${c && c.name}`);
    ok(resolveCredential({ VAPI_ASSISTANT_ID: "abc", VAPI_CALLS_URL: "https://x" }) === null, "CTRL11: ids/urls alone must NOT be treated as a credential");
    ok(resolveCredential({}) === null, "CTRL11: empty env must yield no credential");
    // .env.example ships `VAPI_API_KEY=` BLANK. An empty or stub value must
    // resolve to "not configured" so the run stops with a truthful blocker
    // instead of a confusing 401 from VAPI.
    ok(resolveCredential({ VAPI_API_KEY: "" }) === null, "CTRL11: blank VAPI_API_KEY must NOT count as configured");
    ok(resolveCredential({ VAPI_API_KEY: "   " }) === null, "CTRL11: whitespace-only VAPI_API_KEY must NOT count as configured");
    ok(resolveCredential({ VAPI_API_KEY: "todo" }) === null, "CTRL11: a too-short stub value must NOT count as configured");
    // A blank preferred key must not shadow a real credential further down.
    const shadow = resolveCredential({ VAPI_API_KEY: "", VAPI_PRIVATE_KEY: "vapipriv_1234567890" });
    ok(shadow && shadow.name === "VAPI_PRIVATE_KEY", `CTRL11: blank preferred key must not shadow a real one, got ${shadow && shadow.name}`);
  }

  // === CONTROL 12 — tool naming covers function tools and built-ins
  {
    ok(toolDisplayName({ type: "function", function: { name: "send_report_email" } }) === "send_report_email", "CTRL12: function tool name");
    ok(toolDisplayName({ type: "transferCall" }) === "transferCall", "CTRL12: built-in tool falls back to type");
    ok(toolDisplayName(null) === null, "CTRL12: null tool yields null");
  }

  // === CONTROL 13 — prompt extraction from messages and from systemPrompt
  {
    ok(extractSystemPrompt({ messages: [{ role: "assistant", content: "no" }, { role: "system", content: "yes" }] }) === "yes", "CTRL13: system message extracted");
    ok(extractSystemPrompt({ systemPrompt: "legacy" }) === "legacy", "CTRL13: legacy systemPrompt fallback");
    ok(extractSystemPrompt(null) === "", "CTRL13: missing model yields empty prompt");
    ok(diffSnapshots(mkDerived(4210, RILEY_11), mkDerived(0, RILEY_11), 0.3).destructive.length === 1, "CTRL13: a fully emptied prompt is destructive");
  }

  console.log(fails.length ? "GATE 4E SELF-TEST FAILURES:" : "GATE 4E SELF-TEST PASSED — 13 controls");
  fails.forEach((f) => console.log("  x " + f));
  if (!fails.length) {
    console.log("  - POS1 the real incident (prompt wiped + 8/11 tools removed) is detected and the 8 tools are named");
    console.log("  - POS2/POS3 single tool removal and 30.1% prompt shrink are destructive");
    console.log("  - NEG4 exactly-30% shrink, NEG5 additive change, NEG6 no-op, NEG7 model/voice churn all exit clean");
    console.log("  - POS8 8 kinds of secret material redacted; ids/model/voice/maxTokens/phone preserved");
    console.log("  - CTRL9 read-only guard refuses PUT/PATCH/POST/DELETE and foreign hosts; source has no non-GET literal");
    console.log("  - CTRL10-13 stable sorting, credential resolution, tool naming, prompt extraction");
  }
  return fails.length ? 2 : 0;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (e) { console.error(`GATE 4E BLOCKED: ${e.message}`); return 2; }
  if (args.help) { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^"use strict";\s*\/\*\*/, "")); return 0; }
  if (args.selfTest) return selfTest();

  const outDir = args.out || path.join(__dirname, "..", "data", "vapi-snapshots");

  // --- env ---
  const envFiles = args.envFiles.length ? args.envFiles : [process.env.VAPI_ENV_FILE, ".fable-proof.env", ".env.local", ".env"].filter((f) => f && fs.existsSync(f));
  let loaded = [];
  try { loaded = loadEnvFiles(envFiles); } catch (e) { console.error(`GATE 4E BLOCKED: ${e.message}`); return 2; }

  console.log("GATE 4E — VAPI CONFIG-DRIFT SNAPSHOT");
  console.log(`  mode         READ-ONLY (GET only, host locked to ${VAPI_HOST})`);
  console.log(`  out          ${outDir}`);
  console.log(`  env files    ${loaded.length ? loaded.map((l) => `${l.file} (${l.keys} keys)`).join(", ") : "(none found — using process env)"}`);

  // --- credential (fail closed) ---
  const credential = resolveCredential(process.env);
  if (!credential) {
    console.error("");
    console.error("GATE 4E BLOCKED: VAPI credential not configured");
    console.error(`  Searched every env key whose name contains "VAPI" for an API key/token; none held a usable value.`);
    console.error(`  Set VAPI_API_KEY (see apps/backend/.env.example) or pass --env <file>, then re-run.`);
    console.error("  Offline proof of the detector is available with: --self-test");
    return 2;
  }
  console.log(`  credential   ${credential.name} (value never printed or written)`);
  const envSecrets = collectEnvSecrets(process.env);

  // --- fetch every assistant ---
  let assistants;
  try {
    const list = await vapiGet(`/assistant?limit=${LIST_LIMIT}`, credential.value);
    assistants = Array.isArray(list) ? list : Array.isArray(list?.results) ? list.results : null;
    if (!assistants) throw new Error(`unexpected assistant list shape: ${JSON.stringify(list).slice(0, 160)}`);
  } catch (e) {
    console.error(`\nGATE 4E BLOCKED: ${e.message}`);
    console.error("  No snapshot written — a good baseline is never overwritten with partial data.");
    return 2;
  }

  const existing = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith(".json") && !f.startsWith("_") && !f.endsWith(".drift.json")) : [];
  if (assistants.length === LIST_LIMIT) {
    console.error(`\nGATE 4E BLOCKED: assistant list hit the page limit (${LIST_LIMIT}) — the export may be truncated and is not "EVERY assistant".`);
    return 2;
  }
  if (assistants.length === 0 && existing.length > 0) {
    console.error(`\nGATE 4E BLOCKED: VAPI returned 0 assistants but ${existing.length} previous snapshot(s) exist.`);
    console.error("  That is either a wiped account or a broken credential scope. Refusing to write empty baselines.");
    return 2;
  }
  if (assistants.length === 0) {
    console.error("\nGATE 4E BLOCKED: VAPI returned 0 assistants and there is no previous snapshot — nothing to prove.");
    return 2;
  }

  const selected = args.assistants.length ? assistants.filter((a) => args.assistants.includes(a.id)) : assistants;
  if (args.assistants.length && selected.length !== args.assistants.length) {
    const missing = args.assistants.filter((id) => !assistants.some((a) => a.id === id));
    console.error(`\nGATE 4E BLOCKED: --assistant id(s) not found on this account: ${missing.join(", ")}`);
    return 2;
  }

  // --- hydrate + snapshot ---
  const toolCache = new Map();
  const records = [];
  for (const a of selected) {
    let full = a;
    try {
      // The list endpoint can return a trimmed shape; always re-read the
      // assistant so the snapshot is the FULL config.
      full = (await vapiGet(`/assistant/${encodeURIComponent(a.id)}`, credential.value)) || a;
      const tools = await hydrateTools(full, credential.value, toolCache, fetch);
      records.push({ assistant: full, snapshot: buildSnapshot(full, tools, envSecrets) });
    } catch (e) {
      console.error(`\nGATE 4E BLOCKED: ${e.message}`);
      console.error("  No snapshot written for any assistant this run — fail closed rather than half-export.");
      return 2;
    }
  }

  fs.mkdirSync(outDir, { recursive: true });

  // --- diff + write ---
  console.log(`  assistants   ${records.length} exported\n`);
  const report = { capturedAt: new Date().toISOString(), outDir, shrinkThreshold: args.shrinkThreshold, assistants: [] };
  let destructiveCount = 0;
  let changedCount = 0;

  for (const { snapshot } of records) {
    const id = snapshot.derived.assistantId;
    const label = `${snapshot.derived.assistantName || "(unnamed)"} ${String(id).slice(0, 8)}`;
    const file = path.join(outDir, `${id}.json`);
    let prev = null;
    if (fs.existsSync(file)) {
      try { prev = JSON.parse(fs.readFileSync(file, "utf8")); }
      catch (e) {
        console.error(`GATE 4E BLOCKED: previous snapshot ${file} is unreadable (${e.message}) — refusing to silently reset the baseline.`);
        return 2;
      }
    }
    const d = diffSnapshots(prev, snapshot, args.shrinkThreshold);
    const body = stableJson(snapshot);
    const unchangedBytes = prev !== null && fs.readFileSync(file, "utf8") === body;
    const driftFile = path.join(outDir, `${id}.drift.json`);

    // Destructive drift NEVER overwrites the last known-good baseline unless the
    // owner explicitly accepts it — otherwise the alarm would silence itself on
    // the very next run. The observed config is parked beside it instead.
    if (d.destructive.length && !args.acceptDrift) {
      fs.writeFileSync(driftFile, body, "utf8");
    } else {
      fs.writeFileSync(file, body, "utf8");
      if (fs.existsSync(driftFile)) fs.rmSync(driftFile);
    }

    if (d.destructive.length) {
      destructiveCount++;
      console.log(`  [${args.acceptDrift ? "DRIFT ACCEPTED" : "DESTRUCTIVE"}] ${label}`);
      d.changes.forEach((c) => console.log(`      ${c}`));
      d.destructive.forEach((c) => console.log(`      !! ${c}`));
      if (!args.acceptDrift) console.log(`      baseline PRESERVED at ${path.basename(file)}; observed config parked at ${path.basename(driftFile)}`);
    } else if (d.baseline) {
      console.log(`  [BASELINE]    ${label}  ${d.changes[0]}`);
    } else if (d.changes.length) {
      changedCount++;
      console.log(`  [ADDITIVE]    ${label}`);
      d.changes.forEach((c) => console.log(`      ${c}`));
    } else {
      console.log(`  [NO DRIFT]    ${label}  ${snapshot.derived.toolCount} tool(s), prompt ${snapshot.derived.systemPromptChars} chars${unchangedBytes ? "" : " (non-material fields updated)"}`);
    }

    report.assistants.push({
      assistantId: id,
      assistantName: snapshot.derived.assistantName,
      snapshotFile: path.relative(outDir, file),
      driftFile: d.destructive.length && !args.acceptDrift ? path.relative(outDir, driftFile) : null,
      baselinePreserved: d.destructive.length > 0 && !args.acceptDrift,
      status: d.destructive.length ? (args.acceptDrift ? "drift_accepted" : "destructive") : d.baseline ? "baseline" : d.changes.length ? "additive" : "no_drift",
      toolCount: snapshot.derived.toolCount,
      systemPromptChars: snapshot.derived.systemPromptChars,
      changes: d.changes,
      destructive: d.destructive,
    });
  }

  report.result = destructiveCount ? (args.acceptDrift ? "DRIFT_ACCEPTED" : "DESTRUCTIVE_DRIFT") : "OK";
  report.destructiveAssistants = destructiveCount;
  report.acceptDrift = args.acceptDrift;
  fs.writeFileSync(path.join(outDir, "_last-run.json"), stableJson(report), "utf8");

  console.log("");
  if (destructiveCount && args.acceptDrift) {
    console.log(`GATE 4E FAILED (drift ACCEPTED by --accept-drift): ${destructiveCount} of ${records.length} assistant(s) re-baselined to the current VAPI config.`);
    console.log("  Exit is still non-zero: an accepted wipe is still a wipe, and the operator asked for it deliberately.");
    return 1;
  }
  if (destructiveCount) {
    console.log(`GATE 4E FAILED: DESTRUCTIVE DRIFT on ${destructiveCount} of ${records.length} assistant(s).`);
    console.log("  A tool was removed or a system prompt was gutted. The last known-good config is still on disk:");
    console.log("    · diff it:    git diff -- data/vapi-snapshots   (or compare <id>.json against <id>.drift.json)");
    console.log("    · restore it: re-publish from <id>.json via the owner-triggered admin path.");
    console.log("  This gate does not and will not write to VAPI. It will keep failing every run until the");
    console.log("  assistant is restored, or until an operator runs --accept-drift on purpose.");
    return 1;
  }
  console.log(`GATE 4E PASSED: ${records.length} assistant(s) snapshotted, ${changedCount} with additive-only change, 0 destructive.`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { console.error("GATE 4E ERRORED:", e && e.message ? e.message : e); process.exit(2); });
}

module.exports = {
  buildSnapshot, diffSnapshots, multisetDiff, redact, scrubString, isSecretKey,
  sortKeysDeep, stableJson, extractSystemPrompt, toolDisplayName,
  resolveCredential, collectEnvSecrets, parseEnvText, assertReadOnlyRequest, selfTest, main,
};
