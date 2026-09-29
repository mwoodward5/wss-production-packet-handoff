#!/usr/bin/env node
// Woodward SiteForge — SaaS server. Zero dependencies, Node 22+.
//   node app/server.mjs            → http://localhost:8787
// Production hardening notes: docs/launch/PRODUCT_ARCHITECTURE.md
import "./lib/env.mjs"; // .env.local loader — must stay the first import
import http from "node:http";
import { createHash } from "node:crypto";
import { blobRelativePath } from "./lib/blob-path.mjs";
import path from "node:path";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import * as U from "./lib/util.mjs";
import * as DB from "./lib/store.mjs";
import * as Auth from "./lib/auth.mjs";
import * as Billing from "./lib/billing.mjs";
import * as Engine from "./lib/engine-adapter.mjs";
import * as Discovery from "./lib/discovery.mjs";
import * as IntakeGenie from "./lib/intake-genie.mjs";
import * as TemplateLib from "./lib/template-library.mjs";
import * as PromptEdits from "./lib/prompt-edits.mjs";
import * as StudioApi from "./lib/studio-api.mjs";
import * as VercelDomains from "./lib/vercel-domains.mjs";
import * as LeadProcessor from "./lib/lead-processor.mjs";
import { recoverAuthenticatedGhostLogo } from "./lib/source-intake.mjs";
import { enforceBusinessTruth } from "./lib/business-truth.mjs";
import { resolveGhostInputHint, resolveGhostTruthFact } from "./lib/ghost-truth-precedence.mjs";
import { ghostBuildContractForJob, queuedGhostBuildContract } from "./lib/ghost-build-contract.mjs";
import {
  createGhostPreviewIdempotencyCore,
  GhostPreviewIdempotencyError,
} from "./lib/ghost-preview-idempotency.mjs";
import { notifyGhostBuildTerminalWithRetry } from "./lib/ghost-callback.mjs";
import { createContractBuildService, ContractBuildError } from "./lib/contract-builds.mjs";
import { createBlobBuildContractStore } from "./lib/build-contract-store.mjs";
import { createBuildArtifactPublisher } from "./lib/build-artifact-publisher.mjs";
import { page, errorPage } from "./views/layout.mjs";
import * as Pub from "./views/pages-public.mjs";
import * as Home from "./views/page-home-prompt.mjs";
import * as Tpl from "./views/pages-templates.mjs";
import * as App from "./views/pages-app.mjs";
import * as Flagship from "./views/pages-flagship.mjs";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const PORT = Number(process.env.PORT || 8787);
const DEV = process.env.NODE_ENV !== "production";
const JOB_ADVANCE_LEASE_MS = Number(process.env.SITEFORGE_ADVANCE_LEASE_MS || 150_000);
let ghostPreviewIdempotency = createGhostPreviewIdempotencyCore();
let ghostPreviewCompileFromInput = (...args) => IntakeGenie.compileFromInput(...args);

export function configureGhostPreviewIdempotencyForTests(core) {
  if (process.env.NODE_ENV === "production"
    || process.env.SITEFORGE_NO_LISTEN !== "1"
    || !core
    || typeof core.claim !== "function") {
    throw new TypeError("A test-only Ghost preview idempotency core is required");
  }
  ghostPreviewIdempotency = core;
}

export function configureGhostPreviewCompilerForTests(compileFromInput) {
  if (process.env.NODE_ENV === "production"
    || process.env.SITEFORGE_NO_LISTEN !== "1"
    || typeof compileFromInput !== "function") {
    throw new TypeError("A test-only Ghost preview compiler is required");
  }
  ghostPreviewCompileFromInput = compileFromInput;
}

async function persistGhostPreviewPrestageFailure({
  jobId,
  correlationId,
  prospect = {},
  compiled = null,
  checkoutUrl = "",
  error = "Ghost build-preview pre-stage failed.",
  errorCode = "ghost_preview_prestage_failed",
  status = "failed",
}) {
  let job = DB.get("jobs", jobId);
  if (!job) {
    job = Engine.createJob("try", {
      correlation_id: correlationId,
      ghost_context: {
        correlation_id: correlationId,
        prospect,
        compiled,
        checkout_url: checkoutUrl,
      },
    }, jobId);
  }
  DB.update("jobs", job.id, {
    status,
    current_stage: "prestage",
    current_phase: "failed",
    finished_at: U.nowIso(),
    retryable: false,
    error,
    error_code: errorCode,
    correlation_id: correlationId,
    ghost_context: {
      ...(job.ghost_context || {}),
      correlation_id: correlationId,
      prospect,
      ...(compiled ? { compiled } : {}),
      checkout_url: checkoutUrl || job.ghost_context?.checkout_url || "",
    },
  });
  await Engine.persistJobState(job.id);
  return DB.get("jobs", job.id);
}

function scheduleGhostTerminalCallback(jobId, baseUrl) {
  const task = notifyGhostBuildTerminalWithRetry({ getJob: Engine.getDurableJob, jobId, baseUrl })
    .then((outcome) => {
      if (!outcome.sent && outcome.reason !== "callback_not_configured") {
        const callbackStatus = Number.isInteger(outcome.status) ? outcome.status : "unknown";
        console.warn("[ghost-terminal-callback]", jobId, outcome.reason || "not_sent", `status=${callbackStatus}`);
      }
    })
    .catch((error) => console.warn("[ghost-terminal-callback]", jobId, error?.message || error));
  if (typeof globalThis.__siteforgeWaitUntil === "function") globalThis.__siteforgeWaitUntil(task);
  return task;
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".m4v": "video/x-m4v", ".mov": "video/quicktime", ".ogg": "video/ogg", ".ogv": "video/ogg", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".woff2": "font/woff2" };

const demosPath = path.join(APP_ROOT, "data", "demos.json");
const demos = () => U.readJsonFile(demosPath, []);
const templateLibrary = () => TemplateLib.loadTemplateLibrary(demos());
let contractBuildService = null;

function getContractBuildService() {
  if (!contractBuildService) {
    const artifactPublisher = createBuildArtifactPublisher();
    contractBuildService = createContractBuildService({
      store: createBlobBuildContractStore(),
      startBuild: (request, options) => Engine.startContractBuild(request, { ...options, artifactPublisher }),
    });
  }
  return contractBuildService;
}

export function configureContractBuildServiceForTests(service) {
  if (process.env.NODE_ENV === "production") throw new Error("Contract build test injection is disabled in production");
  contractBuildService = service;
}

// ---------- response helpers ----------
const send = (res, status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers }); res.end(body); };
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json" });
const redirect = (res, to) => { res.writeHead(303, { Location: to }); res.end(); };
const notFound = (res, user) => send(res, 404, errorPage(404, "The link may be old, or the project may have been deleted.", user));
const STATUS_NO_STORE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
});

function preventStatusCaching(res) {
  for (const [name, value] of Object.entries(STATUS_NO_STORE_HEADERS)) res.setHeader(name, value);
}

function serveFileFrom(rootDir, relPath, res, extraHeaders = {}) {
  const clean = path.normalize(relPath).replace(/^([.][.][\\/])+/, "");
  let fp = path.resolve(rootDir, clean);
  if (!fp.startsWith(path.resolve(rootDir))) return false;
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
  if (!existsSync(fp) || !statSync(fp).isFile()) return false;
  res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream", "Cache-Control": relPath.includes("preview") ? "no-store" : "public, max-age=300", ...extraHeaders });
  createReadStream(fp).pipe(res);
  return true;
}

// ---------- static meta assets ----------
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26"><rect x="1" y="1" width="24" height="24" rx="6" fill="#191611"/><path d="M6 17.5 L13 6.5 L20 17.5" stroke="#C2571B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M9.5 17.5 L13 12 L16.5 17.5" stroke="#FAF6EE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="13" cy="20" r="1.4" fill="#C2571B"/></svg>`;
const OG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#191611"/><g fill="none" stroke="#3A3428" stroke-width="1.2">${Array.from({ length: 9 }, (_, i) => `<path d="M ${700 + i * 40} -20 C ${820 + i * 40} 140, ${760 + i * 40} 300, ${900 + i * 40} 420 S ${960 + i * 40} 640, ${1140 + i * 40} 700"/>`).join("")}</g><text x="80" y="270" font-family="Georgia,serif" font-size="76" fill="#FAF6EE">WSS Launch</text><text x="80" y="350" font-family="Georgia,serif" font-size="40" font-style="italic" fill="#C2571B">Forged. Graded. Live.</text><text x="80" y="540" font-family="monospace" font-size="22" fill="#9B937F">woodward software labs · type your business, get a premium site</text></svg>`;
const ROBOTS = (baseUrl) => `User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /p/\nDisallow: /account\nDisallow: /preview/\nDisallow: /try/\nDisallow: /dev/\nSitemap: ${baseUrl}/sitemap.xml\n`;
const LLMS = `# WSS Launch — llms.txt\n# WSS Launch (Woodward Software Labs) is a website builder for local businesses.\n# It discovers a business's real content (site, Google Business Profile), forges a\n# one-of-one premium website with local SEO + GEO/AEO optimization, grades every\n# build with a hard QC gate, and publishes it. Flat pricing, no credits.\n\n- Landing: /\n- Template gallery: /templates\n- Forge from template: /api/forge-from-template\n- Pricing: /pricing\n- Support: /support\n- Privacy: /legal/privacy\n- Terms: /legal/terms\n`;
const SITEMAP = () => {
  const tplUrls = TemplateLib.sitemapUrls(templateLibrary());
  const urls = [...new Set(["/", "/pricing", "/support", "/legal/privacy", "/legal/terms", "/legal/accessibility", ...tplUrls])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`;
};
const SECURITY = `Contact: mailto:hello@woodwardsoftware.com\nPreferred-Languages: en\nPolicy: /legal/terms\n`;
const HUMANS = `WSS Launch is forged by Woodward Software Labs.\nEngine: Bespoke Site OS v5 (deterministic, QC-gated).\n`;

function ghostAgencyAuthorized(req) {
  const expected = process.env.SITEFORGE_GHOST_AGENCY_TOKEN || process.env.INTAKE_GENIE_TOKEN || "";
  const supplied = String(req.headers.authorization || req.headers.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && U.timingSafeEq(supplied, expected));
}

// ---------- guards ----------
function requireUser(req, res) {
  const user = Auth.currentUser(req);
  if (!user) { redirect(res, "/login"); return null; }
  return user;
}
function ownProject(user, idv) {
  const p = DB.get("site_projects", idv);
  return p && p.user_id === user.id && p.status !== "deleted" ? p : null;
}
function ensureProjectTokens(project) {
  if (!project) return project;
  const patch = {};
  if (!project.report_token) patch.report_token = U.token(18);
  if (!project.lead_token) patch.lead_token = U.token(18);
  return Object.keys(patch).length ? DB.update("site_projects", project.id, patch) : project;
}
function publicReportUrl(baseUrl, project, version) {
  if (!project?.report_token || !version) return "";
  return `${baseUrl}/report/${encodeURIComponent(project.id)}/v${Number(version)}?t=${encodeURIComponent(project.report_token)}`;
}
async function formGuard(req, res, user) {
  const body = await U.readForm(req);
  if (!Auth.csrfOk(req, body)) { send(res, 403, errorPage(403, "Session token mismatch — reload the page and try again.", user)); return null; }
  return body;
}

async function serveBlobFallback(res, prefix, rel) {
  if (!Engine.SERVERLESS) return false;
  const { blobGet, BLOB_ENABLED } = await import("./lib/blob-store.mjs");
  if (!BLOB_ENABLED()) return false;
  const clean = blobRelativePath(rel);
  const r = await blobGet(`${prefix}/${clean}`).catch(() => null);
  if (!r) return false;
  res.writeHead(200, { "Content-Type": r.headers.get("content-type") || "application/octet-stream", "X-Robots-Tag": "noindex", "Cache-Control": "no-store" });
  res.end(Buffer.from(await r.arrayBuffer()));
  return true;
}

// ---------- server ----------
export const handle = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const forwardedProto = String(req.headers["x-forwarded-proto"] || (DEV ? "http" : "https")).split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`).split(",")[0].trim();
  const baseUrl = process.env.SITEFORGE_BASE_URL || `${forwardedProto}://${forwardedHost}`;
  const p = url.pathname;
  const seg = p.split("/").filter(Boolean);
  const user = Auth.currentUser(req);

  try {
    // ----- meta/static -----
    if (p === "/healthz") return json(res, 200, { ok: true, service: "siteforge", ts: U.nowIso() });
    if (p === "/favicon.svg") return send(res, 200, FAVICON, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
    if (p === "/og.png") {
      const real = path.join(PUBLIC_DIR, "og.png");
      if (existsSync(real)) return serveFileFrom(PUBLIC_DIR, "og.png", res) && undefined;
      return send(res, 200, OG_SVG, { "Content-Type": "image/svg+xml" });
    }
    if (p === "/robots.txt") return send(res, 200, ROBOTS(baseUrl), { "Content-Type": "text/plain" });
    if (p === "/llms.txt") return send(res, 200, LLMS, { "Content-Type": "text/plain" });
    if (p === "/sitemap.xml") return send(res, 200, SITEMAP(), { "Content-Type": "application/xml" });
    if (p === "/.well-known/security.txt" || p === "/security.txt") return send(res, 200, SECURITY, { "Content-Type": "text/plain" });
    if (p === "/humans.txt") return send(res, 200, HUMANS, { "Content-Type": "text/plain" });
    if (p === "/manifest.webmanifest") return json(res, 200, { name: "WSS Launch", short_name: "WSS Launch", start_url: "/", display: "standalone", background_color: "#0b0b0d", theme_color: "#ff4d00", icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }] });
    if (req.method === "GET" && serveFileFrom(PUBLIC_DIR, p.slice(1) || "index.html", res)) return;

    // ----- generated-site serving -----
    if (seg[0] === "preview" && seg.length >= 3) {
      const u = requireUser(req, res); if (!u) return;
      const proj = ownProject(u, seg[1]); if (!proj) return notFound(res, u);
      const dir = DB.siteDirFor(seg[1], Number(seg[2]));
      if (serveFileFrom(dir, seg.slice(3).join("/") || "index.html", res, { "X-Robots-Tag": "noindex" })) return;
      if (await serveBlobFallback(res, `sites/${seg[1]}/v${Number(seg[2])}`, seg.slice(3).join("/"))) return;
      return notFound(res, u);
    }
    if (seg[0] === "try" && seg.length >= 2) {
      const tok = seg[1].replace(/[^A-Za-z0-9_-]/g, "");
      const dir = path.join(DB.TRY_DIR, tok);
      if (existsSync(dir) && Date.now() - statSync(dir).mtimeMs < 24 * 3600_000 && serveFileFrom(dir, seg.slice(2).join("/") || "index.html", res, { "X-Robots-Tag": "noindex" })) return;
      if (await serveBlobFallback(res, `try/${tok}`, seg.slice(2).join("/"))) return;
      return notFound(res, user);
    }
    if (seg[0] === "sites" && seg.length >= 2) {
      const slug = seg[1].replace(/[^a-z0-9-]/g, "");
      const dir = path.join(DB.PUBLISHED_DIR, slug);
      if (serveFileFrom(dir, seg.slice(2).join("/") || "index.html", res)) return;
      if (await serveBlobFallback(res, `published/${slug}`, seg.slice(2).join("/"))) return;
      return notFound(res, user);
    }
    if (seg[0] === "asset-file" && seg.length === 3 && req.method === "GET") {
      const u = requireUser(req, res); if (!u) return;
      const proj = ownProject(u, seg[1]); if (!proj) return notFound(res, u);
      const { localAssetPath } = await import("./lib/media-engine.mjs");
      const fp = localAssetPath(seg[1], seg[2]);
      if (!fp) return notFound(res, u);
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      createReadStream(fp).pipe(res);
      return;
    }
    if (seg[0] === "demo" && seg.length >= 2) {
      const dir = path.join(APP_ROOT, "data", "demo-sites", seg[1].replace(/[^a-z0-9-]/g, ""));
      if (serveFileFrom(dir, seg.slice(2).join("/") || "index.html", res, { "X-Robots-Tag": "noindex" })) return;
      return notFound(res, user);
    }

    // Shareable, token-protected QC report. The token is capability access;
    // no owner session or unpublished project data is exposed without it.
    if (seg[0] === "report" && seg[1] && /^v\d+$/.test(seg[2] || "") && req.method === "GET") {
      const proj = ensureProjectTokens(DB.get("site_projects", seg[1]));
      const supplied = url.searchParams.get("t") || "";
      if (!proj || !U.timingSafeEq(proj.report_token || "", supplied)) return notFound(res, user);
      const version = Number(seg[2].slice(1));
      const generation = DB.generationsOf(proj.id).find((row) => row.version === version && row.status === "done");
      if (!generation) return notFound(res, user);
      const reportUrl = publicReportUrl(baseUrl, proj, version);
      const previewUrl = proj.deploy_url || "";
      return send(res, 200, Flagship.reportPage({ project: proj, profile: DB.profileOf(proj.id), generation, qc: DB.qcOf(generation.id), reportUrl, previewUrl }), { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" });
    }

    // ----- public pages -----
    if (req.method === "GET") {
      if (p === "/") return send(res, 200, Home.landing({ user, demos: demos() }));
      if (p === "/templates") return send(res, 200, Tpl.templatesPage({ user, library: templateLibrary(), filters: { q: url.searchParams.get("q") || "" } }));
      if (seg[0] === "templates" && seg[1]) {
        const library = templateLibrary();
        if (TemplateLib.isCategory(library, seg[1])) return send(res, 200, Tpl.templatesPage({ user, library, filters: { category: seg[1], q: url.searchParams.get("q") || "" } }));
        const tplPage = Tpl.templateTryPage({ user, library, slug: seg[1] });
        if (tplPage) return send(res, 200, tplPage);
        if (Engine.HERO_FAMILIES.some((f) => f.key === seg[1])) return send(res, 200, Pub.templateTryPage({ user, family: seg[1] }));
      }
      if (p === "/pricing") return send(res, 200, Pub.pricingPage({ user }));
      if (p === "/support") return send(res, 200, Pub.supportPage({ user }));
      if (seg[0] === "legal" && ["privacy", "terms", "accessibility"].includes(seg[1])) return send(res, 200, Pub.legalPage({ user, kind: seg[1] }));
      if (p === "/login") {
        if (user) return redirect(res, "/dashboard");
        let csrf = Auth.csrfOf(req);
        if (!csrf) { csrf = U.token(16); res.setHeader("Set-Cookie", U.cookie("sf_csrf", csrf, { httpOnly: false })); }
        return send(res, 200, Pub.loginPage({ sent: url.searchParams.has("sent"), error: url.searchParams.get("error"), googleEnabled: Auth.GOOGLE_ENABLED, csrf }));
      }
      if (p === "/dev/inbox" && DEV) return send(res, 200, Pub.devInboxPage({ user, messages: DB.all("dev_inbox").reverse().slice(0, 50) }));
    }

    // ----- auth -----
    if (p === "/auth/magic-link" && req.method === "POST") {
      const body = await U.readForm(req);
      const betaCode = process.env.SITEFORGE_BETA_CODE;
      if (betaCode && !Auth.EMAIL_LIVE) {
        if (!U.timingSafeEq(U.clampStr(body.beta_code, 40), betaCode)) return redirect(res, "/login?error=" + encodeURIComponent("Invalid beta code. Email hello@woodwardsoftware.com for access."));
        if (!U.isEmail(body.email)) return redirect(res, "/login?error=" + encodeURIComponent("Enter a valid email."));
        const u = Auth.findOrCreateUser(body.email, { provider: "beta" });
        Auth.createSession(u, res);
        return redirect(res, "/dashboard");
      }
      await Auth.sendMagicLink(body.email, baseUrl, req);
      return redirect(res, "/login?sent=1");
    }
    if (p === "/auth/verify" && req.method === "GET") {
      const u = Auth.verifyMagicToken(url.searchParams.get("token") || "");
      if (!u) return redirect(res, "/login?error=" + encodeURIComponent("That link is expired or already used — request a fresh one."));
      Auth.createSession(u, res);
      return redirect(res, "/dashboard");
    }
    if (p === "/auth/google" && req.method === "GET") {
      if (!Auth.GOOGLE_ENABLED) return redirect(res, "/login?error=" + encodeURIComponent("Google sign-in isn't configured yet."));
      return redirect(res, Auth.googleAuthUrl(baseUrl, U.token(12)));
    }
    if (p === "/auth/google/callback" && req.method === "GET") {
      const u = await Auth.googleCallback(url.searchParams.get("code"), baseUrl);
      Auth.createSession(u, res);
      return redirect(res, "/dashboard");
    }
    if (p === "/auth/logout" && req.method === "POST") { Auth.logout(req, res); return redirect(res, "/"); }

    // ----- app pages -----
    if (req.method === "GET" && ["/dashboard", "/new", "/account", "/growth", "/studio"].includes(p)) {
      const u = requireUser(req, res); if (!u) return;
      if (p === "/dashboard") return send(res, 200, App.dashboard({ user: u, projects: DB.projectsOf(u.id), ent: Billing.entitlementFor(u), gens: Billing.generationGate(u) }));
      if (p === "/new") return send(res, 200, App.wizardPage({ user: u, csrf: Auth.csrfOf(req) }));
      if (p === "/account") return send(res, 200, App.accountPage({ user: u, ent: Billing.entitlementFor(u), sub: DB.subscriptionOf(u.id), csrf: Auth.csrfOf(req) }));
      if (p === "/growth") {
        const ent = Billing.entitlementFor(u);
        if (!ent.can_growth_hub) return send(res, 402, errorPage(402, "Growth Hub is included with Pro and Agency plans.", u));
        const projects = DB.projectsOf(u.id);
        const ids = projects.map((row) => row.id);
        return send(res, 200, Flagship.growthHubPage({ user: u, projects, leads: DB.leadsOf(u.id, ids), reviews: DB.reviewRequestsOf(u.id, ids), ranks: DB.rankSnapshotsOf(u.id, ids), ent }));
      }
      if (p === "/studio") {
        const ent = Billing.entitlementFor(u);
        if (!ent.can_studio) return send(res, 402, errorPage(402, "Studio and Forge API access are included with the Agency plan.", u));
        const projects = DB.projectsOf(u.id).map((row) => ({ ...row, grade: row.last_grade, look: row.hero_family }));
        const clients = [...DB.clientsOf(u.id), ...projects];
        return send(res, 200, Flagship.studioConsolePage({ user: u, clients, apiKeys: DB.apiKeysOf(u.id), ent, csrf: Auth.csrfOf(req) }));
      }
    }
    if (req.method === "GET" && seg[0] === "p" && seg[1]) {
      const u = requireUser(req, res); if (!u) return;
      const proj = ensureProjectTokens(ownProject(u, seg[1])); if (!proj) return notFound(res, u);
      const profile = DB.profileOf(proj.id);
      const tab = seg[2] || "";
      if (tab === "") return send(res, 200, App.projectOverview({ user: u, project: proj, profile, gens: DB.generationsOf(proj.id), edits: DB.editRequestsOf(proj.id), csrf: Auth.csrfOf(req) }));
      if (tab === "discovery") return send(res, 200, App.projectDiscovery({ user: u, project: proj, profile, assets: DB.assetsOf(proj.id).filter((a) => !a.stale), csrf: Auth.csrfOf(req) }));
      if (tab === "build") return send(res, 200, App.projectBuild({ user: u, project: proj, gens: DB.generationsOf(proj.id), csrf: Auth.csrfOf(req), jobId: url.searchParams.get("job"), gate: Billing.generationGate(u) }));
      if (tab === "preview") {
        const gens = DB.generationsOf(proj.id).filter((g) => g.status === "done");
        const v = url.searchParams.get("v");
        const gen = v ? gens.find((g) => g.version === Number(v)) : (proj.active_version ? gens.find((g) => g.version === Number(proj.active_version)) : null) || gens[0];
        const scorecard = gen?.site_dir ? U.readJsonFile(path.join(gen.site_dir, "scorecard.json"), null) : null;
        const seo = U.readJsonFile(path.join(DB.SITES_DIR, proj.id, "discovery", "seo.json"), null);
        return send(res, 200, App.projectPreview({ user: u, project: proj, gen, qc: gen ? DB.qcOf(gen.id) : null, csrf: Auth.csrfOf(req), version: gen?.version, scorecard, seo, reportUrl: publicReportUrl(baseUrl, proj, gen?.version) }));
      }
      if (tab === "publish") {
        const gens = DB.generationsOf(proj.id).filter((g) => g.status === "done");
        const gen = (proj.active_version ? gens.find((g) => g.version === Number(proj.active_version)) : null) || gens[0];
        return send(res, 200, App.projectPublish({ user: u, project: proj, gen, ent: Billing.entitlementFor(u), deployments: DB.deploymentsOf(proj.id), csrf: Auth.csrfOf(req), baseUrl }));
      }
      return notFound(res, u);
    }

    // ----- Public lead intake from published, QC-rendered sites -----
    if (seg[0] === "api" && seg[1] === "leads" && seg[2] && req.method === "POST") {
      const proj = DB.get("site_projects", seg[2]);
      if (!proj) return json(res, 404, { error: "site not found" });
      const wantsJson = String(req.headers["content-type"] || "").includes("application/json");
      const body = wantsJson ? await U.readJson(req) : await U.readForm(req);
      const normalized = LeadProcessor.normalizeLeadPayload(body);
      const suppliedToken = body.lead_token || body.data?.lead_token || "";
      if (!U.timingSafeEq(proj.lead_token || "", suppliedToken)) return json(res, 403, { error: "invalid lead token" });
      if (normalized.honeypot) return send(res, 200, page({ title: "Thanks", desc: "Request received.", noindex: true, body: `<section class="section"><div class="wrap"><h1>Thanks.</h1><p>Your request has been received.</p></div></section>` }));
      const limit = U.rateLimit(`lead:${proj.id}:${U.ipOf(req)}`, { max: 8, windowMs: 3600_000 });
      if (!limit.ok) return json(res, 429, { error: "too many requests" });
      const name = U.clampStr(normalized.data.name, 100);
      const phone = U.clampStr(normalized.data.phone, 30);
      const email = U.clampStr(normalized.data.email, 160);
      const message = U.clampStr(normalized.data.message, 3000);
      if (!name || (!phone && !U.isEmail(email) && !message)) return json(res, 400, { error: "name and a contact detail or message are required" });
      const idempotencyKey = U.clampStr(req.headers["idempotency-key"] || normalized.id, 120) || createHash("sha256").update([proj.id, name, phone, email, message].join("|")).digest("hex").slice(0, 40);
      const duplicate = DB.find("leads", (row) => row.project_id === proj.id && row.meta?.idempotency_key === idempotencyKey);
      if (duplicate) return wantsJson ? json(res, 200, { accepted: true, duplicate: true, lead_id: duplicate.id }) : redirect(res, proj.deploy_url || `/sites/${proj.slug}/`);
      const scoring = LeadProcessor.scoreLead(normalized);
      const lead = DB.insert("leads", {
        project_id: proj.id,
        user_id: proj.user_id,
        name,
        phone: phone || null,
        email: U.isEmail(email) ? email : null,
        message: message || null,
        summary: message || `Quote request from ${name}`,
        source: "site-form",
        status: "new",
        meta: {
          idempotency_key: idempotencyKey,
          form_id: normalized.form_id,
          score: scoring.score,
          segment: scoring.segment,
          consent_given: normalized.consent_given,
          attribution: { source: normalized.utm_source, medium: normalized.utm_medium, campaign: normalized.utm_campaign, content: normalized.utm_content, term: normalized.utm_term },
        },
      });
      DB.insert("dev_inbox", { to: DB.get("users", proj.user_id)?.email, subject: `New lead - ${proj.name}`, body: `${name}\n${phone || email || "No contact supplied"}\n\n${message}` });
      const notificationEnv = DEV && process.env.SITEFORGE_LEAD_NOTIFICATIONS_IN_DEV !== "true"
        ? { ...process.env, RESEND_API_KEY: "", SITEFORGE_LEAD_WEBHOOK_URL: "", LEAD_WEBHOOK_URL: "" }
        : process.env;
      const notification = await LeadProcessor.processLeadNotification(normalized, {
        ownerEmail: DB.get("users", proj.user_id)?.email,
        projectName: proj.name,
        leadId: lead.id,
        env: notificationEnv,
        onFailure: async (failure) => DB.insert("failed_leads", {
          user_id: proj.user_id,
          project_id: proj.id,
          lead_id: lead.id,
          channel: failure.channel,
          status: "queued",
          attempt_count: failure.attempts,
          response_status: failure.response_status,
          error_code: failure.error_code,
        }),
      });
      DB.audit(proj.user_id, "lead.capture", lead.id, { project_id: proj.id, source: "site-form", score: scoring.score, segment: scoring.segment, notification_failed: notification.failed });
      if (wantsJson) return json(res, 202, { accepted: true, lead_id: lead.id, score: scoring.score, segment: scoring.segment });
      return send(res, 200, page({ title: "Request received", desc: "Your request was sent.", noindex: true, body: `<section class="section"><div class="wrap" style="max-width:720px"><p class="eyebrow">Sent</p><h1>${U.esc(proj.name)} has your request.</h1><p>They can now follow up using the details you supplied.</p><a class="btn ember" href="${U.esc(proj.deploy_url || `/sites/${proj.slug}/`)}">Back to the site</a></div></section>` }));
    }

    // Connector ingestion for real Growth Hub records. No sample metrics are synthesized.
    if (p === "/api/growth/events" && req.method === "POST") {
      const configured = process.env.SITEFORGE_GROWTH_TOKEN || process.env.INTAKE_GENIE_TOKEN || "";
      const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
      if (!configured) return json(res, 503, { error: "growth ingestion is not configured" });
      if (!U.timingSafeEq(configured, supplied)) return json(res, 401, { error: "unauthorized" });
      const body = await U.readJson(req);
      const proj = DB.get("site_projects", U.clampStr(body.project_id, 100));
      if (!proj) return json(res, 404, { error: "project not found" });
      const common = { project_id: proj.id, user_id: proj.user_id, source: U.clampStr(body.source, 80) || "connector" };
      let record;
      if (body.type === "lead") record = DB.insert("leads", { ...common, name: U.clampStr(body.name, 100) || "Unattributed lead", email: U.isEmail(body.email) ? body.email : null, phone: U.clampStr(body.phone, 30) || null, message: U.clampStr(body.message, 3000) || null, summary: U.clampStr(body.summary || body.message, 300), status: U.clampStr(body.status, 30) || "new" });
      else if (body.type === "review") record = DB.insert("review_requests", { ...common, name: U.clampStr(body.name, 100) || null, rating: Number.isFinite(Number(body.rating)) ? Math.max(0, Math.min(5, Number(body.rating))) : null, text: U.clampStr(body.text, 3000) || null, status: U.clampStr(body.status, 30) || "received" });
      else if (body.type === "rank") record = DB.insert("rank_snapshots", { ...common, keyword: U.clampStr(body.keyword, 200), position: Number.isFinite(Number(body.position)) ? Number(body.position) : null, change: Number.isFinite(Number(body.change)) ? Number(body.change) : null, observed_at: body.observed_at || U.nowIso() });
      else return json(res, 400, { error: "type must be lead, review, or rank" });
      return json(res, 201, { ok: true, id: record.id });
    }

    // ----- Studio key management and machine API -----
    if (p === "/api/studio/keys" && req.method === "POST") {
      const u = requireUser(req, res); if (!u) return;
      const body = await formGuard(req, res, u); if (!body) return;
      const ent = Billing.entitlementFor(u);
      if (!StudioApi.studioAllowed(ent)) return send(res, 402, errorPage(402, "Forge API access requires the Agency plan.", u));
      const created = StudioApi.createApiKey({ userId: u.id, name: body.name });
      DB.audit(u.id, "studio.key_create", created.record.id, { prefix: created.record.prefix });
      return send(res, 201, page({ title: "API key created", desc: "Your WSS Launch API key.", user: u, noindex: true, body: `<section class="section"><div class="wrap" style="max-width:760px"><p class="eyebrow">Shown once</p><h1>API key created.</h1><p>Store this secret now. WSS Launch keeps only its hash.</p><pre style="overflow:auto;padding:1rem;background:#0b0b0d;color:#f2efe6;border-radius:8px"><code>${U.esc(created.secret)}</code></pre><a class="btn ember" href="/studio">Return to Studio</a></div></section>` }));
    }
    if (seg[0] === "api" && seg[1] === "studio" && seg[2] === "keys" && seg[3] && seg[4] === "revoke" && req.method === "POST") {
      const u = requireUser(req, res); if (!u) return;
      const body = await formGuard(req, res, u); if (!body) return;
      if (!StudioApi.revokeApiKey(u.id, seg[3])) return notFound(res, u);
      DB.audit(u.id, "studio.key_revoke", seg[3], {});
      return redirect(res, "/studio");
    }
    if (p === "/api/build" && req.method === "POST") {
      const auth = StudioApi.authenticateApiRequest(req);
      if (!auth) return json(res, 401, { error: "invalid API key", error_code: "UNAUTHORIZED" });
      if (!StudioApi.apiKeyHasScope(auth, "forge:write")) return json(res, 403, { error: "forge:write scope is required", error_code: "INSUFFICIENT_SCOPE" });
      let body;
      try { body = await U.readJson(req); }
      catch { return json(res, 400, { error: "Build request failed validation", error_code: "INVALID_BUILD_REQUEST" }); }
      const result = await getContractBuildService().submit(body, { ownerId: auth.user.id });
      return json(res, result.statusCode, result.response);
    }
    if (seg[0] === "api" && seg[1] === "build" && seg.length === 3 && req.method === "GET") {
      const auth = StudioApi.authenticateApiRequest(req);
      if (!auth) return json(res, 401, { error: "invalid API key", error_code: "UNAUTHORIZED" });
      if (!StudioApi.apiKeyHasScope(auth, "forge:write")) return json(res, 403, { error: "forge:write scope is required", error_code: "INSUFFICIENT_SCOPE" });
      const result = await getContractBuildService().get(seg[2], { ownerId: auth.user.id });
      return json(res, 200, result);
    }
    if (p === "/api/v1/forge" && req.method === "POST") {
      const auth = StudioApi.authenticateApiRequest(req);
      if (!auth) return json(res, 401, { error: "invalid API key" });
      const ent = Billing.entitlementFor(auth.user);
      if (!StudioApi.studioAllowed(ent)) return json(res, 403, { error: "API access is not enabled for this workspace" });
      const body = await U.readJson(req);
      U.need(body, ["business_name", "city", "state", "industry"]);
      const projectGate = Billing.projectGate(auth.user);
      if (!projectGate.ok) return json(res, 402, { error: `project limit reached (${projectGate.count}/${projectGate.max})` });
      const generationGate = Billing.generationGate(auth.user);
      if (!generationGate.ok) return json(res, 402, { error: `generation limit reached (${generationGate.used}/${generationGate.max})` });
      const name = U.clampStr(body.business_name, 80);
      const proj = DB.insert("site_projects", { id: U.id("proj"), user_id: auth.user.id, name, slug: `${U.kebab(body.industry)}-${U.kebab(name)}-${U.token(3).toLowerCase()}`.replace(/[^a-z0-9-]/g, ""), status: "draft", goal: U.clampStr(body.goal, 20) || "calls", city: U.clampStr(body.city, 60), state: U.clampStr(body.state, 2), industry: U.clampStr(body.industry, 40), next_version: 1, report_token: U.token(18), lead_token: U.token(18), hero_family: Engine.HERO_FAMILIES.some((row) => row.key === body.hero_family) ? body.hero_family : null });
      const profile = DB.insert("business_profiles", { project_id: proj.id, business_name: name, industry: proj.industry, city: proj.city, state: proj.state, phone: U.clampStr(body.phone, 20) || null, website: U.isUrl(body.website) ? body.website : null, gbp_url: U.isUrl(body.gbp_url) ? body.gbp_url : null, services: [].concat(body.services || []).flatMap((value) => String(value).split(",")).map((value) => value.trim()).filter(Boolean).slice(0, 24) });
      await Discovery.runDiscovery({ user: auth.user, project: proj, profile }).catch((error) => DB.update("site_projects", proj.id, { discovery_error: error.message }));
      const run = Engine.startGeneration({ user: auth.user, project: proj, profile, assets: DB.assetsOf(proj.id).filter((row) => !row.stale), options: { prompt: U.clampStr(body.prompt, 4000), build_type: body.build_type === "premier_multi_page" ? "premier_multi_page" : "single_page_cinematic", hero_family: proj.hero_family, sections_disabled: [], paid_publish: true } });
      if (Engine.SERVERLESS) {
        const result = await run.done;
        return json(res, 201, { ok: true, project_id: proj.id, job_id: run.job.id, result, report_url: publicReportUrl(baseUrl, proj, result.version) });
      }
      return json(res, 202, { ok: true, project_id: proj.id, job_id: run.job.id });
    }
    if (seg[0] === "api" && seg[1] === "v1" && seg[2] === "jobs" && seg[3] && req.method === "GET") {
      const auth = StudioApi.authenticateApiRequest(req);
      if (!auth) return json(res, 401, { error: "invalid API key" });
      const job = DB.get("jobs", seg[3]);
      if (!job || job.user_id !== auth.user.id) return json(res, 404, { error: "job not found" });
      return json(res, 200, job);
    }

    // ----- API: projects -----
    if (p === "/api/projects" && req.method === "POST") {
      const u = requireUser(req, res); if (!u) return;
      const body = await formGuard(req, res, u); if (!body) return;
      const gate = Billing.projectGate(u);
      if (!gate.ok) return send(res, 402, errorPage(402, `Your ${gate.ent.plan_name} plan includes ${gate.max} project${gate.max > 1 ? "s" : ""}. Upgrade to add more.`, u));
      U.need(body, ["business_name", "city", "state", "industry"]);
      const name = U.clampStr(body.business_name, 80);
      const sourceTemplate = body.template_id ? TemplateLib.findTemplate(templateLibrary(), body.template_id) : null;
      const heroFamily = sourceTemplate?.hero_family || (Engine.HERO_FAMILIES.some((f) => f.key === body.hero_family) ? body.hero_family : null);
      const proj = DB.insert("site_projects", {
        id: U.id("proj"), user_id: u.id, name, slug: `${U.kebab(body.industry)}-${U.kebab(name)}-${U.token(3).toLowerCase()}`.replace(/[^a-z0-9-]/g, ""),
        status: "draft", goal: U.clampStr(body.goal, 20) || "calls",
        city: U.clampStr(body.city, 60), state: U.clampStr(body.state, 2), industry: U.clampStr(body.industry, 40), next_version: 1,
        report_token: U.token(18), lead_token: U.token(18),
        hero_family: heroFamily, source_template_id: sourceTemplate?.id || null, source_template_name: sourceTemplate?.name || null,
      });
      const profile = DB.insert("business_profiles", {
        project_id: proj.id, business_name: name, industry: proj.industry, city: proj.city, state: proj.state,
        phone: U.clampStr(body.phone, 20) || null, website: body.website && U.isUrl(body.website) ? body.website : null,
        gbp_url: body.gbp_url && U.isUrl(body.gbp_url) ? body.gbp_url : null,
        services: U.clampStr(body.services, 400).split(",").map((s) => s.trim()).filter(Boolean),
      });
      DB.audit(u.id, "project.create", proj.id, { name });
      await Discovery.runDiscovery({ user: u, project: proj, profile }).catch((e) => DB.update("site_projects", proj.id, { discovery_error: e.message }));
      return redirect(res, `/p/${proj.id}/discovery`);
    }
    if (seg[0] === "api" && seg[1] === "projects" && seg[2] && req.method === "POST") {
      const u = requireUser(req, res); if (!u) return;
      const proj = ensureProjectTokens(ownProject(u, seg[2])); if (!proj) return notFound(res, u);
      const action = seg[3];

      // V7 media engine: multipart upload (logo + photos) — parsed before formGuard
      if (action === "assets" && seg[4] === "upload") {
        const Media = await import("./lib/media-engine.mjs");
        const parts = await Media.readMultipart(req);
        const wantsJson = (req.headers.accept || "").includes("application/json");
        const failUpload = (status, message) => wantsJson ? json(res, status, { error: message }) : send(res, status, errorPage(status, message, u));
        if (!Auth.csrfOk(req, parts.fields)) return failUpload(403, "Session token mismatch — reload the page and try again.");
        const logoFiles = parts.files.filter((f) => f.field === "logo");
        const photoFiles = parts.files.filter((f) => f.field !== "logo");
        if (logoFiles.length > 1) return failUpload(400, "Upload one logo at a time.");
        if (photoFiles.length > Media.MAX_PHOTOS_PER_UPLOAD) return failUpload(400, `Upload 1-${Media.MAX_PHOTOS_PER_UPLOAD} photos at a time.`);
        const stored = [];
        for (const f of [...logoFiles, ...photoFiles]) {
          const kind = f.field === "logo" ? "logo" : "photo";
          stored.push(await Media.storeUpload(proj, f, kind));
        }
        if (!stored.length) return failUpload(400, "No files arrived — pick a logo or photos first.");
        DB.audit(u.id, "asset.upload", proj.id, { count: stored.length });
        if (wantsJson) return json(res, 200, Media.uploadSummary(stored));
        return redirect(res, `/p/${proj.id}/discovery`);
      }

      if (action === "assets-preview") {
        const body = await U.readJson(req);
        if (!Auth.csrfOk(req, body)) return json(res, 403, { error: "csrf" });
        const gate = Billing.generationGate(u);
        if (!gate.ok) return json(res, 402, { error: `You've used ${gate.used}/${gate.max} forge runs this month. Upgrade for more.` });
        const profile = DB.profileOf(proj.id);
        const last = DB.generationsOf(proj.id).find((g) => g.status === "done");
        if (!last) return json(res, 409, { error: "Upload saved. Run the first forge to see these assets in a graded preview." });
        const options = {
          prompt: last.prompt || "", build_type: last.build_type || "single_page_cinematic",
          hero_family: last.hero_family || proj.hero_family || null, sections_disabled: last.sections_disabled || [],
          regen_target: "media", video_prompt: false, rediscover: false,
        };
        const { job, done } = Engine.startGeneration({ user: u, project: proj, profile, assets: DB.assetsOf(proj.id).filter((a) => !a.stale), options });
        if (Engine.SERVERLESS) { await done; return json(res, 200, { ok: true, job_id: job.id }); }
        return json(res, 202, { ok: true, job_id: job.id });
      }

      const body = await formGuard(req, res, u); if (!body) return;
      const profile = DB.profileOf(proj.id);

      if (action === "logo-candidates") {
        const Media = await import("./lib/media-engine.mjs");
        await Media.makeLogoCandidates(proj, profile);
        DB.audit(u.id, "asset.logo_candidates", proj.id, {});
        return redirect(res, `/p/${proj.id}/discovery`);
      }
      if (action === "gbp-import") {
        if (body.gbp_url && U.isUrl(body.gbp_url)) { DB.update("business_profiles", profile.id, { gbp_url: body.gbp_url }); profile.gbp_url = body.gbp_url; }
        const Media = await import("./lib/media-engine.mjs");
        const deep = await Media.gbpDeepImport(proj, profile);
        DB.audit(u.id, "discovery.gbp_deep", proj.id, { reviews: deep.reviews.length, photos: deep.photos.length, latlng: Boolean(deep.latlng) });
        return redirect(res, `/p/${proj.id}/discovery`);
      }

      if (action === "discover") {
        await Discovery.runDiscovery({ user: u, project: proj, profile });
        return redirect(res, `/p/${proj.id}/discovery`);
      }
      if (action === "assets") {
        Discovery.addManualAsset(proj, { kind: U.clampStr(body.kind, 20), url: body.url, label: body.label });
        return redirect(res, `/p/${proj.id}/discovery`);
      }
      if (action === "generate" || action === "regenerate") {
        const gate = Billing.generationGate(u);
        if (!gate.ok) return send(res, 402, errorPage(402, `You've used ${gate.used}/${gate.max} forge runs this month. Upgrade for more.`, u));
        const last = DB.generationsOf(proj.id)[0];
        let options;
        if (action === "generate") {
          options = {
            prompt: U.clampStr(body.prompt, 4000), build_type: body.build_type === "premier_multi_page" ? "premier_multi_page" : "single_page_cinematic",
            hero_family: body.hero_family || null,
            sections_disabled: [].concat(body.sections_off || []).filter(Boolean),
            video_prompt: Boolean(body.video_prompt), rediscover: false,
          };
        } else {
          const target = U.clampStr(body.target, 20);
          const fams = Engine.HERO_FAMILIES.map((f) => f.key);
          const nextFam = fams[(fams.indexOf(last?.hero_family) + 1 + fams.length) % fams.length];
          options = {
            prompt: last?.prompt || "", build_type: last?.build_type || "single_page_cinematic",
            hero_family: target === "hero" ? nextFam : last?.hero_family || null,
            sections_disabled: target === "gallery" ? [...(last?.sections_disabled || []), "atlas-grid"] : target === "map" ? (last?.sections_disabled || []).filter((s) => s !== "service-map") : last?.sections_disabled || [],
            regen_target: target, video_prompt: false, rediscover: false,
          };
        }
        const { job, done } = Engine.startGeneration({ user: u, project: proj, profile, assets: DB.assetsOf(proj.id).filter((a) => !a.stale), options });
        if (Engine.SERVERLESS) { await done; return redirect(res, `/p/${proj.id}/preview`); }
        return redirect(res, `/p/${proj.id}/build?job=${job.id}`);
      }
      if (action === "publish") {
        const ent = Billing.entitlementFor(u);
        if (!ent.can_publish) return send(res, 402, errorPage(402, "Publishing needs a paid plan — your forged site stays saved.", u));
        const gens = DB.generationsOf(proj.id).filter((g) => g.status === "done");
        const gen = (proj.active_version ? gens.find((g) => g.version === Number(proj.active_version)) : null) || gens[0];
        if (!gen) return send(res, 400, errorPage(400, "Nothing forged yet.", u));
        const qc = DB.qcOf(gen.id);
        if (!Engine.isPublishableQc(qc)) return send(res, 400, errorPage(400, `v${gen.version} did not pass the full V8 quality gate. Real screenshots and every QC layer are required before publishing.`, u));
        const local = await Engine.publishLocally(proj, gen);
        let liveUrl = `${baseUrl}${local.url}`;
        const vercel = await Engine.publishToVercel(proj, gen);
        if (!vercel.skipped) liveUrl = vercel.url;
        DB.insert("deployments", { project_id: proj.id, generation_id: gen.id, target: vercel.skipped ? "siteforge-local" : "vercel", url: liveUrl, status: "live" });
        DB.update("site_projects", proj.id, { status: "published", deploy_url: liveUrl });
        DB.insert("dev_inbox", { to: u.email, subject: `${proj.name} is live`, body: `Published v${gen.version} → ${liveUrl}${vercel.skipped ? ` (local mode: ${vercel.reason})` : ""}` });
        DB.audit(u.id, "project.publish", proj.id, { url: liveUrl, target: vercel.skipped ? "local" : "vercel" });
        return redirect(res, `/p/${proj.id}/publish`);
      }
      if (action === "domain") {
        const ent = Billing.entitlementFor(u);
        if (!ent.can_custom_domain) return send(res, 402, errorPage(402, "Custom domains come with paid plans.", u));
        const deployed = DB.deploymentsOf(proj.id).find((row) => row.target === "vercel" && row.status === "live");
        if (!deployed) return send(res, 409, errorPage(409, "Publish this site to Vercel before attaching its custom domain.", u));
        const domain = U.clampStr(body.domain, 120).toLowerCase();
        if (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return send(res, 400, errorPage(400, "That doesn't look like a domain.", u));
        const result = await VercelDomains.attachProjectDomain(proj, domain);
        DB.insert("deployments", { project_id: proj.id, generation_id: deployed.generation_id || null, target: "custom-domain", url: `https://${domain}`, status: result.verified ? "live" : "verification_pending", meta: { verification: result.verification, dns: result.dns } });
        DB.update("site_projects", proj.id, { custom_domain: domain });
        DB.audit(u.id, "project.domain", proj.id, { domain, verified: result.verified });
        return redirect(res, `/p/${proj.id}/publish`);
      }
      if (action === "domain-verify") {
        const domain = U.clampStr(proj.custom_domain, 120).toLowerCase();
        if (!domain) return send(res, 400, errorPage(400, "Attach a domain before verifying it.", u));
        const result = await VercelDomains.verifyProjectDomain(proj, domain);
        const existing = DB.deploymentsOf(proj.id).find((row) => row.target === "custom-domain" && row.url === `https://${domain}`);
        if (existing) DB.update("deployments", existing.id, { status: result.verified ? "live" : "verification_pending", meta: { verification: result.verification, dns: result.dns } });
        DB.audit(u.id, "project.domain_verify", proj.id, { domain, verified: result.verified });
        return redirect(res, `/p/${proj.id}/publish`);
      }
      if (action === "prompt-edit") {
        U.need(body, ["message"]);
        const last = DB.generationsOf(proj.id).find((g) => g.status === "done");
        const plan = PromptEdits.planPromptEdit({ message: body.message, last, project: proj, profile });
        if (!plan.ok) {
          DB.insert("edit_requests", { project_id: proj.id, user_id: u.id, message: U.clampStr(body.message, 2000), status: plan.status, reason: plan.reason });
          DB.insert("dev_inbox", { to: "ops@woodwardsoftware.com", subject: `Prompt edit review — ${proj.name}`, body: `${body.message}\n\nReason: ${plan.reason}` });
          DB.audit(u.id, "prompt_edit.operator_review", proj.id, { reason: plan.reason });
          return redirect(res, `/p/${proj.id}`);
        }
        const gate = Billing.generationGate(u);
        if (!gate.ok) return send(res, 402, errorPage(402, `You've used ${gate.used}/${gate.max} forge runs this month. Upgrade for more.`, u));
        const edit = DB.insert("edit_requests", {
          project_id: proj.id, user_id: u.id, message: U.clampStr(body.message, 2000),
          status: "generating", reason: plan.reason, intents: plan.intents,
        });
        const { job, done } = Engine.startGeneration({ user: u, project: proj, profile, assets: DB.assetsOf(proj.id).filter((a) => !a.stale), options: plan.options });
        done.then((result) => DB.update("edit_requests", edit.id, { status: result ? "done" : "failed", job_id: job.id, generation_id: result?.generation_id || null })).catch((err) => DB.update("edit_requests", edit.id, { status: "failed", job_id: job.id, reason: err.message }));
        DB.audit(u.id, "prompt_edit.apply", proj.id, { job_id: job.id, intents: plan.intents });
        if (Engine.SERVERLESS) { await done; return redirect(res, `/p/${proj.id}/preview`); }
        return redirect(res, `/p/${proj.id}/build?job=${job.id}`);
      }
      if (action === "revert") {
        const version = Number(body.version);
        const gen = DB.generationsOf(proj.id).find((g) => g.version === version && g.status === "done");
        if (!gen) return send(res, 404, errorPage(404, "That finished version was not found.", u));
        if (!Engine.isPublishableQc(DB.qcOf(gen.id))) return send(res, 400, errorPage(400, `v${version} did not pass the full V8 quality gate and cannot become the active preview.`, u));
        DB.update("site_projects", proj.id, { active_version: version, status: "preview_ready", last_grade: gen.qc_grade, hero_family: gen.hero_family || proj.hero_family });
        DB.insert("edit_requests", { project_id: proj.id, user_id: u.id, message: `Reverted active preview to v${version}.`, status: "done" });
        DB.audit(u.id, "project.revert", proj.id, { version });
        return redirect(res, `/p/${proj.id}/preview?v=${version}`);
      }
      if (action === "edit-requests") {
        U.need(body, ["message"]);
        DB.insert("edit_requests", { project_id: proj.id, user_id: u.id, message: U.clampStr(body.message, 2000), status: "open" });
        DB.insert("dev_inbox", { to: "ops@woodwardsoftware.com", subject: `Edit request — ${proj.name}`, body: body.message });
        DB.audit(u.id, "edit_request.create", proj.id, {});
        return redirect(res, `/p/${proj.id}`);
      }
      return notFound(res, u);
    }

    // ----- API: assets, jobs, templates, checkout -----
    if (seg[0] === "api" && seg[1] === "assets" && seg[2] && req.method === "PATCH") {
      const u = requireUser(req, res); if (!u) return;
      const body = await U.readJson(req);
      if (!Auth.csrfOk(req, body) && !req.headers["x-csrf-token"]) return json(res, 403, { error: "csrf" });
      const asset = DB.get("business_assets", seg[2]);
      const proj = asset && ownProject(u, asset.project_id);
      if (!proj) return json(res, 404, { error: "not found" });
      Discovery.setAssetApproval(asset.id, Boolean(body.approved));
      if (body.label) Discovery.editAssetLabel(asset.id, body.label);
      if (body.exclusive === "logo-candidate" && body.approved) {
        for (const sib of DB.where("business_assets", (x) => x.project_id === proj.id && x.kind === "logo" && x.origin === "ai-candidate" && x.id !== asset.id)) {
          DB.update("business_assets", sib.id, { approved: false });
        }
      }
      return json(res, 200, { ok: true });
    }
    if (seg[0] === "api" && seg[1] === "jobs" && seg[2]) {
      const job = await Engine.getDurableJob(seg[2]);
      if (!job) return json(res, 404, { error: "job not found" });
      if (job.user_id) { const u = Auth.currentUser(req); if (!u || u.id !== job.user_id) return json(res, 403, { error: "forbidden" }); }
      if (seg[3] === "advance" && req.method === "POST") {
        const body = await U.readJson(req).catch(() => ({}));
        const result = await Engine.runDurableTryStage(seg[2], {
          suppliedToken: String(req.headers["x-siteforge-job-token"] || ""),
          baseUrl,
          requestedStage: String(body.stage || ""),
          requestId: String(body.request_id || ""),
          advanceAttempt: Number(body.advance_attempt || 0),
          reclaimFromRequestId: String(body.reclaim_from_request_id || ""),
          leaseEtag: String(body.lease_etag || ""),
        });
        if (result.terminal) scheduleGhostTerminalCallback(seg[2], baseUrl);
        console.log("[advance]", seg[2], "req_stage=" + String(body.stage || ""), "req_id=" + String(body.request_id || ""), "->", JSON.stringify({ ok: result.ok, stage: result.stage, status: result.status, reason: result.reason, already_running: result.already_running, terminal: result.terminal, retrying: result.retrying }));
        return json(res, result.ok === false ? 422 : 200, result);
      }
      if (seg[3] === "stream") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        const write = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        const off = Engine.subscribe(job.id, write);
        const current = DB.get("jobs", seg[2]);
        if (["done", "ready", "blocked", "failed", "timed_out"].includes(current.status) && !Engine.jobEvents(job.id)) write({ stage: "job", phase: ["done", "ready"].includes(current.status) ? "done" : "failed", payload: current.result || { message: current.error, code: current.error_code }, ts: Date.now() });
        const hb = setInterval(() => res.write(": hb\n\n"), 15000);
        req.on("close", () => { clearInterval(hb); off(); });
        return;
      }
      const queuedAt = Date.parse(job.last_event_at || job.updated_at || job.created_at || "");
      const requestedAt = Date.parse(job.advance_requested_at || "");
      const advanceIsLeased = Number.isFinite(requestedAt) && Date.now() - requestedAt < JOB_ADVANCE_LEASE_MS;
      const livenessAt = Date.parse(job.last_heartbeat_at || job.stage_started_at || "");
      const workerLooksDead = job.status === "running"
        && (!Number.isFinite(livenessAt) || Date.now() - livenessAt > JOB_ADVANCE_LEASE_MS);
      const queuedNeedsKick = job.status === "queued" && !advanceIsLeased
        && (!Number.isFinite(queuedAt) || Date.now() - queuedAt > 30_000);
      if (job.staged && (queuedNeedsKick || workerLooksDead)) {
        // Keep status reads responsive; dispatch owns the signed background
        // handoff and the queue itself fences stale predecessors.
        const advanced = await Engine.dispatchDurableJobAdvance(job.id, baseUrl);
        console.log(
          "[ghost-status-dispatch]",
          job.id,
          `status=${job.status}`,
          `stage=${job.next_stage || job.current_stage || ""}`,
          `requested_at=${job.advance_requested_at || ""}`,
          `advanced=${advanced}`,
        );
      }
      return json(res, 200, {
        id: job.id,
        correlation_id: job.correlation_id || job.id,
        status: job.status,
        stage: job.current_stage || "queued",
        phase: job.current_phase || "waiting",
        retryable: job.retryable !== false,
        result: job.result ?? null,
        error: job.error ?? null,
        error_code: job.error_code ?? null,
      });
    }
    if (p === "/api/forge-from-template" && req.method === "POST") {
      const rl = U.rateLimit(`template:${U.ipOf(req)}`, { max: 6, windowMs: 3600_000 });
      if (!rl.ok) return json(res, 429, { error: "That's plenty of free previews for one hour — sign up to keep forging." });
      const body = await U.readJson(req);
      U.need(body, ["template_id", "name", "city", "state", "category"]);
      const library = templateLibrary();
      const tpl = TemplateLib.findTemplate(library, body.template_id);
      if (!tpl) return json(res, 404, { error: "template not found" });
      const { job, done } = Engine.startTryOn({
        family: tpl.hero_family,
        name: U.clampStr(body.name, 60),
        city: U.clampStr(body.city, 40),
        state: U.clampStr(body.state, 2).toUpperCase(),
        category: U.clampStr(body.category, 40),
        template: tpl,
      });
      const result = Engine.SERVERLESS ? await done : null;
      return json(res, result ? 200 : 202, { job_id: job.id, template_id: tpl.id, family: tpl.hero_family, preview: result?.preview || "", result });
    }
    if (p === "/api/templates/try" && req.method === "POST") {
      const rl = U.rateLimit(`try:${U.ipOf(req)}`, { max: 6, windowMs: 3600_000 });
      if (!rl.ok) return json(res, 429, { error: "That's plenty of free previews for one hour — sign up to keep forging." });
      const body = await U.readJson(req);
      U.need(body, ["family", "name", "city", "state", "category"]);
      if (!Engine.HERO_FAMILIES.some((f) => f.key === body.family)) return json(res, 400, { error: "unknown family" });
      const { job, done } = Engine.startTryOn({ family: body.family, name: U.clampStr(body.name, 60), city: U.clampStr(body.city, 40), state: U.clampStr(body.state, 2).toUpperCase(), category: U.clampStr(body.category, 30) });
      const result = Engine.SERVERLESS ? await done : null;
      return json(res, result ? 200 : 202, { job_id: job.id, preview: result?.preview || "", result });
    }
    if (p === "/api/try/prompt" && req.method === "POST") {
      const rl = U.rateLimit(`tryp:${U.ipOf(req)}`, { max: 6, windowMs: 3600_000 });
      if (!rl.ok) return json(res, 429, { error: "That's plenty of free previews for one hour — sign up to keep forging." });
      const body = await U.readJson(req);
      const prompt = U.clampStr(body.prompt, 400);
      const website = (body.website_url && U.isUrl(body.website_url)) ? body.website_url : ((body.website && U.isUrl(body.website)) ? body.website : null);
      if ((!prompt || prompt.trim().length < 3) && !website) return json(res, 400, { error: "Tell us about your business, or paste your website." });
      const { job, done } = Engine.startForgeFromText({ text: prompt, website });
      const result = Engine.SERVERLESS ? await done : null;
      return json(res, result ? 200 : (Engine.SERVERLESS ? 422 : 202), { job_id: job.id, preview: result?.preview || "", result, status: result ? "ready" : (Engine.SERVERLESS ? "blocked" : "queued") });
    }
    if (p === "/api/e8-version" && req.method === "GET") {
      const probe = (await import("./lib/intake-genie.mjs")).compileFromInput ? "wave2-2026-07-11" : "unknown";
      return json(res, 200, { version: probe, marker: "e8-clean-services" });
    }
    if (p === "/api/try/intake" && req.method === "POST") {
      const rl = U.rateLimit(`intake:${U.ipOf(req)}`, { max: 6, windowMs: 3600_000 });
      if (!rl.ok) return json(res, 429, { error: "That's plenty of free previews for one hour — sign up to keep building." });
      let body = {};
      if ((req.headers["content-type"] || "").includes("multipart/form-data")) {
        const Media = await import("./lib/media-engine.mjs");
        const parts = await Media.readMultipart(req);
        body = { ...parts.fields, upload_count: parts.files.length, _files: parts.files };
      } else {
        body = await U.readJson(req);
      }
      const result = await IntakeGenie.compileFromInput({ ...body, build_preview: true, dry_run: true }, { awaitPreview: false });
      if (result.preview?.job_id) await Engine.persistJobState(result.preview.job_id);
      if (result.preview?.job_id) await Engine.dispatchDurableJobAdvance(result.preview.job_id, baseUrl);
      return json(res, result.ok === false ? 422 : 202, result);
    }
    if (p === "/api/intake-genie/compile" && req.method === "POST") {
      const auth = IntakeGenie.requireMachineAuth(req);
      if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
      const body = await U.readJson(req);
      const result = await IntakeGenie.compileMachineRequest(req, body);
      // `result.status` is OVERLOADED: transport failures carry an HTTP number
      // (401/400/503) while compile outcomes carry a semantic string
      // ("blocked", "needs_input", "out_of_scope"). The old `result.status || 422`
      // only replaced FALSY values, so a truthy "blocked" (intake-genie.mjs:388,
      // :397, :478 — the ordinary "more business facts are needed" path) went
      // straight into res.writeHead() and threw ERR_HTTP_INVALID_STATUS_CODE.
      // Every genuinely-blocked compile therefore surfaced to Ghost as a 500,
      // indistinguishable from a crash, which is why Ghost stayed pinned to an
      // older Genie deployment. Only trust a real integer as the HTTP code.
      const compileHttpStatus = Number.isInteger(result.status) && result.status >= 100 && result.status <= 599
        ? result.status
        : 422;
      return json(res, result.ok === false ? compileHttpStatus : 200, result);
    }
    if (seg[0] === "api" && seg[1] === "ghost-agency" && seg[2] === "build-preview" && seg[3] && req.method === "GET") {
      preventStatusCaching(res);
      if (!ghostAgencyAuthorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
      let job = await Engine.getDurableJob(U.clampStr(seg[3], 200));
      if (!job) return json(res, 404, { ok: false, error: "job_not_found" });
      if (!new Set(["done", "blocked", "failed", "timed_out"]).has(job.status)) {
        // Ghost's request budget is intentionally short. Start the signed
        // recovery stage in the serverless background; the queue's own lease
        // selection prevents a predecessor heartbeat from reviving forever.
        await Engine.dispatchDurableJobAdvance(job.id, baseUrl);
        job = await Engine.getDurableJob(job.id) || job;
      }
      const contract = ghostBuildContractForJob({ baseUrl, job });
      if (contract.statusCode === 202) res.setHeader("Retry-After", "3");
      return json(res, contract.statusCode, contract.body);
    }
    if (p === "/api/ghost-agency/build-preview" && req.method === "POST") {
      if (!ghostAgencyAuthorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
      const body = await U.readJson(req);
      const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
      if (!isObject(body)
        || (body.prospect !== undefined && !isObject(body.prospect))
        || (body.job !== undefined && !isObject(body.job))
        || (body.packets !== undefined && !isObject(body.packets))
        || (body.packets?.truth !== undefined && !isObject(body.packets.truth))) {
        return json(res, 400, {
          ok: false,
          error: "Ghost build-preview body must be a JSON object.",
          error_code: "GHOST_PREVIEW_PAYLOAD_INVALID",
        });
      }
      const headerValue = (name) => {
        const value = req.headers[name];
        return String(Array.isArray(value) ? value[0] : value || "").trim();
      };
      const suppliedIdempotencyKey = headerValue("idempotency-key");
      const headerCorrelationId = headerValue("x-correlation-id") || headerValue("x-ghost-correlation-id");
      const bodyCorrelationId = String(body.correlation_id || body.job?.id || "").trim();
      if (headerCorrelationId && bodyCorrelationId && headerCorrelationId !== bodyCorrelationId) {
        return json(res, 400, {
          ok: false,
          error: "Ghost correlation ID does not match body.job.id.",
          error_code: "GHOST_PREVIEW_CORRELATION_ID_MISMATCH",
        });
      }
      const callerCorrelationId = headerCorrelationId || bodyCorrelationId;
      // Older Ghost deployments supplied only the stable body.job.id. Prefer
      // the standard header while keeping that exact value retry-compatible
      // during the zero-downtime rollout.
      const idempotencyKey = suppliedIdempotencyKey || bodyCorrelationId;
      if (!idempotencyKey) {
        return json(res, 400, {
          ok: false,
          error: "Idempotency-Key is required",
          error_code: "GHOST_PREVIEW_IDEMPOTENCY_KEY_REQUIRED",
        });
      }
      if (!callerCorrelationId) {
        return json(res, 400, {
          ok: false,
          error: "Ghost correlation ID is required",
          error_code: "GHOST_PREVIEW_CORRELATION_ID_REQUIRED",
        });
      }
      const prospect = body.prospect || {};
      const proposedJobId = U.id("job");
      const candidateJob = Engine.createJob("try", {
        correlation_id: callerCorrelationId,
        current_stage: "prestage",
        current_phase: "waiting",
        ghost_context: {
          correlation_id: callerCorrelationId,
          prospect,
          compiled: null,
          checkout_url: "",
        },
      }, proposedJobId);
      await Engine.persistJobState(candidateJob.id);
      let ghostClaim;
      try {
        ghostClaim = await ghostPreviewIdempotency.claim({
          idempotencyKey,
          correlationId: callerCorrelationId,
          jobId: candidateJob.id,
          payload: body,
        });
      } catch (error) {
        try {
          await persistGhostPreviewPrestageFailure({
            jobId: candidateJob.id,
            correlationId: callerCorrelationId,
            prospect,
            error: error?.message || "Ghost build-preview idempotency claim failed.",
            errorCode: error?.code || "ghost_preview_idempotency_claim_failed",
            status: error instanceof GhostPreviewIdempotencyError && error.status < 500 ? "blocked" : "failed",
          });
        } catch {}
        if (error instanceof GhostPreviewIdempotencyError) {
          return json(res, error.status || 400, {
            ok: false,
            error: error.message,
            error_code: error.code,
          });
        }
        throw error;
      }
      const correlationId = ghostClaim.correlationId;
      if (ghostClaim.replay) {
        await persistGhostPreviewPrestageFailure({
          jobId: candidateJob.id,
          correlationId: callerCorrelationId,
          prospect,
          error: `Superseded by durable Ghost build ${ghostClaim.jobId}.`,
          errorCode: "ghost_preview_idempotency_replay_superseded",
          status: "blocked",
        });
        const replayJob = await Engine.getDurableJob(ghostClaim.jobId);
        if (!replayJob) {
          const contract = queuedGhostBuildContract({
            baseUrl,
            job: { id: ghostClaim.jobId, correlation_id: correlationId },
            compiled: {},
            correlationId,
          });
          res.setHeader("Retry-After", "3");
          return json(res, contract.statusCode, contract.body);
        }
        if (new Set(["done", "blocked", "failed", "timed_out"]).has(replayJob.status)) {
          const contract = ghostBuildContractForJob({ baseUrl, job: replayJob });
          return json(res, contract.statusCode, contract.body);
        }
        const contract = queuedGhostBuildContract({
          baseUrl,
          job: replayJob,
          compiled: replayJob.ghost_context?.compiled || {},
          correlationId,
        });
        res.setHeader("Retry-After", "3");
        return json(res, contract.statusCode, contract.body);
      }
      let engineActivated = false;
      try {
      const truth = body.packets?.truth || {};
      const normalizeServices = (value) => (Array.isArray(value) ? value : (value ? [value] : []))
        .map((service) => typeof service === "string" ? service : service?.name || service?.label || service?.value || "")
        .map((service) => U.clampStr(service, 60))
        .filter(Boolean);
      const normalizeLatlng = (value) => {
        const candidate = Array.isArray(value)
          ? { lat: value[0], lng: value[1] }
          : typeof value === "string"
            ? { lat: value.split(",")[0], lng: value.split(",")[1] }
            : value;
        const lat = Number(candidate?.lat);
        const lng = Number(candidate?.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
          ? { lat, lng }
          : null;
      };
      const services = normalizeServices(resolveGhostInputHint({
        field: "services",
        prospectValue: prospect.services,
        priorCompiledValue: Array.isArray(truth.services) && truth.services.length
          ? truth.services
          : truth.intakeGenie?.facts?.services,
        truth,
        fallback: [],
      }));
      const name = resolveGhostInputHint({
        field: "name",
        prospectValue: prospect.business_name || prospect.businessName,
        priorCompiledValue: truth.intakeGenie?.facts?.name,
        truth,
        fallback: "Local Business",
      });
      const city = resolveGhostInputHint({
        field: "city",
        prospectValue: prospect.city,
        priorCompiledValue: truth.intakeGenie?.facts?.city,
        truth,
      });
      const state = resolveGhostInputHint({
        field: "state",
        prospectValue: prospect.state,
        priorCompiledValue: truth.intakeGenie?.facts?.state,
        truth,
      });
      const category = resolveGhostInputHint({
        field: "category",
        prospectValue: prospect.industry || prospect.category,
        priorCompiledValue: truth.intakeGenie?.facts?.category,
        truth,
        fallback: services[0] || "local service",
      });
      const address = resolveGhostInputHint({
        field: "address",
        prospectValue: prospect.address,
        priorCompiledValue: truth.intakeGenie?.facts?.address,
        truth,
      });
      const latlng = normalizeLatlng(resolveGhostInputHint({
        field: "latlng",
        prospectValue: prospect.latlng,
        priorCompiledValue: truth.latlng || truth.intakeGenie?.facts?.latlng,
        truth,
        fallback: null,
      }));
      const websiteUrl = resolveGhostInputHint({
        field: "website",
        prospectValue: prospect.current_website || prospect.currentWebsite || prospect.website,
        priorCompiledValue: truth.intakeGenie?.facts?.website,
        truth,
      });
      const gbpUrl = resolveGhostInputHint({
        field: "gbp_url",
        prospectValue: prospect.gbp_url || prospect.gbpUrl,
        priorCompiledValue: truth.intakeGenie?.facts?.gbp_url,
        truth,
      });
      const assetUrl = resolveGhostInputHint({
        field: "asset_url",
        prospectValue: prospect.asset_url || prospect.assetUrl,
        priorCompiledValue: truth.intakeGenie?.facts?.asset_url,
        truth,
      });
      let compiled;
      try {
        compiled = await ghostPreviewCompileFromInput({
          request_id: body.job?.id || prospect.prospect_id || prospect.id || "",
          name,
          city,
          state,
          category,
          address,
          website_url: websiteUrl,
          gbp_url: gbpUrl,
          asset_url: assetUrl,
          latlng,
          description: `${name} ${category} in ${[city, state].filter(Boolean).join(", ")}`,
          prospect_hints: { name, city, state, category, address, latlng },
          // This route owns the single durable V8 build below. Intake Genie only
          // compiles fresh source evidence here; starting its preview too would
          // create a second paid build for the same prospect.
          build_preview: false,
          dry_run: true,
        }, { awaitPreview: false });
      } catch (error) {
        const failedJob = await persistGhostPreviewPrestageFailure({
          jobId: ghostClaim.jobId,
          correlationId,
          prospect,
          error: error?.message || "Ghost build-preview compiler failed.",
          errorCode: error?.code || "ghost_preview_compile_failed",
          status: "failed",
        });
        const contract = ghostBuildContractForJob({ baseUrl, job: failedJob });
        return json(res, contract.statusCode, contract.body);
      }
      if (compiled.ok === false || compiled.status === "blocked" || compiled.status === "needs_input" || compiled.status === "out_of_scope") {
        const blockedJob = await persistGhostPreviewPrestageFailure({
          jobId: ghostClaim.jobId,
          correlationId,
          prospect,
          compiled,
          error: compiled.error || "Ghost build-preview compiler blocked the request.",
          errorCode: compiled.code || "ghost_preview_compile_blocked",
          status: "blocked",
        });
        const contract = ghostBuildContractForJob({ baseUrl, job: blockedJob });
        return json(res, contract.statusCode, contract.body);
      }
      const facts = compiled.facts || {};
      // Intake Genie may resolve a stale lead hint against an address on the
      // business's own supplied website. Use those compiled facts for render;
      // falling back to the original hint would silently re-introduce the bad
      // city after discovery had already corrected it.
      const buildName = resolveGhostTruthFact({ field: "name", compiledValue: facts.name, truth, fallback: "Local Business" });
      const buildCity = resolveGhostTruthFact({ field: "city", compiledValue: facts.city, truth });
      const buildState = resolveGhostTruthFact({ field: "state", compiledValue: facts.state, truth });
      const buildCategory = resolveGhostTruthFact({ field: "category", compiledValue: facts.category, truth, fallback: "local service" });
      const buildAddress = resolveGhostTruthFact({ field: "address", compiledValue: facts.address, truth });
      const buildLatlng = normalizeLatlng(resolveGhostTruthFact({ field: "latlng", compiledValue: facts.latlng, truth, fallback: null }));
      const buildServices = normalizeServices(resolveGhostTruthFact({ field: "services", compiledValue: facts.services, truth, fallback: [] }));
      const buildWebsite = resolveGhostTruthFact({ field: "website", compiledValue: facts.website, truth });
      const buildGbpUrl = resolveGhostTruthFact({ field: "gbp_url", compiledValue: facts.gbp_url, truth });
      const buildAssetUrl = resolveGhostTruthFact({ field: "asset_url", compiledValue: facts.asset_url, truth });
      const sourceFacts = {
        ...facts,
        name: buildName,
        city: buildCity,
        state: buildState,
        category: buildCategory,
        phone: resolveGhostTruthFact({ field: "phone", compiledValue: facts.phone, truth }),
        email: resolveGhostTruthFact({ field: "email", compiledValue: facts.email, truth }),
        address: buildAddress,
        latlng: buildLatlng,
        services: buildServices,
        website: buildWebsite,
        gbp_url: buildGbpUrl,
        asset_url: buildAssetUrl,
      };
      const ghostTruthAssets = Array.isArray(truth.intakeGenie?.assets) ? truth.intakeGenie.assets : [];
      const compiledAssets = recoverAuthenticatedGhostLogo(
        Array.isArray(compiled.assets) ? compiled.assets : [],
        ghostTruthAssets,
        {
          name: buildName,
          website: buildWebsite,
        },
      );
      // Owner locking chooses between independently verified facts; it must
      // never promote an arbitrary discovered logo into an authenticated
      // upload. Real owner uploads already carry that provenance through
      // sanitizeSourceAssets().
      const renderAssets = compiledAssets;
      // This is deliberately stricter than the source-intake convenience
      // bridge. A logo that cannot survive the canonical business-truth
      // contract must never reach V8, even when the authenticated caller sent
      // it as an already typed logo asset.
      const brandTruth = enforceBusinessTruth({
        business: { name: buildName, category: buildCategory, city: buildCity, state: buildState },
        services: sourceFacts.services,
        source_evidence: compiled.evidence || [],
        v7_logo: renderAssets.find((asset) => asset?.kind === "logo")
          ? { url: renderAssets.find((asset) => asset?.kind === "logo")?.url, origin: renderAssets.find((asset) => asset?.kind === "logo")?.origin }
          : undefined,
      }, { sourceFacts, sourceAssets: renderAssets });
      const verifiedLogoUrl = brandTruth.logo_source?.url || "";
      compiled.assets = renderAssets.filter((asset) => asset?.kind !== "logo" || asset.url === verifiedLogoUrl);
      const hasSourceLogo = Boolean(verifiedLogoUrl);
      const hasSourceMedia = compiled.assets.some((asset) => ["photo", "video"].includes(asset?.kind) && asset?.approved !== false && asset?.url);
      // No-website lane (Mark 2026-07-20): a business with no website is the
      // easiest sell (no competing site). For that lane ONLY, drop the scraped
      // "source logo" requirement — the renderer ships a proposed name wordmark
      // the business approves a real logo on at activation. Real GBP photos
      // (hasSourceMedia) and verified services stay HARD-required, so an empty
      // no-media GBP still 422s. Any prospect WITH a website is unaffected.
      const noWebsiteLane = !String(buildWebsite || "").trim();
      const evidenceMissing = [
        !sourceFacts.services.length ? "verified services" : "",
        (!noWebsiteLane && !hasSourceLogo) ? "source logo" : "",
        !hasSourceMedia ? "source photo or video" : "",
      ].filter(Boolean);
      if (evidenceMissing.length) {
        const blockedJob = await persistGhostPreviewPrestageFailure({
          jobId: ghostClaim.jobId,
          correlationId,
          prospect,
          compiled,
          error: `Preview held: missing ${evidenceMissing.join(", ")}.`,
          errorCode: "source_evidence_incomplete",
          status: "blocked",
        });
        const contract = ghostBuildContractForJob({ baseUrl, job: blockedJob });
        return json(res, contract.statusCode, {
          ...contract.body,
          missing: evidenceMissing,
        });
      }
      // Merge Ghost-generated media (the AI-ambiance Veo hero) AFTER the
      // truthfulness gate, so a generated clip can never satisfy the real-source
      // -media requirement above. The renderer's selector still prefers any real
      // source video over ambiance, so a business's own footage always wins.
      const injectedMedia = Array.isArray(body.injected_media) ? body.injected_media : [];
      if (injectedMedia.length) {
        const safeInjected = injectedMedia.filter((asset) =>
          asset && typeof asset === "object" && asset.kind === "video"
          && typeof asset.url === "string" && /^https:\/\//i.test(asset.url)
          && (asset.source === "ai-ambiance" || /ambiance/i.test(String(asset.role || ""))));
        if (safeInjected.length) compiled.assets = [...compiled.assets, ...safeInjected];
      }
      const intake = {
        businessName: buildName,
        industry: buildCategory,
        city: buildCity,
        state: buildState,
        address: sourceFacts.address || "",
        latlng: sourceFacts.latlng || null,
        phone: sourceFacts.phone || "",
        ownerEmail: sourceFacts.email || "",
        currentWebsite: buildWebsite,
        services: sourceFacts.services.join(", "),
      };
      const checkoutUrl = String(
        prospect.purchase_url ||
        prospect.purchaseUrl ||
        prospect.checkout_url ||
        prospect.checkoutUrl ||
        body.purchase_url ||
        body.purchaseUrl ||
        body.checkout_url ||
        body.checkoutUrl ||
        "",
      ).trim();
      const previewExpiresAt = String(
        prospect.preview_expires_at ||
        prospect.previewExpiresAt ||
        body.preview_expires_at ||
        body.previewExpiresAt ||
        "",
      ).trim();
      const compiledEnvelope = {
        ...(truth.intakeGenie || {}),
        ...compiled,
        facts: sourceFacts,
        evidence: compiled.evidence || truth.intakeGenie?.evidence || [],
        assets: compiled.assets || [],
        discovery: compiled.discovery || facts.discovery || truth.intakeGenie?.discovery || truth.discovery || {},
        brand: compiled.brand || compiled.branding || facts.branding || truth.intakeGenie?.brand || truth.brand || {},
        fonts: compiled.fonts || compiled.branding?.fonts || facts.branding?.fonts || truth.intakeGenie?.fonts || truth.fonts || [],
        asset_provenance: (compiled.assets || []).map((asset) => ({
          url: asset?.url || "",
          kind: asset?.kind || "",
          source: asset?.source || "",
          origin: asset?.origin || "",
          approved: asset?.approved !== false,
          meta: asset?.meta || {},
          provenance: asset?.provenance || null,
        })),
      };
      const buildInput = {
        family: IntakeGenie.familyForBusiness(sourceFacts),
        name: buildName,
        city: buildCity,
        state: buildState,
        category: buildCategory,
        compositionSlot: prospect.composition_slot ?? prospect.compositionSlot ?? body.composition_slot ?? body.compositionSlot ?? null,
        source: {
          input: { sources: compiledEnvelope.sources || truth.sources || {} },
          intake,
          facts: sourceFacts,
          evidence: compiledEnvelope.evidence,
          assets: compiledEnvelope.assets,
          discovery: compiledEnvelope.discovery,
          brand: compiledEnvelope.brand,
          fonts: compiledEnvelope.fonts,
          asset_provenance: compiledEnvelope.asset_provenance,
          compiled: compiledEnvelope,
          launch: {
            purchase_url: checkoutUrl,
            agent_phone: String(process.env.SITEFORGE_AGENT_PHONE || "").trim(),
            expires_at: previewExpiresAt,
          },
        },
      };
      const ghostContext = {
        correlation_id: correlationId,
        prospect,
        compiled: compiledEnvelope,
        checkout_url: checkoutUrl,
      };
      const engineBuildInput = {
        ...buildInput,
        jobId: ghostClaim.jobId,
        correlationId,
        ghostContext,
        adoptExistingJob: true,
      };

      if (Engine.SERVERLESS) {
        let job;
        try {
          ({ job } = await Engine.startTryOnStaged(engineBuildInput));
          engineActivated = true;
        } catch (error) {
          const failedJob = await persistGhostPreviewPrestageFailure({
            jobId: ghostClaim.jobId,
            correlationId,
            prospect,
            compiled: compiledEnvelope,
            checkoutUrl,
            error: error?.message || "Ghost staged build failed before render.",
            errorCode: error?.code || "ghost_preview_stage_failed",
            status: "failed",
          });
          const contract = ghostBuildContractForJob({ baseUrl, job: failedJob });
          return json(res, contract.statusCode, contract.body);
        }
        await Engine.dispatchDurableJobAdvance(job.id, baseUrl);
        const contract = queuedGhostBuildContract({
          baseUrl,
          job,
          compiled: compiledEnvelope,
          correlationId,
        });
        res.setHeader("Retry-After", "3");
        return json(res, contract.statusCode, contract.body);
      }

      let job;
      let done;
      try {
        ({ job, done } = Engine.startTryOn(engineBuildInput));
        engineActivated = true;
      } catch (error) {
        const failedJob = await persistGhostPreviewPrestageFailure({
            jobId: ghostClaim.jobId,
            correlationId,
            prospect,
            compiled: compiledEnvelope,
          checkoutUrl,
          error: error?.message || "Ghost build failed before render.",
          errorCode: error?.code || "ghost_preview_start_failed",
          status: "failed",
        });
        const contract = ghostBuildContractForJob({ baseUrl, job: failedJob });
        return json(res, contract.statusCode, contract.body);
      }
      let built;
      try {
        built = await done;
      } catch (err) {
        const failedJob = DB.get("jobs", job.id) || {
          ...job,
          status: "failed",
          error: err.message || "WSS Launch build failed.",
          error_code: err.code || "generation_failed",
        };
        const contract = ghostBuildContractForJob({ baseUrl, job: failedJob });
        return json(res, contract.statusCode, contract.body);
      }
      if (!built?.preview) {
        const failedJob = DB.get("jobs", job.id);
        const contract = ghostBuildContractForJob({
          baseUrl,
          job: failedJob || {
            ...job,
            status: "failed",
            error: "preview_url_missing",
            error_code: "preview_url_missing",
          },
        });
        return json(res, contract.statusCode, contract.body);
      }
      const contract = ghostBuildContractForJob({
        baseUrl,
        job: {
          ...job,
          status: "done",
          result: built,
          correlation_id: correlationId,
          ghost_context: DB.get("jobs", job.id)?.ghost_context || ghostContext,
        },
      });
      return json(res, contract.statusCode, contract.body);
      } catch (error) {
        const currentJob = DB.get("jobs", ghostClaim.jobId);
        const terminal = new Set(["done", "blocked", "failed", "timed_out"]).has(currentJob?.status);
        if (!engineActivated && !terminal) {
          const failedJob = await persistGhostPreviewPrestageFailure({
            jobId: ghostClaim.jobId,
            correlationId,
            prospect,
            error: error?.message || "Ghost build-preview failed before render.",
            errorCode: error?.code || "ghost_preview_prestage_failed",
            status: "failed",
          });
          const contract = ghostBuildContractForJob({ baseUrl, job: failedJob });
          return json(res, contract.statusCode, contract.body);
        }
        if (!engineActivated && currentJob) {
          const contract = ghostBuildContractForJob({ baseUrl, job: currentJob });
          return json(res, contract.statusCode, contract.body);
        }
        throw error;
      }
    }
    if (p === "/api/checkout" && req.method === "POST") {
      const u = Auth.currentUser(req);
      const body = await U.readForm(req);
      if (!u) return redirect(res, "/login");
      if (body.kind === "plan" && body.key === "free") return redirect(res, "/dashboard");
      const { url: checkoutUrl } = await Billing.createCheckout({ user: u, kind: U.clampStr(body.kind, 12), key: U.clampStr(body.key, 40), baseUrl });
      return redirect(res, checkoutUrl);
    }

    // ----- billing pages + webhook -----
    if (p === "/billing/mock-checkout" && req.method === "GET") {
      const u = requireUser(req, res); if (!u) return;
      const intent = Billing.mockCheckoutIntent(url.searchParams.get("ref"), url.searchParams.get("t"));
      if (!intent) return notFound(res, u);
      return send(res, 200, App.mockCheckoutPage({ item: intent.item, refId: intent.co.id, t: url.searchParams.get("t"), csrf: Auth.csrfOf(req) }));
    }
    if (p === "/billing/mock-confirm" && req.method === "POST") {
      const u = requireUser(req, res); if (!u) return;
      const body = await formGuard(req, res, u); if (!body) return;
      const intent = Billing.mockCheckoutIntent(body.ref, body.t);
      if (!intent || intent.co.user_id !== u.id) return notFound(res, u);
      const granted = Billing.grantPurchase(body.ref, { mode: "mock" });
      return send(res, 200, App.billingSuccessPage({ user: u, granted }));
    }
    if (p === "/billing/portal" && req.method === "GET") {
      const u = requireUser(req, res); if (!u) return;
      const { url: portalUrl } = await Billing.createBillingPortal({ user: u, baseUrl });
      return redirect(res, portalUrl);
    }
    if (p === "/billing/success" && req.method === "GET") {
      const u = requireUser(req, res); if (!u) return;
      const co = DB.get("webhook_events", url.searchParams.get("ref"));
      return send(res, 200, App.billingSuccessPage({ user: u, granted: co?.status === "granted" ? co : null }));
    }
    if (p === "/api/webhooks/stripe" && req.method === "POST") {
      const raw = (await U.readBody(req)).toString("utf8");
      const check = Billing.verifyStripeSignature(raw, req.headers["stripe-signature"]);
      if (!check.ok) return json(res, 400, { error: `signature: ${check.reason}` });
      const event = JSON.parse(raw);
      const dup = DB.find("webhook_events", (w) => w.stripe_event_id === event.id);
      if (!dup) { DB.insert("webhook_events", { kind: "stripe_event", stripe_event_id: event.id, type: event.type }); Billing.handleStripeEvent(event); }
      return json(res, 200, { received: true });
    }

    return notFound(res, user);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[siteforge] ${req.method} ${p} \u2192`, err);
    if ((req.headers.accept || "").includes("application/json") || p.startsWith("/api/")) return json(res, status, {
      error: err.message,
      ...(err instanceof ContractBuildError || err.code ? { error_code: err.code } : {}),
      ...(Array.isArray(err.details) ? { details: err.details } : {}),
    });
    return send(res, status, errorPage(status, err.message, user));
  }
};
const server = http.createServer(handle);

if (process.env.SITEFORGE_NO_LISTEN !== "1") {
  server.listen(PORT, () => {
    console.log(`\n  \u2302 SiteForge running \u2192 http://localhost:${PORT}`);
  });
}
export { server };
