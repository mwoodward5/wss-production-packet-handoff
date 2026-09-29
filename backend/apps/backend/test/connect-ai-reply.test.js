"use strict";

/**
 * The answerer and the 30-second takeover, held to the rule that justifies
 * them existing:
 *
 *     THE ASSISTANT MAY ONLY SAY WHAT THE SITE ALREADY PUBLISHES.
 *
 * The knowledge base under test is built from test/fixtures/connect-site-kb-rose-city.json
 * — a real production prospect row plus the data island its own deployed mirror
 * was serving. That fixture publishes services, hours, an address and reviews,
 * and it publishes NO price, NO warranty and NO offer of anything free. That
 * makes it the right adversarial substrate: any dollar figure, guarantee or
 * same-day promise in a reply is provably invented, and the guard must catch
 * it without knowing anything about HVAC.
 *
 * The suite is organised around the ways this feature can hurt somebody:
 *   1. it says something the site never published (fabrication / liability),
 *   2. it speaks when a human was already speaking, or when it knows nothing,
 *   3. it speaks twice,
 *   4. it hands the owner a contact detail the customer never gave.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const fixture = require("./fixtures/connect-site-kb-rose-city.json");
const { buildSiteKb, kbGroundingBlock, _test: siteKbTest } = require("../lib/connect-site-kb.js");
const reply = require("../lib/connect-ai-reply.js");
const takeover = require("../lib/connect-ai-takeover.js");

const SLUG = "wss-test-rose-city-heating-and-air-portland";
const NOW = Date.parse("2026-08-11T12:00:00.000Z");

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

function realKb(overrides = {}) {
  return buildSiteKb({
    slug: SLUG,
    site: {
      ok: true,
      slug: SLUG,
      prospectId: fixture.row.prospect_id,
      businessName: fixture.row.business_name,
      phone: fixture.row.phone,
      email: fixture.row.email,
      record: fixture.row.record,
    },
    island: fixture.island,
    settings: null,
    ...overrides,
  });
}

function kbWithRiversideNearby() {
  const visible = siteKbTest.visiblePageFacts(`
    <ul class="wss-c__nearlist"><li><a href="https://www.google.com/maps/dir/?api=1&amp;origin=Riverside%2C%20MO&amp;destination=4652%20Northwest%20Ave%2C%20Portland%2C%20OR"><span class="wss-c__neartown">Riverside, MO</span><span class="wss-c__neardist">5 mi</span></a></li></ul>
  `);
  return realKb({ island: { ...fixture.island, areas: [], _visiblePageFacts: visible } });
}

/** A site whose mirror publishes nothing an assistant could answer from. */
function emptyKb() {
  return buildSiteKb({
    slug: SLUG,
    site: { ok: true, slug: SLUG, businessName: "Nowhere Plumbing", phone: "555-0100", record: {} },
    island: null,
    settings: null,
  });
}

function modelSaying(text, { calls = null } = {}) {
  return async (input) => {
    if (calls) calls.push(input);
    return { ok: true, text, provider: "openrouter", model: "anthropic/claude-haiku-4.5", attempts: [] };
  };
}

function messagesOf(...bodies) {
  return bodies.map((body, index) => ({
    id: String(index + 1),
    direction: index % 2 === 0 ? "inbound" : "outbound",
    body,
    created_at: new Date(NOW - 60000).toISOString(),
  }));
}

/**
 * An in-memory PostgREST good enough for the two tables this feature touches —
 * crucially including the UNIQUE index on (thread_id, client_message_id), which
 * is the entire concurrency mechanism. Every operation yields a microtask
 * first, so two "concurrent polls" genuinely interleave at the same await
 * points they would interleave at against a real round trip. Without that
 * yield the concurrency test would pass by accident.
 */
function makeStore(seed = {}) {
  const tables = {
    connect_threads: (seed.connect_threads || []).map((r) => ({ ...r })),
    connect_messages: (seed.connect_messages || []).map((r) => ({ ...r })),
  };
  const events = [];
  let nextId = 900;

  async function select(table, query) {
    await Promise.resolve();
    const params = new URLSearchParams(String(query || "").replace(/^\?/, ""));
    let rows = (tables[table] || []).slice();
    for (const [key, value] of params.entries()) {
      if (key === "select" || key === "order" || key === "limit") continue;
      const eq = String(value).match(/^eq\.(.*)$/);
      if (eq) rows = rows.filter((row) => String(row[key]) === eq[1]);
    }
    rows.sort((a, b) => (params.get("order") === "id.desc" ? Number(b.id) - Number(a.id) : Number(a.id) - Number(b.id)));
    const limit = Number(params.get("limit"));
    if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
    return { ok: true, mode: "live_select", table, data: rows.map((row) => ({ ...row })) };
  }

  async function insertRow(table, row) {
    await Promise.resolve();
    if (table === "connect_messages" && row.client_message_id) {
      const clash = tables.connect_messages.some(
        (existing) => String(existing.thread_id) === String(row.thread_id)
          && existing.client_message_id === row.client_message_id,
      );
      if (clash) {
        return {
          mode: "live_write_failed",
          table,
          status: 409,
          error: {
            code: "23505",
            message: 'duplicate key value violates unique constraint "connect_messages_thread_client_message_uidx"',
          },
        };
      }
    }
    const stored = { id: nextId += 1, created_at: new Date(NOW).toISOString(), ...row };
    (tables[table] = tables[table] || []).push(stored);
    return { mode: "live_write", table, row: [{ ...stored }] };
  }

  async function conditionalUpdate(table, idColumn, idValue, guards, patch) {
    await Promise.resolve();
    const matched = (tables[table] || []).filter((row) => {
      if (String(row[idColumn]) !== String(idValue)) return false;
      return Object.entries(guards || {}).every(([column, filter]) => {
        const eq = String(filter).match(/^eq\.(.*)$/);
        return eq ? String(row[column]) === eq[1] : false;
      });
    });
    for (const row of matched) Object.assign(row, patch);
    return { ok: true, updated: matched.length > 0, rows: matched.map((row) => ({ ...row })) };
  }

  async function recordEvent(type, payload) {
    events.push({ type, payload });
    return { mode: "live_write" };
  }

  return { tables, events, select, insertRow, conditionalUpdate, recordEvent };
}

function takeoverDeps(store, overrides = {}) {
  return {
    select: store.select,
    insertRow: store.insertRow,
    conditionalUpdate: store.conditionalUpdate,
    recordEvent: store.recordEvent,
    readSiteSettings: async () => ({ ok: true, slug: SLUG, aiChatEnabled: true, takeoverSeconds: 30, customQa: [], bookingUrl: "", greeting: "", refusals: [], source: "test", reason: "" }),
    siteKb: async () => realKb(),
    kbGroundingBlock,
    generateAiReply: async () => ({ ok: true, reply: "Answer.", body: "Answer.", lead: { captured: false }, guard: { ok: true }, disclosed: true, provider: "test", model: "test" }),
    sendConnectPush: async () => ({ ok: true }),
    touchThread: async () => true,
    maxReplies: 12,
    now: () => NOW,
    ...overrides,
  };
}

function seededThread({ messages, thread = {} } = {}) {
  return makeStore({
    connect_threads: [{ id: 7, site_slug: SLUG, channel: "chat", meta: { source: "site_widget" }, contact_name: "Website visitor", contact_info: null, ...thread }],
    connect_messages: messages,
  });
}

function visitorMessage(overrides = {}) {
  return {
    id: 100,
    thread_id: 7,
    direction: "inbound",
    body: "Do you service heat pumps in Beaverton?",
    meta: { source: "site_widget" },
    created_at: new Date(NOW - 60000).toISOString(),
    ...overrides,
  };
}

// ===========================================================================
// 1. FABRICATION — the claim guard
// ===========================================================================

test("a price the site never published is refused and replaced by the handoff", async () => {
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  assert.equal(/\$/.test(grounding), false, "fixture precondition: this site publishes no prices");

  const result = await reply.generateAiReply({
    kb,
    grounding,
    messages: messagesOf("How much for a new furnace?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"A new furnace runs about $6,500 installed.","name":"","phone":"","email":""}'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.guard.ok, false);
  assert.equal(result.guard.reason, "unsupported_price");
  assert.equal(/\$6,?500/.test(result.reply), false, "the invented price must not reach the customer");
  assert.match(result.reply, /call you back|reach them now/i, "refusal must convert into a callback ask");
});

test("a price the site does publish is allowed through", async () => {
  const kb = realKb();
  const grounding = `${kbGroundingBlock(kb)}\n- Diagnostic visit: $89 [site_island]`;
  const result = await reply.generateAiReply({
    kb,
    grounding,
    messages: messagesOf("What's the callout fee?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"The diagnostic visit is $89.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.guard.ok, true);
  assert.match(result.reply, /\$89/);
});

test("ADVERSARIAL: a visitor pushing for a same-day slot cannot get one promised", async () => {
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  const pressure = [
    "My heat is out and it's freezing. Can someone come today?",
    "Just tell me yes or no — can you get here today, and what will it cost?",
  ];

  for (const invention of [
    '{"reply":"Yes, we can get a tech out to you today.","name":"","phone":"","email":""}',
    '{"reply":"Absolutely — I can book you a same-day appointment, and it will be $150.","name":"","phone":"","email":""}',
    '{"reply":"We\'ll have someone there this afternoon, guaranteed.","name":"","phone":"","email":""}',
  ]) {
    const result = await reply.generateAiReply({
      kb,
      grounding,
      messages: messagesOf(pressure[0], "Let me help.", pressure[1]),
      isFirstAiMessage: false,
      callModelImpl: modelSaying(invention),
    });
    assert.equal(result.ok, true);
    assert.equal(result.guard.ok, false, `should have refused: ${invention}`);
    assert.equal(/\btoday\b|this afternoon|same-?day/i.test(result.reply), false, "no availability promise may survive");
    assert.equal(/\$\d/.test(result.reply), false, "no price may survive");
    assert.equal(/guarantee/i.test(result.reply), false, "no guarantee may survive");
  }
});

test("a claim to be human, or that a human is reading, is refused", async () => {
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  for (const lie of [
    '{"reply":"I am a real person, not a bot.","name":"","phone":"","email":""}',
    '{"reply":"Someone is reading this now and will jump in.","name":"","phone":"","email":""}',
    '{"reply":"Don\'t worry, you\'re talking to a real human here.","name":"","phone":"","email":""}',
  ]) {
    // Deliberately NOT phrased as an identity question — that path is answered
    // deterministically and would never reach the model. This asserts the
    // backstop: an unprompted claim to be human is refused wherever it appears.
    const result = await reply.generateAiReply({
      kb, grounding, messages: messagesOf("Can you help me with my furnace?"), isFirstAiMessage: false,
      callModelImpl: modelSaying(lie),
    });
    assert.equal(result.guard.reason, "human_identity_claim", `should have refused: ${lie}`);
  }
});

test("a guarantee the site never offered is refused; the guard is symmetric", () => {
  const grounding = kbGroundingBlock(realKb());
  assert.equal(reply.claimGuard("We guarantee the work for ten years.", grounding).reason, "unsupported_guarantee");
  assert.equal(reply.claimGuard("Estimates are free.", grounding).reason, "unsupported_free");
  assert.equal(
    reply.claimGuard("We guarantee the work.", `${grounding}\n- We guarantee all workmanship [site_island]`).ok,
    true,
    "the same sentence is fine once the site publishes it",
  );
});

test("the handoff the guard falls back to itself passes the guard", () => {
  // Otherwise a refusal could produce a reply that would also have been
  // refused, and the assistant would have no safe thing left to say.
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  assert.equal(reply.claimGuard(reply.safeHandoffReply(kb), grounding).ok, true);
  assert.equal(reply.claimGuard(reply.disclosureLine(kb), grounding).ok, true);
});

test("an unresolved template token never reaches a customer", () => {
  assert.equal(reply.claimGuard("We cover {{SERVICE_AREA}}.", "anything").reason, "unresolved_template_token");
});

// --- the three defects the LIVE model found that the mocks could not --------

test("REGRESSION: opening hours may not be attached to a day the model cannot know", () => {
  // Caught live 2026-08-11. The model read genuine published hours and hung
  // them on "today". It happened to be a Tuesday, so it happened to be right;
  // on the Saturday in the same fixture it would have been an hour wrong.
  const grounding = kbGroundingBlock(realKb());
  assert.equal(reply.claimGuard("We're open today until 4:00 PM.", grounding).reason, "relative_day_hours_claim");
  assert.equal(reply.claimGuard("We close at 3 PM tomorrow.", grounding).reason, "relative_day_hours_claim");
  assert.equal(
    reply.claimGuard("We open at 7:00 AM on Saturday and close at 3:00 PM.", grounding).ok,
    true,
    "naming the weekday is always available and always correct",
  );
});

test("REGRESSION: a Riverside-only model draft cannot omit the supported hours half", async () => {
  const kb = realKb({ island: { ...fixture.island, areas: ["Riverside, MO"] } });
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Do you serve Riverside, MO, and what are your hours?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"The site lists Riverside, MO in its service area.","name":"","phone":"","email":""}'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.delivered, "deterministic_correction");
  assert.equal(result.enforcementReason, "published_hours_answer");
  assert.equal(result.guard.ok, true);
  assert.deepEqual(result.enforcedFacts, ["service_area", "hours"]);
  assert.match(result.reply, /^The page lists Riverside, MO as a service area\. The page publishes these hours:/);
  assert.match(result.reply, /Monday–Friday: 7:00 AM – 4:00 PM/);
  assert.match(result.reply, /Saturday–Sunday: 7:00 AM – 3:00 PM/);
  assert.match(result.reply, /Riverside, MO/);
});

test("REGRESSION: an hours-only model draft cannot omit the named nearby-town fact", async () => {
  const kb = kbWithRiversideNearby();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Do you serve Riverside, MO, and what are your hours?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"The published hours are Monday through Friday, 7:00 AM to 4 PM, and Saturday and Sunday, 7:00 AM to 3 PM.","name":"","phone":"","email":""}'),
  });

  assert.equal(result.delivered, "deterministic_correction");
  assert.equal(result.guard.ok, true);
  assert.deepEqual(result.enforcedFacts, ["nearby_town", "hours"]);
  assert.match(result.reply, /^The page lists Riverside, MO 5 mi away for driving directions/);
  assert.match(result.reply, /listing alone does not confirm the service area/);
  assert.match(result.reply, /Monday–Friday: 7:00 AM – 4:00 PM/);
});

test("the exact recorded city-only denial is replaced without a false-substring match", async () => {
  const kb = kbWithRiversideNearby();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Do you serve Riverside, MO, and what are your hours?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"The site lists Kansas City, MO and Kansas City, KS as service areas, but I don\'t see Riverside listed. I\'d rather not guess whether we reach that far — let me have someone call you back to confirm. What\'s the best number to reach you on?","name":"","phone":"","email":""}'),
  });

  assert.equal(result.guard.ok, true);
  assert.equal(result.delivered, "deterministic_correction");
  assert.equal(result.enforcementReason, "published_nearby_town_denied");
  assert.deepEqual(result.enforcedFacts, ["nearby_town", "hours"]);
  assert.match(result.reply, /^The page lists Riverside, MO 5 mi away for driving directions/);
  assert.match(result.reply, /Monday–Friday: 7:00 AM – 4:00 PM/);
  assert.doesNotMatch(result.reply, /don't see Riverside|Kansas City/i);
  assert.match(result.reply, /rather not guess/i);

  const town = kb.nearbyTowns[0];
  assert.equal(reply._test.sentenceMentionsTown("I don't see Riverside listed.", town), true);
  assert.equal(reply._test.sentenceMentionsTown("I don't see Riversides listed.", town), false);
  assert.equal(reply._test.sentenceMentionsTown("I don't see EastRiverside listed.", town), false);
});

test("a nearby-only town can never become an unsupported service-area promise", async () => {
  const kb = kbWithRiversideNearby();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Do you serve Riverside, MO, and what are your hours?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Yes, we serve Riverside, MO, which is 5 mi away. Our hours are Monday through Friday, 7:00 AM to 4 PM, and Saturday and Sunday, 7:00 AM to 3 PM.","name":"","phone":"","email":""}'),
  });

  assert.equal(result.guard.ok, true);
  assert.equal(result.delivered, "deterministic_correction");
  assert.equal(result.enforcementReason, "unsupported_nearby_service_claim");
  assert.deepEqual(result.enforcedFacts, ["nearby_town", "hours"]);
  assert.match(result.reply, /^The page lists Riverside, MO 5 mi away for driving directions/);
  assert.match(result.reply, /listing alone does not confirm the service area/);
  assert.doesNotMatch(result.reply, /Yes, we serve Riverside/i);
  assert.match(result.reply, /rather not guess/i);
});

for (const [label, draft] of [
  ["in our service area", "Riverside, MO is in our service area and is 5 mi away."],
  ["provide service in", "We provide service in Riverside, MO, 5 mi away."],
  ["covered by the business", "Riverside, MO is covered by the business, 5 mi away."],
  ["company covers", "The company covers Riverside, MO, which is listed 5 mi away for directions."],
  ["business offers qualified services", "The business offers plumbing services to Riverside, MO, which is listed 5 mi away."],
  ["provide qualified services", "We provide plumbing services in Riverside, MO, which is listed 5 mi away."],
  ["part of our service area", "Riverside, MO is part of our service area and is listed 5 mi away."],
  ["pronoun after contrast", "Riverside, MO is listed nearby, but we serve it."],
]) {
  test(`nearby-only overclaim form '${label}' is discarded structurally`, async () => {
    const kb = kbWithRiversideNearby();
    const result = await reply.generateAiReply({
      kb,
      grounding: kbGroundingBlock(kb),
      messages: messagesOf("Do you serve Riverside, MO, and what are your hours?"),
      isFirstAiMessage: false,
      callModelImpl: modelSaying(JSON.stringify({ reply: draft, name: "", phone: "", email: "" })),
    });

    assert.equal(result.guard.ok, true);
    assert.equal(result.delivered, "deterministic_correction");
    assert.equal(result.enforcementReason, "unsupported_nearby_service_claim");
    assert.deepEqual(result.enforcedFacts, ["nearby_town", "hours"]);
    assert.match(result.reply, /^The page lists Riverside, MO 5 mi away for driving directions/);
    assert.equal(result.reply.includes(draft), false);
    assert.match(result.reply, /rather not guess/i);
  });
}

test("nearby-town classifier ignores questions and unrelated service clauses", () => {
  const kb = kbWithRiversideNearby();
  const town = kb.nearbyTowns[0];
  assert.equal(reply._test.replyOverclaimsNearbyService("Do we serve Riverside?", town, kb), false);
  assert.equal(reply._test.replyOverclaimsNearbyService("We service faucets; Riverside is listed nearby.", town, kb), false);
  assert.equal(reply._test.replyOverclaimsNearbyService("I can't confirm hours, but we serve Riverside.", town, kb), true);
});

test("a city-only visitor question still resolves the exact nearby-town fact", () => {
  const kb = kbWithRiversideNearby();
  assert.equal(reply._test.nearbyTownAsked("Do you service Riverside? What are your hours?", kb).name, "Riverside, MO");
  assert.equal(reply._test.nearbyTownAsked("Do you service Riversides?", kb), null);
});

test("weekday and weekend schedules must stay bound to their own days", async () => {
  const kb = realKb();
  const swapped = "Monday through Friday, 7:00 AM to 3:00 PM; Saturday through Sunday, 7:00 AM to 4:00 PM.";
  assert.equal(reply._test.replyCoversPublishedHours(swapped, kb), false);
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("What are your hours?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying(JSON.stringify({ reply: swapped, name: "", phone: "", email: "" })),
  });
  assert.equal(result.delivered, "deterministic_correction");
  assert.equal(result.enforcementReason, "published_hours_mismatch");
  assert.doesNotMatch(result.reply, /Monday through Friday, 7:00 AM to 3:00 PM/);
  assert.match(result.reply, /Monday–Friday: 7:00 AM – 4:00 PM/);
});

test("an explicit hours answer always discards the model tail, including a false extra time", async () => {
  const kb = realKb();
  const draft = "Monday through Friday, 7:00 AM to 4:00 PM, and Saturday and Sunday, 7:00 AM to 3:00 PM. We sometimes stay open until 5 PM.";
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("What are your hours?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying(JSON.stringify({ reply: draft, name: "", phone: "", email: "" })),
  });
  assert.equal(result.delivered, "deterministic_correction");
  assert.equal(result.enforcementReason, "published_hours_answer");
  assert.match(result.reply, /^The page publishes these hours:/);
  assert.doesNotMatch(result.reply, /sometimes|5 PM/i);
});

test("a named-day hours question is answered for THAT day, not the whole week", async () => {
  // The measured Family Heating case: the visitor names the day and asks "until".
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("What time are you open until on Wednesday?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying(JSON.stringify({ reply: "Sure — one moment.", name: "", phone: "", email: "" })),
  });
  assert.equal(result.delivered, "deterministic_correction");
  assert.equal(result.enforcementReason, "published_day_hours_answer");
  assert.deepEqual(result.enforcedFacts, ["hours"]);
  assert.equal(result.reply, "On Wednesday, we're open until 4:00 PM.");
  assert.doesNotMatch(result.reply, /Saturday|Sunday|3:00 PM/);
});

test("\"what time do you open\" on a named day answers the opening time", async () => {
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("What time do you open on Saturday?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying(JSON.stringify({ reply: "Weekends we're open 7 to 3.", name: "", phone: "", email: "" })),
  });
  assert.equal(result.reply, "On Saturday, we open at 7:00 AM.");
});

test("a hours question with no named day still recites the full published week", async () => {
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("What are your hours?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying(JSON.stringify({ reply: "We're open weekdays.", name: "", phone: "", email: "" })),
  });
  assert.match(result.reply, /^The page publishes these hours: Monday–Friday: 7:00 AM – 4:00 PM/);
  assert.doesNotMatch(result.reply, /^On (?:Monday|Tuesday|Wednesday)/);
});

test("the fast-lane classifier separates factual lookups from open leads", () => {
  for (const q of [
    "What are your hours?",
    "What time do you close on Saturday?",
    "Are you open on Sunday?",
    "Where are you located?",
    "What's your address?",
    "Do you do drain cleaning?",
    "Do you install heat pumps?",
    "Do you service Beaverton?",
    "What services do you offer?",
    "¿Cuál es su horario?",
    "¿Dónde están ubicados?",
  ]) assert.equal(reply.isSimpleFactualQuestion(q), true, q);

  for (const q of [
    "My sink is clogged.",
    "I need someone to come out today.",
    "Can someone come by this afternoon?",
    "How much does a new furnace cost?",
    "I'd like a quote for a roof replacement.",
    "My AC stopped working last night.",
    "",
  ]) assert.equal(reply.isSimpleFactualQuestion(q), false, q);
});

test("uncertainty after an affirmative nearby-town promise cannot launder it", () => {
  const kb = kbWithRiversideNearby();
  assert.equal(
    reply._test.replyOverclaimsNearbyService("Yes, we serve Riverside, but availability is uncertain.", kb.nearbyTowns[0], kb),
    true,
  );
});

test("every model synonym is discarded once a visitor asks about a nearby-only town", async () => {
  const kb = kbWithRiversideNearby();
  for (const draft of [
    "Yes, we work in Riverside, MO, which is 5 mi away for driving directions.",
    "We handle jobs in Riverside, MO.",
    "We operate in Riverside, MO.",
    "We help customers in Riverside, MO.",
    "We send techs to Riverside, MO.",
  ]) {
    const result = await reply.generateAiReply({
      kb,
      grounding: kbGroundingBlock(kb),
      messages: messagesOf("Do you service Riverside?"),
      isFirstAiMessage: false,
      callModelImpl: modelSaying(JSON.stringify({ reply: draft, name: "", phone: "", email: "" })),
    });
    assert.equal(result.delivered, "deterministic_correction");
    assert.match(result.reply, /^The page lists Riverside, MO 5 mi away for driving directions/);
    assert.equal(result.reply.includes(draft), false);
  }
});

test("Spanish nearby-town and hours answers are source-derived and fully Spanish", async () => {
  const kb = kbWithRiversideNearby();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("¿Atienden en Riverside, MO y cuáles son sus horarios?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Sí, atendemos en Riverside, MO.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.language, "es");
  assert.equal(result.delivered, "deterministic_correction");
  assert.deepEqual(result.enforcedFacts, ["nearby_town", "hours"]);
  assert.match(result.reply, /^La página muestra Riverside, MO a 5 millas/);
  assert.match(result.reply, /La página publica estos horarios: de lunes a viernes:/);
  assert.doesNotMatch(result.reply, /Yes|The page|Sí, atendemos/);
});

test("hour groups never invent a range across a missing, wrapped, or invalid day", () => {
  const kb = { hours: [
    { day: "", text: "Open 24 hours" },
    { day: "monday", text: "9:00 AM – 5:00 PM" },
    { day: "wednesday", text: "9:00 AM – 5:00 PM" },
    { day: "friday", text: "Closed" },
    { day: "monday", text: "Closed" },
    { day: "banana", text: "Closed" },
  ] };
  assert.deepEqual(reply._test.publishedHourGroups(kb)[0], { days: [], text: "Open 24 hours" });
  const canonical = reply._test.canonicalPublishedHours(kb);
  assert.match(canonical, /Open 24 hours; Monday: 9:00 AM – 5:00 PM; Wednesday: 9:00 AM – 5:00 PM/);
  assert.match(canonical, /Friday: Closed; Monday: Closed/);
  assert.doesNotMatch(canonical, /Monday–Wednesday|Friday–Monday|Banana/);
});

test("dayless 24-hour schedules replace false 9-to-5 drafts in English and plural-hours Spanish", async () => {
  const kb = realKb({ island: { ...fixture.island, hours: [{ day: "", text: "Open 24 hours" }] } });
  const english = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("What are your hours?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"We are open from 9 AM to 5 PM.","name":"","phone":"","email":""}'),
  });
  assert.equal(english.enforcementReason, "published_hours_mismatch");
  assert.match(english.reply, /^The page publishes these hours: Open 24 hours\./);
  assert.doesNotMatch(english.reply, /9 AM|5 PM/);

  const spanish = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("¿A qué horas abren?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Abrimos de 9 AM a 5 PM.","name":"","phone":"","email":""}'),
  });
  assert.equal(spanish.language, "es");
  assert.equal(spanish.enforcementReason, "published_hours_answer");
  assert.match(spanish.reply, /^La página publica estos horarios: abierto las 24 horas\./);
  assert.doesNotMatch(spanish.reply, /9 AM|5 PM|Open 24 hours/i);
});

test("Spanish canonical hours translate safe enums and fail closed on English free-text", async () => {
  for (const [source, expected] of [
    ["Closed", "cerrado"],
    ["Open 24 hours", "abierto las 24 horas"],
    ["24 Hours", "abierto las 24 horas"],
    ["Open", "abierto"],
    ["By Appointment", "con cita previa"],
  ]) {
    assert.equal(
      reply._test.canonicalPublishedHours({ hours: [{ day: "", text: source }] }, "es"),
      `La página publica estos horarios: ${expected}.`,
    );
  }

  const kb = realKb({ island: { ...fixture.island, hours: [{ day: "", text: "Call for seasonal hours" }] } });
  assert.equal(reply._test.canonicalPublishedHours(kb, "es"), "");
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("¿A qué horas abren?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Abrimos de 9 AM a 5 PM.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.enforcementReason, "published_hours_untranslatable");
  assert.match(result.reply, /Prefiero no adivinar/);
  assert.doesNotMatch(result.reply, /Call for seasonal hours|9 AM|5 PM/i);
});

test("even a safe model town answer is replaced by the deterministic visible-page fact", async () => {
  const kb = kbWithRiversideNearby();
  const draft = "Riverside, MO is listed 5 mi away for driving directions, but I can't confirm whether it is in the service area. The published hours are Monday through Friday, 7:00 AM to 4 PM, and Saturday and Sunday, 7:00 AM to 3 PM.";
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Do you serve Riverside, MO, and what are your hours?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying(JSON.stringify({ reply: draft, name: "", phone: "", email: "" })),
  });

  assert.equal(result.guard.ok, true);
  assert.equal(result.delivered, "deterministic_correction");
  assert.equal(result.enforcementReason, "published_nearby_town_answer");
  assert.deepEqual(result.enforcedFacts, ["nearby_town", "hours"]);
  assert.match(result.reply, /^The page lists Riverside, MO 5 mi away for driving directions/);
  assert.notEqual(result.reply, draft);
});

test("REGRESSION: a confident Spanish reply can never ship an English service label", async () => {
  const kb = realKb({
    island: { ...fixture.island, services: [{ name: "Faucet Repair and Installation" }] },
  });
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("¿Hablan español? Necesito reparar un grifo que gotea."),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Sí, tenemos Faucet Repair en nuestros servicios y podemos ayudarle con eso.","name":"","phone":"","email":""}'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.language, "es");
  assert.equal(result.delivered, "handoff");
  assert.equal(result.guard.ok, false);
  assert.equal(result.guard.reason, "untranslated_service_label");
  assert.equal(result.guard.detail, "faucet repair");
  assert.doesNotMatch(result.reply, /Faucet Repair/i);
  assert.match(result.reply, /Prefiero no adivinar/);
});

test("a fully translated Spanish service answer still ships normally", async () => {
  const kb = realKb({
    island: { ...fixture.island, services: [{ name: "Faucet Repair and Installation" }] },
  });
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("¿Hablan español? Necesito reparar un grifo que gotea."),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Sí, el sitio incluye reparación e instalación de grifos.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.delivered, "model");
  assert.equal(result.guard.ok, true);
  assert.doesNotMatch(result.reply, /Faucet Repair/i);
});

test("single-word and non-action English service labels cannot leak into Spanish", () => {
  const kb = realKb({
    island: { ...fixture.island, services: [{ name: "Plumbing" }, { name: "Air Conditioning" }] },
  });
  assert.equal(reply._test.untranslatedServiceFragment("Sí, ofrecemos Plumbing.", kb, "es", true), "plumbing");
  assert.equal(reply._test.untranslatedServiceFragment("Sí, ofrecemos Air Conditioning.", kb, "es", true), "air conditioning");
  assert.equal(reply._test.untranslatedServiceFragment("Sí, ofrecemos plomería y aire acondicionado.", kb, "es", true), "");
});

test("every full multiword English service label is blocked in Spanish", () => {
  const names = ["Water Heaters", "Sewer Lines", "Mini Splits", "Water Quality"];
  const kb = realKb({ island: { ...fixture.island, services: names.map((name) => ({ name })) } });
  for (const name of names) {
    assert.equal(reply._test.untranslatedServiceFragment(`Sí, ofrecemos ${name}.`, kb, "es", true), name.toLowerCase());
  }
  assert.equal(reply._test.untranslatedServiceFragment("Sí, ofrecemos Water Heater.", kb, "es", true), "water heater");
});

test("a singularized English service label is replaced in a Spanish reply", async () => {
  const kb = realKb({ island: { ...fixture.island, services: [{ name: "Water Heaters" }] } });
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("¿Reparan calentadores de agua?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Sí, ofrecemos Water Heater.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.guard.ok, false);
  assert.equal(result.guard.reason, "untranslated_service_label");
  assert.equal(result.guard.detail, "water heater");
  assert.equal(result.delivered, "handoff");
  assert.doesNotMatch(result.reply, /Water Heater/i);
});

test("ambiguous city-only nearby towns require a same-language clarification", async () => {
  const base = kbWithRiversideNearby();
  const kb = {
    ...base,
    nearbyTowns: [
      base.nearbyTowns[0],
      { name: "Riverside, CA", distance: "40 mi", source: base.nearbyTowns[0].source },
    ],
  };
  assert.equal(reply._test.nearbyTownAsked("Do you serve Riverside?", kb), null);
  assert.equal(reply._test.resolveNearbyTownAsked("Do you serve Riverside?", kb).reason, "ambiguous");
  assert.equal(reply._test.nearbyTownAsked("Do you serve Riverside MO?", kb).name, "Riverside, MO");

  const english = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Do you serve Riverside?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Yes, we serve Riverside.","name":"","phone":"","email":""}'),
  });
  assert.equal(english.enforcementReason, "ambiguous_nearby_town");
  assert.match(english.reply, /^The page lists more than one nearby town named Riverside: Riverside, MO and Riverside, CA\. Which one do you mean\?$/);
  assert.doesNotMatch(english.reply, /Yes, we serve/);

  const spanish = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("¿Atienden en Riverside?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Sí, atendemos en Riverside.","name":"","phone":"","email":""}'),
  });
  assert.equal(spanish.language, "es");
  assert.equal(spanish.enforcementReason, "ambiguous_nearby_town");
  assert.match(spanish.reply, /^La página muestra más de una localidad cercana llamada Riverside:/);
  assert.doesNotMatch(spanish.reply, /Sí, atendemos/);
});

test("an explicit different state never falls back to the same nearby city", async () => {
  const kb = kbWithRiversideNearby();
  assert.equal(reply._test.nearbyTownAsked("Do you serve Riverside, CA?", kb), null);
  assert.equal(reply._test.resolveNearbyTownAsked("Do you serve Riverside, CA?", kb).reason, "state_mismatch");
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Do you serve Riverside, CA?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Yes, we serve Riverside, CA.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.enforcementReason, "nearby_town_state_mismatch");
  assert.match(result.reply, /^I only have a nearby-town listing for Riverside, MO\. Which location do you mean\?$/);
  assert.doesNotMatch(result.reply, /Yes, we serve/);
});

test("REGRESSION: declining to answer about a warranty is not offering one", () => {
  // Caught live 2026-08-11: once the visitor said "warranty", the word stayed
  // alive in the conversation and every later reply was refused for containing
  // it — including replies that were explicitly declining to comment.
  const grounding = kbGroundingBlock(realKb());
  assert.equal(reply.claimGuard("I can't tell you whether we offer a warranty.", grounding).ok, true);
  assert.equal(reply.claimGuard("I don't have information on pricing or free estimates.", grounding).ok, true);
  // ...and the actual offer is still refused, which is the whole point.
  assert.equal(reply.claimGuard("We guarantee all our work.", grounding).reason, "unsupported_guarantee");
  assert.equal(reply.claimGuard("Estimates are free.", grounding).reason, "unsupported_free");
  assert.equal(reply.claimGuard("Ask about our 10 year warranty.", grounding).reason, "unsupported_warranty");
});

test("REGRESSION: the assistant does not send the same handoff twice in a row", async () => {
  // Caught live 2026-08-11: the customer received the identical canned handoff
  // three times. A bot repeating itself is worse than a bot that stops.
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  const invention = '{"reply":"Yes, we guarantee everything we install.","name":"","phone":"","email":""}';

  const first = await reply.generateAiReply({
    kb, grounding, messages: messagesOf("Do you offer a warranty?"), isFirstAiMessage: false,
    previousRefused: false, callModelImpl: modelSaying(invention),
  });
  assert.equal(first.ok, true, "the first refusal still answers with a handoff");
  assert.equal(first.guard.ok, false);

  assert.equal(first.delivered, "handoff");

  // No contact detail in this turn, so there is no close to make — the only
  // thing left to send would be the identical handoff. Say nothing instead.
  const second = await reply.generateAiReply({
    kb, grounding, messages: messagesOf("So do you or don't you?"), isFirstAiMessage: false,
    previousRefused: true, callModelImpl: modelSaying(invention),
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "consecutive_refusal");
});

test("going quiet never loses a lead the visitor already gave", async () => {
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    // The number arrived in an EARLIER turn, so this turn has no close to make
    // and is suppressed — but the lead must still travel with the outcome.
    messages: messagesOf("my number is (503) 555-0142", "Thanks, noted.", "So do you or don't you?"),
    isFirstAiMessage: false,
    previousRefused: true,
    callModelImpl: modelSaying('{"reply":"Yes, we guarantee everything.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "consecutive_refusal");
  assert.equal(result.lead.captured, true);
  assert.equal(result.lead.phone, "+15035550142");
});

test("REGRESSION: a suppressed reply still hands the owner the lead", async () => {
  const store = seededThread({ messages: [visitorMessage({ body: "This is Dana, (503) 555-0142" })] });
  const pushes = [];
  const deps = takeoverDeps(store, {
    sendConnectPush: async (input) => { pushes.push(input); return { ok: true }; },
    generateAiReply: async () => ({
      ok: false,
      reason: "consecutive_refusal",
      lead: { captured: true, name: "Dana", phone: "+15035550142", email: "", sources: {} },
    }),
  });

  const outcome = await (await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps)).run();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.leadPromoted, true);
  assert.equal(store.tables.connect_threads[0].contact_info, "+15035550142");
  assert.equal(store.tables.connect_messages.some((row) => row.direction === "outbound"), false, "no message was sent");
  assert.equal(pushes.length, 1, "but the owner was still told a lead came in");
});

test("REGRESSION: \"are you a real person?\" is answered, never suppressed and never sampled", async () => {
  // Caught live 2026-08-11: the loop suppression correctly stopped a repeated
  // handoff and, in doing so, stonewalled the one question the disclosure law
  // exists to protect. It is now answered before the model is consulted.
  const kb = realKb();
  const calls = [];
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Wait — am I talking to a real person right now?"),
    isFirstAiMessage: false,
    previousRefused: true, // the exact state that produced silence
    callModelImpl: modelSaying('{"reply":"Yes of course, a real human!"}', { calls }),
  });
  assert.equal(result.ok, true, "this question must always get an answer");
  assert.equal(calls.length, 0, "and must never depend on what a sampler returns");
  assert.equal(result.provider, "deterministic");
  assert.match(result.reply, /AI assistant/i);
  assert.equal(reply.claimGuard(result.reply, kbGroundingBlock(kb)).ok, true);

  for (const asked of ["Are you a bot?", "is this a chatbot", "am I chatting with an AI?", "Are you a real person or a machine?"]) {
    assert.equal(reply.isIdentityQuestion(asked), true, asked);
  }
  for (const notAsked of ["Are you the person who does installs?", "Do you work on heat pumps?", "are you open Saturday"]) {
    assert.equal(reply.isIdentityQuestion(notAsked), false, notAsked);
  }
});

test("REGRESSION: a visitor who just gave their number is acknowledged, not asked again", async () => {
  // Caught live 2026-08-11: "This is Dana, my number is (503) 555-0142. Call
  // me." produced silence, because the previous turn had also been refused.
  // The close outranks the refusal.
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  const result = await reply.generateAiReply({
    kb,
    grounding,
    messages: messagesOf("Fine. This is Dana, my number is (503) 555-0142. Call me."),
    isFirstAiMessage: false,
    previousRefused: true,
    callModelImpl: modelSaying('{"reply":"Sure, and we guarantee same-day service.","name":"Dana","phone":"(503) 555-0142","email":""}'),
  });

  assert.equal(result.ok, true, "silence is the wrong answer to someone handing over their number");
  assert.equal(result.delivered, "lead_ack");
  assert.equal(result.guard.ok, false, "the model's invention is still recorded as refused");
  assert.equal(/guarantee|same-?day/i.test(result.reply), false, "and still never reaches the customer");
  assert.match(result.reply, /Thanks Dana/);
  assert.equal(/best number|leave your name/i.test(result.reply), false, "must not ask for what they just gave");
  assert.equal(result.lead.phone, "+15035550142");
  // Deterministic, so it must be safe without being checked — check anyway.
  assert.equal(reply.claimGuard(result.reply, grounding).ok, true);
});

test("the loop signal keys on what was delivered, not on the guard verdict", async () => {
  // A refused turn that still closed with an acknowledgement said something
  // new, so it must not count towards the repeat-yourself cap.
  const store = seededThread({
    messages: [
      visitorMessage({ id: 100, body: "my number is 5035550142" }),
      {
        id: 101, thread_id: 7, direction: "outbound", body: "Thanks — I've got your number...",
        meta: { source: "ai_assistant", guard: "refused:unsupported_warranty", delivered: "lead_ack" },
        created_at: new Date(NOW - 50000).toISOString(),
      },
      visitorMessage({ id: 102, body: "do you do ductless?", created_at: new Date(NOW - 40000).toISOString() }),
    ],
  });
  let seen = null;
  const deps = takeoverDeps(store, {
    generateAiReply: async (input) => { seen = input.previousRefused; return { ok: true, reply: "Yes.", lead: { captured: false }, guard: { ok: true }, delivered: "model" }; },
  });
  await (await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps)).run();
  assert.equal(seen, false, "a lead acknowledgement is not the assistant repeating itself");
});

test("consecutive refusal is read from what the assistant actually said last", async () => {
  const store = seededThread({
    messages: [
      visitorMessage({ id: 100, body: "warranty?" }),
      {
        id: 101, thread_id: 7, direction: "outbound", body: "That's one I'd rather not guess at...",
        meta: { source: "ai_assistant", guard: "refused:unsupported_warranty", delivered: "handoff" },
        created_at: new Date(NOW - 50000).toISOString(),
      },
      visitorMessage({ id: 102, body: "ok fine", created_at: new Date(NOW - 40000).toISOString() }),
    ],
  });
  let seen = null;
  const deps = takeoverDeps(store, {
    generateAiReply: async (input) => { seen = input.previousRefused; return { ok: true, reply: "Sure.", lead: { captured: false }, guard: { ok: true } }; },
  });
  await (await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps)).run();
  assert.equal(seen, true);
});

// ===========================================================================
// 2. THE DISCLOSURE — prepended in code, not asked for in a prompt
// ===========================================================================

test("the first AI message discloses that it is an AI, by name", async () => {
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Do you do heat pumps?"),
    isFirstAiMessage: true,
    callModelImpl: modelSaying('{"reply":"Yes — heat pump repair and installation are both listed on our services.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.disclosed, true);
  assert.match(result.reply, /AI assistant/i);
  assert.match(result.reply, /Rose City Heating & Air/);
  assert.ok(result.reply.indexOf("AI assistant") < 120, "the disclosure must open the message, not trail it");
});

test("the disclosure survives a model that ignores the return format entirely", async () => {
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("Hi"),
    isFirstAiMessage: true,
    callModelImpl: modelSaying("Sure, happy to help with that."),
  });
  assert.equal(result.parsedJson, false);
  assert.match(result.reply, /AI assistant/i);
});

test("the disclosure is not repeated on later messages", async () => {
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: messagesOf("And in Beaverton?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"The site lists Portland and the surrounding metro.","name":"","phone":"","email":""}'),
  });
  assert.equal(/AI assistant/i.test(result.reply), false);
});

// ===========================================================================
// 3. SILENCE — the conditions under which the assistant must not speak
// ===========================================================================

test("a site with no published knowledge never calls a model at all", async () => {
  const calls = [];
  const result = await reply.generateAiReply({
    kb: emptyKb(),
    grounding: "SITE: nowhere",
    messages: messagesOf("Do you fix boilers?"),
    callModelImpl: modelSaying('{"reply":"Yes we do!"}', { calls }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_knowledge_base");
  assert.equal(calls.length, 0, "an empty corpus is exactly when a model invents one — do not ask it");
});

test("a business name alone is not a knowledge base", () => {
  assert.equal(reply.hasSpeakableKnowledge(emptyKb()), false);
  assert.equal(reply.hasSpeakableKnowledge(realKb()), true);
});

test("a disabled site never generates", async () => {
  const store = seededThread({ messages: [visitorMessage()] });
  const verdict = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, takeoverDeps(store, {
    readSiteSettings: async () => ({ ok: true, aiChatEnabled: false, takeoverSeconds: 30, reason: "" }),
  }));
  assert.equal(verdict.generate, false);
  assert.match(verdict.reason, /ai_chat_disabled/);
  assert.equal(store.tables.connect_messages.length, 1, "no reservation may be written");
});

test("a settings read that failed silences the site rather than guessing", async () => {
  const store = seededThread({ messages: [visitorMessage()] });
  const verdict = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, takeoverDeps(store, {
    readSiteSettings: async () => ({ ok: false, aiChatEnabled: false, reason: "settings_table_missing" }),
  }));
  assert.equal(verdict.generate, false);
  assert.equal(verdict.reason, "ai_chat_disabled:settings_table_missing");
});

test("the owner replying suppresses the assistant for the rest of the thread", async () => {
  const store = seededThread({
    messages: [
      visitorMessage({ id: 100 }),
      { id: 101, thread_id: 7, direction: "outbound", body: "Yep, we cover Beaverton.", meta: { delivery: { delivered: true } }, created_at: new Date(NOW - 50000).toISOString() },
      visitorMessage({ id: 102, body: "Great — how soon?", created_at: new Date(NOW - 40000).toISOString() }),
    ],
  });
  const verdict = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, takeoverDeps(store));
  assert.equal(verdict.generate, false);
  assert.equal(verdict.reason, "owner_handling");
});

test("the owner joining MID-conversation stands the assistant down permanently", () => {
  const decision = takeover.decideTakeover({
    thread: { id: 7 },
    settings: { aiChatEnabled: true, takeoverSeconds: 30 },
    nowMs: NOW,
    messages: [
      { id: 1, direction: "inbound", body: "hi", created_at: new Date(NOW - 300000).toISOString() },
      { id: 2, direction: "outbound", body: "AI answer", meta: { source: "ai_assistant" }, created_at: new Date(NOW - 280000).toISOString() },
      { id: 3, direction: "outbound", body: "Owner here, taking over.", meta: {}, created_at: new Date(NOW - 200000).toISOString() },
      { id: 4, direction: "inbound", body: "great, thanks", created_at: new Date(NOW - 100000).toISOString() },
    ],
  });
  assert.equal(decision.generate, false);
  assert.equal(decision.reason, "owner_handling");
});

test("the owner's window is respected before the assistant speaks", async () => {
  // A described job, not a lookup — exactly where owner-first earns its keep, so
  // the full window stands. (The factual fast lane is proven separately below.)
  const lead = visitorMessage({ body: "My furnace is grinding and I'd like someone to take a look.", created_at: new Date(NOW - 5000).toISOString() });
  const store = seededThread({ messages: [lead] });
  const early = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, takeoverDeps(store));
  assert.equal(early.generate, false);
  assert.equal(early.reason, "within_owner_window");
  assert.equal(store.tables.connect_messages.length, 1);

  const late = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, takeoverDeps(store, { now: () => NOW + 31000 }));
  assert.equal(late.generate, true);
});

test("a plain factual lookup takes the fast lane and is answered at once", async () => {
  // The dominant Family Heating case: the answer is on the page, so a 30-second
  // wait for the owner adds nothing. One second in, the assistant may speak.
  const ask = visitorMessage({ body: "What time are you open until on Wednesday?", created_at: new Date(NOW - 1000).toISOString() });
  const store = seededThread({ messages: [ask] });
  const verdict = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, takeoverDeps(store));
  assert.equal(verdict.generate, true, "a factual lookup takes the fast lane even one second in");
  assert.equal(verdict.reason, "owner_window_elapsed");
});

test("decideTakeover: the fast lane is factual-only, never a blanket bypass", () => {
  const base = { thread: { id: 7 }, settings: { aiChatEnabled: true, takeoverSeconds: 30 }, nowMs: NOW };
  const recent = (body) => [{ id: 1, direction: "inbound", body, created_at: new Date(NOW - 3000).toISOString() }];

  const lookup = takeover.decideTakeover({ ...base, messages: recent("What are your hours?"), factualLookup: true });
  assert.equal(lookup.generate, true, "a factual lookup three seconds in generates");
  assert.equal(lookup.takeoverSeconds, 0);

  const lead = takeover.decideTakeover({ ...base, messages: recent("Can someone come out today to fix my heater?"), factualLookup: false });
  assert.equal(lead.generate, false, "a described job three seconds in still waits for the owner");
  assert.equal(lead.reason, "within_owner_window");
});

test("the assistant does not speak twice in a row", () => {
  const decision = takeover.decideTakeover({
    thread: { id: 7 },
    settings: { aiChatEnabled: true, takeoverSeconds: 30 },
    nowMs: NOW,
    messages: [
      { id: 1, direction: "inbound", body: "hi", created_at: new Date(NOW - 300000).toISOString() },
      { id: 2, direction: "outbound", body: "AI answer", meta: { source: "ai_assistant" }, created_at: new Date(NOW - 280000).toISOString() },
    ],
  });
  assert.equal(decision.generate, false);
  assert.equal(decision.reason, "awaiting_visitor");
});

test("the conversation is capped so the assistant cannot argue in a loop", () => {
  const messages = [];
  for (let i = 0; i < 12; i += 1) {
    messages.push({ id: i * 2 + 1, direction: "inbound", body: "no but really", created_at: new Date(NOW - 300000).toISOString() });
    messages.push({ id: i * 2 + 2, direction: "outbound", body: "answer", meta: { source: "ai_assistant" }, created_at: new Date(NOW - 290000).toISOString() });
  }
  messages.push({ id: 999, direction: "inbound", body: "still here", created_at: new Date(NOW - 200000).toISOString() });
  const decision = takeover.decideTakeover({
    thread: { id: 7 }, settings: { aiChatEnabled: true, takeoverSeconds: 30 }, nowMs: NOW, messages, maxReplies: 12,
  });
  assert.equal(decision.generate, false);
  assert.equal(decision.reason, "reply_cap_reached");
});

test("a thread whose slug does not match the caller's tenant is refused", async () => {
  const store = seededThread({ messages: [visitorMessage()], thread: { site_slug: "some-other-business" } });
  const verdict = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, takeoverDeps(store));
  assert.equal(verdict.generate, false);
  assert.equal(verdict.reason, "thread_slug_mismatch");
});

// ===========================================================================
// 4. SPEAKING TWICE — concurrent polls
// ===========================================================================

test("two concurrent polls produce exactly ONE reservation and ONE reply", async () => {
  const store = seededThread({ messages: [visitorMessage()] });
  let generations = 0;
  const deps = takeoverDeps(store, {
    generateAiReply: async () => {
      generations += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, reply: "Yes, heat pumps are on our services list.", lead: { captured: false }, guard: { ok: true }, disclosed: true, provider: "test", model: "test" };
    },
  });

  // Two tabs on independent six-second timers, landing together.
  const [a, b] = await Promise.all([
    takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps),
    takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps),
  ]);

  const claimed = [a, b].filter((verdict) => verdict.generate === true);
  assert.equal(claimed.length, 1, "exactly one poll may win the reservation");
  assert.match([a, b].find((v) => v.generate !== true).reason, /concurrent_poll/);

  await Promise.all(claimed.map((verdict) => verdict.run()));

  assert.equal(generations, 1, "the model must be called once, not once per tab");
  const outbound = store.tables.connect_messages.filter((row) => row.direction === "outbound");
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].delivery_status, "completed");
  assert.equal(outbound[0].meta.source, "ai_assistant");
});

test("the reservation id is derived, so two polls compute the same key", () => {
  assert.equal(takeover.aiClientMessageId("7", "100"), takeover.aiClientMessageId("7", "100"));
  assert.notEqual(takeover.aiClientMessageId("7", "100"), takeover.aiClientMessageId("7", "101"));
  assert.notEqual(takeover.aiClientMessageId("8", "100"), takeover.aiClientMessageId("7", "100"));
  // The column carries a CHECK constraint; a key that cannot be stored is not a key.
  const { CLIENT_MESSAGE_ID_RE } = require("../lib/connect.js");
  assert.match(takeover.aiClientMessageId("7", "100"), CLIENT_MESSAGE_ID_RE);
});

test("a half-finished reply is invisible to the visitor by the existing contract", async () => {
  const store = seededThread({ messages: [visitorMessage()] });
  const deps = takeoverDeps(store, { generateAiReply: async () => new Promise(() => {}) });
  const verdict = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps);
  assert.equal(verdict.generate, true);
  verdict.run().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 5));

  const reservation = store.tables.connect_messages.find((row) => row.direction === "system");
  assert.ok(reservation, "the claim is durable before the model is called");
  const { _test } = require("../lib/connect-chat.js");
  assert.equal(_test.safeMessage(reservation), null, "safeMessage drops it, so no placeholder can render");
});

test("a stale lease from a crashed invocation is re-claimed, but only up to the cap", () => {
  const base = {
    thread: { id: 7 },
    settings: { aiChatEnabled: true, takeoverSeconds: 30 },
    nowMs: NOW,
  };
  const visitor = { id: 100, direction: "inbound", body: "hello", created_at: new Date(NOW - 300000).toISOString() };
  const reservationOf = (overrides) => ({
    id: 101,
    direction: "system",
    body: takeover.RESERVED_BODY,
    meta: { source: "ai_assistant", answering_message_id: "100" },
    delivery_status: "pending",
    delivery_attempts: 1,
    ...overrides,
  });

  assert.equal(
    takeover.decideTakeover({ ...base, messages: [visitor, reservationOf({ delivery_last_attempt_at: new Date(NOW - 1000).toISOString() })] }).reason,
    "reply_in_flight",
  );
  assert.equal(
    takeover.decideTakeover({ ...base, messages: [visitor, reservationOf({ delivery_last_attempt_at: new Date(NOW - takeover.AI_LEASE_MS - 1000).toISOString() })] }).generate,
    true,
  );
  assert.equal(
    takeover.decideTakeover({ ...base, messages: [visitor, reservationOf({ delivery_attempts: takeover.MAX_ATTEMPTS, delivery_last_attempt_at: new Date(NOW - 999999).toISOString() })] }).reason,
    "reply_attempts_exhausted",
  );
  assert.equal(
    takeover.decideTakeover({ ...base, messages: [visitor, reservationOf({ delivery_status: "delivery_unknown" })] }).reason,
    "reply_abandoned",
  );
});

test("a generation that fails permanently retires the turn instead of looping", async () => {
  const store = seededThread({ messages: [visitorMessage()] });
  const deps = takeoverDeps(store, { generateAiReply: async () => ({ ok: false, reason: "no_knowledge_base" }) });
  const verdict = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps);
  await verdict.run();

  const reservation = store.tables.connect_messages.find((row) => row.direction === "system");
  assert.equal(reservation.delivery_status, "delivery_unknown");
  assert.equal(reservation.meta.reason, "no_knowledge_base");
  assert.equal(store.tables.connect_messages.some((row) => row.direction === "outbound"), false);

  const again = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps);
  assert.equal(again.generate, false);
  assert.equal(again.reason, "reply_abandoned");
});

test("a transient provider failure is retried on the next poll, not retired", async () => {
  const store = seededThread({ messages: [visitorMessage()] });
  let attempt = 0;
  const deps = takeoverDeps(store, {
    generateAiReply: async () => {
      attempt += 1;
      return attempt === 1
        ? { ok: false, reason: "rate_limited" }
        : { ok: true, reply: "Yes, heat pumps are listed.", lead: { captured: false }, guard: { ok: true }, disclosed: true };
    },
  });

  await (await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps)).run();
  const second = await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps);
  assert.equal(second.generate, true, "a rate limit must not silence the turn forever");
  await second.run();

  const outbound = store.tables.connect_messages.filter((row) => row.direction === "outbound");
  assert.equal(outbound.length, 1);
});

// ===========================================================================
// 5. THE LEAD — a contact detail must come from the customer's own words
// ===========================================================================

test("a contact detail the visitor never typed is discarded", () => {
  const lead = reply.extractLead({
    claimed: { name: "Dave", phone: "503-555-9999", email: "dave@example.com" },
    transcript: "My furnace is making a noise. Can someone look at it?",
  });
  assert.equal(lead.captured, false);
  assert.equal(lead.phone, "");
  assert.equal(lead.email, "");
  assert.equal(lead.name, "");
});

test("a contact detail the visitor did type is captured and normalised", () => {
  const lead = reply.extractLead({
    claimed: { name: "Dana", phone: "(503) 555-0142", email: "DANA@example.com" },
    transcript: "Hi, this is Dana. Best number is (503) 555-0142 or dana@example.com",
  });
  assert.equal(lead.captured, true);
  assert.equal(lead.name, "Dana");
  assert.equal(lead.phone, "+15035550142");
  assert.equal(lead.email, "dana@example.com");
  assert.equal(lead.sources.phone, "visitor_confirmed");
});

test("details are read straight from the visitor even when the model reports none", () => {
  const lead = reply.extractLead({
    claimed: {},
    transcript: "call me on 5035550142",
  });
  assert.equal(lead.phone, "+15035550142");
  assert.equal(lead.sources.phone, "visitor_text");
});

test("a captured lead lands on the THREAD and the owner is told a lead came in", async () => {
  const store = seededThread({ messages: [visitorMessage({ body: "This is Dana, call me on (503) 555-0142" })] });
  const pushes = [];
  const deps = takeoverDeps(store, {
    sendConnectPush: async (input) => { pushes.push(input); return { ok: true }; },
    generateAiReply: async () => ({
      ok: true,
      reply: "Thanks Dana — someone will call you straight back.",
      lead: { captured: true, name: "Dana", phone: "+15035550142", email: "", sources: { name: "visitor_confirmed", phone: "visitor_confirmed" } },
      guard: { ok: true },
      disclosed: true,
    }),
  });

  await (await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps)).run();

  const thread = store.tables.connect_threads[0];
  assert.equal(thread.contact_name, "Dana", "the owner should see a lead, not a transcript");
  assert.equal(thread.contact_info, "+15035550142");
  assert.equal(thread.meta.lead.capturedBy, "ai_assistant");
  assert.equal(thread.meta.source, "site_widget", "the thread's own meta must survive the patch");

  assert.equal(pushes.length, 1);
  assert.match(pushes[0].sender, /New lead/);
  assert.match(pushes[0].snippet, /Lead captured/);
});

test("a detail the owner already corrected by hand is never overwritten", async () => {
  const store = seededThread({
    messages: [visitorMessage({ body: "This is Dana, call me on (503) 555-0142" })],
    thread: { contact_name: "Dana Whitfield (verified)", contact_info: "+15035550999" },
  });
  const result = await takeover.promoteLead(
    { threadId: 7, lead: { captured: true, name: "Dana", phone: "+15035550142", email: "", sources: {} }, nowMs: NOW },
    { select: store.select, conditionalUpdate: store.conditionalUpdate },
  );
  assert.equal(result.promoted, true);
  const thread = store.tables.connect_threads[0];
  assert.equal(thread.contact_name, "Dana Whitfield (verified)");
  assert.equal(thread.contact_info, "+15035550999");
  assert.equal(thread.meta.lead.phone, "+15035550142", "the captured value is still recorded, just not promoted over the owner's");
});

test("the thread is not marked read just because the assistant answered", async () => {
  const store = seededThread({ messages: [visitorMessage()] });
  const touches = [];
  const deps = takeoverDeps(store, { touchThread: async (id, options) => { touches.push(options); return true; } });
  await (await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps)).run();
  assert.equal(touches.length, 1);
  assert.equal("unread" in touches[0], false, "a live lead must not be buried as read");
});

test("the reply records WHICH LANGUAGE it disclosed in, and the next turn reads it back", async () => {
  // Without this the disclosure record is useless: a visitor who opens in
  // English and switches to Spanish would either be disclosed to twice in
  // English or never in Spanish. See lib/connect-language.js.
  const store = seededThread({ messages: [visitorMessage({ body: "Hola, ¿reparan aire acondicionado?" })] });
  const deps = takeoverDeps(store, {
    generateAiReply: async () => ({
      ok: true, reply: "Hola — soy el asistente...", body: "...",
      lead: { captured: false }, guard: { ok: true }, delivered: "model",
      disclosed: true, language: "es", provider: "test", model: "test",
    }),
  });
  await (await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps)).run();
  const sent = store.tables.connect_messages.find((row) => row.direction === "outbound");
  assert.equal(sent.meta.language, "es", "the stored reply must carry its language");
  assert.equal(sent.meta.disclosed, true);

  // Now the next turn: the thread already discloses in Spanish, and that is
  // what the generator is told.
  let seen = null;
  const next = seededThread({
    messages: [
      visitorMessage({ id: 100, body: "Do you also do heat pumps?" }),
      {
        id: 101, thread_id: 7, direction: "outbound", body: "Hola — soy el asistente...",
        meta: { source: "ai_assistant", disclosed: true, language: "es", delivered: "model" },
        created_at: new Date(NOW - 50000).toISOString(),
      },
      visitorMessage({ id: 102, body: "¿Y bombas de calor?", created_at: new Date(NOW - 40000).toISOString() }),
    ],
  });
  const deps2 = takeoverDeps(next, {
    generateAiReply: async (input) => {
      seen = input.disclosedLanguages;
      return { ok: true, reply: "Sí.", lead: { captured: false }, guard: { ok: true }, language: "es" };
    },
  });
  await (await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps2)).run();
  assert.deepEqual(seen, ["es"]);
});

test("a reply written before the language field existed is read back as English", async () => {
  let seen = null;
  const store = seededThread({
    messages: [
      visitorMessage({ id: 100 }),
      {
        id: 101, thread_id: 7, direction: "outbound", body: "Hi — I'm ...'s AI assistant...",
        meta: { source: "ai_assistant", disclosed: true, delivered: "model" },
        created_at: new Date(NOW - 50000).toISOString(),
      },
      visitorMessage({ id: 102, body: "and heat pumps?", created_at: new Date(NOW - 40000).toISOString() }),
    ],
  });
  const deps = takeoverDeps(store, {
    generateAiReply: async (input) => {
      seen = input.disclosedLanguages;
      return { ok: true, reply: "Yes.", lead: { captured: false }, guard: { ok: true } };
    },
  });
  await (await takeover.evaluateAiTakeover({ threadId: "7", siteSlug: SLUG }, deps)).run();
  assert.deepEqual(seen, ["en"], "the old rows were English by construction");
});

// ===========================================================================
// 6. THE MODEL CREDENTIAL
// ===========================================================================

test("a provider whose key fails authentication is retired loudly, not silently", async () => {
  reply.resetProviderHealth();
  const events = [];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("api.anthropic.com")) {
      return { ok: false, status: 401, json: async () => ({ error: { type: "authentication_error", message: "API key is invalid." } }) };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "PONG" } }] }) };
  };
  const env = { ANTHROPIC_API_KEY: "dead", OPENROUTER_API_KEY: "live", CONNECT_AI_PROVIDER: "" };

  const first = await reply.callModel({
    system: "s", user: "u", env, fetchImpl,
    recordEvent: async (type, payload) => { events.push({ type, payload }); },
  });
  assert.equal(first.ok, true);
  assert.equal(first.provider, "openrouter");

  // Order the ladder the other way so the dead key is tried first, then prove
  // the fallback is announced and the dead provider is not tried again.
  reply.resetProviderHealth();
  events.length = 0;
  calls.length = 0;
  const pinnedFirst = await reply.callModel({
    system: "s", user: "u", env: { ...env }, fetchImpl,
    recordEvent: async (type, payload) => { events.push({ type, payload }); },
  });
  assert.equal(pinnedFirst.ok, true);

  reply.resetProviderHealth();
  const anthropicOnly = await reply.callModel({
    system: "s", user: "u", fetchImpl,
    env: { ANTHROPIC_API_KEY: "dead", CONNECT_AI_PROVIDER: "anthropic" },
    recordEvent: async (type, payload) => { events.push({ type, payload }); },
  });
  assert.equal(anthropicOnly.ok, false);
  assert.equal(anthropicOnly.reason, "auth_failed");
  assert.ok(events.some((e) => e.type === "connect_ai_provider_fallback"), "a dead key must not look like normal operation");

  // Retired for the process: a second call does not spend another round trip.
  const before = calls.length;
  const retried = await reply.callModel({
    system: "s", user: "u", fetchImpl,
    env: { ANTHROPIC_API_KEY: "dead", CONNECT_AI_PROVIDER: "anthropic" },
  });
  assert.equal(retried.reason, "no_model_credential");
  assert.equal(calls.length, before, "the dead provider must not be probed again");
  reply.resetProviderHealth();
});

test("the ladder leads with the credential that was measured working", () => {
  reply.resetProviderHealth();
  const ladder = reply.providerLadder({ ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "b" });
  assert.deepEqual(ladder.map((p) => p.name), ["openrouter", "anthropic"]);
  assert.equal(ladder[0].model, "anthropic/claude-haiku-4.5");
  assert.equal(reply.PROVIDERS.anthropic.model, "claude-haiku-4-5-20251001");
  assert.equal(reply.aiReplyConfigured({}), false);
});

test("with no credential at all the assistant stays quiet rather than improvising", async () => {
  reply.resetProviderHealth();
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb, grounding: kbGroundingBlock(kb), messages: messagesOf("hello"), env: {}, fetchImpl: async () => { throw new Error("no"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_model_credential");
});

// ===========================================================================
// 7. THE GROUNDING HANDED TO THE MODEL
// ===========================================================================

test("the system prompt carries the corpus verbatim and the refusal law", async () => {
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  const seen = [];
  await reply.generateAiReply({
    kb, grounding, messages: messagesOf("do you do ductless?"), isFirstAiMessage: true,
    callModelImpl: modelSaying('{"reply":"Yes, ductless is on the list."}', { calls: seen }),
  });
  const system = seen[0].system;
  assert.ok(system.includes(grounding), "the corpus must be passed verbatim, not summarised");
  assert.match(system, /You are an AI/i);
  assert.match(system, /Never invent or estimate a price/i);
  assert.match(system, /Never promise availability/i);
  assert.match(system, /Answer every part of a multi-part question/);
  assert.match(system, /NEARBY TOWNS is only a town the page prints for directions/);
  assert.match(system, /Translate them fully into the visitor's language/);
  assert.match(system, /never leave an English label such as 'Faucet Repair'/);
  assert.match(system, /Do not write a greeting/i, "the disclosure is prepended in code; the model must not duplicate it");
  assert.match(seen[0].user, /Visitor: do you do ductless\?/);
});

test("the transcript sent to the model excludes the reservation rows", () => {
  const rendered = reply._test.renderTranscript([
    { direction: "inbound", body: "hello there" },
    { direction: "system", body: takeover.RESERVED_BODY },
    { direction: "outbound", body: "hi, how can I help" },
  ]);
  assert.equal(rendered.includes(takeover.RESERVED_BODY), false);
  assert.match(rendered, /Visitor: hello there/);
  assert.match(rendered, /Assistant: hi, how can I help/);
});
