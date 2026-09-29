"use strict";

const base = (process.env.GHOST_AGENCY_API_URL || "https://ghost-agency-backend.vercel.app").replace(/\/+$/, "");
const admin = process.env.GHOST_AGENCY_ADMIN_TOKEN;

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "x-admin-token": admin,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function main() {
  if (!admin) throw new Error("GHOST_AGENCY_ADMIN_TOKEN missing");
  const readiness = await request("/api/admin/readiness");
  const drip = await request("/api/cron/drip-scheduler", { method: "POST", body: "{}" });
  const output = {
    readiness: {
      status: readiness.status,
      ready: readiness.json.ready,
      reviewHold: readiness.json.reviewHold,
      hardStops: readiness.json.hardStops,
      outreachDomain: readiness.json.outreachSender?.domain,
      outreachDns: readiness.json.outreachDns?.ok,
    },
    drip: {
      status: drip.status,
      mode: drip.json.mode,
      evaluated: drip.json.evaluated,
      sent: drip.json.sent,
      reason: drip.json.reason,
    },
  };
  console.log(JSON.stringify(output, null, 2));
  if (readiness.status !== 200 || readiness.json.reviewHold !== true || drip.json.mode !== "review_hold" || drip.json.sent !== 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
