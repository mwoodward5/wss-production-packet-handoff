"use strict";

// lib/mirror-lead.js — the lead a stranger types into a mirror's quote form.
//
// WHAT WAS BROKEN
// Three of the eleven donors submitted their quote form by setting
// window.location.href = "mailto:" + the client's address. On a desktop with a
// configured mail client that opens a draft the visitor still has to send; on a
// phone it opens nothing anybody finishes. The lead was never captured, so
// there was no row to count, and "your site brought you 7 calls this month" —
// the whole renewal case for a $149/mo subscription — could not be said at all.
// The other four donors DID post to api/quote-request, and that endpoint stored
// the lead and emailed US. It never wrote a Connect thread, so the proof email's
// promise of "one inbox for your messages" was, literally, false: connect_threads
// held three hand-made rows from a July smoke test and nothing else.
//
// WHAT THIS MODULE OWNS
// The parts of lead handling that are decisions rather than plumbing, so they
// can be tested without a database and cannot drift between the endpoint and
// whatever calls it next:
//   · normalizeLeadInput — what counts as a lead at all
//   · originRouteCheck   — whether the posting page may claim this slug
//   · resolveLeadRoute   — WHO the lead belongs to, resolved server-side
//   · leadEmails         — what the client and the owner each read
//   · createRateLimiter  — the public-endpoint burst guard
//
// THE ONE RULE THAT SHAPES ALL OF IT
// The destination address is NEVER taken from the request body. A public,
// unauthenticated endpoint that emails whatever address the caller supplies is
// an open relay wearing our sending domain. The slug is the only thing the page
// gets to assert, and even that is checked against the posting origin.

const { clientReferenceCode } = require("./client-reference");
const { prospectSendsEnabled } = require("./send-policy");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,79}$/;
const MIRROR_HOST_SUFFIX = ".wss-ai.com";

// Field caps. Long enough for a real job description, short enough that a bot
// cannot use the endpoint as free storage.
const CAP = Object.freeze({
  slug: 80,
  name: 120,
  phone: 40,
  email: 160,
  service: 120,
  message: 2000,
  page: 300,
});

function field(value, cap) {
  return String(value == null ? "" : value).trim().slice(0, cap);
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

/** A plausible mailbox. Deliberately loose — Resend is the real judge. */
function looksLikeEmail(value) {
  const v = String(value || "").trim();
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(v) && v.length <= CAP.email;
}

/**
 * normalizeLeadInput(body) -> { ok:true, lead } | { ok:false, error, status }
 *
 * `honeypot` is reported separately from a refusal: a filled honeypot must
 * answer 200 so the bot learns nothing, which is a different outcome from a
 * human who left the form half empty.
 */
function normalizeLeadInput(body = {}) {
  // The donors that already post server-side send `slug`; the injected capture
  // script sends `site`. Accept both so one endpoint serves both generations of
  // built site rather than forking the contract.
  const slug = field(body.slug || body.site, CAP.slug).toLowerCase();
  const lead = {
    slug,
    name: field(body.name || body.contact_name, CAP.name),
    phone: field(body.phone || body.tel, CAP.phone),
    email: field(body.email, CAP.email),
    service: field(body.service || body.subject, CAP.service),
    message: field(body.message || body.notes || body.project, CAP.message),
    page: field(body.page, CAP.page),
  };

  if (field(body.website || body.company_website, 10)) {
    return { ok: false, honeypot: true, lead, error: "honeypot", status: 200 };
  }
  if (!SLUG_RE.test(slug)) {
    return { ok: false, lead, error: "bad_slug", status: 400 };
  }
  // A lead our client cannot answer is not a lead. A name alone is not a way
  // to reach anybody, so a phone or an email is the floor.
  if (!lead.phone && !lead.email) {
    return { ok: false, lead, error: "need_a_phone_or_email", status: 400 };
  }
  return { ok: true, lead };
}

/** The stable identity of the person writing in, for thread de-duplication. */
function leadContactKey(lead = {}) {
  const email = String(lead.email || "").trim().toLowerCase();
  if (email) return email;
  const digits = String(lead.phone || "").replace(/\D/g, "").slice(-10);
  if (digits) return digits;
  return String(lead.name || "anon").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40) || "anon";
}

/**
 * The Connect thread key. Same shape api/connect/ingest.js already writes
 * (`<slug>:<channel>:<contact>`), so a lead that arrives twice from the same
 * person lands as two messages in one thread rather than two threads.
 */
function leadThreadKey(slug, lead = {}) {
  return `${slug}:form:${leadContactKey(lead)}`.slice(0, 300);
}

/** "https://wss-test-foo.wss-ai.com/contact" -> "wss-test-foo" */
function slugFromHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let host = "";
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (!host.endsWith(MIRROR_HOST_SUFFIX)) return "";
  return host.slice(0, -MIRROR_HOST_SUFFIX.length).split(".").pop() || "";
}

/**
 * originRouteCheck(headers, slug) -> { trusted, reason }
 *
 * Whether the posting page is allowed to claim this slug for ROUTING. It is
 * deliberately NOT a rejection: a lead is never thrown away because a header
 * was missing or odd. An untrusted origin only costs the lead its route — it
 * still lands in Connect and in the owner's inbox, and the owner is told why.
 * That split is the point: fail closed on WHERE IT GOES, fail open on WHETHER
 * WE KEEP IT.
 */
function originRouteCheck(headers = {}, slug = "") {
  const origin = String(headers.origin || headers.Origin || "").trim();
  const referer = String(headers.referer || headers.Referer || headers.referrer || "").trim();
  const stated = origin || referer;
  if (!stated) return { trusted: false, reason: "no_origin_header" };
  const fromHost = slugFromHost(stated);
  if (!fromHost) return { trusted: false, reason: "origin_not_a_mirror_host" };
  if (fromHost !== slug) return { trusted: false, reason: `origin_slug_mismatch:${fromHost}` };
  return { trusted: true, reason: "" };
}

function unwrapRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

/**
 * resolveLeadRoute({ slug, select, env }) -> route
 *
 * route = {
 *   mode,            "customer" | "prospect_live" | "prospect_held" | "unknown"
 *   deliverTo,       the address the CLIENT copy goes to, "" when none
 *   heldTo,          the address we WOULD use, when mode is prospect_held
 *   businessName, clientId, prospectId, heldReason, lookup
 * }
 *
 * WHY A PAID CUSTOMER AND A PROSPECT ARE NOT THE SAME RECIPIENT
 * Every mirror live today belongs to a business that has not bought anything.
 * Forwarding a stranger's enquiry to them would be an unsolicited email from
 * our sending domain to a company that never opted in — the exact delivery this
 * codebase locks behind GHOST_AGENCY_PROSPECT_SEND_ENABLED everywhere else. So
 * a prospect mirror's lead is HELD: stored, threaded, and mailed to the owner,
 * with the address it would have used named in the response. The same env
 * switch that authorises every other prospect delivery authorises this one; no
 * new flag, no second opinion about what "authorised" means.
 *
 * A PAID CUSTOMER is different in kind. lib/fulfillment.js writes a
 * ghost_agency_dashboard_access row at checkout keyed on the site slug, and
 * lib/wss-connect-assets/magic-link.js writes one for prospects too — namespaced
 * `prospect-<id>` precisely so the two can never be confused. A non-prospect
 * job_id on that row is a completed checkout, and mailing a customer the leads
 * their own website produced is the product, not outreach.
 */
async function resolveLeadRoute({ slug, select, env = process.env } = {}) {
  const route = {
    mode: "unknown",
    deliverTo: "",
    heldTo: "",
    businessName: "",
    clientId: "",
    prospectId: "",
    heldReason: "",
    lookup: { access_rows: 0, prospect_rows: 0, errors: [] },
  };
  const clean = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(clean) || typeof select !== "function") {
    route.heldReason = "no_lookup_available";
    return route;
  }

  // 1. A paid customer bound to this exact slug.
  try {
    const rows = unwrapRows(await select(
      "ghost_agency_dashboard_access",
      `?select=job_id,owner_email,business_name,site_slug&site_slug=eq.${encodeURIComponent(clean)}&limit=5`,
    ));
    route.lookup.access_rows = rows.length;
    const paid = rows.filter((r) => !String(r.job_id || "").startsWith("prospect-") && looksLikeEmail(r.owner_email));
    if (paid.length === 1) {
      route.mode = "customer";
      route.deliverTo = String(paid[0].owner_email).trim();
      route.businessName = String(paid[0].business_name || "").trim();
      return route;
    }
    if (paid.length > 1) {
      // Two paid accounts claiming one site is the wrong-client hazard. Never
      // pick; the owner reconciles it by hand.
      route.heldReason = "multiple_paid_accounts_claim_this_site";
      return route;
    }
  } catch (error) {
    route.lookup.errors.push(`access:${error && error.message ? error.message : String(error)}`);
  }

  // 2. The prospect whose preview host IS this slug.
  try {
    const rows = unwrapRows(await select(
      "ghost_agency_prospects",
      `?select=prospect_id,business_name,email,phone,preview_url&preview_url=ilike.*${encodeURIComponent(clean)}*&limit=25`,
    ));
    const exact = rows.filter((r) => slugFromHost(r.preview_url) === clean);
    route.lookup.prospect_rows = exact.length;
    if (exact.length === 1) {
      const row = exact[0];
      route.businessName = String(row.business_name || "").trim();
      route.prospectId = String(row.prospect_id || "").trim();
      route.clientId = clientReferenceCode(row) || "";
      const to = looksLikeEmail(row.email) ? String(row.email).trim() : "";
      if (!to) {
        route.mode = "prospect_held";
        route.heldReason = "prospect_has_no_email_on_file";
        return route;
      }
      if (prospectSendsEnabled(env)) {
        route.mode = "prospect_live";
        route.deliverTo = to;
        return route;
      }
      route.mode = "prospect_held";
      route.heldTo = to;
      route.heldReason = "owner_locked:GHOST_AGENCY_PROSPECT_SEND_ENABLED";
      return route;
    }
    if (exact.length > 1) {
      route.heldReason = "multiple_prospects_claim_this_site";
      return route;
    }
  } catch (error) {
    route.lookup.errors.push(`prospects:${error && error.message ? error.message : String(error)}`);
  }

  route.heldReason = route.heldReason || "no_client_record_for_this_slug";
  return route;
}

function rowsHtml(pairs) {
  return pairs
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#6a6a60;font:600 13px -apple-system,Segoe UI,sans-serif;vertical-align:top;white-space:nowrap">${esc(k)}</td>`
      + `<td style="padding:6px 0;font:400 14px -apple-system,Segoe UI,sans-serif;color:#14140f">${esc(v)}</td></tr>`)
    .join("");
}

function rowsText(pairs) {
  return pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
}

/**
 * leadEmails({ slug, lead, route }) -> { client, owner }
 *
 * Two different readers. The CLIENT gets a message about their own customer and
 * nothing about us. The OWNER gets the same lead plus the routing verdict —
 * including, when it was held, the address it would have gone to and why it
 * did not. `client` is null when there is nobody to send it to.
 */
function leadEmails({ slug, lead, route }) {
  const pairs = [
    ["Name", lead.name],
    ["Phone", lead.phone],
    ["Email", lead.email],
    ["Service", lead.service],
    ["Message", lead.message],
    ["Page", lead.page],
  ];
  const who = route.businessName || slug;
  const replyTo = looksLikeEmail(lead.email) ? lead.email : undefined;

  const client = route.deliverTo
    ? {
        to: route.deliverTo,
        replyTo,
        subject: `New enquiry from your website${lead.name ? ` — ${lead.name}` : ""}`,
        text: [
          `Somebody filled in the quote form on ${who}'s website.`,
          "",
          rowsText(pairs),
          "",
          replyTo ? `Reply to this email and it goes straight back to them.` : "Call them back on the number above.",
        ].join("\n"),
        html: `<div style="max-width:560px;font-family:-apple-system,Segoe UI,sans-serif;color:#14140f">`
          + `<h2 style="font-size:17px;margin:0 0 4px">New enquiry from your website</h2>`
          + `<p style="margin:0 0 16px;color:#6a6a60;font-size:13px">Somebody filled in the quote form on ${esc(who)}&rsquo;s site.</p>`
          + `<table style="border-collapse:collapse">${rowsHtml(pairs)}</table>`
          + `<p style="color:#6a6a60;font-size:12px;margin-top:18px">${replyTo ? "Reply to this email and it goes straight back to them." : "Call them back on the number above."}</p>`
          + `</div>`,
      }
    : null;

  const verdict = route.deliverTo
    ? `Forwarded to ${route.deliverTo} (${route.mode}).`
    : `NOT forwarded — ${route.heldReason || "no recipient resolved"}${route.heldTo ? ` (would go to ${route.heldTo})` : ""}.`;

  const owner = {
    subject: `Mirror lead — ${slug}${lead.name ? ` — ${lead.name}` : ""}`,
    replyTo,
    text: [
      `New quote request from the ${slug} mirror.`,
      route.businessName ? `Business: ${route.businessName}` : "",
      route.clientId ? `Client ID: ${route.clientId}` : "",
      "",
      rowsText(pairs),
      "",
      verdict,
    ].filter((l) => l !== "").join("\n"),
    html: `<div style="max-width:560px;font-family:-apple-system,Segoe UI,sans-serif;color:#14140f">`
      + `<h2 style="font-size:17px;margin:0 0 4px">New quote request from the ${esc(slug)} mirror</h2>`
      + (route.businessName ? `<p style="margin:0 0 16px;color:#6a6a60;font-size:13px">${esc(route.businessName)}${route.clientId ? ` &middot; ${esc(route.clientId)}` : ""}</p>` : "")
      + `<table style="border-collapse:collapse">${rowsHtml(pairs)}</table>`
      + `<p style="color:#8a8a80;font-size:12px;margin-top:18px">${esc(verdict)}</p>`
      + `</div>`,
  };

  return { client, owner };
}

/**
 * createRateLimiter({ windowMs, max, now }) -> { hit(key) -> boolean }
 *
 * Per-instance, in-memory, best effort — serverless instances are ephemeral, so
 * this blunts a burst rather than enforcing a global quota. It is the first of
 * three guards on a public endpoint (honeypot, this, and a hard cap on how many
 * emails one warm instance will fan out); the real backstop is that a stranger
 * can never choose the recipient.
 */
function createRateLimiter({ windowMs = 60_000, max = 8, now = Date.now } = {}) {
  const seen = new Map();
  return {
    hit(key) {
      const t = now();
      const k = String(key || "unknown");
      const entry = seen.get(k);
      if (!entry || t - entry.start > windowMs) {
        seen.set(k, { start: t, count: 1 });
        // Bound the map so a spray across many keys cannot grow it without end.
        if (seen.size > 5000) {
          for (const [oldKey, e] of seen) {
            if (t - e.start > windowMs) seen.delete(oldKey);
          }
        }
        return false;
      }
      entry.count += 1;
      return entry.count > max;
    },
  };
}

function clientIp(req) {
  return String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim()
    || req?.socket?.remoteAddress
    || "unknown";
}

module.exports = {
  CAP,
  SLUG_RE,
  clientIp,
  createRateLimiter,
  leadContactKey,
  leadEmails,
  leadThreadKey,
  looksLikeEmail,
  normalizeLeadInput,
  originRouteCheck,
  resolveLeadRoute,
  slugFromHost,
};
