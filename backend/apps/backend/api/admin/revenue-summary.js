"use strict";

// TRUTHFUL REVENUE AGGREGATION for the console's CONVERT station.
//
// This endpoint answers one question honestly: what does the durable ledger
// say came in, and what can MRR truthfully be claimed to be?
//
// The truth law here is absolute:
//
//   * Every count is derived ONLY from what already exists durably — the
//     `stripe_webhook` events the webhook writes for every Stripe delivery
//     (carrying their own `verified` flag), the `ghost_agency_fulfillment`
//     events fulfillment writes on a completed checkout, the
//     `ghost_agency_dashboard_access` rows issued at fulfillment, and the
//     `checkout.click` events the checkout-link route records. No number is
//     synthesized from configuration alone.
//
//   * Live subscription state (who is still paying Stripe right now) is NOT
//     readable without a new Stripe API dependency, which this repo refuses
//     to add on an admin read path. So MRR is never presented as confirmed
//     subscription revenue: it is the ledger-derived figure
//     `activeClients x planAmountCents`, labeled `mrrSource: "ledger_count"`.
//     When even that is not computable (the client ledger itself is
//     unreadable), MRR is `null` and `mrrSource: "unknown"`. No invented
//     numbers, ever.
//
//   * Unverified webhook events are counted nowhere. A Stripe delivery whose
//     signature did not verify is a claim, not a payment.
//
// Shape follows api/admin/ledger-data.js: GET-only, requireAdmin (x-admin-token),
// paged reads with a hard row cap, and source failures that 503 rather than
// masquerade as an empty or partial ledger.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { select } = require("../../lib/store");
const { LOCAL_GROWTH_PRODUCT, localGrowthAmountCents } = require("../../lib/stripe");

const EVENT_TABLE = "ghost_agency_events";
const ACCESS_TABLE = "ghost_agency_dashboard_access";
const PAGE_SIZE = 1000;
const MAX_SOURCE_ROWS = 20000;
const LAST_30D_MS = 30 * 24 * 60 * 60 * 1000;
const REVENUE_EVENT_TYPES = [
  "stripe_webhook",
  "ghost_agency_fulfillment",
  "checkout.click",
];
const COMPLETION_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function iso(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function sourceError(code = "revenue_source_unavailable", statusCode = 503) {
  const error = new Error(code === "revenue_source_limit"
    ? "The revenue ledger history is too large to total safely."
    : "Revenue ledger source data is temporarily unavailable.");
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/**
 * Page a PostgREST source with a stable order, exactly like ledger-data's
 * readAllRows. Reaching the cap is deliberately an error: totals are never
 * presented as complete when the source might contain another row.
 */
async function readAllRows(table, options = {}) {
  const read = options.select || select;
  const pageSize = Math.max(1, Number(options.pageSize) || PAGE_SIZE);
  const maxRows = Math.max(pageSize, Number(options.maxRows) || MAX_SOURCE_ROWS);
  const selectFields = text(options.selectFields || "id", 1000);
  const order = text(options.order || `${options.timeColumn || "created_at"}.asc,id.asc`, 200);
  const filters = Array.isArray(options.filters) ? options.filters.filter(Boolean) : [];
  const rows = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const query = [
      `select=${selectFields}`,
      ...filters,
      `order=${order}`,
      `limit=${pageSize}`,
      `offset=${offset}`,
    ].join("&");
    let result;
    try {
      result = await read(table, query);
    } catch {
      throw sourceError();
    }
    if (result?.ok !== true || !Array.isArray(result.data)) throw sourceError();
    rows.push(...result.data);
    if (rows.length >= maxRows) throw sourceError("revenue_source_limit", 413);
    if (result.data.length < pageSize) return rows;
  }
  throw sourceError("revenue_source_limit", 413);
}

/**
 * A stripe_webhook event row counts as a verified completion only when the
 * webhook itself recorded that the signature verified, the Stripe event type
 * is one of the two completion triggers, and the session metadata names the
 * Local Growth product. Everything else — unverified deliveries, non-
 * completion event types, other products — is excluded from every count.
 */
function isVerifiedCompletion(row) {
  if (row?.type !== "stripe_webhook") return false;
  const payload = object(row.payload);
  if (payload.verified !== true) return false;
  if (!COMPLETION_EVENT_TYPES.has(text(payload.type, 120))) return false;
  const metadata = object(payload.metadata);
  return text(metadata.product, 120) === LOCAL_GROWTH_PRODUCT;
}

function observedAmountCents(row) {
  if (!isVerifiedCompletion(row)) return null;
  const metadata = object(object(row.payload).metadata);
  const value = Number.parseInt(String(metadata.checkoutAmountCents || ""), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * What one seat of the Local Growth plan costs, in cents, and where that
 * number came from. Precedence is honesty about TODAY'S price first, then
 * what the ledger actually observed being charged, then the repo default.
 * The default (19900) is lib/stripe.js's own fallback — the amount a fresh
 * checkout session would charge — so it is a fact about the system, never an
 * invented figure. When the ledger has observed more than one distinct
 * amount (a price change mid-history), no single observed number is picked:
 * the fallback stands and a warning says so.
 */
function resolvePlanAmountCents(events = [], env = process.env) {
  const configured = Number.parseInt(String(env.STRIPE_LOCAL_GROWTH_AMOUNT_CENTS || ""), 10);
  if (Number.isSafeInteger(configured) && configured > 0) {
    return { cents: configured, source: "env", observedVariants: null };
  }
  const observed = [...new Set(events.map(observedAmountCents).filter((value) => value !== null))];
  if (observed.length === 1) {
    return { cents: observed[0], source: "observed", observedVariants: null };
  }
  return {
    cents: localGrowthAmountCents(env),
    source: "default",
    observedVariants: observed.length > 1 ? observed : null,
  };
}

function aggregateRevenueSummary({ events = [], activeClients = null, env = process.env, now = () => new Date() } = {}) {
  const warnings = [];
  const clockValue = now();
  const nowMs = clockValue instanceof Date ? clockValue.getTime() : new Date(clockValue).getTime();
  const cutoffMs = nowMs - LAST_30D_MS;

  const completionIds = new Set();
  const fulfilledSessions = new Set();
  const livePaidSessions = new Set();
  const ownerSandboxSessions = new Set();
  const clickIds = new Set();
  const last30d = {
    completions: 0,
    fulfillments: 0,
    checkoutClicks: 0,
    livePaidFulfillments: 0,
    ownerSandboxFulfillments: 0,
  };

  for (const row of Array.isArray(events) ? events : []) {
    const at = iso(row?.created_at);
    const inWindow = at !== "" && Date.parse(at) >= cutoffMs;

    if (row?.type === "stripe_webhook") {
      if (!isVerifiedCompletion(row)) continue;
      const payload = object(row.payload);
      const key = text(payload.id, 240) || text(row.id, 240);
      if (!key || completionIds.has(key)) continue;
      completionIds.add(key);
      if (inWindow) last30d.completions += 1;
    } else if (row?.type === "ghost_agency_fulfillment") {
      const payload = object(row.payload);
      const key = text(payload.stripeSessionId, 240) || text(row.id, 240);
      if (!key || fulfilledSessions.has(key)) continue;
      fulfilledSessions.add(key);
      const status = text(payload.completionStatus, 80);
      const ownerSandbox = status === "owner_sandbox_checkout_completed";
      if (ownerSandbox) ownerSandboxSessions.add(key);
      else if (status === "paid_checkout_completed") livePaidSessions.add(key);
      if (inWindow) {
        last30d.fulfillments += 1;
        if (ownerSandbox) last30d.ownerSandboxFulfillments += 1;
        else if (status === "paid_checkout_completed") last30d.livePaidFulfillments += 1;
      }
    } else if (row?.type === "checkout.click") {
      const key = text(row.id, 240);
      if (!key || clickIds.has(key)) continue;
      clickIds.add(key);
      if (inWindow) last30d.checkoutClicks += 1;
    }
  }

  const plan = resolvePlanAmountCents(events, env);
  if (plan.observedVariants && plan.observedVariants.length > 1) {
    warnings.push(
      `The ledger observed more than one checkout amount (${plan.observedVariants.join(", ")} cents); planAmountCents uses the ${plan.source} value (${plan.cents}).`,
    );
  }

  const clientsKnown = typeof activeClients === "number" && Number.isFinite(activeClients) && activeClients >= 0;
  const mrrComputable = clientsKnown && Number.isSafeInteger(plan.cents) && plan.cents > 0;
  const mrr = mrrComputable ? activeClients * plan.cents : null;
  const mrrSource = mrrComputable ? "ledger_count" : "unknown";
  if (ownerSandboxSessions.size > 0) {
    warnings.push(
      `${ownerSandboxSessions.size} fulfilled session${ownerSandboxSessions.size === 1 ? " is" : "s are"} $0 owner-sandbox checkouts; they are broken out of livePaidSessions but the dashboard_access client count cannot exclude them.`,
    );
  }

  const generatedAt = clockValue instanceof Date ? clockValue.toISOString() : new Date(clockValue).toISOString();

  return {
    ok: true,
    generatedAt,
    activeClients: clientsKnown ? activeClients : null,
    paidTotal: completionIds.size,
    mrr,
    mrrSource,
    planAmountCents: plan.cents,
    planAmountSource: plan.source,
    last30d,
    fulfilledSessions: fulfilledSessions.size,
    livePaidSessions: livePaidSessions.size,
    ownerSandboxSessions: ownerSandboxSessions.size,
    checkoutClicksTotal: clickIds.size,
    source: {
      mrrDefinition:
        "mrr = activeClients x planAmountCents (mrrSource \"ledger_count\"). Live subscription state is not readable without a Stripe API dependency, so this is a ledger-derived figure — provisioned clients at the plan price — never a confirmed-subscriptions total.",
      paidTotalDefinition:
        "Distinct signature-verified Stripe checkout completion events (checkout.session.completed / async_payment_succeeded) for the local-growth-website-plan product. Unverified webhook deliveries are excluded from every count.",
      activeClientsDefinition:
        "Row count of ghost_agency_dashboard_access — one dashboard issued per fulfilled checkout job. Grain is per job, not per unique owner email.",
      planAmountPrecedence: "env STRIPE_LOCAL_GROWTH_AMOUNT_CENTS, else the single amount observed in verified completion metadata, else the repo default (19900).",
      warnings,
    },
  };
}

function createRevenueSummaryHandler(overrides = {}) {
  const guard = overrides.methodGuard || methodGuard;
  const auth = overrides.requireAdmin || requireAdmin;
  const read = overrides.select || select;
  const clock = overrides.now || (() => new Date());
  const env = overrides.env || process.env;

  return async function revenueSummaryHandler(req, res) {
    if (!guard(req, res, ["GET"])) return;
    if (!auth(req, res)) return;
    try {
      // Both sources must be readable or the answer is 503, never a partial
      // ledger dressed up as a complete one.
      const [events, accessRows] = await Promise.all([
        readAllRows(EVENT_TABLE, {
          select: read,
          // ghost_agency_events is (id, type, payload, created_at, svix_id);
          // project exactly what the aggregation reads.
          selectFields: "id,type,created_at,payload",
          order: "created_at.asc,id.asc",
          timeColumn: "created_at",
          filters: [`type=in.(${REVENUE_EVENT_TYPES.join(",")})`],
        }),
        readAllRows(ACCESS_TABLE, {
          select: read,
          selectFields: "job_id",
          order: "job_id.asc",
          timeColumn: "created_at",
        }),
      ]);
      sendJson(res, 200, aggregateRevenueSummary({
        events,
        activeClients: accessRows.length,
        env,
        now: clock,
      }));
    } catch (error) {
      if (error?.code === "revenue_source_limit" || error?.code === "revenue_source_unavailable") {
        sendJson(res, error.statusCode || 503, { ok: false, error: error.code });
        return;
      }
      handleError(res, error);
    }
  };
}

module.exports = createRevenueSummaryHandler();
module.exports.aggregateRevenueSummary = aggregateRevenueSummary;
module.exports.createRevenueSummaryHandler = createRevenueSummaryHandler;
module.exports.readAllRows = readAllRows;
module.exports.resolvePlanAmountCents = resolvePlanAmountCents;
module.exports.REVENUE_EVENT_TYPES = REVENUE_EVENT_TYPES;
