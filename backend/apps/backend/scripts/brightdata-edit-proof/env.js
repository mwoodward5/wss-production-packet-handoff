"use strict";
// scripts/brightdata-edit-proof/env.js — load KEY=VALUE secrets into process.env
// from the canonical breadcrumb file. NEVER prints a VALUE; callers get key
// names and lengths only, which is enough to prove a key is present.

const fs = require("node:fs");

const DEFAULT_ENV_FILE = "C:/Users/Main/Documents/New project 2/.fable-proof.env";

function loadEnv(file = process.env.PROOF_ENV_FILE || DEFAULT_ENV_FILE) {
  const text = fs.readFileSync(file, "utf8");
  const loaded = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
    if (!value) continue;
    process.env[key] = value;
    loaded.push({ key, length: value.length });
  }
  return loaded;
}

/** Redacted presence report — safe to print. */
function present(keys) {
  return keys.map((k) => `${k}=${process.env[k] ? `present(len ${String(process.env[k]).length})` : "MISSING"}`);
}

module.exports = { loadEnv, present };
