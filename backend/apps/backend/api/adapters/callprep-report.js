"use strict";

const { timingSafeEqual } = require("node:crypto");
const { requireAdmin } = require("../../lib/admin-auth");
const { customerSafePacket, existingCallPrepReportUrl, saveBusinessReport, saveScannedBusinessReport } = require("../../lib/callprep-client");
const { scanBusiness } = require("../../lib/callprep-enrich");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { buildCanonicalJob } = require("../../lib/packets");
const { callprepAdapter } = require("../../lib/adapters");
const { upsertRow } = require("../../lib/store");

// Same secret-gate as the vapi-tools endpoints (register-prospect / lookup-prospect):
// a shared VAPI/tool secret OR the admin token lets the build lane create a report
// without an admin browser session. Constant-time compare, no secret ever logged.
function toolSecretAuthorized(req) {
  const secrets = [process.env.VAPI_WEBHOOK_SECRET, process.env.VAPI_TOOL_SECRET, process.env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  const got = String(
    req.headers["x-vapi-secret"] || req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "",
  ).trim();
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return g.length === b.length && timingSafeEqual(g, b);
  });
}

// Map an inbound prospect payload (snake_case from the build lane, or camelCase
// from the admin console) into the shape buildCanonicalJob()'s normalizer reads,
// so job.prospect.businessName / city / currentWebsite resolve either way.
function normalizeInboundProspect(source = {}) {
  return {
    ...source,
    businessName: source.businessName || source.business_name || source.company || source.name,
    industry: source.industry || source.category || source.businessCategory,
    city: source.city || source.market,
    state: source.state || source.region,
    currentWebsite: source.currentWebsite || source.current_website || source.website || source.url,
    phone: source.phone || source.phoneNumber,
    address: source.address || source.formattedAddress,
    id: source.id || source.prospect_id,
  };
}

function createCallPrepReportHandler(deps = {}) {
  const requireAdminFn = deps.requireAdmin || requireAdmin;
  const buildCanonicalJobFn = deps.buildCanonicalJob || buildCanonicalJob;
  const callprepAdapterFn = deps.callprepAdapter || callprepAdapter;
  const saveBusinessReportFn = deps.saveBusinessReport || saveBusinessReport;
  const saveScannedBusinessReportFn = deps.saveScannedBusinessReport || saveScannedBusinessReport;
  const scanBusinessFn = deps.scanBusiness || scanBusiness;
  const upsertRowFn = deps.upsertRow || upsertRow;
  const toolSecretAuthorizedFn = deps.toolSecretAuthorized || toolSecretAuthorized;

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    // Allow either the shared VAPI/tool secret (build lane) or an admin session.
    if (!toolSecretAuthorizedFn(req) && !requireAdminFn(req, res)) return;
    try {
      const body = await readJson(req);
      const source = body.prospect || body.lead || body.business || body;
      const job = buildCanonicalJobFn({ ...body, prospect: normalizeInboundProspect(source) });
      const adapter = callprepAdapterFn(job);
      const prospect = {
        ...job.prospect,
        // Real Google signals the report grades reputation from.
        rating: source.rating ?? source.starRating ?? source.avgRating,
        review_count: source.review_count ?? source.reviewCount ?? source.reviews_count ?? source.totalReviews,
        reviews: Array.isArray(source.reviews) ? source.reviews : [],
        weaknesses: source.weaknesses ?? source.weaknessReasons ?? source.weakness_reasons ?? source.gaps,
        weaknessReasons: source.weaknessReasons ?? source.weakness_reasons,
        recommendations: source.recommendations ?? source.recommendedActions,
        preview_url: source.preview_url || source.previewUrl || "",
        address: source.address || source.formattedAddress || job.prospect.address || "",
        report_url: source.report_url || source.reportUrl || job.prospect.report_url || "",
        callprep_report_url: source.callprep_report_url || source.callprepReportUrl || job.prospect.callprep_report_url || "",
        record: source.record && typeof source.record === "object" ? source.record : job.prospect.record,
      };
      const existingReportUrl = existingCallPrepReportUrl(prospect);

      // RUN THE LIVE SCAN (owner, 2026-08-05: "there's tons of stuff on this
      // page that's saying uncaptured ... if you run this directly through
      // CallPrep, all this stuff is captured").
      //
      // He was right, and the cause was that this adapter only ever sent the
      // STATIC packet: lib/callprep-enrich.scanBusiness() — which fans out
      // exactly like the app's own realtime scan (PageSpeed, SSL, security
      // headers, CMS, domain age, schema, socials) — and its partner
      // saveScannedBusinessReport() were both built, exported, and called by
      // nothing. Every Signal report we generated therefore rendered
      // "NOT CAPTURED" for facts CallPrep captures on its own.
      //
      // Fail-soft on purpose: a gateway outage must not cost the report, so a
      // failed scan falls back to the static packet rather than erroring.
      // The canonical job renames the site to currentWebsite; read every
      // spelling, then fall back to "Name City ST" (scanBusiness accepts both,
      // and warns that a bare phone is a poor key).
      const scanInput = String(
        job.prospect.currentWebsite || prospect.currentWebsite || prospect.current_website
        || source.website || source.url || prospect.website
        || [job.prospect.businessName, prospect.city || source.city || "", prospect.state || source.state || ""]
          .filter(Boolean).join(" "),
      ).trim();
      let scan = null;
      let scanError = "";
      if (body.scan !== false && scanInput) {
        try {
          scan = await scanBusinessFn({ input: scanInput });
        } catch (e) {
          scanError = String((e && e.message) || e).slice(0, 160);
        }
      }

      const callprep = scan
        ? await saveScannedBusinessReportFn({
          scan,
          prospect,
          closerId: body.closer_id || body.closerId || null,
        })
        : await saveBusinessReportFn({
          adapter,
          prospect,
          closerId: body.closer_id || body.closerId || null,
        });
      callprep.scan_mode = scan ? "live_scan" : (scanError ? `static_fallback:${scanError}` : "static");

      let persistence = null;
      const reportUrl = callprep.ok ? existingReportUrl || callprep.report_url : "";
      const persistedCallprep = callprep.ok && reportUrl && reportUrl !== callprep.report_url
        ? { ...callprep, report_url: reportUrl }
        : callprep;

      if (persistedCallprep.ok) {
        try {
          const result = await upsertRowFn(
            "ghost_agency_prospects",
            {
              prospect_id: job.prospect.id,
              business_name: job.prospect.businessName,
              report_url: reportUrl,
              updated_at: new Date().toISOString(),
            },
            "prospect_id",
          );
          persistence = {
            mode: result.mode || "unknown",
            configured: result.configured !== false,
            persisted: result.mode === "live_upsert",
            status: result.status || null,
          };
        } catch {
          persistence = {
            mode: "persistence_failed",
            configured: true,
            persisted: false,
            status: null,
          };
        }
      }

      sendJson(res, 200, {
        ok: persistedCallprep.ok,
        mode: persistedCallprep.ok ? "report_created" : "report_packet",
        jobId: job.id,
        adapter: {
          mode: adapter.mode,
          configured: adapter.configured,
          packet: {
            ...customerSafePacket(adapter, prospect),
            reportUrl: reportUrl || null,
          },
        },
        callprep: persistedCallprep,
        report_url: reportUrl || null,
        persistence,
      });
    } catch (error) {
      handleError(res, error);
    }
  };
}

const handler = createCallPrepReportHandler();

module.exports = handler;
module.exports.createCallPrepReportHandler = createCallPrepReportHandler;
