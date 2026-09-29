const { createHmac, timingSafeEqual } = require("node:crypto");
const { buildCanonicalJob } = require("./packets");
const { hashObject } = require("./http");
const { providerStatus, publicConfig } = require("./registry");
const { recordEvent, upsertRow } = require("./store");

const STRIPE_API_VERSION = "2026-02-25.clover";
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
const LOCAL_GROWTH_PRODUCT = "local-growth-website-plan";

function localGrowthPriceId(env = process.env) {
  return String(
    env.STRIPE_LOCAL_GROWTH_PRICE_ID
      || env.STRIPE_WEBSITE_GROWTH_PRICE_ID
      || env.STRIPE_GHOST_AGENCY_PRICE_ID
      || "",
  ).trim();
}

function localGrowthAmountCents(env = process.env) {
  const configured = Number.parseInt(String(env.STRIPE_LOCAL_GROWTH_AMOUNT_CENTS || "19900"), 10);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 19900;
}

function localGrowthCurrency(env = process.env) {
  const configured = String(env.STRIPE_LOCAL_GROWTH_CURRENCY || "usd").trim().toLowerCase();
  return /^[a-z]{3}$/.test(configured) ? configured : "usd";
}

function checkoutContractHash(contract = {}) {
  const priceId = String(contract.priceId || "").trim();
  const amountCents = Number.parseInt(String(contract.amountCents || ""), 10);
  const currency = String(contract.currency || "").trim().toLowerCase();
  const secret = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!priceId || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !/^[a-z]{3}$/.test(currency) || !secret) return "";
  return createHmac("sha256", secret)
    .update(`ghost-agency-checkout-contract:v1:${priceId}:${amountCents}:${currency}`)
    .digest("hex");
}

function verifyCheckoutContractHash(metadata = {}) {
  const actual = String(metadata.checkoutContractHash || "").trim().toLowerCase();
  const expected = checkoutContractHash({
    priceId: metadata.checkoutPriceId,
    amountCents: metadata.checkoutAmountCents,
    currency: metadata.checkoutCurrency,
  });
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function testPromotionHash(promotionCodeId = process.env.STRIPE_TEST_PROMOTION_CODE_ID) {
  const promotion = String(promotionCodeId || "").trim();
  const secret = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!promotion || !secret) return "";
  return createHmac("sha256", secret)
    .update(`ghost-agency-test-promotion:v1:${promotion}`)
    .digest("hex");
}

function verifyTestPromotionHash(candidate) {
  const actual = String(candidate || "").trim().toLowerCase();
  const expected = testPromotionHash();
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

async function createCheckoutSession(input = {}, trusted = {}) {
  // FAIL CLOSED on live-mode Stripe, for every caller of this function alike
  // (api/checkout-link.js, the orphaned api/launch.js, api/proof/stripe-chain.js,
  // and anything future). Standing rule: test mode only unless explicitly
  // overridden. The deployed env was found carrying a live key on 2026-07-18;
  // api/launch.js grew its own copy of this guard that day, but the actual
  // production checkout path (api/checkout-link.js -> this function) had no
  // equivalent, so a repeat of that incident would not have been caught on
  // the path real customers click. Centralizing here means every caller
  // inherits it. Set STRIPE_ALLOW_LIVE=true deliberately to lift this.
  if (
    String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live") &&
    String(process.env.STRIPE_ALLOW_LIVE || "").trim().toLowerCase() !== "true"
  ) {
    throw new Error(
      "stripe_live_key_blocked: STRIPE_SECRET_KEY is a live key and STRIPE_ALLOW_LIVE is not set to true. Refusing to create a checkout session.",
    );
  }
  const status = providerStatus().stripe;
  const job = input.job?.id && input.job?.prospect
    ? input.job
    : buildCanonicalJob({
      ...input,
      jobId: input.job?.id || input.jobId,
      prospect: input.prospect || input.job?.prospect,
    });
  const stripeJobId = String(job.id || "").slice(0, 200);
  const stripeBusinessName = String(job.prospect.businessName || "").slice(0, 500);
  const checkoutEmail = String(job.prospect.ownerEmail || "").trim().toLowerCase().slice(0, 254);
  // Local Growth has one server-owned price. Request bodies and legacy
  // prospect fields cannot select a different charge.
  const priceId = localGrowthPriceId();
  const mode = String(process.env.STRIPE_CHECKOUT_MODE || "subscription").trim().toLowerCase();
  if (mode !== "subscription") {
    throw new Error("stripe_checkout_mode_unsupported: Local Growth checkout requires subscription mode.");
  }
  const checkoutAmountCents = localGrowthAmountCents();
  const checkoutCurrency = localGrowthCurrency();
  const contractHash = checkoutContractHash({ priceId, amountCents: checkoutAmountCents, currency: checkoutCurrency });
  const config = publicConfig();
  const successUrl =
    (trusted.allowRedirectOverride === true ? input.successUrl : "") ||
    process.env.STRIPE_LOCAL_GROWTH_SUCCESS_URL ||
    process.env.STRIPE_SUCCESS_URL ||
    `${config.publicAppUrl}/factory-os?checkout=success&job=${encodeURIComponent(job.id)}`;
  const cancelUrl =
    (trusted.allowRedirectOverride === true ? input.cancelUrl : "") ||
    process.env.STRIPE_LOCAL_GROWTH_CANCEL_URL ||
    process.env.STRIPE_CANCEL_URL ||
    `${config.publicAppUrl}/factory-os?checkout=cancelled&job=${encodeURIComponent(job.id)}`;

  if (!status.configured) {
    return {
      mode: "dry_run",
      configured: false,
      jobId: job.id,
      reason:
        "STRIPE_SECRET_KEY and/or STRIPE_LOCAL_GROWTH_PRICE_ID not configured; legacy STRIPE_GHOST_AGENCY_PRICE_ID is accepted as a fallback.",
      plannedSession: {
        mode,
        priceId: priceId || "missing",
        successUrl,
        cancelUrl,
        customerEmail: checkoutEmail || undefined,
        metadata: {
          jobId: stripeJobId,
          product: LOCAL_GROWTH_PRODUCT,
          offer: "done-for-you-local-website-growth",
          businessName: stripeBusinessName,
        },
      },
    };
  }

  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("client_reference_id", stripeJobId);
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[jobId]", stripeJobId);
  params.set("metadata[product]", LOCAL_GROWTH_PRODUCT);
  params.set("metadata[offer]", "done-for-you-local-website-growth");
  params.set("metadata[businessName]", stripeBusinessName);
  params.set("metadata[checkoutPriceId]", priceId);
  params.set("metadata[checkoutAmountCents]", String(checkoutAmountCents));
  params.set("metadata[checkoutCurrency]", checkoutCurrency);
  params.set("metadata[checkoutContractHash]", contractHash);
  if (mode === "subscription") {
    // Keep this product isolated from Mission Control when Stripe later emits
    // customer.subscription.* events whose object is the Subscription itself.
    params.set("subscription_data[metadata][product]", LOCAL_GROWTH_PRODUCT);
    params.set("subscription_data[metadata][checkoutPriceId]", priceId);
    params.set("subscription_data[metadata][checkoutAmountCents]", String(checkoutAmountCents));
    params.set("subscription_data[metadata][checkoutCurrency]", checkoutCurrency);
    params.set("subscription_data[metadata][checkoutContractHash]", contractHash);
  }
  // ---- Server-owned $0 test checkout ----
  // Only when the flag, promotion code, test key, and server-owned owner email
  // all match. Nothing in the public request body can enable test checkout.
  const testPromo = String(process.env.STRIPE_TEST_PROMOTION_CODE_ID || "").trim();
  const testCheckoutEnabled = String(process.env.STRIPE_TEST_CHECKOUT_ENABLED || "").trim() === "true";
  const keyIsTest = String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test_");
  const ownerEmail = String(process.env.GHOST_AGENCY_OWNER_EMAIL || process.env.LOCAL_GROWTH_OWNER_EMAIL || "").trim().toLowerCase();
  if (testCheckoutEnabled && !keyIsTest) {
    // Mode guard: a "free test checkout" flag with a LIVE key is a
    // misconfiguration that could give away real production subscriptions.
    throw new Error("stripe_mode_mismatch: STRIPE_TEST_CHECKOUT_ENABLED is set but STRIPE_SECRET_KEY is not a test key. Refusing to create the session.");
  }
  if (testCheckoutEnabled && !testPromo) {
    throw new Error("stripe_test_checkout_misconfigured: STRIPE_TEST_PROMOTION_CODE_ID is required when test checkout is enabled.");
  }
  const isOwnerSandboxCheckout = testCheckoutEnabled
    && keyIsTest
    && mode === "subscription"
    && Boolean(testPromo)
    && Boolean(ownerEmail)
    && trusted.ownerSandboxAuthorized === true
    && checkoutEmail === ownerEmail;
  const promotionHash = isOwnerSandboxCheckout ? testPromotionHash(testPromo) : "";
  if (isOwnerSandboxCheckout) {
    // Stripe rejects allow_promotion_codes together with discounts[]; the
    // automatic test discount replaces manual code entry.
    params.set("discounts[0][promotion_code]", testPromo);
    params.set("payment_method_collection", "if_required");
    params.set("wallet_options[link][display]", "never");
    params.set("metadata[testCheckout]", "true");
    params.set("metadata[testPromotionHash]", promotionHash);
    params.set("subscription_data[metadata][testCheckout]", "true");
    params.set("subscription_data[metadata][testPromotionHash]", promotionHash);
  } else {
    params.set("allow_promotion_codes", "true");
  }
  const desiredDomain = String(input.desiredDomain || job.prospect.desiredDomain || "").trim().toLowerCase().slice(0, 253);
  if (desiredDomain) {
    params.set("metadata[desiredDomain]", desiredDomain);
  }
  // Carries the prospect's already-deployed Vercel project name (if the
  // caller has one) through to the webhook, so fulfillDomainForJob() has
  // something to attach a purchased domain to instead of silently no-oping.
  // See lib/fulfillment.js's read of sessionSummary.metadata.previewProjectName.
  const previewProjectName = String(input.previewProjectName || job.prospect.previewProjectName || "").trim().slice(0, 200);
  if (previewProjectName) {
    params.set("metadata[previewProjectName]", previewProjectName);
  }
  if (checkoutEmail) {
    params.set("customer_email", checkoutEmail);
  }

  await upsertRow("ghost_agency_jobs", {
    job_id: job.id,
    business_name: job.prospect.businessName,
    owner_email: job.prospect.ownerEmail || null,
    status: "checkout_session_requested",
    payload: job,
    updated_at: new Date().toISOString(),
  }, "job_id");

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
      "Idempotency-Key": `ghost_checkout_${hashObject({
        request: input.idempotencyKey || job.id,
        priceId,
        mode,
        successUrl,
        cancelUrl,
        checkoutEmail,
        desiredDomain,
        paymentMethodCollection: isOwnerSandboxCheckout ? "if_required" : "always",
        testPromotionHash: promotionHash,
        checkoutContractHash: contractHash,
      })}`,
    },
    body: params,
  });
  const json = await response.json().catch(() => ({}));
  await recordEvent("stripe_checkout_session", { jobId: job.id, status: response.status, json });
  if (!response.ok) {
    return {
      mode: "checkout_failed",
      configured: true,
      status: response.status,
      error: json,
    };
  }
  await upsertRow("ghost_agency_checkout_sessions", {
    job_id: job.id,
    stripe_session_id: json.id,
    checkout_url: json.url,
    status: "created",
    payload: {
      id: json.id,
      mode: json.mode,
      payment_status: json.payment_status,
      status: json.status,
      customer_email: json.customer_email,
      client_reference_id: json.client_reference_id,
      metadata: json.metadata,
    },
    updated_at: new Date().toISOString(),
  }, "stripe_session_id");
  return {
    mode: "checkout_session",
    configured: true,
    ownerSandboxCheckout: isOwnerSandboxCheckout,
    jobId: job.id,
    sessionId: json.id,
    url: json.url,
  };
}

function verifyStripeSignature(rawBody, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return { verified: false, configured: false, reason: "STRIPE_WEBHOOK_SECRET not configured" };
  }
  if (!header) {
    return { verified: false, configured: true, reason: "Stripe-Signature header missing" };
  }

  let timestamp = "";
  const signatures = [];
  for (const item of String(header).split(",")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) {
    return { verified: false, configured: true, reason: "Stripe signature format invalid" };
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds) || timestampSeconds <= 0) {
    return { verified: false, configured: true, reason: "Stripe signature timestamp invalid" };
  }
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (ageSeconds > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    return {
      verified: false,
      configured: true,
      reason: "Stripe signature timestamp outside tolerance",
    };
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const verified = signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const actualBuffer = Buffer.from(signature, "hex");
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  });
  return { verified, configured: true };
}

module.exports = {
  LOCAL_GROWTH_PRODUCT,
  STRIPE_API_VERSION,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  checkoutContractHash,
  createCheckoutSession,
  localGrowthAmountCents,
  localGrowthCurrency,
  localGrowthPriceId,
  testPromotionHash,
  verifyCheckoutContractHash,
  verifyTestPromotionHash,
  verifyStripeSignature,
};
