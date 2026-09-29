"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");
const { publicConfig } = require("./registry");

const LINK_BUCKET_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_EXPIRY_BUCKETS = 7;
const MAX_LINK_NOW_MS = Number.MAX_SAFE_INTEGER - (LINK_EXPIRY_BUCKETS * LINK_BUCKET_MS);

// The operator override. A plain https URL here (a hosted Stripe payment link,
// say) is used verbatim for every prospect; it is named as data so a refusal can
// print the variable somebody actually has to set.
const CHECKOUT_URL_ENV_NAME = "GHOST_AGENCY_CHECKOUT_URL";
const CHECKOUT_SECRET_ENV_NAME = "GHOST_AGENCY_CHECKOUT_LINK_SECRET";

function secret(env = process.env) {
  return String((env && env[CHECKOUT_SECRET_ENV_NAME]) || "").trim();
}

function signature(token, env = process.env) {
  return createHmac("sha256", secret(env)).update(token).digest("base64url");
}

function checkoutLinkStatus() {
  return { configured: Boolean(secret()), mode: secret() ? "signed_redirect" : "contact_fallback" };
}

function normalizeNow(now) {
  let value;
  try {
    value = typeof now === "function" ? now() : now;
  } catch {
    return null;
  }
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (typeof milliseconds !== "number") return null;
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > MAX_LINK_NOW_MS) return null;
  return Math.floor(milliseconds);
}

function buildCheckoutLink({ prospect = {}, job = {}, env = process.env, now = Date.now } = {}) {
  if (!secret(env)) return "";
  const nowMs = normalizeNow(now);
  if (nowMs === null) return "";
  // A prospect rebuilt inside the same UTC epoch week must produce the exact
  // same HTML bytes. Expiring seven buckets after this bucket began leaves
  // between 42 and 49 days on the link without putting Date.now() in the page.
  const bucketStart = Math.floor(nowMs / LINK_BUCKET_MS) * LINK_BUCKET_MS;
  const payload = {
    v: 1,
    exp: bucketStart + (LINK_EXPIRY_BUCKETS * LINK_BUCKET_MS),
    job_id: String(job.id || "").slice(0, 160),
    prospect_id: String(prospect.prospect_id || prospect.id || "").slice(0, 160),
    business_name: String(prospect.business_name || prospect.businessName || prospect.name || "Local Business").slice(0, 180),
    industry: String(prospect.industry || prospect.category || "local service").slice(0, 100),
    city: String(prospect.city || "").slice(0, 100),
    state: String(prospect.state || "").slice(0, 10),
  };
  const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const base = publicConfig().apiUrl.replace(/\/+$/, "");
  return `${base}/api/checkout-link?token=${encodeURIComponent(token)}&sig=${encodeURIComponent(signature(token, env))}`;
}

/**
 * prospectCheckoutUrl({ prospect, env }) -> "" | https url
 *
 * THE ONE WAY THE MIRROR LANE TURNS A PROSPECT INTO A BUY LINK.
 *
 * buildCheckoutLink has existed since the SiteForge lane and had exactly one
 * caller in this repo outside an admin route: lib/siteforge.js, which stamps it
 * into a payload the mirror lane does not send. So the whole machine downstream
 * of payment was built and nobody could pay — the sign-up panel's `checkoutUrl`
 * was fed only by an environment variable that has never been set, and the proof
 * email had no checkout surface at all.
 *
 * FAIL CLOSED, IN BOTH DIRECTIONS. Two things can make a link a lie:
 *
 *   * NO SIGNING SECRET. verifyCheckoutLink() refuses every token when
 *     GHOST_AGENCY_CHECKOUT_LINK_SECRET is unset, so a link minted without it
 *     would 401 the moment a business clicked it. buildCheckoutLink already
 *     returns "" in that case and this returns "" with it.
 *
 *   * NO PROSPECT. The signed payload identifies WHO is buying; without a
 *     prospect id the click lands on a checkout session attached to nobody, the
 *     job row keys on an empty string, and fulfilment has no one to fulfil for.
 *     That is refused here rather than papered over with a placeholder.
 *
 * An empty string is the honest answer, and every caller is written so that ""
 * removes the button entirely. A dead buy link is worse than no buy link.
 *
 * THE JOB ID IS DERIVED, NOT INVENTED. `mirror-<prospect_id>` is stable for a
 * prospect, which is what makes the link idempotent: re-minting for the same
 * business (a rebuild, a second email) addresses the same job row instead of
 * opening a second one. It matches the `warmup-<prospect_id>` convention
 * api/admin/mint-checkout-links.js already uses.
 */
function prospectCheckoutUrl({ prospect = {}, env = process.env } = {}) {
  const override = String((env && env[CHECKOUT_URL_ENV_NAME]) || "").trim();
  // An explicitly configured URL wins: somebody set it on purpose, and silently
  // preferring our own minted link would ignore a deliberate operator decision.
  if (/^https:\/\//i.test(override)) return override;
  const record = prospect && typeof prospect.record === "object" && prospect.record ? prospect.record : {};
  const prospectId = String(
    prospect.prospect_id || prospect.id || prospect.prospectId || record.prospect_id || "",
  ).trim();
  if (!prospectId) return "";
  if (!secret(env)) return "";
  return buildCheckoutLink({
    prospect: {
      prospect_id: prospectId,
      business_name: prospect.business_name || prospect.businessName || prospect.name || record.business_name || "",
      industry: prospect.industry || prospect.category || record.industry || "",
      city: prospect.city || record.city || "",
      state: prospect.state || record.state || "",
    },
    job: { id: `mirror-${prospectId}`.slice(0, 160) },
    env,
  });
}

function verifyCheckoutLink(token, sig) {
  if (!secret() || !token || !sig) return { ok: false, reason: "checkout_link_not_configured" };
  const expected = signature(String(token));
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(String(sig));
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, reason: "invalid_signature" };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(String(token), "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  // A MISSING EXPIRY IS AN EXPIRED ONE. `Number(undefined) < Date.now()` is
  // NaN < n, which is FALSE, so a token carrying no `exp` never expired — it was
  // a permanent bearer credential for as long as the signing secret lived. That
  // mattered least while nothing minted checkout links; it matters most now that
  // every proof email carries one.
  const exp = Number(payload.exp);
  if (payload.v !== 1 || !payload.job_id) return { ok: false, reason: "invalid_payload" };
  if (!Number.isFinite(exp) || exp <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

module.exports = {
  buildCheckoutLink,
  prospectCheckoutUrl,
  checkoutLinkStatus,
  verifyCheckoutLink,
  CHECKOUT_URL_ENV_NAME,
  CHECKOUT_SECRET_ENV_NAME,
};
