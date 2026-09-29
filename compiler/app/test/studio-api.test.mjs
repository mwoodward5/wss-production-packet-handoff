import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

process.env.SITEFORGE_DATA_DIR = mkdtempSync(path.join(tmpdir(), "sf-studio-api-"));
const DB = await import("../lib/store.mjs");
const Studio = await import("../lib/studio-api.mjs");

const user = DB.insert("users", { email: "studio@example.com", plan: "agency" });
const { record, secret } = Studio.createApiKey({ userId: user.id, name: "Test key" });
assert.equal(secret.startsWith("sf_live_"), true);
assert.equal(record.secret_hash.includes(secret), false);
const auth = Studio.authenticateApiRequest({ headers: { authorization: `Bearer ${secret}` } });
assert.equal(auth.user.id, user.id);
assert.equal(Studio.revokeApiKey(user.id, record.id), true);
assert.equal(Studio.authenticateApiRequest({ headers: { authorization: `Bearer ${secret}` } }), null);

console.log("Studio API key tests: passed");
