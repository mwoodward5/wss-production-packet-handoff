// Loads .env.local (repo root) into process.env before anything else reads it.
// Must be the FIRST import in server entry points. Never commits, never logs values.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const name of [".env.local", ".env"]) {
  const fp = path.join(ROOT, name);
  if (!existsSync(fp)) continue;
  for (const line of readFileSync(fp, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    if (val && process.env[m[1]] == null) process.env[m[1]] = val;
  }
}
