"use strict";

// Static binding audit for a PageHub Intake Genie packet. It checks shapes,
// exact service-file bindings, and declared channel consistency. It is NOT
// proof of authenticity or production approval, and it never modifies input.

const crypto = require("node:crypto");

const SERVICE_DIR = "content/services/";
const HOME_FILE = "content/home.md";
const ABOUT_FILE = "content/about.md";
const KNOWN_CHANNELS = ["reviews", "faqs", "hours", "areas"];
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const PARAGRAPH_BREAK = /\r?\n\r?\n/;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const sha256 = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

function unsafeServicePath(p) {
  if (typeof p !== "string" || p.length === 0) return "empty_or_non_string";
  if (p.includes("\0")) return "nul_byte";
  if (p.includes("\\")) return "backslash_separator";
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || /^[a-z][a-z0-9+.-]*:/i.test(p)) return "absolute_path";
  if (p.split("/").some((s) => s === "" || s === "." || s === "..")) return "traversal_or_empty_segment";
  if (!p.startsWith(SERVICE_DIR) || p.length <= SERVICE_DIR.length) return "outside_service_dir";
  if (!p.endsWith(".md")) return "not_markdown";
  return null;
}

// First paragraph = bytes before the first blank-line separator (LF or CRLF
// pairs). With no separator, the whole file minus ONE terminal line ending.
// The paragraph's own bytes are never normalized.
function firstParagraph(text) {
  const m = PARAGRAPH_BREAK.exec(text);
  if (m) return text.slice(0, m.index);
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n")) return text.slice(0, -1);
  return text;
}

function describeFile(files, p) {
  if (!files || !own(files, p)) return { present: false, isString: false, empty: null, sha256: null };
  const v = files[p];
  if (typeof v !== "string") return { present: true, isString: false, empty: null, sha256: null };
  return { present: true, isString: true, empty: v.trim().length === 0, sha256: sha256(v) };
}

function auditChannels(packet, add) {
  const result = {};
  const raw = isPlainObject(packet) && own(packet, "channels") ? packet.channels : undefined;
  if (raw !== undefined && !isPlainObject(raw)) add("channels_malformed", "channels must be an object");
  const channels = isPlainObject(raw) ? raw : {};
  for (const name of KNOWN_CHANNELS) {
    if (!own(channels, name)) { result[name] = { state: "not_declared", itemCount: null }; continue; }
    const ch = channels[name];
    if (!isPlainObject(ch) || (ch.status !== "available" && ch.status !== "unavailable")) {
      result[name] = { state: "malformed", itemCount: null };
      add("channel_malformed", { channel: name });
      continue;
    }
    const hasItems = own(ch, "items");
    if (hasItems && !Array.isArray(ch.items)) {
      result[name] = { state: "malformed", declaredStatus: ch.status, itemCount: null };
      add("channel_items_not_array", { channel: name });
      continue;
    }
    const count = hasItems ? ch.items.length : 0;
    if (ch.status === "available" && count === 0) {
      result[name] = { state: "inconsistent", declaredStatus: "available", itemCount: count };
      add("channel_available_without_items", { channel: name });
    } else if (ch.status === "unavailable" && count > 0) {
      result[name] = { state: "inconsistent", declaredStatus: "unavailable", itemCount: count };
      add("channel_unavailable_with_items", { channel: name, itemCount: count });
    } else {
      result[name] = { state: ch.status, itemCount: ch.status === "available" ? count : null, itemsVerified: false };
    }
  }
  const unrecognized = Object.keys(channels).filter((k) => !KNOWN_CHANNELS.includes(k)).sort();
  return { byChannel: result, unrecognized };
}

function auditPacket(packet) {
  const issues = [];
  const add = (code, detail = null) => issues.push({ code, detail });
  const report = {
    schema: "wss-packet-binding-audit-v1",
    ok: false,
    category: null,
    services: [],
    files: {},
    home: null,
    about: null,
    channels: null,
    unreferencedServiceFiles: [],
    provenance: {
      sourceAuthenticity: "unverified",
      note: "hashes identify bytes only; they do not establish where the content came from",
    },
    productionApproval: "not_assessed",
    issues,
  };

  if (!isPlainObject(packet)) {
    add("packet_malformed", "packet must be a plain object");
    report.channels = auditChannels(null, add);
    return report;
  }
  const facts = isPlainObject(packet.facts) ? packet.facts : null;
  if (!facts) add("facts_malformed", "facts must be a plain object");
  const files = isPlainObject(packet.files) ? packet.files : null;
  if (!files) add("files_malformed", "files must be a plain object");

  if (files) {
    for (const p of Object.keys(files).sort()) {
      const v = files[p];
      if (typeof v !== "string") {
        report.files[p] = { isString: false, sha256: null, utf8Bytes: null };
        add("file_not_string", { path: p });
      } else {
        report.files[p] = { isString: true, sha256: sha256(v), utf8Bytes: Buffer.byteLength(v, "utf8") };
        if (LONE_SURROGATE.test(v)) add("file_not_well_formed_unicode", { path: p });
      }
    }
  }
  report.home = describeFile(files, HOME_FILE);
  report.about = describeFile(files, ABOUT_FILE);

  if (facts) {
    if (typeof facts.category === "string" && facts.category.trim()) report.category = facts.category;
    else add("category_missing");
  }

  const services = facts ? facts.services : undefined;
  if (facts && !Array.isArray(services)) add("services_not_array");
  const seenExact = new Map();
  const seenFolded = new Map();
  const referenced = new Set();
  (Array.isArray(services) ? services : []).forEach((svc, index) => {
    const r = { index, name: null, file: null, status: "invalid", fileSha256: null, firstParagraphMatches: false };
    report.services.push(r);
    const fail = (code, detail = {}) => { add(code, { index, ...detail }); r.status = "invalid"; };
    if (!isPlainObject(svc)) { fail("service_malformed"); return; }
    let valid = true;
    if (typeof svc.name !== "string" || !svc.name.trim()) { fail("service_name_missing"); valid = false; } else r.name = svc.name;
    const descOk = typeof svc.description === "string" && svc.description.trim().length > 0;
    if (!descOk) { fail("service_description_empty"); valid = false; }
    if (typeof svc.file === "string") r.file = svc.file;
    const unsafe = unsafeServicePath(svc.file);
    if (unsafe) { fail("service_path_unsafe", { path: svc.file ?? null, reason: unsafe }); return; }
    referenced.add(svc.file);
    if (seenExact.has(svc.file)) { fail("duplicate_service_path", { path: svc.file, firstIndex: seenExact.get(svc.file) }); valid = false; }
    else {
      seenExact.set(svc.file, index);
      const folded = svc.file.normalize("NFC").toLowerCase();
      if (seenFolded.has(folded)) { fail("service_path_case_collision", { path: svc.file, firstIndex: seenFolded.get(folded) }); valid = false; }
      else seenFolded.set(folded, index);
    }
    if (!files || !own(files, svc.file)) { fail("service_file_missing", { path: svc.file }); return; }
    const content = files[svc.file];
    if (typeof content !== "string") { fail("service_file_not_string", { path: svc.file }); return; }
    r.fileSha256 = sha256(content);
    if (!descOk) return;
    const para = firstParagraph(content);
    const same = para === svc.description
      && Buffer.from(para, "utf8").equals(Buffer.from(svc.description, "utf8"));
    r.firstParagraphMatches = same;
    r.descriptionSha256 = sha256(svc.description);
    r.firstParagraphSha256 = sha256(para);
    if (!same) { fail("service_description_mismatch", { path: svc.file }); return; }
    if (valid) r.status = "bound";
  });

  if (files) {
    report.unreferencedServiceFiles = Object.keys(files)
      .filter((p) => p.startsWith(SERVICE_DIR) && !referenced.has(p)).sort();
  }
  report.channels = auditChannels(packet, add);
  report.ok = issues.length === 0;
  return report;
}

module.exports = { auditPacket, firstParagraph };
