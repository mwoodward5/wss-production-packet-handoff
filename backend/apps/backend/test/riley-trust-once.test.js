"use strict";

// test/riley-trust-once.test.js
//
// THE OWNER'S LAW, verbatim in intent: "Verify once, then trust. Calm, frank
// conversation. Riley may repeat the change back — NOT in the caller's exact
// words but as the assistant's own divergent understanding of what they want.
// First change may confirm; after that the caller is already verified."
//
// Seventeen production calls produced five failures this file pins down:
//   1. the token echo that died as bad_signature (killed: no token exists on
//      the voice door; the instruction is stored server-side),
//   2. the code reuse that died as confirm_code_invalid (killed: one code,
//      one stored instruction; a different request is a distinct refusal),
//   3. the "overly redundant" ceremony on every single edit (killed: trust
//      once — a verified caller paraphrases instead),
//   4. the parallel tool calls where one request silently vanished (killed:
//      every tool call in the body is answered, and the second is refused
//      with edit_pending),
//   5. the domain read out loud (killed at the prompt layer — asserted here
//      against the provisioning string, because the paraphrase law and its
//      sibling rules ARE prompt-level instructions).
//
// The wrong-site guard (ambiguous caller -> candidate list, slug mismatch ->
// refusal) is GOOD and is deliberately not touched by any of this: trust
// removes a code ceremony, never an identity check.

const test = require("node:test");
const assert = require("node:assert/strict");

const targetsPath = require.resolve("../lib/site-edit-targets");
const storePath = require.resolve("../lib/store");
const statePath = require.resolve("../lib/riley-edit-state");
// The tool core binds the stubs below; it must reload with them, as the route shell does.
const corePath = require.resolve("../lib/site-edit-core");
const handlerPath = require.resolve("../api/vapi-tools/site-edit.js");

const SECRET = "trust-once-test-secret-0123456789";
const SLUG = "wss-test-poor-johns-plumbing-parkville";
const BUSINESS = "Poor John's Plumbing";
const DOMAIN = "wss-test-poor-johns-plumbing-parkville.wss-ai.com";

const DESCRIBE = {
  site_slug: SLUG,
  business_name: BUSINESS,
  domain: DOMAIN,
  client_id: "WSS-P0419",
  city: "Parkville",
  state: "MO",
  source: "prospect_row",
  target: { projectName: SLUG, aliasHost: DOMAIN },
};

function mockRes() {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) this.body += chunk; return this; },
    write(chunk) { this.body += chunk; return true; },
  };
}

/**
 * The handler with collaborators stubbed, and the state module fresh per
 * case. Within one case, state persists across `call()`s — that persistence
 * IS the trust-once mechanic under test.
 */
function withHandler(run, { describe = DESCRIBE } = {}) {
  const inserted = [];
  const events = [];
  const saved = {
    targets: require.cache[targetsPath],
    store: require.cache[storePath],
    state: require.cache[statePath],
    core: require.cache[corePath],
    handler: require.cache[handlerPath],
    fetch: global.fetch,
    secret: process.env.VAPI_TOOL_SECRET,
    apiUrl: process.env.GHOST_AGENCY_API_URL,
    trustDays: process.env.GHOST_AGENCY_RILEY_TRUST_DAYS,
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  process.env.GHOST_AGENCY_API_URL = "http://127.0.0.1:9";
  delete process.env.GHOST_AGENCY_RILEY_TRUST_DAYS;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });

  require.cache[targetsPath] = {
    id: targetsPath, filename: targetsPath, loaded: true, exports: {
      resolveSiteEditTarget: async (slug) => (slug === SLUG ? { projectName: SLUG, aliasHost: DOMAIN } : null),
      resolveSiteEditTargetForCaller: async () => ({ status: "not_found", target: null, say: "" }),
      describeSiteEditTarget: async (slug) => (slug === SLUG ? describe : null),
    },
  };
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true, exports: {
      select: async () => ({ ok: false, data: [] }),
      insertRow: async (table, row) => { inserted.push({ table, row }); return { ok: true }; },
      recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
    },
  };
  delete require.cache[statePath];
  delete require.cache[corePath];
  delete require.cache[handlerPath];
  const handler = require(handlerPath);

  const call = async (args) => {
    const res = mockRes();
    await handler({ method: "POST", headers: { "x-vapi-secret": SECRET }, body: args, query: {} }, res);
    return { status: res.statusCode, json: JSON.parse(res.body) };
  };
  /** A Vapi-shaped body with SEVERAL tool calls in one turn. */
  const callParallel = async (argList) => {
    const res = mockRes();
    await handler({
      method: "POST",
      headers: { "x-vapi-secret": SECRET },
      body: { message: { toolCalls: argList.map((args, i) => ({ id: `tc-${i}`, function: { arguments: args } })) } },
      query: {},
    }, res);
    const parsed = JSON.parse(res.body);
    return {
      status: res.statusCode,
      json: parsed,
      results: (parsed.results || []).map((r) => ({ toolCallId: r.toolCallId, json: JSON.parse(r.result) })),
    };
  };

  return Promise.resolve(run({ call, callParallel, inserted, events })).finally(() => {
    delete require.cache[handlerPath];
    delete require.cache[statePath];
    delete require.cache[corePath];
    delete require.cache[targetsPath];
    delete require.cache[storePath];
    if (saved.targets) require.cache[targetsPath] = saved.targets;
    if (saved.store) require.cache[storePath] = saved.store;
    if (saved.state) require.cache[statePath] = saved.state;
    if (saved.core) require.cache[corePath] = saved.core;
    if (saved.handler) require.cache[handlerPath] = saved.handler;
    global.fetch = saved.fetch;
    if (saved.secret === undefined) delete process.env.VAPI_TOOL_SECRET; else process.env.VAPI_TOOL_SECRET = saved.secret;
    if (saved.apiUrl === undefined) delete process.env.GHOST_AGENCY_API_URL; else process.env.GHOST_AGENCY_API_URL = saved.apiUrl;
    if (saved.trustDays === undefined) delete process.env.GHOST_AGENCY_RILEY_TRUST_DAYS; else process.env.GHOST_AGENCY_RILEY_TRUST_DAYS = saved.trustDays;
  });
}

const DAY = 24 * 60 * 60 * 1000;

/* ---------------------------------------------------------------------- */
/* 1. TRUST ONCE: the second edit within the window skips the code          */
/* ---------------------------------------------------------------------- */

test("a caller verified once gets a paraphrase, not a ceremony, on the next edit", () => withHandler(async ({ call, inserted, events }) => {
  // EDIT ONE — first-ever contact: the full ceremony.
  const one = await call({ siteSlug: SLUG, instruction: "Make the phone number bigger." });
  assert.equal(one.json.status, "confirm_required", "first-ever edit confirms with the code ceremony");
  const done = await call({ siteSlug: SLUG, confirm_code: one.json.confirm_code });
  assert.equal(done.json.status, "queued");
  assert.equal(inserted.length, 1);

  // EDIT TWO — same client, minutes later: NO code exists anywhere in the flow.
  const two = await call({ siteSlug: SLUG, instruction: "Move the reviews section above the gallery." });
  assert.equal(two.json.status, "trust_confirm_required");
  assert.equal(two.json.queued, false);
  assert.equal(two.json.confirm_code, undefined, "no code is issued on the trusted path");
  assert.equal(two.json.paraphrase, true, "the response must tell the model to paraphrase");
  assert.equal(two.json.say, undefined, "no server script: the restatement must be the model's OWN words");
  assert.match(two.json.next, /YOUR OWN words/);
  assert.match(two.json.next, /caller_confirmed/);

  // Finalize is the caller's yes, sent by the model — the instruction itself
  // again comes from storage, so nothing is re-typed.
  const fin = await call({ siteSlug: SLUG, caller_confirmed: true });
  assert.equal(fin.json.status, "queued");
  assert.equal(inserted.length, 2);
  assert.equal(inserted[1].row.instruction, "Move the reviews section above the gallery.");
  const queued = events.filter((e) => e.name === "ghost_agency_site_edit_queued");
  assert.equal(queued[1].payload.credential, "trusted_yes");
  // And the verification that earned the window in the first place is on the record.
  assert.ok(events.some((e) => e.name === "ghost_agency_riley_edit_verified"), "a completed verification must be persisted");
}));

test("the trusted finalize is a SECOND call — a first call never edits, trusted or not", () => withHandler(async ({ call, inserted }) => {
  // A model that skips phase one entirely gets a read-back, not an edit.
  const r = await call({ siteSlug: SLUG, instruction: "Add a reviews section.", caller_confirmed: true });
  assert.equal(r.json.queued, false);
  assert.equal(inserted.length, 0, "nothing may be enqueued without a stored read-back");
}));

test("caller_confirmed on a NOT-trusted caller earns nothing — the ceremony stands", () => withHandler(async ({ call, inserted }) => {
  // A boolean a model can set is not a confirmation. Without a recorded
  // verification, asserting caller_confirmed cannot skip the code.
  const first = await call({ siteSlug: SLUG, instruction: "Darken the header." });
  assert.equal(first.json.status, "confirm_required");
  const r = await call({ siteSlug: SLUG, instruction: "Darken the header.", caller_confirmed: true });
  assert.equal(inserted.length, 0, "the model's own boolean must not authorize an edit");
  assert.equal(r.json.status, "confirm_required", "the answer is the ceremony the caller's trust state actually earns");
}));

/* ---------------------------------------------------------------------- */
/* 2. THE TRUST WINDOW                                                      */
/* ---------------------------------------------------------------------- */

test("trust expires — outside the window the full ceremony returns", () => withHandler(async ({ call, inserted }) => {
  const { markVerified, trustWindowDays } = require("../lib/riley-edit-state");
  assert.equal(trustWindowDays(), 30, "default window is 30 days");
  // Verified 31 days ago — inside no window.
  await markVerified({ siteSlug: SLUG, clientId: DESCRIBE.client_id, at: Date.now() - (30 * DAY + 2 * 60 * 60 * 1000) });
  const r = await call({ siteSlug: SLUG, instruction: "Fix the opening hours." });
  assert.equal(r.json.status, "confirm_required", "expired trust is full ceremony again");
  assert.ok(r.json.confirm_code, "the ceremony issues a code");
  assert.equal(r.json.paraphrase, undefined);
  assert.equal(inserted.length, 0);
}));

test("a verification INSIDE the window holds — 29 days is still trusted", () => withHandler(async ({ call }) => {
  const { markVerified } = require("../lib/riley-edit-state");
  await markVerified({ siteSlug: SLUG, clientId: DESCRIBE.client_id, at: Date.now() - 29 * DAY });
  const r = await call({ siteSlug: SLUG, instruction: "Widen the logo." });
  assert.equal(r.json.status, "trust_confirm_required");
  const fin = await call({ siteSlug: SLUG, caller_confirmed: true });
  assert.equal(fin.json.status, "queued");
}));

test("GHOST_AGENCY_RILEY_TRUST_DAYS tunes the window", () => withHandler(async ({ call }) => {
  process.env.GHOST_AGENCY_RILEY_TRUST_DAYS = "7";
  const { markVerified, trustWindowDays } = require("../lib/riley-edit-state");
  assert.equal(trustWindowDays(), 7);
  await markVerified({ siteSlug: SLUG, at: Date.now() - 8 * DAY });
  const r = await call({ siteSlug: SLUG, instruction: "Add a contact page." });
  assert.equal(r.json.status, "confirm_required", "eight days is outside a seven-day window");
}));

/* ---------------------------------------------------------------------- */
/* 3. ONE CHANGE AT A TIME — the pending-instruction collision               */
/* ---------------------------------------------------------------------- */

test("a second, different change while one is pending is refused as edit_pending, distinctly", () => withHandler(async ({ call, inserted }) => {
  const first = await call({ siteSlug: SLUG, instruction: "Make the phone number bigger." });
  assert.equal(first.json.status, "confirm_required");

  const second = await call({ siteSlug: SLUG, instruction: "And also add a gallery." });
  assert.equal(second.status, 409);
  assert.equal(second.json.status, "edit_pending", "a DISTINCT error, not a cryptic code failure");
  assert.equal(second.json.pending.instruction, "Make the phone number bigger.", "the model is told which change is waiting");
  assert.ok(second.json.pending.confirm_code, "the model can finish the first change without a third round trip");
  assert.equal(inserted.length, 0, "neither request silently vanishes; neither is applied");
  assert.match(second.json.next, /finish/i);
  assert.match(second.json.next, /abandon_pending/);
  assert.match(second.json.say, /one thing at a time/i);
}));

test("abandon_pending drops the waiting change and starts the new one", () => withHandler(async ({ call, inserted }) => {
  const first = await call({ siteSlug: SLUG, instruction: "Make the phone number bigger." });
  const refused = await call({ siteSlug: SLUG, instruction: "And also add a gallery." });
  assert.equal(refused.json.status, "edit_pending");

  // The caller changed their mind. The model drops the first, explicitly.
  const fresh = await call({ siteSlug: SLUG, instruction: "And also add a gallery.", abandon_pending: true });
  assert.equal(fresh.json.status, "confirm_required");
  assert.equal(fresh.json.instruction, "And also add a gallery.", "the read-back is now the NEW change");
  assert.notEqual(fresh.json.confirm_code, first.json.confirm_code, "the old code must not follow the new change");
  assert.equal(inserted.length, 0);

  // The OLD code must not finalize the NEW change.
  const stolen = await call({ siteSlug: SLUG, instruction: "And also add a gallery.", confirm_code: first.json.confirm_code });
  assert.equal(stolen.json.queued, false);
  assert.equal(inserted.length, 0, "an abandoned change's code is dead");
}));

test("re-issuing the SAME request is idempotent — the same read-back, nothing enqueued twice", () => withHandler(async ({ call, inserted }) => {
  const a = await call({ siteSlug: SLUG, instruction: "Make the phone number bigger." });
  const b = await call({ siteSlug: SLUG, instruction: "Make the phone number BIGGER." });
  assert.equal(b.json.status, "confirm_required");
  assert.equal(b.json.confirm_code, a.json.confirm_code, "same change, same TTL bucket: same code");
  assert.equal(inserted.length, 0);
}));

test("both instructions survive: after the first is queued, the second proceeds — now trusted", () => withHandler(async ({ call, inserted }) => {
  const first = await call({ siteSlug: SLUG, instruction: "Make the phone number bigger." });
  await call({ siteSlug: SLUG, instruction: "And also add a gallery." }); // refused, edit_pending
  const done = await call({ siteSlug: SLUG, confirm_code: first.json.confirm_code });
  assert.equal(done.json.status, "queued", "the first change finishes");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].row.instruction, "Make the phone number bigger.");

  // Completing the ceremony earned the trust window, so the second change
  // takes the paraphrase path — that IS verify-once-then-trust.
  const second = await call({ siteSlug: SLUG, instruction: "And also add a gallery." });
  assert.equal(second.json.status, "trust_confirm_required");
  assert.equal(second.json.confirm_code, undefined);
  const done2 = await call({ siteSlug: SLUG, caller_confirmed: true });
  assert.equal(done2.json.status, "queued");
  assert.equal(inserted.length, 2);
  assert.equal(inserted[1].row.instruction, "And also add a gallery.");
}));

/* ---------------------------------------------------------------------- */
/* 4. PARALLEL TOOL CALLS — no result may silently vanish                   */
/* ---------------------------------------------------------------------- */

test("two request_site_change calls in one turn EACH get an answer — the second is edit_pending", () => withHandler(async ({ callParallel, inserted }) => {
  const r = await callParallel([
    { siteSlug: SLUG, instruction: "Make the phone number bigger." },
    { siteSlug: SLUG, instruction: "Change the hero image." },
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.json.results.length, 2, "EVERY tool call in the body is answered");
  const firstJson = r.results[0].json;
  const secondJson = r.results[1].json;
  assert.equal(firstJson.status, "confirm_required");
  assert.equal(secondJson.status, "edit_pending", "the second is refused as the collision it is — not left with no result");
  assert.equal(secondJson.ok, false);
  assert.equal(inserted.length, 0);
}));

/* ---------------------------------------------------------------------- */
/* 5. PENDING EXPIRES — an old read-back cannot confirm a new minute        */
/* ---------------------------------------------------------------------- */

test("a pending read-back expires — past the TTL the call starts phase one fresh", () => withHandler(async ({ call, inserted }) => {
  const realNow = Date.now;
  const first = await call({ siteSlug: SLUG, instruction: "Make the phone number bigger." });
  try {
    // One minute past the fifteen-minute pending TTL. The model sends the
    // instruction the schema requires; the code it still holds is dead.
    Date.now = () => realNow() + 16 * 60 * 1000;
    const r = await call({ siteSlug: SLUG, instruction: "Make the phone number bigger.", confirm_code: first.json.confirm_code });
    assert.equal(r.json.queued, false, "an expired pending may not finalize, code or no code");
    assert.equal(inserted.length, 0);
    assert.equal(r.json.status, "confirm_required", "the server re-issues the read-back instead");
    assert.notEqual(r.json.confirm_code, first.json.confirm_code, "the re-issued read-back mints a fresh code");
  } finally {
    Date.now = realNow;
  }
}));

/* ---------------------------------------------------------------------- */
/* 6. TRUST NEVER BYPASSES THE WRONG-SITE GUARD                             */
/* ---------------------------------------------------------------------- */

test("a trusted caller still gets the full wrong-site refusals", () => withHandler(async ({ call, inserted }) => {
  const { markVerified } = require("../lib/riley-edit-state");
  await markVerified({ siteSlug: SLUG, clientId: DESCRIBE.client_id, at: Date.now() });
  // Editable but not nameable: two CRM rows claim one site. Trust has nothing
  // to do with it — an unidentifiable site is never edited, trusted or not.
  const r = await call({ siteSlug: SLUG, instruction: "Enlarge the hero." });
  assert.equal(r.status, 409);
  assert.equal(r.json.status, "unidentifiable_site");
  assert.equal(inserted.length, 0);
}, { describe: null }));

/* ---------------------------------------------------------------------- */
/* 5. THE PARAPHRASE LAW IS PROMPT-LEVEL                                    */
/* ---------------------------------------------------------------------- */
// The paraphrase is Riley's OWN restatement, which no server response can
// force — the server deliberately issues no `say` script on the trusted path.
// What CAN be pinned is the provisioning string that teaches it.

test("the provisioning string carries the paraphrase law and the one-tool-per-turn rule", () => {
  const { universalSiteChangeToolDefinition } = require("../api/admin/vapi-assistants");
  const def = universalSiteChangeToolDefinition({ GHOST_AGENCY_API_URL: "https://ghost.wss-ai.com", VAPI_WEBHOOK_SECRET: "s" });
  const d = def.function.description;

  // THE LAW ITSELF: the caller's words are not echoed — Riley restates with
  // his own understanding, and a real yes finalizes.
  assert.match(d, /PARAPHRASE LAW/);
  assert.match(d, /in YOUR OWN words/);
  assert.match(d, /never in theirs/, "the restatement must not be the caller's phrasing");
  assert.match(d, /caller_confirmed/);
  assert.match(d, /trust_confirm_required/);
  assert.match(d, /Only the caller's real yes/, "a fabricated yes must be named as forbidden");

  // ONE TOOL CALL PER TURN — the model-side half of the silent-vanish fix.
  assert.match(d, /ONE TOOL CALL PER TURN/);
  assert.match(d, /edit_pending/);

  // NEVER SPEAK DOMAINS — say "your preview site" instead.
  assert.match(d, /NEVER SPEAK A DOMAIN/);
  assert.match(d, /your preview site/);

  // WAITING: poll site_edit_status automatically past ~8 seconds, vary filler.
  assert.match(d, /site_edit_status/);
  assert.match(d, /8 seconds/);
  assert.match(d, /vary your filler/);

  // THE HONEST LINES — and the banned machinery talk.
  assert.match(d, /it's still running, you can refresh your preview/);
  assert.match(d, /I'll note that/);
  assert.match(d, /NEVER say 'flagged for the team'/);
  assert.match(d, /escalated/);
  assert.match(d, /call you back/);

  // TRANSPORT-FAILURE SCRIPT (forensics 7-12): on a dead tool result the model
  // must say so plainly and re-queue ONCE — never improvise optimistic
  // reassurance about a request it never got an answer for.
  assert.match(d, /No result returned/);
  assert.match(d, /unauthorized/);
  assert.match(d, /re-queuing it now/);
  assert.match(d, /Re-queue ONCE/);
  assert.match(d, /never tell the caller to refresh as if it landed/);

  // KEEP-ALIVE RULE (forensics 7-12): three calls died at ~25s of the exact
  // silence Riley instructed. Waiting silently is banned; check in or close.
  assert.match(d, /hang tight/);
  assert.match(d, /give me a minute/);
  assert.match(d, /~10 seconds/);

  // BLAME-THE-SYSTEM BAN: "the token system glitched" was said on a recorded
  // line. Failures are reported plainly, machinery is never blamed.
  assert.match(d, /the system glitched/);
  assert.match(d, /NEVER blame machinery/);

  // ELEMENT IDENTIFICATION IS OURS, not the caller's homework (acceptance test
  // from call 14, in the owner's words).
  assert.match(d, /you have the logo already — learn the command from me, go and do it/i);

  // The schema offers the trusted-path parameter and the abandon valve, and
  // still offers NO token for the model to echo.
  assert.ok("caller_confirmed" in def.function.parameters.properties);
  assert.ok("abandon_pending" in def.function.parameters.properties);
  assert.ok("confirm_code" in def.function.parameters.properties);
  assert.ok(!("confirm_token" in def.function.parameters.properties));
});

test("the site_edit_status provisioning string carries the polling and honest-lines contract", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("../api/admin/vapi-assistants.js"), "utf8");
  assert.match(src, /site_edit_status/);
  assert.match(src, /more than about 8 seconds/, "the poll trigger is stated in the provisioning string");
  assert.match(src, /vary your filler lines/, "repeated identical filler is its own defect");
  assert.match(src, /refresh your preview/);
  assert.match(src, /NEVER say 'flagged for the team'/);
});

/* ---------------------------------------------------------------------- */
/* 6. FORENSICS 13-17: TALK-OVER TIMING AND THE PRICE PIN                   */
/* ---------------------------------------------------------------------- */

test("voiceTimingRaise raises waitSeconds and numWords, never lowers them", () => {
  const { voiceTimingRaise } = require("../api/admin/vapi-assistants");
  // The recovered profile: waitSeconds 0.4, stopSpeakingPlan numWords 2.
  const recovered = { waitSeconds: 0.4, stopSpeakingPlan: { numWords: 2 } };
  const raised = voiceTimingRaise(recovered, {});
  assert.deepEqual(raised.patch.waitSeconds, 0.8);
  assert.deepEqual(raised.patch.stopSpeakingPlan, { numWords: 3 });
  assert.deepEqual(raised.before, { waitSeconds: 0.4, numWords: 2 });

  // A config that already waits longer is NOT lowered.
  const alreadySlow = { waitSeconds: 1.2, stopSpeakingPlan: { numWords: 4, someOtherPlanField: true } };
  const gentle = voiceTimingRaise(alreadySlow, {});
  assert.deepEqual(gentle.patch, {}, "an already-raised profile must not be touched");
  assert.deepEqual(gentle.after, { waitSeconds: 1.2, numWords: 4 });

  // Environment overrides set the floor.
  const tuned = voiceTimingRaise(recovered, { GHOST_AGENCY_VAPI_WAIT_SECONDS: "1.0", GHOST_AGENCY_VAPI_STOP_NUM_WORDS: "4" });
  assert.deepEqual(tuned.patch.waitSeconds, 1.0);
  assert.deepEqual(tuned.patch.stopSpeakingPlan.numWords, 4);

  // Unreadable/current-less inputs answer the floors without throwing.
  const blank = voiceTimingRaise({}, {});
  assert.deepEqual(blank.patch, { waitSeconds: 0.8, stopSpeakingPlan: { numWords: 3 } });
});

test("the provisioning config pins the price to one server-side line", () => {
  const { priceLine } = require("../lib/riley-context");
  assert.equal(priceLine({}), "Care plans start at $149/mo — everything included.", "the default is the price the caller's email states");
  assert.equal(priceLine({ GHOST_AGENCY_PRICE_LINE: "Care plans start at $199/mo." }), "Care plans start at $199/mo.");
  // A blank env falls back to the default rather than serving an empty line.
  assert.equal(priceLine({ GHOST_AGENCY_PRICE_LINE: "  " }), "Care plans start at $149/mo — everything included.");

  // The look_up_customer description teaches the authority rule, and the env
  // is documented for provisioning.
  const { customerContextToolDefinition } = require("../api/admin/vapi-assistants");
  const d = customerContextToolDefinition({ GHOST_AGENCY_API_URL: "https://x", VAPI_WEBHOOK_SECRET: "s" }).function.description;
  assert.match(d, /price_line/);
  assert.match(d, /ONLY pricing/);
  const fs = require("node:fs");
  const envExample = fs.readFileSync(require.resolve("../.env.example"), "utf8");
  assert.match(envExample, /GHOST_AGENCY_PRICE_LINE=/);
  assert.match(envExample, /GHOST_AGENCY_RILEY_TRUST_DAYS=/);
});

test("the riley/context tool response carries the price line server-side", async () => {
  // The core composes the response (the route is a transport shell over it);
  // pin that price_line is in it, sourced from the shared helper, so no prompt
  // version can drift the number.
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("../lib/riley-context-core.js"), "utf8");
  assert.match(src, /price_line: priceLine\(\)/);
  assert.match(src, /require\("\.\/riley-context"\)/, "the line must come from the shared helper");
});
