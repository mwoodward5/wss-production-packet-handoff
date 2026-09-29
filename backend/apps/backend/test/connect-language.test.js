"use strict";

/**
 * ANSWER FULLY IN THE VISITOR'S LANGUAGE.
 *
 * The defect this suite exists for was caught live on the Sears mirror: the
 * body followed the visitor into Spanish and the AI disclosure stayed in
 * English, because the disclosure is prepended in code and the code only
 * spoke one language.
 *
 *   "Hi - I'm Sears Heating and Cooling's AI assistant. The team is out..."
 *   "Hola. Sears Heating and Cooling ofrece reparacion de aire..."
 *
 * So the suite is organised around the four ways a multilingual assistant
 * hurts somebody:
 *   1. it discloses in a language the reader cannot read (SB 243),
 *   2. it answers half in one language and half in another,
 *   3. it TRANSLATES a fact — a price, a phone number, an address — and turns
 *      it into a different fact,
 *   4. it refuses less in one language than in another, so the guard that
 *      stops an invented warranty in English lets it through in Spanish.
 *
 * The knowledge base is the same real production fixture the English suite
 * uses: it publishes no price, no warranty and nothing free, so any of those
 * in any language is provably invented.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const fixture = require("./fixtures/connect-site-kb-rose-city.json");
const { buildSiteKb, kbGroundingBlock } = require("../lib/connect-site-kb.js");
const reply = require("../lib/connect-ai-reply.js");
const lang = require("../lib/connect-language.js");

const SLUG = "wss-test-rose-city-heating-and-air-portland";
const NOW = Date.parse("2026-08-11T12:00:00.000Z");

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

function modelSaying(text, { calls = null } = {}) {
  return async (input) => {
    if (calls) calls.push(input);
    return { ok: true, text, provider: "openrouter", model: "anthropic/claude-haiku-4.5", attempts: [] };
  };
}

function visitorSays(...bodies) {
  return bodies.map((body, index) => ({
    id: String(index + 1),
    direction: index % 2 === 0 ? "inbound" : "outbound",
    body,
    created_at: new Date(NOW - 60000).toISOString(),
  }));
}

/** One realistic opening message per supported language. */
const OPENERS = Object.freeze({
  en: "Do you do heat pumps? How much would that cost?",
  es: "Hola, necesito reparación de aire acondicionado. ¿Ustedes hacen eso?",
  pt: "Olá, vocês fazem manutenção de ar condicionado? Quanto custa?",
  fr: "Bonjour, est-ce que vous réparez les pompes à chaleur ?",
  de: "Hallo, reparieren Sie auch Wärmepumpen? Was kostet das?",
  it: "Ciao, riparate anche i condizionatori? Quanto costa?",
  nl: "Hallo, repareren jullie ook warmtepompen? Hoeveel kost dat?",
  pl: "Dzień dobry, czy naprawiacie pompy ciepła? Ile to kosztuje?",
  ru: "Здравствуйте, вы ремонтируете тепловые насосы? Сколько это стоит?",
  uk: "Вітаю, чи ремонтуєте ви теплові насоси? Скільки це коштує?",
  ar: "مرحبا، هل تصلحون المكيفات؟ كم السعر؟",
  zh: "你好，你们修空调吗？多少钱？",
  ja: "こんにちは、エアコンの修理はしていますか。いくらですか。",
  ko: "안녕하세요, 에어컨 수리도 하시나요? 얼마인가요?",
  vi: "Xin chào, bên bạn có sửa máy lạnh không? Bao nhiêu tiền?",
  tl: "Kumusta po, nag-aayos ba kayo ng aircon? Magkano po?",
});

/**
 * A sentence that offers something the fixture never publishes, written in
 * each language. This is the coverage table for rule 4: if a language is in
 * the catalogue but its promise vocabulary is missing, its row here passes the
 * guard and the test fails.
 */
const INVENTIONS = Object.freeze({
  en: "Estimates are free and the work is guaranteed.",
  es: "El presupuesto es gratis y garantizamos el trabajo.",
  pt: "O orçamento é grátis e garantimos o serviço.",
  fr: "Le devis est gratuit et le travail est garanti.",
  de: "Der Kostenvoranschlag ist kostenlos und die Arbeit ist garantiert.",
  it: "Il preventivo è gratuito e il lavoro è garantito.",
  nl: "De offerte is gratis en het werk is gegarandeerd.",
  pl: "Wycena jest za darmo, a pracę objęta jest gwarancją.",
  ru: "Оценка бесплатная, и мы гарантируем качество работы.",
  uk: "Оцінка безкоштовна, і ми гарантуємо якість роботи.",
  ar: "التقدير مجاني ونضمن العمل.",
  zh: "报价免费，我们保证工程质量。",
  ja: "見積もりは無料で、作業は保証されています。",
  ko: "견적은 무료이고 작업은 보증됩니다.",
  vi: "Báo giá miễn phí và chúng tôi bảo hành công việc.",
  tl: "Libreng estimate at garantisado ang trabaho.",
});

// ===========================================================================
// 1. THE DETECTOR — it decides which language the law will be read in
// ===========================================================================

test("every supported language is detected from a real opening message", () => {
  for (const [code, message] of Object.entries(OPENERS)) {
    const got = lang.detectLanguage(message);
    if (code === "en") {
      // English is the default, so what matters is that nothing ELSE wins it.
      assert.equal(got.code, "en", `${code}: ${message}`);
      continue;
    }
    assert.equal(got.code, code, `${code}: ${message}`);
    assert.equal(got.confident, true, `${code} must be confident, not a coin flip`);
  }
});

test("a message too short to call stays English rather than guessing", () => {
  for (const ambiguous of ["Hi", "ok", "?", "5035550142", ""]) {
    const got = lang.detectLanguage(ambiguous);
    assert.equal(got.code, "en", ambiguous);
    assert.equal(got.confident, false, `"${ambiguous}" must not be a confident verdict`);
  }
});

test("a Spanish thread does not flip to English on the word \"ok\"", () => {
  const detected = lang.detectVisitorLanguage(visitorSays(
    "Hola, necesito reparación de aire acondicionado. ¿Ustedes hacen eso?",
    "Sí, reparamos aire acondicionado.",
    "ok",
  ));
  assert.equal(detected.code, "es");
  assert.match(detected.method, /history/);
});

test("a visitor who switches language is followed, latest message first", () => {
  const detected = lang.detectVisitorLanguage(visitorSays(
    "Do you service heat pumps in Beaverton?",
    "Yes, the site lists heat pump repair.",
    "Perdón, ¿me puede explicar en español cuánto tiempo toma la reparación?",
  ));
  assert.equal(detected.code, "es");
  assert.equal(detected.confident, true);
});

// ===========================================================================
// 2. THE INVARIANT — we answer only in languages we can also disclose in
// ===========================================================================

test("every supported language has an authored disclosure, handoff and lead ack", () => {
  const ctx = { business: "Rose City Heating & Air", phone: "(503) 555-0111", booking: "https://example.com/book" };
  const seen = new Set();
  for (const code of lang.SUPPORTED_CODES) {
    const disclosure = lang.disclosureFor(code, ctx);
    const handoff = lang.handoffFor(code, ctx);
    const ack = lang.leadAckFor(code, { ...ctx, name: "Dana", hasPhone: true });

    for (const [what, line] of [["disclosure", disclosure], ["handoff", handoff], ["lead ack", ack]]) {
      assert.ok(line && line.length > 30, `${code} ${what} is missing`);
      assert.equal(/\{\{|\}\}|\$\{/.test(line), false, `${code} ${what} carries an unresolved token`);
      assert.match(line, /Rose City Heating & Air/, `${code} ${what} must name the business`);
    }
    // Two languages must never be handed the same sentence — that is what a
    // missing translation looks like when nobody checks.
    if (code !== "en") assert.equal(seen.has(disclosure), false, `${code} reuses another language's disclosure`);
    seen.add(disclosure);
  }
});

test("the disclosure says AI in the reader's own language, never only in English", () => {
  const ctx = { business: "Rose City Heating & Air" };
  // The word for "artificial intelligence" in each language, since "AI" itself
  // is meaningless to a reader who does not read English.
  const says = {
    es: /inteligencia artificial/i,
    pt: /inteligência artificial/i,
    fr: /intelligence artificielle/i,
    de: /künstliche Intelligenz/i,
    it: /intelligenza artificiale/i,
    nl: /kunstmatige intelligentie/i,
    pl: /sztucznej inteligencji/i,
    ru: /искусственный интеллект/i,
    uk: /штучний інтелект/i,
    ar: /الذكاء الاصطناعي/,
    zh: /人工智能/,
    ja: /人工知能/,
    ko: /인공지능/,
    vi: /trí tuệ nhân tạo/i,
    tl: /artificial intelligence/i,
  };
  for (const [code, pattern] of Object.entries(says)) {
    assert.match(lang.disclosureFor(code, ctx), pattern, code);
  }
});

test("every authored sentence passes the claim guard it will be measured by", () => {
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  for (const code of lang.SUPPORTED_CODES) {
    for (const [what, line] of [
      ["disclosure", reply.disclosureLine(kb, code)],
      ["handoff", reply.safeHandoffReply(kb, code)],
      ["lead ack", reply.leadAckReply(kb, { name: "Dana", phone: "+15035550142" }, code)],
    ]) {
      const verdict = reply.claimGuard(line, grounding);
      assert.equal(verdict.ok, true, `${code} ${what} refused as ${verdict.reason}: ${line}`);
    }
  }
});

test("an unsupported language is answered in English rather than disclosed to in nothing", () => {
  // Icelandic is not in the catalogue. The honest outcome is English — not a
  // fluent Icelandic answer under a disclosure nobody can read.
  const detected = lang.detectLanguage("Góðan daginn, gerið þið við varmadælur?");
  assert.equal(lang.isSupported(detected.code) && detected.confident ? detected.code : "en", "en");
  assert.equal(lang.resolveLanguage("is"), "en");
  assert.equal(lang.resolveLanguage("es-MX"), "es");
  assert.equal(lang.resolveLanguage("zh-Hans"), "zh");
  assert.equal(lang.resolveLanguage("fil"), "tl");
});

// ===========================================================================
// 3. REFUSAL PARITY — the guard is the same guard in every language
// ===========================================================================

test("a promise the site never published is refused in EVERY supported language", () => {
  const grounding = kbGroundingBlock(realKb());
  assert.equal(/guarantee|warrant|free|discount/i.test(grounding), false, "fixture precondition");
  for (const [code, invention] of Object.entries(INVENTIONS)) {
    const verdict = reply.claimGuard(invention, grounding);
    assert.equal(verdict.ok, false, `${code} slipped through: ${invention}`);
    assert.match(verdict.reason, /^unsupported_(guarantee|warranty|free|discount)$/, code);
  }
});

test("a same-day commitment is refused in every language that can express one", () => {
  const grounding = kbGroundingBlock(realKb());
  const commitments = {
    en: "We can get someone out to you today.",
    es: "Podemos pasar hoy por la tarde.",
    pt: "Podemos passar hoje à tarde.",
    fr: "Nous pouvons passer aujourd'hui.",
    de: "Wir können heute noch vorbeikommen.",
    it: "Possiamo passare oggi pomeriggio.",
    nl: "We kunnen vandaag nog langskomen.",
    pl: "Możemy przyjechać dzisiaj.",
    ru: "Мы можем приехать сегодня.",
    uk: "Ми можемо приїхати сьогодні.",
    zh: "我们今天可以上门。",
    ja: "本日訪問できます。",
    ko: "오늘 방문 가능합니다.",
    vi: "Chúng tôi có thể đến hôm nay.",
    tl: "Puwede kaming pumunta ngayong araw.",
  };
  for (const [code, line] of Object.entries(commitments)) {
    const verdict = reply.claimGuard(line, grounding);
    assert.equal(verdict.ok, false, `${code} slipped through: ${line}`);
    assert.equal(verdict.reason, "unsupported_availability_commitment", `${code}: ${line}`);
  }
});

test("hedging is still allowed to say the word — refusal must not become a stutter", () => {
  const grounding = kbGroundingBlock(realKb());
  // The English precision fix, in Spanish: declining to answer a warranty
  // question is not the same sentence as offering a warranty.
  for (const hedged of [
    "No puedo decirte si ofrecemos garantía, pero el equipo te lo confirma.",
    "No tengo información sobre presupuestos gratis en el sitio.",
  ]) {
    assert.equal(reply.claimGuard(hedged, grounding).ok, true, hedged);
  }
});

test("a claim to be human is refused in Spanish exactly as in English", () => {
  const grounding = kbGroundingBlock(realKb());
  assert.equal(reply.claimGuard("No, hablas con una persona real.", grounding).reason, "human_identity_claim");
  assert.equal(reply.claimGuard("Sí, soy humano.", grounding).reason, "human_identity_claim");
  assert.equal(reply.claimGuard("Non sono un bot, sono una persona.", grounding).reason, "human_identity_claim");
});

test("\"are you a bot?\" is recognised in every language it is likely to be asked in", () => {
  for (const asked of [
    "Are you a bot?",
    "¿Eres un bot?",
    "¿Estoy hablando con una persona?",
    "Você é um robô?",
    "Êtes-vous un robot ?",
    "Bist du ein Bot?",
    "Sei un bot?",
    "Ben je een bot?",
    "Czy jesteś botem?",
    "Вы бот?",
    "Ви бот?",
    "هل أنت روبوت؟",
    "你是机器人吗？",
    "人間ですか。",
    "사람인가요?",
    "Bạn là người thật hay bot?",
    "Bot ka ba?",
  ]) {
    assert.equal(reply.isIdentityQuestion(asked), true, asked);
  }
  for (const notAsked of ["Are you the person who does installs?", "¿Ustedes reparan calentadores?", "¿Cuánto cuesta?"]) {
    assert.equal(reply.isIdentityQuestion(notAsked), false, notAsked);
  }
});

// ===========================================================================
// 4. FACTS SURVIVE TRANSLATION — the owner's own answers
// ===========================================================================

/** A KB carrying owner-authored Q&A, written in English, with hard facts in it. */
function kbWithOwnerQa() {
  return realKb({
    settings: {
      ok: true,
      slug: SLUG,
      aiChatEnabled: true,
      takeoverSeconds: 30,
      customQa: [{
        question: "What does a diagnostic visit cost?",
        answer: "Our diagnostic visit is $149, and it is credited toward the repair. Call (503) 555-0111 or come by 4652 Northwest Ave, Portland OR.",
      }],
      bookingUrl: "",
      greeting: "",
      refusals: [],
      source: "test",
      reason: "",
    },
  });
}

test("the owner's price and phone survive a Spanish answer verbatim", async () => {
  const kb = kbWithOwnerQa();
  const grounding = kbGroundingBlock(kb);
  assert.match(grounding, /\$149/, "precondition: the owner published this price");

  const result = await reply.generateAiReply({
    kb,
    grounding,
    messages: visitorSays("Hola, ¿cuánto cuesta la visita de diagnóstico?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"La visita de diagnóstico cuesta $149 y se acredita a la reparación. Puede llamar al (503) 555-0111.","name":"","phone":"","email":""}'),
  });

  assert.equal(result.guard.ok, true, `refused as ${result.guard.reason}`);
  assert.equal(result.delivered, "model");
  assert.match(result.reply, /\$149/, "the price must survive the translation unchanged");
  assert.match(result.reply, /\(503\) 555-0111/, "so must the phone number");
  assert.equal(result.language, "es");
});

test("a price CONVERTED into another currency is refused — it is a different price", () => {
  const grounding = kbGroundingBlock(kbWithOwnerQa());
  const converted = reply.claimGuard("La visita de diagnóstico cuesta 149 dólares.", grounding);
  assert.equal(converted.ok, false);
  assert.equal(converted.reason, "unsupported_price");

  const euros = reply.claimGuard("Der Besuch kostet 149 euros.", grounding);
  assert.equal(euros.ok, false, "a currency swap is a fabrication even at the same number");
});

test("a phone number the corpus never published is refused, even mid-Spanish", () => {
  const grounding = kbGroundingBlock(kbWithOwnerQa());
  const wrong = reply.claimGuard("Llame al (503) 555-0999 para agendar.", grounding);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, "unsupported_phone_number");

  const right = reply.claimGuard("Llame al (503) 555-0111 para más información.", grounding);
  assert.equal(right.ok, true, `refused as ${right.reason}`);
});

test("the visitor's OWN number may be read back to them — that is not a claim", () => {
  const grounding = kbGroundingBlock(realKb());
  const verdict = reply.claimGuard(
    "Perfecto, tengo su número (503) 555-0142 y se lo paso al equipo.",
    grounding,
    { visitorText: "Soy Dana, mi número es (503) 555-0142." },
  );
  assert.equal(verdict.ok, true, `refused as ${verdict.reason}`);
});

test("an address translated into the visitor's language is refused", () => {
  const grounding = kbGroundingBlock(kbWithOwnerQa());
  assert.match(grounding, /Northwest Ave/i, "precondition: the corpus publishes the real street");

  const translated = reply.claimGuard("Estamos en la Calle Northwest 4652, Portland.", grounding);
  assert.equal(translated.ok, false);
  assert.equal(translated.reason, "translated_address");

  const verbatim = reply.claimGuard("Estamos en 4652 Northwest Ave, Portland OR.", grounding);
  assert.equal(verbatim.ok, true, `refused as ${verbatim.reason}`);
});

test("a link the site never published cannot be invented in any language", () => {
  const grounding = kbGroundingBlock(realKb());
  const invented = reply.claimGuard("Reserve aquí: https://rosecity-hvac.example.com/promo", grounding);
  assert.equal(invented.ok, false);
  assert.equal(invented.reason, "unsupported_link");
});

// ===========================================================================
// 5. THE DEFECT ITSELF — one language, disclosure included
// ===========================================================================

test("REGRESSION: a Spanish visitor never gets an English preamble", async () => {
  // The exact live failure: Spanish body, English disclosure.
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: visitorSays("Hola, ¿ustedes reparan aire acondicionado en Portland?"),
    isFirstAiMessage: true,
    callModelImpl: modelSaying('{"reply":"Sí, el sitio indica reparación de aire acondicionado en Portland y alrededores.","name":"","phone":"","email":""}'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.language, "es");
  assert.equal(result.disclosed, true);
  assert.equal(/AI assistant/i.test(result.reply), false, "the English disclosure must not appear");
  assert.equal(/The team is out on a job/i.test(result.reply), false);
  assert.match(result.reply, /inteligencia artificial/i, "the disclosure must be IN SPANISH");
  assert.ok(result.reply.indexOf("inteligencia artificial") < 120, "and must still open the message");
  assert.match(result.reply, /Rose City Heating & Air/);
});

test("the first reply in every supported language discloses in that language", async () => {
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  for (const [code, opener] of Object.entries(OPENERS)) {
    const answers = {
      en: "Yes — the site lists heat pump repair.",
      es: "Sí, el sitio indica reparación de aire acondicionado.",
      pt: "Sim, o site lista manutenção de ar condicionado.",
      fr: "Oui, le site indique la réparation de pompes à chaleur.",
      de: "Ja, die Seite nennt die Reparatur von Wärmepumpen.",
      it: "Sì, il sito indica la riparazione dei condizionatori.",
      nl: "Ja, de site vermeldt reparatie van warmtepompen.",
      pl: "Tak, strona wymienia naprawę pomp ciepła.",
      ru: "Да, на сайте указан ремонт тепловых насосов.",
      uk: "Так, на сайті вказано ремонт теплових насосів.",
      ar: "نعم، الموقع يذكر إصلاح المكيفات.",
      zh: "是的，网站上列有空调维修。",
      ja: "はい、サイトにエアコン修理の記載があります。",
      ko: "네, 사이트에 에어컨 수리가 안내되어 있습니다.",
      vi: "Có, trang web có liệt kê sửa máy lạnh.",
      tl: "Opo, nakalista sa site ang pag-aayos ng aircon.",
    };
    const result = await reply.generateAiReply({
      kb,
      grounding,
      messages: visitorSays(opener),
      isFirstAiMessage: true,
      callModelImpl: modelSaying(JSON.stringify({ reply: answers[code], name: "", phone: "", email: "" })),
    });
    assert.equal(result.ok, true, code);
    assert.equal(result.disclosed, true, `${code} was not disclosed to`);
    assert.equal(result.language, code, `${code} answered in ${result.language}`);
    assert.ok(result.reply.startsWith(lang.disclosureFor(code, { business: "Rose City Heating & Air" })),
      `${code} reply must OPEN with its own disclosure`);
  }
});

test("the English disclosure is a tight one-line identification, then the answer", async () => {
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: visitorSays("Do you do heat pumps?"),
    isFirstAiMessage: true,
    callModelImpl: modelSaying('{"reply":"Yes — heat pump repair and installation are both listed.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.language, "en");
  // The identification the law requires, then the answer — no sales preamble.
  assert.match(result.reply, /^Hi — I'm Rose City Heating & Air's AI assistant\.\n\nYes — heat pump repair/);
  assert.doesNotMatch(result.reply, /out on a job|call you straight back/i);
});

test("a model that answers in the WRONG language is replaced, not shipped", async () => {
  // Half-English, half-Spanish is the same defect wearing different clothes.
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: visitorSays("Hola, ¿reparan calentadores de agua? Necesito ayuda con el mío."),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Yes, the site lists water heater repair for the Portland metro area.","name":"","phone":"","email":""}'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.guard.ok, false);
  assert.equal(result.guard.reason, "reply_language_mismatch");
  assert.equal(result.delivered, "handoff");
  assert.equal(/water heater repair/i.test(result.reply), false, "the English answer must not be shipped");
  assert.match(result.reply, /Prefiero no adivinar/, "the replacement must be in Spanish too");
});

test("an unanswerable Spanish question produces a Spanish handoff, not an invention", async () => {
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  const result = await reply.generateAiReply({
    kb,
    grounding,
    messages: visitorSays("¿Cuánto cuesta cambiar el compresor y me lo garantizan?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"Cambiar el compresor cuesta unos $1,200 y lo garantizamos por dos años.","name":"","phone":"","email":""}'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.guard.ok, false, "an invented price and warranty must be refused in Spanish too");
  assert.equal(result.delivered, "handoff");
  assert.equal(/1,?200/.test(result.reply), false, "the invented price must not reach the customer");
  assert.equal(/garantiz/i.test(result.reply), false, "nor the invented warranty");
  assert.match(result.reply, /nombre|número|llamada/i, "the handoff still has to ask for the callback");
  assert.equal(reply.claimGuard(result.reply, grounding).ok, true, "the replacement is safe by construction");
});

test("\"¿eres un bot?\" is answered from the disclosure, in Spanish, without a model call", async () => {
  const kb = realKb();
  const calls = [];
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: visitorSays("Espera, ¿estoy hablando con una persona real?"),
    isFirstAiMessage: false,
    previousRefused: true,
    callModelImpl: modelSaying('{"reply":"Sí, soy una persona real."}', { calls }),
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 0, "the one question that must never be sampled");
  assert.equal(result.provider, "deterministic");
  assert.equal(result.language, "es");
  assert.match(result.reply, /inteligencia artificial/i);
  assert.equal(/persona real/i.test(result.reply), false);
});

test("a visitor who hands over a number in Spanish is acknowledged in Spanish", async () => {
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: visitorSays("Me llamo Dana, mi número es (503) 555-0142. Llámenme por favor."),
    isFirstAiMessage: false,
    previousRefused: true,
    callModelImpl: modelSaying('{"reply":"Claro, y le garantizamos servicio el mismo día.","name":"Dana","phone":"(503) 555-0142","email":""}'),
  });

  assert.equal(result.delivered, "lead_ack");
  assert.equal(result.guard.ok, false, "the model's invention is still recorded as refused");
  assert.equal(/garantiz|mismo día/i.test(result.reply), false, "and still never reaches the customer");
  assert.match(result.reply, /Gracias Dana/);
  assert.equal(result.lead.phone, "+15035550142");
  assert.equal(result.language, "es");
});

// ===========================================================================
// 6. A VISITOR WHO SWITCHES LANGUAGE IS DISCLOSED TO AGAIN
// ===========================================================================

test("switching to Spanish mid-thread earns a second disclosure, in Spanish", async () => {
  const kb = realKb();
  const grounding = kbGroundingBlock(kb);
  const messages = visitorSays(
    "Do you service heat pumps?",
    "Hi — I'm Rose City Heating & Air's AI assistant...",
    "Perdón, mejor en español. ¿Reparan calentadores de agua?",
  );

  const switched = await reply.generateAiReply({
    kb,
    grounding,
    messages,
    isFirstAiMessage: false,
    disclosedLanguages: ["en"],
    callModelImpl: modelSaying('{"reply":"Sí, el sitio indica reparación de calentadores de agua.","name":"","phone":"","email":""}'),
  });
  assert.equal(switched.language, "es");
  assert.equal(switched.disclosed, true, "this visitor has never been disclosed to in Spanish");
  assert.match(switched.reply, /inteligencia artificial/i);

  const again = await reply.generateAiReply({
    kb,
    grounding,
    messages,
    isFirstAiMessage: false,
    disclosedLanguages: ["en", "es"],
    callModelImpl: modelSaying('{"reply":"Sí, el sitio indica reparación de calentadores de agua.","name":"","phone":"","email":""}'),
  });
  assert.equal(again.disclosed, false, "and must not be told twice in the same language");
  assert.equal(/inteligencia artificial/i.test(again.reply), false);
});

test("a caller that reports nothing behaves exactly as before — no phantom re-disclosure", async () => {
  const kb = realKb();
  const result = await reply.generateAiReply({
    kb,
    grounding: kbGroundingBlock(kb),
    messages: visitorSays("And in Beaverton?"),
    isFirstAiMessage: false,
    callModelImpl: modelSaying('{"reply":"The site lists Portland and the surrounding metro.","name":"","phone":"","email":""}'),
  });
  assert.equal(result.disclosed, false);
  assert.equal(/AI assistant/i.test(result.reply), false);
});

// ===========================================================================
// 7. THE PROMPT — the model is told the rule the guard will enforce
// ===========================================================================

test("the system prompt names the language and forbids converting a fact", () => {
  const kb = realKb();
  const prompt = reply._test.systemPrompt({
    kb,
    grounding: kbGroundingBlock(kb),
    businessName: "Rose City Heating & Air",
    bookingUrl: "",
    lang: "es",
    langConfident: true,
  });
  assert.match(prompt, /=== LANGUAGE ===/);
  assert.match(prompt, /Spanish/);
  assert.match(prompt, /ENTIRE reply in Spanish/);
  assert.match(prompt, /COPY THESE EXACTLY/);
  assert.match(prompt, /Never convert a currency/);
  // And when the read was not confident, it must not name a language at all.
  const unsure = reply._test.systemPrompt({
    kb,
    grounding: "x",
    businessName: "x",
    bookingUrl: "",
    lang: "en",
    langConfident: false,
  });
  assert.match(unsure, /same language the visitor is using/);
});
