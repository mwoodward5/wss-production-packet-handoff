"use strict";

// GET /api/admin/gallery-liveness
//
// WHAT QUESTION THIS ANSWERS, AND WHY THE GALLERY CANNOT ANSWER IT ALONE.
//
// A gallery card offers "Open live site". That is a claim in the PRESENT TENSE,
// and the only evidence behind it is `preview_url` — a column written once, at
// build time, and never revisited. Measured on the live store (2026-08-11):
// 93 of the 141 archived cards point at a host that now answers 404. Those
// mirrors lived on per-prospect Vercel projects and a purge took them; the row
// kept the URL, the URL kept passing the host guard, and the card kept offering
// a link to nothing. An action that is offered must work, so the page has to be
// able to ask the one thing the row cannot answer: does it serve right now.
//
// SEPARATE ROUTE, NOT PART OF gallery-data, ON PURPOSE. The catalog must paint
// immediately; a network probe of every host must never be able to delay or
// fail the page. So the gallery renders from gallery-data first and calls this
// second, purely to ANNOTATE. If this route is slow, errors, or is never
// reached, the cards simply keep the state they already had — the page degrades
// to exactly its previous behaviour instead of blocking on a probe.
//
// GET, not POST. The operator gallery is read-only by contract (its own test
// asserts the page issues no POST/PUT/PATCH/DELETE), and nothing here mutates:
// it reads the prospect rows this operator can already read and performs the
// same HTTP GET their browser would.
//
// THREE STATES, NEVER TWO. "unknown" is a real answer and is not merged into
// "offline": lib/preview-liveness refuses to probe any host outside the
// wss-ai.com allowlist (that refusal is the SSRF guard, re-applied at the point
// of request), so the retired siteforge /try/ hosts are unprobeable here even
// though 29 of them are up. Reporting those as offline would replace one lie
// with another. Unknown means unknown, and the card claims nothing.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { checkPreviewLive } = require("../../lib/preview-liveness");
const { select } = require("../../lib/store");

const PROSPECTS = "ghost_agency_prospects";
const LINE_ROWS = "ghost_agency_line_batch_rows";
const MAX_ROWS = 500;

// Probing is the only cost here and every host is different, so the module
// cache in preview-liveness cannot amortise across rows within one pass — only
// across passes. Width is what bounds the wall clock. 24 in flight against a
// 4s per-host ceiling puts the pathological case (every host hanging) at about
// 500/24*4 ≈ 83s, inside the route's 300s budget, while the real case is a few
// seconds: a deleted Vercel project answers 404 immediately.
const PROBE_CONCURRENCY = 24;

const PROSPECT_QUERY = [
  "select=prospect_id,preview_url,updated_at",
  "preview_url=not.is.null",
  "order=updated_at.desc",
  `limit=${MAX_ROWS}`,
].join("&");

// The Gallery's build list is not only the prospect table: mirrors built
// through a Line batch surface from ghost_agency_line_batch_rows before the
// prospect row carries the URL, and measured live (2026-09-01) 128 of the
// Gallery's rows — every Line-only one, including all Line-only gate_passed —
// point at URLs this route never probed. Those are exactly the per-site hosts
// the legacy-mirror retirement is deleting, so they are exactly the rows that
// need the measured-offline badge instead of a live-site link that 404s.
const LINE_ROW_QUERY = [
  "select=preview_url:payload->>previewUrl",
  "status=not.in.(picked,qualified,rejected)",
  "order=updated_at.desc",
  `limit=${MAX_ROWS}`,
].join("&");

function text(value) {
  return String(value == null ? "" : value).trim();
}

async function mapWithConcurrency(items, width, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(width, items.length)) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await worker(items[index], index);
      }
    }),
  );
  return out;
}

/**
 * One probe result, in the vocabulary the card renders.
 *
 * live    — the host answered 200 to the same GET the operator's click issues.
 * offline — it answered something else, or could not be reached at all.
 * unknown — we did not ask. Only ever because the host is outside the preview
 *           allowlist, which is a guard, not a verdict about the site.
 */
function stateFor(probe) {
  if (probe.ok === true) return "live";
  if (probe.reason === "no_probeable_preview_url") return "unknown";
  return "offline";
}

function createGalleryLivenessHandler(overrides = {}) {
  const selectRows = overrides.select || select;
  const probe = overrides.checkPreviewLive || checkPreviewLive;
  const width = Number(overrides.concurrency) > 0 ? Number(overrides.concurrency) : PROBE_CONCURRENCY;

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["GET"])) return;
    if (!requireAdmin(req, res)) return;

    try {
      const result = await selectRows(PROSPECTS, PROSPECT_QUERY);
      if (!result || result.ok !== true || !Array.isArray(result.data)) {
        const error = new Error("Gallery source data is temporarily unavailable.");
        error.statusCode = 503;
        error.code = "gallery_source_unavailable";
        throw error;
      }

      // The Line-row read is annotation, never a dependency: a failed read
      // leaves this route answering for the prospect URLs exactly as it did
      // before they were added.
      const lineResult = await Promise.resolve(selectRows(LINE_ROWS, `?${LINE_ROW_QUERY}`)).catch(() => ({ ok: false, data: [] }));

      // One probe per DISTINCT url — across BOTH tables. Two rows may
      // legitimately share a host (and the same URL may sit in the prospect
      // table and a Line payload at once), and asking twice spends the timeout
      // budget twice for the same answer.
      const urls = [...new Set([
        ...result.data.map((row) => text(row && row.preview_url)),
        ...(lineResult && Array.isArray(lineResult.data)
          ? lineResult.data.map((row) => text(row && (row.preview_url || row.previewUrl)))
          : []),
      ].filter(Boolean))];
      const probes = await mapWithConcurrency(urls, width, (url) => probe({ url }));

      const results = urls.map((previewUrl, index) => {
        const outcome = probes[index] || { ok: false, reason: "probe_missing" };
        return {
          previewUrl,
          state: stateFor(outcome),
          status: Number(outcome.status) || 0,
          reason: outcome.ok === true ? "" : text(outcome.reason),
        };
      });

      const counts = results.reduce((acc, row) => {
        acc[row.state] = (acc[row.state] || 0) + 1;
        return acc;
      }, {});

      // no-store: a cached liveness answer is a stale claim about the present
      // tense, which is the whole defect this route exists to close.
      res.setHeader("Cache-Control", "no-store");
      sendJson(res, 200, { ok: true, checkedAt: new Date().toISOString(), counts, results });
    } catch (error) {
      handleError(res, error);
    }
  };
}

module.exports = createGalleryLivenessHandler();
module.exports.createGalleryLivenessHandler = createGalleryLivenessHandler;
module.exports.stateFor = stateFor;
