import path from "node:path";
export function blobRelativePath(rel) {
  const raw = (rel || "index.html").replace(/\.\./g, "");
  return !path.extname(raw) ? `${raw.replace(/\/+$/, "")}${raw ? "/" : ""}index.html` : raw;
}
