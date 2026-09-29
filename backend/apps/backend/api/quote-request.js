"use strict";
// api/quote-request.js — PUBLIC lead-capture endpoint for mirror quote forms.
//
// Every mirror's quote form posts here: the four donors that already did, and
// now every donor, via the capture script lib/mirror-engine/lead-capture.js
// injects at build time in front of the three that navigated to a mailto:.
//
// WHAT CHANGED, AND WHY IT MATTERED
// This endpoint stored the lead as an event and emailed the WSS owner. Two
// things were missing and both were promises we had already made:
//
//   1. NOTHING WROTE TO connect_threads. The proof email sells WSS Connect —
//      "one inbox for your messages" — and that table held three rows from a
//      July smoke test and not one real lead. The promise was false. A lead now
//      lands as a thread + message on the site's own slug, which is the key the
//      Connect dashboard already scopes a customer's token to.
//
//   2. THE LEAD NEVER REACHED THE CLIENT. It is their customer, on their site.
//      Routing is resolved SERVER-SIDE from the slug (lib/mirror-lead.js) and
//      never from the request body — a public endpoint that mails whatever
//      address the caller supplies is an open relay wearing our sending domain.
//
// WHO ACTUALLY GETS THE EMAIL
//   · a PAID customer bound to this slug -> them. Their leads are the product.
//   · a PROSPECT preview -> HELD, unless GHOST_AGENCY_PROSPECT_SEND_ENABLED is
//     on. Every mirror live today belongs to a business that has not bought
//     anything; forwarding a stranger's enquiry to them would be an unsolicited
//     email from our domain, which is the exact delivery that switch locks
//     everywhere else in this codebase.
//   · the owner, ALWAYS, whichever of those happened — so a held lead is a lead
//     someone can still act on within the hour, not a row in a table.
//
// Abuse posture: honeypot, per-IP burst limit, per-slug burst limit, field
// length caps, a hard cap on email fan-out per warm instance, and an origin
// check that can only ever downgrade the ROUTE — never discard the lead.

const { waitUntil } = require("@vercel/functions");
const { recordEvent, select } = require("../lib/store");
const { sendResendEmail } = require("../lib/email");
const { ensureThread, addMessage, touchThread } = require("../lib/connect");
const { sendConnectPush } = require("../lib/connect-push");
const {
  clientIp,
  createRateLimiter,
  leadEmails,
  leadThreadKey,
  normalizeLeadInput,
  originRouteCheck,
  resolveLeadRoute,
} = require("../lib/mirror-lead");

const MAX_PER_INSTANCE = 30; // email fan-out per warm instance — generous for real use
let sentThisInstance = 0;

// Two windows. A single abusive client is caught by IP; a distributed spray at
// one client's form is caught by slug, which is what actually protects the
// business whose inbox is on the other end.
const byIp = createRateLimiter({ windowMs: 60_000, max: 8 });
const bySlug = createRateLimiter({ windowMs: 60_000, max: 20 });

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") { res.statusCode = 405; return res.end("method not allowed"); }

  try {
    let body = req.body;
    if (!body || typeof body !== "object") {
      const raw = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d || "{}")); });
      try { body = JSON.parse(raw); } catch { body = {}; }
    }

    const parsed = normalizeLeadInput(body);
    if (!parsed.ok) {
      // A tripped honeypot answers 200 and sends nothing, so the bot learns
      // nothing about which field gave it away.
      if (parsed.honeypot) return json(res, 200, { ok: true });
      return json(res, parsed.status || 400, { ok: false, error: parsed.error });
    }
    const lead = parsed.lead;
    const slug = lead.slug;

    if (byIp.hit(clientIp(req)) || bySlug.hit(slug)) {
      return json(res, 429, { ok: false, error: "rate_limited" });
    }

    // The origin check never rejects. A lead is not thrown away because a
    // header was missing; an untrusted origin only costs it its route.
    const origin = originRouteCheck(req.headers || {}, slug);

    // PERSIST FIRST, EMAIL SECOND. A lead that reaches us must survive even if
    // the mail provider is down, so the write is awaited and its result is
    // reported back to the caller — never swallowed.
    const leadId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const persisted = await recordEvent("ghost_agency_mirror_lead", {
      leadId,
      slug,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      service: lead.service,
      message: lead.message,
      page: lead.page,
      originTrusted: origin.trusted,
      receivedAt: new Date().toISOString(),
    }).catch((e) => ({ mode: "threw", error: String(e && e.message) }));

    // store.insertRow's success contract is mode === "live_write" — it has no
    // .ok property. Checking for .ok made every SUCCESSFUL write look like a
    // failure, so a customer whose lead was safely stored was still told to
    // call instead. Caught by the read-back assertion, not by the 200/502.
    const stored = persisted && persisted.mode === "live_write";
    const storeUnavailable = persisted && persisted.mode === "dry_run";

    if (!stored && !storeUnavailable) {
      // A genuine write failure. Never tell a customer "thanks!" over a
      // dropped lead — that is the defect this endpoint exists to remove. The
      // form falls back to mailto: on any non-2xx, so the lead still travels.
      return json(res, 502, { ok: false, error: "could not save your request — please call instead" });
    }

    const apiKey = String(process.env.RESEND_API_KEY || "").trim();
    if (storeUnavailable && !apiKey) {
      // No durable store AND no mail path = the lead would vanish. Say so.
      return json(res, 502, { ok: false, error: "could not save your request — please call instead" });
    }

    // WSS CONNECT — the inbox we sell. Never fatal: a Connect write failure
    // must not cost the visitor their submission when the event row already
    // holds it, so the reason is reported rather than thrown.
    const connect = { thread_id: null, message_id: null, error: "" };
    try {
      const thread = await ensureThread({
        threadKey: leadThreadKey(slug, lead),
        siteSlug: slug,
        // connect_threads.channel is a CHECK constraint over six values; a
        // website form is the site's own message channel. `source` in the
        // message meta is what says it came from the quote form.
        channel: "chat",
        contactName: lead.name || null,
        contactInfo: lead.email || lead.phone || null,
        subject: lead.service ? `Quote request — ${lead.service}` : "Quote request",
      });
      const bodyText = [
        lead.message,
        lead.service ? `Service: ${lead.service}` : "",
        lead.phone ? `Phone: ${lead.phone}` : "",
        lead.email ? `Email: ${lead.email}` : "",
      ].filter(Boolean).join("\n") || "(no message supplied)";
      const msg = await addMessage(thread.id, "inbound", bodyText, {
        source: "site_form",
        lead_id: leadId,
        page: lead.page || null,
        origin_trusted: origin.trusted,
      });
      await touchThread(thread.id, { unread: true });
      connect.thread_id = thread.id ?? null;
      connect.message_id = (msg && msg.id) ?? null;

      // Best-effort phone wake-up only after the Connect message is durable.
      // waitUntil keeps Vercel from freezing the work after res.end(), while
      // this swallowed failure path ensures push can never change ingest.
      const pushTask = Promise.resolve().then(() => sendConnectPush({
        siteSlug: slug,
        sender: String(lead.name || "Website visitor").trim().slice(0, 80),
        snippet: String(lead.message || lead.service || "New quote request")
          .replace(/\s+/g, " ").trim().slice(0, 80),
        threadId: thread.id,
        kind: "quote_request",
      })).catch((error) => {
        const code = String((error && (error.code || error.name)) || "push_error")
          .toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80) || "push_error";
        // Return the event promise so waitUntil covers the fallback log too.
        // Record only a code; provider errors may contain capability URLs.
        return Promise.resolve().then(() => recordEvent("connect_push_failed", {
          siteSlug: slug,
          source: "quote_request",
          threadId: thread.id,
          code,
        })).catch(() => {});
      });
      waitUntil(pushTask);
    } catch (error) {
      connect.error = String((error && error.message) || error).slice(0, 200);
    }

    // WHOSE LEAD IS THIS. Resolved from the slug against our own tables; the
    // caller never gets to name a recipient. An untrusted origin cannot route.
    let route = { mode: "unknown", deliverTo: "", heldTo: "", heldReason: "untrusted_origin", businessName: "", clientId: "", prospectId: "", lookup: null };
    if (origin.trusted) {
      route = await resolveLeadRoute({ slug, select });
    } else {
      route.heldReason = `untrusted_origin:${origin.reason}`;
    }

    const mail = leadEmails({ slug, lead, route });
    const delivery = { client: "not_attempted", owner: "not_attempted", client_to: route.deliverTo || "" };

    if (!apiKey) {
      delivery.client = "no_mail_provider";
      delivery.owner = "no_mail_provider";
    } else if (sentThisInstance >= MAX_PER_INSTANCE) {
      // Lead is durably stored and threaded above; throttle only the fan-out.
      delivery.client = "throttled";
      delivery.owner = "throttled";
    } else {
      if (mail.client) {
        const sent = await sendResendEmail({
          senderKind: "transactional",
          to: mail.client.to,
          replyTo: mail.client.replyTo,
          subject: mail.client.subject,
          text: mail.client.text,
          html: mail.client.html,
        }).catch((error) => ({ mode: "send_failed", error: String((error && error.message) || error) }));
        delivery.client = sent && (sent.mode === "sent" || sent.id) ? "sent" : String(sent && sent.mode) || "send_failed";
        if (delivery.client === "sent") sentThisInstance += 1;
      } else {
        delivery.client = `held:${route.heldReason || "no_recipient"}`;
      }

      const ownerTo = String(process.env.GHOST_AGENCY_OWNER_EMAIL || "woodwardsoftware@gmail.com").trim();
      const ownerSent = await sendResendEmail({
        senderKind: "transactional",
        to: ownerTo,
        replyTo: mail.owner.replyTo,
        subject: mail.owner.subject,
        text: mail.owner.text,
        html: mail.owner.html,
      }).catch((error) => ({ mode: "send_failed", error: String((error && error.message) || error) }));
      delivery.owner = ownerSent && (ownerSent.mode === "sent" || ownerSent.id) ? "sent" : String(ownerSent && ownerSent.mode) || "send_failed";
      if (delivery.owner === "sent") sentThisInstance += 1;
    }

    return json(res, 200, {
      ok: true,
      leadId,
      stored,
      thread_id: connect.thread_id,
      message_id: connect.message_id,
      ...(connect.error ? { connect_error: connect.error } : {}),
      route: route.mode,
      route_reason: route.heldReason || "",
      business: route.businessName || "",
      delivery,
      // Kept for the four already-deployed donor bundles, which read nothing
      // but `ok` — but a truthful summary belongs in the field they'd read next.
      notified: delivery.owner === "sent" || delivery.client === "sent",
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: String(error.message || error) });
  }
};
