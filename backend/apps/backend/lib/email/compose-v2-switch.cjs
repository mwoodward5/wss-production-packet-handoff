"use strict";
// lib/email/compose-v2-switch.cjs — the GHOST_AGENCY_EMAIL_V2 dark-launch gate.
//
// The v2 prospect email (email-template-v2.cjs, fed by adapt-email-v2.cjs) is a
// parallel render path: flag off (the default) returns the caller's own
// composition untouched; flag on tries the v2 chain and falls back to the
// caller's composition on ANY failure, so a half-adaptable record can never
// block a send that the legacy composer would have carried.
//
// DEVIATION FROM THE DRAFTED PACKET, ON PURPOSE: the packet minted its own
// unsubscribe URL from client_id. The live pipeline signs unsubscribe URLs
// (lib/unsubscribe.js) and mirrors them into the List-Unsubscribe header, so a
// self-minted URL would ship a dead link that disagrees with the header. The
// caller must hand in the real signed URL; without one the v2 path refuses and
// legacy renders instead.

function composeProspectEmail(record, opts = {}) {
  if (!opts || typeof opts.legacyRender !== "function") {
    throw new TypeError("composeProspectEmail requires opts.legacyRender(record)");
  }

  const renderLegacy = () => {
    const rendered = opts.legacyRender(record);
    if (!rendered || typeof rendered !== "object") {
      throw new TypeError("legacyRender(record) must return an object");
    }
    return { ...rendered, engine: "legacy" };
  };

  if (process.env.GHOST_AGENCY_EMAIL_V2 !== "true") {
    return renderLegacy();
  }

  try {
    const { toProspectEmailData } = require("./adapt-email-v2.cjs");
    const { renderProspectEmail } = require("./email-template-v2.cjs");

    if (typeof toProspectEmailData !== "function") {
      throw new TypeError("adapt-email-v2.cjs must export toProspectEmailData");
    }
    if (typeof renderProspectEmail !== "function") {
      throw new TypeError("email-template-v2.cjs must export renderProspectEmail");
    }
    if (
      !record
      || typeof record !== "object"
      || typeof record.client_id !== "string"
      || !record.client_id.trim()
    ) {
      throw new TypeError("record.client_id is required for v2 email");
    }
    if (typeof opts.unsubscribeUrl !== "string" || !opts.unsubscribeUrl.trim()) {
      throw new TypeError("opts.unsubscribeUrl (the signed URL) is required for v2 email");
    }

    const data = toProspectEmailData(record);
    if (!data || typeof data !== "object") {
      throw new TypeError("toProspectEmailData(record) must return an object");
    }

    // Minimum-viability gate. The adapter never fabricates — a sparse record
    // adapts to nulls and the template would happily render a hollow shell of
    // an email. The pitch is the before/after and the live mirror; without
    // those and a business name, the legacy composer (with its own richer
    // fallbacks) must carry the send instead.
    if (!data.business || !data.business.name) {
      throw new TypeError("v2 email needs business.name from the record");
    }
    if (!data.mirrorUrl || !data.beforeShotUrl || !data.afterShotUrl) {
      throw new TypeError("v2 email needs mirrorUrl + before/after proof shots");
    }

    data.unsubscribeUrl = opts.unsubscribeUrl.trim();

    if (process.env.GHOST_AGENT_PHONE_DISPLAY) {
      data.contactPhoneDisplay = process.env.GHOST_AGENT_PHONE_DISPLAY;
    }

    const rendered = renderProspectEmail(data);
    if (
      !rendered
      || typeof rendered.html !== "string"
      || typeof rendered.text !== "string"
    ) {
      throw new TypeError("renderProspectEmail(data) must return {html, text}");
    }

    return { html: rendered.html, text: rendered.text, engine: "v2" };
  } catch (error) {
    console.warn(
      "[ghost-agency] v2 prospect email failed; using legacy renderer:",
      error && error.message ? error.message : error,
    );
    return renderLegacy();
  }
}

module.exports = { composeProspectEmail };
