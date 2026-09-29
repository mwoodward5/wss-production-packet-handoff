"use strict";

// Read-only: list VAPI assistants + phone numbers (id, name, model) so the
// operator can pick a lane without opening the provider dashboard.
/**
 * The secret a provisioned VAPI tool must present. The handlers accept any of
 * these three (api/vapi-tools/*.js authorized()), so the provisioner must offer
 * the same set rather than one name that may be unset.
 */
function vapiToolSecret(env = process.env) {
  const s = [env.VAPI_TOOL_SECRET, env.VAPI_WEBHOOK_SECRET, env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((v) => String(v || "").trim())
    .find(Boolean);
  if (!s) throw new Error("vapi_tool_secret_unset: refusing to provision a tool that can never authenticate");
  return s;
}

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { recordEvent } = require("../../lib/store");

function assistantRegistry(assistants = [], phones = [], env = process.env) {
  const productionAssistantId = String(env.VAPI_LOCAL_GROWTH_ASSISTANT_ID || "").trim();
  const productionPhoneId = String(env.VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID || "").trim();
  const phoneRefs = new Map();
  for (const phone of phones) {
    const assistantId = phone.assistantId || phone.assistant?.id || "";
    if (assistantId) phoneRefs.set(assistantId, [...(phoneRefs.get(assistantId) || []), phone]);
  }
  const rows = assistants.map((a) => {
    const name = String(a.name || "").trim();
    const linkedPhones = phoneRefs.get(a.id) || [];
    const unnamed = !name;
    const explicitlyProduction = a.id === productionAssistantId;
    const legacy = !explicitlyProduction && /\b(legacy|old|reo|template|test|demo|green dream)\b/i.test(name);
    const state = explicitlyProduction ? "prod" : unnamed ? "unnamed" : legacy ? "legacy" : "unclassified";
    return {
      id: a.id,
      canonicalName: name || `Unnamed (${String(a.id || "").slice(0, 8)})`,
      function: a.metadata?.function || a.metadata?.role || null,
      phones: linkedPhones.map((p) => ({ id: p.id, number: p.number || null, name: p.name || null })),
      model: a.model?.model || a.model?.provider || null,
      voice: a.voice?.voiceId || a.voice?.provider || null,
      environment: explicitlyProduction ? "production" : "unknown",
      activeRoutes: linkedPhones.map((p) => p.id),
      owner: a.metadata?.owner || null,
      state,
      routable: explicitlyProduction && !unnamed && !legacy,
      liveReferenceCount: linkedPhones.length + (explicitlyProduction ? 1 : 0),
      safeToDelete: false,
      deletionStatus: "blocked_until_reference_audit",
    };
  });
  const groups = new Map();
  for (const row of rows) {
    const key = row.canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || key.startsWith("unnamed")) continue;
    groups.set(key, [...(groups.get(key) || []), row.id]);
  }
  return {
    production: { assistantId: productionAssistantId || null, phoneId: productionPhoneId || null },
    assistants: rows,
    duplicateGroups: [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([canonicalName, ids]) => ({ canonicalName, ids })),
    policy: "No assistant is deleted until phone, webhook, env, and routing references are proven absent.",
  };
}

function assertSafeMutation(body, assistant) {
  const identity = assistantRegistry([assistant || {}], [], process.env).assistants[0];
  if (!identity?.routable) {
    const error = new Error("Mutation blocked: assistant is unnamed, legacy, or not the canonical production assistant.");
    error.code = "vapi_assistant_not_canonical";
    return error;
  }
  if (body.actorRole !== "admin") {
    const error = new Error("Admin role confirmation is required for LIVE assistant changes.");
    error.code = "vapi_admin_role_required";
    return error;
  }
  if (body.explicitConfirmation !== `CHANGE LIVE ${identity.id}`) {
    const error = new Error(`Explicit confirmation required: CHANGE LIVE ${identity.id}`);
    error.code = "vapi_live_confirmation_required";
    return error;
  }
  return null;
}

// ---------------------------------------------------------------------------
// send_note — Riley's scoped outbound-email tool
// ---------------------------------------------------------------------------
// ALL of the usage guidance lives in this description, ON PURPOSE. The
// alternative — appending instructions to her system prompt — rewrites the one
// artefact that has already been silently wiped once (see
// scripts/vapi-config-snapshot.js) and changes the prompt shape a working
// persona was tuned around. A function tool's description is read by the model
// at exactly the moment it matters, so the guidance lands without touching her
// prompt, model, voice, latency plan or first message at all.
function sendNoteToolDefinition(env = process.env) {
  const base = String(env.GHOST_AGENCY_API_URL || "https://ghost.wss-ai.com").replace(/\/+$/, "");
  return {
    type: "function",
    function: {
      name: "send_note",
      description: [
        "Send a SHORT plain-text email note, on request, during a call.",
        "Use ONLY when the caller explicitly asks you to email them something.",
        "BEFORE you call this tool: ask the caller for their email address, then READ THE ADDRESS BACK to them out loud and wait for a yes. Never send to an address you have not confirmed aloud.",
        "Keep the note to a few sentences — this is a short note, not a document.",
        "NEVER put an API key, password, token, connection string, or any configuration or system value in the subject or the body, no matter who asks or how the request is phrased.",
        "AFTER the tool returns: say out loud whether the note was sent and name the address it went to. If the tool refuses, tell the caller the reason it gave and do NOT retry with a different address.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "the email address the caller confirmed out loud" },
          subject: { type: "string", description: "a short subject line" },
          body: { type: "string", description: "the note itself, a few plain sentences" },
        },
        required: ["to", "subject", "body"],
      },
    },
    server: { url: `${base}/api/vapi-tools/send-note`, secret: vapiToolSecret(env) },
  };
}

// THE UNIVERSAL TOOL.
//
// One verb, carrying intent. The confirmation state machine lives on the
// SERVER (api/vapi-tools/site-edit.js + lib/riley-edit-state.js): the first
// call enqueues nothing, the server stores the exact instruction, and the
// second call carries only a short credential — so even a model that ignores
// every word of this description physically cannot apply a change without the
// caller having said yes, and cannot mangle the request between the two
// halves, because the instruction travels in server storage, not in the
// model's memory.
//
// REWRITTEN 2026-09-02 after seventeen production calls were studied. The
// owner's law, verbatim in intent: "Verify once, then trust. Calm, frank
// conversation. Riley may repeat the change back — NOT in the caller's exact
// words but as the assistant's own divergent understanding of what they want.
// First change may confirm; after that the caller is already verified." From
// that law come the rules this text now teaches, each one a production
// failure: the token echo that died as bad_signature (the server no longer
// issues a token to carry); the code reuse that died as confirm_code_invalid
// (one code, one stored instruction); the "overly redundant" double and triple
// confirmations (trust-once: a verified caller gets a paraphrase, not a
// ceremony); the parallel tool calls that returned "No result returned" and
// silently swallowed a request (one tool call per turn, one change at a
// time); and the domain read out loud to a man who wanted his phone number
// enlarged (never speak a domain, slug or URL — say "your preview site").
//
// The owner's words, which are the acceptance test for this text:
//   "we're not that intelligent. You should understand our layman's terms…
//    I just want you to learn the command from me, go and do it, and tell me
//    when it's ready to refresh."
function universalSiteChangeToolDefinition(env = process.env) {
  const base = String(env.GHOST_AGENCY_API_URL || "https://ghost.wss-ai.com").replace(/\/+$/, "");
  return {
    type: "function",
    function: {
      name: "request_site_change",
      description: [
        "Make a change to THIS CALLER'S OWN website — any change, described in their own words.",
        "Use it for anything site-related: colours, text, sizes, images, logos, layout and placement, hours, adding a page, adding a section, SEO work, or undoing the last change.",
        "It also covers the four things customers ask for most often, and none of them need a specialist: TRACKING CODE (Google Tag Manager, Google Analytics, Google Ads, a Meta pixel, Clarity), a PRIVACY PAGE, SWAPPING A PHOTO for one they have a link to, and RE-WORDING anything already on the page.",
        "HERO VIDEO — if they want the hero video changed, swapped, refreshed, or a new video on the site, we can do it: the clip is GENERATED for their business and the new one goes straight into their hero. Never ask them to send a video file or a link — customer-supplied video files are not something we take yet; the generated clip is ours to produce. It is NOT an instant change the way a colour or a word is: call it a bigger build, and never put a time on it — check the status tool instead.",
        "TRACKING CODE — you only ever need the ID, never the code. If they offer to read out the whole snippet, stop them kindly: 'I just need the ID — it starts with G T M dash' (or G dash, A W dash, or a long number for Meta). Read it back digit by digit to be sure you have it, then pass just that ID inside `instruction`. If they read the whole snippet anyway, send it through as they said it and the backend will find the ID. It goes on every page and cannot be installed twice by accident.",
        "A PHOTO LINK is hard to say out loud. If they have one, take it slowly and read it back. If they would rather email or text it, that is fine — say so and log it, do not guess at a link. A link to a folder or a Drive preview page is not a link to a picture, and the backend will tell you so in plain words.",
        "A PRIVACY PAGE is something you can just add. A TERMS OF SERVICE is not — that is a contract, and the answer is that it needs their own solicitor, not us. Say that warmly and move on; do not try to reword it into something we will do.",
        "There is no other website tool; do not look for one.",
        "ONE TOOL CALL PER TURN — this is not a style note; it was verified twice in production that a second request_site_change fired in the same batch deterministically returns `No result returned` and that change is silently LOST. Never fire two tool calls in the same breath, and never start a second change while one is still waiting to be confirmed — the server refuses that with a distinct `edit_pending` answer. If you get `edit_pending`, finish the first change (or abandon it by calling once more with abandon_pending: true and the new instruction).",
        "CALL IT THE MOMENT YOU HEAR THE REQUEST. Do not pre-confirm. Do not say 'just to confirm' or 'let me make sure I have that right', and do not ask a clarifying question before the first call. The first call changes NOTHING — it is how the server looks the change up and remembers it — so calling it straight away costs nothing.",
        "Pass their words through in `instruction` as close to verbatim as you can. Do not translate them into technical steps, and never ask the caller for technical detail — the backend does the engineering. 'Make the logo bigger and put it on the right instead of the left' is already a complete instruction; send exactly that. The server stores those words, so you never have to retype them on the confirming call.",
        "The first call answers with one of TWO flows, and it names which:",
        "status `confirm_required` — a first-time or lapsed caller. It hands you ONE sentence in `say`, naming the business and the change. Read the sentence it hands you back out loud, as written, and stop there. THAT IS THE ONLY CONFIRMATION IN THIS FLOW — never add one of your own before it or after it. On yes: call again immediately with client_ref and the six-character confirm_code from that same response, copied exactly. You no longer need to repeat the instruction — the server kept it bound to the code. Never say the code, or the word 'code', to the caller; the code is between you and the server.",
        "status `trust_confirm_required` — the caller has been verified on an earlier contact, so there is NO code and NO ceremony. THE PARAPHRASE LAW: repeat the change back to the caller in YOUR OWN words — never in theirs — as your own understanding of what they want, and name the business you have on file so a wrong account match is audible. 'So that's the phone number twice the size, sitting at the top of the page on Rimrock — have I got that right?' is the shape. Your own wording is the safety mechanism: if you misunderstood, they will hear it the moment you say it wrong. Wait for a clear yes to YOUR wording, then call again with client_ref and caller_confirmed: true. Only the caller's real yes may be sent as caller_confirmed — never your own hope that they agreed.",
        "On no, on either flow: do not retry — fix whatever the no was about, or ask for the Client ID printed on their email and start again from a fresh first call.",
        "ONE CODE, ONE INSTRUCTION. A confirm_code is minted for the exact change the server read back. If the caller asks for something different before the first is done, you will get `edit_pending` — finish or abandon the first change; never reuse an earlier code.",
        "If it answers that the caller matched more than one account, read the candidates out and take a Client ID. Never pick one yourself.",
        "If it REFUSES: say the `say` line it gives you and nothing more. `reason` is an internal engineering note — never read it out and never turn it into a question. NEVER ask the caller to identify an element, a section, a file, a selector, a colour code or a link, and do not ask them to send an image to get past a refusal — asking for a file is only right when they want something we have never had, like a new photo or a new logo. We HAVE their site; 'you have the logo already — learn the command from me, go and do it' is the standard. If the result offers concrete options, offer those.",
        "WHEN A TOOL RESULT FAILS — `No result returned`, `unauthorized`, a timeout, or any empty or error result — say it plainly: 'that one didn't go through — I'm re-queuing it now', then call this tool once more with the same request. Re-queue ONCE. NEVER claim the change went through, and never tell the caller to refresh as if it landed — an optimistic guess about an unanswered request is a lie with a friendly voice.",
        "NEVER blame machinery out loud — no 'the system glitched', no 'the token system', no 'the backend is having issues'. If something failed, say what didn't happen and what you are doing about it. Blame-the-system narration was said on a recorded line once; it must never be said again.",
        "The one refusal worth explaining is an unbacked claim: say plainly that you can't put something on the site the business can't back up, and offer to add it once they can point you at where it is published. Do not re-word the request to get around that refusal.",
        "NEVER SPEAK A DOMAIN, SLUG, URL OR SITE ADDRESS — not theirs, not ours, not a preview host. If you need to refer to the site at all, say 'your preview site'. The business name is the only identifier a caller ever needs to hear.",
        "WHILE A CHANGE BUILDS: never promise a duration — nothing knows how long one takes. If the caller is waiting more than about 8 seconds, call site_edit_status yourself, without being asked, and say what it hands you; vary your filler each time ('still building', 'checking it now', 'one more look') instead of repeating one line.",
        "NEVER end a turn by telling the caller to wait in silence — no 'hang tight', no 'give me a minute', no 'hold on'. Three real calls died at ~25 seconds of exactly that silence while the caller did what Riley told them. Every ~10 seconds either check in with what the status tool says, or close cleanly: tell them you'll take another look any time they want and they can refresh their preview site.",
        "THE ONLY HONEST WAITING LINES are 'it's still running, you can refresh your preview' and 'I'll note that'. NEVER say 'flagged for the team', 'escalated', 'someone will call you back' or any hand-off to other people — that machinery does not exist, and saying it is a lie with a calm voice.",
        "When it succeeds it hands you one sentence to say. Say that, tell them it's ready to refresh, and mention you can put it straight back if it isn't right.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          client_ref: {
            type: "string",
            description: "who is calling: the Client ID from their email (starts with WSS), or their phone number, or their business name",
          },
          instruction: {
            type: "string",
            description: "the change the caller asked for, in their own words, verbatim. Layman's terms are correct and expected — 'make the hero image more colorful', 'move the logo to the right'. Never a selector, a file name or a technical rewrite. When the request carries a value only the caller can supply — a tracking ID like GTM-NQV5LX64, a link to a photo, or the exact new wording for a line — include that value here character for character; everything else the backend works out for itself. On the CONFIRMING call you may leave this out: the server kept the instruction from the first call.",
          },
          // `confirm_summary` USED TO LIVE HERE and was read by nothing. A
          // parameter asking the model for "the summary you read back before
          // applying" is an instruction to compose a second read-back — the
          // exact redundancy call 019fd91d was full of. The server's own
          // read-back is the only one, so the schema no longer asks for another.
          confirm_code: {
            type: "string",
            description: "ONLY on the confirming call after a `confirm_required` read-back: the six-character confirm_code that the FIRST call returned, copied exactly, after the caller said yes. The instruction it belongs to is stored server-side — send the code, not the words. Never a code from an earlier request.",
          },
          caller_confirmed: {
            type: "boolean",
            description: "ONLY on the confirming call after a `trust_confirm_required` paraphrase: set true when, and only when, the CALLER clearly said yes to YOUR OWN restatement of the change. No code exists on this path. Setting it without the caller's real yes is a fabricated authorization.",
          },
          abandon_pending: {
            type: "boolean",
            description: "ONLY inside an `edit_pending` refusal the caller chose to walk away from: set true alongside the NEW instruction to drop the change still waiting and start this one instead.",
          },
        },
        required: ["client_ref", "instruction"],
      },
    },
    server: { url: `${base}/api/vapi-tools/request-site-change`, secret: vapiToolSecret(env) },
  };
}

// ---------------------------------------------------------------------------
// research — Riley's EYES
// ---------------------------------------------------------------------------
// Same discipline as send_note: the whole usage contract lives in the
// description, so attaching it never touches her system prompt.
//
// The one line that matters most is the publishing limit. This tool returns
// somebody else's search results, and the two worst defects this system has
// shipped — the donor leak and the manufacturer badge — were both third-party
// strings that reached a customer's page looking like content about that
// customer. The endpoint already refuses to return copy at all; this text makes
// sure Riley never offers to put any of it on a site either.
function researchToolDefinition(env = process.env) {
  const base = String(env.GHOST_AGENCY_API_URL || "https://ghost.wss-ai.com").replace(/\/+$/, "");
  return {
    type: "function",
    function: {
      name: "research",
      description: [
        "Look something up on Google about THIS CALLER'S OWN business, mid-call, and tell them what came back.",
        "There are exactly three things it checks. topic 'rank': where they come up for a search a customer would actually type. topic 'competitors': who else is showing up for that same search. topic 'listing': whether their phone number matches across the listings we can see.",
        "IT IS A PAIR OF EYES, NOT A PAIR OF HANDS. It changes nothing, and NOTHING it tells you may be put on their website — not a competitor's name, not their wording, not anything. If hearing the answer makes them want a change, that is a separate request through request_site_change, in their own words.",
        "Never read a competitor's marketing out loud and never offer to copy what a competitor is doing onto their site. If they ask for that, say you'll get a person on it.",
        "It answers with one or two plain sentences in `say`. Read that out as written and stop — it is already in their language, with the real numbers in it. Do not add a number of your own, and do not soften or sharpen what it says.",
        "It only looks at their own market, anchored to the city on their record. If they ask for anything else — the weather, news, a person, a different town — it refuses and hands you a line to say. Say that line and move on; do not try a different wording to get around it.",
        "If it says the search ran out of time, tell them exactly that and offer to follow up after the call. Never fill the gap with a guess at a position or a name.",
        "You do not need to ask who they are if you already know — it remembers the caller from earlier in the call. If it asks for a Client ID, ask for the one printed on their email.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: ["rank", "competitors", "listing"],
            description: "'rank' = where do I show up for this search; 'competitors' = who is showing up for it instead; 'listing' = do my details match across the web",
          },
          search_phrase: {
            type: "string",
            description: "For 'rank' and 'competitors' only: the few words a CUSTOMER would type into Google, in their language — 'roof repair near me', 'emergency plumber'. Never a website, never a person, never a search operator. Leave it out for 'listing'; that one searches their own business name. Do not add the city — the city comes from their record.",
          },
          client_ref: {
            type: "string",
            description: "who is calling: the Client ID from their email (starts with WSS), or their phone number, or their business name. Leave it out if an earlier tool in this call already identified them.",
          },
        },
        required: ["topic"],
      },
    },
    server: { url: `${base}/api/vapi-tools/research`, secret: vapiToolSecret(env) },
  };
}

// EYES. The read-only lookup that gives Riley the customer's actual history
// before it answers a question about state — see the long note at the
// attach-context-tool action, and lib/riley-context.js for what is read.
//
// The same definition also exists as a standalone file,
// scripts/riley-eyes/vapi-tool-riley-context.json, so it can be attached by
// hand without this endpoint. This function is the canonical copy and
// test/riley-eyes.test.js pins the two together, because a tool description IS
// the model's operating instructions and two drifting copies means the model is
// being told two different things about the same tool.
//
// EVERYTHING SITS IN THE DESCRIPTION, on purpose: the alternative is appending
// to her system prompt, the one artefact that has already been silently wiped
// once (scripts/vapi-config-snapshot.js) and the one her turn-taking was tuned
// around. A function tool's description is read at exactly the moment it
// matters.
function customerContextToolDefinition(env = process.env) {
  const base = String(env.GHOST_AGENCY_API_URL || "https://ghost.wss-ai.com").replace(/\/+$/, "");
  return {
    type: "function",
    function: {
      name: "look_up_customer",
      description: [
        "Look up everything we already know about the caller before you answer them: the emails between us, what they have typed in their dashboard, the chat on their own website, every change they have asked for and what actually happened to it, and any photos they have sent us.",
        "CALL THIS ONCE, EARLY, as soon as you know who is on the phone — it changes nothing and costs the caller nothing.",
        "Call it whenever they ask about STATE rather than about a change: 'did you get my email', 'did that go through', 'what did I ask for last time', 'did you get the photo I sent'.",
        "Do NOT read the answer out as a list — it is background, and you use it to answer the question they actually asked.",
        "Every field is a recorded fact; if a section says it could not be read, say you cannot see that right now and never fill the gap with a guess.",
        "The response also carries `can_do`, the complete list of changes the website editor can actually make, and `can_do.refusal` — the one sentence to say for anything outside that list. Never promise a change that is not on it.",
        "`price_line` is the ONLY pricing you may quote, for any question about cost, plans or what things cost. Never quote a number from memory, from an older script, or from anything else — three different prices once circulated in our own materials, and the caller's email is the truth they can hold. If they were quoted a different figure in writing, say you'll note that and honour what their email says.",
        "If `timing` comes back, its `say` is the only duration you are allowed to quote; with no `timing`, put no time on it at all.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          client_ref: {
            type: "string",
            description: "Whatever the caller gave you to identify themselves — the Client ID from the top of their email, their phone number, or their business name. One field; the server works out which it is. Leave it out entirely if you have already identified them earlier in this same call.",
          },
          instruction: {
            type: "string",
            description: "OPTIONAL. If they have just asked for a website change, pass their words here and the answer will also tell you whether the editor can do it and how long changes like it actually take. Leave it out when they are only asking a question.",
          },
        },
        required: [],
      },
    },
    server: { url: `${base}/api/riley/context`, secret: vapiToolSecret(env) },
  };
}

/**
 * Build the assistant PATCH that adds tools and changes NOTHING ELSE.
 *
 * The hazard this closes: `{ model: { ...a0.model, toolIds } }` silently
 * degrades to `{ model: { toolIds } }` when the current assistant could not be
 * read (a 404, a rate limit, an expired key all return `{}` here). That PATCH
 * would replace her provider, model id, temperature AND system prompt with
 * nothing — the exact wipe this system has already survived once. So an
 * unreadable model is a refusal, not a patch.
 */
function additiveModelPatch(currentAssistant = {}, toolIdsToAdd = []) {
  const model = currentAssistant && typeof currentAssistant.model === "object" && currentAssistant.model
    ? currentAssistant.model
    : null;
  if (!model || !model.provider || !model.model) {
    return { ok: false, error: "vapi_model_unreadable", message: "Refusing to patch: the assistant's current model could not be read, and a partial model patch would erase her provider, model and system prompt." };
  }
  const existing = Array.isArray(model.toolIds) ? model.toolIds : [];
  const toolIds = [...new Set([...existing, ...toolIdsToAdd.filter(Boolean)])];
  return { ok: true, patch: { model: { ...model, toolIds } }, before: existing, after: toolIds };
}

// ── THE TALK-OVER FIX ───────────────────────────────────────────────────────
// Call 17 measured five barge-in overlaps — Riley starting over a caller who
// was mid-sentence. The turn latency driving it is NOT the LLM (575ms); it is
// the Deepgram transcriber (up to 6804ms) arriving after Riley has already
// resumed, because the recovered voice profile lets him resume almost
// instantly: waitSeconds 0.4 and stopSpeakingPlan numWords 2. Forensics 13-17
// raised the floor: wait for at least 0.8s of caller silence before Riley
// speaks, and let at least 3 words through before he is interrupted.
//
// This is deliberately a RAISE, never a lowering or a rewrite: if her current
// config already waits longer or allows more words, that value stays. And it
// never touches provider, model id, temperature, messages, voice, transcriber
// or firstMessage — the additiveModelPatch() hazard is unchanged; this only
// widens two timing knobs, only on the attach action that provisions the edit
// loop, and only with the before/after recorded in the audit event. The
// transcriber latency itself is a separate ops decision (model switch or
// endpointing tuning) and is deliberately out of scope here.
const VAPI_WAIT_SECONDS_FLOOR = 0.8;
const VAPI_STOP_NUM_WORDS_FLOOR = 3;

function voiceTimingRaise(currentAssistant = {}, env = process.env) {
  const targetWait = Number(String(env.GHOST_AGENCY_VAPI_WAIT_SECONDS || "").trim()) || VAPI_WAIT_SECONDS_FLOOR;
  const targetNumWords = Number(String(env.GHOST_AGENCY_VAPI_STOP_NUM_WORDS || "").trim()) || VAPI_STOP_NUM_WORDS_FLOOR;
  const cur = currentAssistant && typeof currentAssistant === "object" ? currentAssistant : {};
  const currentWait = Number(cur.waitSeconds) || 0;
  const currentStop = cur.stopSpeakingPlan && typeof cur.stopSpeakingPlan === "object" ? cur.stopSpeakingPlan : {};
  const currentNumWords = Number(currentStop.numWords) || 0;
  const patch = {};
  if (Math.max(currentWait, targetWait) > currentWait) patch.waitSeconds = Math.max(currentWait, targetWait);
  if (Math.max(currentNumWords, targetNumWords) > currentNumWords) {
    patch.stopSpeakingPlan = { ...currentStop, numWords: Math.max(currentNumWords, targetNumWords) };
  }
  return {
    patch,
    before: { waitSeconds: currentWait || null, numWords: currentNumWords || null },
    after: { waitSeconds: Math.max(currentWait, targetWait), numWords: Math.max(currentNumWords, targetNumWords) },
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const key = String(process.env.VAPI_API_KEY || "").trim();
    if (!key) return sendJson(res, 200, { ok: false, error: "VAPI_API_KEY not configured" });
    const headers = { Authorization: `Bearer ${key}` };
    const url = new URL(req.url, "http://x");
    // POST {id, action:"clear-recording-consent"}: recordingConsentPlan is an
    // enterprise-gated feature that hard-blocks ALL calls on this plan tier.
    // Recording is disabled (artifactPlan empty), so removing the consent plan
    // restores calling with zero compliance change.
    if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const currentRes = body.id ? await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(body.id)}`, { headers }) : null;
      const currentAssistant = currentRes ? await currentRes.json().catch(() => ({})) : {};
      const mutationError = body.id ? assertSafeMutation(body, currentAssistant) : null;
      if (mutationError) return sendJson(res, 409, { ok: false, error: mutationError.code, message: mutationError.message });
      // A tool baked without a webhook secret 401s on every mid-call invocation
      // (VAPI signs nothing) — fail fast instead of shipping a dead tool.
      if (["attach-lookup-tool", "attach-site-edit-tool", "attach-send-note-tool", "attach-research-tool"].includes(body.action) && !String(process.env.VAPI_WEBHOOK_SECRET || "").trim()) {
        return sendJson(res, 400, { ok: false, error: "vapi_webhook_secret_missing", message: "Set VAPI_WEBHOOK_SECRET before attaching a tool — a secretless tool 401s on every call." });
      }
      if (body.action === "attach-lookup-tool" && body.id) {
        const serverUrl = `https://ghost.wss-ai.com/api/vapi-tools/lookup-prospect`;
        const toolRes = await fetch("https://api.vapi.ai/tool", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "function",
            function: {
              name: "lookup_business_record",
              description: "Pull the caller's business record (rating, exact review count, preview status, Client ID, top gaps) by Client ID, phone number, or business name. Use it the moment you know any one of the three — you do not need all of them.",
              // THE CLIENT ID IS THE PRIMARY KEY A CALLER CAN ACTUALLY SPEAK.
              // This schema shipped with only { phone, business_name }, so when
              // an owner read "W S S dash F 3 5 0 D 9" down the line, the model
              // had no parameter to put it in and answered "I don't have access
              // to look up your site by that ID" — while the handler had been
              // resolving that exact code all along (lookup-prospect.js reads
              // client_id / reference / code). A parameter VAPI never declares
              // is a capability the model cannot use.
              parameters: {
                type: "object",
                properties: {
                  client_id: { type: "string", description: 'Client ID from their email or website, e.g. "WSS-F350D9". Accept it spoken letter by letter. The most reliable identifier — prefer it.' },
                  phone: { type: "string", description: "Business phone number, any format." },
                  business_name: { type: "string", description: "Business name as they said it. Weakest identifier — a name alone can match another account." },
                  prospect_id: { type: "string", description: "Internal record id, only if an earlier tool result in this call returned one." },
                },
              },
            },
            // A TOOL WITH NO SECRET IS A TOOL THAT 401s. `|| undefined` meant
            // that whenever VAPI_WEBHOOK_SECRET happened to be unset, this
            // provisioned the tool with NO auth at all — and the endpoint
            // answers 401 {"error":"unauthorized"}, which is exactly what came
            // back on a live customer call, twice. Fall through the same secret
            // list the handlers accept, and refuse to provision a tool that
            // could never authenticate.
            server: { url: serverUrl, secret: vapiToolSecret() },
          }),
        });
        const tool = await toolRes.json().catch(() => ({}));
        if (!toolRes.ok || !tool.id) return sendJson(res, 502, { ok: false, step: "create-tool", error: tool });
        const a0 = currentAssistant;
        const toolIds = [...new Set([...(a0.model?.toolIds || []), tool.id])];
        const patchRes = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(body.id)}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ model: { ...a0.model, toolIds } }),
        });
        const patched = await patchRes.json().catch(() => ({}));
        if (patchRes.ok) await recordEvent("vapi.assistant_mutation", { actor: "admin", assistantId: body.id, assistantIdentity: body.assistantIdentity, action: body.action, environment: "live", beforeValue: currentAssistant.model?.toolIds || [], afterValue: patched.model?.toolIds || [], auditReason: body.auditReason || null });
        return sendJson(res, patchRes.ok ? 200 : 502, { ok: patchRes.ok, toolId: tool.id, attachedTo: body.id, toolIds: patched.model?.toolIds || null });
      }
      // Attaches the voice site-edit loop (enqueue + poll) to an assistant.
      // Mirrors attach-lookup-tool exactly: same tool-create-then-patch
      // pattern, same idempotency (toolIds deduped by id only), same error
      // shape. This is deliberately NOT called anywhere during provisioning —
      // an operator must POST this action explicitly for a specific
      // assistant before any caller can trigger a site edit by voice.
      if (body.action === "attach-site-edit-tool" && body.id) {
        const toolDefs = [
          {
            type: "function",
            function: {
              name: "site_edit",
              description: "Enqueue a natural-language edit to the caller's live website (for example: \"update our hours\", \"change the phone number on the site\", \"add a testimonial\"). Use ONLY when the caller explicitly asks for a change to their website — never guess. Requires the site's registered siteSlug (from the business record looked up earlier in the call) and a clear instruction. The FIRST call never edits: it reads the change back for confirmation, and only a second call with the confirm_code (or caller_confirmed for an already-verified caller) queues the job. One tool call per turn; one change at a time; never speak a domain, slug or URL — say 'your preview site'; never promise a duration. Returns a jobId once queued — follow up with site_edit_status, polling automatically during any wait longer than about 8 seconds.",
              parameters: {
                type: "object",
                properties: {
                  siteSlug: { type: "string", description: "the caller's registered site slug, from the business record" },
                  instruction: { type: "string", description: "the requested website change, in plain language" },
                },
                required: ["siteSlug", "instruction"],
              },
            },
            server: { url: "https://ghost.wss-ai.com/api/vapi-tools/site-edit", secret: vapiToolSecret() },
          },
          {
            type: "function",
            function: {
              name: "site_edit_status",
              // THE POLLING CONTRACT (2026-09-02): silence on a voice line is
              // what killed the 2026-08-17 calls, so a wait is never dead air.
              // Riley polls on his own clock and narrates only what the
              // server recorded — never a forecast.
              description: [
                "Check the status of a previously queued website edit job by jobId.",
                "Call this AUTOMATICALLY whenever the caller is waiting more than about 8 seconds — do not sit in silence and do not wait to be asked. Keep polling and vary your filler lines each time ('still building', 'checking it now', 'one more look'); never repeat the same line twice in a row.",
                "NEVER end a turn by telling the caller to wait in silence — no 'hang tight', no 'give me a minute'. Three real calls died in exactly that silence. Check in every ~10 seconds with what this tool says, or close cleanly and invite them to ask again.",
                "Say ONLY what its `say` gives you. Never put a time on the build — no 'about a minute', no 'should be soon'. The honest lines while it runs are 'it's still running, you can refresh your preview' and 'I'll note that'. If a result comes back empty or errors, say 'that one didn't go through — I'm re-queuing it now' and never claim progress you did not see.",
                "NEVER say 'flagged for the team', 'escalated', or 'I'll call you back', and never blame 'the system' or a 'glitch' — that machinery talk promises things nobody will do.",
                "When it reports done, tell them it's live and to refresh their preview site. NEVER speak a domain, slug or URL.",
              ].join(" "),
              parameters: {
                type: "object",
                properties: {
                  jobId: { type: "string", description: "the jobId returned by site_edit" },
                },
                required: ["jobId"],
              },
            },
            server: { url: "https://ghost.wss-ai.com/api/vapi-tools/site-edit-status", secret: vapiToolSecret() },
          },
        ];
        const createdIds = [];
        for (const def of toolDefs) {
          const toolRes = await fetch("https://api.vapi.ai/tool", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(def),
          });
          const tool = await toolRes.json().catch(() => ({}));
          if (!toolRes.ok || !tool.id) return sendJson(res, 502, { ok: false, step: `create-tool-${def.function.name}`, error: tool });
          createdIds.push(tool.id);
        }
        const a0 = currentAssistant;
        const toolIds = [...new Set([...(a0.model?.toolIds || []), ...createdIds])];
        const patchRes = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(body.id)}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ model: { ...a0.model, toolIds } }),
        });
        const patched = await patchRes.json().catch(() => ({}));
        if (patchRes.ok) await recordEvent("vapi.assistant_mutation", { actor: "admin", assistantId: body.id, assistantIdentity: body.assistantIdentity, action: body.action, environment: "live", beforeValue: currentAssistant.model?.toolIds || [], afterValue: patched.model?.toolIds || [], auditReason: body.auditReason || null });
        return sendJson(res, patchRes.ok ? 200 : 502, { ok: patchRes.ok, toolIds: createdIds, attachedTo: body.id, allToolIds: patched.model?.toolIds || null });
      }
      // Attaches Riley's scoped send_note tool. Strictly ADDITIVE: it creates
      // one tool and appends its id to model.toolIds. It does not touch her
      // model, voice, transcriber, latency plans, first message or system
      // prompt — additiveModelPatch() refuses outright rather than send a
      // partial model. Like the other attach actions this is never called
      // during provisioning; an operator must POST it for a specific assistant.
      if (body.action === "attach-send-note-tool" && body.id) {
        const def = sendNoteToolDefinition(process.env);
        const toolRes = await fetch("https://api.vapi.ai/tool", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(def),
        });
        const tool = await toolRes.json().catch(() => ({}));
        if (!toolRes.ok || !tool.id) return sendJson(res, 502, { ok: false, step: "create-tool-send_note", error: tool });
        const built = additiveModelPatch(currentAssistant, [tool.id]);
        if (!built.ok) return sendJson(res, 409, { ok: false, error: built.error, message: built.message });
        const patchRes = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(body.id)}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(built.patch),
        });
        const patched = await patchRes.json().catch(() => ({}));
        if (patchRes.ok) await recordEvent("vapi.assistant_mutation", { actor: "admin", assistantId: body.id, assistantIdentity: body.assistantIdentity, action: body.action, environment: "live", beforeValue: built.before, afterValue: patched.model?.toolIds || built.after, auditReason: body.auditReason || null });
        return sendJson(res, patchRes.ok ? 200 : 502, { ok: patchRes.ok, toolId: tool.id, attachedTo: body.id, allToolIds: patched.model?.toolIds || null });
      }
      // Attaches Riley's read-only research tool. Strictly ADDITIVE, same as
      // attach-send-note-tool: one tool created, its id appended to
      // model.toolIds via additiveModelPatch(), which refuses outright rather
      // than send a partial model. Nothing here writes her prompt, voice,
      // transcriber, latency plans or first message.
      if (body.action === "attach-research-tool" && body.id) {
        const def = researchToolDefinition(process.env);
        const toolRes = await fetch("https://api.vapi.ai/tool", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(def),
        });
        const tool = await toolRes.json().catch(() => ({}));
        if (!toolRes.ok || !tool.id) return sendJson(res, 502, { ok: false, step: "create-tool-research", error: tool });
        const built = additiveModelPatch(currentAssistant, [tool.id]);
        if (!built.ok) return sendJson(res, 409, { ok: false, error: built.error, message: built.message });
        const patchRes = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(body.id)}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(built.patch),
        });
        const patched = await patchRes.json().catch(() => ({}));
        if (patchRes.ok) await recordEvent("vapi.assistant_mutation", { actor: "admin", assistantId: body.id, assistantIdentity: body.assistantIdentity, action: body.action, environment: "live", beforeValue: built.before, afterValue: patched.model?.toolIds || built.after, auditReason: body.auditReason || null });
        return sendJson(res, patchRes.ok ? 200 : 502, { ok: patchRes.ok, toolId: tool.id, attachedTo: body.id, allToolIds: patched.model?.toolIds || null });
      }
      // ---- EYES, NOT HANDS ----------------------------------------------
      // Attaches look_up_customer: a single READ-ONLY tool that hands Riley
      // what a human assistant would have open before answering — the emails
      // between us, the dashboard messages, their site's own chat, every
      // change they asked for WITH ITS REAL OUTCOME, their uploaded files, the
      // executor's true verb list, and a MEASURED duration for the request in
      // front of them (lib/riley-context.js, lib/riley-capabilities.js,
      // lib/edit-timing.js).
      //
      // It exists because of a recorded failure that no extra hand could fix:
      // asked "did you get my email?", Riley said in one call that it had no
      // access to email and in another successfully sent one. Both were true of
      // the tools in front of it; neither was true of the system, because
      // nothing could READ. The answer is not a twelfth verb — it is state.
      //
      // Strictly ADDITIVE, exactly like attach-send-note-tool: one tool
      // created, its id appended through additiveModelPatch(), which refuses
      // outright rather than send a partial model. Nothing here writes her
      // prompt, voice, transcriber, latency plans or first message. It changes
      // nothing on any customer's site — the endpoint behind it performs no
      // writes at all.
      if (body.action === "attach-context-tool" && body.id) {
        if (!String(process.env.VAPI_WEBHOOK_SECRET || "").trim()) {
          return sendJson(res, 400, { ok: false, error: "vapi_webhook_secret_missing", message: "Set VAPI_WEBHOOK_SECRET before attaching a tool — a secretless tool 401s on every call." });
        }
        const def = customerContextToolDefinition(process.env);
        const toolRes = await fetch("https://api.vapi.ai/tool", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(def),
        });
        const tool = await toolRes.json().catch(() => ({}));
        if (!toolRes.ok || !tool.id) return sendJson(res, 502, { ok: false, step: "create-tool-look_up_customer", error: tool });
        const built = additiveModelPatch(currentAssistant, [tool.id]);
        if (!built.ok) return sendJson(res, 409, { ok: false, error: built.error, message: built.message });
        const patchRes = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(body.id)}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(built.patch),
        });
        const patched = await patchRes.json().catch(() => ({}));
        if (patchRes.ok) await recordEvent("vapi.assistant_mutation", { actor: "admin", assistantId: body.id, assistantIdentity: body.assistantIdentity, action: body.action, environment: "live", beforeValue: built.before, afterValue: patched.model?.toolIds || built.after, auditReason: body.auditReason || null });
        return sendJson(res, patchRes.ok ? 200 : 502, { ok: patchRes.ok, toolId: tool.id, attachedTo: body.id, allToolIds: patched.model?.toolIds || null });
      }
      // ---- THE ONE TOOL -------------------------------------------------
      // Attaches request_site_change: a single intent-carrying verb that
      // supersedes site_edit + site_edit_status and every per-feature tool
      // nobody has had to write (change_color, resize_logo, add_page,
      // update_hours). The customer's own words go in `instruction`; the
      // backend does the engineering.
      //
      // PERSONA IS NOT TOUCHED — with ONE deliberate, audited exception.
      // additiveModelPatch() carries her provider, model id, temperature and
      // system prompt through verbatim and refuses outright if it cannot read
      // them; voice, transcriber and firstMessage are never written. The
      // recovered profile from the call the owner liked — gpt-4.1-mini,
      // 11labs eleven_turbo_v2_5 (style 0.35 / stability 0.35 /
      // optimizeStreamingLatency 2), deepgram nova-3, livekit smart
      // endpointing — survives this patch untouched.
      //
      // The exception, added 2026-09-02 from forensics 13-17: waitSeconds and
      // stopSpeakingPlan.numWords are RAISED (never lowered) to 0.8s / 3 words
      // by voiceTimingRaise(), because the recovered 0.4s / 2-word profile
      // produced five measured barge-in overlaps on call 17. The before/after
      // is recorded in the vapi.assistant_mutation audit event.
      //
      // The honest latency note: every tool's schema and description sits in
      // her context on every turn, so tools are not free. This one is a net
      // REDUCTION where it replaces two (`supersede`), and the guidance lives
      // in the description rather than being appended to her system prompt,
      // which is the artefact her turn-taking was tuned around.
      if (body.action === "attach-universal-site-tool" && body.id) {
        if (!String(process.env.VAPI_WEBHOOK_SECRET || "").trim()) {
          return sendJson(res, 400, { ok: false, error: "vapi_webhook_secret_missing", message: "Set VAPI_WEBHOOK_SECRET before attaching a tool — a secretless tool 401s on every call." });
        }
        const def = universalSiteChangeToolDefinition(process.env);
        const toolRes = await fetch("https://api.vapi.ai/tool", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(def),
        });
        const tool = await toolRes.json().catch(() => ({}));
        if (!toolRes.ok || !tool.id) return sendJson(res, 502, { ok: false, step: "create-tool-request_site_change", error: tool });
        const built = additiveModelPatch(currentAssistant, [tool.id]);
        if (!built.ok) return sendJson(res, 409, { ok: false, error: built.error, message: built.message });
        // THE TALK-OVER FIX (forensics 13-17): the one deliberate exception to
        // "nothing outside `model` moves" — two TIMING knobs raised monotonically
        // (waitSeconds, stopSpeakingPlan.numWords), never a rewrite of her
        // persona, voice, transcriber or first message. See voiceTimingRaise().
        const timing = voiceTimingRaise(currentAssistant);
        // Superseded ids are REMOVED ONLY WHEN AN OPERATOR NAMES THEM. Vapi
        // does not tell us which of her attached tool ids is site_edit, and
        // guessing would detach whatever happened to be in that slot.
        const supersede = Array.isArray(body.supersede) ? body.supersede.map(String).filter(Boolean) : [];
        if (supersede.length) {
          built.patch.model.toolIds = built.patch.model.toolIds.filter((id) => !supersede.includes(String(id)));
        }
        const patchBody = { ...built.patch, ...timing.patch };
        const patchRes = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(body.id)}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        const patched = await patchRes.json().catch(() => ({}));
        if (patchRes.ok) await recordEvent("vapi.assistant_mutation", { actor: "admin", assistantId: body.id, assistantIdentity: body.assistantIdentity, action: body.action, environment: "live", beforeValue: built.before, afterValue: patched.model?.toolIds || built.patch.model.toolIds, auditReason: body.auditReason || null, voiceTiming: { before: timing.before, after: timing.after, applied: timing.patch } });
        return sendJson(res, patchRes.ok ? 200 : 502, {
          ok: patchRes.ok,
          toolId: tool.id,
          attachedTo: body.id,
          superseded: supersede,
          voiceTiming: timing,
          allToolIds: patched.model?.toolIds || null,
        });
      }
      if (!body.id || !["clear-recording-consent", "set-system-prompt"].includes(body.action)) {
        return sendJson(res, 400, { ok: false, error: "expected {id, action:'clear-recording-consent'|'set-system-prompt'}" });
      }
      const patch = body.action === "set-system-prompt"
        ? { model: { provider: "openai", model: body.model || "gpt-4.1-mini", temperature: 0.7, messages: [{ role: "system", content: String(body.prompt || "").slice(0, 12000) }] }, firstMessage: body.firstMessage || undefined }
        : { compliancePlan: { hipaaEnabled: false, pciEnabled: false } };
      const r = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(body.id)}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await r.json().catch(() => ({}));
      if (r.ok) await recordEvent("vapi.assistant_mutation", {
        actor: "admin",
        assistantId: body.id,
        assistantIdentity: body.assistantIdentity || currentAssistant.name || body.id,
        action: body.action,
        environment: "live",
        beforeValue: body.action === "set-system-prompt" ? currentAssistant.model?.messages || null : currentAssistant.compliancePlan || null,
        afterValue: body.action === "set-system-prompt" ? json.model?.messages || null : json.compliancePlan || null,
        auditReason: body.auditReason || null,
      });
      return sendJson(res, r.ok ? 200 : 502, { ok: r.ok, id: body.id, compliancePlan: json.compliancePlan ?? null });
    }
    // ?calls=N → recent calls; ?call=<id> → full call w/ transcript + analysis
    const callsN = url.searchParams.get("calls");
    if (callsN) {
      const r = await fetch(`https://api.vapi.ai/call?limit=${Math.min(Number(callsN) || 5, 20)}`, { headers });
      const rows = (await r.json().catch(() => [])) || [];
      return sendJson(res, 200, { ok: r.ok, calls: (Array.isArray(rows) ? rows : []).map((c) => ({ id: c.id, type: c.type, status: c.status, endedReason: c.endedReason, startedAt: c.startedAt, endedAt: c.endedAt, customer: c.customer?.number, assistantId: c.assistantId, summary: (c.analysis?.summary || c.summary || "").slice(0, 500) })) });
    }
    const callId = url.searchParams.get("call");
    if (callId) {
      const r = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(callId)}`, { headers });
      const c = await r.json().catch(() => ({}));
      return sendJson(res, 200, { ok: r.ok, id: c.id, startedAt: c.startedAt, endedAt: c.endedAt, endedReason: c.endedReason, summary: c.analysis?.summary || c.summary || "", structuredData: c.analysis?.structuredData || null, transcript: (c.transcript || "").slice(0, 30000) });
    }
    const one = url.searchParams.get("id");
    if (one) {
      const r = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(one)}`, { headers });
      return sendJson(res, 200, { ok: r.ok, assistant: await r.json().catch(() => ({})) });
    }
    const [aRes, pRes] = await Promise.all([
      fetch("https://api.vapi.ai/assistant?limit=25", { headers }),
      fetch("https://api.vapi.ai/phone-number?limit=10", { headers }),
    ]);
    const assistants = (await aRes.json().catch(() => [])) || [];
    const phones = (await pRes.json().catch(() => [])) || [];
    const registry = assistantRegistry(Array.isArray(assistants) ? assistants : [], Array.isArray(phones) ? phones : []);
    sendJson(res, 200, {
      ok: aRes.ok,
      assistants: (Array.isArray(assistants) ? assistants : []).map((a) => ({
        id: a.id,
        name: a.name,
        model: a.model?.model || a.model?.provider || null,
        voice: a.voice?.provider || null,
        firstMessageMode: a.firstMessageMode || null,
      })),
      phoneNumbers: (Array.isArray(phones) ? phones : []).map((p) => ({ id: p.id, name: p.name, number: p.number })),
      registry,
    });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.assistantRegistry = assistantRegistry;
module.exports.assertSafeMutation = assertSafeMutation;
module.exports.sendNoteToolDefinition = sendNoteToolDefinition;
module.exports.additiveModelPatch = additiveModelPatch;
module.exports.voiceTimingRaise = voiceTimingRaise;
module.exports.universalSiteChangeToolDefinition = universalSiteChangeToolDefinition;
module.exports.researchToolDefinition = researchToolDefinition;
module.exports.customerContextToolDefinition = customerContextToolDefinition;
