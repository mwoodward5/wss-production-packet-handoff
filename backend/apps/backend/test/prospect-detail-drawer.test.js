"use strict";

// The operator drawer exists because of one owner question (2026-08-11):
// "Does the gallery let me see contact details, send a client email, keep
// notes — and is the LeadMiner data we already harvested being used in the UI
// at all?" The audit answer was no: 198 live leads each carrying an email, a
// phone, a star rating, a reason we picked them and a list of what is wrong
// with their site, and the gallery rendered a name, a city and a status chip.
//
// This suite pins the promises the drawer makes:
//
//   1. it reads the REAL shapes the miner writes, including the ones that
//      moved between pipeline generations,
//   2. a field with no source anywhere comes back empty so the UI can explain
//      the emptiness, instead of being invented,
//   3. contact details never enter a URL and never leave the admin gate,
//   4. a note that did not reach the database is never reported as saved,
//   5. the send action names the owner's inbox as the destination before the
//      press, and cannot be pointed at a business.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PROOF_SENT_EVENT_TYPE,
  contactOf,
  historyOf,
  notesFromEvents,
  ourWorkOf,
  ownerProofRouting,
  pickReasonOf,
  prospectDetail,
  reputationOf,
  sendRouting,
  siteProblemsOf,
  testRileyOf,
} = require("../lib/prospect-detail");
const { createProspectDetailHandler } = require("../api/admin/prospect-detail");
const { createProspectNoteHandler } = require("../api/admin/prospect-note");
const GALLERY_PAGE = require("../lib/gallery-page");

const ADMIN_TOKEN = "test-admin-token";

// A row shaped exactly like the live table: contact details split across
// columns and two generations of JSON, grades as {grade,score} objects,
// socials and hours only inside build_ready.mirror_request.
function liveRow(overrides = {}) {
  return {
    prospect_id: "wss-test-harris-air-west-sacramento",
    status: "line_queued",
    business_name: "Harris Air",
    owner_name: null,
    email: "harrisairmechanical@example.com",
    phone: "(916) 682-6208",
    current_website: "https://harrisair.example.com/",
    industry: "hvac",
    city: "West Sacramento",
    state: "CA",
    preview_url: "https://wss-test-harris-air-west-sacramento.wss-ai.com",
    report_url: null,
    updated_at: "2026-08-10T18:00:00.000Z",
    record: {
      address: "3125 Asante Ln, West Sacramento, CA 95691, USA",
      rating: 4.9,
      review_count: 353,
      leadminer_score: 61,
      opportunity: {
        lane: "email",
        tier: "A",
        score: 94,
        reasons: [
          "Strong demand — 353 reviews at 4.9 stars means real, paying volume",
          "High-ticket trade — margin to invest in a better site",
        ],
        disqualifiers: [],
      },
      website_probe: {
        thin: false,
        https: true,
        exists: true,
        loadMs: 103,
        mobile: false,
        builder: "duda",
        signals: [
          "no mobile viewport — the site does not adapt to phones",
          "built on duda — DIY template, upgradeable",
        ],
        wordCount: 378,
      },
      build_ready: {
        donor: "hvac-premier",
        proof: { dry_run_at: "2026-08-09T12:00:00.000Z" },
        brand_evidence: { logo_url: "https://cdn.example.com/logo.png", accent: "#3374cb" },
        qualification: {
          ceiling: "C+",
          reasons: ["website axis grades C+ (78) — measured, and the grade gate is off"],
          website_axis: { grade: "C+", score: 78 },
          composite_signal: { grade: "B-", score: 71 },
          website_ceiling: "off",
        },
        mirror_request: {
          brand: { logo: "https://cdn.example.com/logo.png", accent: "#3374cb" },
          facts: {
            phone: "(916) 682-6208",
            profile_url: "https://maps.google.com/?cid=6160553269321953386",
            socials: [{ url: "https://www.facebook.com/HarrisAirSacramento", label: "Facebook", network: "facebook" }],
          },
          content: {
            hours: [{ day: "monday", text: "7:30 AM – 4:30 PM" }],
          },
        },
      },
      ...(overrides.record || {}),
    },
    ...overrides,
  };
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload; },
  };
}

function adminRequest(method, body) {
  return { method, url: "/api/admin/prospect-detail", headers: { "x-admin-token": ADMIN_TOKEN }, body: body ? JSON.stringify(body) : "" };
}

async function withAdminToken(run) {
  const before = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = ADMIN_TOKEN;
  try {
    await run();
  } finally {
    if (before === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = before;
  }
}

// ---------------------------------------------------------------------------
// 1. The readers find the truth wherever this pipeline last put it.
// ---------------------------------------------------------------------------

test("contact details are found across every generation the pipeline wrote them into", () => {
  const contact = contactOf(liveRow());
  assert.equal(contact.phone, "(916) 682-6208");
  assert.equal(contact.email, "harrisairmechanical@example.com");
  assert.equal(contact.address, "3125 Asante Ln, West Sacramento, CA 95691, USA");
  assert.equal(contact.theirWebsite, "https://harrisair.example.com/");
  // socials and hours live ONLY inside build_ready.mirror_request on live rows;
  // reading record.socials / record.hours (which do not exist) is what made
  // the first pass of this audit report "0 of 1333" for both.
  assert.deepEqual(contact.socials, [{ label: "Facebook", url: "https://www.facebook.com/HarrisAirSacramento" }]);
  assert.deepEqual(contact.hours, [{ day: "Monday", text: "7:30 AM – 4:30 PM" }]);
  assert.equal(contact.googleListing, "https://maps.google.com/?cid=6160553269321953386");
});

test("a contact person is empty, not invented — no live lead has ever carried one", () => {
  assert.equal(contactOf(liveRow()).person, "");
  // And when one finally does exist, it is used.
  assert.equal(contactOf(liveRow({ owner_name: "Dana Harris" })).person, "Dana Harris");
});

test("the rating becomes a sentence, and a missing rating says so instead of showing zero", () => {
  assert.equal(reputationOf(liveRow()).sentence, "4.9 stars from 353 Google reviews.");
  const blank = reputationOf(liveRow({ record: { rating: null, review_count: null } }));
  assert.equal(blank.rating, null);
  assert.equal(blank.sentence, "No Google rating on file.");
});

test("why we picked them comes from the miner's own words, with a plain-English tier", () => {
  const pick = pickReasonOf(liveRow());
  assert.equal(pick.tier, "A");
  assert.equal(pick.tierPlain, "Top pick");
  assert.equal(pick.score, 94);
  assert.equal(pick.lanePlain, "Best reached by email");
  assert.equal(pick.reasons.length, 2);
  assert.match(pick.reasons[0], /353 reviews/);
});

test("the site problems are the probe's own sentences, and grades carry their score", () => {
  const site = siteProblemsOf(liveRow());
  assert.equal(site.signals.length, 2);
  assert.match(site.signals[0], /does not adapt to phones/);
  assert.equal(site.builder, "duda");
  assert.equal(site.loadMs, 103);
  // Both axes are {grade,score} objects on all 184 graded live rows. Reading
  // them as strings yields "[object Object]" on the operator's screen.
  assert.deepEqual(site.websiteGrade, { grade: "C+", score: 78 });
  assert.deepEqual(site.overallGrade, { grade: "B-", score: 71 });
});

test("our own work reports the mirror, and an absent report link stays absent", () => {
  const work = ourWorkOf(liveRow());
  assert.equal(work.mirrorUrl, "https://wss-test-harris-air-west-sacramento.wss-ai.com");
  assert.equal(work.reportUrl, "");
  assert.equal(work.donor, "hvac-premier");
  assert.equal(work.lastCheckedAt, "2026-08-09T12:00:00.000Z");
});

test("Rocky's 18:01 research refresh cannot retire the unresolved 13:42 rebuild failure", () => {
  const row = liveRow({ updated_at: "2026-08-11T18:01:09.126Z" });
  row.record.last_build_error = {
    at: "2026-08-11T13:42:30.857Z",
    reason: "mirror_build_not_revealable [render=failed]",
  };
  // A timestamp on a different source must never be paired with the selected
  // last_build_error reason.
  row.record.build_dispatch = {
    error: "different dispatch failure",
    updatedAt: "2026-08-11T17:59:00.000Z",
  };
  const work = ourWorkOf(row);
  assert.equal(work.mirrorUrl, "https://wss-test-harris-air-west-sacramento.wss-ai.com");
  assert.equal(work.problem, "mirror_build_not_revealable [render=failed]");
  assert.equal(work.problemAt, "2026-08-11T13:42:30.857Z");
  assert.equal(work.problemSource, "last_build_error");
  assert.equal(work.problemState, "site_present_with_unresolved_build_problem");
  assert.equal("currentStateAt" in work, false, "row.updated_at is not a successful-build timestamp");
});

test("packeted is research waiting for a build, never evidence that a build failure was retired", () => {
  const row = liveRow({
    status: "packeted",
    updated_at: "2026-08-11T18:01:09.126Z",
  });
  row.record.status = "packeted";
  row.record.last_build_error = {
    at: "2026-08-11T13:42:30.857Z",
    reason: "mirror_build_not_revealable [render=failed]",
  };
  const work = ourWorkOf(row);
  assert.equal(work.mirrorUrl, "https://wss-test-harris-air-west-sacramento.wss-ai.com");
  assert.equal(work.problemState, "current_or_unsequenced");
  assert.equal(prospectDetail(row).statusPlain, "Research done, waiting to be built");
});

test("a dispatch error never borrows last_build_error's timestamp", () => {
  const row = liveRow({ updated_at: "2026-08-11T12:00:00.000Z" });
  row.record.last_build_error = { at: "2026-08-11T13:42:30.857Z" };
  row.record.build_dispatch = {
    error: "dispatch failed before a URL was returned",
    updatedAt: "2026-08-11T14:15:00.000Z",
  };
  const work = ourWorkOf(row);
  assert.equal(work.problem, "dispatch failed before a URL was returned");
  assert.equal(work.problemAt, "2026-08-11T14:15:00.000Z");
  assert.equal(work.problemSource, "build_dispatch");
  assert.equal(work.problemState, "site_present_with_unresolved_build_problem");
  assert.equal("currentStateAt" in work, false);
});

test("problem provenance skips blank reasons and malformed dates only within its own source", () => {
  const row = liveRow({ updated_at: "2026-08-11T12:00:00.000Z" });
  row.record.last_build_error = {
    reason: "   ",
    message: "the retained rebuild failed",
    at: "2026-08-11T13:42:30.857Z",
  };
  row.record.build_dispatch = {
    reason: "   ",
    error: "dispatch fallback",
    failed_at: "not-a-date",
    updatedAt: "2026-08-11T14:15:00.000Z",
  };
  let work = ourWorkOf(row);
  assert.equal(work.problem, "the retained rebuild failed");
  assert.equal(work.problemAt, "2026-08-11T13:42:30.857Z");
  assert.equal(work.problemSource, "last_build_error");

  row.record.last_build_error = { reason: "   ", message: "   ", at: "2026-08-11T13:42:30.857Z" };
  work = ourWorkOf(row);
  assert.equal(work.problem, "dispatch fallback");
  assert.equal(work.problemAt, "2026-08-11T14:15:00.000Z");
  assert.equal(work.problemSource, "build_dispatch");
});

test("history is measured events only, newest first, and names the owner-proof sends as such", () => {
  const history = historyOf(liveRow(), {
    // The site is built (2026-08-09 in the fixture) before anything is mailed,
    // so a correct sort puts the two sends above the build.
    emailLogRows: [
      { sent_at: "2026-08-10T09:00:30.941Z", payload: { subject: "Harris Air — did I get this right?", deliveryLane: "prospect" } },
      { sent_at: "2026-08-11T09:00:30.941Z", payload: { subject: "Proof", ownerProof: true } },
    ],
  });
  assert.equal(history[0].when, "2026-08-11T09:00:30.941Z");
  assert.equal(history[0].what, "Proof email sent to you");
  assert.equal(history[0].ownerOnly, true);
  assert.equal(history[1].what, "Email sent to the business");
  assert.equal(history[1].ownerOnly, false);
  assert.equal(history[2].kind, "build");
  assert.equal(history[2].when, "2026-08-09T12:00:00.000Z");
});

test("a proof send leaves a trace, because the campaign log deliberately refuses it", () => {
  // lib/email.js keeps owner proofs out of ghost_agency_email_log so they can
  // never be counted as outreach (`persistCampaignLog && !internalOwnerProof`)
  // and skips the outreach.email_sent event for the same reason. Before the
  // operator route started writing its own event, a proof send was recorded
  // NOWHERE: the drawer said "Nothing has been sent or built for this business
  // yet" about a business the operator had emailed himself a minute earlier,
  // and the "Proof email sent to you" branch above could never fire.
  const history = historyOf(liveRow(), {
    emailLogRows: [],
    proofEventRows: [
      { created_at: "2026-08-11T14:05:00.000Z", payload: { recipient: "owner@example.com" } },
      // No timestamp at all is dropped rather than rendered as an undated line.
      { payload: { recipient: "owner@example.com" } },
    ],
  });
  assert.equal(history[0].when, "2026-08-11T14:05:00.000Z");
  assert.equal(history[0].what, "Proof email sent to you");
  assert.equal(history[0].ownerOnly, true);
  assert.equal(history.filter((entry) => entry.what === "Proof email sent to you").length, 1);

  // The newest proof is what the drawer's button reads to offer "again".
  const detail = prospectDetail(liveRow(), {
    proofEventRows: [
      { created_at: "2026-08-02T00:00:00.000Z", payload: {} },
      { created_at: "2026-08-11T14:05:00.000Z", payload: {} },
    ],
    sendEnv: { GHOST_AGENCY_OWNER_EMAIL: "owner@example.com" },
  });
  assert.equal(detail.send.lastProofSentAt, "2026-08-11T14:05:00.000Z");
  assert.equal(prospectDetail(liveRow(), { sendEnv: { GHOST_AGENCY_OWNER_EMAIL: "owner@example.com" } }).send.lastProofSentAt, "",
    "never sent means empty, never a guessed date");

  // One destination sentence, shared with the gallery so the two surfaces
  // cannot describe the same route differently.
  assert.deepEqual(ownerProofRouting({ GHOST_AGENCY_OWNER_EMAIL: "owner@example.com" }), {
    recipient: "owner@example.com",
    canSend: true,
    headline: "Every email on this page goes to owner@example.com — your own inbox. The business is never emailed.",
  });
  assert.equal(ownerProofRouting({}).canSend, false);
  assert.equal(PROOF_SENT_EVENT_TYPE, "operator.mirror_proof_sent");
});

test("notes read back newest first and drop empty ones", () => {
  const notes = notesFromEvents([
    { created_at: "2026-08-01T00:00:00.000Z", payload: { note: "Called, left voicemail" } },
    { created_at: "2026-08-02T00:00:00.000Z", payload: { note: "Owner asked to call back Friday", actor: "Operator" } },
    { created_at: "2026-08-03T00:00:00.000Z", payload: { note: "   " } },
  ]);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].text, "Owner asked to call back Friday");
});

// ---------------------------------------------------------------------------
// 2. The send action cannot reach a business.
// ---------------------------------------------------------------------------

test("the send block names the OWNER as the destination, whatever the business's address is", () => {
  const routing = sendRouting({
    contactEmail: "harrisairmechanical@example.com",
    env: { GHOST_AGENCY_OWNER_EMAIL: "woodwardsoftware@gmail.com", GHOST_AGENCY_PROSPECT_SEND_ENABLED: "true" },
    deliveryPauseActive: false,
  });
  assert.equal(routing.recipient, "woodwardsoftware@gmail.com");
  assert.equal(routing.recipientIsOwner, true);
  assert.match(routing.headline, /goes to your inbox/i);
  assert.match(routing.headline, /woodwardsoftware@gmail\.com/);
  // The business address is carried so the UI can say it is NOT being used.
  assert.equal(routing.businessEmail, "harrisairmechanical@example.com");
  assert.notEqual(routing.recipient, routing.businessEmail);
});

test("with live sends off or outreach paused the destination is unchanged, and the reason is said", () => {
  const routing = sendRouting({
    contactEmail: "someone@business.example",
    env: { GHOST_AGENCY_OWNER_EMAIL: "owner@example.com" },
    deliveryPauseActive: true,
  });
  assert.equal(routing.recipient, "owner@example.com");
  assert.equal(routing.canSend, true);
  assert.ok(routing.reasons.some((reason) => /switched off/i.test(reason)));
  assert.ok(routing.reasons.some((reason) => /paused/i.test(reason)));
});

test("with no owner inbox configured nothing can be sent, and it refuses rather than falling back", () => {
  const routing = sendRouting({ contactEmail: "someone@business.example", env: {} });
  assert.equal(routing.recipient, "");
  assert.equal(routing.canSend, false);
  assert.match(routing.blockedReason, /no owner inbox/i);
  // Critically: the business address is never promoted to recipient.
  assert.notEqual(routing.recipient, "someone@business.example");
});

test("the gallery page's send button drives ONLY the owner-proof route", () => {
  assert.match(GALLERY_PAGE, /\/api\/admin\/send-mirror-proof/);
  // No other send endpoint is reachable from this page.
  assert.doesNotMatch(GALLERY_PAGE, /api\/admin\/(run-campaign|full-run|approve-held-drafts)/);
});

// ---------------------------------------------------------------------------
// 3. The endpoints: admin-gated, POST-bodied, honest about failure.
// ---------------------------------------------------------------------------

test("prospect detail is admin-only and refuses GET", async () => {
  await withAdminToken(async () => {
    const handler = createProspectDetailHandler({ select: async () => ({ ok: true, data: [] }) });

    const unauthorized = response();
    await handler({ method: "POST", url: "/api/admin/prospect-detail", headers: {}, body: "{}" }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);

    const wrongMethod = response();
    await handler({ method: "GET", url: "/api/admin/prospect-detail", headers: { "x-admin-token": ADMIN_TOKEN } }, wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);
  });
});

test("the identifier is taken from the body, so no contact detail can ride in a URL", async () => {
  await withAdminToken(async () => {
    const seen = [];
    const handler = createProspectDetailHandler({
      select: async (table, query) => {
        seen.push({ table, query });
        if (table === "ghost_agency_prospects") return { ok: true, data: [liveRow()] };
        return { ok: true, data: [] };
      },
      deliveryPauseStatus: async () => ({ active: true, known: true }),
      env: { GHOST_AGENCY_OWNER_EMAIL: "owner@example.com" },
    });

    const res = response();
    await handler(adminRequest("POST", { prospectId: "wss-test-harris-air-west-sacramento" }), res);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.detail.contact.phone, "(916) 682-6208");
    assert.equal(payload.detail.statusPlain, "Built and gated — waiting for batch approval");
    assert.equal(payload.detail.send.recipient, "owner@example.com");
    assert.equal(res.headers["Cache-Control"], "no-store");
    // Every store query filters by the prospect id only. No email address or
    // phone number is ever part of a query string.
    for (const call of seen) {
      assert.doesNotMatch(call.query, /@/);
    }
  });
});

test("a missing prospect is a 404, and an unreadable store is a 503 that changed nothing", async () => {
  await withAdminToken(async () => {
    const missing = response();
    await createProspectDetailHandler({ select: async () => ({ ok: true, data: [] }) })(
      adminRequest("POST", { prospectId: "nope" }),
      missing,
    );
    assert.equal(missing.statusCode, 404);

    const broken = response();
    await createProspectDetailHandler({ select: async () => ({ ok: false, mode: "live_select_failed", data: [] }) })(
      adminRequest("POST", { prospectId: "nope" }),
      broken,
    );
    assert.equal(broken.statusCode, 503);
    assert.match(JSON.parse(broken.body).message, /Nothing was changed/i);
  });
});

test("an unreadable send history is reported as unread, not as 'nothing ever happened'", async () => {
  await withAdminToken(async () => {
    const handler = createProspectDetailHandler({
      select: async (table) => {
        if (table === "ghost_agency_prospects") return { ok: true, data: [liveRow()] };
        return { ok: false, mode: "live_select_failed", data: [] };
      },
      deliveryPauseStatus: async () => ({ active: false, known: true }),
      env: { GHOST_AGENCY_OWNER_EMAIL: "owner@example.com" },
    });
    const res = response();
    await handler(adminRequest("POST", { prospectId: "wss-test-harris-air-west-sacramento" }), res);
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.sources.sendHistoryRead, false);
    assert.equal(payload.sources.notesRead, false);
    // The contact details still arrive: one failed read must not blank the drawer.
    assert.equal(payload.detail.contact.email, "harrisairmechanical@example.com");
  });
});

test("a note is admin-only, refuses empty text, and is stamped with the time it was written", async () => {
  await withAdminToken(async () => {
    const written = [];
    const handler = createProspectNoteHandler({
      recordEvent: async (type, payload) => { written.push({ type, payload }); return { mode: "live_write" }; },
      now: () => "2026-08-11T12:00:00.000Z",
    });

    const empty = response();
    await handler({ method: "POST", url: "/x", headers: { "x-admin-token": ADMIN_TOKEN }, body: JSON.stringify({ prospectId: "a", note: "   " }) }, empty);
    assert.equal(empty.statusCode, 400);
    assert.equal(written.length, 0);

    const saved = response();
    await handler({ method: "POST", url: "/x", headers: { "x-admin-token": ADMIN_TOKEN }, body: JSON.stringify({ prospectId: "a", note: "Call back Friday" }) }, saved);
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(JSON.parse(saved.body).note, { when: "2026-08-11T12:00:00.000Z", who: "Operator", text: "Call back Friday" });
    assert.equal(written[0].type, "operator.prospect_note");
    assert.equal(written[0].payload.prospect_id, "a");
    assert.equal(written[0].payload.at, "2026-08-11T12:00:00.000Z");
  });
});

test("a note the database refused is NEVER reported as saved", async () => {
  await withAdminToken(async () => {
    for (const refusal of [{ mode: "live_write_failed", error: { message: "nope" } }, { mode: "dry_run" }]) {
      const res = response();
      await createProspectNoteHandler({ recordEvent: async () => refusal })(
        { method: "POST", url: "/x", headers: { "x-admin-token": ADMIN_TOKEN }, body: JSON.stringify({ prospectId: "a", note: "keep this" }) },
        res,
      );
      assert.equal(res.statusCode, 503);
      assert.equal(JSON.parse(res.body).ok, false);
      assert.match(JSON.parse(res.body).message, /Copy your text/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The page itself.
// ---------------------------------------------------------------------------

test("the gallery ships the drawer and opens it with a body-carried identifier", () => {
  assert.match(GALLERY_PAGE, /id="detailDrawer"/);
  assert.match(GALLERY_PAGE, /\/api\/admin\/prospect-detail/);
  assert.match(GALLERY_PAGE, /\/api\/admin\/prospect-note/);
  assert.match(GALLERY_PAGE, /method:"POST"/);
  // The detail call must never append the identifier to the path.
  assert.doesNotMatch(GALLERY_PAGE, /prospect-detail\?/);
  assert.doesNotMatch(GALLERY_PAGE, /prospect-note\?/);
});

test("the page speaks the owner's language, not the factory's", () => {
  for (const jargon of ["prospect_id", "build_ready", "mirror_request", "composite_signal", "website_axis", "opportunity.tier"]) {
    assert.ok(!GALLERY_PAGE.includes(">" + jargon + "<"), `operator-visible jargon leaked: ${jargon}`);
  }
  assert.match(GALLERY_PAGE, /How to reach them/);
  assert.match(GALLERY_PAGE, /Why we picked them/);
  assert.match(GALLERY_PAGE, /What is wrong with the site they have now/);
  assert.match(GALLERY_PAGE, /Your notes/);
});

test("the masthead no longer claims read-only now that notes and proofs write", () => {
  assert.doesNotMatch(GALLERY_PAGE, /class="readonly">Read only</);
  assert.match(GALLERY_PAGE, /Emails come to you only/);
});

test("Test Riley: the agency line, the derived Client ID, and the mirror's chat door — nothing invented", () => {
  // Configured line -> our agency number, formatted for dialing, plus the
  // SAME derived Client ID the outreach email prints, plus the mirror asked
  // to open its chat (#chat).
  const armed = testRileyOf(liveRow(), { GHOST_AGENT_PHONE: "+19493395562" });
  assert.equal(armed.telHref, "tel:+19493395562");
  assert.equal(armed.display, "(949) 339-5562");
  assert.match(armed.clientId, /^WSS-[0-9A-F]{6}$/);
  assert.equal(armed.chatUrl, "https://wss-test-harris-air-west-sacramento.wss-ai.com#chat");

  // Unset environment -> NO phone and a named reason; never the prospect's
  // own front-desk number (that is in the row as `phone` and must not leak
  // into a "Call Riley" affordance).
  const unset = testRileyOf(liveRow(), {});
  assert.equal(unset.telHref, "");
  assert.ok(unset.phoneReason, "an absent line must say why");
  assert.ok(!JSON.stringify(unset).includes("682-6208"), "the client's own phone is not Riley's line");

  // No mirror -> no chat door, rather than a dead link.
  const bare = testRileyOf(liveRow({ preview_url: null, record: {} }), {});
  assert.equal(bare.chatUrl, "");
});

test("the drawer's Test Riley block is wired into the page", () => {
  assert.match(GALLERY_PAGE, /Test Riley on this client/);
  assert.match(GALLERY_PAGE, /renderTestRileyBlock\(detail\)/);
});

test("the whole detail payload is assembled without touching the network", () => {
  const detail = prospectDetail(liveRow(), {
    emailLogRows: [],
    noteEventRows: [{ created_at: "2026-08-01T00:00:00.000Z", payload: { note: "hi" } }],
    sendEnv: { GHOST_AGENCY_OWNER_EMAIL: "owner@example.com" },
    deliveryPauseActive: true,
  });
  assert.equal(detail.businessName, "Harris Air");
  assert.equal(detail.vertical, "Hvac");
  assert.equal(detail.notes.length, 1);
  assert.equal(detail.send.deliveryPauseActive, true);
  assert.equal(detail.send.recipient, "owner@example.com");
});
