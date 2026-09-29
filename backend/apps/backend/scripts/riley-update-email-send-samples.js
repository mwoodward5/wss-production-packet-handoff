"use strict";

// scripts/riley-update-email-send-samples.js — compose, VERIFY, and (with
// --send) deliver real Riley owner-update samples to the owner's own mailbox.
//
// This is the proof lane for the samples surface: before anything is sent,
// every claim in the composed email is re-verified against the durable record
// it came from, every link is fetched (must be 200 and the right page), and
// every image must come back as real bytes. A sample that fails ANY check is
// refused — the failing claim is never softened, the email is simply not sent.
//
//   node scripts/riley-update-email-send-samples.js <slug> [<slug>...]
//        [--hours 24] [--send] [--out-dir <dir>] [--prefix "<subject prefix>"]
//
//   default        verify-only: compose each sample, run all checks, write the
//                  HTML to --out-dir, print one JSON report
//   --send         after ALL checks pass for a slug, send it via Resend to the
//                  locked owner recipient with the subject prefix
//   --prefix       subject prefix (default "[SAMPLE — Riley update]")
//
// TRUTH LAW, applied to the checks themselves:
//   · claim rows in BOTH MIME halves must equal the change-log entry count
//   · each entry's durable record is re-read from the store and must still
//     support the claim's kind and timestamp (status-to-kind maps below are
//     the same maps lib/site-change-log.js encodes)
//   · a *.wss-ai.com proof link is "the right page" only when the served app
//     actually carries this business's name (SPA shells keep the head generic
//     on purpose, so the name is looked for in the page AND its JS bundles)
//   · the recipient is the module's own lock; this script cannot widen it.

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const { loadEnv } = require("./brightdata-edit-proof/env");
const { sendRileyUpdateEmail, RILEY_UPDATE_RECIPIENT } = require("../lib/riley-update-email");
const { siteChangeLog, slugOfPreviewUrl } = require("../lib/site-change-log");
const { rileyVoiceLine } = require("../lib/riley-update-email");
const { resolveRileyLine } = require("../lib/riley-line");

const DEFAULT_PREFIX = "[SAMPLE — Riley update]";
const FETCH_TIMEOUT_MS = 20000;

// Status-to-kind maps — the SAME truth surface lib/site-change-log.js encodes,
// restated here so a drift in either place fails verification loudly.
const EDIT_STATUS_KIND = Object.freeze({
  done: "edit_done",
  refused: "edit_refused",
  failed: "edit_failed",
  queued: "edit_in_progress",
  running: "edit_in_progress",
});
const HISTORY_STATUS_KIND = Object.freeze({
  mirrored: "rebuild",
  gate_passed: "checks_passed",
  queued: "preview_published",
  sent: "update_emailed",
  gate_failed: "rebuild_held",
  error: "rebuild_incomplete",
});

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function collapse(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function rowsOf(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result && result.data)) return result.data;
  if (Array.isArray(result && result.rows)) return result.rows;
  return null; // a failed read is NOT an empty list
}

async function fetchWithTimeout(url) {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return fetch(url, { signal, redirect: "follow" });
}

/** Every href/src in an HTML string, deduped, in order of first appearance. */
function extractUrls(html, attribute) {
  const pattern = new RegExp(`${attribute}="([^"]+)"`, "g");
  const seen = new Set();
  const urls = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const url = match[1].replace(/&amp;/g, "&");
    if (!seen.has(url)) { seen.add(url); urls.push(url); }
  }
  return urls;
}

/** Case-insensitive "does this page serve THIS business" name variants. */
function nameVariants(businessName) {
  const name = collapse(businessName);
  if (!name) return [];
  const variants = new Set([name, name.replace(/&/g, "&amp;"), name.replace(/&/g, "\\u0026")]);
  const words = name.split(" ").filter(Boolean);
  if (words.length >= 2) variants.add(words.slice(0, 2).join(" "));
  return [...variants].map((variant) => variant.toLowerCase());
}

/**
 * A *.wss-ai.com proof link is the right page when the served app carries the
 * business name — in the HTML itself, or baked into one of its JS bundles
 * (the SPA head is deliberately generic; business.ts rides in the bundle).
 */
async function verifySitePage(url, businessName) {
  const response = await fetchWithTimeout(url);
  if (response.status !== 200) return { ok: false, status: response.status, reason: "not_200" };
  const html = await response.text();
  const variants = nameVariants(businessName);
  if (!variants.length) return { ok: false, status: 200, reason: "no_business_name_to_check" };
  const pageLower = html.toLowerCase();
  if (variants.some((variant) => pageLower.includes(variant))) {
    return { ok: true, status: 200, namedIn: "page" };
  }
  const origin = new URL(url).origin;
  const bundles = extractUrls(html, "src").filter((src) => /\/assets\/[^"]+\.js$/.test(src));
  for (const src of bundles.slice(0, 4)) {
    const bundleUrl = src.startsWith("http") ? src : origin + src;
    const bundle = await fetchWithTimeout(bundleUrl);
    if (bundle.status !== 200) continue;
    const body = (await bundle.text()).toLowerCase();
    if (variants.some((variant) => body.includes(variant))) {
      return { ok: true, status: 200, namedIn: path.posix.basename(new URL(bundleUrl).pathname) };
    }
  }
  return { ok: false, status: 200, reason: "business_name_not_found_in_page_or_bundles" };
}

// ---------------------------------------------------------------------------
// per-entry record re-verification — read the record the entry names, again
// ---------------------------------------------------------------------------

async function verifyEntryRecord(entry, { slug, sinceIso, select }) {
  const source = entry.source || {};
  const table = String(source.table || "");
  const atMs = Date.parse(entry.at);

  if (table === "ghost_agency_edit_jobs") {
    const rows = rowsOf(await select(
      "ghost_agency_edit_jobs",
      `select=job_id,site_slug,status,instruction,result,created_at,updated_at&job_id=eq.${encodeURIComponent(source.job_id)}`,
    ).catch(() => null));
    const row = rows && rows[0];
    if (!row) return { ok: false, reason: "edit_job_row_missing" };
    if (String(row.site_slug) !== slug) return { ok: false, reason: "edit_job_wrong_site" };
    const expectedKind = EDIT_STATUS_KIND[String(row.status || "").toLowerCase()];
    if (expectedKind !== entry.kind) return { ok: false, reason: `status_${row.status}_does_not_support_${entry.kind}` };
    const terminal = Date.parse(row.updated_at || row.created_at);
    const open = Date.parse(row.created_at || row.updated_at);
    if (atMs !== terminal && atMs !== open) return { ok: false, reason: "timestamp_not_the_records_own" };
    return { ok: true, record: `edit_job ${row.job_id} status=${row.status}` };
  }

  if (table === "ghost_agency_events" && String(source.type || "") === "line.batch") {
    const snapshots = rowsOf(await select(
      "ghost_agency_events",
      `select=id,created_at,payload&type=eq.line.batch&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=400`,
    ).catch(() => null));
    if (!snapshots) return { ok: false, reason: "line_batch_read_failed" };
    const expectedStatus = Object.entries(HISTORY_STATUS_KIND).find(([, kind]) => kind === entry.kind)?.[0];
    if (!expectedStatus) return { ok: false, reason: `no_history_status_supports_${entry.kind}` };
    const wantedBatch = String(source.batch_id || "");
    for (const snapshot of snapshots) {
      const payload = snapshot.payload || {};
      const batch = payload.batch || {};
      const batchId = String(batch.batchId || payload.batchId || "") || `snapshot_${snapshot.id}`;
      if (wantedBatch && batchId !== wantedBatch) continue;
      for (const row of Array.isArray(batch.rows) ? batch.rows : []) {
        if (slugOfPreviewUrl(row && row.previewUrl) !== slug) continue;
        for (const step of Array.isArray(row.history) ? row.history : []) {
          if (String(step && step.status) === expectedStatus && Date.parse(step && step.at) === atMs) {
            return { ok: true, record: `line.batch ${batchId} history ${expectedStatus}@${step.at}` };
          }
        }
      }
    }
    return { ok: false, reason: "history_step_not_found_in_any_snapshot" };
  }

  if (table === "connect_threads") {
    const rows = rowsOf(await select(
      "connect_threads",
      `select=id,site_slug,channel,contact_name,contact_info,subject,created_at&id=eq.${encodeURIComponent(source.id)}`,
    ).catch(() => null));
    const row = rows && rows[0];
    if (!row) return { ok: false, reason: "thread_row_missing" };
    if (String(row.site_slug) !== slug) return { ok: false, reason: "thread_wrong_site" };
    const channel = String(row.channel || "").toLowerCase();
    const expectedKind = channel === "system"
      ? "site_notice"
      : (collapse(row.contact_info) ? "lead_captured" : "new_conversation");
    if (expectedKind !== entry.kind) return { ok: false, reason: `thread_row_supports_${expectedKind}_not_${entry.kind}` };
    if (Date.parse(row.created_at) !== atMs) return { ok: false, reason: "timestamp_not_the_records_own" };
    return { ok: true, record: `connect_thread ${row.id} channel=${channel}` };
  }

  if (table === "ghost_agency_events") {
    const rows = rowsOf(await select(
      "ghost_agency_events",
      `select=id,type,created_at,payload&id=eq.${encodeURIComponent(source.id)}`,
    ).catch(() => null));
    const row = rows && rows[0];
    if (!row) return { ok: false, reason: "event_row_missing" };
    const type = String(row.type || "");
    const payload = row.payload || {};
    const kindOf = () => {
      if (type === "preview.reveal_opened" || type === "preview.clicked") return "preview_opened";
      if (type === "connect_ai_reply_sent") return "assistant_replied";
      if (type === "system.run" && String(payload.stage) === "built") {
        if (payload.status === "started") return "rebuild_started";
        if (payload.ready === true) return "rebuild";
        if (payload.blocked) return "rebuild_held";
      }
      if (type === "system.run" && String(payload.stage) === "mirror_lane_refused") return "rebuild_held";
      return null;
    };
    const expectedKind = kindOf();
    if (expectedKind !== entry.kind) return { ok: false, reason: `event_${type}_supports_${expectedKind}_not_${entry.kind}` };
    if (Date.parse(payload.at || row.created_at) !== atMs) return { ok: false, reason: "timestamp_not_the_records_own" };
    return { ok: true, record: `event ${row.id} type=${type}` };
  }

  return { ok: false, reason: `unknown_source_table_${table || "none"}` };
}

// ---------------------------------------------------------------------------
// one slug: compose -> verify everything -> (optionally) send
// ---------------------------------------------------------------------------

async function verifySlug(slug, { sinceIso, untilIso, select }) {
  const problems = [];
  const log = await siteChangeLog({ siteSlug: slug, since: sinceIso, until: untilIso, select });
  if (!log.ok || log.complete !== true) {
    return { slug, sendable: false, problems: [`change_log_${log.ok ? "incomplete" : (log.reason || "unavailable")}`] };
  }
  if (!log.entries.length) return { slug, sendable: false, problems: ["no_changes_in_window"] };

  const dry = await sendRileyUpdateEmail({ siteSlug: slug, since: sinceIso, until: untilIso, dryRun: true });
  if (!dry.ok) return { slug, sendable: false, problems: [`compose_refused_${dry.blocked || "unknown"}`] };

  // 1. N in, N out — both MIME halves.
  const htmlRows = (dry.html.match(/data-claim="/g) || []).length;
  const textBullets = (dry.text.match(/^• /gm) || []).length;
  if (htmlRows !== log.entries.length) problems.push(`html_rows_${htmlRows}_vs_entries_${log.entries.length}`);
  if (textBullets !== log.entries.length) problems.push(`text_bullets_${textBullets}_vs_entries_${log.entries.length}`);

  // 2. Every entry's own voice line is present in BOTH halves, verbatim.
  for (const entry of log.entries) {
    const voice = collapse(rileyVoiceLine(entry));
    if (!dry.html.includes(escapeHtml(voice))) problems.push(`claim_missing_in_html: ${voice.slice(0, 60)}`);
    if (!dry.text.includes(voice)) problems.push(`claim_missing_in_text: ${voice.slice(0, 60)}`);
  }

  // 3. Every entry re-verified against the durable record it names.
  const verifiedClaims = [];
  for (const entry of log.entries) {
    const verdict = await verifyEntryRecord(entry, { slug, sinceIso, select });
    verifiedClaims.push({ at: entry.at, kind: entry.kind, ...verdict });
    if (!verdict.ok) problems.push(`record_unverified ${entry.kind}@${entry.at}: ${verdict.reason}`);
  }

  // 4. Links. tel: must be the resolved Riley line; http(s) must fetch 200;
  //    this site's own pages must actually be this business's site.
  const businessName = String((dry.meta && dry.meta.businessName) || "");
  const line = resolveRileyLine({ env: process.env, allowAgencyLine: true });
  const links = [];
  for (const url of extractUrls(dry.html, "href")) {
    if (url.startsWith("tel:")) {
      const ok = Boolean(line.phone) && url === line.telHref;
      links.push({ url, ok, ...(ok ? {} : { reason: "tel_href_does_not_match_resolved_riley_line" }) });
      if (!ok) problems.push(`link_failed ${url}`);
      continue;
    }
    if (!/^https?:\/\//.test(url)) { links.push({ url, ok: false, reason: "unsupported_scheme" }); problems.push(`link_failed ${url}`); continue; }
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.endsWith(".wss-ai.com") && host !== "ghost.wss-ai.com") {
        const verdict = await verifySitePage(url, businessName);
        links.push({ url, ...verdict });
        if (!verdict.ok) problems.push(`link_failed ${url}: ${verdict.reason}`);
      } else {
        const response = await fetchWithTimeout(url);
        const ok = response.status === 200;
        links.push({ url, ok, status: response.status });
        if (!ok) problems.push(`link_failed ${url}: ${response.status}`);
      }
    } catch (error) {
      links.push({ url, ok: false, reason: String(error && error.message || error) });
      problems.push(`link_failed ${url}`);
    }
  }

  // 5. Images must fetch as real bytes.
  const images = [];
  for (const url of extractUrls(dry.html, "src")) {
    try {
      const response = await fetchWithTimeout(url);
      const type = String(response.headers.get("content-type") || "");
      const bytes = Buffer.from(await response.arrayBuffer()).length;
      const ok = response.status === 200 && type.startsWith("image/") && bytes > 0;
      images.push({ url, ok, status: response.status, type, bytes });
      if (!ok) problems.push(`image_failed ${url}: ${response.status} ${type} ${bytes}b`);
    } catch (error) {
      images.push({ url, ok: false, reason: String(error && error.message || error) });
      problems.push(`image_failed ${url}`);
    }
  }

  return {
    slug,
    subject: dry.subject,
    counts: dry.counts,
    window: { since: sinceIso, until: untilIso },
    businessName: businessName || null,
    clientId: (dry.meta && dry.meta.clientId) || null,
    claims: verifiedClaims,
    links,
    images,
    problems,
    sendable: problems.length === 0,
    html: dry.html,
    text: dry.text,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const VALUE_FLAGS = ["--hours", "--out-dir", "--prefix"];
  const flagValueIndexes = new Set(
    VALUE_FLAGS.map((name) => args.indexOf(name)).filter((index) => index >= 0).map((index) => index + 1),
  );
  const slugs = args.filter((arg, index) => !arg.startsWith("--") && !flagValueIndexes.has(index));
  if (!slugs.length) {
    console.error("usage: node scripts/riley-update-email-send-samples.js <slug> [<slug>...] [--hours 24] [--send] [--out-dir <dir>] [--prefix <subject prefix>]");
    process.exit(2);
  }
  const flag = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const hours = Number(flag("--hours", 24));
  const outDir = flag("--out-dir", os.tmpdir());
  const prefix = flag("--prefix", DEFAULT_PREFIX);
  const send = args.includes("--send");

  loadEnv(); // canonical breadcrumb secrets; never printed
  const { select } = require("../lib/store");
  const untilIso = new Date().toISOString();
  const sinceIso = new Date(Date.now() - (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000).toISOString();

  const report = [];
  for (const slug of slugs) {
    const verified = await verifySlug(slug, { sinceIso, untilIso, select });
    const entry = { ...verified };
    delete entry.html;
    delete entry.text;
    if (verified.html) {
      const outPath = path.join(outDir, `riley-update-sample-${slug}.html`);
      fs.writeFileSync(outPath, verified.html, "utf8");
      entry.html_written_to = outPath;
    }
    if (send && verified.sendable) {
      // The module's recipient lock is authoritative; this script only ever
      // hands the mailer the locked owner address, with the sample prefix.
      const { sendResendEmail } = require("../lib/email");
      const result = await sendResendEmail({
        to: RILEY_UPDATE_RECIPIENT,
        cc: [],
        bcc: [],
        senderKind: "transactional",
        subject: `${prefix} ${verified.subject}`,
        html: verified.html,
        text: verified.text,
      });
      entry.send = result && result.mode === "sent"
        ? { ok: true, id: result.id, to: RILEY_UPDATE_RECIPIENT, subject: `${prefix} ${verified.subject}` }
        : { ok: false, result };
    } else if (send) {
      entry.send = { ok: false, refused: "not_sendable", problems: verified.problems };
    }
    report.push(entry);
  }

  console.log(JSON.stringify(report, null, 2));
  const allGood = report.every((entry) => entry.sendable && (!send || (entry.send && entry.send.ok)));
  process.exit(allGood ? 0 : 1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
