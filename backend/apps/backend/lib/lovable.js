"use strict";

function lovableConfigured() {
  return Boolean(process.env.LOVABLE_API_KEY?.trim() || process.env.LOVABLE_ACCESS_TOKEN?.trim());
}

async function dispatchStudioAction(action, payload = {}) {
  if (!lovableConfigured()) {
    return {
      ok: false,
      mode: "handoff_packet",
      configured: false,
      action,
      message: "Lovable credentials are not configured in this backend. Returning a safe handoff packet.",
      payload,
    };
  }

  return {
    ok: false,
    mode: "not_implemented",
    configured: true,
    action,
    message: "Lovable credentials are present, but direct studio dispatch is intentionally held until API contract confirmation.",
    payload,
  };
}

module.exports = {
  dispatchStudioAction,
  lovableConfigured,
};
