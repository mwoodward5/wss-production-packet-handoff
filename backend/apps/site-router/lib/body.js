"use strict";

const { badRequest } = require("./errors");

const MAX_JSON_BYTES = 8192;

function jsonStringEnd(text, start) {
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === '"') {
      return index + 1;
    }
  }
  return -1;
}

// JSON.parse intentionally keeps the final value for a duplicate object key.
// A preview grant cannot tolerate that ambiguity. Inspect the raw top-level
// object first and compare decoded key strings, so `grant` and `gr\u0061nt`
// are the same key. Malformed JSON is left for JSON.parse to reject below.
function hasDuplicateTopLevelKey(text) {
  let index = 0;
  while (/\s/.test(text[index] || "")) index += 1;
  if (text[index] !== "{") return false;
  index += 1;
  let depth = 1;
  let expectsKey = true;
  const keys = new Set();

  while (index < text.length && depth > 0) {
    while (/\s/.test(text[index] || "")) index += 1;
    if (depth === 1 && expectsKey) {
      if (text[index] === "}") return false;
      if (text[index] !== '"') return false;
      const end = jsonStringEnd(text, index);
      if (end < 0) return false;
      let key;
      try {
        key = JSON.parse(text.slice(index, end));
      } catch {
        return false;
      }
      if (keys.has(key)) return true;
      keys.add(key);
      index = end;
      while (/\s/.test(text[index] || "")) index += 1;
      if (text[index] !== ":") return false;
      index += 1;
      expectsKey = false;
      continue;
    }

    const char = text[index];
    if (char === '"') {
      const end = jsonStringEnd(text, index);
      if (end < 0) return false;
      index = end;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    else if (char === "," && depth === 1) expectsKey = true;
    index += 1;
  }
  return false;
}

function parseJsonBytes(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : Buffer.from(String(value), "utf8");
  if (bytes.length === 0 || bytes.length > MAX_JSON_BYTES) throw badRequest();
  const text = bytes.toString("utf8");
  if (hasDuplicateTopLevelKey(text)) throw badRequest();
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest();
  }
}

async function readJsonBody(req, signal) {
  if (req && req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body) && !(req.body instanceof Uint8Array)) {
      return req.body;
    }
    return parseJsonBytes(req.body);
  }

  if (!req || typeof req[Symbol.asyncIterator] !== "function") throw badRequest();
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    if (signal && signal.aborted) throw badRequest();
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_JSON_BYTES) throw badRequest();
    chunks.push(bytes);
  }
  return parseJsonBytes(Buffer.concat(chunks));
}

module.exports = { MAX_JSON_BYTES, hasDuplicateTopLevelKey, readJsonBody };
