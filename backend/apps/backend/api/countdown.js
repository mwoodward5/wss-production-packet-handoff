"use strict";

// GET /api/countdown?until=<ISO date>&label=preview
//
// An animated GIF countdown for email. Every open re-renders ~60 one-second
// frames starting from the TRUE remaining time (Cache-Control: no-store), so
// the timer in the inbox is honest on every open. Clients that show only the
// first frame still see the correct remaining time; once the deadline passes
// the endpoint serves a static "<LABEL> EXPIRED" card, never negative numbers.
//
// The email always pairs this image with a static text line ("We keep your
// preview live until {date}") so image-blocking clients still get the deadline.

const { renderCountdownGif, sanitizeLabel } = require("../lib/countdown-gif");

// One year is far beyond any preview window we ever offer; anything later is a
// malformed or tampered URL, and 99 days is the display cap anyway.
const MAX_HORIZON_MS = 366 * 86400e3;

function parseWhen(value) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    return raw.length <= 10 ? n * 1000 : n;
  }
  return Date.parse(raw);
}

/** URL the email composer embeds; base defaults to the ghost host. */
function buildCountdownUrl(until, base, label = "preview") {
  const iso = new Date(until).toISOString();
  const origin = String(base || "https://ghost.wss-ai.com").replace(/\/+$/, "");
  return `${origin}/api/countdown?until=${encodeURIComponent(iso)}&label=${encodeURIComponent(sanitizeLabel(label).toLowerCase())}`;
}

module.exports = async function handler(req, res) {
  const q = (req && req.query) || {};
  const until = parseWhen(q.until);
  if (!Number.isFinite(until)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "until must be an ISO date, e.g. ?until=2026-08-14T17:00:00Z" }));
    return;
  }

  // `now` override exists for deterministic smoke tests only; it changes what
  // the picture shows, nothing else.
  const nowOverride = parseWhen(q.now);
  const now = Number.isFinite(nowOverride) ? nowOverride : Date.now();
  const clampedUntil = Math.min(until, now + MAX_HORIZON_MS);

  const gif = renderCountdownGif({ until: clampedUntil, now, label: q.label });

  res.statusCode = 200;
  res.setHeader("Content-Type", "image/gif");
  // Every open must re-render with the true remaining time.
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Content-Length", String(gif.length));
  res.end(gif);
};

module.exports.buildCountdownUrl = buildCountdownUrl;
