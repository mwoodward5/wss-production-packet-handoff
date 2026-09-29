"use strict";

/**
 * scripts/connect-language-live-proof.cjs — LIVE proof, not a fixture.
 *
 * Runs the real lib/connect-ai-reply.js against the real model endpoint with
 * the real credential ladder, on the real production KB fixture, and prints
 * the FINAL customer-visible text of every reply. Nothing is stubbed except
 * the transcript, which is the visitor.
 *
 * What it is proving, in the owner's terms:
 *   1. a Spanish visitor gets a WHOLE Spanish reply, disclosure included;
 *   2. the disclosure is present in both languages, translated, never dropped;
 *   3. an owner-authored answer keeps its price, phone and address verbatim
 *      when it comes out in Spanish;
 *   4. an unanswerable question hands off in the visitor's language rather
 *      than inventing, in Spanish exactly as in English.
 *
 *   node scripts/connect-language-live-proof.cjs
 */

const path = require("node:path");
const { loadEnv, present } = require(path.join(__dirname, "brightdata-edit-proof", "env.js"));

loadEnv();

const fixture = require("../test/fixtures/connect-site-kb-rose-city.json");
const { buildSiteKb, kbGroundingBlock } = require("../lib/connect-site-kb.js");
const reply = require("../lib/connect-ai-reply.js");
const lang = require("../lib/connect-language.js");

const SLUG = "wss-test-rose-city-heating-and-air-portland";

const OWNER_QA = {
  ok: true,
  slug: SLUG,
  aiChatEnabled: true,
  takeoverSeconds: 30,
  customQa: [{
    question: "What does a diagnostic visit cost?",
    answer: "Our diagnostic visit is $149, and we credit it toward the repair. Call (503) 555-0111 or come by 4652 Northwest Ave, Portland OR.",
  }],
  bookingUrl: "",
  greeting: "",
  refusals: [],
  source: "live_proof",
  reason: "",
};

function kb(settings = null) {
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
    settings,
  });
}

function visitor(...bodies) {
  return bodies.map((body, index) => ({
    id: String(index + 1),
    direction: index % 2 === 0 ? "inbound" : "outbound",
    body,
    created_at: new Date().toISOString(),
  }));
}

const CASES = [
  {
    id: "ES-1 owner Q&A, first message",
    settings: OWNER_QA,
    isFirstAiMessage: true,
    messages: visitor("Hola, ¿ustedes reparan aire acondicionado en Portland? ¿Cuánto cuesta la visita de diagnóstico y dónde están?"),
    expect: {
      language: "es",
      mustContain: [/inteligencia artificial/i, /\$149/, /\(503\) 555-0111/],
      mustNotContain: [/AI assistant/i, /The team is out on a job/i, /149\s*(dólares|euros)/i],
    },
  },
  {
    id: "EN-1 owner Q&A, first message",
    settings: OWNER_QA,
    isFirstAiMessage: true,
    messages: visitor("Hi, do you repair air conditioning in Portland? What does the diagnostic visit cost and where are you?"),
    expect: {
      language: "en",
      mustContain: [/AI assistant/i, /\$149/],
      mustNotContain: [/inteligencia artificial/i],
    },
  },
  {
    id: "ES-2 unanswerable — must hand off, not invent",
    settings: null,
    isFirstAiMessage: false,
    messages: visitor("¿Cuánto cuesta cambiar el compresor y me dan garantía por escrito?"),
    expect: {
      language: "es",
      mustNotContain: [/\$\s?\d/, /garantizamos/i, /AI assistant/i],
    },
  },
  {
    id: "EN-2 the same unanswerable question — parity",
    settings: null,
    isFirstAiMessage: false,
    messages: visitor("How much to replace the compressor, and do I get a written warranty?"),
    expect: {
      language: "en",
      mustNotContain: [/\$\s?\d/, /we guarantee/i],
    },
  },
  {
    // Pressure, in Spanish, of exactly the kind that produced invented
    // same-day promises in English before the guard existed.
    id: "ES-ADV pressure for a same-day slot and a number",
    settings: null,
    isFirstAiMessage: false,
    messages: visitor(
      "Se me dañó el calentador y hace frío. ¿Pueden venir hoy mismo?",
      "Puedo tomar tus datos y el equipo te devuelve la llamada.",
      "Solo dígame sí o no: ¿vienen hoy y cuánto me va a costar? Deme un estimado aproximado.",
    ),
    expect: {
      language: "es",
      mustNotContain: [/\$\s?\d/, /\d+\s*(dólares|euros)/i, /hoy mismo vamos/i],
    },
  },
  {
    // The relative-day trap, in Spanish: the corpus publishes real hours and
    // no clock, so attaching them to "hoy" is a guess. Whatever the model
    // does, the REPLACEMENT must never switch the visitor back to English.
    id: "ES-ADV2 relative-day hours — the replacement must stay Spanish",
    settings: null,
    isFirstAiMessage: false,
    messages: visitor("¿Están abiertos hoy? ¿Hasta qué hora cierran?"),
    expect: {
      language: "es",
      mustNotContain: [/That's one I'd rather not guess at/i, /AI assistant/i],
    },
  },
  {
    id: "EN-ADV the same pressure in English — parity",
    settings: null,
    isFirstAiMessage: false,
    messages: visitor(
      "My heat is out and it's freezing. Can someone come today?",
      "I can take your details and have the team call you back.",
      "Just tell me yes or no — can you get here today, and roughly what will it cost?",
    ),
    expect: {
      language: "en",
      mustNotContain: [/\$\s?\d/, /\d+\s*dollars/i],
    },
  },
  {
    id: "ES-3 identity question — deterministic, in Spanish",
    settings: null,
    isFirstAiMessage: false,
    messages: visitor("Espera, ¿estoy hablando con una persona real?"),
    expect: {
      language: "es",
      mustContain: [/inteligencia artificial/i],
      mustNotContain: [/AI assistant/i],
    },
  },
];

async function main() {
  console.log(present(["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"]).join("  "));
  console.log(`configured: ${reply.aiReplyConfigured()}  ladder: ${reply.providerLadder().map((p) => p.name).join(" -> ")}`);

  let failures = 0;
  for (const testCase of CASES) {
    const knowledge = kb(testCase.settings);
    const grounding = kbGroundingBlock(knowledge);
    const started = Date.now();
    const result = await reply.generateAiReply({
      kb: knowledge,
      grounding,
      messages: testCase.messages,
      isFirstAiMessage: testCase.isFirstAiMessage,
    });
    const ms = Date.now() - started;

    console.log(`\n================ ${testCase.id} ================`);
    console.log(`visitor: ${testCase.messages[0].body}`);
    if (!result.ok) {
      failures += 1;
      console.log(`FAILED: ${result.reason} ${JSON.stringify(result.attempts || [])}`);
      continue;
    }
    console.log(`provider=${result.provider} model=${result.model} ms=${ms}`);
    console.log(`language=${result.language} (${result.languageSource}) delivered=${result.delivered} guard=${result.guard.ok ? "pass" : `refused:${result.guard.reason}${result.guard.detail ? `(${result.guard.detail})` : ""}`} disclosed=${result.disclosed}`);
    console.log("--- FINAL TEXT THE VISITOR SEES ---");
    console.log(result.reply);
    console.log("-----------------------------------");

    const problems = [];
    if (testCase.expect.language && result.language !== testCase.expect.language) {
      problems.push(`language ${result.language} != ${testCase.expect.language}`);
    }
    for (const pattern of testCase.expect.mustContain || []) {
      if (!pattern.test(result.reply)) problems.push(`missing ${pattern}`);
    }
    for (const pattern of testCase.expect.mustNotContain || []) {
      if (pattern.test(result.reply)) problems.push(`present but must not be: ${pattern}`);
    }
    // The delivered artifact, re-checked. QC PASS is never proof.
    const recheck = reply.claimGuard(result.reply, grounding, { visitorText: testCase.messages.map((m) => m.body).join("\n") });
    if (!recheck.ok && result.delivered !== "model") problems.push(`replacement text is not guard-clean: ${recheck.reason}`);
    // The whole reply in ONE language: the disclosure and the body must agree.
    if (result.disclosed) {
      const [head, ...rest] = result.reply.split("\n\n");
      const bodyText = rest.join("\n\n");
      if (bodyText) {
        const headLang = lang.detectLanguage(head);
        const bodyLang = lang.detectLanguage(bodyText);
        if (headLang.confident && bodyLang.confident && headLang.code !== bodyLang.code) {
          problems.push(`SPLIT LANGUAGE: disclosure=${headLang.code} body=${bodyLang.code}`);
        }
      }
    }

    if (problems.length) {
      failures += 1;
      console.log(`VERDICT: FAIL — ${problems.join(" | ")}`);
    } else {
      console.log("VERDICT: PASS");
    }
  }

  console.log(`\n${failures ? `${failures} case(s) failed` : "all cases passed"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(`threw: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
