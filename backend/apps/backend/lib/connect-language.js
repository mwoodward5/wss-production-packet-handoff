"use strict";

/**
 * lib/connect-language.js — the visitor's language, all the way through.
 *
 * ===========================================================================
 * THE DEFECT THIS EXISTS TO KILL
 * ===========================================================================
 * Live on the Sears mirror, a Spanish-speaking visitor got this:
 *
 *   "Hi - I'm Sears Heating and Cooling's AI assistant. The team is out on a
 *    job right now..."                                        <- ENGLISH
 *   "Hola. Sears Heating and Cooling ofrece reparacion de aire..."  <- SPANISH
 *
 * The body followed the visitor. The disclosure did not, because the
 * disclosure is prepended in CODE (deliberately — a legal requirement that
 * depends on a sampler is not a requirement) and the code only knew one
 * language. The half that the law cares about was the half that stayed
 * English.
 *
 * So the fix is not "tell the model to translate the greeting". It is: the
 * code learns the languages. Every customer-visible sentence this feature can
 * emit without a model — the disclosure, the handoff, the lead
 * acknowledgement — is AUTHORED here, per language, and selected by a
 * deterministic detector. The model never writes the disclosure in any
 * language, exactly as before.
 *
 * ===========================================================================
 * THE INVARIANT THAT KEEPS IT HONEST
 * ===========================================================================
 * We answer in a language ONLY IF we can also disclose in it and guard in it.
 *
 *   supported language  ==>  authored disclosure + handoff + lead ack
 *                       AND  guard vocabulary (promise / commitment /
 *                            identity / negation / money / address)
 *
 * That is asserted by test, not by intention. The consequence is deliberate:
 * a visitor writing in a language that is not in this file is answered in
 * English rather than being answered fluently and disclosed to in a language
 * they cannot read — and rather than being answered in a language where
 * "we guarantee same-day service" would sail straight past the claim guard.
 * Adding a language means adding BOTH halves, in one place.
 *
 * ===========================================================================
 * WHY THE GUARD VOCABULARY IS A UNION, NOT A LOOKUP
 * ===========================================================================
 * claimGuard() checks every language's terms on every reply, regardless of
 * which language was selected. A model that answers half in Spanish, or that
 * ignores the target language entirely, is still checked against Spanish. A
 * routing bug can therefore never WEAKEN the guard — the worst it can do is
 * refuse a little too eagerly, which costs one handoff. That asymmetry is the
 * whole design: over-refusing costs a callback, under-refusing invents a
 * warranty on a stranger's behalf.
 *
 * ===========================================================================
 * ON THE TRANSLATIONS THEMSELVES
 * ===========================================================================
 * Short, formulaic, and deliberately free of urgency words ("right away",
 * "straight away", "as soon as possible") in the handoff and the lead
 * acknowledgement. The disclosure itself is now a single line — the AI
 * identification the law requires, and nothing after it — so the ANSWER, not a
 * sales preamble, is the first substantive thing the visitor reads. The older
 * "the team is out on a job… call you straight back" tail was padding on every
 * reply; it is gone. The handoff still offers the callback, where it belongs.
 *
 * English and Spanish are proven end to end against the live endpoint. The
 * rest are authored here and held by the invariant tests (guard-clean,
 * disclosure present, no template tokens, no urgency claim) but have not been
 * through a native reviewer. That is stated rather than implied.
 */

const DEFAULT_LANGUAGE = "en";

const trim = (v) => String(v == null ? "" : v).trim();

// ---------------------------------------------------------------------------
// WHAT THE CODE SAYS, PER LANGUAGE
// ---------------------------------------------------------------------------

/**
 * Every builder receives the same context and owns its own empty-value
 * grammar, because "the team" / "el equipo" / "担当者" do not slot into one
 * template. English is byte-for-byte what it has always been.
 *
 *   business   the business's published name, or ""
 *   phone      published phone, or ""
 *   booking    published booking URL, or ""
 *   name       the visitor's own name as they typed it, or ""
 *   hasPhone   whether the captured detail was a phone number
 */
const SAY = Object.freeze({
  en: {
    disclosure: ({ business }) => {
      const who = business ? `${business}'s AI assistant` : "the AI assistant for this business";
      return `Hi — I'm ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "the team";
      const parts = ["That's one I'd rather not guess at, so let me get you a straight answer from the team."];
      if (booking) parts.push(`You can grab a time here: ${booking}`);
      parts.push(`Leave your name and the best number and ${team} will call you back${phone ? `, or reach them now on ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Thanks ${name}` : "Thanks";
      const got = hasPhone ? "your number" : "your details";
      return `${who} — I've got ${got} and passed it straight to the team${business ? ` at ${business}` : ""}. Someone will call you back. Anything else you'd like me to pass on?`;
    },
  },

  es: {
    disclosure: ({ business }) => {
      const who = business
        ? `el asistente de inteligencia artificial de ${business}`
        : "el asistente de inteligencia artificial de este negocio";
      return `Hola — soy ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "el equipo";
      const parts = ["Prefiero no adivinar en eso, así que déjame conseguirte una respuesta clara del equipo."];
      if (booking) parts.push(`Puedes reservar un horario aquí: ${booking}`);
      parts.push(`Déjame tu nombre y el mejor número y ${team} te devolverá la llamada${phone ? `, o puedes comunicarte al ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Gracias ${name}` : "Gracias";
      const got = hasPhone ? "tu número" : "tus datos";
      const passed = hasPhone ? "lo pasé" : "los pasé";
      return `${who} — ya tengo ${got} y ${passed} directamente al equipo${business ? ` de ${business}` : ""}. Alguien te devolverá la llamada. ¿Hay algo más que quieras que les transmita?`;
    },
  },

  pt: {
    disclosure: ({ business }) => {
      const who = business
        ? `o assistente de inteligência artificial da ${business}`
        : "o assistente de inteligência artificial deste negócio";
      return `Oi — sou ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "a equipe";
      const parts = ["Nessa eu prefiro não chutar, então deixe eu conseguir uma resposta certa com a equipe."];
      if (booking) parts.push(`Você pode escolher um horário aqui: ${booking}`);
      parts.push(`Deixe seu nome e o melhor número e ${team} retorna a ligação${phone ? `, ou fale com eles pelo ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Obrigado ${name}` : "Obrigado";
      const got = hasPhone ? "seu número" : "seus dados";
      return `${who} — já tenho ${got} e passei direto para a equipe${business ? ` da ${business}` : ""}. Alguém vai retornar sua ligação. Mais alguma coisa que você queira que eu repasse?`;
    },
  },

  fr: {
    disclosure: ({ business }) => {
      const who = business
        ? `l'assistant d'intelligence artificielle de ${business}`
        : "l'assistant d'intelligence artificielle de cette entreprise";
      return `Bonjour — je suis ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "l'équipe";
      const parts = ["Là-dessus je préfère ne pas deviner, alors laissez-moi vous obtenir une réponse précise de l'équipe."];
      if (booking) parts.push(`Vous pouvez choisir un créneau ici : ${booking}`);
      parts.push(`Laissez votre nom et le meilleur numéro et ${team} vous rappellera${phone ? `, ou joignez-les au ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Merci ${name}` : "Merci";
      const got = hasPhone ? "votre numéro" : "vos coordonnées";
      const passed = hasPhone ? "je l'ai transmis" : "je les ai transmises";
      return `${who} — j'ai bien ${got} et ${passed} directement à l'équipe${business ? ` de ${business}` : ""}. Quelqu'un vous rappellera. Autre chose à leur transmettre ?`;
    },
  },

  de: {
    disclosure: ({ business }) => {
      const who = business
        ? `der KI-Assistent (künstliche Intelligenz) von ${business}`
        : "der KI-Assistent (künstliche Intelligenz) dieses Betriebs";
      return `Hallo — ich bin ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "das Team";
      const parts = ["Da möchte ich lieber nicht raten, deshalb hole ich Ihnen eine klare Antwort vom Team."];
      if (booking) parts.push(`Einen Termin können Sie hier auswählen: ${booking}`);
      parts.push(`Hinterlassen Sie Ihren Namen und die beste Nummer, dann meldet sich ${team} bei Ihnen${phone ? `, oder Sie erreichen das Team unter ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Danke ${name}` : "Danke";
      const got = hasPhone ? "Ihre Nummer" : "Ihre Daten";
      return `${who} — ich habe ${got} und direkt an das Team${business ? ` von ${business}` : ""} weitergegeben. Jemand ruft Sie zurück. Soll ich sonst noch etwas ausrichten?`;
    },
  },

  it: {
    disclosure: ({ business }) => {
      const who = business
        ? `l'assistente di intelligenza artificiale di ${business}`
        : "l'assistente di intelligenza artificiale di questa attività";
      return `Ciao — sono ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "il team";
      const parts = ["Su questo preferisco non tirare a indovinare, quindi ti faccio avere una risposta precisa dal team."];
      if (booking) parts.push(`Puoi scegliere un orario qui: ${booking}`);
      parts.push(`Lasciami il tuo nome e il numero migliore e ${team} ti richiamerà${phone ? `, oppure puoi contattarli al ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Grazie ${name}` : "Grazie";
      const got = hasPhone ? "il tuo numero" : "i tuoi dati";
      const passed = hasPhone ? "l'ho passato" : "li ho passati";
      return `${who} — ho ${got} e ${passed} al team${business ? ` di ${business}` : ""}. Ti richiameranno. C'è altro che vuoi che riferisca?`;
    },
  },

  nl: {
    disclosure: ({ business }) => {
      const who = business
        ? `de AI-assistent (kunstmatige intelligentie) van ${business}`
        : "de AI-assistent (kunstmatige intelligentie) van dit bedrijf";
      return `Hallo — ik ben ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "het team";
      const parts = ["Daar wil ik liever niet naar gokken, dus ik zorg dat je een duidelijk antwoord van het team krijgt."];
      if (booking) parts.push(`Je kunt hier een tijd kiezen: ${booking}`);
      parts.push(`Laat je naam en het beste nummer achter, dan belt ${team} je terug${phone ? `, of bel ze op ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Bedankt ${name}` : "Bedankt";
      const got = hasPhone ? "je nummer" : "je gegevens";
      const passed = hasPhone ? "het" : "ze";
      return `${who} — ik heb ${got} en ik heb ${passed} doorgegeven aan het team${business ? ` van ${business}` : ""}. Iemand belt je terug. Nog iets dat ik moet doorgeven?`;
    },
  },

  pl: {
    disclosure: ({ business }) => {
      const who = business
        ? `asystentem sztucznej inteligencji firmy ${business}`
        : "asystentem sztucznej inteligencji tej firmy";
      return `Cześć — jestem ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "zespół";
      const parts = ["Wolę tu nie zgadywać, więc załatwię Ci konkretną odpowiedź od zespołu."];
      if (booking) parts.push(`Termin możesz wybrać tutaj: ${booking}`);
      parts.push(`Zostaw imię i najlepszy numer, a ${team} oddzwoni${phone ? `, albo zadzwoń pod ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Dziękuję ${name}` : "Dziękuję";
      const got = hasPhone ? "Twój numer" : "Twoje dane";
      const passed = hasPhone ? "go" : "je";
      return `${who} — mam ${got} i przekazałem ${passed} zespołowi${business ? ` ${business}` : ""}. Ktoś oddzwoni. Czy mam przekazać coś jeszcze?`;
    },
  },

  ru: {
    disclosure: ({ business }) => {
      const who = business
        ? `ИИ-ассистент (искусственный интеллект) компании ${business}`
        : "ИИ-ассистент (искусственный интеллект) этой компании";
      return `Здравствуйте — я ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "команда";
      const parts = ["Тут я предпочту не гадать, поэтому получу для вас точный ответ от команды."];
      if (booking) parts.push(`Выбрать время можно здесь: ${booking}`);
      parts.push(`Оставьте имя и удобный номер, и ${team} вам перезвонит${phone ? `, или позвоните по номеру ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Спасибо, ${name}` : "Спасибо";
      const got = hasPhone ? "ваш номер" : "ваши данные";
      const passed = hasPhone ? "его" : "их";
      return `${who} — ${got} у меня, и я передал ${passed} команде${business ? ` ${business}` : ""}. Вам перезвонят. Передать что-нибудь ещё?`;
    },
  },

  uk: {
    disclosure: ({ business }) => {
      const who = business
        ? `ШІ-асистент (штучний інтелект) компанії ${business}`
        : "ШІ-асистент (штучний інтелект) цієї компанії";
      return `Вітаю — я ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "команда";
      const parts = ["Тут я краще не вгадуватиму, тож отримаю для вас точну відповідь від команди."];
      if (booking) parts.push(`Обрати час можна тут: ${booking}`);
      parts.push(`Залиште ім'я та зручний номер, і ${team} вам передзвонить${phone ? `, або зателефонуйте за номером ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Дякую, ${name}` : "Дякую";
      const got = hasPhone ? "ваш номер" : "ваші дані";
      return `${who} — ${got} я вже передав команді${business ? ` ${business}` : ""}. Вам передзвонять. Передати ще щось?`;
    },
  },

  ar: {
    disclosure: ({ business }) => {
      const who = business
        ? `مساعد آلي يعمل بالذكاء الاصطناعي لدى ${business}`
        : "مساعد آلي يعمل بالذكاء الاصطناعي لدى هذا النشاط";
      return `مرحبًا — أنا ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "الفريق";
      const parts = ["أفضّل ألا أخمّن في هذا، لذا سأحصل لك على إجابة دقيقة من الفريق."];
      if (booking) parts.push(`يمكنك اختيار موعد هنا: ${booking}`);
      parts.push(`اترك اسمك وأفضل رقم للتواصل وسيعاود ${team} الاتصال بك${phone ? `، أو اتصل على ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `شكرًا ${name}` : "شكرًا";
      const got = hasPhone ? "رقمك" : "بياناتك";
      const passed = hasPhone ? "وأرسلته" : "وأرسلتها";
      return `${who} — لديّ ${got} ${passed} مباشرة إلى الفريق${business ? ` لدى ${business}` : ""}. سيعاود أحدهم الاتصال بك. هل من شيء آخر تريد إبلاغهم به؟`;
    },
  },

  zh: {
    disclosure: ({ business }) => {
      const who = business ? `${business} 的人工智能（AI）助理` : "这家企业的人工智能（AI）助理";
      return `您好，我是${who}。`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "团队";
      const parts = ["这个我不想乱猜，让我帮您从团队那里拿到准确的答复。"];
      if (booking) parts.push(`您可以在这里选择时间：${booking}`);
      parts.push(`请留下您的姓名和方便联系的电话，${team}会给您回电${phone ? `，也可以拨打 ${phone}` : ""}。`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `谢谢${name}` : "谢谢";
      const got = hasPhone ? "您的电话" : "您的联系方式";
      return `${who}，我已经记下${got}，并直接转给了${business ? `${business} 的` : ""}团队。会有人给您回电。还有什么需要我转达的吗？`;
    },
  },

  ja: {
    disclosure: ({ business }) => {
      const who = business ? `${business} のAI（人工知能）アシスタント` : "この事業所のAI（人工知能）アシスタント";
      return `こんにちは。私は${who}です。`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "担当者";
      const parts = ["そこは推測でお答えしたくないので、担当者から正確な回答をお伝えします。"];
      if (booking) parts.push(`こちらからご希望の時間をお選びいただけます：${booking}`);
      parts.push(`お名前とご連絡先の番号を教えていただければ、${team}から折り返しご連絡します${phone ? `。お電話の場合は ${phone} までどうぞ` : ""}。`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `${name}さん、ありがとうございます。` : "ありがとうございます。";
      const got = hasPhone ? "お電話番号" : "ご連絡先";
      return `${who}${got}を承り、${business ? `${business} の` : ""}担当者にそのままお伝えしました。折り返しご連絡いたします。ほかにお伝えすることはありますか。`;
    },
  },

  ko: {
    disclosure: ({ business }) => {
      const who = business ? `${business}의 AI(인공지능) 어시스턴트` : "이 업체의 AI(인공지능) 어시스턴트";
      return `안녕하세요, 저는 ${who}입니다.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "담당자";
      const parts = ["그건 추측으로 답하고 싶지 않으니, 팀에서 정확한 답을 받아 드리겠습니다."];
      if (booking) parts.push(`여기에서 시간을 선택하실 수 있습니다: ${booking}`);
      parts.push(`성함과 연락 가능한 번호를 남겨 주시면 ${team}가 전화드리겠습니다${phone ? `. 전화는 ${phone}로도 가능합니다` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `${name}님, 감사합니다.` : "감사합니다.";
      const got = hasPhone ? "번호" : "연락처";
      return `${who} ${got}를 받아 ${business ? `${business} ` : ""}팀에 바로 전달했습니다. 담당자가 전화드릴 겁니다. 더 전달해 드릴 내용이 있을까요?`;
    },
  },

  vi: {
    disclosure: ({ business }) => {
      const who = business
        ? `trợ lý trí tuệ nhân tạo (AI) của ${business}`
        : "trợ lý trí tuệ nhân tạo (AI) của doanh nghiệp này";
      return `Xin chào — tôi là ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "đội ngũ";
      const parts = ["Chỗ này tôi không muốn đoán, để tôi lấy câu trả lời chính xác từ đội ngũ cho bạn."];
      if (booking) parts.push(`Bạn có thể chọn giờ tại đây: ${booking}`);
      parts.push(`Hãy để lại tên và số điện thoại tốt nhất, ${team} sẽ gọi lại cho bạn${phone ? `, hoặc gọi số ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Cảm ơn ${name}` : "Cảm ơn bạn";
      const got = hasPhone ? "số điện thoại" : "thông tin";
      return `${who} — tôi đã nhận được ${got} của bạn và chuyển thẳng cho đội ngũ${business ? ` của ${business}` : ""}. Sẽ có người gọi lại cho bạn. Bạn muốn nhắn thêm gì không?`;
    },
  },

  tl: {
    disclosure: ({ business }) => {
      const who = business
        ? `ang AI (artificial intelligence) assistant ng ${business}`
        : "ang AI (artificial intelligence) assistant ng negosyong ito";
      return `Kumusta — ako ${who}.`;
    },
    handoff: ({ business, phone, booking }) => {
      const team = business || "ang team";
      const parts = ["Ayaw kong manghula diyan, kaya kukuha ako ng tamang sagot mula sa team."];
      if (booking) parts.push(`Puwede kayong pumili ng oras dito: ${booking}`);
      parts.push(`Iwan ninyo ang pangalan at ang pinakamahusay na numero at tatawagan kayo ng ${team}${phone ? `, o tawagan sila sa ${phone}` : ""}.`);
      return parts.join(" ");
    },
    leadAck: ({ business, name, hasPhone }) => {
      const who = name ? `Salamat ${name}` : "Salamat";
      const got = hasPhone ? "ang numero ninyo" : "ang detalye ninyo";
      return `${who} — nakuha ko na ${got} at ipinasa ko ito sa team${business ? ` ng ${business}` : ""}. May tatawag sa inyo. May iba pa ba kayong gustong ipaabot?`;
    },
  },
});

/** English names (what the model is instructed with) and endonyms. */
const NAMES = Object.freeze({
  en: { name: "English", endonym: "English" },
  es: { name: "Spanish", endonym: "español" },
  pt: { name: "Portuguese", endonym: "português" },
  fr: { name: "French", endonym: "français" },
  de: { name: "German", endonym: "Deutsch" },
  it: { name: "Italian", endonym: "italiano" },
  nl: { name: "Dutch", endonym: "Nederlands" },
  pl: { name: "Polish", endonym: "polski" },
  ru: { name: "Russian", endonym: "русский" },
  uk: { name: "Ukrainian", endonym: "українська" },
  ar: { name: "Arabic", endonym: "العربية" },
  zh: { name: "Simplified Chinese", endonym: "简体中文" },
  ja: { name: "Japanese", endonym: "日本語" },
  ko: { name: "Korean", endonym: "한국어" },
  vi: { name: "Vietnamese", endonym: "Tiếng Việt" },
  tl: { name: "Tagalog", endonym: "Tagalog" },
});

const SUPPORTED_CODES = Object.freeze(Object.keys(SAY));

// ---------------------------------------------------------------------------
// GUARD VOCABULARY — the union that every reply is checked against
// ---------------------------------------------------------------------------

/**
 * A term is matched as a WHOLE WORD unless it ends in "*", which makes it a
 * stem: "garanti*" catches garantía / garantie / garantizado / garantimos,
 * while "no" stays the word "no" and never matches inside "nombre".
 *
 * Whole-word is the default because the two lists where a loose match does
 * DAMAGE are the negation list and the identity list — a negation term that
 * fires inside an unrelated word exempts a sentence from the promise check,
 * which is the one direction that under-refuses.
 *
 * CJK and Kana and Hangul terms carry no boundary at all, because those
 * scripts put no spaces between words and there is nothing to anchor to.
 */
const VOCAB = Object.freeze({
  // "we can be there today" — never speakable, in any language: there is no
  // calendar in the corpus, so the sentence is invented by construction.
  time: Object.freeze([
    "today", "tonight", "tomorrow", "same day", "same-day", "right away", "within the hour",
    "this morning", "this afternoon", "this evening", "this week",
    "hoy", "esta noche", "mañana", "mismo día", "ahora mismo", "enseguida", "esta semana", "esta tarde",
    "hoje", "esta noite", "amanhã", "mesmo dia", "agora mesmo", "esta semana", "hoje à tarde",
    "aujourd'hui", "ce soir", "demain", "le jour même", "tout de suite", "cette semaine", "cet après-midi",
    "heute", "heute abend", "morgen", "am selben tag", "sofort", "diese woche", "heute nachmittag",
    "oggi", "stasera", "domani", "in giornata", "subito", "questa settimana", "questo pomeriggio",
    "vandaag", "vanavond", "morgen", "dezelfde dag", "meteen", "deze week", "vanmiddag",
    "dzisiaj", "dziś", "dziś wieczorem", "jutro", "tego samego dnia", "od razu", "w tym tygodniu",
    "сегодня", "сегодня вечером", "завтра", "в тот же день", "прямо сейчас", "на этой неделе",
    "сьогодні", "завтра", "того ж дня", "просто зараз", "цього тижня",
    "اليوم", "الليلة", "غدا", "غدًا", "في نفس اليوم", "حالا", "حالًا", "هذا الأسبوع",
    "今天", "今晚", "明天", "当天", "马上", "本周", "这周",
    "本日", "今日", "今夜", "明日", "当日", "すぐに", "今週",
    "오늘", "오늘 밤", "내일", "당일", "지금 바로", "이번 주",
    "hôm nay", "tối nay", "ngày mai", "trong ngày", "ngay bây giờ", "tuần này",
    "ngayong araw", "mamayang gabi", "bukas", "sa araw ding ito", "ngayon din", "ngayong linggo",
  ]),

  // Verbs of showing up / dispatching / booking. A time word standing near one
  // of these is a commitment the website cannot support.
  commit: Object.freeze([
    "come", "be there", "send", "have someone", "schedul*", "book*", "fit you", "slot you",
    "squeeze you", "appointment*", "arriv*", "stop by", "swing by",
    "ir", "vamos", "podemos", "lleg*", "pasar", "pasamos", "pasaremos", "envi*", "mand*",
    "agend*", "program*", "cita", "atend*", "estar allí", "salir",
    "cheg*", "marc*",
    "venir", "venons", "viendra", "passer", "passons", "passerons", "envoy*", "enverrons",
    "rendez-vous", "interven*",
    "komm*", "vorbei*", "schick*", "send*", "termin*", "einplan*", "da sein",
    "venire", "veniamo", "passare", "passiamo", "passeremo", "arriviamo", "mand*", "invi*",
    "appuntamento", "fiss*",
    "kom*", "langskomen", "stur*", "afspraak", "inplannen",
    "przyjecha*", "przyjedziemy", "wyśl*", "umówi*", "wpa*",
    "приеха*", "приедем", "выеха*", "отправ*", "запиш*", "прийти", "подъед*",
    "приїд*", "приїха*", "виїд*", "відправ*", "запиш*",
    "نأتي", "سنأتي", "نرسل", "موعد", "نصل",
    "上门", "过去", "派人", "安排", "预约", "到场",
    "伺い", "訪問", "手配", "予約", "参ります",
    "방문", "출동", "배정", "예약", "가겠습니다",
    "đến", "qua", "cử người", "sắp xếp", "đặt lịch",
    "pupunta", "pumunta", "punta*", "padala", "iiskedyul", "darating", "dadaan",
  ]),

  // Opening-hours words. A relative day standing near one of these attaches
  // real published hours to a day the assistant cannot know.
  hours: Object.freeze([
    "open", "closed", "close", "until", "till",
    "abiert*", "cerrad*", "abrimos", "cerramos", "hasta",
    "abert*", "fechad*", "fechamos", "até",
    "ouvert*", "fermé*", "ouvrons", "fermons", "jusqu*",
    "geöffnet", "geschlossen", "offen", "öffnen", "schließen", "bis",
    "apert*", "chius*", "apriamo", "chiudiamo", "fino",
    "gesloten", "openen", "sluiten", "tot",
    "otwart*", "zamkni*", "otwieramy", "zamykamy",
    "открыт*", "закрыт*", "работаем", "до",
    "відкрит*", "зачинен*", "працюємо",
    "مفتوح", "مغلق", "نفتح", "نغلق", "حتى",
    "营业", "开门", "关门", "到",
    "営業", "開いて", "閉ま", "まで",
    "영업", "문을 열", "문을 닫", "까지",
    "mở cửa", "đóng cửa", "đến",
    "bukas", "sarado", "hanggang",
  ]),

  promise: Object.freeze({
    guarantee: Object.freeze([
      "garanti*", "garanzi*", "garantid*", "gwarancj*", "gwarantuj*", "гаранти*", "гарантує",
      "ضمان*", "نضمن", "保证", "保障", "保証", "보증", "보장", "bảo đảm", "đảm bảo",
      "garantisado", "garantiya",
    ]),
    warranty: Object.freeze([
      "gewährleistung", "rękojmi*", "保修", "bảo hành", "waranti",
    ]),
    free: Object.freeze([
      "gratis", "gratuit*", "grátis", "kostenlos", "kostenfrei", "za darmo", "darmow*",
      "bezpłatn*", "бесплатн*", "безкоштовн*", "مجان*", "免费", "無料", "무료", "miễn phí",
      "libreng", "walang bayad",
    ]),
    discount: Object.freeze([
      "descuent*", "descont*", "réduction*", "remise", "rabatt*", "nachlass", "sconto", "sconti",
      "korting", "zniżk*", "rabat*", "скидк*", "знижк*", "خصم", "折扣", "优惠", "割引", "할인",
      "giảm giá", "diskuwento", "diskwento",
    ]),
  }),

  // A claim to be human, or that a human is reading. Never speakable.
  identityClaim: Object.freeze([
    "soy una persona", "soy humano", "soy humana", "no soy un bot", "no soy una máquina",
    "hablas con una persona", "habla con una persona", "hay una persona real",
    "sou uma pessoa", "sou humano", "não sou um bot", "falando com uma pessoa",
    "je suis une personne", "je suis humain", "je ne suis pas un bot", "vous parlez à une personne",
    "ich bin ein mensch", "ich bin kein bot", "sie sprechen mit einem menschen",
    "sono una persona", "sono umano", "non sono un bot", "parli con una persona",
    "ik ben een mens", "ik ben geen bot", "je spreekt met een mens",
    "jestem człowiekiem", "nie jestem botem", "rozmawiasz z człowiekiem",
    "я человек", "я не бот", "вы говорите с человеком", "отвечает человек",
    "я людина", "я не бот", "ви говорите з людиною",
    "أنا إنسان", "لست روبوت", "تتحدث مع إنسان",
    "我是真人", "我不是机器人", "真人回复", "有真人",
    "私は人間", "人間です", "ボットではありません",
    "저는 사람입니다", "사람이 답변", "봇이 아닙니다",
    "tôi là người thật", "tôi không phải bot", "bạn đang nói chuyện với người thật",
    "tao ako", "hindi ako bot",
  ]),

  // Negation / hedging. Exempts a sentence from the PROMISE vocabulary only —
  // never from the commitment or identity rules, which are absolute.
  negation: Object.freeze([
    "no puedo", "no sé", "no se", "no tengo", "no aparece", "no está", "no figura", "no hay",
    "no indica", "no menciona", "no dice", "no encuentro", "no publicamos", "sin información",
    "sin informacion", "si ofrecemos", "si ofrece", "no confirmar", "no ofrecemos",
    "não", "sem informação", "se oferecemos",
    "ne peux", "ne sais", "pas de", "aucun", "aucune", "je ne", "n'est pas", "si nous offrons",
    "nicht", "kein", "keine", "ob wir",
    "non", "nessun*", "se offriamo",
    "niet", "geen", "of we",
    "nie", "czy oferujemy", "brak inform*",
    "не", "нет", "не могу", "нельзя", "ли мы",
    "немає", "чи ми",
    "لا", "ليس", "لست", "غير مذكور",
    "不能", "无法", "沒有", "没有", "不确定", "不清楚", "是否",
    "ません", "できません", "かどうか", "ありません",
    "없", "않", "는지", "못",
    "không", "chưa", "có phải",
    "hindi", "wala", "kung",
  ]),

  // Currency words: a price CONVERTED into another currency is a different
  // price, and this is what catches the conversion.
  currency: Object.freeze([
    "dollars", "usd", "bucks", "dólares", "dolares", "dólar", "euros", "euro", "pesos", "reais",
    "libras", "rubles", "рублей", "руб", "гривень", "złotych", "zł", "dirham*", "درهم", "دولار",
    "ريال", "元", "块钱", "人民币", "円", "ドル", "원", "달러", "đồng",
  ]),

  // Street words. A localised street type standing next to a number means the
  // address was TRANSLATED, which makes it a different address.
  street: Object.freeze([
    "street", "avenue", "boulevard", "road", "highway",
    "calle", "avenida", "carrera", "colonia", "bulevar",
    "rua", "estrada", "rue", "chemin", "straße", "strasse", "gasse", "platz",
    "viale", "piazza", "corso", "straat", "laan", "ulica", "aleja",
    "улица", "проспект", "переулок", "вулиця",
    "شارع", "طريق", "街道", "大道", "通り", "丁目", "đường", "phố", "kalye",
  ]),

  // The one question that must never be sampled: "am I talking to a person?"
  identityQuestion: Object.freeze([
    "eres un bot", "eres una máquina", "eres humano", "eres humana", "eres una persona",
    "eres real", "es un robot", "es un bot", "esto es un bot", "hablo con una persona",
    "hablando con una persona", "hablo con un humano", "eres ia", "eres una ia",
    "é um robô", "é um bot", "você é humano", "falando com uma pessoa", "é uma pessoa real",
    "êtes-vous un robot", "es-tu un bot", "c'est un bot", "je parle à un humain",
    "vous êtes une personne", "êtes-vous humain",
    "bist du ein bot", "sind sie ein roboter", "bist du ein mensch", "spreche ich mit einem menschen",
    "sei un bot", "sei umano", "sei una persona", "parlo con una persona",
    "ben je een bot", "spreek ik met een mens", "ben je een mens",
    "czy jesteś botem", "rozmawiam z człowiekiem", "jesteś człowiekiem",
    "ты бот", "вы бот", "это робот", "это бот", "говорю с человеком", "вы человек",
    "ти бот", "ви бот", "це робот", "ви людина",
    "هل أنت روبوت", "هل أنت إنسان", "هل أنت بوت",
    "你是机器人", "是机器人吗", "是真人吗", "你是真人", "是人工智能吗",
    "人間ですか", "ボットですか", "AIですか", "機械ですか",
    "사람인가요", "사람이에요", "봇인가요", "로봇인가요",
    "bạn là người thật", "có phải bot", "có phải người thật", "là robot",
    "tao ka ba", "bot ka ba", "robot ka ba",
  ]),
});

// ---------------------------------------------------------------------------
// regex construction — Unicode-aware boundaries, because \b is ASCII-only
// ---------------------------------------------------------------------------

const LETTER_CLASS = "\\p{L}\\p{M}";
const UNSPACED_SCRIPT = /[぀-ヿ㐀-䶿一-鿿가-힯฀-๿]/u;
const SENTENCE_GAP = "[^.!?\\n\\u3002\\uFF01\\uFF1F]";

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `\b` is defined in terms of [A-Za-z0-9_], so `\bне\b` can NEVER match — a
 * silent no-op that would have left every Cyrillic term in this file dead.
 * Unicode lookarounds are the only correct boundary. CJK/Kana/Hangul get none
 * at all, because those scripts do not put spaces between words.
 *
 * A trailing "*" marks a stem (leading boundary only); everything else is a
 * whole word.
 */
function termPattern(term) {
  const raw = String(term).trim();
  const stem = raw.endsWith("*");
  const word = stem ? raw.slice(0, -1) : raw;
  const body = escapeRe(word).replace(/\s+/g, "\\s+");
  if (UNSPACED_SCRIPT.test(word)) return body;
  const tail = stem ? "" : `(?![${LETTER_CLASS}])`;
  return `(?<![${LETTER_CLASS}])${body}${tail}`;
}

function termGroup(terms) {
  return terms.map(termPattern).join("|");
}

function termRegex(terms, flags = "iu") {
  return new RegExp(termGroup(terms), flags);
}

/** X within `gap` characters of Y, in either order, without crossing a sentence. */
function proximityRegex(left, right, gap = 60) {
  const a = typeof left === "string" ? left : termGroup(left);
  const b = typeof right === "string" ? right : termGroup(right);
  return new RegExp(
    `(?:${a})${SENTENCE_GAP}{0,${gap}}(?:${b})|(?:${b})${SENTENCE_GAP}{0,${gap}}(?:${a})`,
    "iu",
  );
}

const IDENTITY_QUESTION_RE = termRegex(VOCAB.identityQuestion);
const IDENTITY_CLAIM_RE = termRegex(VOCAB.identityClaim);
const NEGATION_RE = termRegex(VOCAB.negation);
const COMMITMENT_RE = proximityRegex(VOCAB.time, VOCAB.commit, 60);
const RELATIVE_HOURS_RE = proximityRegex(VOCAB.time, VOCAB.hours, 50);
const PROMISE_TERMS = Object.freeze(
  Object.entries(VOCAB.promise).map(([label, terms]) => [label, termRegex(terms)]),
);

/**
 * A price with a currency WORD or SYMBOL attached, in any of the supported
 * languages. The guard requires every match to appear verbatim in the corpus,
 * so "150 dólares" against a corpus that publishes "$150" is refused — a
 * converted price is a different price.
 */
// `\d(?:[\d.,]*\d)?` and not `\d[\d.,]*`: the greedy form swallows the full
// stop at the end of "The diagnostic visit is $89." and then demands the
// corpus contain "$89." — a published price refused by its own punctuation.
const AMOUNT = "\\d(?:[\\d.,]*\\d)?";
const CURRENCY_SYMBOLS = "[$\\u20AC\\u00A3\\u00A5\\u20BD\\u20A9\\u20AB]";
const MONEY_RE = new RegExp(
  [
    `${CURRENCY_SYMBOLS}\\s?${AMOUNT}`,
    `${AMOUNT}\\s?${CURRENCY_SYMBOLS}`,
    `${AMOUNT}\\s?(?:${termGroup(VOCAB.currency)})`,
  ].join("|"),
  "giu",
);

/** A localised street type standing next to a number. */
const STREET_ADDRESS_RE = proximityRegex(VOCAB.street, "\\d+", 24);
const STREET_TERM_RE = termRegex(VOCAB.street, "giu");

/** Sentence split that also understands 。！？ and ؟, which carry no space. */
function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|(?<=[。！？；])|(?<=؟)\s*|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// DETECTION
// ---------------------------------------------------------------------------

/**
 * Script first — it is unambiguous and cheap. Order matters: Kana outranks Han
 * (Japanese text contains Han), Hangul outranks Han, and Cyrillic splits on
 * the four letters Ukrainian has and Russian does not.
 */
const SCRIPTS = Object.freeze([
  { code: "ja", re: /[぀-ゟ゠-ヿ]/u },
  { code: "ko", re: /[가-힣ᄀ-ᇿ]/u },
  { code: "zh", re: /[一-鿿㐀-䶿]/u },
  { code: "ar", re: /[؀-ۿݐ-ݿ]/u },
  { code: "uk", re: /[іїєґІЇЄҐ]/u },
  { code: "ru", re: /[Ѐ-ӿ]/u },
  // Deliberately NOT â/ê/ô/ă: those are French, Portuguese and Romanian too.
  // đ/ơ/ư and the U+1EA0 block are Vietnamese to a useful approximation.
  { code: "vi", re: /[đơư]|[Ạ-ỹ]/iu },
]);

/**
 * Latin-script scoring. `chars` is a diacritic fingerprint worth as much as a
 * strong word; `strong` are words that are near-exclusive to the language;
 * `common` are function words, worth one each, which is what carries a long
 * message. Multi-word entries are matched as substrings.
 */
const PROFILES = Object.freeze({
  en: {
    chars: null,
    strong: ["the", "you", "your", "thanks", "hello", "does", "what", "how much", "do you", "is there"],
    common: ["is", "are", "we", "i", "can", "when", "where", "need", "have", "my", "for", "and", "with",
      "hi", "please", "there", "it", "that", "this", "on", "in", "get", "want", "know", "would", "price",
      "cost", "help", "about", "of", "to", "a", "an", "me", "out", "if", "will", "just"],
  },
  es: {
    chars: /[ñ¿¡]/u,
    strong: ["hola", "gracias", "cuánto", "cuanto", "cuesta", "necesito", "ustedes", "tienen", "quiero",
      "señor", "buenas", "favor", "dónde", "cómo", "qué", "sí", "puedo", "está", "estás", "mañana"],
    common: ["que", "de", "la", "el", "los", "las", "un", "una", "por", "para", "con", "en", "y", "es",
      "son", "no", "si", "me", "mi", "su", "tu", "te", "lo", "al", "del", "hay", "muy", "más", "pero",
      "como", "cuando", "donde", "precio", "ayuda", "casa", "hoy", "días", "aire"],
  },
  pt: {
    chars: /[ãõ]/u,
    strong: ["você", "vocês", "obrigado", "obrigada", "quanto", "custa", "preciso", "olá", "não", "sim",
      "orçamento", "fazem", "está", "bom dia", "boa tarde"],
    common: ["que", "de", "da", "do", "os", "as", "um", "uma", "por", "para", "com", "em", "e", "é",
      "são", "me", "meu", "minha", "seu", "tem", "muito", "mais", "mas", "como", "quando", "onde",
      "preço", "ajuda", "casa", "hoje"],
  },
  fr: {
    chars: /[çœàèùâêîôû]/u,
    strong: ["bonjour", "merci", "vous", "combien", "coûte", "besoin", "avez", "êtes", "plaît",
      "pouvez", "votre", "nous", "est-ce", "quel", "j'ai", "je"],
    common: ["le", "la", "les", "un", "une", "des", "de", "du", "et", "est", "sont", "pas", "pour",
      "avec", "dans", "mon", "ma", "que", "qui", "quand", "où", "prix", "aide", "chez", "sur"],
  },
  de: {
    chars: /[äöüß]/u,
    strong: ["hallo", "danke", "ich", "wie viel", "kostet", "brauche", "können", "guten tag", "bitte",
      "haben sie", "sie", "möchte", "wir"],
    common: ["nicht", "und", "ist", "das", "für", "mit", "ein", "eine", "der", "die", "den", "von",
      "auf", "auch", "aber", "wann", "wo", "preis", "hilfe", "haus", "heute", "mein"],
  },
  it: {
    chars: /[àèìòù]/u,
    strong: ["ciao", "grazie", "quanto", "costa", "avete", "vorrei", "buongiorno", "siete", "posso",
      "sono", "perché", "quale"],
    common: ["che", "di", "il", "la", "le", "un", "una", "per", "con", "in", "e", "è", "non", "mi",
      "mio", "molto", "più", "ma", "come", "quando", "dove", "prezzo", "aiuto", "casa", "oggi"],
  },
  nl: {
    chars: null,
    strong: ["hallo", "bedankt", "hoeveel", "kost", "jullie", "hebben", "kunnen", "graag",
      "alstublieft", "goedemiddag", "mijn", "wij", "ik", "een", "het"],
    common: ["niet", "geen", "en", "is", "zijn", "voor", "met", "in", "op", "van", "dat", "die",
      "maar", "wanneer", "waar", "prijs", "hulp", "huis", "vandaag", "ook", "wat"],
  },
  pl: {
    chars: /[ąęłżźćńś]/u,
    strong: ["cześć", "dzień dobry", "dziękuję", "ile", "kosztuje", "macie", "potrzebuję", "proszę",
      "jest", "czy", "tak", "mam"],
    common: ["nie", "i", "w", "na", "do", "z", "to", "co", "jak", "kiedy", "gdzie", "cena", "pomoc",
      "dom", "dzisiaj", "mnie", "was", "moja", "mój"],
  },
  vi: {
    chars: /[ăâđêôơư]/u,
    strong: ["xin chào", "bao nhiêu", "cảm ơn", "được không", "giá", "cần", "tôi", "bạn", "anh", "chị"],
    common: ["có", "không", "của", "và", "cho", "với", "là", "ở", "đến", "này", "khi", "nào", "nhà"],
  },
  tl: {
    chars: null,
    strong: ["magkano", "salamat", "kayo", "puwede", "pwede", "kailangan", "ninyo", "mga", "opo",
      "kumusta", "kamusta", "tanong", "bahay"],
    common: ["po", "ba", "ang", "ng", "sa", "ay", "at", "na", "ko", "mo", "namin", "ito", "yan",
      "kung", "hindi", "wala", "may", "para"],
  },
});

const CHAR_WEIGHT = 3;
const STRONG_WEIGHT = 3;
const COMMON_WEIGHT = 1;
const MIN_SCORE = 3;
const MIN_MARGIN = 2;

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}'’-]+/u)
    .filter(Boolean);
}

function scoreProfile(profile, lower, tokens) {
  let score = 0;
  if (profile.chars && profile.chars.test(lower)) score += CHAR_WEIGHT;
  for (const term of profile.strong) {
    if (term.includes(" ")) { if (lower.includes(term)) score += STRONG_WEIGHT; continue; }
    for (const token of tokens) if (token === term) score += STRONG_WEIGHT;
  }
  for (const term of profile.common) {
    if (term.includes(" ")) { if (lower.includes(term)) score += COMMON_WEIGHT; continue; }
    for (const token of tokens) if (token === term) score += COMMON_WEIGHT;
  }
  return score;
}

/**
 * detectLanguage(text) -> { code, confident, score, margin, method }
 *
 * `confident` is the load-bearing field, not `code`: an unconfident verdict
 * always reads "en", because English is where this system started and a
 * language switch on a coin flip is worse than no switch at all.
 */
function detectLanguage(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  if (!raw.trim()) return { code: DEFAULT_LANGUAGE, confident: false, score: 0, margin: 0, method: "empty" };

  for (const script of SCRIPTS) {
    if (script.re.test(raw)) {
      return { code: script.code, confident: true, score: 99, margin: 99, method: "script" };
    }
  }

  const tokens = tokenize(raw);
  const ranked = Object.entries(PROFILES)
    .map(([code, profile]) => ({ code, score: scoreProfile(profile, lower, tokens) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1] || { score: 0 };
  const margin = best.score - second.score;
  const confident = best.score >= MIN_SCORE && margin >= MIN_MARGIN;
  return {
    code: confident ? best.code : DEFAULT_LANGUAGE,
    confident,
    score: best.score,
    margin,
    method: confident ? "words" : "default",
  };
}

/**
 * detectVisitorLanguage(messages) -> detection
 *
 * The LATEST visitor message decides, because a visitor is allowed to switch.
 * Only when that message is too short to call — "ok", a bare phone number —
 * does it fall back to the conversation so far, so a Spanish thread does not
 * flip to English on the word "ok".
 */
function detectVisitorLanguage(messages) {
  const said = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.direction === "inbound")
    .map((m) => trim(m.body))
    .filter(Boolean);
  if (!said.length) return { code: DEFAULT_LANGUAGE, confident: false, score: 0, margin: 0, method: "no_visitor_text" };

  const latest = detectLanguage(said[said.length - 1]);
  if (latest.confident) return latest;

  const history = detectLanguage(said.slice(-6).join("\n"));
  return history.confident ? { ...history, method: `${history.method}_history` } : latest;
}

// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------

function normalizeLanguageCode(value) {
  const raw = trim(value).toLowerCase().replace(/_/g, "-");
  if (!raw) return "";
  if (SAY[raw]) return raw;
  const base = raw.split("-")[0];
  const aliases = {
    zh: "zh", cmn: "zh", yue: "zh", fil: "tl", ph: "tl", pt: "pt", br: "pt",
    in: "id", iw: "he", ua: "uk", cn: "zh", jp: "ja", kr: "ko",
  };
  const mapped = aliases[base] || base;
  return SAY[mapped] ? mapped : "";
}

function isSupported(code) {
  return Boolean(SAY[trim(code)]);
}

function resolveLanguage(code) {
  const normalized = normalizeLanguageCode(code);
  return normalized || DEFAULT_LANGUAGE;
}

function languageName(code) {
  return (NAMES[resolveLanguage(code)] || NAMES.en).name;
}

function languageEndonym(code) {
  return (NAMES[resolveLanguage(code)] || NAMES.en).endonym;
}

function speakerFor(code) {
  return SAY[resolveLanguage(code)] || SAY.en;
}

function disclosureFor(code, ctx = {}) {
  return speakerFor(code).disclosure({ business: trim(ctx.business) });
}

function handoffFor(code, ctx = {}) {
  return speakerFor(code).handoff({
    business: trim(ctx.business),
    phone: trim(ctx.phone),
    booking: trim(ctx.booking),
  });
}

function leadAckFor(code, ctx = {}) {
  return speakerFor(code).leadAck({
    business: trim(ctx.business),
    name: trim(ctx.name),
    hasPhone: Boolean(ctx.hasPhone),
  });
}

function isIdentityQuestion(value) {
  return IDENTITY_QUESTION_RE.test(String(value || ""));
}

/**
 * The instruction the model gets. Two jobs, and the second is the one that
 * protects the customer: the reply may be TRANSLATED, but the facts inside it
 * may not be CONVERTED. A price rendered into another currency, a phone number
 * reformatted, a street name localised — each of those is a different fact
 * wearing the same sentence.
 */
function languageDirective(code, { confident = true } = {}) {
  const resolved = resolveLanguage(code);
  const name = languageName(resolved);
  const target = confident
    ? `The visitor is writing in ${name} (${languageEndonym(resolved)}). Write your ENTIRE reply in ${name}.`
    : [
      "Write your ENTIRE reply in the same language the visitor is using.",
      `If that language is not one of these, reply in English: ${SUPPORTED_CODES.map(languageName).join(", ")}.`,
    ].join(" ");
  return [
    "=== LANGUAGE ===",
    target,
    "Every sentence in one language — never a mix, never an English preamble in front of a translated answer.",
    "The facts below are written in English. Translate them faithfully when you use them: do not add a detail they",
    "do not contain, and do not drop one they do. An answer the owner wrote himself may be translated, but it must",
    "come out meaning exactly the same thing.",
    "COPY THESE EXACTLY, character for character, even in another language: prices and currency symbols, phone",
    "numbers, street addresses, email addresses and web links. Never convert a currency, never reformat a phone",
    "number, never translate a street name or a business name.",
  ].join("\n");
}

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_CODES,
  detectLanguage,
  detectVisitorLanguage,
  disclosureFor,
  handoffFor,
  isIdentityQuestion,
  isSupported,
  languageDirective,
  languageEndonym,
  languageName,
  leadAckFor,
  normalizeLanguageCode,
  resolveLanguage,
  guard: Object.freeze({
    COMMITMENT_RE,
    IDENTITY_CLAIM_RE,
    MONEY_RE,
    NEGATION_RE,
    PROMISE_TERMS,
    RELATIVE_HOURS_RE,
    STREET_ADDRESS_RE,
    STREET_TERM_RE,
    splitSentences,
  }),
  _test: {
    NAMES,
    PROFILES,
    SAY,
    SCRIPTS,
    VOCAB,
    IDENTITY_QUESTION_RE,
    scoreProfile,
    termPattern,
    tokenize,
  },
};
