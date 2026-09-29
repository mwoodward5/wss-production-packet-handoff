"use strict";

const DEFAULT_BASE_URL = "https://tools.brightlocal.com/seo-tools/api";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function reportIdOf(prospect = {}) {
  return clean(
    prospect.brightlocal_report_id ||
    prospect.local_rank_report_id ||
    prospect.record?.brightlocal_report_id ||
    prospect.record?.local_rank_report_id,
  );
}

function existingEvidence(prospect = {}) {
  return prospect.local_market_data || prospect.localMarketData || prospect.record?.local_market_data || null;
}

function extractEvidence(payload = {}) {
  const results = payload.results || payload.response?.results || payload;
  const summary = results.summary || {};
  const keywords = results.keywords || {};
  const rankings = Array.isArray(keywords)
    ? keywords
    : Object.entries(keywords).map(([term, value]) => ({
      term,
      current_rank: value?.client_rank ?? value?.rank ?? null,
      maps_rank: value?.local_rank ?? null,
    }));
  const citationRows = asArray(results.citations || results.directories || results.listings);
  const citationCount = Number(summary.citations_count);
  if (!citationRows.length && Number.isFinite(citationCount) && citationCount > 0) {
    citationRows.push({ name: `${citationCount} matched directory signals`, consistent: null });
  }
  return {
    verified: true,
    source: "local_rank_provider",
    rankings,
    citations: citationRows,
    rating: summary.star_rating ?? summary.rating ?? null,
    review_count: summary.num_reviews ?? summary.review_count ?? null,
    categories: summary.categories || [],
    fetched_at: new Date().toISOString(),
  };
}

async function loadLocalMarketEvidence(prospect = {}, options = {}) {
  const supplied = existingEvidence(prospect);
  if (supplied && typeof supplied === "object") {
    return { status: supplied.verified === false ? "supplied_unverified" : "supplied", evidence: supplied };
  }

  const apiKey = clean(options.apiKey || process.env.BRIGHTLOCAL_API_KEY);
  if (!apiKey) return { status: "not_configured", evidence: {} };

  const reportId = clean(options.reportId || reportIdOf(prospect));
  if (!reportId) return { status: "report_not_linked", evidence: {} };

  const baseUrl = clean(options.baseUrl || process.env.BRIGHTLOCAL_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeoutMs = Math.max(1000, Math.min(15000, Number(options.timeoutMs || process.env.BRIGHTLOCAL_TIMEOUT_MS || 6000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(`${baseUrl}/v4/gpw/${encodeURIComponent(reportId)}/results`);
    url.searchParams.set("api-key", apiKey);
    const response = await (options.fetchImpl || fetch)(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      return { status: "provider_error", httpStatus: response.status, evidence: {}, detail: body.errors || body.error || null };
    }
    return { status: "fetched", evidence: extractEvidence(body) };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "timeout" : "provider_error", evidence: {}, detail: error.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  extractEvidence,
  loadLocalMarketEvidence,
  reportIdOf,
};
