"use strict";

const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const CONTRACT_DIR = join(__dirname, "..", "contracts");

function loadSchema(name) {
  const file = join(CONTRACT_DIR, `${name}.schema.json`);
  if (!existsSync(file)) {
    return { ok: false, error: "schema_missing", file };
  }
  try {
    return { ok: true, schema: JSON.parse(readFileSync(file, "utf8")), file };
  } catch (error) {
    return { ok: false, error: "schema_invalid", message: error.message, file };
  }
}

function validateRequired(name, value = {}) {
  const loaded = loadSchema(name);
  if (!loaded.ok) return loaded;
  const missing = (loaded.schema.required || []).filter((key) => value[key] === undefined || value[key] === null || value[key] === "");
  return {
    ok: missing.length === 0,
    schema: loaded.schema.$id || name,
    missing,
  };
}

module.exports = {
  loadSchema,
  validateRequired,
};
