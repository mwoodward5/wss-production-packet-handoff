import path from "node:path";
import { prepareIntakeFiles } from "./intake-files.mjs";

const MAX_DRIVE_BYTES = 4 * 1024 * 1024;

function driveId(url) {
  return url.pathname.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([^/]+)/)?.[1]
    || url.searchParams.get("id")
    || "";
}

export function publicDriveTarget(value = "") {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!/(^|\.)google\.com$/i.test(url.hostname) && !/(^|\.)googleusercontent\.com$/i.test(url.hostname)) return null;
  const id = driveId(url);
  if (!id) return null;
  if (/\/document\/d\//.test(url.pathname)) return { id, kind: "text", url: `https://docs.google.com/document/d/${id}/export?format=txt`, filename: `${id}.txt` };
  if (/\/spreadsheets\/d\//.test(url.pathname)) return { id, kind: "text", url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, filename: `${id}.csv` };
  if (/\/presentation\/d\//.test(url.pathname)) return { id, kind: "pdf", url: `https://docs.google.com/presentation/d/${id}/export/pdf`, filename: `${id}.pdf` };
  return { id, kind: "file", url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`, filename: id };
}

export async function importPublicDrive(value) {
  const target = publicDriveTarget(value);
  if (!target) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(target.url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": "SiteForgeDriveIntake/1.0" } });
    if (!response.ok) throw new Error(`Google Drive returned HTTP ${response.status}.`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_DRIVE_BYTES) throw new Error("The shared Drive file is larger than the 4 MB instant-preview limit.");
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_DRIVE_BYTES) throw new Error("The shared Drive file is larger than the 4 MB instant-preview limit.");
    const type = String(response.headers.get("content-type") || "application/octet-stream").split(";")[0].toLowerCase();
    if (type === "text/html" && /sign in|request access|accounts\.google/i.test(data.toString("utf8", 0, Math.min(data.length, 8000)))) {
      throw new Error("That Drive file is private. Set General access to Anyone with the link, then try again.");
    }
    const disposition = response.headers.get("content-disposition") || "";
    const named = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i)?.[1];
    const filename = named ? decodeURIComponent(named.replace(/\"/g, "")) : target.filename;
    const extension = path.extname(filename).toLowerCase();
    const rescued = prepareIntakeFiles([{ field: "drive", filename, type, data }]);
    const isImage = /^image\//.test(type) || /\.(?:png|jpe?g|webp|gif)$/i.test(filename);
    return {
      sources: [value],
      found: { copy: rescued.extractedText || "", photos: isImage ? [target.url] : [] },
      files: rescued.files,
      assets: isImage ? [{ kind: /logo|wordmark|brand/i.test(filename) ? "logo" : "photo", url: target.url, label: `Google Drive file - ${filename}`, source: "google-drive", origin: "operator-supplied", approved: true, meta: { treatment: "family-duotone" } }] : [],
      summary: { mode: "public-google-drive", pages_read: rescued.extractedText ? 1 : 0, photos_found: isImage ? 1 : rescued.files.length, services_found: 0, logo_found: isImage && /logo|wordmark|brand/i.test(filename), notes: rescued.ignored.length ? [`Ignored unsupported Drive content: ${rescued.ignored.join(", ")}`] : [] },
    };
  } catch (error) {
    const message = error.message || String(error);
    return { sources: [value], found: { copy: "", photos: [] }, files: [], assets: [], summary: { mode: "public-google-drive", pages_read: 0, photos_found: 0, services_found: 0, logo_found: false, errors: [message], notes: [message] } };
  } finally {
    clearTimeout(timer);
  }
}
