"use strict";

// The chat door into the site edit engine — api/connect/edit.js,
// api/connect/edits.js, api/connect/upload.js.
//
// WHAT THESE TESTS ARE FOR. The brief this panel was built against names the
// hazard: "Do NOT ship a chat box that accepts a message and does nothing; that
// is worse than the tel: link because it looks like it worked." So the
// assertions are mostly about the join between the box and the engine — that a
// confirmed request becomes a real ghost_agency_edit_jobs row and a real
// executeEditJob call, that an unconfirmed one becomes NOTHING, and that every
// path which fails to reach the engine says so instead of showing a spinner.
//
// Fails before this change: none of these three endpoints existed. The only
// action anywhere in the customer product was a tel: link.

const test = require("node:test");
const assert = require("node:assert/strict");

const connectPath = require.resolve("../lib/connect");
const storePath = require.resolve("../lib/store");
const targetsPath = require.resolve("../lib/site-edit-targets");
const runnerPath = require.resolve("../lib/edit-job-runner");
const editPath = require.resolve("../api/connect/edit.js");
const editsPath = require.resolve("../api/connect/edits.js");
const uploadPath = require.resolve("../api/connect/upload.js");
const clarifyPath = require.resolve("../lib/edit-clarify");

const SLUG = "wss-test-poor-john-s-plumbing-parkville";
const BUSINESS = "Poor John's Plumbing";
const DOMAIN = "wss-test-poor-john-s-plumbing-parkville.wss-ai.com";
const SECRET = "chat-edit-test-secret-0123456789";
const FILE_BASE = "https://files.example.test";
const MINE = `${FILE_BASE}/uploads/${SLUG}/aaaaaaaa.jpg`;

const DESCRIBED = {
  site_slug: SLUG,
  business_name: BUSINESS,
  domain: DOMAIN,
  client_id: "WSS-1F9506",
  city: null,
  state: null,
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
  };
}

/**
 * Loads the three handlers with their collaborators stubbed. Everything the
 * test cares about — what was written, what was run, what was recorded — is
 * captured rather than mocked away.
 */
function withHandlers(run, {
  scope = { mode: "tenant", siteSlug: SLUG },
  described = DESCRIBED,
  jobs = [],
  insertMode = "live_write",
  execute = async () => ({ ok: true, status: "done", result: { say: "Done — that's live on your site.", changedFiles: ["index.html"] } }),
  selectMode = "live_select",
} = {}) {
  const inserted = [];
  const events = [];
  const executed = [];
  const selections = [];
  const saved = {
    connect: require.cache[connectPath],
    store: require.cache[storePath],
    targets: require.cache[targetsPath],
    runner: require.cache[runnerPath],
    clarify: require.cache[clarifyPath],
    secret: process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET,
    base: process.env.WSS_CUSTOMER_UPLOADS_BASE_URL,
  };
  process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET = SECRET;
  process.env.WSS_CUSTOMER_UPLOADS_BASE_URL = FILE_BASE;

  require.cache[connectPath] = {
    id: connectPath, filename: connectPath, loaded: true,
    exports: { resolveConnectScope: () => scope },
  };
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true,
    exports: {
      insertRow: async (table, row) => { inserted.push({ table, row }); return { mode: insertMode, row: [row] }; },
      recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
      select: async (table, query) => {
        selections.push({ table, query: String(query || "") });
        return { mode: selectMode, data: jobs };
      },
    },
  };
  require.cache[targetsPath] = {
    id: targetsPath, filename: targetsPath, loaded: true,
    exports: { describeSiteEditTarget: async (slug) => (slug === SLUG ? described : null) },
  };
  require.cache[runnerPath] = {
    id: runnerPath, filename: runnerPath, loaded: true,
    exports: {
      executeEditJob: async (jobId) => { executed.push(jobId); return execute(jobId); },
      drainEditQueue: async () => ({ ok: true }),
      notifyOwner: async () => {},
    },
  };
  // The clarifying-question turn calls a model; stub it OFF so these edit-flow
  // tests stay deterministic and offline (the module has its own unit tests).
  require.cache[clarifyPath] = {
    id: clarifyPath, filename: clarifyPath, loaded: true,
    exports: { assessEditRequest: async () => ({ needsInput: false }), firstJsonObject: () => null },
  };
  for (const p of [editPath, editsPath, uploadPath]) delete require.cache[p];
  const editHandler = require(editPath);
  const editsHandler = require(editsPath);
  const uploadHandler = require(uploadPath);

  const call = (handler) => async (body, { method = "POST", query = {} } = {}) => {
    const res = mockRes();
    await handler({ method, headers: {}, body, query }, res);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : {}, headers: res.headers };
  };

  return Promise.resolve(run({
    edit: call(editHandler),
    edits: (query = {}) => call(editsHandler)(undefined, { method: "GET", query }),
    upload: call(uploadHandler),
    inserted, events, executed, selections,
  })).finally(() => {
    for (const [path, mod] of [[connectPath, saved.connect], [storePath, saved.store], [targetsPath, saved.targets], [runnerPath, saved.runner]]) {
      if (mod) require.cache[path] = mod; else delete require.cache[path];
    }
    for (const p of [editPath, editsPath, uploadPath]) delete require.cache[p];
    if (saved.secret === undefined) delete process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET;
    else process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET = saved.secret;
    if (saved.base === undefined) delete process.env.WSS_CUSTOMER_UPLOADS_BASE_URL;
    else process.env.WSS_CUSTOMER_UPLOADS_BASE_URL = saved.base;
  });
}

// ---------------------------------------------------------------------------
// The first message never changes anything
// ---------------------------------------------------------------------------

test("a chat message reads the change back and enqueues nothing", () => withHandlers(async ({ edit, inserted, executed }) => {
  const res = await edit({ message: "Make the phone number in the header bigger." });
  assert.equal(res.status, 200);
  assert.equal(res.json.status, "confirm_required");
  assert.equal(res.json.applied, false);
  assert.equal(res.json.queued, false);
  assert.equal(res.json.confirm.business_name, BUSINESS);
  assert.equal(res.json.confirm.domain, DOMAIN);
  assert.ok(res.json.confirm_token.length > 40);
  assert.match(res.json.say, /Poor John's Plumbing/);
  assert.match(res.json.say, /Apply it\?/);
  assert.equal(inserted.length, 0, "phase one must write nothing");
  assert.equal(executed.length, 0, "phase one must run nothing");
}));

test("tapping apply queues exactly one job and runs it on the shared engine", () => withHandlers(async ({ edit, inserted, executed, events }) => {
  const message = "Make the phone number in the header bigger.";
  const first = await edit({ message });
  const second = await edit({ message, confirm_token: first.json.confirm_token });

  assert.equal(second.status, 200);
  assert.equal(second.json.status, "done");
  assert.equal(second.json.applied, true);
  assert.equal(second.json.say, "Done — that's live on your site.");

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].table, "ghost_agency_edit_jobs");
  assert.equal(inserted[0].row.site_slug, SLUG);
  assert.equal(inserted[0].row.instruction, message);
  assert.equal(inserted[0].row.status, "queued");
  assert.deepEqual(executed, [inserted[0].row.job_id], "the row written is the job run");

  const queued = events.find((e) => e.name === "ghost_agency_site_edit_queued");
  assert.ok(queued, "an edit must be traceable to the identity that authorised it");
  assert.equal(queued.payload.via, "dashboard_chat");
  assert.equal(queued.payload.confirmed_business_name, BUSINESS);
}));

test("a confirmation minted for a different change cannot apply this one", () => withHandlers(async ({ edit, inserted, executed }) => {
  const first = await edit({ message: "Make the header blue." });
  const swapped = await edit({ message: "Delete the contact section.", confirm_token: first.json.confirm_token });
  assert.equal(swapped.status, 409);
  assert.equal(swapped.json.status, "confirm_required");
  assert.equal(swapped.json.reason, "instruction_mismatch");
  assert.equal(inserted.length, 0);
  assert.equal(executed.length, 0);
  // The rejection is a fresh read-back, not a dead end.
  assert.ok(swapped.json.confirm_token.length > 40);
  assert.match(swapped.json.say, /Apply it\?/);
}));

test("a login with no site bound to it is refused, never defaulted to someone's", () => withHandlers(async ({ edit, inserted }) => {
  const res = await edit({ message: "Change the hours." });
  assert.equal(res.status, 400);
  assert.equal(res.json.status, "no_site");
  assert.match(res.json.say, /isn't linked to a website yet/);
  assert.equal(inserted.length, 0);
}, { scope: { mode: "full" } }));

test("a site we cannot name is not edited, even with a confirmation", () => withHandlers(async ({ edit, inserted }) => {
  const res = await edit({ message: "Change the hours." });
  assert.equal(res.status, 409);
  assert.equal(res.json.status, "unidentifiable_site");
  assert.match(res.json.say, /we're not going to change it/);
  assert.equal(inserted.length, 0);
}, { described: null }));

test("an unauthenticated caller gets nothing", () => withHandlers(async ({ edit, edits, upload }) => {
  for (const res of [await edit({ message: "x" }), await edits(), await upload({ data: "x" })]) {
    assert.equal(res.status, 401);
  }
}, { scope: null }));

// ---------------------------------------------------------------------------
// Files — the thing a phone call cannot do
// ---------------------------------------------------------------------------

test("an uploaded photo reaches the engine as a link inside the instruction", () => withHandlers(async ({ edit, inserted }) => {
  const message = "Use this photo on the front of the site.";
  const attachments = [{ url: MINE, name: "new truck.jpg", kind: "photo" }];
  const first = await edit({ message, attachments });
  assert.deepEqual(first.json.attachments, attachments);

  await edit({ message, attachments, confirm_token: first.json.confirm_token });
  const stored = inserted[0].row.instruction;
  assert.match(stored, /^Use this photo on the front of the site\./);
  assert.ok(stored.includes(MINE), "the planner's swap_image op needs the customer's own https link");
  assert.match(stored, /\[1\] photo "new truck.jpg"/);
}));

test("a link we did not issue is refused and nothing is enqueued", () => withHandlers(async ({ edit, inserted, events }) => {
  const res = await edit({
    message: "Use this photo.",
    attachments: [{ url: "https://evil.example/payload.jpg", name: "x.jpg", kind: "photo" }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.status, "attachment_not_ours");
  assert.equal(inserted.length, 0);
  assert.ok(events.find((e) => e.name === "ghost_agency_customer_edit_attachment_rejected"));
}));

test("another customer's upload prefix is not reachable from this login", () => withHandlers(async ({ edit }) => {
  const res = await edit({
    message: "Use this photo.",
    attachments: [{ url: `${FILE_BASE}/uploads/wss-test-someone-else/bbb.jpg`, name: "x.jpg", kind: "photo" }],
  });
  assert.equal(res.json.status, "attachment_not_ours");
}));

test("a file with no words asks what to do with it rather than guessing", () => withHandlers(async ({ edit, inserted }) => {
  const res = await edit({ message: "", attachments: [{ url: MINE, name: "truck.jpg", kind: "photo" }] });
  assert.equal(res.status, 400);
  assert.equal(res.json.status, "needs_words");
  assert.match(res.json.say, /Tell us what to do with it/);
  assert.equal(inserted.length, 0);
}));

test("an empty message with no files is not a request", () => withHandlers(async ({ edit }) => {
  const res = await edit({ message: "   " });
  assert.equal(res.status, 400);
  assert.equal(res.json.status, "empty");
}));

// ---------------------------------------------------------------------------
// The outcome is always reported, and never overstated
// ---------------------------------------------------------------------------

test("a refusal speaks the planner's own sentence and says the site is unchanged", () => withHandlers(async ({ edit }) => {
  const message = "Say we are the number one plumber in the state.";
  const first = await edit({ message });
  const res = await edit({ message, confirm_token: first.json.confirm_token });
  assert.equal(res.json.status, "refused");
  assert.equal(res.json.applied, false);
  assert.equal(res.json.say, "I can't add that unless it's something you can back up.");
}, {
  execute: async () => ({ ok: true, status: "refused", result: { say: "I can't add that unless it's something you can back up." } }),
}));

test("a refusal with no sentence of its own still tells the truth", () => withHandlers(async ({ edit }) => {
  const message = "Do the thing.";
  const first = await edit({ message });
  const res = await edit({ message, confirm_token: first.json.confirm_token });
  assert.equal(res.json.status, "refused");
  assert.match(res.json.say, /Nothing has changed/);
  assert.doesNotMatch(res.json.say, /live on your site/);
}, { execute: async () => ({ ok: true, status: "refused", result: {} }) }));

test("a failed run says the site did not change, and is never reported as underway", () => withHandlers(async ({ edit }) => {
  const message = "Make the hero taller.";
  const first = await edit({ message });
  const res = await edit({ message, confirm_token: first.json.confirm_token });
  assert.equal(res.json.status, "failed");
  assert.equal(res.json.applied, false);
  assert.match(res.json.say, /Nothing on your site changed/);
}, { execute: async () => ({ ok: false, status: "failed", error: "deploy blew up" }) }));

test("a machinery answer with an HTTP-ish status is a failure, not a spinner", () => withHandlers(async ({ edit }) => {
  const message = "Make the hero taller.";
  const first = await edit({ message });
  const res = await edit({ message, confirm_token: first.json.confirm_token });
  assert.equal(res.json.status, "failed");
  assert.equal(res.json.queued, false);
}, { execute: async () => ({ ok: false, status: 400, error: "unknown or unauthorized site" }) }));

test("a request that was never stored is reported as not started", () => withHandlers(async ({ edit, executed, events }) => {
  const message = "Change the hours to 8 to 6.";
  const first = await edit({ message });
  const res = await edit({ message, confirm_token: first.json.confirm_token });
  assert.equal(res.status, 503);
  assert.equal(res.json.status, "not_stored");
  assert.equal(res.json.queued, false);
  assert.match(res.json.say, /nothing has been started/);
  assert.equal(executed.length, 0, "there is no job to run");
  assert.ok(events.find((e) => e.name === "ghost_agency_customer_edit_not_stored"));
}, { insertMode: "live_write_failed" }));

test("a change still running is reported as running, not as done", () => withHandlers(async ({ edit }) => {
  const message = "Rebuild the whole gallery.";
  const first = await edit({ message });
  const res = await edit({ message, confirm_token: first.json.confirm_token });
  assert.equal(res.json.status, "applying");
  assert.equal(res.json.applied, false);
  assert.equal(res.json.queued, true);
  assert.match(res.json.say, /Working on it now/);
}, { execute: async () => ({ status: "still_running" }) }));

test("one change at a time — a second is refused while the first is live", () => withHandlers(async ({ edit, inserted }) => {
  const message = "And make the logo bigger.";
  const first = await edit({ message });
  const res = await edit({ message, confirm_token: first.json.confirm_token });
  assert.equal(res.status, 409);
  assert.equal(res.json.status, "busy");
  assert.match(res.json.say, /still going through/);
  assert.equal(inserted.length, 0);
}, {
  jobs: [{
    job_id: "edit_1", site_slug: SLUG, instruction: "make the header blue", status: "running",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }],
}));

test("a dead worker's stale claim does not lock the customer out of their own site", () => withHandlers(async ({ edit, inserted }) => {
  const message = "Make the logo bigger.";
  const first = await edit({ message });
  const res = await edit({ message, confirm_token: first.json.confirm_token });
  assert.equal(res.json.status, "done");
  assert.equal(inserted.length, 1);
}, {
  jobs: [{
    job_id: "edit_dead", site_slug: SLUG, instruction: "make the header blue", status: "running",
    created_at: new Date(Date.now() - 3600e3).toISOString(),
    updated_at: new Date(Date.now() - 3600e3).toISOString(),
  }],
}));

// ---------------------------------------------------------------------------
// The transcript
// ---------------------------------------------------------------------------

test("the transcript shows what the customer typed, not the composed instruction", () => withHandlers(async ({ edits }) => {
  const res = await edits();
  assert.equal(res.json.ok, true);
  assert.equal(res.json.edits.length, 1);
  const only = res.json.edits[0];
  assert.equal(only.message, "Use this photo on the front.");
  assert.deepEqual(only.attachments, [{ kind: "photo", name: "truck.jpg", url: MINE }]);
  assert.equal(only.status, "done");
  assert.equal(only.say, "That's live — refresh your page.");
  assert.equal(only.open, false);
  assert.ok(!JSON.stringify(only).includes("FILES THE CUSTOMER ATTACHED"), "the machinery is not shown to the customer");
}, {
  jobs: [{
    job_id: "edit_9", site_slug: SLUG, status: "done",
    instruction: [
      "Use this photo on the front.",
      "",
      "--- FILES THE CUSTOMER ATTACHED ---",
      "The customer uploaded these just now. Each link is the file itself, not a viewer.",
      `[1] photo "truck.jpg" - ${MINE}`,
    ].join("\n"),
    result: { say: "That's live — refresh your page.", changedFiles: ["index.html"] },
    created_at: "2026-08-08T10:00:00Z", updated_at: "2026-08-08T10:00:20Z",
  }],
}));

test("a scoped transcript ignores a client-supplied foreign slug", () => withHandlers(async ({ edits, selections }) => {
  const res = await edits({ slug: "other" });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.edits.length, 1);
  assert.equal(res.json.edits[0].jobId, "edit_mine");

  const historyRead = selections.find((read) =>
    read.table === "ghost_agency_edit_jobs" && /order=created_at\.desc/.test(read.query));
  assert.ok(historyRead, "the endpoint must query the scoped edit history");
  assert.match(historyRead.query, new RegExp(`(?:^|&)site_slug=eq\\.${SLUG}(?:&|$)`));
  assert.doesNotMatch(historyRead.query, /(?:^|&)site_slug=eq\.other(?:&|$)/,
    "a query-string slug must never override the signed customer scope");
}, {
  jobs: [{
    job_id: "edit_mine", site_slug: SLUG, status: "done", instruction: "Update my hours.",
    result: { say: "That's live." }, created_at: "2026-08-10T10:00:00Z", updated_at: "2026-08-10T10:00:20Z",
  }],
}));

test("a transcript that could not be read is not drawn as an empty one", () => withHandlers(async ({ edits }) => {
  const res = await edits();
  assert.equal(res.json.ok, false);
  assert.equal(res.json.reason, "history_unreadable");
  assert.deepEqual(res.json.edits, []);
}, { selectMode: "live_select_failed" }));

test("a full token naming no site gets an empty transcript, never somebody else's", () => withHandlers(async ({ edits }) => {
  const res = await edits();
  assert.equal(res.json.ok, true);
  assert.deepEqual(res.json.edits, []);
  assert.equal(res.json.reason, "no_site_bound_to_this_login");
}, { scope: { mode: "full" }, jobs: [{ job_id: "someone_else", site_slug: "other", status: "done", instruction: "hi" }] }));

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function withStorage(run) {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, f: global.fetch };
  const seen = [];
  process.env.SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  global.fetch = async (url, init) => { seen.push({ url: String(url), init }); return { ok: true, text: async () => "" }; };
  return Promise.resolve(run(seen)).finally(() => {
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
    global.fetch = saved.f;
  });
}

const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]).toString("base64");
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
// A Windows PE header and filler: nothing the photo/PDF sniffer recognises and
// nothing lib/customer-uploads-rich.js will take by name either.
const EXE_BYTES = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(128, 0x41)]);

test("a real photo uploads and comes back as a link under this customer's prefix", () => withStorage((seen) =>
  withHandlers(async ({ upload, events }) => {
    const res = await upload({ name: "new truck.jpg", data: `data:image/jpeg;base64,${JPEG_B64}` });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.attachment.kind, "photo");
    assert.equal(res.json.attachment.name, "new truck.jpg");
    assert.match(res.json.attachment.url, new RegExp(`/uploads/${SLUG}/[0-9a-f]{64}\\.jpg$`));
    assert.ok(seen.some((s) => s.url.includes("/storage/v1/object/wss-customer-uploads/uploads/")));
    assert.ok(events.find((e) => e.name === "ghost_agency_customer_upload_stored"));
    // The response carries nothing the customer has no use for. `type` is the
    // sniffed MIME the rich adapter (lib/customer-uploads-rich.js) now returns;
    // the storage path and the sha256 stay server-side.
    assert.deepEqual(Object.keys(res.json.attachment).sort(), ["bytes", "kind", "name", "type", "url"]);
    assert.equal(res.json.attachment.type, "image/jpeg");
  }, { scope: { mode: "tenant", siteSlug: SLUG } })));

test("a file we can take in no form at all is refused with what to send instead", () => withStorage(() =>
  withHandlers(async ({ upload, events }) => {
    // SVG is no longer the example here: it is stored as a DOCUMENT now (see
    // the next test). An executable is refused by both sniffers — the byte
    // sniffer does not know it and the rich adapter's name allow-list does not
    // carry `.exe` — so it is the honest "nothing takes this" case.
    const res = await upload({ name: "setup.exe", data: EXE_BYTES.toString("base64") });
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.reason, "unsupported_type");
    // The refusal has to name what WOULD work, not merely say no.
    assert.match(res.json.say, /\bPDF\b/i);
    assert.match(res.json.say, /image|photo|PNG|JPEG/i);
    assert.ok(events.find((e) => e.name === "ghost_agency_customer_upload_refused"));
  })));

test("an SVG is stored as a document, and never as a placeable photo", () => withStorage(() =>
  withHandlers(async ({ upload, events }) => {
    const res = await upload({ name: "logo.svg", data: SVG_BYTES.toString("base64") });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    // kind=document is the whole point: the edit contract only ever places a
    // `photo`, so a vector file can be sent to us for reference without ever
    // becoming an image the planner can drop onto a live page.
    assert.equal(res.json.attachment.kind, "document");
    assert.equal(res.json.attachment.type, "image/svg+xml");
    assert.match(res.json.attachment.url, new RegExp(`/uploads/${SLUG}/[0-9a-f]{64}\\.svg$`));
    assert.ok(events.find((e) => e.name === "ghost_agency_customer_upload_stored"));
  }, { scope: { mode: "tenant", siteSlug: SLUG } })));

test("the photo gate itself still refuses SVG outright", () => {
  // The rich adapter widened STORAGE, not the image gate. lib/site-change-plan
  // sniffImage decides what may be treated as a picture, and it must keep
  // saying no to a format that can carry script.
  const { sniffImage } = require("../lib/site-change-plan");
  const { sniffUpload } = require("../lib/customer-uploads");
  assert.equal(sniffImage(SVG_BYTES), null, "SVG must never sniff as a placeable image");
  assert.equal(sniffUpload(SVG_BYTES), null, "the photo/PDF sniffer must not classify SVG at all");
  assert.equal(sniffImage(EXE_BYTES), null);
});

test("an oversized body is refused before it is decoded", () => withStorage(() =>
  withHandlers(async ({ upload }) => {
    const res = await upload({ name: "huge.pdf", data: "A".repeat(6_000_000) });
    assert.equal(res.status, 413);
    assert.equal(res.json.reason, "too_large");
    assert.match(res.json.say, /smaller copy/);
  })));

test("an upload from a login with no site has nowhere to go and is told so", () => withStorage(() =>
  withHandlers(async ({ upload }) => {
    const res = await upload({ name: "x.jpg", data: JPEG_B64 });
    assert.equal(res.status, 400);
    assert.equal(res.json.reason, "no_site_bound_to_this_login");
  }, { scope: { mode: "full" } })));
