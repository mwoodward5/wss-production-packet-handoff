"use strict";

// lib/line-email-assets.js — everything the proof email shows, captured ONCE,
// in the browser the render gate already has open.
//
// ---------------------------------------------------------------------------
// WHAT THIS REPLACES
// ---------------------------------------------------------------------------
// The send path used to open its own chromium per prospect and shoot four
// screenshots inside the request that was trying to send the email. Measured on
// the queued rows that is 28–35s each and 90s+ at the tail — one prospect's
// current site (dripfixplumbingde.com) took 41,208ms to reach networkidle, 1.7%
// under the timeout, and it is photographed twice (desktop and mobile). The
// send route budgets 210s per invocation, so that is six or seven sends before
// it has to stop and be called again. That is the wall the line hits.
//
// None of that work has to happen at send time. The render gate opens a browser
// on the finished mirror anyway, and it opens it at BUILD time, where minutes
// are already being spent on deploys. So this module is called from the gate's
// capture hook with the gate's own browser, and the send path reads what it
// stored and launches nothing.
//
// ---------------------------------------------------------------------------
// WHY IT IS SAFE FOR THE SEND PATH TO TRUST WHAT IT FINDS
// ---------------------------------------------------------------------------
// Because the assets are keyed to a BUILD, not to a URL. `build_hash` is the
// mirror engine's own identity for the deployed bytes; it changes when the site
// changes and it does not change when it does not. assetsAreCurrent() compares
// the hash stored WITH the pictures against the hash on the row being sent, and
// anything short of an exact match on a non-empty pair is a NO — a legacy row,
// a row built before this existed, a row whose mirror was rebuilt, and a row
// with no hash at all all fall through to capturing exactly as before.
//
// The one refusal that is NOT retried is a "before" shot that landed off the
// prospect's own registrable domain. That is a fact about their domain, not a
// flake: re-shooting the same site for the same build produces the same
// refusal, forty seconds later, and the email's own evidence gate then blocks
// the send — which is the correct answer, arriving cheaply instead of slowly.

const { ensureLineProofShots } = require("./line-proof-shots");
const { ensureLineMotionShot } = require("./line-motion-shot");
const { normalizeProofIdentity } = require("./proof-storage");

// How long the capture may hold the gate's browser. Bounded because
// lib/serverless-chromium hands out ONE browser permit at a time and releases
// it unconditionally after MAX_PERMIT_HOLD_MS (240s) — a capture that outran
// that would leave the permit and the browser disagreeing about how many
// browsers exist. Two 45s site loads plus the loop fit inside this with room.
const CAPTURE_BUDGET_MS = 120_000;
// The motion loop is the last thing captured and the first thing dropped: the
// email falls back to the still, which is what it ships today.
const MOTION_MIN_MS = 25_000;
const AUTOMATIC_PROOF_SHOTS_ENV = "GHOST_AGENCY_LINE_PROOF_SHOTS";
// Proof identities name ONE immutable release. Mirror-built rows carry real
// Vercel identifiers here (dpl_... / project ids), shared-release rows carry
// deterministic UUIDs — both are accepted; neither may contain separators that
// could forge proof-storage key material (letters, digits, dash, underscore).
const SHARED_ID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const SHARED_BUILD_HASH_RE = /^[0-9a-f]{64}$/;

// Factory default: every passing Line build leaves the render gate with its
// email evidence already photographed. Setting the switch to the exact string
// "0" restores the previous send-time fallback without weakening any visual,
// identity, consent, or delivery gate.
function automaticProofShotsEnabled(environment = process.env) {
  return String((environment || {})[AUTOMATIC_PROOF_SHOTS_ENV] || "").trim() !== "0";
}

function beforeIdentityRefusal(capture) {
  const shots = capture && capture.shots && typeof capture.shots === "object"
    ? capture.shots
    : {};
  const recorded = String(shots.before_refused || "");
  if (/^capture_identity_/.test(recorded)) return recorded;
  const result = (capture && Array.isArray(capture.results) ? capture.results : [])
    .find((entry) => (
      /^old(?:-|$)/.test(String(entry && entry.variant || ""))
      && /^capture_identity_/.test(String(entry && entry.reason || ""))
    ));
  return result ? String(result.reason) : "";
}

/**
 * Return the canonical record only when every captured source-side image kept
 * its identity. One old/old-mobile domain mismatch makes the automatic write
 * record NOTHING; the send-time path then re-runs and its visual gate refuses.
 */
function automaticProofShotRecord(capture, { currentWebsite = null } = {}) {
  if (!capture || capture.ok !== true || !capture.shots || typeof capture.shots !== "object") return null;
  const shots = capture.shots;
  if (beforeIdentityRefusal(capture)) return null;

  // Automatic persistence is a complete before/after proof contract, not a
  // bag of whatever happened to finish before the gate's deadline. Requiring
  // both URLs and both full SHA-256 digests prevents a new-only capture (or an
  // unverifiable object) from being mistaken for email-ready evidence.
  // A lead with no current website has no truthful "before" image to capture.
  // Callers must opt into that known state by supplying currentWebsite: "";
  // the default remains strict so an accidentally omitted input cannot weaken
  // the complete before/after contract for a business that does have a site.
  const beforeRequired = currentWebsite === null || Boolean(String(currentWebsite).trim());
  const beforeComplete = String(shots.old_captured_url || "").trim()
    && /^[0-9a-f]{64}$/i.test(String(shots.old_shot_sha || "").trim());
  const afterComplete = String(shots.new_captured_url || "").trim()
    && /^[0-9a-f]{64}$/i.test(String(shots.new_shot_sha || "").trim());
  const complete = afterComplete && (!beforeRequired || beforeComplete);
  return complete ? { ...shots } : null;
}

// The shared router names one immutable release with this exact, non-PII
// tuple. site_id/release_id are the mode markers; build_hash by itself remains
// the historical Line contract. Once either marker is present we never fall
// back to URL-keyed legacy capture, because that could overwrite or email a
// different release at the same public URL.
// Refusals name their input: the reason carries WHICH field failed and a
// non-PII fingerprint of what it saw (lowercase alphanumerics only, capped), so
// a stuck row names the offending source in one drain instead of a spelunk.
// The format stays inside SAFE_CODE's /^[a-z][a-z0-9_.:-]{0,79}$/i contract.
function proofFieldFingerprint(value) {
  const squashed = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  return squashed || "empty";
}

function sharedProofContext(proofIdentity, buildHash = "") {
  if (proofIdentity !== undefined && proofIdentity !== null
      && (!proofIdentity || typeof proofIdentity !== "object" || Array.isArray(proofIdentity))) {
    return { ok: false, active: true, reason: `shared_proof_identity_malformed:not_object:${typeof proofIdentity}` };
  }
  const normalized = normalizeProofIdentity({ proofIdentity });
  if (!normalized.active) return { ok: true, active: false };
  if (!normalized.valid) return { ok: false, active: true, reason: normalized.reason };
  const badShapeField = ["site_id", "release_id", "build_hash"].find((field) => (
    field === "build_hash"
      ? !SHARED_BUILD_HASH_RE.test(normalized[field])
      : !SHARED_ID_RE.test(normalized[field])
  ));
  if (badShapeField) {
    return {
      ok: false,
      active: true,
      reason: `shared_proof_identity_malformed:${badShapeField}:${proofFieldFingerprint(normalized[badShapeField])}`,
    };
  }

  const suppliedBuildHash = String(buildHash || "").trim();
  if (suppliedBuildHash && suppliedBuildHash !== normalized.build_hash) {
    return { ok: false, active: true, reason: "shared_proof_build_hash_mismatch" };
  }
  return {
    ok: true,
    active: true,
    proofIdentity: {
      site_id: normalized.site_id,
      release_id: normalized.release_id,
      build_hash: normalized.build_hash,
    },
  };
}

function hasSharedProofMarker(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (Object.prototype.hasOwnProperty.call(value, "site_id")
      || Object.prototype.hasOwnProperty.call(value, "release_id")));
}

/**
 * Reconcile every current proof source before a production caller enters the
 * capture lane. Shared releases are an exact three-field identity, never a
 * first-nonempty fallback: one partial, malformed, build-mismatched, or
 * conflicting source refuses the shared path instead of silently using legacy
 * URL-keyed storage.
 */
const SCRUBBER_REDACTION_MARKER = "[redacted-phone]";

function deliveryProofIdentity({ sources = [], buildHash = "" } = {}) {
  const marked = (Array.isArray(sources) ? sources : [])
    .filter((source) => hasSharedProofMarker(source))
    // Scrubber-era corruption: rows persisted before the line-persistence UUID
    // rescue carry "[redacted-phone]" inside site_id/release_id (digits
    // destroyed at write time). Such a source is neither an authoritative
    // tuple nor a refusal — dropping it returns the send to the legacy
    // live-capture path, which re-reads the site's own headers for the true
    // identity.
    .filter((source) => !(
      String(source.site_id || "").includes(SCRUBBER_REDACTION_MARKER)
      || String(source.release_id || "").includes(SCRUBBER_REDACTION_MARKER)
    ));
  if (!marked.length) return { ok: true, active: false, proofIdentity: null, reason: "" };

  const expectedBuildHash = String(buildHash || "").trim();
  let expected = null;
  for (const source of marked) {
    const tuple = {
      site_id: String(source.site_id || "").trim(),
      release_id: String(source.release_id || "").trim(),
      build_hash: String(source.build_hash || "").trim(),
    };
    if (!tuple.site_id || !tuple.release_id || !tuple.build_hash) {
      const missing = ["site_id", "release_id", "build_hash"]
        .filter((field) => !tuple[field]).join("+");
      return { ok: false, active: true, proofIdentity: null, reason: `shared_proof_identity_incomplete:${missing}` };
    }
    const badShapeField = ["site_id", "release_id", "build_hash"].find((field) => (
      field === "build_hash"
        ? !SHARED_BUILD_HASH_RE.test(tuple[field])
        : !SHARED_ID_RE.test(tuple[field])
    ));
    if (badShapeField) {
      return {
        ok: false,
        active: true,
        proofIdentity: null,
        reason: `shared_proof_identity_malformed:${badShapeField}:${proofFieldFingerprint(tuple[badShapeField])}`,
      };
    }
    if (expectedBuildHash && tuple.build_hash !== expectedBuildHash) {
      return { ok: false, active: true, proofIdentity: null, reason: "shared_proof_build_hash_mismatch" };
    }
    if (expected) {
      const conflictField = ["site_id", "release_id", "build_hash"]
        .find((field) => expected[field] !== tuple[field]);
      if (conflictField) {
        return {
          ok: false,
          active: true,
          proofIdentity: null,
          reason: `shared_proof_identity_conflict:${conflictField}`,
        };
      }
    }
    expected = tuple;
  }
  return { ok: true, active: true, proofIdentity: expected, reason: "" };
}

function sharedCaptureIdentityVerdict(shots, expected) {
  const observed = deliveryProofIdentity({
    sources: [shots],
    buildHash: expected.build_hash,
  });
  if (!observed.ok) return observed;
  if (!observed.active) {
    return { ok: false, reason: "shared_proof_capture_identity_missing" };
  }
  if (["site_id", "release_id", "build_hash"].some((field) => (
    observed.proofIdentity[field] !== expected[field]
  ))) {
    return { ok: false, reason: "shared_proof_capture_identity_mismatch" };
  }
  return { ok: true, reason: "" };
}

const hexOrEmpty = (value) => {
  const text = String(value || "").trim();
  return /^[0-9a-f]{16,}$/i.test(text) ? text : "";
};

/**
 * captureLineEmailAssets — proof shots + motion loop, in ONE browser.
 *
 * Never throws. A total failure returns { ok:false, reason } and the send path
 * falls back to capturing for itself, which is the behaviour that existed
 * before this module.
 *
 * @param {object} browser         the render gate's OPEN browser. Not closed here.
 * @param {string} previewUrl      our mirror
 * @param {string} currentWebsite  the prospect's own site ("before")
 * @param {string} buildHash       the engine's identity for this build
 * @param {object} proofIdentity   exact shared {site_id,release_id,build_hash}
 * @param {number} budgetMs        wall-clock ceiling for the whole capture
 */
async function captureLineEmailAssets({
  browser = null,
  previewUrl = "",
  currentWebsite = "",
  buildHash = "",
  proofIdentity = null,
  budgetMs = CAPTURE_BUDGET_MS,
  now = Date.now,
  proofShots = ensureLineProofShots,
  motionShot = ensureLineMotionShot,
  motion = true,
  environment = process.env,
} = {}) {
  if (!automaticProofShotsEnabled(environment)) {
    return { ok: false, reason: "automatic_proof_shots_disabled", shots: {}, results: [] };
  }
  const shared = sharedProofContext(proofIdentity, buildHash);
  if (!shared.ok) return { ok: false, reason: shared.reason, shots: {}, results: [] };
  const effectiveBuildHash = shared.active ? shared.proofIdentity.build_hash : buildHash;
  const startedAt = now();
  if (!previewUrl) return { ok: false, reason: "no_preview_url", shots: {} };
  const deadlineAt = startedAt + Math.max(1, Number(budgetMs) || CAPTURE_BUDGET_MS);

  let captured;
  const shotsStartedAt = now();
  try {
    captured = await proofShots({
      currentWebsite,
      previewUrl,
      buildHash: effectiveBuildHash,
      browser,
      deadlineAt,
      now,
      ...(shared.active ? { proofIdentity: shared.proofIdentity } : {}),
    });
  } catch (e) {
    return { ok: false, reason: `proof_shots_threw: ${String(e.message || e).slice(0, 160)}`, shots: {} };
  }
  const msShots = now() - shotsStartedAt;

  if (shared.active) {
    const capturedIdentity = sharedCaptureIdentityVerdict(captured && captured.shots, shared.proofIdentity);
    if (!capturedIdentity.ok && capturedIdentity.reason === "shared_proof_capture_identity_mismatch") {
      return {
        ok: false,
        reason: capturedIdentity.reason,
        shots: {},
        results: Array.isArray(captured && captured.results) ? captured.results : [],
      };
    }
    // shared_proof_capture_identity_missing (light mode skipped the marker
    // stamping) is not a conflict: the capture came from THIS build's preview
    // URL, and the proof identity is stamped below via Object.assign. A real
    // conflicting marker still refuses.
  }

  const shots = { ...(captured.shots || {}) };
  // WHICH BUILD THESE ARE PICTURES OF. Without it nothing downstream may reuse
  // them, which is exactly the fail-closed default we want for a row whose
  // build could not name itself.
  if (shared.active) Object.assign(shots, shared.proofIdentity);
  else if (buildHash) shots.build_hash = String(buildHash);
  shots.captured_at = new Date(startedAt).toISOString();
  shots.captured_by = "render-gate";

  // A "before" that was REFUSED on identity is settled for this build. Recorded
  // so the send path does not spend a browser re-proving it — and recorded as a
  // refusal, never as a shot, so the email's evidence gate still blocks.
  const beforeRefusal = (captured.results || [])
    .find((r) => r.variant === "old" && r.ok === false && /^capture_identity_/.test(String(r.reason || "")));
  if (beforeRefusal) shots.before_refused = String(beforeRefusal.reason);

  // ---- THE MOTION LOOP -----------------------------------------------------
  // Best-effort, always last, and never a blocker: no loop means the email uses
  // the still it already had. It is skipped outright when there is not enough
  // budget left to finish one, because a half-captured loop is the same as none
  // and the browser is metered.
  let msMotion = 0;
  if (motion && previewUrl) {
    const motionStartedAt = now();
    const left = deadlineAt - motionStartedAt;
    if (left < MOTION_MIN_MS) {
      shots.anim_reason = `skipped_no_budget:${Math.max(0, Math.round(left))}ms_left`;
    } else {
      let loop;
      try {
        // THE MOTION CAPTURE IS BOUNDED BY WHAT IS LEFT (2026-09-04). This call
        // used to take no deadline at all — the one await in the capture that
        // could outlive the budget it was given. A loop that cannot finish
        // inside the remaining budget is recorded as the miss it is
        // (gate_step_timeout:motion) and the email falls back to the still.
        const motionLeft = Math.max(1, Math.floor(left));
        let motionTimer;
        loop = await Promise.race([
          motionShot({ previewUrl, buildHash: effectiveBuildHash, browser })
            .finally(() => clearTimeout(motionTimer)),
          new Promise((resolve) => {
            motionTimer = setTimeout(() => resolve({ ok: false, reason: "gate_step_timeout:motion" }), motionLeft);
          }),
        ]);
      } catch (e) {
        loop = { ok: false, reason: `motion_threw: ${String(e.message || e).slice(0, 160)}` };
      }
      if (loop && loop.ok === true && hexOrEmpty(loop.sha) && Number(loop.bytes) > 0) {
        shots.anim_sha = String(loop.sha);
        shots.anim_bytes = Number(loop.bytes);
        shots.anim_lane = String(loop.lane || "");
        shots.anim_frames = Number(loop.frames) || 0;
        shots.anim_fps = Number(loop.fps) || 0;
      } else {
        shots.anim_reason = String((loop && loop.reason) || "motion_unavailable").slice(0, 160);
      }
    }
    msMotion = now() - motionStartedAt;
  }

  return {
    // ok means THE SHOTS THE EMAIL NEEDS ARE STORED. The loop is an extra and
    // is deliberately not part of this verdict.
    ok: Boolean(shots.new_captured_url),
    reason: shots.new_captured_url ? "" : String(captured.reason || "no_after_shot"),
    shots,
    results: captured.results || [],
    // What the gate's browser spent, split, so the cost of moving this work to
    // build time is a measurement rather than an estimate.
    ms: now() - startedAt,
    msShots,
    msMotion,
  };
}

/**
 * assetsAreCurrent({ shots, buildHash, currentWebsite }) -> { ok, reason }
 *
 * May the send path use these stored assets and launch nothing?
 *
 * FAIL CLOSED IN EVERY DIRECTION. Every "we cannot tell" is a NO, and a NO
 * costs only what the send path used to pay unconditionally.
 */
function assetsAreCurrent({ shots = null, buildHash = "", currentWebsite = "", proofIdentity = null } = {}) {
  const shared = sharedProofContext(proofIdentity, buildHash);
  if (!shared.ok) return { ok: false, reason: shared.reason };
  if (!shots || typeof shots !== "object") return { ok: false, reason: "no_stored_shots" };
  const wanted = shared.active
    ? shared.proofIdentity.build_hash
    : String(buildHash || "").trim();
  if (!wanted) return { ok: false, reason: "row_has_no_build_hash" };
  const stored = String(shots.build_hash || "").trim();
  if (!stored) return { ok: false, reason: "shots_predate_build_keying" };
  if (stored !== wanted) return { ok: false, reason: "build_changed_since_capture" };
  if (shared.active) {
    for (const field of ["site_id", "release_id", "build_hash"]) {
      if (String(shots[field] || "").trim() !== shared.proofIdentity[field]) {
        return { ok: false, reason: `shared_proof_identity_mismatch:${field}` };
      }
    }
  }
  if (!String(shots.new_captured_url || "").trim()) return { ok: false, reason: "no_after_shot" };
  if (String(currentWebsite || "").trim()
    && !String(shots.old_captured_url || "").trim()
    && !String(shots.before_refused || "").trim()
    // A NAMED disclosed-absence resolves the before side too: the capture lane
    // classified the old site unavailable (bot-wall, dead origin, no archive)
    // and the email ships renderable-with-disclosure, exactly like the settled
    // identity refusal above. An UNNAMED absence is still unresolved — the
    // state must be on the record, never implied.
    && !String(shots.before_unavailable || "").trim()) {
    return { ok: false, reason: "before_shot_unresolved" };
  }
  return { ok: true, reason: "" };
}

/**
 * proofShotsForSend — what the send should attach to the email, and whether it
 * had to open a browser to get it.
 *
 * THREE SOURCES, IN ORDER OF COST:
 *   1. the render gate's own capture, riding on the batch row (free),
 *   2. the same thing already persisted on the prospect record (free),
 *   3. capture, here, now, with a browser (28–35s, 90s+ at the tail).
 *
 * (3) is the behaviour that existed before any of this, and it is still what
 * happens for every row that cannot PROVE its stored pictures are of the build
 * being sent. `launchedBrowser` says which way it went, so the saving is a
 * measurement rather than a claim.
 *
 * @returns {{shots:object|null, source:string, launchedBrowser:boolean,
 *            persist:boolean, reason:string}}
 */
async function proofShotsForSend({
  row = {},
  record = {},
  currentWebsite = "",
  proofIdentity = null,
  captureShots = ensureLineProofShots,
  deadlineAt = 0,
  now = Date.now,
  environment = process.env,
} = {}) {
  const stored = record && typeof record.proof_shots === "object" && record.proof_shots
    ? record.proof_shots
    : null;
  // New rows carry the existing proof-shot record shape directly. Keep the
  // historical wrapper as a compatibility fallback for batches already in
  // flight when this wiring ships.
  const fromGate = row && typeof row.proof_shots === "object" && row.proof_shots
    ? row.proof_shots
    : row && typeof row.captured === "object" && row.captured && typeof row.captured.shots === "object"
      ? row.captured.shots
      : null;
  const buildHash = String(row.buildHash || "");
  const shared = sharedProofContext(proofIdentity, buildHash);
  if (!shared.ok) {
    return {
      shots: null,
      source: "shared_identity_refused",
      launchedBrowser: false,
      persist: false,
      refuseProofPersistence: true,
      refuseDelivery: true,
      reason: shared.reason,
    };
  }
  const effectiveBuildHash = shared.active ? shared.proofIdentity.build_hash : buildHash;
  const automaticEnabled = automaticProofShotsEnabled(environment);

  // THE LOOP IS NOT INHERITED ACROSS BUILDS.
  //
  // The GIF's object key comes from the preview URL, which survives a rebuild,
  // so a stale `anim_sha` merged forward onto a re-shot set would mint an <img>
  // that Gmail resolves to the PREVIOUS build's animation sitting next to
  // this build's stills. That is the recoloured-mirror-with-the-old-thumbnail
  // defect wearing a different hat. The anim family is kept only when the
  // stored set can prove it is a picture of the build being sent; otherwise it
  // is dropped and the email falls back to the still, which is correct.
  const storedIsThisBuild = Boolean(stored
    && effectiveBuildHash
    && String(stored.build_hash || "").trim() === effectiveBuildHash
    && (!shared.active || ["site_id", "release_id", "build_hash"].every((field) => (
      String(stored[field] || "").trim() === shared.proofIdentity[field]
    ))));
  const carried = () => {
    // No evidence field crosses a build boundary. In particular, a fresh
    // identity-refused before capture must never regain the previous build's
    // old_captured_url through a merge.
    if (!stored || !storedIsThisBuild) return {};
    return { ...stored };
  };

  const gateVerdict = automaticEnabled
    ? assetsAreCurrent({
      shots: fromGate,
      buildHash: effectiveBuildHash,
      currentWebsite,
      proofIdentity: shared.active ? shared.proofIdentity : null,
    })
    : { ok: false, reason: "automatic_proof_shots_disabled" };
  if (gateVerdict.ok) {
    return {
      shots: { ...carried(), ...fromGate },
      source: "render_gate",
      launchedBrowser: false,
      // Written through to the record the first time a send sees it, so a
      // later reader finds it there and not only in the batch snapshot.
      persist: true,
      reason: "",
    };
  }

  const storedVerdict = automaticEnabled
    ? assetsAreCurrent({
      shots: stored,
      buildHash: effectiveBuildHash,
      currentWebsite,
      proofIdentity: shared.active ? shared.proofIdentity : null,
    })
    : { ok: false, reason: "automatic_proof_shots_disabled" };
  if (storedVerdict.ok) {
    return { shots: { ...stored }, source: "stored_record", launchedBrowser: false, persist: false, reason: "" };
  }

  const fresh = await captureShots({
    currentWebsite,
    previewUrl: row.previewUrl || "",
    buildHash: effectiveBuildHash,
    deadlineAt: Number(deadlineAt) > 0 ? Number(deadlineAt) : 0,
    now,
    ...(shared.active ? { proofIdentity: shared.proofIdentity } : {}),
  });
  if (shared.active) {
    const capturedIdentity = sharedCaptureIdentityVerdict(fresh && fresh.shots, shared.proofIdentity);
    if (!capturedIdentity.ok && capturedIdentity.reason === "shared_proof_capture_identity_mismatch") {
      return {
        shots: null,
        source: "shared_capture_refused",
        launchedBrowser: true,
        persist: false,
        refuseProofPersistence: true,
        refuseDelivery: true,
        reason: capturedIdentity.reason,
      };
    }
    // shared_proof_capture_identity_missing (light mode skipped the stamp):
    // proceed — the identity is stamped below via Object.assign.
  }
  const identityRefusal = beforeIdentityRefusal(fresh);
  if (identityRefusal) {
    // The fresh partial set must reach the composer so it keeps the existing
    // no-before/after refusal, but it is not durable evidence. In particular,
    // never merge the previous build's before shot back into this result and
    // never let a later report/client-id write persist the partial capture.
    const refusedShots = {
      ...((fresh && fresh.shots && typeof fresh.shots === "object") ? fresh.shots : {}),
      before_refused: identityRefusal,
      ...(shared.active
        ? shared.proofIdentity
        : (buildHash ? { build_hash: buildHash } : {})),
    };
    delete refusedShots.old_captured_url;
    delete refusedShots.old_shot_sha;
    delete refusedShots.old_mobile_captured_url;
    delete refusedShots.old_mobile_shot_sha;
    return {
      shots: refusedShots,
      source: "send_path_capture",
      launchedBrowser: true,
      persist: false,
      refuseProofPersistence: true,
      reason: `gate:${gateVerdict.reason}|record:${storedVerdict.reason}|before:${identityRefusal}`,
    };
  }
  const got = fresh && fresh.shots && (fresh.shots.old_captured_url || fresh.shots.new_captured_url);
  return {
    shots: got
      ? {
          ...carried(),
          ...fresh.shots,
          ...(shared.active
            ? shared.proofIdentity
            : (buildHash ? { build_hash: buildHash } : {})),
        }
      : (shared.active ? null : stored),
    source: "send_path_capture",
    launchedBrowser: true,
    persist: Boolean(got),
    reason: `gate:${gateVerdict.reason}|record:${storedVerdict.reason}`,
  };
}

module.exports = {
  captureLineEmailAssets,
  automaticProofShotsEnabled,
  automaticProofShotRecord,
  assetsAreCurrent,
  deliveryProofIdentity,
  proofShotsForSend,
  CAPTURE_BUDGET_MS,
  MOTION_MIN_MS,
  AUTOMATIC_PROOF_SHOTS_ENV,
};
