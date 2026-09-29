"use strict";

// lib/riley-lookup-core.js — the core of api/vapi-tools/lookup-prospect.js,
// extracted so the ONE proxy door (api/vapi-tools/riley.js) can dispatch to it
// as a library function instead of an HTTP hop. The route keeps only the
// method/auth/body plumbing; this module owns the resolution logic, which is
// byte-for-byte the logic the route carried (identity ladder, ambiguous hard
// stop, call memory, VAPI envelope).
//
// IDENTITY RESOLUTION IS DELEGATED, ON PURPOSE, to resolveCaller(). This used
// to resolve the caller itself with two defects that only show up against real
// data (a phone pattern that matched 0 of 930 rows, and `ranked[0]` — a silent
// pick between colliding names). Both are the single, tested responsibility of
// lib/site-edit-targets.js resolveCaller(), which refuses to choose between
// colliding clients instead of guessing.

const { safeReportUrl } = require("./report-url");
const { select } = require("./store");
const { clientReferenceCode } = require("./client-reference");
const { resolveCaller, siteSlugFromRow } = require("./site-edit-targets");
// The caller identifies himself ONCE per call. See lib/riley-call-memory.js.
const { callIdFromBody, rememberCaller, recallCaller } = require("./riley-call-memory");

function publicFacts(p = {}) {
  return {
    business_name: p.business_name || p.name || "",
    city: p.city || "",
    state: p.state || "",
    industry: p.industry || p.category || "",
    rating: p.rating ?? (p.record && p.record.rating) ?? null,
    review_count: p.review_count ?? p.reviewCount ?? (p.record && p.record.review_count) ?? null,
    has_website: Boolean(p.current_website || p.website),
    preview_ready: Boolean(p.preview_url),
    status: p.status || "",
    top_gaps: (p.weaknesses || p.weakness_reasons || (p.record && p.record.weaknesses) || []).slice(0, 3),
    preview_url: p.preview_url || (p.record && p.record.preview_url) || "",
    // A legacy row can still hold a fabricated report link (a build slug in a
    // /report/ path). Riley reads this out loud to a caller, so it is validated
    // structurally rather than trusted — see lib/report-url.js.
    report_url: safeReportUrl(p.report_url || (p.record && p.record.report_url) || ""),
    // Derived when not stored, so Riley can read the Client ID back to confirm
    // she pulled up the right business instead of returning an empty string.
    reference: p.reference || (p.record && p.record.reference) || clientReferenceCode(p),
    // The identifiers the site-edit tool needs. Without these Riley had a
    // preview_url and nothing else, and would have had to invent a slug out of
    // a URL she was shown — a guess on the critical path of "change my site".
    prospect_id: p.prospect_id || null,
    site_slug: siteSlugFromRow(p) || null,
  };
}

/**
 * The whole tool, minus transport: given the parsed request body, return
 * `{ status, payload }` where payload is EXACTLY what the route sends — the
 * VAPI envelope already applied when the body carries a toolCallId.
 */
async function lookupProspectCore(body) {
  // VAPI wraps tool args: message.toolCalls[0].function.arguments
  const call = body?.message?.toolCalls?.[0];
  const args = call?.function?.arguments
    ? (typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments)
    : body;
  // "Pull my record up again" must not turn into "and who are you?". If the
  // model sent nothing usable but this call already established an identity,
  // use it rather than making the caller repeat himself.
  const identity = {
    reference: args.reference || args.reference_code || args.client_id || args.code || "",
    phone: args.phone || args.caller_phone || args.from || "",
    businessName: args.business_name || args.name || "",
    prospectId: args.prospect_id || args.prospectId || "",
    email: args.email || args.contact_email || "",
    city: args.city || args.town || "",
  };
  const callId = callIdFromBody(body);
  const hasIdentity = Boolean(identity.reference || identity.phone || identity.businessName || identity.prospectId || identity.email);
  if (!hasIdentity && callId) {
    const remembered = await recallCaller(callId);
    if (remembered && remembered.prospect_id) identity.prospectId = remembered.prospect_id;
  }

  const who = await resolveCaller(identity);

  let result;
  if (who.status === "ambiguous") {
    // Riley must READ THE LIST BACK and take a Client ID. Returning
    // found:false here would be a lie (we DID find them) and would push Riley
    // toward guessing; returning one row would be the silent-pick bug.
    result = {
      found: false,
      ambiguous: true,
      candidates: who.candidates,
      note: who.say,
    };
  } else if (who.status === "ok") {
    const unwrap = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);
    const rows = unwrap(await select(
      "ghost_agency_prospects",
      `?select=*&prospect_id=eq.${encodeURIComponent(who.prospect_id)}&limit=1`,
    ).catch(() => []));
    result = rows[0]
      ? { found: true, matched_by: who.matched_by, ...publicFacts(rows[0]) }
      : { found: false, note: "No record matched." };
    // Hand it to the rest of the call. A site change a minute from now
    // resolves off this, instead of asking for the Client ID a second time.
    if (callId && result.found) {
      await rememberCaller(callId, {
        site_slug: result.site_slug,
        business_name: result.business_name,
        client_id: result.reference,
        prospect_id: result.prospect_id,
        matched_by: who.matched_by,
      });
    }
  } else {
    // NOT A DEAD END. The resolver names the ONE key the caller has not
    // given yet (ask_for) and supplies the sentence that asks for it. Riley
    // speaks that sentence; the call climbs the ladder instead of ending.
    result = {
      found: false,
      unmatched: who.unmatched || { tried: [], ask_for: null, say: who.say },
      note: who.say,
    };
  }

  // VAPI tool-response shape
  if (call?.id) return { status: 200, payload: { results: [{ toolCallId: call.id, result: JSON.stringify(result) }] } };
  return { status: 200, payload: result };
}

module.exports = { lookupProspectCore, publicFacts };
