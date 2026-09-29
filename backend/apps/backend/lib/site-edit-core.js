"use strict";

// lib/site-edit-core.js — the core of api/vapi-tools/site-edit.js (and of its
// alias api/vapi-tools/request-site-change.js), extracted so the ONE proxy door
// (api/vapi-tools/riley.js) can dispatch to it as a library function instead of
// an HTTP hop. The route keeps only the transport shell; this module owns the
// whole tool.
//
// STATEFUL CONFIRM — THE SERVER REMEMBERS THE INSTRUCTION, THE MODEL NEVER
// CARRIES IT. (lib/riley-edit-state.js) The old contract made the confirming
// call re-send the instruction and seal it with a credential derived from the
// echoed words, so any rewording by the model killed an authorised edit as
// bad_signature / confirm_code_invalid. Now phase one STORES the instruction
// server-side, bound to the site the server resolved, and the confirming call
// carries only the six-character code (+ client_ref): the instruction arrives
// from storage, never from the model's memory. There is no token echo path —
// the voice door mints no token and accepts none; the long signed token
// remains a credential ONLY for the dashboard chat door, where a browser
// copies bytes exactly (api/connect/edit.js).
//
// TRUST ONCE — VERIFY ONCE, THEN TRUST. (lib/riley-edit-state.js) A caller who
// completed the code ceremony is remembered per client for
// GHOST_AGENCY_RILEY_TRUST_DAYS (default 30). Inside the window there is NO
// code: phase one answers `trust_confirm_required`, and Riley says the change
// back in HIS OWN words — not the caller's phrasing, his own divergent
// understanding, so a wrong understanding is audible and correctable — and a
// real yes from the caller, sent as caller_confirmed, finalizes. Identity
// resolution, the ambiguous-caller candidate list and the unidentifiable-site
// refusal still run on EVERY call; trust removes only the code ceremony, and
// it can only be gained by a recorded verification.
//
// ONE CHANGE AT A TIME — the guard against the silent-vanish class. Two
// request_site_change calls fired in one turn used to leave one request with
// no result at all. Every tool call in the webhook body is now answered (the
// fan-out inside siteEditCore), and a second change for a client that already
// has one waiting to be confirmed is refused with a distinct `edit_pending`
// error that tells the model to finish — or explicitly abandon — the first.
//
// CONFIRM BEFORE APPLY: the first call to this tool NEVER edits. It resolves
// the site, reads back the business name and domain, and stops. The credential
// primitives live in lib/edit-confirm.js — the dashboard chat panel
// (api/connect/edit.js) is the second door into the same engine, and both
// doors mint and verify with THAT module.
//
// WHO THIS CALL BELONGS TO, REMEMBERED ONCE. See lib/riley-call-memory.js for
// the two calls where a caller was made to read his Client ID out twice.

const { insertRow, recordEvent } = require("./store");
const { executeEditJob } = require("./edit-job-runner");
const {
  resolveSiteEditTarget,
  resolveSiteEditTargetForCaller,
  describeSiteEditTarget,
} = require("./site-edit-targets");
const {
  mintConfirmCode,
  confirmCodeValid,
} = require("./edit-confirm");
const {
  stagePendingEdit,
  recallPendingEdit,
  clearPendingEdit,
  markVerified,
  recallTrust,
  sameInstruction,
  trustWindowDays,
} = require("./riley-edit-state");
const {
  callIdFromBody,
  rememberCaller,
  recallCaller,
  recallCallerHot,
} = require("./riley-call-memory");

/** Loose compare for things a caller says out loud: case and punctuation free. */
const looseSame = (a, b) => {
  const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(norm(a) && norm(a) === norm(b));
};

/**
 * Does this sentence ask the customer to do our job for us?
 *
 * A refusal may say what we could not do. It may not turn round and ask a
 * plumber which section, which element, which file, which colour code or which
 * link — that is the engineering, and it is ours. Used to filter the planner's
 * own refusal sentence before it becomes the words Riley reads out; see the
 * long note at the refusal branch in the site-change planner for the live call
 * that produced it.
 *
 * Deliberately requires BOTH a request TO the caller and a thing for them to
 * point at, so an honest refusal that ends in "shall I get someone onto it?" or
 * offers a real choice ("bigger across the header, or just the logo?") is left
 * alone. A question mark is NOT required: "Tell me where exactly on the site
 * that sits" is the same homework in the imperative.
 */
const HOMEWORK_NOUN = /\b(section|element|part of the (?:page|site)|whereabouts|file|selector|class|colour code|color code|hex|url|link|site|page)\b/i;
const HOMEWORK_ASK = /\b(can you (?:tell|show|point|send|give)|could you (?:tell|show|point|send|give)|tell me (?:which|where|what)|point me at|which (?:one|section|element|page)|where (?:is|about|exactly)|what(?:'s| is) it near|do you know (?:which|where)|send me)\b/i;

function asksCallerToDoTheFinding(sentence) {
  const s = String(sentence || "");
  return HOMEWORK_ASK.test(s) && HOMEWORK_NOUN.test(s);
}

/**
 * The VAPI envelope, applied once. A non-VAPI caller sends no toolCallId and
 * gets the flat body unchanged, which is what every existing test and probe
 * expects.
 */
function enveloped(body, payload) {
  const toolCallId = body?.message?.toolCalls?.[0]?.id || "";
  if (!toolCallId) return payload;
  return { results: [{ toolCallId, result: JSON.stringify(payload) }] };
}

/** A caller's yes arrives as an explicit flag — never as the model's opinion. */
const truthy = (v) => /^(?:true|yes|y|1|confirmed)$/i.test(String(v == null ? "" : v).trim());

/**
 * ONE EDIT REQUEST, start to finish. Returns { status, payload } where payload
 * is the flat JSON the model (and every test and probe) reads — NOT enveloped;
 * the callers below apply the envelope. Throws only for the unexpected.
 */
async function handleEditRequest(args, body) {
  const siteSlug = String(args.siteSlug || args.site || "").trim();
  const instruction = String(args.instruction || args.request || "").trim().slice(0, 2000);

  // Credentials. confirm_token is deliberately ABSENT: the voice door minted
  // its last token the day the stateful confirm shipped. A 266-character
  // opaque string is a thing a browser copies, not a thing a voice model
  // carries — asking Riley to echo it is the exact defect (bad_signature on a
  // live call, twice, until the caller gave up) that the stateful confirm
  // exists to prevent.
  const confirmCode = String(
    args.confirm_code || args.confirmCode || args.confirmation_code || args.code || ""
  ).trim();
  const callerConfirmed = truthy(args.caller_confirmed ?? args.callerConfirmed ?? args.confirmed);
  const abandonPending = truthy(args.abandon_pending ?? args.abandonPending ?? args.abandon);

  // Caller identity, in the shapes Riley actually has mid-call: the Client ID
  // read off the email, the caller-ID number, or a spoken business name.
  //
  // `client_ref` is the universal-tool spelling: ONE field carrying whichever
  // of those three the caller actually gave. A voice model asked to sort an
  // utterance into the right one of three parameters will sometimes put a
  // phone number in `business_name`, and that misfiling is how a lookup
  // silently resolves to the wrong row. So the shape is decided here, from
  // the string, rather than trusted from the model — and the value is fanned
  // out to every field it could plausibly be, because resolveCaller() already
  // treats a multi-way match as a hard stop rather than a ranked guess.
  const ref = String(args.client_ref || args.clientRef || "").trim();
  const refDigits = ref.replace(/\D/g, "");
  const refLooksLikeCode = /^(?:wss-)?[a-z0-9]{4,12}$/i.test(ref) && /\d/.test(ref) && refDigits.length < 10;
  const identity = {
    reference: args.reference || args.reference_code || args.client_id || args.code
      || (refLooksLikeCode ? ref : ""),
    phone: args.phone || args.caller_phone || args.from
      || (refDigits.length >= 10 ? ref : ""),
    businessName: args.business_name || args.businessName || args.name
      || (ref && !refLooksLikeCode && refDigits.length < 10 ? ref : ""),
    prospectId: args.prospect_id || args.prospectId || "",
  };
  const hasIdentity = Boolean(identity.reference || identity.phone || identity.businessName || identity.prospectId);

  // A confirming call may legally arrive instruction-free (the stateful
  // contract: code + client_ref is enough — the instruction lives on the
  // server). Anything else with no words is not a request.
  if (!instruction && !confirmCode && !callerConfirmed) {
    return { status: 400, payload: { ok: false, error: "need a non-empty instruction" } };
  }

  // ---- WHO WE ALREADY ESTABLISHED, THIS CALL ------------------------
  // Free when the lambda is warm. The durable read is reached only when the
  // model sent no identity at all — which is precisely the request that used
  // to come back "need a Client ID" and cost the caller a repetition.
  const callId = callIdFromBody(body);
  let memory = callId ? recallCallerHot(callId) : null;
  if (!memory && callId && !hasIdentity && !siteSlug) memory = await recallCaller(callId);
  const memoryUsable = Boolean(memory && memory.site_slug);

  // Reuse it only when the caller has not named someone else. An identity we
  // cannot match against the memory re-resolves from scratch — a caller who
  // corrects himself mid-call must land on the corrected account, and that
  // safety is worth more than the scan it costs.
  const memoryIsThisCaller = memoryUsable && (
    !hasIdentity
    || looseSame(identity.reference, memory.client_id)
    || looseSame(identity.businessName, memory.business_name)
    || (identity.prospectId && identity.prospectId === memory.prospect_id)
  );

  if (!siteSlug && !hasIdentity && !memoryUsable) {
    return { status: 400, payload: { ok: false, error: "need a siteSlug, or a Client ID / phone / business name to identify the caller" } };
  }

  // Resolve WHO is calling before resolving WHAT to edit.
  //
  // COLLISION SAFETY: when the caller's identity matches more than one
  // business, resolveSiteEditTargetForCaller returns status "ambiguous" and
  // NO target. We return that read-back to Riley and enqueue nothing. Riley
  // must speak the candidate list and take a Client ID. Editing a stranger's
  // live site is the one failure in this system with no undo from the
  // caller's side — so an ambiguous match is a hard stop, never a best guess.
  // This guard runs on EVERY call, trusted or not: trust removes a code
  // ceremony, never an identity check.
  let site = null;
  let resolvedSlug = siteSlug;
  let resolved = null;
  if (memoryIsThisCaller && (!siteSlug || looseSame(siteSlug, memory.site_slug))) {
    // ALREADY RESOLVED, SECONDS AGO, IN THIS SAME CALL.
    // This is not a weakened check — it is the same check, not run twice.
    // resolveCaller() re-derives the Client ID for every row in the client
    // table to match a spoken code; running that again on the phase-2 call is
    // time the caller spends listening to silence for an answer we already
    // have. The deploy-target ownership gate below still runs in full.
    resolvedSlug = memory.site_slug;
    site = await resolveSiteEditTarget(resolvedSlug);
    resolved = {
      status: "ok",
      site_slug: memory.site_slug,
      prospect_id: memory.prospect_id || null,
      matched_by: memory.matched_by ? `${memory.matched_by}+call_memory` : "call_memory",
    };
  } else if (hasIdentity) {
    resolved = await resolveSiteEditTargetForCaller(identity);
    if (resolved.status === "ambiguous") {
      return { status: 409, payload: {
        ok: false,
        status: "ambiguous",
        error: "caller matched more than one client; confirm before editing",
        candidates: resolved.candidates,
        say: resolved.say,
        next: "Say the `say` line and read the candidates out. Take the Client ID from the top of their email — it is the only thing that separates these accounts. Never pick one yourself, and do not ask for anything technical about the site.",
      } };
    }
    if (resolved.status !== "ok") {
      return { status: 400, payload: { ok: false, status: resolved.status, error: "no editable site for that caller", say: resolved.say } };
    }
    // A slug the model volunteered must not override the slug the caller's
    // verified identity resolved to — that is the same silent-wrong-client
    // failure, just sourced from the transcript instead of the database.
    if (siteSlug && siteSlug.toLowerCase() !== String(resolved.site_slug || "").toLowerCase()) {
      return { status: 409, payload: {
        ok: false,
        status: "identity_slug_mismatch",
        error: "the supplied siteSlug does not belong to the identified caller",
        say: "Let me double-check which account this is before I change anything.",
        next: "Do not send a siteSlug. Call this tool again with client_ref and instruction only, and let the server resolve the site.",
      } };
    }
    site = resolved.target;
    resolvedSlug = resolved.site_slug;
  } else {
    // Never enqueue against a slug we can't map to a real, ghost-owned
    // deploy target — this is the caller-facing edge of the voice loop, so
    // it fails closed rather than trusting whatever the model said.
    site = await resolveSiteEditTarget(siteSlug);
  }
  if (!site) {
    return { status: 400, payload: { ok: false, error: "siteSlug is not a registered, editable site" } };
  }

  // ---- CONFIRM BEFORE APPLY ----------------------------------------
  // Name the business out loud, and stop, unless this call is carrying the
  // credential from that read-back.
  const described = await describeSiteEditTarget(resolvedSlug);
  if (!described) {
    // Editable but not nameable. We will not ask a caller to confirm a
    // site we cannot identify, and we will not skip the confirmation.
    return { status: 409, payload: {
      ok: false,
      status: "unidentifiable_site",
      error: "resolved a deploy target but could not determine whose site it is; refusing to edit unconfirmed",
      // THE HONEST LINES. No team to flag it to, no callback machinery — the
      // only true things to say are that nothing will change and that it is
      // noted.
      say: "I can see the site, but I can't confirm the business it belongs to — I'm not going to change anything until that's verified, so I'll note that and leave your site exactly as it is.",
    } };
  }
  // REMEMBERED HERE, once per call, so that nothing later in this call has to
  // ask the man who he is again. It costs one insert (~200ms) on the first
  // request of a call and nothing on the rest; the repetition it removes cost
  // a real caller two rounds of reading his Client ID out loud.
  if (callId) {
    await rememberCaller(callId, {
      site_slug: described.site_slug,
      business_name: described.business_name,
      domain: described.domain,
      client_id: described.client_id,
      prospect_id: resolved ? resolved.prospect_id : null,
      matched_by: resolved ? resolved.matched_by : "slug_only",
    });
  }

  const readBack = {
    business_name: described.business_name,
    domain: described.domain,
    site_slug: described.site_slug,
    client_id: described.client_id,
    identified_from: described.source,
  };

  // ---- STATE: what is already waiting, and is this caller trusted? -----
  const pending = await recallPendingEdit(described.site_slug);
  const trust = await recallTrust({ siteSlug: described.site_slug, clientId: described.client_id });

  const confirmFactsFor = (text) => ({
    siteSlug: described.site_slug,
    businessName: described.business_name,
    domain: described.domain,
    instruction: text,
  });

  /** Phase one, in whichever voice the caller's trust earns. */
  const phaseOne = async (pendingInstruction) => {
    const record = await stagePendingEdit({
      siteSlug: described.site_slug,
      clientId: described.client_id,
      businessName: described.business_name,
      domain: described.domain,
      instruction: pendingInstruction,
    });
    if (trust.trusted) {
      // THE TRUST-ONCE PATH. No code, no ceremony — and deliberately NO `say`
      // script: the paraphrase must be Riley's OWN restatement of what he
      // understood, not a server line read verbatim. An echo would be a
      // second copy of the words with none of the understanding, and a
      // misunderstanding hidden inside an echo is exactly what the paraphrase
      // law exists to surface.
      return { status: 200, payload: {
        ok: true,
        status: "trust_confirm_required",
        applied: false,
        queued: false,
        confirm: readBack,
        instruction: record.instruction,
        paraphrase: true,
        trust: { verified: true, window_days: trustWindowDays() },
        next: [
          "This caller is already verified — NO code is needed and none was issued. Do not mention codes or verification at all.",
          "THE PARAPHRASE LAW: repeat the change back to the caller in YOUR OWN words — never in theirs — as your own understanding of what they want, and name the business you have on file so a wrong account match is audible. A restatement like 'So that's the phone number twice the size, sitting top of the page on <Business> — did I get that right?' is the shape.",
          "Wait for a clear yes to YOUR wording. If your understanding was wrong, they will hear it in your paraphrase and correct you — restate the correction the same way before going on.",
          "Only on a real yes: call this tool again with client_ref and caller_confirmed: true. The server already holds the exact instruction; you do not need to repeat it. Do not send caller_confirmed on anything less than the caller's own clear yes.",
          "On no or on a correction you cannot settle, change nothing and take the request from the top.",
        ].join(" "),
      } };
    }
    // FIRST-EVER (or trust expired): the full ceremony, six speakable
    // characters, bound server-side to the instruction now in storage.
    const facts = confirmFactsFor(record.instruction);
    return { status: 200, payload: {
      ok: true,
      status: "confirm_required",
      applied: false,
      queued: false,
      confirm: readBack,
      instruction: record.instruction,
      // SIX CHARACTERS, because that is what a voice model can actually carry
      // back. See mintConfirmCode: a long opaque token is correct and unusable
      // here — Riley mangled one twice on a real call and the caller was told
      // the system glitched on a change that was authorised. The token path no
      // longer exists on this door at all: the code plus the server-held
      // instruction ARE the credential pair.
      confirm_code: mintConfirmCode(facts),
      // THE ONE CONFIRMATION. It names the business the SERVER resolved —
      // that is the wrong-client guard, and it is the only reason a caller is
      // asked anything at all. One sentence, one question mark: the old
      // wording asked two ("the right business AND the right change?"), which
      // is an invitation to answer twice.
      //
      // The DOMAIN is never read out — on a live call Riley said the words
      // "wss-test-harris-air-west-sacramento dot wss dash ai dot com" to a man
      // who wanted his phone number enlarged. The owner's note on call
      // 019fd8d1: "you don't have to double verify the site URL and whatnot."
      // A business name identifies the site to the one person on the call who
      // knows it; the domain is machine detail and stays in `confirm` and in
      // the audit event only.
      //
      // Trailing punctuation is stripped because the instruction is a
      // sentence the caller dictated: "…make it bigger." + "." rendered as
      // "…make it bigger.. Yes?" on a real run.
      say: `One check so I don't touch the wrong site — ${described.business_name}, and the change is: ${String(record.instruction).replace(/[.\s]+$/, "")}. Yes?`,
      next: [
        "Say the `say` line above out loud, as written. It is the ONLY confirmation this change needs — do not add a confirmation of your own before it or after it, and do not repeat the request back in your own words on this path.",
        "On yes: call this tool again straight away with client_ref and confirm_code — six characters, copied exactly from this response. You do NOT need to repeat the instruction; the server has bound the code to the exact change read back here. Never say the code, or the word 'code', to the caller.",
        "On no: do not retry — ask for the Client ID printed on their email and start again from a first call.",
        "This confirm_code belongs to THIS instruction only. If the caller asks for anything different, even slightly reworded, start from a fresh first call with NO confirm_code and use the new code that call returns.",
      ].join(" "),
    } };
  };

  // ---- FINALIZE: a credential is on the table ------------------------
  if ((confirmCode || callerConfirmed) && pending && (!instruction || sameInstruction(instruction, pending.instruction))) {
    const facts = confirmFactsFor(pending.instruction);
    const codeOk = confirmCode ? confirmCodeValid(confirmCode, facts) : false;
    const viaTrust = trust.trusted && callerConfirmed;
    if (codeOk || viaTrust) {
      const jobId = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await insertRow("ghost_agency_edit_jobs", {
        job_id: jobId,
        site_slug: resolvedSlug,
        // THE INSTRUCTION COMES FROM STORAGE — the exact words the caller was
        // read back and said yes to, not the model's memory of them.
        instruction: pending.instruction,
        status: "queued",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await recordEvent("ghost_agency_site_edit_queued", {
        jobId,
        siteSlug: resolvedSlug,
        instruction: pending.instruction,
        // Recorded so an edit can always be traced back to the identity that
        // authorized it, and how that identity was matched.
        matched_by: resolved ? resolved.matched_by : "slug_only",
        prospect_id: resolved ? resolved.prospect_id : null,
        // The read-back the caller actually approved, and where the name we
        // spoke came from. An edit can now be audited against the exact words
        // the customer said yes to.
        confirmed: true,
        confirmed_business_name: described.business_name,
        confirmed_domain: described.domain,
        confirmed_via: described.source,
        // WHICH credential finalized it: the code ceremony or the caller's
        // yes to Riley's paraphrase inside the trust window.
        credential: codeOk ? "confirm_code" : "trusted_yes",
        client_id: described.client_id || null,
      });
      // VERIFY ONCE, THEN TRUST: a full code ceremony earns the caller the
      // window; a trusted yes refreshes it.
      await markVerified({
        siteSlug: described.site_slug,
        clientId: described.client_id,
        via: codeOk ? "confirm_code" : "trusted_yes",
      });
      await clearPendingEdit(described.site_slug, { jobId, instruction: pending.instruction });

      // ── FAST-ACK: THE ANSWER GOES BACK BEFORE THE BUILD IS TOUCHED ──────
      //
      // The inline race this replaced ("run it now, but answer by 17.5s") was
      // tuned from one call's measurements and killed by the next month's. The
      // production Agents & Calls tab, 2026-08-17, shows the same death across
      // five businesses: "call ended due to exceeding maximum duration while the
      // AI was processing the requested website change", "timed out due to
      // silence", "call ended while they waited". Larson AC called three times
      // for ONE change; Poor John's Plumbing waited on hold until the line died.
      // Every one of those callers had already SAID YES — the edit was confirmed,
      // the work was running, and the call still burned to death while the tool
      // held its breath waiting for the rebuild.
      //
      // The budget could have been 3s or 12s or 17.5s and it would not have
      // mattered: ANY inline wait is silence on the one channel where silence
      // ends the call, spent on work (plan, apply, deploy, render, verify —
      // ~10.5s measured on the SIMPLE case, with a tail past ten minutes) that
      // was never going to fit inside a voice turn. So the contract is now
      // fast-ack, and it is a CONTRACT, not a tuning:
      //
      //   1. The confirmed request is answered the moment it is queued — the
      //      caller hears "it's in and building" from Riley's own mouth, in the
      //      same breath as the yes, and the call LIVES.
      //   2. The runner is kicked but never awaited. A serverless instance may
      //      freeze the moment res.end runs and take the kick with it — that is
      //      fine, because durability was never this request's to carry: the
      //      every-2-minutes sweeper (api/cron/run-edit-jobs) drains the queue,
      //      the atomic claim in lib/edit-job-runner.js prevents a frozen kick
      //      and a live sweeper from double-deploying, and a stale "running"
      //      claim is reclaimed after STALE_RUNNING_MS.
      //   3. Where the change stands is site_edit_status's job, and it already
      //      speaks every state this job can reach — the progress meter, the
      //      landing, the refusal, the failure. Riley narrates by polling; he
      //      no longer babysits the build inside a tool call.
      //
      // NO COMPLETION EMAIL IS PROMISED TO THE CALLER. The owner's inbox gets
      // one on every terminal state (notifyOwner in lib/edit-job-runner.js),
      // but the customer-facing send rail is owner-only today
      // (lib/riley-send-note-core.js ALLOWED_RECIPIENTS) and there is no SMS
      // provider at all — a fast-ack that said "you'll get a text the moment
      // it's live" would be the same fabricated promise this file spent three
      // comment blocks eradicating, just in a cheerier voice. The promise Riley
      // makes below is one the system keeps: he checks, on the call or at the
      // next one.
      executeEditJob(jobId).catch(() => {
        // The kick is best-effort by design (see 2 above); a failure here is
        // the sweeper's queue, not the caller's problem. Nothing to do.
      });

      return { status: 200, payload: {
        ok: true,
        jobId,
        status: "queued",
        applied: false,
        queued: true,
        confirmed: readBack,
        // The fast-ack sentence. It promises exactly two things — the change is
        // building, and Riley will tell the caller where it stands — and no
        // duration, no email, and no fourth confirmation of anything. The
        // business name and domain are NOT repeated: they were said in the
        // read-back and the caller already agreed to them.
        say: "Done — that's in and building now. You don't have to sit there waiting on me: stay on the line and I'll check it before we hang up, or call back whenever suits you and I'll tell you exactly where it stands.",
        next: [
          "Say the `say` line. The change is authorised and running — do not confirm anything again, do not re-send it, and do not run this tool again for the same request.",
          "NEVER put a time on it — nothing here knows how long this one takes, and a silence-filled wait is what killed these calls before.",
          "To find out where it stands, call site_edit_status with this jobId — now, later in this call, or on their next call — and say whatever sentence that gives you.",
          "One change at a time: only start another change after this one, and only when the caller asks for one.",
        ].join(" "),
      } };
    }

    // A credential that does not open this lock.
    if (confirmCode && !codeOk) {
      await recordEvent("ghost_agency_site_edit_confirm_rejected", {
        siteSlug: described.site_slug,
        reason: "confirm_code_invalid",
        instruction: pending.instruction,
      });
      return { status: 409, payload: {
        ok: false,
        status: "confirm_invalid",
        reason: "confirm_code_invalid",
        applied: false,
        queued: false,
        confirm: readBack,
        instruction: pending.instruction,
        // A USABLE CODE FOR THE CHANGE ALREADY READ BACK.
        //
        // The code is bound server-side to the stored instruction, so a bad
        // code here is a garbled or stale code for THIS change — not a
        // different request. (A different request no longer reaches this
        // branch at all: it is refused as `edit_pending` below.) Hand back a
        // fresh code for the pending instruction so the model never needs a
        // third round trip to finish what the caller already said yes to.
        confirm_code: mintConfirmCode(facts),
        say: `Let me lock this one in — ${described.business_name}, and the change is: ${String(pending.instruction).replace(/[.\s]+$/, "")}. Yes?`,
        next: [
          "The code you sent did not match. Do not apologise for it, do not explain it, and do not mention codes or confirmations to the caller at all.",
          "Say the `say` line above once more, as written. On yes: call this tool again with client_ref and the confirm_code from THIS response, copied exactly. Do not run another first call and do not ask a third time.",
        ].join(" "),
      } };
    }
    // caller_confirmed without trust, or a trusted credential arriving while
    // trust has expired: fall through to phase one, which issues whatever the
    // caller's ACTUAL trust state earns — never what the model asserted.
  }

  // ---- PHASE ONE (and the one-change-at-a-time guard) -----------------
  if (pending) {
    if (!abandonPending && instruction && !sameInstruction(instruction, pending.instruction)) {
      // A SECOND, DIFFERENT CHANGE WHILE ONE IS WAITING. This is the guard
      // for the silent-vanish class: parallel request_site_change calls used
      // to leave one request with no answer and no trace. Nothing is
      // enqueued and nothing is dropped — the model is told, distinctly,
      // that the first change must be finished or explicitly abandoned.
      await recordEvent("ghost_agency_site_edit_pending_collision", {
        siteSlug: described.site_slug,
        pending_instruction: pending.instruction.slice(0, 200),
        new_instruction: instruction.slice(0, 200),
      });
      return { status: 409, payload: {
        ok: false,
        status: "edit_pending",
        error: "another change for this client is already waiting to be confirmed; finish or abandon it before starting another",
        pending: {
          instruction: pending.instruction,
          // A trusted caller can finish the first change with caller_confirmed;
          // everyone else needs the code that was issued with its read-back.
          ...(trust.trusted ? {} : { confirm_code: mintConfirmCode(confirmFactsFor(pending.instruction)) }),
        },
        say: "Happy to do that too — one thing at a time. Let's finish the first change, then I'll get straight onto this one.",
        next: [
          "A previous change is still waiting to be confirmed. Finish it FIRST: say its read-back (pending.instruction) and on yes call this tool again with client_ref plus that change's confirm_code — or caller_confirmed: true if no code was issued for it.",
          "Only once the first change answers `queued` may you start this second one: call the tool again with the new instruction.",
          "If the caller no longer wants the first change, call once more with client_ref, this NEW instruction, and abandon_pending: true — that drops the first request and starts this one. Say nothing about mechanics to the caller; 'let's finish this one first' is the whole story.",
          "Never fire two tool calls in one turn and never start a second change while one is unconfirmed — the server refuses both shapes.",
        ].join(" "),
      } };
    }
    // Same instruction again (a model retry), or an explicit abandon: the
    // pending record is simply restaged below and phase one answers again —
    // idempotent, with the same stable code the first read-back issued.
  }

  // A credential arrived but there is nothing to finalize (stale code, or the
  // server has no memory of the read-back): phase one, from scratch.
  let pendingInstruction = (instruction || (pending && pending.instruction) || "");
  if (!pendingInstruction) {
    return { status: 400, payload: { ok: false, error: "need a non-empty instruction" } };
  }
  // A RE-REQUEST OF THE SAME CHANGE KEEPS THE STORED WORDING CANONICAL. The
  // caller said it once; the model retyping it with different case or a
  // dropped word must not mint a second credential for what is textually a
  // different string — the code and the pending instruction must stay the
  // pair the caller already heard.
  if (pending && instruction && sameInstruction(instruction, pending.instruction)) {
    pendingInstruction = pending.instruction;
  }
  return phaseOne(pendingInstruction);
}

/**
 * The whole tool, minus transport: given the parsed request body, return
 * `{ status, payload }` where payload is EXACTLY what the route sends
 * (envelope already applied). Throws only for the unexpected; the route turns
 * a throw into the same 500 it always produced.
 */
async function siteEditCore(body) {
  const toolCalls = body?.message?.toolCalls;

  if (Array.isArray(toolCalls) && toolCalls.length) {
    // EVERY TOOL CALL IN THE BODY GETS AN ANSWER. Vapi expects one result
    // per toolCallId; reading only toolCalls[0] is how a parallel second
    // request came back "No result returned" and its change silently
    // vanished. The per-call payload is the same flat JSON as ever; the
    // collision guard above is what stops the two calls from racing each
    // other into the queue.
    const results = [];
    for (const call of toolCalls) {
      let callArgs = call?.function?.arguments ?? {};
      if (typeof callArgs === "string") { try { callArgs = JSON.parse(callArgs); } catch { callArgs = {}; } }
      let out;
      try {
        out = await handleEditRequest(callArgs || {}, body);
      } catch (error) {
        out = { status: 200, payload: { ok: false, error: String((error && error.message) || error) } };
      }
      results.push({ toolCallId: call?.id || "", result: JSON.stringify(out.payload) });
    }
    return { status: 200, payload: { results } };
  }

  // Non-VAPI callers (tests, probes) send one flat body and get the flat
  // payload with its status code, exactly as always.
  let args = body?.message?.toolCalls?.[0]?.function?.arguments || body;
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
  const out = await handleEditRequest(args || {}, body);
  return { status: out.status, payload: enveloped(body, out.payload) };
}

module.exports = { siteEditCore, asksCallerToDoTheFinding, enveloped };
