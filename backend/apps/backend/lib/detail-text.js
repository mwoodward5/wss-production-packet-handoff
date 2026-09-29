"use strict";

function detailText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => detailText(entry)).join(" ;; ");
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      return typeof json === "string" ? json : "";
    } catch (_) {
      return "[unserializable object]";
    }
  }
  return String(value);
}

function boundedDetailText(value, length) {
  const text = detailText(value);
  const cap = Number(length);
  return Number.isFinite(cap) && cap >= 0 ? text.slice(0, Math.floor(cap)) : text;
}

module.exports = { boundedDetailText };
