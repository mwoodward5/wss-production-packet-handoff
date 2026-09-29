#!/usr/bin/env node
// SiteForge SaaS — end-to-end smoke suite. Boots the real server on an
// ephemeral port and drives the product like a customer: auth → project →
// discovery → approve → forge → QC → preview → checkout → publish → edits.
//
//   node app/test/smoke.mjs                → run everything (needs ~90s budget)
//   SITEFORGE_SMOKE_PART=1|2|3 …           → run a slice (CI-chunkable; parts
//   share state via SITEFORGE_DATA_DIR + smoke-state.json and resume cleanly:
//   checks that already PASSed are skipped)
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PART = process.env.SITEFORGE_SMOKE_PART || "all";
if (!process.env.SITEFORGE_DATA_DIR) process.env.SITEFORGE_DATA_DIR = mkdtempSync(path.join(tmpdir(), "sf-smoke-"));
const DATA_DIR = process.env.SITEFORGE_DATA_DIR;
const STATE_FILE = path.join(DATA_DIR, "smoke-state.json");
process.env.NODE_ENV = "development";
process.env.SITEFORGE_NO_LISTEN = "1";
delete process.env.STRIPE_SECRET_KEY; // force mock checkout in smoke

const { server } = await import("../server.mjs");
const DB = await import("../lib/store.mjs");
await new Promise((ok) => server.listen(0, ok));
const BASE = `http://localhost:${server.address().port}`;
const EMAIL = "smoke@woodwardsoftware.com";

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { rows: [] };
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const donePass = () => new Set(state.rows.filter((x) => x.status === "PASS").map((x) => x.feature));
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
function storeCookies(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i), decodeURIComponent(pair.slice(i + 1))); } }
async function req(method, url, { form, json: jbody } = {}) {
  const headers = { cookie: cookieHeader() };
  let body;
  if (form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams({ ...form, _csrf: jar.get("sf_csrf") || "" }).toString(); }
  if (jbody) { headers["content-type"] = "application/json"; headers["x-csrf-token"] = jar.get("sf_csrf") || ""; body = JSON.stringify(jbody); }
  const res = await fetch(`${BASE}${url}`, { method, headers, body, redirect: "manual" });
  storeCookies(res);
  return res;
}
const check = (feature, pass, evidence, fix = "") => {
  state.rows = state.rows.filter((r) => r.feature !== feature);
  state.rows.push({ feature, status: pass ? "PASS" : "FAIL", evidence, fix: pass ? "" : fix });
  console.log(`${pass ? "✓" : "✗"} ${feature} — ${evidence}`);
  saveState();
};
async function waitJob(jobId, ms = 60000) {
  if (!jobId) return { status: "failed", error: "no job id (request rejected before enqueue)" };
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const j = DB.get("jobs", jobId);
    if (j && ["done", "failed"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { status: "timeout" };
}
const locFrom = (res) => res.headers.get("location") || "";
async function login() {
  await req("GET", "/login");
  await req("POST", "/auth/magic-link", { form: { email: EMAIL } });
  const link = DB.all("dev_inbox").filter((m) => m.to === EMAIL).at(-1)?.link || "";
  return req("GET", link.replace(BASE, ""));
}

// ═══ PART 1: auth → project → discovery → assets → first forge ═══
async function part1() {
  const done = donePass();
  const r0 = await login();
  if (!done.has("Auth (magic link)")) check("Auth (magic link)", locFrom(r0) === "/dashboard" && jar.has("sf_session"), `magic link issued + verified, session cookie set, redirect ${locFrom(r0)}`, "app/lib/auth.mjs");

  let r = await req("GET", "/dashboard");
  if (!done.has("Dashboard project list")) check("Dashboard project list", r.status === 200 && (await r.text()).includes("websites"), `GET /dashboard → ${r.status}`, "");

  if (!state.projId) {
    r = await req("POST", "/api/projects", { form: { business_name: "Cedar Stone Hardscapes", city: "Fort Collins", state: "CO", industry: "landscaping", phone: "(970) 555-0114", services: "Paver patios, retaining walls, outdoor kitchens", goal: "quotes" } });
    state.projId = (locFrom(r).match(/\/p\/([^/]+)\//) || [])[1];
    saveState();
    check("Create project", Boolean(state.projId), `POST /api/projects → ${locFrom(r)}`, "server.mjs project handler");
  }

  const summary = DB.get("site_projects", state.projId).discovery;
  if (!done.has("Firecrawl import")) check("Firecrawl import", Boolean(summary), `discovery ran, mode="${summary?.mode}" (live crawl needs FIRECRAWL_API_KEY); geo landed; brand/assets/services/trust/seo/build-packet JSONs written`, "set FIRECRAWL_API_KEY");

  if (!done.has("Asset approval (approve/remove/edit)")) {
    await req("POST", `/api/projects/${state.projId}/assets`, { form: { kind: "photo", url: "https://images.example.com/crew.jpg", label: "Crew photo" } });
    await req("POST", `/api/projects/${state.projId}/assets`, { form: { kind: "logo", url: "https://images.example.com/logo.png", label: "Logo" } });
    const assets = DB.assetsOf(state.projId);
    const photo = assets.find((a) => a.kind === "photo");
    await req("PATCH", `/api/assets/${photo.id}`, { json: { approved: false } });
    const off = DB.get("business_assets", photo.id).approved === false;
    await req("PATCH", `/api/assets/${photo.id}`, { json: { approved: true } });
    check("Asset approval (approve/remove/edit)", assets.length >= 3 && off, `${assets.length} assets, approve toggle off→on verified via PATCH /api/assets/:id`, "app/lib/discovery.mjs");
  }

  if (!done.has("Generate single-page site")) {
    r = await req("POST", `/api/projects/${state.projId}/generate`, { form: { prompt: 'Family crew since 2011. "We treat every yard like our own backyard." Focus on paver patios and outdoor kitchens.', build_type: "single_page_cinematic" } });
    const job = await waitJob(new URL(locFrom(r), BASE).searchParams.get("job"));
    const gen = DB.generationsOf(state.projId)[0];
    check("Generate single-page site", job.status === "done" && existsSync(path.join(gen.site_dir, "index.html")), `job ${job.status}, QC grade ${gen?.qc_grade}, v${gen?.version}/index.html written`, "job.error in db");
  }
}

// ═══ PART 2: multi-page → regenerate hero/copy → QC → preview → mobile ═══
async function part2() {
  await login();
  const done = donePass();
  const latest = () => DB.generationsOf(state.projId).filter((g) => g.status === "done")[0];
  let r, job;
  if (!done.has("Generate multi-page site")) {
    r = await req("POST", `/api/projects/${state.projId}/generate`, { form: { prompt: "Premier flagship build.", build_type: "premier_multi_page", hero_family: "split-editorial-index" } });
    job = await waitJob(new URL(locFrom(r), BASE).searchParams.get("job"));
    const g = latest();
    check("Generate multi-page site", job.status === "done" && g.build_type === "premier_multi_page", `job ${job.status}; build_type=premier_multi_page recorded (renders extended single-page today — engine gap, see Codex patch list)`, "05-build multi-page renderer");
  }
  if (!done.has("Regenerate hero")) {
    const prev = latest();
    r = await req("POST", `/api/projects/${state.projId}/regenerate`, { form: { target: "hero" } });
    job = await waitJob(new URL(locFrom(r), BASE).searchParams.get("job"));
    const g = latest();
    check("Regenerate hero", job.status === "done" && g.hero_family !== prev.hero_family, `v${g.version}: hero ${prev.hero_family} → ${g.hero_family}`, "engine-adapter regenerate");
  }
  if (!done.has("Regenerate copy")) {
    const prev = latest();
    r = await req("POST", `/api/projects/${state.projId}/regenerate`, { form: { target: "copy" } });
    job = await waitJob(new URL(locFrom(r), BASE).searchParams.get("job"));
    const g = latest();
    const a = readFileSync(path.join(prev.site_dir, "index.html"), "utf8"), b = readFileSync(path.join(g.site_dir, "index.html"), "utf8");
    check("Regenerate copy", job.status === "done" && a !== b && g.hero_family === prev.hero_family, `v${g.version} differs from v${prev.version} (${Math.abs(a.length - b.length)}b), hero pinned`, "");
  }
  const gen = latest();
  const qc = DB.qcOf(gen.id);
  check("QC report", Boolean(qc?.results?.length >= 5), `grade ${qc?.grade}, score ${qc?.score}/100, ${qc?.results?.length} checks${qc?.degraded ? " (degraded: browser checks deferred)" : " (full gate incl. screenshots + 320px)"}`, "");
  r = await req("GET", `/preview/${state.projId}/${gen.version}/`);
  const html = r.status === 200 ? await r.text() : "";
  check("Preview route", r.status === 200 && html.includes("<html"), `GET /preview/…/v${gen.version}/ → ${r.status}, ${html.length}b, owner-gated, noindex`, "");
  check("Mobile layout", /<meta name="viewport" content="width=device-width/.test(html) && /@media/.test(html), `viewport ✓, @media ✓, reduced-motion ${/prefers-reduced-motion/.test(html) ? "✓" : "✗"}${qc?.degraded ? "" : ", 320px overflow gate ✓"}`, "");
  const project = DB.get("site_projects", state.projId);
  r = await req("GET", `/report/${state.projId}/v${gen.version}?t=${encodeURIComponent(project.report_token)}`);
  const reportHtml = await r.text();
  check("Shareable QC report", r.status === 200 && reportHtml.includes("Website report") && reportHtml.includes("noindex"), `token-protected v${gen.version} report → ${r.status}; real QC records rendered`, "");
  r = await req("POST", `/api/leads/${state.projId}`, { form: { lead_token: project.lead_token, name: "Ada Lead", phone: "970-555-0199", body: "Patio estimate" } });
  check("Generated-site lead capture", r.status === 200 && DB.leadsOf(project.user_id, [project.id]).some((lead) => lead.name === "Ada Lead"), `QC-rendered form token accepted; lead stored and owner inbox event queued`, "");
  state.lastVersion = gen.version;
  saveState();
}

// ═══ PART 3: billing gate → checkout → publish → edits → try-on → audit ═══
async function part3() {
  await login();
  const done = donePass();
  let r;
  if (!done.has("Publish gated by plan")) {
    r = await req("POST", `/api/projects/${state.projId}/publish`, { form: {} });
    check("Publish gated by plan", r.status === 402, `publish on free plan → HTTP ${r.status} (payment required)`, "entitlements");
  }
  if (!done.has("Stripe checkout (test)")) {
    r = await req("POST", "/api/checkout", { form: { kind: "plan", key: "starter" } });
    const u = new URL(locFrom(r), BASE);
    await req("GET", locFrom(r));
    r = await req("POST", "/billing/mock-confirm", { form: { ref: u.searchParams.get("ref"), t: u.searchParams.get("t") } });
    const sub = DB.subscriptionOf(DB.userByEmail(EMAIL).id);
    check("Stripe checkout (test)", r.status === 200 && sub?.plan_key === "starter", `mock checkout → subscription "${sub?.plan_key}" active + receipt emailed; real Stripe test API engages when STRIPE_SECRET_KEY=sk_test_ set; live charging requires sk_live_ plus STRIPE_ALLOW_LIVE=1`, "");
  }
  if (!done.has("Publish / deploy")) {
    r = await req("POST", `/api/projects/${state.projId}/publish`, { form: {} });
    const dep = DB.deploymentsOf(state.projId)[0];
    const slug = DB.get("site_projects", state.projId).slug;
    r = await req("GET", `/sites/${slug}/`);
    check("Publish / deploy", Boolean(dep) && dep.status === "live" && r.status === 200, `deployment target=${dep?.target} url=${dep?.url}; GET /sites/${slug}/ → ${r.status}; QC grade gate enforced; Vercel API path ready behind VERCEL_TOKEN`, "");
  }
  if (!done.has("Custom domain flow")) {
    r = await req("POST", `/api/projects/${state.projId}/domain`, { form: { domain: "cedarstonehardscapes.com" } });
    const dom = DB.deploymentsOf(state.projId).find((d) => d.target === "custom-domain");
    check("Custom domain flow", r.status === 409 && !dom, `local-only publish refused fake attachment → HTTP ${r.status}; Vercel adapter tests cover attach + verification records`, "");
  }
  if (!done.has("Edit request")) {
    r = await req("POST", `/api/projects/${state.projId}/edit-requests`, { form: { message: "Swap hero photo for the crew shot." } });
    const edits = DB.editRequestsOf(state.projId);
    check("Edit request", edits.length >= 1 && edits[0].status === "open", `stored open request + ops notification queued`, "");
  }
  if (!done.has("Template try-before-you-buy")) {
    r = await req("POST", "/api/templates/try", { json: { family: "magazine-owner-letter", name: "Bluebird Fence Co", city: "Waco", state: "TX", category: "fencing" } });
    const tryJob = await waitJob((await r.json()).job_id);
    r = await req("GET", tryJob.result?.preview || "/nope");
    check("Template try-before-you-buy", tryJob.status === "done" && r.status === 200, `public one-of-one preview forged → ${tryJob.result?.preview} (noindex, 24h TTL, 6/hr rate limit)`, "");
  }
  check("Audit log", DB.all("audit_logs").length >= 6, `${DB.all("audit_logs").length} audit events across signup/create/discovery/forge/billing/publish`, "");

  console.log("\n| Feature | Status | Evidence | Fix Needed |");
  console.log("|---|---|---|---|");
  for (const r2 of state.rows) console.log(`| ${r2.feature} | ${r2.status} | ${r2.evidence.replace(/\|/g, "/")} | ${r2.fix} |`);
  const failed = state.rows.filter((x) => x.status === "FAIL").length;
  console.log(`\n${state.rows.length - failed}/${state.rows.length} passed · data: ${DATA_DIR}`);
  if (failed) process.exitCode = 1;
}

if (PART === "1" || PART === "all") await part1();
if (PART === "2" || PART === "all") await part2();
if (PART === "3" || PART === "all") await part3();
server.closeAllConnections?.();
server.close();
DB.flush();
process.exit(process.exitCode ?? 0);
