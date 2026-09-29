"use strict";

// lib/riley-context-core.js — the core of api/riley/context.js — Riley's eyes.
// One read, no writes, no new verbs. Extracted so the ONE proxy door
// (api/vapi-tools/riley.js) can dispatch to it as a library function instead of
// an HTTP hop. The route keeps only the method/auth/body plumbing; this module
// owns the resolution and the answer, byte-for-byte as the route carried them.
//
// WHAT IT ANSWERS, in one call, before Riley speaks:
//
//   who       the business the caller resolved to (never one they named)
//   context   what has actually passed between us and them —
//             email both ways, dashboard messages, their site's chat, every
//             change they asked for WITH ITS REAL OUTCOME, and their files
//   can_do    the executor's real verb list, and the single refusal sentence
//             for everything else
//   timing    the measured p90 for a request of this shape, or no number
//
// THE SLUG NEVER COMES OFF THE REQUEST. The caller is resolved to a site by the
// same collision-safe resolver the edit path uses, and THEN this handler signs
// a scope token for that slug and hands the token to lib/riley-context.js. The
// signing looks circular for one second and is not: it means the context module
// has exactly one way in — a signature — so no future caller can hand it a slug
// off a request body. The dashboard passes the customer's own token to the same
// function.
//
// AMBIGUITY IS A HARD STOP, exactly as it is for editing. Reading a stranger's
// messages out to a caller is not a smaller mistake than editing their site.

const { signScopeToken } = require("./dashboard-link");
const { readRileyContext, priceLine } = require("./riley-context");
const { capabilityBrief, describeCapability } = require("./riley-capabilities");
const { describeEditTiming } = require("./edit-timing");
const {
  resolveSiteEditTargetForCaller,
  describeSiteEditTarget,
} = require("./site-edit-targets");
const {
  callIdFromBody,
  rememberCaller,
  recallCaller,
  recallCallerHot,
} = require("./riley-call-memory");

/** Same loose compare the edit tool uses for things said out loud. */
const looseSame = (a, b) => {
  const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(norm(a) && norm(a) === norm(b));
};

/**
 * One field carrying whatever the caller actually gave — a Client ID, a phone
 * number or a business name — sorted out here from the string rather than
 * trusted from the model. Lifted deliberately from the site-edit core:
 * a voice model asked to file an utterance into one of three parameters will
 * sometimes put a phone number in `business_name`, and that misfiling is how a
 * lookup silently resolves to the wrong row.
 */
function identityFrom(args) {
  const ref = String(args.client_ref || args.clientRef || "").trim();
  const refDigits = ref.replace(/\D/g, "");
  const looksLikeCode = /^(?:wss-)?[a-z0-9]{4,12}$/i.test(ref) && /\d/.test(ref) && refDigits.length < 10;
  return {
    reference: args.reference || args.reference_code || args.client_id || args.code || (looksLikeCode ? ref : ""),
    phone: args.phone || args.caller_phone || args.from || (refDigits.length >= 10 ? ref : ""),
    businessName: args.business_name || args.businessName || args.name
      || (ref && !looksLikeCode && refDigits.length < 10 ? ref : ""),
    prospectId: args.prospect_id || args.prospectId || "",
  };
}

/**
 * The VAPI envelope, applied once. The route used to wrap res.end so that
 * every return point — including a caught 500 — answered bound to the
 * toolCallId; with the core as a library function the same binding is applied
 * explicitly at each return. Same bodies, one place.
 */
function enveloped(body, payload) {
  const toolCallId = body?.message?.toolCalls?.[0]?.id || "";
  if (!toolCallId) return payload;
  return { results: [{ toolCallId, result: JSON.stringify(payload) }] };
}

/**
 * The whole tool, minus transport: given the parsed request body, return
 * `{ status, payload }` where payload is EXACTLY what the route sends
 * (envelope already applied).
 */
async function rileyContextCore(body) {
  let args = body?.message?.toolCalls?.[0]?.function?.arguments || body;
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }

  // Optional: the request the caller is making, so the answer can carry a
  // measured duration and a straight yes/no on capability alongside the
  // history. Never used to change what is READ.
  const instruction = String(args.instruction || args.request || "").trim().slice(0, 2000);

  const identity = identityFrom(args);
  const hasIdentity = Boolean(identity.reference || identity.phone || identity.businessName || identity.prospectId);

  // WHO WE ALREADY ESTABLISHED THIS CALL. Free on a warm lambda; the durable
  // read is only reached when the model sent no identity at all — which is
  // exactly the request that used to cost the caller a repetition.
  const callId = callIdFromBody(body);
  let memory = callId ? recallCallerHot(callId) : null;
  if (!memory && callId && !hasIdentity) memory = await recallCaller(callId);
  const memoryUsable = Boolean(memory && memory.site_slug);
  const memoryIsThisCaller = memoryUsable && (
    !hasIdentity
    || looseSame(identity.reference, memory.client_id)
    || looseSame(identity.businessName, memory.business_name)
    || (identity.prospectId && identity.prospectId === memory.prospect_id)
  );

  let slug = "";
  let described = null;
  if (memoryIsThisCaller) {
    slug = memory.site_slug;
  } else if (hasIdentity) {
    const resolved = await resolveSiteEditTargetForCaller(identity);
    if (resolved.status === "ambiguous") {
      // A HARD STOP, and a QUIETER one than the edit tool's.
      //
      // resolveSiteEditTargetForCaller returns candidates carrying
      // `client_id`, and the edit core passes them straight through — so a
      // caller who names a common trade word hears real Client IDs belonging
      // to businesses that are not theirs. That is tolerable-ish there because
      // a Client ID alone still cannot apply a change: the confirm read-back
      // names the business out loud first. It is NOT tolerable here, because
      // this endpoint's whole job is to hand back private history, and a
      // Client ID is the credential that unlocks it.
      //
      // Riley needs the NAMES to ask "which of these are you?" — nothing more.
      // The IDs are dropped. (The wider leak in the edit tool is reported to
      // the owner rather than fixed here; that tool is being worked on.)
      const candidates = (Array.isArray(resolved.candidates) ? resolved.candidates : [])
        .map((c) => ({ business_name: c && c.business_name, city: c && c.city, state: c && c.state }));
      return {
        status: 409,
        payload: enveloped(body, {
          ok: false,
          status: "ambiguous",
          error: "caller matched more than one client",
          candidates,
          say: resolved.say,
          next: "Say the `say` line and read the business names out so they can tell you which one is theirs. Then take the Client ID from the top of their email — that is the only thing that separates these accounts. Never pick one yourself, never read an ID out to them, and do not read anything back from an account you have not confirmed.",
        }),
      };
    }
    if (resolved.status !== "ok" || !resolved.site_slug) {
      return {
        status: 404,
        payload: enveloped(body, {
          ok: false,
          status: "not_found",
          say: resolved.say || "I can't find an account under that just yet. The Client ID at the top of your email is the quickest way for me to pull you up.",
        }),
      };
    }
    slug = resolved.site_slug;
    // Remember, once, so nothing later in this call asks who they are again.
    if (callId) {
      described = await describeSiteEditTarget(slug).catch(() => null);
      if (described) {
        await rememberCaller(callId, {
          site_slug: described.site_slug,
          business_name: described.business_name,
          domain: described.domain,
          client_id: described.client_id,
          prospect_id: resolved.prospect_id || null,
          matched_by: resolved.matched_by || null,
        }).catch(() => {});
      }
    }
  } else {
    return {
      status: 400,
      payload: enveloped(body, {
        ok: false,
        status: "need_identity",
        say: "Whose website am I looking at? The Client ID at the top of your email pulls you straight up.",
      }),
    };
  }

  // THE SIGNATURE IS THE ONLY WAY IN. See the note at the top of this file.
  const scopeToken = signScopeToken(slug, 1);
  if (!scopeToken) {
    return {
      status: 503,
      payload: enveloped(body, {
        ok: false,
        status: "unavailable",
        say: "I can't pull your history up this second. Ask me again in a moment and I'll have it.",
      }),
    };
  }

  const context = await readRileyContext({ scopeToken });
  if (!context.ok) {
    return {
      status: 404,
      payload: enveloped(body, {
        ok: false,
        status: "not_found",
        say: "I can't pull that account up. The Client ID at the top of your email is the quickest way for me to find you.",
      }),
    };
  }

  const capability = instruction ? describeCapability(instruction) : null;
  const timing = instruction && capability && capability.supported
    ? await describeEditTiming({ instruction }).catch(() => null)
    : null;

  return {
    status: 200,
    payload: enveloped(body, {
      ok: true,
      status: "ok",
      business_name: context.business_name || (described && described.business_name) || null,
      // THE PRICE PIN. Three price systems were found in the call corpus (a v0
      // prompt's $99/$499–$1299, the v2/v4 prompt's $200, and the caller's own
      // email saying $149/$199), so pricing is no longer a prompt fact at all:
      // it is THIS line, server-side, from GHOST_AGENCY_PRICE_LINE. Whatever
      // prompt version is live, the only price Riley can quote is the one this
      // response hands him. See lib/riley-context.js priceLine().
      price_line: priceLine(),
      context,
      can_do: capabilityBrief(),
      ...(capability ? { capability } : {}),
      ...(timing ? { timing } : {}),
      // The whole point: one paragraph of things that are true, so Riley
      // answers "did you get my email?" from a record instead of from nothing.
      say: context.spoken,
      next: [
        "This is BACKGROUND. Do not read it out as a list and do not volunteer it — use it to answer what they actually ask.",
        "Everything here is a recorded fact. If a section says it could not be read, say you cannot see that right now; never fill the gap with a guess.",
        "`can_do.refusal` is the ONLY sentence for a request outside `can_do.verbs`. Never promise a change that is not on that list.",
        "`price_line` is the ONLY pricing you may quote — never a number from memory, another prompt version, or an old email.",
        "If `timing` is present, its `say` is the only duration you may quote. With no `timing`, put no time on it at all.",
      ].join(" "),
    }),
  };
}

module.exports = { rileyContextCore, identityFrom };
