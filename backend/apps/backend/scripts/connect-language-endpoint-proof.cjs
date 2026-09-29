"use strict";

/**
 * scripts/connect-language-endpoint-proof.cjs — the REAL endpoints, in
 * production, from outside the process.
 *
 * The unit suite proves the code; the model proof proves the model. This
 * proves the thing a visitor actually touches: POST /api/connect/chat-start on
 * ghost.wss-ai.com with the mirror's own Origin, then the same six-second poll
 * the widget runs, until the assistant's reply lands in the thread. Nothing is
 * mocked, nothing is injected. What it prints is what the visitor would read.
 *
 *   node scripts/connect-language-endpoint-proof.cjs [slug]
 *
 * The takeover deliberately waits out the owner's window (default 30s) before
 * the assistant says anything, so each conversation takes ~40s.
 */

const BASE = process.env.CONNECT_BASE || "https://ghost.wss-ai.com";
const SLUG = process.argv[2] || "wss-test-sears-heating-and-cooling-columbus";
const ORIGIN = `https://${SLUG}.wss-ai.com`;
const POLL_EVERY_MS = 6000;
const GIVE_UP_MS = 150000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(path, body, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

/** One conversation, start to assistant reply. */
async function converse({ label, opener, follow = null }) {
  console.log(`\n================ ${label} ================`);
  console.log(`visitor: ${opener}`);
  const started = await post("/api/connect/chat-start", { slug: SLUG, body: opener });
  if (started.status !== 200 || !started.json.ok) {
    console.log(`FAILED at chat-start: ${started.status} ${JSON.stringify(started.json)}`);
    return { ok: false };
  }
  const token = started.json.token;
  const auth = { "x-connect-visitor-token": token };
  console.log(`thread ${started.json.threadId} started, message ${started.json.messageId}`);

  const seen = new Set();
  const replies = [];
  const beganAt = Date.now();
  let cursor = 0;
  let followSent = false;

  while (Date.now() - beganAt < GIVE_UP_MS) {
    await sleep(POLL_EVERY_MS);
    const polled = await post("/api/connect/chat-poll", { after: cursor }, auth);
    if (polled.status !== 200 || !polled.json.ok) {
      console.log(`poll failed: ${polled.status} ${JSON.stringify(polled.json)}`);
      return { ok: false };
    }
    cursor = polled.json.cursor || cursor;
    for (const message of polled.json.messages || []) {
      if (message.direction !== "outbound" || seen.has(message.id)) continue;
      seen.add(message.id);
      replies.push(message);
      console.log(`\n--- assistant, +${Math.round((Date.now() - beganAt) / 1000)}s ---`);
      console.log(message.body);
      console.log("---");
    }
    if (replies.length && follow && !followSent) {
      console.log(`\nvisitor: ${follow}`);
      const sent = await post("/api/connect/chat-post", { body: follow }, auth);
      if (sent.status !== 200) console.log(`follow-up failed: ${sent.status} ${JSON.stringify(sent.json)}`);
      followSent = true;
      continue;
    }
    if (replies.length && (!follow || followSent) && replies.length >= (follow ? 2 : 1)) break;
  }

  if (!replies.length) {
    console.log("NO ASSISTANT REPLY within the window");
    return { ok: false };
  }
  return { ok: true, replies: replies.map((r) => r.body) };
}

const ENGLISH_DISCLOSURE = /AI assistant/i;
const SPANISH_DISCLOSURE = /inteligencia artificial/i;

function verdict(label, replies, checks) {
  const all = replies.join("\n\n");
  const problems = [];
  for (const [what, pattern, want] of checks) {
    const has = pattern.test(all);
    if (has !== want) problems.push(`${what}: ${want ? "missing" : "present but must not be"} ${pattern}`);
  }
  console.log(problems.length ? `VERDICT ${label}: FAIL — ${problems.join(" | ")}` : `VERDICT ${label}: PASS`);
  return problems.length === 0;
}

async function main() {
  console.log(`base=${BASE} slug=${SLUG}`);
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => ({}));
  console.log(`prod sha=${(health.deployment || {}).gitSha || "?"} env=${(health.deployment || {}).vercelEnv || "?"}`);

  let passes = 0;
  let total = 0;

  const spanish = await converse({
    label: "SPANISH — the exact defect that was reported",
    opener: "Hola, ¿ustedes reparan aire acondicionado? Se me dañó el mío y necesito ayuda.",
    follow: "¿Y cuánto me costaría? Deme un número aproximado por favor.",
  });
  total += 1;
  if (spanish.ok) {
    passes += verdict("SPANISH", spanish.replies, [
      ["Spanish disclosure", SPANISH_DISCLOSURE, true],
      ["English disclosure", ENGLISH_DISCLOSURE, false],
      ["English preamble", /The team is out on a job/i, false],
      ["invented price", /\$\s?\d/, false],
    ]) ? 1 : 0;
  }

  const english = await converse({
    label: "ENGLISH — unchanged",
    opener: "Hi, do you repair air conditioning? Mine stopped working.",
    follow: "Roughly what would that cost me?",
  });
  total += 1;
  if (english.ok) {
    passes += verdict("ENGLISH", english.replies, [
      ["English disclosure", ENGLISH_DISCLOSURE, true],
      ["Spanish disclosure", SPANISH_DISCLOSURE, false],
    ]) ? 1 : 0;
  }

  // A visitor who switches language must be disclosed to again, in the new
  // language — once. This is the only case the unit suite cannot fully prove,
  // because it depends on the language being stamped on the stored message and
  // read back on the next turn.
  const switched = await converse({
    label: "SWITCH — English first, then Spanish",
    opener: "Hi there, do you service furnaces?",
    follow: "Perdón, mejor en español: ¿reparan calderas también?",
  });
  total += 1;
  if (switched.ok && switched.replies.length >= 2) {
    const first = switched.replies[0];
    const second = switched.replies.slice(1).join("\n\n");
    const problems = [];
    if (!ENGLISH_DISCLOSURE.test(first)) problems.push("first reply did not disclose in English");
    if (!SPANISH_DISCLOSURE.test(second)) problems.push("the Spanish turn was not disclosed to in Spanish");
    if (ENGLISH_DISCLOSURE.test(second)) problems.push("the Spanish turn carried the English disclosure again");
    console.log(problems.length ? `VERDICT SWITCH: FAIL — ${problems.join(" | ")}` : "VERDICT SWITCH: PASS");
    if (!problems.length) passes += 1;
  } else if (switched.ok) {
    console.log("VERDICT SWITCH: FAIL — the second turn never got a reply");
  }

  console.log(`\n${passes}/${total} conversations passed`);
  process.exit(passes === total ? 0 : 1);
}

main().catch((error) => {
  console.error(`threw: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
