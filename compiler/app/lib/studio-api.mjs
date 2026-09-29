import { createHash } from "node:crypto";
import * as DB from "./store.mjs";
import * as U from "./util.mjs";

const PREFIX = "sf_live_";

export function studioAllowed(ent = {}) {
  return Boolean(ent.limits?.api_access || ["agency", "studio", "enterprise"].includes(ent.plan_key));
}

export function createApiKey({ userId, workspaceId = null, name = "Production" }) {
  const secret = `${PREFIX}${U.token(30)}`;
  const secretHash = hash(secret);
  const record = DB.insert("api_keys", {
    user_id: userId,
    workspace_id: workspaceId,
    name: U.clampStr(name, 80) || "Production",
    prefix: secret.slice(0, 15),
    secret_hash: secretHash,
    scopes: ["forge:write", "jobs:read"],
    last_used_at: null,
    revoked_at: null,
  });
  return { record, secret };
}

export function authenticateApiRequest(req) {
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!supplied.startsWith(PREFIX) || supplied.length < 32) return null;
  const secretHash = hash(supplied);
  const record = DB.find("api_keys", (row) => !row.revoked_at && U.timingSafeEq(row.secret_hash || "", secretHash));
  if (!record) return null;
  DB.update("api_keys", record.id, { last_used_at: U.nowIso() });
  const user = DB.get("users", record.user_id);
  return user ? { user, key: record } : null;
}

export function apiKeyHasScope(authOrKey, scope) {
  const key = authOrKey?.key ?? authOrKey;
  return typeof scope === "string" && Array.isArray(key?.scopes) && key.scopes.includes(scope);
}

export function revokeApiKey(userId, keyId) {
  const record = DB.find("api_keys", (row) => row.id === keyId && row.user_id === userId && !row.revoked_at);
  if (!record) return false;
  DB.update("api_keys", keyId, { revoked_at: U.nowIso() });
  return true;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
