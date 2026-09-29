"use strict";

const CORE_VERSION = "answercrew-agent-core-v1";
const DEFAULT_PAYMENT_LINE = "I'll send you a secure payment link instead";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const REQUIRED_PROFILE_FIELDS = ["business_name", "city", "trade", "service_area", "hours", "booking_method"];

const SYSTEM_PROMPT_TEMPLATE = `[Who you are]
You are {{agent_name}}, the voice of {{business_name}} in {{city}} - a {{trade}} business. You sound like the best employee they ever had: warm, quick, genuinely helpful, and you know the business cold. You are an AI and never pretend otherwise when asked - "Yep, I'm {{business_name}}'s AI assistant - I'm also the fastest way to get you booked. What do you need?"

[The prime rule: listen first]
React to what the caller actually said, always, before anything else. Never launch a script. If they open with a story, engage the story. If they're in a hurry, be brisk. If they joke, joke back. Mirror their words when you answer. Every call should sound improvised, because it is.

[What you know - and the honesty rule]
You know this business's profile: services ({{services}}), service area ({{service_area}}), hours ({{hours}}), pricing notes ({{pricing_notes}}), booking method ({{booking_method}}). Answer from it freely and specifically. If a caller asks something NOT in your profile, say so like a human would - "Good question, I don't want to guess on that one. Let me have {{owner_name}} text you the answer today" - and capture it in the message. NEVER invent prices, availability, guarantees, or facts. One made-up answer costs this business a customer.

[Your jobs, in priority order]
1. Never lose the lead: get name, number, and what they need - woven into conversation, never as a form ("And what's the best number for you?").
2. Book it if you can ({{booking_method}}); if you can't, promise the callback window and mean it.
3. Answer questions from the profile, conversationally - two or three details at a time, check in between, never a list dump.
4. Emergencies ({{emergency_keywords}}): skip everything, capture location and callback number, flag urgent, tell them help is being alerted now.
5. Take messages like a pro: repeat the number back grouped three-three-four, confirm the gist in one sentence.

[How you talk]
Short sentences. Contractions always. One question per turn, at the end. Acknowledge before you answer ("Oh no, a burst pipe - okay, let's move fast."). Vary your confirmations; never say the same phrase twice in a row. If interrupted, stop instantly and respond to the interruption. Light humor is welcome when the caller invites it - riff, don't recite. Match their energy and pace. Say prices in words. Never read more than three things in a row.

[Hard lines]
Never claim to be human. Never take payment card details by voice - ever; {{payment_line}}. Angry or abusive callers: stay calm, one apology, capture the issue, promise the owner's callback, end warmly. "Stop calling" or any opt-out on an outbound call: goodbye line, end immediately. Never bad-mouth competitors. Never promise what's not in the profile.

[After every call]
Summary: who called, what they wanted, what was promised, urgency level, exact callback number.`;

function clean(value, max = 1000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function list(value, fallback) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\n]/);
  const normalized = values.map((item) => clean(item, 120)).filter(Boolean).slice(0, 30);
  return normalized.length ? normalized : [fallback];
}

function normalizeBusinessProfile(input = {}, options = {}) {
  const profile = input.business_profile && typeof input.business_profile === "object"
    ? { ...input, ...input.business_profile }
    : { ...input };
  const normalized = {
    agent_name: clean(profile.agent_name || profile.display_name || profile.name, 80) || "Alex",
    business_name: clean(profile.business_name || profile.account_name, 180),
    city: clean(profile.city, 100),
    trade: clean(profile.trade || profile.business_type || profile.industry, 120),
    services: list(profile.services, "general service").join(", "),
    service_area: clean(profile.service_area, 300),
    hours: clean(profile.hours, 300),
    pricing_notes: clean(profile.pricing_notes, 600) || "No prices are quoted unless listed here",
    booking_method: clean(profile.booking_method, 300),
    owner_name: clean(profile.owner_name || profile.contact_name, 100) || "the owner",
    owner_notification_phone: clean(profile.owner_notification_phone || profile.notificationPhone, 80),
    emergency_keywords: list(profile.emergency_keywords, "urgent").join(", "),
    payment_line: clean(profile.payment_line, 300) || DEFAULT_PAYMENT_LINE,
    voice_id: clean(profile.voice_id || process.env.ANSWERCREW_DEFAULT_ELEVENLABS_VOICE_ID, 200) || DEFAULT_VOICE_ID,
    background_sound: ["off", "office"].includes(clean(profile.background_sound, 20).toLowerCase())
      ? clean(profile.background_sound, 20).toLowerCase()
      : "office",
  };

  if (!options.allowIncomplete) {
    const missing = REQUIRED_PROFILE_FIELDS.filter((key) => !normalized[key]);
    if (missing.length) {
      const error = new Error(`Missing business profile fields: ${missing.join(", ")}`);
      error.code = "business_profile_incomplete";
      error.statusCode = 400;
      error.detail = { missing };
      throw error;
    }
  }
  return normalized;
}

function businessProfileStatus(input = {}) {
  const profile = normalizeBusinessProfile(input, { allowIncomplete: true });
  const missing = REQUIRED_PROFILE_FIELDS.filter((key) => !profile[key]);
  return { complete: missing.length === 0, missing, required: [...REQUIRED_PROFILE_FIELDS], profile };
}

function renderSystemPrompt(input = {}, options = {}) {
  const profile = normalizeBusinessProfile(input, options);
  const prompt = SYSTEM_PROMPT_TEMPLATE.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => profile[key] || "");
  return { profile, prompt };
}

function buildAnswerCrewAssistantConfig(input = {}, options = {}) {
  const { profile, prompt } = renderSystemPrompt(input, options);
  const voiceExperience = options.experienceTier === "signature" ? "signature" : "natural";
  const signature = voiceExperience === "signature";
  const languageDirective = signature
    ? "\n\n[Language]\nDetect the caller's language and continue naturally in that language. If they switch languages, switch with them. Keep the post-call summary and structured fields in English, and record the caller's primary language."
    : "\n\n[Language]\nSpeak English. If the caller needs another language, take a message and flag that language for the owner.";
  const accountRef = clean(options.accountId, 80) || "demo";
  const webhookBase = clean(options.webhookBase, 500).replace(/\/+$/, "");
  const firstMessage = `Thanks for calling ${profile.business_name}, this is ${profile.agent_name} - what can I do for you?`;
  const voicemailMessage = `Hi, this is ${profile.agent_name}, ${profile.business_name}'s AI assistant. Sorry we missed you. Please leave your name, number, and what you need, and ${profile.owner_name} will get back to you.`;
  const config = {
    name: clean(`AnswerCrew ${accountRef.slice(0, 12)} | ${profile.agent_name}`, 40),
    firstMessage,
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model: signature ? "gpt-4.1" : "gpt-4.1-mini",
      temperature: 0.6,
      messages: [{ role: "system", content: `${prompt}${languageDirective}` }],
    },
    voice: {
      provider: "11labs",
      voiceId: profile.voice_id,
      model: "eleven_turbo_v2_5",
      stability: signature ? 0.42 : 0.35,
      similarityBoost: signature ? 0.82 : 0.7,
      style: signature ? 0.48 : 0.35,
      useSpeakerBoost: signature,
      optimizeStreamingLatency: signature ? 3 : 2,
      chunkPlan: { enabled: true, minCharacters: 48 },
    },
    transcriber: { provider: "deepgram", model: "nova-3", language: signature ? "multi" : "en" },
    startSpeakingPlan: { waitSeconds: 0.4, smartEndpointingPlan: { provider: "livekit" } },
    stopSpeakingPlan: { numWords: 2 },
    backchannelingEnabled: true,
    backgroundDenoisingEnabled: true,
    backgroundSound: profile.background_sound,
    silenceTimeoutSeconds: 25,
    maxDurationSeconds: 480,
    voicemailDetection: { provider: "vapi" },
    voicemailMessage,
    artifactPlan: { recordingEnabled: false },
    analysisPlan: {
      summaryPlan: { enabled: true },
      structuredDataPlan: {
        enabled: true,
        schema: {
          type: "object",
          properties: {
            caller_name: { type: "string" },
            callback_number: { type: "string" },
            request: { type: "string" },
            promise: { type: "string" },
            urgency: { type: "string", enum: ["routine", "priority", "urgent", "emergency"] },
            caller_language: { type: "string" },
            sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
            outcome: { type: "string", enum: ["booked", "callback_requested", "message_taken", "resolved", "voicemail", "opt_out", "other"] },
          },
          required: ["request", "urgency", "outcome"],
        },
      },
    },
    metadata: { product: "answercrew", core_version: CORE_VERSION, account_ref: accountRef, voice_experience: voiceExperience },
  };
  if (webhookBase) {
    config.server = { url: `${webhookBase}/api/webhooks/vapi-customer` };
    if (options.webhookSecret) config.server.secret = clean(options.webhookSecret, 1000);
  }
  return { config, profile, prompt, coreVersion: CORE_VERSION, voiceExperience };
}

module.exports = {
  CORE_VERSION,
  REQUIRED_PROFILE_FIELDS,
  SYSTEM_PROMPT_TEMPLATE,
  businessProfileStatus,
  buildAnswerCrewAssistantConfig,
  normalizeBusinessProfile,
  renderSystemPrompt,
};
