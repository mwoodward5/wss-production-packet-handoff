/**
 * lib/gate-a-scan.js — Gate A contamination scan for the mirror lane.
 * Scans a built site's files for every identity atom in the donor manifest.
 * Returns { clean, hits } — clean=true means zero donor identity survived.
 */
"use strict";

const crypto = require("node:crypto");

const TEXT_EXTS = new Set([".html", ".js", ".css", ".json", ".txt", ".xml", ".svg", ".webmanifest"]);

function encodings(token) {
  const t = String(token);
  const variants = [t, t.toLowerCase()];
  variants.push(encodeURIComponent(t));
  variants.push(t.replace(/ /g, "%20"));
  variants.push(t.replace(/ /g, "+"));
  for (const ch of t) {
    if (ch !== " ") variants.push(t.replace(ch, `&#${ch.charCodeAt(0)};`));
  }
  variants.push(Buffer.from(t, "utf8").toString("base64"));
  return [...new Set(variants)];
}

// A purely alphabetic atom ("Tempe", "EL Construction", "Maricopa County") must
// match as a WORD, not as a substring. Substring matching made the donor city of
// the concrete donor unusable as an atom: "Tempe" is inside "temperature", which
// appears legitimately in concrete cure/control-joint copy in three shipped
// files, so declaring the real donor city would have hard-failed EVERY concrete
// build with donor_identity_detected. The port's own gate had already solved
// this with word-boundary matchers; production had no such notion, so the atom
// was simply left out and the gate sat inert.
//
// Non-alphabetic atoms (phones, ZIPs, coordinates, domains, URLs, base64 and
// percent-encoded variants) keep substring matching — word boundaries are
// meaningless there and would weaken the scan.
const WORDY = /^[a-z][a-z\s'&-]*$/i;
const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function variantMatches(text, variant) {
  if (!WORDY.test(variant)) return text.includes(variant.toLowerCase());
  const re = new RegExp(`\\b${variant.replace(RE_ESCAPE, "\\$&")}\\b`, "i");
  return re.test(text);
}

function scanFiles(files, donorManifest) {
  const hits = [];
  const m = donorManifest || {};
  const tokens = [];
  for (const k of ["name", "phone", "email", "city", "county", "domain"]) {
    const v = m[k];
    if (v && String(v).length >= 4) tokens.push([k, String(v)]);
  }
  for (const k of ["zips", "geo", "socials", "account_ids"]) {
    for (const v of m[k] || []) {
      if (v && String(v).length >= 4) tokens.push([k, String(v)]);
    }
  }

  const assetHashes = new Map();
  for (const [name, md5] of Object.entries(m.asset_md5 || {})) {
    assetHashes.set(md5, name);
  }

  for (const f of files) {
    const ext = (f.file.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    if (TEXT_EXTS.has(ext)) {
      const text = f.bytes.toString("utf8").toLowerCase();
      for (const [bucket, tok] of tokens) {
        for (const variant of encodings(tok)) {
          if (variantMatches(text, variant)) {
            hits.push({ bucket, token: tok, file: f.file });
            break;
          }
        }
      }
    } else {
      const md5 = crypto.createHash("md5").update(f.bytes).digest("hex");
      if (assetHashes.has(md5)) {
        hits.push({ bucket: "asset_md5", token: assetHashes.get(md5), file: f.file });
      }
    }
  }
  return { clean: hits.length === 0, hits };
}

module.exports = { scanFiles };
