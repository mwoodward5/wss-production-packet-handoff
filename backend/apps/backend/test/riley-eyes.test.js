"use strict";

// RILEY NEEDS EYES, NOT MORE HANDS.
//
// Four modules, one theme: the agent may only say things the system can show.
//   lib/riley-capabilities.js  — the verbs that exist, and one refusal
//   lib/edit-timing.js         — the measured number, or no number
//   lib/riley-uploads.js       — a file this tenant sent, never a dictated URL
//   lib/riley-context.js       — what has actually passed between us and them
//
// Fails before this change: none of these modules existed. Riley answered
// "did you get my email?" out of nothing, quoted "about a minute" over twelve,
// and had no way to reach a photo the customer had already uploaded.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  EXECUTOR_VERBS,
  REFUSAL_SENTENCE,
  classifyRequest,
  describeCapability,
  capabilityBrief,
} = require("../lib/riley-capabilities");
const {
  MIN_SAMPLES,
  summarize,
  quoteFor,
  bucketOf,
  boundWords,
} = require("../lib/edit-timing");
const {
  listTenantUploads,
  pickUpload,
  containsDictatedUrl,
  resolveUploadForEdit,
  spokenLabel,
} = require("../lib/riley-uploads");
const { readRileyContext, shapeEdits, composeSpoken } = require("../lib/riley-context");
const { signScopeToken } = require("../lib/dashboard-link");
const { ATTACHMENT_MARKER } = require("../lib/customer-uploads");

const SLUG = "wss-test-poor-john-s-plumbing-parkville";
const OTHER = "wss-test-rimrock-plumbing-billings";
const NOW = Date.parse("2026-08-12T12:00:00.000Z");

function mockRes() {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) this.body += String(chunk); return this; },
  };
}

// ---------------------------------------------------------------------------
// 1. CAPABILITY HONESTY
// ---------------------------------------------------------------------------

test("the declared verb list IS the executor's verb list", () => {
  // The apply loop in lib/site-change-plan.js is the only place a plan op
  // becomes bytes. If a verb is added, renamed or deleted there and not here,
  // Riley starts promising or refusing the wrong thing — so this reads the
  // executor's own source rather than trusting a comment.
  const source = fs.readFileSync(require.resolve("../lib/site-change-plan"), "utf8");
  const applyLoop = source.slice(source.indexOf("Phase 3 — the deterministic apply"));
  const executed = new Set();
  for (const m of applyLoop.matchAll(/kind === "([a-z_]+)"/g)) executed.add(m[1]);

  const declared = new Set(EXECUTOR_VERBS.map((v) => v.op));
  assert.ok(executed.size >= 10, `expected the apply loop to be found; saw ${executed.size} branches`);
  assert.deepEqual([...declared].sort(), [...executed].sort());
});

test("an unsupported request gets exactly one plain refusal and no homework", () => {
  const out = describeCapability("can you take over posting to my Facebook every week");
  assert.equal(out.supported, false);
  assert.equal(out.say, REFUSAL_SENTENCE);
  // A refusal may say what we could not do. It may not ask the caller which
  // section, element, file or link — that is the engineering, and it is ours.
  assert.doesNotMatch(out.say, /which (section|element|page)|can you (tell|send|point)|what(?:'s| is) it near/i);
  // And it never claims a person will act by a particular time.
  assert.doesNotMatch(out.say, /\b(within|in) (an? )?(hour|day|minute)/i);
});

test("a supported request gets NO capability patter — the confirm path owns the words", () => {
  const out = describeCapability("make the phone number in the header bold");
  assert.equal(out.supported, true);
  assert.equal(out.op, "style_override");
  assert.equal(out.say, null);
});

test("the classifier puts real customer sentences in the right bucket", () => {
  const cases = [
    ["Put it back the way it was.", "undo"],
    ["undo the privacy policy page", "undo"],
    ["add my google analytics, the id is G-4Q7RSTVWX2", "tracking"],
    ["we need a privacy policy page on the site", "new_page"],
    ["Use this picture for the hero image", "image"],
    ["Change the heading that says Comfort isn't a setting on the wall to say We show up", "copy"],
    ["Put a line on the home page saying we answer the phone twenty four hours a day.", "content_block"],
    ["make the phone number in the header dark green", "style"],
    ["Make the logo twice as big.", "style"],
  ];
  for (const [text, family] of cases) {
    assert.equal(classifyRequest(text).family, family, `"${text}" should be ${family}`);
  }
});

test("contact-detail requests are quick copy edits, not the one refusal", () => {
  // These three are the VAPI tool description's OWN examples
  // (api/admin/vapi-assistants.js), and the executor's replace_copy /
  // replace_text branches re-word exactly this text. The classifier used to
  // refuse all three — Riley spoke the one refusal for the product's own
  // advertised edits. The verb-driven and noun-driven contact forms are both
  // pinned here so neither regresses back to out_of_scope.
  for (const words of [
    "change my phone number to 555-1234",
    "change the phone number on the site",
    "update our hours",
    "our phone number is wrong on the site",
    "our hours have changed",
    "our new address is 12 Main St",
  ]) {
    const hit = classifyRequest(words);
    assert.equal(hit.supported, true, `"${words}" must be supported`);
    assert.equal(hit.family, "copy", `"${words}" must be a copy edit`);
    assert.equal(hit.tier, "quick", `"${words}" must be a quick edit`);
    assert.ok(["replace_copy", "replace_text"].includes(hit.op), `"${words}" must name a real copy verb`);
  }
  // And the contact words do not steal sentences from other families: the
  // styling sentences keep their verb (no update verb near the noun), the
  // "hours a day" line keeps its content block (no update verb, no trigger),
  // and a genuinely out-of-scope request still gets the one refusal.
  assert.equal(classifyRequest("make the phone number in the header bold").op, "style_override");
  assert.equal(classifyRequest("Move the phone number into the header.").family, "style");
  assert.equal(classifyRequest("Put a line on the home page saying we answer the phone twenty four hours a day.").family, "content_block");
  assert.equal(classifyRequest("run my Facebook page for me").tier, "out_of_scope");
});

test("the capability brief cannot drift from the verb list", () => {
  const brief = capabilityBrief();
  assert.equal(brief.verbs.length, EXECUTOR_VERBS.length);
  assert.equal(brief.refusal, REFUSAL_SENTENCE);
});

// ---------------------------------------------------------------------------
// 1a. THE TIERED ANSWER — "bigger build", not a permanent "I can't"
// ---------------------------------------------------------------------------
// The owner's directive after ~50 live calls, updated by the power wave
// (2026-08-17): simple edits are always a yes; a section move that NAMES its
// section and where it goes is now a REAL edit (reorder_section — the executor
// moves the bytes on a static donor, and speaks the bigger-build referral only
// on a compiled one); a GENERIC reorder with no names stays the bigger build,
// with the quick lane and the named-section door still open behind it. These
// tests pin the tier, the sentence and the two laws the sentence must keep:
// no homework, no duration.

test("a NAMED section move is a real edit; a GENERIC reorder is still the bigger build", () => {
  const {
    BIGGER_BUILD_SENTENCE,
    classifyRequest: classify,
    describeCapability: describe,
  } = require("../lib/riley-capabilities");
  // Named section moves are SUPPORTED — never a quick STYLING edit (no CSS
  // reorders a section) and never the one refusal.
  for (const words of [
    "Move the reviews section above the gallery.",
    "put the testimonials section above the services",
  ]) {
    const hit = classify(words);
    assert.equal(hit.supported, true, `"${words}" is a real edit now`);
    assert.equal(hit.op, "reorder_section");
    assert.equal(hit.tier, "structural", `"${words}" is the structural tier, not styling`);
    const out = describe(words);
    assert.equal(out.say, null, "a supported edit gets no capability patter — the confirm path owns the words");
  }
  // A reorder with NO names cannot parse — nobody has said what goes where —
  // so it stays the bigger-build sentence, which now carries the invitation
  // to name the section (the door back into the supported case).
  for (const words of [
    "Could you move entire sections around on the page?",
    "Reorder the sections so services come first.",
    "Change the order of the sections on the homepage.",
  ]) {
    const hit = classify(words);
    assert.equal(hit.supported, false, `"${words}" is not a quick edit`);
    assert.equal(hit.tier, "structural", `"${words}" must be the bigger build`);
    const out = describe(words);
    assert.equal(out.say, BIGGER_BUILD_SENTENCE);
  }
});

test("the bigger-build sentence offers what IS possible and never hard-codes impossibility", () => {
  const { BIGGER_BUILD_SENTENCE } = require("../lib/riley-capabilities");
  // A real option is offered, with the quick lane still open…
  assert.match(BIGGER_BUILD_SENTENCE, /bigger build/i);
  assert.match(BIGGER_BUILD_SENTENCE, /change any words, colours, sizing or photos, add a section, or put a whole new page up/i);
  // …including the named-section door back into the supported case…
  assert.match(BIGGER_BUILD_SENTENCE, /name one section and where you want it/i);
  // …it is never a permanent "can't"…
  assert.doesNotMatch(BIGGER_BUILD_SENTENCE, /\bcan'?t\b|\bnever\b|\bimpossible\b|\bdon'?t do\b/i);
  // …and it obeys the refusal's laws: no homework, no duration.
  assert.doesNotMatch(BIGGER_BUILD_SENTENCE, /which (section|element|page|file)|can you (tell|send|point)|what(?:'s| is) it near/i);
  assert.doesNotMatch(BIGGER_BUILD_SENTENCE, /\b(within|in) (an? )?(hour|day|minute)|minute|second/i);
});

test("section words do not steal quick edits — the logo and the phone stay quick", () => {
  const classify = classifyRequest;
  // The section-word test is the SCANNER, not the topic: these all mention
  // moves or page parts and every one is a real quick edit.
  for (const [words, family] of [
    ["Move the logo over to the left a bit.", "style"],
    ["Make the logo twice as big.", "style"],
    ["swap the logo and the call button", "style"],
    ["Move the phone number into the header.", "style"],
    ["Put a line on the home page saying we answer twenty four hours a day.", "content_block"],
    ["Use this picture for the hero image", "image"],
  ]) {
    const hit = classify(words);
    assert.equal(hit.supported, true, `"${words}" must stay a quick edit`);
    assert.equal(hit.family, family, `"${words}" should be ${family}`);
    assert.equal(hit.tier, "quick");
  }
});

test("every classify result carries its tier, and the brief speaks all three", () => {
  const brief = capabilityBrief();
  assert.equal(classifyRequest("make the phone number bold").tier, "quick");
  assert.equal(classifyRequest("move the whole gallery section up top").tier, "structural");
  assert.equal(classifyRequest("run my Facebook page for me").tier, "out_of_scope");
  // The brief a prompt carries now names the three tiers and the two
  // gap-answers callers actually ask for, so the model stops improvising them.
  assert.equal(brief.tiers.quick.say, brief.can_do);
  assert.equal(brief.tiers.structural.say, brief.bigger_build);
  assert.equal(brief.tiers.out_of_scope.say, REFUSAL_SENTENCE);
  assert.match(brief.status_check, /exactly where a change stands/i);
  // The confirmation line tells the truth about the owner-only rail: it says
  // the PHONE is how Riley confirms, and never promises a customer email.
  assert.match(brief.edit_confirmation, /the phone/i);
  assert.doesNotMatch(brief.edit_confirmation, /\byou'?ll get an email\b/i);
});

// ---------------------------------------------------------------------------
// 1b. THE TOOL DEFINITION — one description, in two places, kept identical
// ---------------------------------------------------------------------------

test("the attachable JSON and the endpoint's definition say the same thing", () => {
  // A tool's description IS the model's operating instructions. Two copies that
  // drift means Riley is told two different things about the same tool
  // depending on how it was attached — so the standalone file (attach by hand)
  // and the admin action (attach by API) are pinned to each other here.
  const before = process.env.VAPI_TOOL_SECRET;
  process.env.VAPI_TOOL_SECRET = "definition-parity-test-secret";
  try {
    const { customerContextToolDefinition } = require("../api/admin/vapi-assistants.js");
    const built = customerContextToolDefinition(process.env);
    const onDisk = JSON.parse(fs.readFileSync(require.resolve("../scripts/riley-eyes/vapi-tool-riley-context.json"), "utf8"));
    delete onDisk._readme;

    assert.equal(built.function.name, onDisk.function.name);
    assert.equal(built.function.description, onDisk.function.description);
    assert.deepEqual(built.function.parameters, onDisk.function.parameters);
    assert.equal(built.server.url, onDisk.server.url);
    // The file carries a placeholder, never a live secret in the repo.
    assert.equal(onDisk.server.secret, "${VAPI_TOOL_SECRET}");
    assert.equal(built.server.secret, "definition-parity-test-secret");
    // And it points at the read-only route, not at anything that writes.
    assert.match(built.server.url, /\/api\/riley\/context$/);
  } finally {
    if (before === undefined) delete process.env.VAPI_TOOL_SECRET;
    else process.env.VAPI_TOOL_SECRET = before;
  }
});

// ---------------------------------------------------------------------------
// 2. HONEST TIMING
// ---------------------------------------------------------------------------

/** A row shaped like the real table (verified against production 2026-08-12). */
function jobRow({ id, instruction, status, startedAt, ms, engineS }) {
  return {
    job_id: id,
    site_slug: SLUG,
    instruction,
    status,
    created_at: new Date(startedAt).toISOString(),
    updated_at: new Date(startedAt + ms).toISOString(),
    result: engineS ? { timings: { total_s: engineS } } : {},
  };
}

function styleHistory(count, durations) {
  return durations.slice(0, count).map((ms, i) =>
    jobRow({ id: `edit_${i}`, instruction: "make the header phone number bold", status: "done", startedAt: NOW - 86_400_000 - i * 1000, ms }));
}

test("with too little history, no number is spoken at all", () => {
  const summary = summarize(styleHistory(3, [10_000, 20_000, 30_000]), { now: NOW });
  const quote = quoteFor({ instruction: "make the header phone number bold", summary });
  assert.equal(quote.number_spoken, false);
  assert.equal(quote.basis.why, "too_few_samples");
  assert.doesNotMatch(quote.say, /\bminute|\bsecond|\bhour/);
  assert.match(quote.say, /won't put a time on it/i);
});

test("the number quoted is the p90 ceiling, never the median", () => {
  // p50 20s, p90 130s — the real production shape. Quoting the median means
  // being wrong, long, for one request in two. That is how "about a minute"
  // was born.
  const durations = [10_000, 15_000, 18_000, 20_000, 22_000, 25_000, 40_000, 60_000, 90_000, 130_000];
  const summary = summarize(styleHistory(10, durations), { now: NOW });
  const stat = summary.buckets.style;
  assert.equal(stat.samples, 10);
  assert.equal(stat.done_p50_ms, 22_000);
  assert.equal(stat.done_p90_ms, 90_000);

  const quote = quoteFor({ instruction: "make the header phone number bold", summary });
  assert.equal(quote.number_spoken, true);
  assert.equal(quote.basis.quoted, "p90");
  assert.equal(quote.basis.p90_ms, 90_000);
  // 90s rounds UP to two minutes. Rounding a ceiling down turns a bound into a
  // broken promise.
  assert.match(quote.say, /a couple of minutes/);
});

test("a poor landing rate is spoken in the same breath as the duration", () => {
  // Production measured 56% of terminal jobs reaching done. A duration quoted
  // silently on top of that is a promise with a hole in it.
  const rows = [
    ...styleHistory(6, [10_000, 12_000, 14_000, 16_000, 18_000, 20_000]),
    jobRow({ id: "f1", instruction: "make the header phone number bold", status: "failed", startedAt: NOW - 90_000_000, ms: 300_000 }),
    jobRow({ id: "f2", instruction: "make the header phone number bold", status: "failed", startedAt: NOW - 91_000_000, ms: 300_000 }),
    jobRow({ id: "f3", instruction: "make the header phone number bold", status: "failed", startedAt: NOW - 92_000_000, ms: 300_000 }),
  ];
  const summary = summarize(rows, { now: NOW });
  assert.equal(summary.buckets.style.landed_rate, 6 / 9);
  const quote = quoteFor({ instruction: "make the header phone number bold", summary });
  assert.equal(quote.number_spoken, true);
  assert.match(quote.say, /don't take on the first go/i);
  assert.match(quote.say, /check it before we hang up/i);
});

test("a 14-day row is discarded from durations and COUNTED, never dropped silently", () => {
  const rows = [
    ...styleHistory(6, [10_000, 12_000, 14_000, 16_000, 18_000, 20_000]),
    jobRow({ id: "stale", instruction: "make the header phone number bold", status: "done", startedAt: NOW - 20 * 86_400_000, ms: 14 * 86_400_000 }),
  ];
  const summary = summarize(rows, { now: NOW });
  assert.equal(summary.buckets.style.samples, 6);   // the outlier is not in the percentiles
  assert.equal(summary.buckets.style.done, 7);      // but it IS in the landing rate
  assert.equal(summary.buckets.style.discarded, 1); // and it is reported
});

test("an unreadable history speaks no number and says which", () => {
  const quote = quoteFor({ instruction: "make it bold", summary: null });
  assert.equal(quote.number_spoken, false);
  assert.equal(quote.basis.why, "history_unreadable");
  assert.match(quote.say, /not going to guess/i);
});

test("a thin bucket falls back to the overall figure and says it did", () => {
  const rows = [
    ...styleHistory(8, [10_000, 11_000, 12_000, 13_000, 14_000, 15_000, 16_000, 17_000]),
    jobRow({ id: "p1", instruction: "swap the hero picture for the photo I sent", status: "done", startedAt: NOW - 3_600_000, ms: 30_000 }),
  ];
  const summary = summarize(rows, { now: NOW });
  const quote = quoteFor({ instruction: "swap the hero picture for the photo I sent", summary });
  assert.equal(quote.basis.family, "image");
  assert.equal(quote.basis.measured_as, "overall");
  assert.equal(quote.number_spoken, true);
});

test("a borrowed DURATION never borrows the landing rate with it", () => {
  // Production 2026-08-12: image 17 terminal / 2 done = 12%, overall 56%. With
  // two completed jobs the image bucket cannot supply a p90, so the duration is
  // borrowed — and the first version of this code borrowed the 56% too, which
  // would have told a customer asking for a photo swap that changes like theirs
  // land better than one in two. The measured answer is one in eight.
  const image = (id, status) => jobRow({ id, instruction: "swap the hero picture for the photo I sent", status, startedAt: NOW - 3_600_000 - Number(id.slice(1)) * 1000, ms: 20_000 });
  const rows = [
    ...styleHistory(8, [10_000, 11_000, 12_000, 13_000, 14_000, 15_000, 16_000, 17_000]),
    image("i1", "done"), image("i2", "done"),
    ...Array.from({ length: 15 }, (_, i) => image(`i${i + 3}`, "failed")),
  ];
  const summary = summarize(rows, { now: NOW });
  assert.equal(summary.buckets.image.terminal, 17);
  assert.equal(summary.buckets.image.done, 2);

  const quote = quoteFor({ instruction: "swap the hero picture for the photo I sent", summary });
  assert.equal(quote.basis.measured_as, "overall");     // duration borrowed
  assert.equal(quote.basis.rate_measured_as, "image");  // rate is the truth
  assert.ok(quote.basis.landed_rate < 0.2);
  // And under 40% the headline duration is not spoken at all: "most changes
  // like that are live inside N" would be false when most of them never land.
  assert.equal(quote.number_spoken, false);
  assert.equal(quote.basis.quoted, "none_poor_landing_rate");
  assert.match(quote.say, /don't go through as often as they should/i);
  assert.doesNotMatch(quote.say, /live inside/i);
});

test("probe rows are not customer experience", () => {
  const rows = [
    ...styleHistory(5, [10_000, 11_000, 12_000, 13_000, 14_000]),
    { job_id: "edit_probe_1", site_slug: "wss-smoke-probe", instruction: "make it bold", status: "done", created_at: new Date(NOW - 1000).toISOString(), updated_at: new Date(NOW).toISOString(), result: {} },
  ];
  assert.equal(summarize(rows, { now: NOW }).buckets.style.samples, 5);
});

test("spoken bounds always round up", () => {
  assert.equal(boundWords(20_000), "half a minute");
  assert.equal(boundWords(61_000), "a couple of minutes");
  assert.equal(boundWords(121_000), "three minutes");
  assert.equal(bucketOf("undo that"), "undo");
});

// ---------------------------------------------------------------------------
// 3. UPLOADS AS AN EDIT INPUT
// ---------------------------------------------------------------------------

const UPLOADS = [
  { url: `https://files.test/storage/v1/object/public/wss-customer-uploads/uploads/${SLUG}/aaa.jpg`, kind: "photo", mimetype: "image/jpeg", bytes: 1000, at: "2026-08-10T10:00:00.000Z", name: "the photo you sent on August 10" },
  { url: `https://files.test/storage/v1/object/public/wss-customer-uploads/uploads/${SLUG}/bbb.png`, kind: "photo", mimetype: "image/png", bytes: 2000, at: "2026-08-08T10:00:00.000Z", name: "the photo you sent on August 8" },
  { url: `https://files.test/storage/v1/object/public/wss-customer-uploads/uploads/${SLUG}/ccc.pdf`, kind: "document", mimetype: "application/pdf", bytes: 3000, at: "2026-08-07T10:00:00.000Z", name: "the file you sent on August 7" },
];

/** The storage client needs a base and a key before it will list anything —
 *  a missing config is refused rather than guessed at, so a test that means to
 *  exercise the listing has to supply both. */
function withStorageEnv(fn) {
  const before = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    WSS_CUSTOMER_UPLOADS_BASE_URL: process.env.WSS_CUSTOMER_UPLOADS_BASE_URL,
  };
  process.env.SUPABASE_URL = "https://files.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-for-tests";
  process.env.WSS_CUSTOMER_UPLOADS_BASE_URL = "https://files.test/storage/v1/object/public/wss-customer-uploads";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test("a URL read out over the phone is refused BEFORE anything is fetched", async () => {
  // The whole hazard in one test: a voice agent that fetches a dictated address
  // is an SSRF and an identity leak in one motion. No listing, no fetch, no
  // echo of the address back.
  let called = 0;
  const out = await resolveUploadForEdit({
    siteSlug: SLUG,
    message: "use the photo at https://evil.example.com/truck.jpg for the hero",
    fetchImpl: async () => { called += 1; throw new Error("must not fetch"); },
  });
  assert.equal(called, 0);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "dictated_url");
  assert.doesNotMatch(out.say, /evil\.example\.com/);
  assert.match(out.say, /through the chat on your dashboard/i);
  assert.equal(containsDictatedUrl("it's on my dropbox"), true);
  assert.equal(containsDictatedUrl("make the logo bigger"), false);
});

test("a request that needs no file passes straight through untouched", async () => {
  const out = await resolveUploadForEdit({ siteSlug: SLUG, message: "make the logo bigger", fetchImpl: async () => { throw new Error("no fetch"); } });
  assert.equal(out.ok, true);
  assert.equal(out.attached, false);
  assert.equal(out.instruction, "make the logo bigger");
});

test("'that photo I sent' resolves to the newest photo and composes ONE carrier format", () => withStorageEnv(async () => {
  const listing = UPLOADS.map((u) => ({
    name: u.url.split("/").pop(),
    created_at: u.at,
    metadata: { size: u.bytes, mimetype: u.mimetype },
  }));
  const fetchImpl = async () => ({ ok: true, json: async () => listing });
  const out = await resolveUploadForEdit({ siteSlug: SLUG, message: "put that photo I just sent on the home page", fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.attached, true);
  assert.equal(out.why, "newest");
  // Composed through lib/customer-uploads.js, so the confirm hash, the job
  // row and the owner email all see the shape they already handle.
  assert.match(out.instruction, new RegExp(ATTACHMENT_MARKER.replace(/[-[\]{}()*+?.\\^$|]/g, "\\$&")));
  assert.match(out.instruction, /aaa\.jpg/);
  assert.doesNotMatch(out.instruction, /ccc\.pdf/);
}));

test("several photos and no way to tell which -> ask, do not guess", () => {
  const out = pickUpload({ uploads: UPLOADS, message: "put the picture I sent on the site" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "ambiguous");
  assert.match(out.say, /2 photos/);
  // The choice is offered in plain words, never in storage names.
  assert.doesNotMatch(out.say, /\.jpg|\.png|[0-9a-f]{16}/);
});

test("spoken file labels distinguish files sent on the SAME day", () => {
  // The first version labelled by date alone, and the real bucket held three
  // files from August 8 — so the question came out "is it the photo you sent on
  // August 8, or an older one?", which nobody can answer. Position always
  // distinguishes; the date is the reminder that goes with it.
  const sameDay = [
    { url: "u1", kind: "photo", mimetype: "image/png", bytes: 1, at: "2026-08-08T23:32:40.000Z" },
    { url: "u2", kind: "photo", mimetype: "image/png", bytes: 2, at: "2026-08-08T22:47:31.000Z" },
    { url: "u3", kind: "photo", mimetype: "image/jpeg", bytes: 3, at: "2026-08-08T22:46:16.000Z" },
  ];
  const labels = sameDay.map((u, i) => spokenLabel(u, i));
  assert.equal(new Set(labels).size, 3, `labels must be distinct, got ${JSON.stringify(labels)}`);
  assert.match(labels[0], /^the last photo you sent, from August 8$/);
  assert.match(labels[1], /^the one before that, from August 8$/);
});

test("ordinals and 'the first one' select deterministically", () => {
  assert.equal(pickUpload({ uploads: UPLOADS, message: "use the second one" }).upload.url, UPLOADS[1].url);
  assert.equal(pickUpload({ uploads: UPLOADS, message: "use the first one you got" }).upload.url, UPLOADS[1].url);
  assert.equal(pickUpload({ uploads: UPLOADS, message: "use the fourth one" }).ok, false);
});

test("only a document on file is a plain answer, not a silent failure", () => {
  const out = pickUpload({ uploads: [UPLOADS[2]], message: "use the file I sent" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "only_documents");
  assert.match(out.say, /document can't go on a website/i);
});

test("an unreadable file store never becomes 'you never sent me anything'", () => withStorageEnv(async () => {
  const out = await resolveUploadForEdit({
    siteSlug: SLUG,
    message: "use that photo I sent",
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "list_503");
  assert.match(out.say, /can't get at your files/i);
  assert.doesNotMatch(out.say, /haven't sent|don't have a photo/i);
}));

test("the listing refuses to return an object outside this tenant's prefix", () => withStorageEnv(async () => {
  const listing = [
    { name: "aaa.jpg", created_at: "2026-08-10T10:00:00.000Z", metadata: { size: 10, mimetype: "image/jpeg" } },
    { name: "../../other/bbb.jpg", created_at: "2026-08-11T10:00:00.000Z", metadata: { size: 10, mimetype: "image/jpeg" } },
    { name: "placeholder", created_at: null, metadata: null },
  ];
  const out = await listTenantUploads({ siteSlug: SLUG, fetchImpl: async () => ({ ok: true, json: async () => listing }) });
  assert.equal(out.ok, true);
  assert.equal(out.uploads.length, 1);
  assert.match(out.uploads[0].url, new RegExp(`/uploads/${SLUG}/aaa\\.jpg$`));
}));

// ---------------------------------------------------------------------------
// 3b. THE ENDPOINT'S AMBIGUITY STOP
// ---------------------------------------------------------------------------

test("an ambiguous caller is stopped WITHOUT being read other people's Client IDs", async () => {
  // resolveSiteEditTargetForCaller returns candidates carrying client_id, and a
  // Client ID is the credential that unlocks this endpoint's private history.
  // Riley needs the NAMES to ask "which of these are you?" and nothing more.
  const targetsPath = require.resolve("../lib/site-edit-targets");
  const contextPath = require.resolve("../api/riley/context.js");
  // The context core binds the targets exports mutated below; it must
  // reload with the handler shell.
  const contextCorePath = require.resolve("../lib/riley-context-core");
  const before = { targets: require.cache[targetsPath], handler: require.cache[contextPath], core: require.cache[contextCorePath], secret: process.env.VAPI_TOOL_SECRET };
  process.env.VAPI_TOOL_SECRET = "ambiguity-test-secret";
  delete require.cache[contextPath];
  delete require.cache[contextCorePath];
  require(targetsPath);
  require.cache[targetsPath].exports = {
    ...require.cache[targetsPath].exports,
    resolveSiteEditTargetForCaller: async () => ({
      status: "ambiguous",
      say: "I've got a couple of accounts under that name — which town are you in?",
      candidates: [
        { client_id: "WSS-ABA2A3", business_name: "Cathedral Plumbing of Texas, LLC", city: "Carrollton", state: "TX" },
        { client_id: "WSS-7AF83D", business_name: "Stan's Heating, Air, Plumbing & Electrical", city: "Austin", state: "TX" },
      ],
    }),
  };
  try {
    const handler = require(contextPath);
    const res = mockRes();
    await handler({ method: "POST", headers: { "x-vapi-secret": "ambiguity-test-secret" }, body: { client_ref: "Plumbing" } }, res);
    assert.equal(res.statusCode, 409);
    const payload = JSON.parse(res.body);
    assert.equal(payload.status, "ambiguous");
    assert.equal(payload.candidates.length, 2);
    for (const c of payload.candidates) {
      assert.ok(c.business_name);
      assert.equal(c.client_id, undefined, "a stranger's Client ID must never leave this endpoint");
    }
    assert.doesNotMatch(res.body, /WSS-ABA2A3|WSS-7AF83D/);
    // And nothing private was read for anybody.
    assert.equal(payload.context, undefined);
  } finally {
    delete require.cache[contextPath];
    delete require.cache[contextCorePath];
    delete require.cache[targetsPath];
    if (before.targets) require.cache[targetsPath] = before.targets;
    if (before.handler) require.cache[contextPath] = before.handler;
    if (before.core) require.cache[contextCorePath] = before.core;
    if (before.secret === undefined) delete process.env.VAPI_TOOL_SECRET;
    else process.env.VAPI_TOOL_SECRET = before.secret;
  }
});

// ---------------------------------------------------------------------------
// 4. CONTEXT: TENANT SCOPE AND HONEST GAPS
// ---------------------------------------------------------------------------

function withScopeSecret(fn) {
  const before = process.env.CONNECT_APP_TOKEN;
  process.env.CONNECT_APP_TOKEN = "riley-eyes-test-secret-0123456789";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (before === undefined) delete process.env.CONNECT_APP_TOKEN;
      else process.env.CONNECT_APP_TOKEN = before;
    });
}

const noFetch = async () => { throw new Error("no network in this test"); };

test("no token, a forged token, and a token for someone else all answer NOT FOUND", () => withScopeSecret(async () => {
  const select = async () => ({ ok: true, data: [] });
  for (const token of ["", "not-a-token", Buffer.from("s2.someone-else.9999999999999.deadbeef").toString("base64url")]) {
    const out = await readRileyContext({ scopeToken: token, select, fetchImpl: noFetch });
    assert.equal(out.ok, false);
    assert.equal(out.status, 404, `token ${JSON.stringify(token)} must 404`);
    assert.equal(out.error, "not_found");
  }
}));

test("a valid token pointed at a DIFFERENT slug is not found, never forbidden", () => withScopeSecret(async () => {
  // 403 would be an oracle: probe the endpoint and it tells you which
  // businesses exist. A foreign read is indistinguishable from a missing one.
  const select = async () => ({ ok: true, data: [] });
  const out = await readRileyContext({ scopeToken: signScopeToken(SLUG), siteSlug: OTHER, select, fetchImpl: noFetch });
  assert.equal(out.ok, false);
  assert.equal(out.status, 404);
  assert.notEqual(out.status, 403);
}));

test("the slug is read out of the signature, and a matching cross-check is allowed", () => withScopeSecret(async () => {
  const queried = [];
  const select = async (table, query) => { queried.push(`${table}?${query}`); return { ok: true, data: [] }; };
  const out = await readRileyContext({ scopeToken: signScopeToken(SLUG), siteSlug: SLUG, select, fetchImpl: noFetch });
  assert.equal(out.ok, true);
  assert.equal(out.site_slug, SLUG);
  // Every slug-keyed read used the signed slug and nothing else.
  const slugQueries = queried.filter((q) => q.includes("site_slug=eq."));
  assert.ok(slugQueries.length > 0);
  for (const q of slugQueries) assert.match(q, new RegExp(`site_slug=eq\\.${SLUG}`));
  for (const q of queried) assert.doesNotMatch(q, new RegExp(OTHER));
}));

test("an unreadable section reports ok:false — it never poses as 'nothing there'", () => withScopeSecret(async () => {
  // lib/customer-site.js paid for this lesson: a select that 400s returns no
  // rows, and a caller that only checks the shape tells the customer there is
  // nothing there. "You never emailed us" is not a sentence an outage may say.
  const select = async () => ({ ok: false, mode: "live_select_failed", data: [] });
  const out = await readRileyContext({ scopeToken: signScopeToken(SLUG), select, fetchImpl: noFetch });
  assert.equal(out.ok, true);
  for (const name of ["emails", "dashboard", "siteChat", "edits"]) {
    assert.equal(out.sections[name].ok, false, `${name} must report unreadable`);
    assert.ok(out.sections[name].note, `${name} must carry a note`);
  }
  assert.match(out.spoken, /I can't see/i);
  assert.doesNotMatch(out.spoken, /never asked for a change|Nothing from them by email/i);
}));

test("an empty-but-readable table says 'nothing on file', which is a different sentence", () => withScopeSecret(async () => {
  const select = async () => ({ ok: true, data: [] });
  const out = await readRileyContext({ scopeToken: signScopeToken(SLUG), select, fetchImpl: noFetch });
  assert.equal(out.sections.edits.ok, true);
  assert.equal(out.sections.edits.items.length, 0);
  assert.match(out.spoken, /never asked for a change/i);
  assert.doesNotMatch(out.spoken, /I can't see (your emails|their change history)/i);
}));

test("edit history carries the REAL outcome, not just the request", () => {
  const rows = [
    { job_id: "a", instruction: "Make the big headline bright orange.", status: "done", created_at: "2026-08-11T22:18:00.000Z", updated_at: "2026-08-11T22:28:28.000Z", result: { say: "Done — that's live." } },
    { job_id: "b", instruction: "make the logo twice as big", status: "failed", created_at: "2026-08-11T22:27:00.000Z", updated_at: "2026-08-11T22:36:37.000Z", result: { not_landed: true, reverted: true, say: "It went out and it didn't take, so I put it back." } },
  ];
  const out = shapeEdits(rows, new Map(), 6);
  assert.equal(out.items[0].landed, true);
  assert.equal(out.items[1].landed, false);
  // A deployed-then-reverted change is NOT "nothing changed" — the rollback is
  // recorded and carried, so nobody has to guess out loud.
  assert.equal(out.items[1].not_landed, true);
  assert.equal(out.items[1].reverted, true);
  assert.equal(out.items[0].took_ms, 628_000);
});

test("no recorded inbound email is spoken as 'nothing on file', with the reason attached", () => {
  const sections = {
    emails: { ok: true, items: [{ direction: "out", to_them: true, at: "2026-08-10T23:05:20.000Z", subject: "Your Website Changes Today" }], note: "no inbound lane rows" },
    dashboard: { ok: true, items: [], note: null },
    siteChat: { ok: true, items: [], note: null },
    edits: { ok: true, items: [], note: null },
    uploads: { ok: true, items: [], note: null },
  };
  const spoken = composeSpoken(sections, { now: Date.parse("2026-08-12T12:00:00.000Z") });
  assert.match(spoken, /Nothing from them by email is on file/);
  // Never the accusation.
  assert.doesNotMatch(spoken, /they (didn't|never) (email|write)/i);
  assert.match(spoken, /We last emailed them/);
});

test("mail that went to OUR inbox is never spoken as mail we sent THEM", () => withScopeSecret(async () => {
  // Found by running this module against production. Every send in the system
  // currently lands in woodwardsoftware@gmail.com — the owner-only rail is on —
  // and the first version attributed a mirror-proof send to the customer by
  // prospect id, producing "We last emailed them today: Your new website
  // preview" for a plumber who was never sent anything.
  const OWNER = "woodwardsoftware@gmail.com";
  const THEIRS = "owner@poorjohns.example";
  const select = async (table, query) => {
    if (table === "ghost_agency_prospects") {
      return { ok: true, data: [{ prospect_id: "p1", business_name: "Poor John's Plumbing", email: THEIRS, preview_url: `https://${SLUG}.wss-ai.com/`, record: {} }] };
    }
    if (table === "ghost_agency_events" && String(query).includes("riley.note_sent")) {
      return {
        ok: true,
        data: [
          { type: "operator.mirror_proof_sent", created_at: "2026-08-11T23:30:02.000Z", payload: { recipient: OWNER, prospect_id: "p1", business_name: "Poor John's Plumbing", mode: "sent" } },
          { type: "riley.note_sent", created_at: "2026-08-10T23:05:20.000Z", payload: { to: OWNER, caller: "+18165550101", subject: "Your Website Changes Today", sent: true } },
        ],
      };
    }
    return { ok: true, data: [] };
  };
  const out = await readRileyContext({ scopeToken: signScopeToken(SLUG), select, fetchImpl: noFetch });
  assert.equal(out.sections.emails.ok, true);
  assert.equal(out.sections.emails.items.length, 0, "mail to the owner's inbox is not mail to the customer");
  assert.match(out.sections.emails.note, /went to our own inbox/i);
  assert.doesNotMatch(out.spoken, /We last emailed them/);
  assert.match(out.spoken, /don't tell them we sent something/i);
}));

test("the spoken brief is sayable — no '1 people have used the chat'", () => {
  // That sentence came out verbatim on the first live run against a real
  // tenant. Everything here is read ALOUD by a voice agent, so a number glued
  // to a plural noun is a defect, not a typo.
  const base = { ok: true, items: [], note: null };
  const brief = (n) => composeSpoken({
    emails: base,
    dashboard: base,
    edits: base,
    uploads: base,
    siteChat: { ok: true, items: Array.from({ length: n }, () => ({ at: "2026-08-12T01:00:00.000Z", unread: true })), note: null },
  }, { now: Date.parse("2026-08-12T12:00:00.000Z") });

  assert.match(brief(1), /One person has used the chat on their website, still unread\./);
  assert.match(brief(3), /3 people have used the chat on their website, still unread\./);
  assert.doesNotMatch(brief(1), /1 people/);
});

test("mail that really did reach their address IS counted", () => withScopeSecret(async () => {
  const THEIRS = "owner@poorjohns.example";
  const select = async (table, query) => {
    if (table === "ghost_agency_prospects") {
      return { ok: true, data: [{ prospect_id: "p1", business_name: "Poor John's Plumbing", email: THEIRS, preview_url: `https://${SLUG}.wss-ai.com/`, record: {} }] };
    }
    if (table === "ghost_agency_events" && String(query).includes("riley.note_sent")) {
      return { ok: true, data: [{ type: "riley.note_sent", created_at: "2026-08-11T23:30:02.000Z", payload: { to: THEIRS, subject: "Your website link", sent: true } }] };
    }
    return { ok: true, data: [] };
  };
  const out = await readRileyContext({ scopeToken: signScopeToken(SLUG), select, fetchImpl: noFetch });
  assert.equal(out.sections.emails.items.length, 1);
  assert.equal(out.sections.emails.items[0].to_them, true);
  assert.match(out.spoken, /We last emailed them/);
}));
