"use strict";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truthOf(prospect = {}) {
  return prospect.truth_packet && typeof prospect.truth_packet === "object"
    ? prospect.truth_packet
    : prospect.truthPacket && typeof prospect.truthPacket === "object"
      ? prospect.truthPacket
      : {};
}

function buildOptimizationComparison(prospect = {}) {
  const truth = truthOf(prospect);
  const opportunities = asArray(truth.opportunities);
  const localPlan = truth.localSearchPlan && typeof truth.localSearchPlan === "object"
    ? truth.localSearchPlan
    : truth.local_search_plan && typeof truth.local_search_plan === "object"
      ? truth.local_search_plan
      : {};
  const targetTerms = asArray(localPlan.targetTerms || localPlan.target_terms);
  const trustSignals = asArray(localPlan.trustSignals || localPlan.trust_signals);
  const services = asArray(truth.services).length
    ? asArray(truth.services)
    : asArray(prospect.services || prospect.primary_services);
  const photos = asArray(truth.photos);
  const city = clean(prospect.city || prospect.market || truth.identity?.city?.value, "the service area");
  const rows = [];
  const used = new Set();

  const add = (key, label, current, preview) => {
    if (used.has(key) || rows.length >= 5) return;
    used.add(key);
    rows.push({ key, label: clean(label), current: clean(current), preview: clean(preview) });
  };

  if (targetTerms.length) {
    const terms = targetTerms.slice(0, 4).map((item) => clean(item?.term || item)).filter(Boolean);
    const measured = localPlan.claimLevel === "measured" || localPlan.claim_level === "measured";
    const top10 = Number(localPlan.currentVisibility?.top10Terms || localPlan.current_visibility?.top10_terms || 0);
    add(
      "local_search_focus",
      "Nearby customer searches",
      measured
        ? `${targetTerms.length} local search topic${targetTerms.length === 1 ? " was" : "s were"} measured${top10 ? `; ${top10} currently appears in the top 10` : ", with room to improve local visibility"}.`
        : "The current site does not clearly organize its strongest services around nearby customer search intent.",
      `One compact local plan focuses the site on ${terms.join(", ")}. It limits page depth instead of creating thin, repetitive location pages.`,
    );
  }

  const citationSignal = trustSignals.find((item) => item?.key === "citations");
  if (citationSignal) {
    add(
      "trust_signals",
      "Trust signals found online",
      citationSignal.status === "found"
        ? citationSignal.detail
        : "Directory and profile matches still need verification before they can be claimed.",
      citationSignal.status === "found"
        ? "Verified directory, profile, review, and contact signals are connected to the same business identity without copying unsupported claims."
        : "The launch checklist is ready to add only the directory, review, and profile signals that can be verified.",
    );
  }

  const geoSignal = trustSignals.find((item) => item?.key === "coordinates");
  if (geoSignal) {
    add(
      "local_context",
      "Map and nearby context",
      geoSignal.detail,
      "The preview uses a satellite map, directions, a verified City, ST location, geographic business markup, and one honest service-area page.",
    );
  }

  const answerSignal = trustSignals.find((item) => item?.key === "answer_content");
  if (answerSignal) {
    add(
      "answer_content",
      "Search, AI, and voice answers",
      answerSignal.detail,
      "A short set of visible customer questions is paired with matching FAQ and speakable markup so search and voice tools can understand the same answers people read.",
    );
  }

  for (const opportunity of opportunities) {
    const type = clean(opportunity?.type).toLowerCase();
    if (type === "missing_website") {
      add(type, "Owned website", "No owned website was attached to the business listing.", "A complete mobile-ready site with service, quote, contact, and local-area pages.");
    } else if (type === "nap_mismatch") {
      add(type, "Contact consistency", opportunity.headline || "Contact details differ between the website and business profile.", "One verified phone and address set is used across the pages, map, and search markup.");
    } else if (type === "no_schema") {
      add(type, "Search understanding", "No structured business data was detected.", "Business, service, FAQ, and breadcrumb markup explains the site to search and AI answer engines.");
    } else if (type === "no_faq") {
      add(type, "Search questions", "No clear FAQ surface was detected.", "Plain-English questions and answers appear on the site and in matching FAQ markup.");
    } else if (type === "no_reviews") {
      add(type, "Trust proof", "No visible review proof was detected at the decision point.", "Only sourced review material is used; when quotes are unavailable, the preview does not invent them.");
    } else if (type === "thin_copy") {
      add(type, "Service detail", "The audit found thin service content.", `${Math.max(services.length, 1)} focused service section${services.length === 1 ? "" : "s"} plus local planning answers for ${city}.`);
    } else if (type === "few_photos") {
      add(type, "Project media", `${photos.length} usable project photo${photos.length === 1 ? " was" : "s were"} found.`, photos.length
        ? "Approved photos are placed where they support the service; empty proof slots are removed."
        : "The hero keeps motion without pretending generated imagery is completed customer work.");
    }
  }

  add("search_launch", "Search setup", "Left untouched by this private audit.", "Local titles, tags, sitemap, and business markup — ready for launch.");
  add("mobile", "Mobile", "Couldn't be verified from the current site.", "Checked on real phone and desktop layouts before delivery.");
  add("actions", "Customer actions", "Your existing contact paths stay untouched.", "Quote, call, and directions grouped into clear next steps.");

  const text = rows
    .map((row) => `${row.label}\nWhat we found: ${row.current}\nYour new preview: ${row.preview}`)
    .join("\n\n");
  const html = `<table class="comparison-grid" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0 22px;border:1px solid #d8ddd8">
    <tr class="comparison-head">
      <th align="left" style="padding:10px 12px;background:#f3f6f2;color:#1c2b20;font:700 12px/1.4 Arial,sans-serif;text-transform:uppercase">Current site and listings</th>
      <th align="left" style="padding:10px 12px;background:#e6f0e4;color:#1c2b20;font:700 12px/1.4 Arial,sans-serif;text-transform:uppercase">Built into your preview</th>
    </tr>
    ${rows.map((row) => `<tr>
      <td class="comparison-current stack" valign="top" style="width:50%;padding:12px;border-top:1px solid #d8ddd8;color:#4b554d;font:14px/1.5 Arial,sans-serif"><span class="comparison-mobile-label" style="display:none;color:#68716a;font:700 10px/1.4 Arial,sans-serif;text-transform:uppercase">What we found</span><strong style="display:block;color:#1c2b20;margin-bottom:4px">${escapeHtml(row.label)}</strong>${escapeHtml(row.current)}</td>
      <td class="comparison-built stack" valign="top" style="width:50%;padding:12px;border-top:1px solid #d8ddd8;border-left:1px solid #d8ddd8;color:#334539;font:14px/1.5 Arial,sans-serif"><span class="comparison-mobile-label" style="display:none;color:#23633a;font:700 10px/1.4 Arial,sans-serif;text-transform:uppercase">Built into your preview</span><strong style="display:block;color:#23633a;margin-bottom:4px">Included</strong>${escapeHtml(row.preview)}</td>
    </tr>`).join("")}
  </table>`;

  return { rows, text, html };
}

module.exports = {
  buildOptimizationComparison,
};
