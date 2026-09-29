#!/usr/bin/env node
"use strict";
// serve-genie.cjs — run the PageHub intake compiler genie LOCALLY.
// The cloud deploy died with the Vercel billing hold (402); this mounts the
// repo's own api/ handlers plus the static frontend on one local origin so the
// 5-step studio works from the browser again. No cloud dependency except the
// provider APIs themselves (Firecrawl/Places/Resend), keyed from local env files.
//
// Local additions over Vercel:
//  * Express-style shims (res.status/json/send, parsed req.body, req.query)
//    because the handlers were written for @vercel/node.
//  * /healthz and /api/intake-genie/compile parity routes from vercel.json.
//  * NO request timeout: sitemap+Firecrawl harvests can run minutes.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.GENIE_PORT || 18900);
const MAX_BODY_BYTES = 32 * 1024 * 1024; // uploadPayloads can be chunky

// ---- env loading (first file wins; real process.env always wins) ------------
// Order: repo .env, ghx-localfirst/.env.local (FIRECRAWL/RESEND/INTAKE_GENIE_TOKEN),
// ghx-worker-env/env.latest (GOOGLE_PLACES_API_KEY lives there).
for (const envFile of [path.join(ROOT, ".env"), "C:/ghx-localfirst/.env.local", "C:/ghx-worker-env/env.latest"]) {
  try {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch { /* optional file */ }
}

// Owner login token: the repo wants PAGEHUB_OWNER_TOKEN but no env file on this
// desktop defines one. Reuse INTAKE_GENIE_TOKEN (localfirst) so one owner secret
// unlocks both the UI session and the Bearer provider routes.
if (!String(process.env.PAGEHUB_OWNER_TOKEN || "").trim() && String(process.env.INTAKE_GENIE_TOKEN || "").trim()) {
  process.env.PAGEHUB_OWNER_TOKEN = String(process.env.INTAKE_GENIE_TOKEN).trim();
}
// Resend sender: repo wants RESEND_FROM_EMAIL; localfirst only carries the ghost
// agency's verified sender, which is on the same Resend account.
if (!String(process.env.RESEND_FROM_EMAIL || "").trim() && String(process.env.GHOST_AGENCY_RESEND_FROM || "").trim()) {
  process.env.RESEND_FROM_EMAIL = String(process.env.GHOST_AGENCY_RESEND_FROM).trim();
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

const handlers = {};
for (const f of fs.readdirSync(path.join(ROOT, "api"))) {
  if (f.endsWith(".js")) handlers["/api/" + f.replace(/\.js$/, "")] = require(path.join(ROOT, "api", f));
}
// vercel.json parity rewrites
const routeAliases = {
  "/api/intake-genie/compile": "/api/intake-genie-compile",
  "/api/intake-genie/import-packet2": "/api/intake-genie-import-packet2",
};

// ---- Express-ish shims -------------------------------------------------------
function queryObject(url) {
  const q = {};
  for (const [k, v] of url.searchParams) q[k] = v;
  return q;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); return resolve(""); }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

function shimRes(res) {
  if (res.__genieShimmed) return res;
  res.__genieShimmed = true;
  res.status = function status(code) { this.statusCode = code; return this; };
  res.json = function json(obj) {
    if (!this.getHeader("Content-Type")) this.setHeader("Content-Type", "application/json; charset=utf-8");
    this.end(JSON.stringify(obj));
    return this;
  };
  res.send = function send(body) {
    if (!this.getHeader("Content-Type")) {
      this.setHeader("Content-Type", Buffer.isBuffer(body) ? "application/octet-stream" : "text/html; charset=utf-8");
    }
    this.end(body);
    return this;
  };
  const rawSetHeader = res.setHeader.bind(res);
  res.setHeader = function setHeader(name, value) {
    // Local HTTP cookie compat: browsers that do not exempt plain-http
    // 127.0.0.1 would drop the repo's __Host- + Secure session cookie. Emit it
    // unprefixed/unsecured locally; shimIncomingCookie maps it back on the way
    // in so the repo's auth lib sees the exact cookie name it expects.
    if (String(name).toLowerCase() === "set-cookie" && String(value).includes("__Host-pagehub_owner_session")) {
      return rawSetHeader(name, String(value)
        .replace("__Host-pagehub_owner_session=", "pagehub_owner_session=")
        .replace(/;\s*Secure/i, ""));
    }
    return rawSetHeader(name, value);
  };
  return res;
}

// Rename the local-compat cookie back to the lib's __Host- name on requests.
function shimIncomingCookie(req) {
  const header = req.headers.cookie;
  if (!header || !header.includes("pagehub_owner_session=") || header.includes("__Host-pagehub_owner_session=")) return;
  req.headers.cookie = header
    .split(";")
    .map((part) => {
      const sep = part.indexOf("=");
      const name = part.slice(0, sep).trim();
      return name === "pagehub_owner_session" ? `__Host-pagehub_owner_session=${part.slice(sep + 1).trim()}` : part;
    })
    .join(";");
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, "http://localhost");
  shimRes(res);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Cookie");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  let route = url.pathname.replace(/\/+$/, "") || "/";
  let queryOverride = null;
  if (route === "/healthz") { // vercel.json: /healthz -> compile handler + healthz=1
    route = "/api/intake-genie-compile";
    queryOverride = { ...queryObject(url), healthz: "1" };
  } else if (routeAliases[route]) {
    route = routeAliases[route];
  }

  const handler = handlers[route];
  if (handler) {
    try {
      shimIncomingCookie(req);
      if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
        const raw = await readBody(req);
        // @vercel/node hands handlers a parsed object for JSON bodies; some
        // handlers (google-places) read fields directly off req.body.
        if (String(req.headers["content-type"] || "").includes("application/json")) {
          try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
        } else {
          req.body = raw;
        }
      }
      req.query = queryOverride || queryObject(url);
      await handler(req, res);
    } catch (e) {
      console.error(`[genie] handler ${route} failed:`, (e && e.stack) || e);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
      }
    } finally {
      console.log(`[genie] ${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - started}ms)`);
    }
    return;
  }

  // Only the public studio document is static. Never expose API source,
  // backups, .env, logs, or private packet evidence from the repository root.
  const publicFiles = { "/": "index.html", "/index.html": "index.html" };
  const publicName = Object.prototype.hasOwnProperty.call(publicFiles, route) ? publicFiles[route] : "";
  const file = publicName ? path.join(ROOT, publicName) : "";
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    console.log(`[genie] ${req.method} ${url.pathname} -> 404`);
    res.statusCode = 404;
    return res.end("not found");
  }
  res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

// NO artificial timeout: compile + sitemap/Firecrawl harvest may run minutes.
server.requestTimeout = 0;
server.headersTimeout = 10 * 60 * 1000;
server.keepAliveTimeout = 0;

// Bind every interface by default now that the local gateway reverse-proxies
// genie.wss-ai.com here (host.docker.internal cannot reach a pure 127.0.0.1
// listener). The owner-token gate still protects every provider route.
const BIND = process.env.GENIE_BIND || "0.0.0.0";
server.listen(PORT, BIND, () => {
  const keyState = ["FIRECRAWL_API_KEY", "GOOGLE_PLACES_API_KEY", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "INTAKE_GENIE_TOKEN", "PAGEHUB_OWNER_TOKEN", "BRIGHTDATA_SERP_API_KEY"]
    .map((k) => `${k}=${process.env[k] ? "set" : "MISSING"}`).join(" ");
  console.log(`genie local: http://127.0.0.1:${PORT} (routes: ${[...Object.keys(handlers), ...Object.keys(routeAliases), "/healthz"].join(", ")})`);
  console.log(`genie env: ${keyState}`);
});
