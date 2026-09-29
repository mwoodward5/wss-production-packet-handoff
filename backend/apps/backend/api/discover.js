"use strict";

// Public URL-first business discovery for the /activate experience.
// A customer pastes their website / Google Business Profile / Instagram /
// Facebook / Yelp links; we run Intake Genie in DRY-RUN (no build, no
// persistence side-effects beyond an event) and return only the discovered,
// evidence-backed facts. Truth-law: nothing is ever invented — if Genie can't
// verify a fact, it simply isn't returned.

const { handleError, methodGuard, readJson, sendJson } = require("../lib/http");
const { hashObject } = require("../lib/http");
const { callIntakeGenie, discoveredFacts } = require("../lib/intake-genie-client");
const { recordEvent } = require("../lib/store");

// Simple per-instance rate limit: this is a public endpoint that triggers a
// real scrape, so cap bursts. (Serverless instances reset this naturally.)
const hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = hits.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count += 1;
  hits.set(key, entry);
  return entry.count > 6;
}

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function classifyUrl(raw) {
  const url = clean(raw, 500);
  if (!/^https?:\/\//i.test(url)) return null;
  if (/(?:google\.[^/]+\/maps|maps\.app\.goo\.gl|g\.page)\//i.test(url)) return ["gbp_url", url];
  if (/instagram\.com/i.test(url)) return ["instagram_url", url];
  if (/facebook\.com|fb\.com/i.test(url)) return ["facebook_url", url];
  if (/yelp\.com/i.test(url)) return ["yelp_url", url];
  return ["current_website", url];
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    const body = await readJson(req);
    // honeypot: bots fill every field
    if (clean(body.company_website, 200)) { sendJson(res, 200, { ok: true }); return; }

    const ip = clean(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "anon", 80).split(",")[0];
    if (rateLimited(ip)) {
      sendJson(res, 429, { ok: false, error: "rate_limited", message: "Give it a minute and try again." });
      return;
    }

    const rawUrls = Array.isArray(body.urls) ? body.urls : [body.url];
    const prospect = {
      prospect_id: `activate-${hashObject({ urls: rawUrls, t: Math.floor(Date.now() / 3600000) }).slice(0, 16)}`,
      business_name: clean(body.businessName, 120),
      city: clean(body.city, 80),
      state: clean(body.state, 40),
    };
    let recognized = 0;
    const extra = [];
    for (const raw of rawUrls.slice(0, 6)) {
      const hit = classifyUrl(raw);
      if (!hit) continue;
      recognized += 1;
      if (prospect[hit[0]]) extra.push(hit[1]);
      else prospect[hit[0]] = hit[1];
    }
    if (extra.length) prospect.source_urls = extra;
    if (!recognized) {
      sendJson(res, 400, { ok: false, error: "no_valid_urls", message: "Paste at least one full link (https://…) — your website, Google profile, Instagram, Facebook, or Yelp." });
      return;
    }

    const result = await callIntakeGenie(prospect, {
      buildPreview: false,
      dryRun: true,
      idempotencyKey: `activate:${prospect.prospect_id}`,
    });

    await recordEvent("activate.discovery", {
      prospectId: prospect.prospect_id,
      sources: recognized,
      ok: !!result.ok,
      status: result.packet?.status || String(result.status || ""),
    }).catch(() => {});

    if (!result.ok) {
      sendJson(res, result.status === "not_configured" ? 503 : 422, {
        ok: false,
        error: "discovery_unavailable",
        message: "Automatic discovery couldn't finish — you can fill in the details manually below and we'll verify everything before your preview is built.",
      });
      return;
    }

    const facts = discoveredFacts(result.packet) || {};
    const packet = result.packet || {};
    const photos = Array.isArray(packet.assets) ? packet.assets.filter((a) => a?.kind === "photo").length : 0;
    const sources = Array.isArray(packet.evidence) ? packet.evidence.length : recognized;

    sendJson(res, 200, {
      ok: true,
      status: packet.status || "ok",
      question: packet.status === "needs_input" ? (packet.question || "") : "",
      facts,
      counts: {
        services: packet?.facts?.services?.length || 0,
        photos,
        sources,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};
