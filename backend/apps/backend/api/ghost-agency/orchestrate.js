const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { requireAdmin } = require("../../lib/admin-auth");
const { buildCanonicalJob } = require("../../lib/packets");
const {
  callprepAdapter,
  leadminerAdapter,
} = require("../../lib/adapters");
const { createCheckoutSession } = require("../../lib/stripe");
const { callIntakeGenie, truthPacketFromCanonical } = require("../../lib/intake-genie-client");
const { providerStatus } = require("../../lib/registry");
const { insertRow, recordEvent, upsertRow } = require("../../lib/store");
const { hashObject } = require("../../lib/http");

function projectRef() {
  try {
    return new URL(process.env.SUPABASE_URL || "").hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

function durableLocator(requestId, write = {}) {
  const rows = Array.isArray(write.row) ? write.row : [];
  return {
    provider: "supabase",
    projectRef: projectRef(),
    table: "ghost_agency_jobs",
    key: "job_id",
    value: requestId,
    recordId: rows[0]?.id || null,
  };
}

function isWriteConflict(write = {}) {
  const errorText = `${write.error?.message || ""} ${write.error?.details || ""}`;
  return write.mode === "live_write_failed"
    && String(write.error?.code || "") === "23505"
    && (/ghost_agency_jobs_job_id_key/i.test(errorText) || /key\s*\(job_id\)\s*=/i.test(errorText));
}

function prospectFromCanonical(packet = {}, fallback = {}) {
  const facts = packet.facts || {};
  return {
    ...fallback,
    businessName: facts.name || fallback.businessName || fallback.name || "",
    name: facts.name || fallback.name || fallback.businessName || "",
    industry: facts.category || fallback.industry || fallback.category || "",
    category: facts.category || fallback.category || fallback.industry || "",
    city: facts.city || fallback.city || "",
    state: facts.state || fallback.state || "",
    phone: facts.phone || fallback.phone || "",
    address: facts.address || fallback.address || "",
    currentWebsite: facts.website_url || fallback.currentWebsite || fallback.website || fallback.url || "",
    website: facts.website_url || fallback.website || fallback.currentWebsite || fallback.url || "",
    services: Array.isArray(facts.services) ? facts.services : fallback.services,
    source: "siteforge_intake_genie",
  };
}

// Customer-safe held response: the lead is DURABLY SAVED, research just
// couldn't finish synchronously. A dependency hiccup must never cost a lead.
function acceptedHeld(res, requestId, state, safeMessage, persistence) {
  sendJson(res, 202, {
    ok: true,
    accepted: true,
    requestId,
    mode: "received_processing_held",
    state,
    message: safeMessage,
    persistence,
  });
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  // This function is directly reachable as its own Vercel serverless endpoint,
  // so it must enforce admin auth itself — the requireAdmin in run.js does not
  // protect a direct POST to /api/ghost-agency/orchestrate. It writes prospects
  // /jobs to Supabase and can create Stripe checkout sessions; never leave it open.
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req);
    const prospectIn = body.prospect || body;
    const rawBizName = String(prospectIn.businessName || prospectIn.name || "").trim();
    const rawContact = String(prospectIn.ownerEmail || prospectIn.email || "").trim();
    const rawIdem = String(body.idempotencyKey || req.headers["idempotency-key"] || "").trim();
    if (rawBizName.length > 160 || rawContact.length > 254 || rawIdem.length > 200) {
      sendJson(res, 400, {
        ok: false,
        error: "input_too_long",
        message: "That request is too long. Shorten the business name, email, or request key and try again.",
      });
      return;
    }
    const bizName = rawBizName;
    const contact = rawContact;
    if (!bizName && !contact) {
      sendJson(res, 400, {
        ok: false,
        error: "missing_business",
        message: "Tell us the business name or an email so we can build for the right company.",
      });
      return;
    }
    const idem = rawIdem;
    const requestId = idem ? `req_${hashObject(idem)}` : `req_${hashObject({ bizName, contact, day: new Date().toISOString().slice(0, 10) })}`;

    // ---- DURABLE FIRST. Persist the customer request before ANY dependency
    // (Intake Genie, Stripe) gets a chance to fail and erase it.
    const received = await insertRow("ghost_agency_jobs", {
      job_id: requestId,
      business_name: bizName,
      owner_email: contact,
      status: "preview_request_received",
      payload: {
        requestId,
        businessName: bizName,
        ownerEmail: contact,
        city: prospectIn.city || "",
        state: prospectIn.state || "",
        currentWebsite: prospectIn.currentWebsite || prospectIn.website || "",
        source: prospectIn.source || "wss-ai-public-preview-request",
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const persistence = durableLocator(requestId, received);
    if (isWriteConflict(received)) {
      sendJson(res, 202, {
        ok: true,
        accepted: true,
        duplicate: true,
        requestId,
        mode: "already_received",
        state: "already_received",
        message: "Your preview request was already received. Keep this request ID for support or status checks.",
        persistence,
      });
      return;
    }
    if (!received || received.mode !== "live_write") {
      // Never claim acceptance we can't back with a durable write.
      sendJson(res, 503, {
        ok: false,
        error: "storage_unavailable",
        message: "We couldn't save your request just now — email support@woodwardsoftware.com and we'll take it from there.",
      });
      return;
    }
    await recordEvent("preview.request_received", {
      requestId,
      businessName: bizName,
      ownerEmail: contact,
      status: "pending",
      durableTable: persistence.table,
      durableKey: persistence.key,
    }).catch(() => {});

    let intake;
    try {
      intake = await callIntakeGenie(prospectIn, {
        buildPreview: false,
        dryRun: true,
        pipelineVersion: "ghost-public-orchestrator",
        idempotencyKey: requestId,
      });
    } catch (e) {
      intake = { ok: false, error: "intake_exception" };
    }
    if (!intake.ok) {
      await recordEvent("preview.request_state", { requestId, state: "intake_unavailable", reason: String(intake.error || "intake_genie_required") }).catch(() => {});
      acceptedHeld(res, requestId, "research_pending",
        "Got it — your request is saved. We couldn't finish the research step just now; contact support@woodwardsoftware.com and mention your request ID if you need immediate help.", persistence);
      return;
    }
    const canonicalPacket = intake.packet;
    if (canonicalPacket.status === "needs_input" || canonicalPacket.status === "out_of_scope") {
      await recordEvent("preview.request_state", { requestId, state: canonicalPacket.status, reason: String(canonicalPacket.question || canonicalPacket.error || canonicalPacket.status) }).catch(() => {});
      acceptedHeld(res, requestId, canonicalPacket.status,
        "Got it — your request is saved, but one more detail is needed. Contact support@woodwardsoftware.com and mention your request ID to continue.", persistence);
      return;
    }
    const job = buildCanonicalJob({
      ...body,
      prospect: prospectFromCanonical(canonicalPacket, body.prospect || body),
      product: "website_preview",
      jobId: body.jobId || (requestId ? `preview_${hashObject(requestId)}` : undefined),
    });
    job.canonical = canonicalPacket;
    job.packets.truth = truthPacketFromCanonical(canonicalPacket);
    const leadminer = leadminerAdapter(job);
    const report = callprepAdapter(job);
    let checkout;
    try {
      checkout = await createCheckoutSession({ job, idempotencyKey: requestId });
    } catch (e) {
      // Stripe being down must not cost the lead either.
      await recordEvent("preview.request_state", { requestId, state: "checkout_unavailable", reason: String(e && e.message || e) }).catch(() => {});
      acceptedHeld(res, requestId, "checkout_pending",
        "Got it — your request is saved, but checkout is unavailable just now. Contact support@woodwardsoftware.com and mention your request ID if you need immediate help.", persistence);
      return;
    }
    if (!checkout || checkout.mode !== "checkout_session" || !checkout.url) {
      const reason = checkout && checkout.status ? `stripe_http_${checkout.status}` : "checkout_failed";
      await recordEvent("preview.request_state", { requestId, state: "checkout_unavailable", reason }).catch(() => {});
      acceptedHeld(res, requestId, "checkout_pending",
        "Got it — your request is saved, but checkout is unavailable just now. Contact support@woodwardsoftware.com and mention your request ID if you need immediate help.", persistence);
      return;
    }
    const requestLink = await upsertRow("ghost_agency_jobs", {
      job_id: requestId,
      business_name: bizName,
      owner_email: contact,
      status: "checkout_created",
      payload: {
        requestId,
        downstreamJobId: job.id,
        stripeSessionId: checkout.sessionId || null,
        source: prospectIn.source || "wss-ai-public-preview-request",
      },
      updated_at: new Date().toISOString(),
    }, "job_id").catch((error) => ({ mode: "request_link_failed", reason: String(error && error.message || error) }));
    if (!requestLink || requestLink.mode !== "live_upsert") {
      await recordEvent("preview.request_state", {
        requestId,
        jobId: job.id,
        stripeSessionId: checkout.sessionId || null,
        state: "request_link_unavailable",
      }).catch(() => {});
      acceptedHeld(res, requestId, "request_link_pending",
        "Got it — your request is saved, but its internal handoff needs attention. Contact support@woodwardsoftware.com and mention your request ID to continue.", persistence);
      return;
    }
    const event = await recordEvent("local_growth_orchestrated", {
      requestId,
      jobId: job.id,
      stage: "checkout_created_production_dispatch_held",
      systems: [
        "LeadMiner",
        "CallPrep",
        "WSS Labs",
        "DreamForge",
        "Mission Control",
        "Stripe",
      ],
    });

    sendJson(res, 200, {
      ok: true,
      accepted: true,
      requestId,
      mode: "local_growth_integration_spine",
      job,
      idempotencyKey: idem || null,
      providers: providerStatus(),
      actions: {
        leadminer,
        report,
        buildTicket: {
          mode: "held_until_paid_checkout",
          reason:
            "Production build dispatch now happens only after a verified Stripe checkout.session.completed webhook.",
        },
        zapier: {
          mode: "held_until_paid_checkout",
          reason:
            "Revenue and delivery automations are triggered from the signed Stripe webhook, not the public intake call.",
        },
        checkout,
        outreach: {
          vapi: job.packets.outreach.consentStatus.call,
          twilio: job.packets.outreach.consentStatus.text,
          missionControlUrl: job.packets.outreach.missionControlUrl,
        },
      },
      persistence: event,
      durableRequest: persistence,
      requestLink,
      nextHumanProofGates: [
        "Attach real LeadMiner export.",
        "Create or link real CallPrep/Rocket SERPs report.",
        "Complete buyer Stripe checkout and verify webhook entitlement.",
        "Dispatch build ticket into WSS Labs/DreamForge after paid webhook.",
        "Only place VAPI/Twilio follow-up after explicit consent.",
      ],
    });
  } catch (error) {
    handleError(res, error);
  }
};
