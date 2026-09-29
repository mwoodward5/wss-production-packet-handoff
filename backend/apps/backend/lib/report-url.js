"use strict";

// lib/report-url.js — is this actually a report we can send someone to?
//
// WHY THIS EXISTS. 63 of the 75 stored report_urls pointed at nothing:
//   · `https://callprep.wss-ai.com/report/<build-slug>` — lib/siteforge.js
//     interpolated the BUILD SLUG into a report path. The reports table keys on
//     a uuid, so those ids are not merely absent, they are structurally
//     impossible: the database answers "invalid input syntax for uuid".
//   · `https://siteforge-app-seven.vercel.app/try/<slug>/scorecard.json` — a
//     build artefact on a retired host. A JSON file is not a customer report.
//
// None of this mattered while the email accepted `reportUrl` and silently threw
// it away. It matters now: the email PRINTS the link and Riley reads it back to
// a caller on the phone. HTTP status cannot be the test — CallPrep is a single
// page app that answers 200 for every /report/* path and resolves the id in the
// browser, so a dead link looks perfectly healthy from the server.
//
// The test is therefore structural: our own host, a /report/ path, and an id
// shaped like the uuid the table actually stores.

const REPORT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * isRealReportUrl(value) -> boolean
 * True only for a link that can resolve to a stored report.
 */
function isRealReportUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https:\/\//i.test(raw)) return false;
  let url;
  try { url = new URL(raw); } catch { return false; }
  const host = url.hostname.toLowerCase();
  if (host !== "wss-ai.com" && !host.endsWith(".wss-ai.com")) return false;
  const m = /^\/report\/([^/]+)\/?$/.exec(url.pathname);
  return Boolean(m) && REPORT_UUID.test(decodeURIComponent(m[1]));
}

/** The value if it is real, otherwise "" — never a dead link. */
function safeReportUrl(value) {
  return isRealReportUrl(value) ? String(value).trim() : "";
}

module.exports = { isRealReportUrl, safeReportUrl, REPORT_UUID };
