import path from "node:path";
import { JSDOM } from "jsdom";
import { unzipSync } from "fflate";

const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 80;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 24 * 1024 * 1024;
const MAX_TEXT_CHARS = 18_000;
const MAX_MEDIA = 7;

const IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".html", ".htm"]);

function intakeError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeEntryName(value = "") {
  const normalized = String(value).replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) return "";
  return parts.join("/");
}

function zipDirectory(buffer) {
  const rows = [];
  let expanded = 0;
  for (let offset = 0; offset + 46 <= buffer.length;) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) throw intakeError(422, "This ZIP has a damaged directory and could not be read safely.");
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    rows.push({ name, compressed, uncompressed });
    expanded += uncompressed;
    offset = end;
  }
  if (!rows.length) throw intakeError(422, "This ZIP is empty or uses an unsupported archive format.");
  if (rows.length > MAX_ENTRIES) throw intakeError(413, `ZIPs may contain up to ${MAX_ENTRIES} files.`);
  if (expanded > MAX_EXPANDED_BYTES) throw intakeError(413, "This ZIP expands beyond the 24 MB safety limit.");
  if (rows.some((row) => row.uncompressed > MAX_ENTRY_BYTES)) throw intakeError(413, "A file inside this ZIP is larger than 8 MB.");
  if (rows.some((row) => !safeEntryName(row.name))) throw intakeError(422, "This ZIP contains an unsafe file path.");
  return rows;
}

function textFromBuffer(buffer, extension) {
  const value = buffer.toString("utf8").replace(/\0/g, "");
  if (extension === ".html" || extension === ".htm") {
    const dom = new JSDOM(value);
    dom.window.document.querySelectorAll("script,style,noscript,template").forEach((node) => node.remove());
    return dom.window.document.body?.textContent || "";
  }
  return value;
}

function cleanText(value = "") {
  return String(value).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function rescueZip(file) {
  if (file.data.length > MAX_ARCHIVE_BYTES) throw intakeError(413, "ZIP uploads are limited to 4 MB for instant previews.");
  const directory = zipDirectory(file.data);
  const unpacked = unzipSync(new Uint8Array(file.data));
  const media = [];
  const text = [];
  const accepted = [];
  const ignored = [];

  for (const row of directory) {
    const name = safeEntryName(row.name);
    if (!name || name.endsWith("/")) continue;
    const data = unpacked[row.name];
    if (!data) continue;
    const extension = path.extname(name).toLowerCase();
    if (IMAGE_TYPES.has(extension) && media.length < MAX_MEDIA) {
      media.push({ field: /logo|wordmark|brand/i.test(name) ? "logo" : "photos", filename: path.basename(name), type: IMAGE_TYPES.get(extension), data: Buffer.from(data) });
      accepted.push(name);
    } else if (TEXT_EXTENSIONS.has(extension) && text.join("\n").length < MAX_TEXT_CHARS) {
      text.push(`File: ${name}\n${textFromBuffer(Buffer.from(data), extension)}`);
      accepted.push(name);
    } else {
      ignored.push(name);
    }
  }

  return {
    media,
    text: cleanText(text.join("\n\n")).slice(0, MAX_TEXT_CHARS),
    manifest: { archive: file.filename, entries: directory.length, accepted, ignored, raw_html_shipped: false },
  };
}

export function prepareIntakeFiles(files = []) {
  const suppliedFiles = Array.isArray(files) ? files : [];
  const suppliedBytes = suppliedFiles.reduce((sum, file) => sum + Number(file?.data?.length || 0), 0);
  if (suppliedBytes > MAX_ARCHIVE_BYTES) throw intakeError(413, "Instant-preview files must total 4 MB or less.");
  const media = [];
  const text = [];
  const manifests = [];
  const ignored = [];

  for (const file of suppliedFiles) {
    if (!file?.data?.length) continue;
    const extension = path.extname(file.filename || "").toLowerCase();
    const isZip = extension === ".zip" || /(?:application\/zip|application\/x-zip-compressed)/i.test(file.type || "");
    if (isZip) {
      const rescued = rescueZip(file);
      media.push(...rescued.media.slice(0, Math.max(0, MAX_MEDIA - media.length)));
      if (rescued.text) text.push(rescued.text);
      manifests.push(rescued.manifest);
    } else if (IMAGE_TYPES.has(extension) || /^image\/(?:png|jpeg|webp|gif)$/i.test(file.type || "")) {
      if (media.length < MAX_MEDIA) media.push({ ...file, field: file.field === "logo" ? "logo" : "photos" });
    } else if (TEXT_EXTENSIONS.has(extension)) {
      text.push(`File: ${file.filename}\n${textFromBuffer(file.data, extension)}`);
    } else {
      ignored.push(file.filename || "unnamed file");
    }
  }

  return {
    files: media.slice(0, MAX_MEDIA),
    extractedText: cleanText(text.join("\n\n")).slice(0, MAX_TEXT_CHARS),
    manifests,
    ignored,
  };
}

export const INTAKE_FILE_LIMITS = Object.freeze({
  archiveBytes: MAX_ARCHIVE_BYTES,
  entries: MAX_ENTRIES,
  expandedBytes: MAX_EXPANDED_BYTES,
  media: MAX_MEDIA,
});
