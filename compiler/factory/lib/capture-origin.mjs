import path from "node:path";

export const DEFAULT_CAPTURE_ORIGIN = "https://siteforge-app-seven.vercel.app";

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webm", "video/webm"],
  [".webmanifest", "application/manifest+json"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export function resolveCaptureOrigin(env = process.env) {
  const explicitCaptureOrigin = publicHttpsOrigin(env.SITEFORGE_CAPTURE_ORIGIN);
  if (explicitCaptureOrigin) return explicitCaptureOrigin;
  const vercelOrigin = trustedSiteforgeVercelOrigin(env.VERCEL_URL);
  if (vercelOrigin) return vercelOrigin;
  for (const value of [env.SITEFORGE_PUBLIC_URL, env.SITEFORGE_BASE_URL]) {
    const origin = publicHttpsOrigin(value);
    if (origin) return origin;
  }
  return DEFAULT_CAPTURE_ORIGIN;
}

export function createCaptureRoute(outDir, indexSha256, env = process.env) {
  const origin = resolveCaptureOrigin(env);
  const token = String(indexSha256 || "capture").replace(/[^a-f0-9]/gi, "").slice(0, 16) || "capture";
  const prefix = `/__siteforge_qc__/${token}/`;
  return {
    origin,
    prefix,
    pattern: `${origin}${prefix}**`,
    url: `${origin}${prefix}index.html`,
    root: path.resolve(outDir),
  };
}

export function resolveCaptureFile(root, requestUrl, prefix) {
  const url = new URL(requestUrl);
  if (!url.pathname.startsWith(prefix)) return null;
  let relativePath;
  try { relativePath = decodeURIComponent(url.pathname.slice(prefix.length)); }
  catch { return null; }
  if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
  const base = path.resolve(root);
  const absolutePath = path.resolve(base, relativePath.replace(/^[/\\]+/, ""));
  if (absolutePath !== base && !absolutePath.startsWith(`${base}${path.sep}`)) return null;
  return absolutePath;
}

export function captureContentType(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

function publicHttpsOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try { url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`); }
  catch { return ""; }
  if (url.protocol !== "https:" || !url.hostname.includes(".")) return "";
  if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(url.hostname)) return "";
  return url.origin;
}

function trustedSiteforgeVercelOrigin(value) {
  const origin = publicHttpsOrigin(value);
  if (!origin) return "";
  const hostname = new URL(origin).hostname.toLowerCase();
  return /^siteforge(?:-app)?-[a-z0-9-]+-rocketsites\.vercel\.app$/.test(hostname)
    ? origin
    : "";
}
