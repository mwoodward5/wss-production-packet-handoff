"use strict";

const { createHmac, randomUUID } = require("node:crypto");
const { dispatchWoodwardLabsBuildTicket, dispatchZapier } = require("./adapters");
const { buildActivationEmail } = require("./email");
const { emailFrom } = require("./env-compat");
const { buildCanonicalJob } = require("./packets");
const { insertRow, recordEvent, select, upsertRow } = require("./store");
const { fulfillDomainForJob } = require("./domains");
const { hashPin, slugify } = require("./dashboard-link");
const {
  LOCAL_GROWTH_PRODUCT,
  localGrowthAmountCents,
  localGrowthCurrency,
  localGrowthPriceId,
  verifyCheckoutContractHash,
  verifyTestPromotionHash,
} = require("./stripe");

const FULFILLMENT_STATE_VERSION = 2;
const STEP_LEASE_MS = 5 * 60 * 1000;
const RESEND_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
const COMPLETED_ORDER_STATUSES = new Set([
  "owner_sandbox_checkout_completed",
  "paid_checkout_completed",
]);

function sessionMetadata(session = {}) {
  return session.metadata || {};
}

function sessionSubscriptionId(session = {}) {
  return String(session.subscription?.id || session.subscription || "").trim();
}

function jobFromCheckoutSession(session = {}) {
  const metadata = sessionMetadata(session);
  const businessName = metadata.businessName || session.customer_details?.name || "Paid Local Website Buyer";
  return buildCanonicalJob({
    jobId: metadata.jobId || session.client_reference_id || `ghost_paid_${session.id || Date.now()}`,
    prospect: {
      businessName,
      ownerEmail: session.customer_details?.email || session.customer_email || metadata.ownerEmail || "",
      city: metadata.city || "Unknown",
      state: metadata.state || "",
      industry: metadata.industry || "",
      source: "stripe_checkout_completed",
    },
  });
}

function safeHttpsUrl(value = "") {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > 2048) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? candidate : "";
  } catch {
    return "";
  }
}

function businessLogoUrlFromTruthPacket(truthPacket = {}) {
  if (!truthPacket || typeof truthPacket !== "object" || Array.isArray(truthPacket)) return "";
  const intakeGenie = truthPacket.intakeGenie && typeof truthPacket.intakeGenie === "object"
    ? truthPacket.intakeGenie
    : truthPacket.intake_genie && typeof truthPacket.intake_genie === "object"
      ? truthPacket.intake_genie
      : {};
  const approvedLogo = (Array.isArray(intakeGenie.assets) ? intakeGenie.assets : [])
    .find((asset) => asset?.kind === "logo" && asset?.approved !== false && safeHttpsUrl(asset?.url));
  const logo = truthPacket.logo;
  const candidates = [
    approvedLogo?.url,
    intakeGenie.facts?.logo_url,
    intakeGenie.facts?.logoUrl,
    typeof logo === "string" ? logo : logo?.url,
    truthPacket.logo_url,
    truthPacket.logoUrl,
    truthPacket.businessLogoUrl,
  ];
  return candidates.map(safeHttpsUrl).find(Boolean) || "";
}

async function restoreCheckoutJob(session = {}) {
  const fallback = jobFromCheckoutSession(session);
  try {
    const result = await select(
      "ghost_agency_jobs",
      `select=payload&job_id=eq.${encodeURIComponent(fallback.id)}&limit=1`,
    );
    const stored = result?.ok && Array.isArray(result.data) ? result.data[0]?.payload : null;
    if (!stored || typeof stored !== "object" || stored.id !== fallback.id || !stored.prospect) return fallback;
    return {
      ...stored,
      prospect: {
        ...stored.prospect,
        businessName: stored.prospect.businessName || fallback.prospect.businessName,
        ownerEmail: fallback.prospect.ownerEmail || stored.prospect.ownerEmail || "",
      },
    };
  } catch {
    return fallback;
  }
}

async function businessLogoUrlForJob(job = {}) {
  const embeddedTruthPackets = [
    job.packets?.truth,
    job.prospect?.truth_packet,
    job.prospect?.truthPacket,
  ];
  for (const packet of embeddedTruthPackets) {
    const logoUrl = businessLogoUrlFromTruthPacket(packet);
    if (logoUrl) return logoUrl;
  }

  const canonicalLogo = businessLogoUrlFromTruthPacket({ intakeGenie: job.canonical });
  if (canonicalLogo) return canonicalLogo;

  const directLogo = [
    job.prospect?.businessLogoUrl,
    job.prospect?.logo_url,
    job.prospect?.logoUrl,
    typeof job.prospect?.logo === "string" ? job.prospect.logo : job.prospect?.logo?.url,
  ].map(safeHttpsUrl).find(Boolean);
  if (directLogo) return directLogo;

  const prospectId = String(job.prospect?.id || job.prospect?.prospect_id || "").trim();
  if (!prospectId) return "";
  try {
    const result = await select(
      "ghost_agency_prospects",
      `select=record&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    );
    const record = result?.ok && Array.isArray(result.data) ? result.data[0]?.record : null;
    return businessLogoUrlFromTruthPacket(record?.truth_packet || record?.truthPacket || {});
  } catch {
    return "";
  }
}

function checkoutSessionSummary(session = {}) {
  return {
    id: session.id,
    created: session.created,
    mode: session.mode,
    paymentStatus: session.payment_status,
    status: session.status,
    customer: session.customer,
    customerEmail: session.customer_details?.email || session.customer_email || "",
    subscription: session.subscription,
    amountSubtotal: session.amount_subtotal,
    amountTotal: session.amount_total,
    currency: session.currency,
    clientReferenceId: session.client_reference_id,
    metadata: sessionMetadata(session),
  };
}

function eventSupportsCheckoutFulfillment(type = "") {
  return type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded";
}

function lineItemPriceIds(session = {}) {
  const data = Array.isArray(session.line_items?.data) ? session.line_items.data : [];
  return data
    .map((item) => String(item?.price?.id || item?.price || "").trim())
    .filter(Boolean);
}

function checkoutFulfillmentPolicy(event = {}) {
  const session = event.data?.object || {};
  const eventType = String(event.type || "").trim();
  const metadata = sessionMetadata(session);
  const paymentStatus = String(session.payment_status || "").trim().toLowerCase();
  const sessionMode = String(session.mode || "").trim().toLowerCase();
  const sessionStatus = String(session.status || "").trim().toLowerCase();
  const sessionId = String(session.id || "").trim();
  const subscriptionId = sessionSubscriptionId(session);
  const product = String(metadata.product || "").trim();
  const customerEmail = String(session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
  const ownerEmail = String(process.env.GHOST_AGENCY_OWNER_EMAIL || process.env.LOCAL_GROWTH_OWNER_EMAIL || "").trim().toLowerCase();
  const testCheckoutEnabled = String(process.env.STRIPE_TEST_CHECKOUT_ENABLED || "").trim() === "true";
  const keyIsTest = String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test_");
  const zeroTotal = session.amount_total !== null
    && session.amount_total !== undefined
    && Number(session.amount_total) === 0;
  const eligibleEvent = eventSupportsCheckoutFulfillment(eventType);
  const completedSubscription = eligibleEvent
    && Boolean(sessionId)
    && sessionMode === "subscription"
    && sessionStatus === "complete"
    && Boolean(subscriptionId);
  const ownerSandboxCheckout = eventType === "checkout.session.completed"
    && event.livemode === false
    && completedSubscription
    && zeroTotal
    && product === LOCAL_GROWTH_PRODUCT
    && metadata.testCheckout === "true"
    && testCheckoutEnabled
    && keyIsTest
    && verifyTestPromotionHash(metadata.testPromotionHash)
    && Boolean(ownerEmail)
    && customerEmail === ownerEmail;

  const expectedPriceId = localGrowthPriceId();
  const expectedAmountCents = localGrowthAmountCents();
  const expectedCurrency = localGrowthCurrency();
  const signedPriceId = String(metadata.checkoutPriceId || "").trim();
  const signedAmountCents = Number.parseInt(String(metadata.checkoutAmountCents || ""), 10);
  const signedCurrency = String(metadata.checkoutCurrency || "").trim().toLowerCase();
  const presentLineItemPriceIds = lineItemPriceIds(session);
  const signedContractMatchesEnvironment = Boolean(expectedPriceId)
    && signedPriceId === expectedPriceId
    && signedAmountCents === expectedAmountCents
    && signedCurrency === expectedCurrency
    && verifyCheckoutContractHash(metadata);
  const sessionMatchesSignedContract = Number(session.amount_subtotal) === signedAmountCents
    && String(session.currency || "").trim().toLowerCase() === signedCurrency
    && (presentLineItemPriceIds.length === 0 || presentLineItemPriceIds.includes(signedPriceId));
  const livePaidCheckout = event.livemode === true
    && completedSubscription
    && product === LOCAL_GROWTH_PRODUCT
    && paymentStatus === "paid"
    && signedContractMatchesEnvironment
    && sessionMatchesSignedContract;

  if (livePaidCheckout) {
    return { allowed: true, ownerSandboxCheckout: false, paymentStatus };
  }
  if (paymentStatus === "no_payment_required" && ownerSandboxCheckout) {
    return { allowed: true, ownerSandboxCheckout: true, paymentStatus };
  }

  let reason = "checkout_payment_not_verified";
  if (!eligibleEvent) reason = "checkout_event_not_supported";
  else if (sessionMode !== "subscription") reason = "checkout_mode_not_supported";
  else if (event.livemode === true && !signedContractMatchesEnvironment) reason = "checkout_contract_not_verified";
  else if (event.livemode === true && !sessionMatchesSignedContract) reason = "checkout_amount_or_currency_mismatch";
  return {
    allowed: false,
    ownerSandboxCheckout: false,
    paymentStatus: paymentStatus || "unknown",
    reason,
  };
}

function isConfirmedUniqueViolation(result = {}, constraintName = "", columnPattern = null) {
  const errorText = `${result.error?.message || ""} ${result.error?.details || ""}`;
  const expectedConstraint = constraintName && errorText.includes(constraintName);
  const expectedColumns = columnPattern instanceof RegExp && columnPattern.test(errorText);
  return Number(result.status) === 409
    && String(result.error?.code || "") === "23505"
    && (expectedConstraint || expectedColumns);
}

function representedRow(result = {}) {
  if (Array.isArray(result.row)) return result.row[0] || null;
  return result.row && typeof result.row === "object" ? result.row : null;
}

function requireInsert(result, code) {
  const row = representedRow(result);
  if (result?.mode !== "live_write" || !row) throw fulfillmentError(code);
  return row;
}

function requireUpsert(result, code) {
  const row = representedRow(result);
  if (result?.mode !== "live_upsert" || !row) throw fulfillmentError(code);
  return row;
}

function fulfillmentError(code, options = {}) {
  const error = new Error(code);
  error.code = code;
  error.ambiguous = options.ambiguous === true;
  error.manualReconciliation = options.manualReconciliation === true;
  if (options.status) error.status = options.status;
  return error;
}

function safeError(error) {
  return {
    code: String(error?.code || error?.message || "fulfillment_step_failed").slice(0, 160),
    status: Number(error?.status) || null,
    ambiguous: error?.ambiguous === true,
  };
}

function encodedFilter(value) {
  return encodeURIComponent(String(value || ""));
}

async function selectOne(table, query, code) {
  const result = await select(table, query);
  if (result?.mode !== "live_select" || !Array.isArray(result.data)) throw fulfillmentError(code);
  return result.data[0] || null;
}

async function findOrderBySession(stripeSessionId) {
  return selectOne(
    "ghost_agency_orders",
    `stripe_session_id=eq.${encodedFilter(stripeSessionId)}&limit=1`,
    "fulfillment_order_read_failed",
  );
}

async function findDeliveryStep(jobId, deliveryType) {
  return selectOne(
    "ghost_agency_delivery_queue",
    `job_id=eq.${encodedFilter(jobId)}&delivery_type=eq.${encodedFilter(deliveryType)}&limit=1`,
    "fulfillment_step_read_failed",
  );
}

function supabaseHeaders() {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) throw fulfillmentError("fulfillment_store_not_configured");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function transitionDeliveryStep({ current, status, payload }) {
  const base = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) throw fulfillmentError("fulfillment_store_not_configured");
  const leaseToken = String(current?.payload?.leaseToken || "").trim();
  if (!current?.job_id || !current?.delivery_type || !current?.status || !leaseToken) {
    throw fulfillmentError("fulfillment_step_state_invalid");
  }
  const url = new URL(`${base}/rest/v1/ghost_agency_delivery_queue`);
  url.searchParams.set("job_id", `eq.${current.job_id}`);
  url.searchParams.set("delivery_type", `eq.${current.delivery_type}`);
  url.searchParams.set("status", `eq.${current.status}`);
  url.searchParams.set("payload->>leaseToken", `eq.${leaseToken}`);
  let response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: supabaseHeaders(),
      body: JSON.stringify({ status, payload, updated_at: new Date().toISOString() }),
    });
  } catch {
    throw fulfillmentError("fulfillment_step_checkpoint_failed", { ambiguous: true });
  }
  const json = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(json)) {
    throw fulfillmentError("fulfillment_step_checkpoint_failed", { status: response.status });
  }
  return json.length === 1 ? json[0] : null;
}

function stepResult(row = {}) {
  return row.payload?.result;
}

function stepAgeMs(row = {}) {
  const value = Date.parse(row.updated_at || row.payload?.lastAttemptAt || row.payload?.firstAttemptAt || "");
  return Number.isFinite(value) ? Math.max(0, Date.now() - value) : Number.POSITIVE_INFINITY;
}

async function claimDeliveryStep({ jobId, stripeSessionId, name, replaySafe, idempotencyWindowMs = null }) {
  const deliveryType = `fulfillment_${name}`;
  const now = new Date().toISOString();
  const leaseToken = randomUUID();
  const initialPayload = {
    version: FULFILLMENT_STATE_VERSION,
    stripeSessionId,
    leaseToken,
    attempt: 1,
    firstAttemptAt: now,
    lastAttemptAt: now,
    replaySafe,
  };
  const inserted = await insertRow("ghost_agency_delivery_queue", {
    job_id: jobId,
    stripe_session_id: stripeSessionId,
    delivery_type: deliveryType,
    status: "processing",
    payload: initialPayload,
    updated_at: now,
  });

  let current;
  if (inserted?.mode === "live_write") {
    current = requireInsert(inserted, "fulfillment_step_claim_failed");
  } else if (isConfirmedUniqueViolation(
    inserted,
    "ghost_agency_delivery_queue_job_id_delivery_type_key",
    /key\s*\(job_id,\s*delivery_type\)\s*=/i,
  )) {
    current = await findDeliveryStep(jobId, deliveryType);
    if (!current) throw fulfillmentError("fulfillment_step_claim_missing");
  } else {
    throw fulfillmentError("fulfillment_step_claim_failed");
  }

  if (current.status === "succeeded" || current.status === "skipped") {
    return { completed: true, current, result: stepResult(current) };
  }
  if (current.status === "manual_reconciliation_required") {
    throw fulfillmentError(`fulfillment_step_${name}_manual_reconciliation_required`);
  }

  const ownedLease = current.status === "processing" && current.payload?.leaseToken === leaseToken;
  if (ownedLease) return { completed: false, current };

  const age = stepAgeMs(current);
  if (current.status === "processing" && age < STEP_LEASE_MS) {
    throw fulfillmentError(`fulfillment_step_${name}_in_progress`);
  }

  // A stale processing lease is itself ambiguous: the provider may have
  // accepted the request immediately before this worker lost its checkpoint.
  const ambiguous = current.status === "processing" || current.payload?.lastError?.ambiguous === true;
  const firstAttemptAge = Date.now() - Date.parse(current.payload?.firstAttemptAt || "");
  const idempotencyExpired = Number.isFinite(idempotencyWindowMs)
    && ambiguous
    && (!Number.isFinite(firstAttemptAge) || firstAttemptAge >= idempotencyWindowMs);
  if (!replaySafe || idempotencyExpired) {
    const blockedPayload = {
      ...current.payload,
      lastAttemptAt: now,
      lastError: current.payload?.lastError || { code: "ambiguous_prior_attempt", ambiguous: true },
      reconciliationReason: idempotencyExpired ? "provider_idempotency_window_expired" : "non_idempotent_attempt_state_unknown",
    };
    await transitionDeliveryStep({ current, status: "manual_reconciliation_required", payload: blockedPayload });
    throw fulfillmentError(`fulfillment_step_${name}_manual_reconciliation_required`);
  }

  const resumedPayload = {
    ...current.payload,
    leaseToken,
    attempt: Number(current.payload?.attempt || 1) + 1,
    lastAttemptAt: now,
  };
  const resumed = await transitionDeliveryStep({ current, status: "processing", payload: resumedPayload });
  if (!resumed) throw fulfillmentError(`fulfillment_step_${name}_in_progress`);
  return { completed: false, current: resumed };
}

async function runDeliveryStep(options, execute) {
  const claimed = await claimDeliveryStep(options);
  if (claimed.completed) return claimed.result;
  const current = claimed.current;
  try {
    const result = await execute();
    const completedPayload = {
      ...current.payload,
      completedAt: new Date().toISOString(),
      result,
    };
    const completed = await transitionDeliveryStep({ current, status: "succeeded", payload: completedPayload });
    if (!completed) throw fulfillmentError(`fulfillment_step_${options.name}_checkpoint_lost`, { ambiguous: true });
    return result;
  } catch (error) {
    if (String(error?.code || "").includes("checkpoint")) throw error;
    const manual = error?.manualReconciliation === true || (error?.ambiguous === true && options.replaySafe !== true);
    const failedPayload = {
      ...current.payload,
      failedAt: new Date().toISOString(),
      lastError: safeError(error),
    };
    const failed = await transitionDeliveryStep({
      current,
      status: manual ? "manual_reconciliation_required" : "failed_retryable",
      payload: failedPayload,
    });
    if (!failed) throw fulfillmentError(`fulfillment_step_${options.name}_checkpoint_lost`, { ambiguous: true });
    throw fulfillmentError(`fulfillment_step_${options.name}_failed`, {
      ambiguous: error?.ambiguous === true,
      manualReconciliation: manual,
      status: error?.status,
    });
  }
}

function buildDispatchConfigured() {
  const urlConfigured = Boolean(String(
    process.env.WOODWARD_LABS_BUILD_TICKET_URL || "",
  ).trim());
  const tokenConfigured = Boolean(String(
    process.env.WOODWARD_LABS_BUILD_TICKET_TOKEN || "",
  ).trim());
  return urlConfigured && tokenConfigured;
}

function validateBuildTicket(result = {}) {
  if (!result.configured && result.mode === "handoff_packet") return result;
  if (result.configured && result.mode === "http_dispatch" && result.result?.ok === true) return result;
  throw fulfillmentError("build_ticket_dispatch_not_confirmed", {
    status: result.result?.status,
    ambiguous: result.configured === true,
    manualReconciliation: result.configured === true,
  });
}

function validateZapier(result = {}) {
  if (!result.configured && result.mode === "dry_run") return result;
  if (result.configured && result.mode === "webhook_dispatch" && result.result?.ok === true) return result;
  throw fulfillmentError("zapier_dispatch_not_confirmed", {
    status: result.result?.status,
    ambiguous: result.configured === true,
    manualReconciliation: result.configured === true,
  });
}

function activationSecret() {
  return String(process.env.CONNECT_APP_TOKEN || process.env.GHOST_AGENCY_ADMIN_TOKEN || "").trim();
}

function deterministicDashboardAccess({ jobId, stripeSessionId, created }) {
  const secret = activationSecret();
  const createdSeconds = Number(created);
  if (!secret) throw fulfillmentError("dashboard_access_secret_missing");
  if (!Number.isFinite(createdSeconds) || createdSeconds <= 0) throw fulfillmentError("checkout_created_timestamp_missing");
  const pinDigest = createHmac("sha256", secret)
    .update(`ghost-dashboard-pin:v1:${jobId}:${stripeSessionId}`)
    .digest("hex");
  const pin = String((Number.parseInt(pinDigest.slice(0, 12), 16) % 900000) + 100000);
  const exp = Math.trunc(createdSeconds * 1000) + (180 * 24 * 60 * 60 * 1000);
  const payload = `${jobId}.${exp}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
  const token = Buffer.from(`${payload}.${signature}`, "utf8").toString("base64url");
  return {
    pin,
    pinHash: hashPin(pin),
    magicLink: `https://wss-ai.com/dashboard#t=${token}`,
  };
}

async function sendActivationEmailIdempotent({ to, activation, stripeSessionId }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = emailFrom("transactional");
  const recipient = String(to || "").trim();
  if (!apiKey || !from || !recipient) throw fulfillmentError("activation_email_not_configured");
  const idempotencyKey = `ghost-activation/${stripeSessionId}`.slice(0, 256);
  const replyTo = process.env.GHOST_AGENCY_SUPPORT_EMAIL || undefined;
  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: recipient,
        subject: activation.subject,
        html: activation.html,
        text: activation.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch {
    throw fulfillmentError("activation_email_request_ambiguous", { ambiguous: true });
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const type = String(json?.name || json?.type || "");
    throw fulfillmentError("activation_email_send_failed", {
      status: response.status,
      ambiguous: response.status >= 500 || type === "concurrent_idempotent_requests",
    });
  }
  if (!json.id) throw fulfillmentError("activation_email_provider_id_missing", { ambiguous: true });
  return { mode: "sent", configured: true, id: json.id, idempotencyKey };
}

async function fulfillCheckoutSession(event = {}) {
  const session = event.data?.object || {};
  const policy = checkoutFulfillmentPolicy(event);
  if (!policy.allowed) {
    await recordEvent("ghost_agency_fulfillment_held", {
      eventId: event.id,
      stripeSessionId: session.id,
      paymentStatus: policy.paymentStatus,
      reason: policy.reason,
    });
    return {
      mode: "checkout_fulfillment_held",
      stripeSessionId: session.id || null,
      paymentStatus: policy.paymentStatus,
      reason: policy.reason,
    };
  }

  const job = await restoreCheckoutJob(session);
  const sessionSummary = checkoutSessionSummary(session);
  const stripeSubscriptionId = sessionSubscriptionId(session);
  const now = new Date().toISOString();
  const completionStatus = policy.ownerSandboxCheckout
    ? "owner_sandbox_checkout_completed"
    : "paid_checkout_completed";
  const fulfillmentKind = policy.ownerSandboxCheckout ? "owner_sandbox" : "live_paid";
  const initialOrder = {
    stripe_event_id: event.id,
    stripe_session_id: session.id,
    stripe_subscription_id: stripeSubscriptionId || null,
    job_id: job.id,
    customer_email: sessionSummary.customerEmail,
    amount_total: session.amount_total ?? null,
    currency: session.currency || "usd",
    status: "fulfillment_pending",
    payload: {
      ...sessionSummary,
      fulfillmentState: { version: FULFILLMENT_STATE_VERSION, kind: fulfillmentKind, startedAt: now },
    },
    updated_at: now,
  };

  const orderClaim = await insertRow("ghost_agency_orders", initialOrder);
  let claimedOrder;
  if (orderClaim?.mode === "live_write") {
    claimedOrder = requireInsert(orderClaim, "fulfillment_claim_failed");
  } else if (isConfirmedUniqueViolation(
    orderClaim,
    "ghost_agency_orders_stripe_session_id_key",
    /key\s*\(stripe_session_id\)\s*=/i,
  )) {
    claimedOrder = await findOrderBySession(session.id);
    if (!claimedOrder) throw fulfillmentError("fulfillment_claim_missing");
    if (String(claimedOrder.job_id || "") !== String(job.id)) throw fulfillmentError("fulfillment_claim_job_mismatch");
    if (COMPLETED_ORDER_STATUSES.has(claimedOrder.status)) {
      return {
        mode: "checkout_fulfillment_completed_replay",
        jobId: job.id,
        stripeSessionId: session.id,
        completedStatus: claimedOrder.status,
      };
    }
  } else {
    throw fulfillmentError("fulfillment_claim_failed");
  }

  const jobRecord = await upsertRow("ghost_agency_jobs", {
    job_id: job.id,
    business_name: job.prospect.businessName,
    owner_email: job.prospect.ownerEmail || sessionSummary.customerEmail || null,
    status: "checkout_fulfillment_in_progress",
    payload: job,
    updated_at: now,
  }, "job_id");
  requireUpsert(jobRecord, "fulfillment_job_write_failed");

  const entitlement = await upsertRow("ghost_agency_entitlements", {
    job_id: job.id,
    stripe_session_id: session.id,
    stripe_subscription_id: stripeSubscriptionId || null,
    customer_email: sessionSummary.customerEmail,
    product: LOCAL_GROWTH_PRODUCT,
    entitlement: "local_website_launch_job",
    status: policy.ownerSandboxCheckout ? "test_active_pending_delivery" : "active_pending_delivery",
    updated_at: now,
  }, "job_id,product");
  requireUpsert(entitlement, "fulfillment_entitlement_write_failed");

  const inProgressOrder = await upsertRow("ghost_agency_orders", {
    ...initialOrder,
    status: "fulfillment_in_progress",
    payload: {
      ...sessionSummary,
      fulfillmentState: {
        version: FULFILLMENT_STATE_VERSION,
        kind: fulfillmentKind,
        startedAt: claimedOrder.payload?.fulfillmentState?.startedAt || now,
        criticalWritesCompletedAt: new Date().toISOString(),
      },
    },
    updated_at: new Date().toISOString(),
  }, "stripe_session_id");
  requireUpsert(inProgressOrder, "fulfillment_order_checkpoint_failed");

  const desiredDomain = String(sessionSummary.metadata.desiredDomain || "").trim().toLowerCase();
  let buildTicket;
  let zapier;
  let domainFulfillment;
  if (policy.ownerSandboxCheckout) {
    buildTicket = { configured: false, mode: "owner_sandbox_suppressed" };
    zapier = { configured: false, mode: "owner_sandbox_suppressed" };
    domainFulfillment = { ok: false, skipped: true, reason: "owner_sandbox_checkout" };
  } else {
    const buildConfigured = buildDispatchConfigured();
    buildTicket = await runDeliveryStep({
      jobId: job.id,
      stripeSessionId: session.id,
      name: "build_ticket",
      replaySafe: !buildConfigured,
    }, async () => validateBuildTicket(await dispatchWoodwardLabsBuildTicket(job)));

    const zapierConfigured = Boolean(String(process.env.ZAPIER_GHOST_AGENCY_HOOK_URL || "").trim());
    zapier = await runDeliveryStep({
      jobId: job.id,
      stripeSessionId: session.id,
      name: "zapier",
      replaySafe: !zapierConfigured,
    }, async () => validateZapier(await dispatchZapier(job, "ghost_agency_paid_checkout_completed")));

    const requiredContactEnv = [
      "DOMAIN_CONTACT_PHONE",
      "DOMAIN_CONTACT_ADDRESS1",
      "DOMAIN_CONTACT_CITY",
      "DOMAIN_CONTACT_STATE",
      "DOMAIN_CONTACT_ZIP",
    ];
    const missingContactEnv = requiredContactEnv.filter((key) => !process.env[key]);
    if (!desiredDomain) {
      domainFulfillment = { ok: false, skipped: true, reason: "no_desired_domain_on_job" };
    } else if (missingContactEnv.length) {
      throw fulfillmentError("domain_contact_configuration_missing");
    } else {
      const liveDomainPurchase = String(process.env.DOMAIN_PURCHASE_ENABLED || "").toLowerCase() === "true";
      domainFulfillment = await runDeliveryStep({
        jobId: job.id,
        stripeSessionId: session.id,
        name: "domain",
        replaySafe: !liveDomainPurchase,
      }, async () => {
        const result = await fulfillDomainForJob({
          jobId: job.id,
          domain: desiredDomain,
          projectName: sessionSummary.metadata.previewProjectName || job.prospect.previewProjectName || "",
          contactInformation: {
            firstName: sessionSummary.metadata.ownerFirstName || "Owner",
            lastName: sessionSummary.metadata.ownerLastName || job.prospect.businessName || "Business",
            email: sessionSummary.customerEmail || "hello@wss-ai.com",
            phone: process.env.DOMAIN_CONTACT_PHONE,
            address1: process.env.DOMAIN_CONTACT_ADDRESS1,
            city: process.env.DOMAIN_CONTACT_CITY,
            state: process.env.DOMAIN_CONTACT_STATE,
            zip: process.env.DOMAIN_CONTACT_ZIP,
            country: process.env.DOMAIN_CONTACT_COUNTRY || "US",
          },
        });
        if (result?.ok === true) return result;
        throw fulfillmentError("domain_fulfillment_not_confirmed", {
          ambiguous: liveDomainPurchase,
          manualReconciliation: liveDomainPurchase,
        });
      });
    }
  }

  const buildActuallyDispatched = buildTicket.configured === true
    && buildTicket.mode === "http_dispatch"
    && buildTicket.result?.ok === true;
  const deliveryQueue = await upsertRow("ghost_agency_delivery_queue", {
    job_id: job.id,
    stripe_session_id: session.id,
    delivery_type: "woodward_labs_build_ticket",
    status: policy.ownerSandboxCheckout
      ? "test_suppressed"
      : buildActuallyDispatched ? "dispatched" : "handoff_packet_ready",
    payload: { buildTicket, zapier, domainFulfillment },
    updated_at: new Date().toISOString(),
  }, "job_id,delivery_type");
  requireUpsert(deliveryQueue, "fulfillment_delivery_queue_write_failed");

  const dashboardCredentials = deterministicDashboardAccess({
    jobId: job.id,
    stripeSessionId: session.id,
    created: session.created || event.created,
  });
  const siteSlug = slugify(desiredDomain || job.prospect.businessName || job.id);
  const visibilityBusiness = (desiredDomain || job.prospect.businessName || "").trim().toLowerCase();
  const dashboardAccessRecord = await upsertRow("ghost_agency_dashboard_access", {
    job_id: job.id,
    owner_email: sessionSummary.customerEmail.toLowerCase(),
    business_name: job.prospect.businessName,
    site_slug: siteSlug || null,
    visibility_business: visibilityBusiness || null,
    pin_hash: dashboardCredentials.pinHash,
  }, "job_id");
  requireUpsert(dashboardAccessRecord, "fulfillment_dashboard_access_write_failed");

  const businessLogoUrl = await businessLogoUrlForJob(job);
  const activation = buildActivationEmail({
    businessName: job.prospect.businessName,
    ownerEmail: sessionSummary.customerEmail,
    pin: dashboardCredentials.pin,
    magicLink: dashboardCredentials.magicLink,
    jobId: job.id,
    businessLogoUrl,
    // Riley's number is per client: if this prospect record carries a Riley line
    // it wins over the configured agency line, and if neither exists the phone
    // is omitted from the email rather than defaulted (lib/riley-line.js).
    client: job.prospect || null,
  });
  const email = await runDeliveryStep({
    jobId: job.id,
    stripeSessionId: session.id,
    name: "activation_email",
    replaySafe: true,
    idempotencyWindowMs: RESEND_IDEMPOTENCY_WINDOW_MS,
  }, () => sendActivationEmailIdempotent({
    to: sessionSummary.customerEmail,
    activation,
    stripeSessionId: session.id,
  }));

  const dashboardAccess = { ok: true, issued: true };
  const finalNow = new Date().toISOString();
  const completedJob = await upsertRow("ghost_agency_jobs", {
    job_id: job.id,
    business_name: job.prospect.businessName,
    owner_email: job.prospect.ownerEmail || sessionSummary.customerEmail || null,
    status: completionStatus,
    payload: job,
    updated_at: finalNow,
  }, "job_id");
  requireUpsert(completedJob, "fulfillment_job_completion_failed");

  // The order is the replay gate, so it is intentionally the final durable
  // write. A completed order therefore proves every required write and step
  // above finished; retries cannot be dismissed while a job is still partial.
  const order = await upsertRow("ghost_agency_orders", {
    ...initialOrder,
    status: completionStatus,
    payload: {
      ...sessionSummary,
      fulfillmentState: {
        version: FULFILLMENT_STATE_VERSION,
        kind: fulfillmentKind,
        startedAt: claimedOrder.payload?.fulfillmentState?.startedAt || now,
        completedAt: finalNow,
        buildActuallyDispatched,
      },
    },
    updated_at: finalNow,
  }, "stripe_session_id");
  requireUpsert(order, "fulfillment_order_completion_failed");

  await recordEvent("ghost_agency_fulfillment", {
    eventId: event.id,
    jobId: job.id,
    stripeSessionId: session.id,
    completionStatus,
    buildActuallyDispatched,
    domainFulfillment,
    dashboardAccess,
    email: { mode: email.mode, id: email.id },
  });

  // OWN THE ASSETS NOW THAT THEY ARE A CUSTOMER. On the pitch path we hotlink
  // the prospect's own image URLs and pay nothing to store them; but a paying
  // customer will cancel their old provider, that site dies, and every hotlinked
  // URL 404s — taking their new site down with it. So at signup we take
  // ownership of the bytes: download every asset their build references and
  // re-host it on our permanent bucket (lib/asset-ownership.localizeBuild).
  //
  // Only ENQUEUED here — the download/rewrite can be dozens of image fetches and
  // must never sit on this webhook, where a slow host would delay or fail the
  // payment. A drain worker / scripts/localize-assets.js runs the tested job off
  // the critical path. Flag-gated (default off) and wrapped so it can NEVER
  // throw into fulfillment: a localize hiccup must not fail a paid checkout.
  let assetLocalize = { mode: "disabled" };
  if (String(process.env.ASSET_LOCALIZE_ENABLED || "").trim() === "true") {
    try {
      const enqueued = await upsertRow("ghost_agency_delivery_queue", {
        job_id: job.id,
        stripe_session_id: session.id,
        delivery_type: "asset_localize",
        status: "pending",
        payload: {
          version: 1,
          reason: "own_customer_assets_on_signup",
          prospectId: String(job.prospect?.id || job.prospect?.prospect_id || ""),
          customerEmail: sessionSummary.customerEmail,
          ownerSandbox: policy.ownerSandboxCheckout === true,
          enqueuedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, "job_id,delivery_type");
      assetLocalize = representedRow(enqueued) ? { mode: "enqueued" } : { mode: "enqueue_unconfirmed" };
    } catch (error) {
      assetLocalize = { mode: "enqueue_failed", reason: safeError(error).code };
      await recordEvent("ghost_agency_asset_localize_enqueue_failed", {
        jobId: job.id,
        stripeSessionId: session.id,
        reason: safeError(error).code,
      }).catch(() => {});
    }
  }

  // HOTLINK-UNTIL-PAY: THE MIGRATION JOB TRIGGER (docs/standards/
  // hotlink-until-pay.md). Their preview hotlinks the prospect's own media
  // (media_mode:"origin" — zero of their bytes housed, the ≤10¢ mirror). The
  // instant this checkout completes that arrangement has an expiry date: they
  // cancel the old provider, the origin host dies, every hotlinked URL 404s.
  // So a completed checkout enqueues a media_housing_migration job — the drain
  // half (lib/mirror-engine/migrate-housing.js) re-mirrors the prospect with
  // media_mode:"housed" off this webhook's critical path.
  //
  // Same contract as asset_localize above: idempotent upsert keyed
  // (job_id, delivery_type), ENQUEUE ONLY (the re-mirror is dozens of fetches
  // + a deploy and must never sit on this webhook), and wrapped so it can
  // NEVER throw into fulfillment — a migration hiccup must not fail a paid
  // checkout. Unconditionally enqueued: the row is the auditable record that
  // payment happened while the preview was hotlinked, whether or not an
  // origin-mode build exists for this prospect yet.
  let mediaHousingMigration = { mode: "disabled" };
  try {
    const enqueued = await upsertRow("ghost_agency_delivery_queue", {
      job_id: job.id,
      stripe_session_id: session.id,
      delivery_type: "media_housing_migration",
      status: "pending",
      payload: {
        version: 1,
        reason: "hotlink_until_pay_migration_on_payment",
        media_mode: "housed",
        prospectId: String(job.prospect?.id || job.prospect?.prospect_id || ""),
        businessName: String(job.prospect?.businessName || ""),
        customerEmail: sessionSummary.customerEmail,
        ownerSandbox: policy.ownerSandboxCheckout === true,
        enqueuedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }, "job_id,delivery_type");
    mediaHousingMigration = representedRow(enqueued) ? { mode: "enqueued" } : { mode: "enqueue_unconfirmed" };
  } catch (error) {
    mediaHousingMigration = { mode: "enqueue_failed", reason: safeError(error).code };
    await recordEvent("media_housing_migration_enqueue_failed", {
      jobId: job.id,
      stripeSessionId: session.id,
      reason: safeError(error).code,
    }).catch(() => {});
  }

  return {
    mode: policy.ownerSandboxCheckout ? "owner_sandbox_checkout_completed" : "checkout_session_completed",
    jobId: job.id,
    stripeSessionId: session.id,
    jobRecord: completedJob,
    order,
    entitlement,
    deliveryQueue,
    buildTicket,
    zapier,
    domainFulfillment,
    dashboardAccess,
    email,
    assetLocalize,
    mediaHousingMigration,
  };
}

// ---------------------------------------------------------------------------
// MANUAL (OWNER-INVOICED) CHECKOUT PROVISIONING
// ---------------------------------------------------------------------------
// The Stripe path provisions on its own (verified webhook ->
// fulfillCheckoutSession above). But billing can start BEFORE Stripe keys
// exist: the honest /factory-os degradation sells the plan on invoice, and
// the owner confirms payment out of band. Until 2026-09-18 that left a
// manual-only customer with NO dashboard access row and NO welcome email —
// paid, and still locked out of the thing they bought.
//
// This is the smallest honest parallel to the paid path's critical writes:
// job row, entitlement, ghost_agency_dashboard_access (the same shape
// api/connect/dashboard-login.js verifies email+PIN against), and the SAME
// activation email (magic link + PIN). No build dispatch, no domain
// purchase, no order row — those belong to the machine-verified paid flow;
// an invoiced customer's delivery is the owner's deliberate act.
const MANUAL_SESSION_MARKER = "manual-invoice";

async function provisionInvoicedCheckout({
  jobId,
  customerEmail,
  businessName = "",
  desiredDomain = "",
  dryRun = false,
  now = Date.now,
} = {}) {
  const id = String(jobId || "").trim().slice(0, 200);
  const email = String(customerEmail || "").trim().toLowerCase().slice(0, 254);
  if (!id) throw fulfillmentError("provision_job_id_missing");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fulfillmentError("provision_customer_email_invalid");

  // Restore the stored job payload when one exists (the minted checkout link
  // already upserted a ghost_agency_jobs row) so the email speaks about the
  // real business; fall back to a canonical job otherwise.
  const fallback = buildCanonicalJob({
    jobId: id,
    prospect: {
      businessName: businessName || "Paid Local Website Buyer",
      ownerEmail: email,
      city: "",
      state: "",
      industry: "",
      source: "manual_invoice_provisioned",
    },
  });
  let job = fallback;
  try {
    const result = await select(
      "ghost_agency_jobs",
      `select=payload&job_id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    const stored = result?.ok && Array.isArray(result.data) ? result.data[0]?.payload : null;
    if (stored && typeof stored === "object" && stored.id === id && stored.prospect) {
      job = {
        ...stored,
        prospect: {
          ...stored.prospect,
          businessName: stored.prospect.businessName || fallback.prospect.businessName,
          ownerEmail: email || stored.prospect.ownerEmail || "",
        },
      };
    }
  } catch {
    // Best-effort restore; provisioning proceeds on the canonical fallback.
  }

  const at = now();
  const nowIso = new Date(at).toISOString();
  // Same credential pair the paid path issues. The PIN is deterministic per
  // job (it keys on jobId + the manual session marker), so re-provisioning a
  // job never rotates the PIN the customer may already have written down.
  const credentials = deterministicDashboardAccess({
    jobId: id,
    stripeSessionId: MANUAL_SESSION_MARKER,
    created: Math.floor(at / 1000),
  });
  const resolvedBusinessName = String(job.prospect.businessName || businessName || "").trim();
  const resolvedDomain = String(desiredDomain || "").trim().toLowerCase();
  const siteSlug = slugify(resolvedDomain || resolvedBusinessName || id);
  const visibilityBusiness = (resolvedDomain || resolvedBusinessName || "").trim().toLowerCase();

  const jobRecord = await upsertRow("ghost_agency_jobs", {
    job_id: id,
    business_name: resolvedBusinessName,
    owner_email: email,
    status: "invoiced_checkout_completed",
    payload: job,
    updated_at: nowIso,
  }, "job_id");
  requireUpsert(jobRecord, "provision_job_write_failed");

  const entitlement = await upsertRow("ghost_agency_entitlements", {
    job_id: id,
    stripe_session_id: null,
    stripe_subscription_id: null,
    customer_email: email,
    product: LOCAL_GROWTH_PRODUCT,
    entitlement: "local_website_launch_job",
    status: "active_pending_delivery",
    updated_at: nowIso,
  }, "job_id,product");
  requireUpsert(entitlement, "provision_entitlement_write_failed");

  const accessRecord = await upsertRow("ghost_agency_dashboard_access", {
    job_id: id,
    owner_email: email,
    business_name: resolvedBusinessName,
    site_slug: siteSlug || null,
    visibility_business: visibilityBusiness || null,
    pin_hash: credentials.pinHash,
  }, "job_id");
  requireUpsert(accessRecord, "provision_dashboard_access_write_failed");

  let emailResult = { mode: "skipped_dry_run", configured: true };
  if (!dryRun) {
    const businessLogoUrl = await businessLogoUrlForJob(job);
    const activation = buildActivationEmail({
      businessName: resolvedBusinessName,
      ownerEmail: email,
      pin: credentials.pin,
      magicLink: credentials.magicLink,
      jobId: id,
      businessLogoUrl,
      client: job.prospect || null,
    });
    emailResult = await sendActivationEmailIdempotent({
      to: email,
      activation,
      // Per-job idempotency: the key becomes ghost-activation/manual-<jobId>,
      // so a re-provision inside Resend's window is deduplicated by the
      // provider rather than double-sending the same welcome.
      stripeSessionId: `manual-${id}`.slice(0, 256),
    });
  }

  await recordEvent("ghost_agency_manual_provision", {
    jobId: id,
    customerEmail: email,
    businessName: resolvedBusinessName,
    dashboardAccess: { issued: true },
    email: { mode: emailResult.mode, id: emailResult.id || null },
  });

  return {
    mode: "invoiced_checkout_provisioned",
    jobId: id,
    customerEmail: email,
    status: "invoiced_checkout_completed",
    dashboardAccess: { issued: true, magicLink: credentials.magicLink, pin: credentials.pin },
    email: emailResult,
  };
}

module.exports = {
  checkoutFulfillmentPolicy,
  fulfillCheckoutSession,
  provisionInvoicedCheckout,
};
