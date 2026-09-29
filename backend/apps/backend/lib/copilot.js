"use strict";

const { selectRows } = require("./store");

const SENDABLE = ["previewed", "packeted", "reported"];
const ALLOWED_ACTIONS = new Set(["none", "advance", "run_dry_campaign", "run_live_campaign", "mine"]);

function rows(result) {
  return Array.isArray(result && result.rows) ? result.rows : [];
}

function num(input, fallback) {
  const match = String(input || "").match(/\b(\d{1,4})\b/);
  return match ? parseInt(match[1], 10) : fallback;
}

function clampBatch(value, fallback = 10) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), 100);
}

function promptPreview(prompt) {
  return String(prompt || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

async function snapshot() {
  const [prospectsResult, emailsResult] = await Promise.all([
    selectRows("ghost_agency_prospects", { order: "updated_at.desc", limit: 500 }),
    selectRows("ghost_agency_email_log", { order: "sent_at.desc", limit: 500 }),
  ]);
  const prospects = rows(prospectsResult);
  const emails = rows(emailsResult);
  const byStatus = {};
  for (const prospect of prospects) {
    const status = prospect.status || "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  const sendable = prospects.filter((prospect) => SENDABLE.includes(prospect.status) && (prospect.email || prospect.owner_email)).length;
  const sent = emails.filter((email) => email.mode === "sent" && !email.suppressed).length;
  const withEmail = prospects.filter((prospect) => prospect.email || prospect.owner_email).length;
  return {
    total: prospects.length,
    byStatus,
    sendable,
    sent,
    withEmail,
    llmConfigured: llmConfigured(),
    placesConfigured: Boolean(process.env.GOOGLE_PLACES_API_KEY && process.env.GOOGLE_PLACES_API_KEY.trim()),
  };
}

function statsReply(stats) {
  const statusLine = Object.keys(stats.byStatus || {})
    .map((key) => `${key}: ${stats.byStatus[key]}`)
    .join(", ") || "none";
  return (
    "Here's where things stand:\n" +
    `- Leads in system: ${stats.total}\n` +
    `- Pipeline: ${statusLine}\n` +
    `- Ready to send (queued): ${stats.sendable}\n` +
    `- Emails delivered lifetime: ${stats.sent}\n` +
    `- Emails reachable (have an address): ${stats.withEmail}/${stats.total}`
  );
}

// Known verticals the miner can target. A command mentioning a vertical NOT
// in this list must be refused, never silently swapped for a default — that
// silent-swap was the "tattoo artists in Dallas became landscaping in Orange
// County" bug. Keep this list in sync with the boilerplates/templates we
// actually have.
// Priority order (owner, 2026-07-21): sorted for the ideal buyer — a solo /
// owner-operator whose website directly earns their money, who can afford
// $149/mo without blinking, and who personally reads their own inbox.
// Tier 1 = image-driven solo artists (portfolio IS the product), Tier 2 =
// high-intent solo pros, Tier 3 = premium auto/personal services, Tier 4 =
// high-margin home-service trades. Matching is order-independent; this order
// is the mining/outreach priority.
const APPROVED_CATEGORIES = [
  // Tier 1 — image-driven solo artists
  { name: "tattoo", aliases: ["tattoo artist", "tattoo artists", "tattoo shop"] },
  { name: "med spa", aliases: ["medical spa", "medspa"] },
  { name: "dental", aliases: ["dentist", "dentists"] },
  { name: "photographer", aliases: ["photography"] },
  { name: "piercing", aliases: ["piercer", "piercing studio"] },
  // Tier 2 — high-intent solo professionals
  { name: "attorney", aliases: ["law firm", "lawyer", "solo attorney", "legal services"] },
  { name: "massage", aliases: ["massage therapist"] },
  { name: "hair salon", aliases: ["hair salons"] },
  { name: "barber", aliases: ["barbershop", "barber shop"] },
  { name: "nail studio", aliases: ["nail salon", "nail salons"] },
  { name: "wedding vendor", aliases: ["wedding vendors"] },
  { name: "event vendor", aliases: ["event vendors"] },
  // NOTE: deliberately NO bare "real estate" alias — approvedIndustry matches
  // by substring with longest-alias-first, and bare "real estate" (11 chars)
  // would out-rank "attorney" (8 chars) on a "real estate attorney" lead and
  // misroute it to the realty donor. "photographer" (12 chars) still wins
  // "real estate photographer" either way. The donor-verticals alias table
  // carries "real estate" safely — it compares whole industry strings.
  { name: "real estate agent", aliases: ["realtor", "realtors", "real estate agency", "real estate broker", "realty"] },
  // Tier 3 — premium auto / personal services
  { name: "auto detailing", aliases: ["car detailing", "detailer"] },
  { name: "ceramic coating", aliases: ["ceramic coatings"] },
  // Tier 4 — high-margin home-service trades
  { name: "roofing", aliases: ["roofer", "roofers"] },
  { name: "water damage restoration", aliases: ["water damage", "restoration"] },
  { name: "hvac", aliases: ["heating and air", "air conditioning"] },
  { name: "plumbing", aliases: ["plumber", "plumbers"] },
  { name: "home remodeling", aliases: ["remodeler", "remodeling contractor"] },
  { name: "concrete", aliases: ["concrete contractor"] },
  { name: "electrical", aliases: ["electrician", "electricians", "electrical contractor"] },
  { name: "masonry", aliases: ["mason"] },
  // NOTE: "home remodeling" three lines up already owns the remodel* aliases;
  // this entry must never claim them or the two categories fight (measured:
  // the genie-evidence test broke the first time this entry overlapped).
  {
    name: "general contractor",
    aliases: [
      "general contracting", "carpenter", "carpenters", "carpentry",
      "construction", "construction company", "framing", "cabinetry",
      "trim carpentry",
    ],
  },
  {
    name: "landscaping",
    aliases: [
      "landscaper", "hardscaping", "gardening", "garden services",
      "lawn garden",
    ],
  },
  {
    name: "tree service",
    aliases: ["tree services", "tree removal", "stump grinding", "arborist", "arborists"],
  },
  { name: "fencing", aliases: ["fence contractor"] },
  { name: "garage door", aliases: ["garage doors"] },
  { name: "pest control", aliases: ["exterminator"] },
];

function approvedIndustry(input) {
  const lower = String(input || "").toLowerCase();
  const matches = APPROVED_CATEGORIES.flatMap((category) =>
    [category.name, ...category.aliases].map((alias) => ({ alias, name: category.name })),
  ).sort((a, b) => b.alias.length - a.alias.length);
  const match = matches.find(({ alias }) => lower.includes(alias));
  return match ? match.name : "";
}

function parseMineIntent(prompt, lower) {
  const count = num(lower, 10);
  const locMatch =
    prompt.match(/\bin ([A-Za-z .,'-]+)$/i) ||
    prompt.match(/\bin ([A-Za-z .,'-]+?)(?: for| with|\.|$)/i);
  const industry = approvedIndustry(lower);
  const location = locMatch ? locMatch[1].trim() : "";

  const missing = [];
  if (!industry) missing.push("industry");
  if (!location) missing.push("city/location");
  if (missing.length) {
    // Refuse rather than silently defaulting to landscaping / Orange County —
    // an unrecognized vertical or missing city must stop the run, not guess.
    return {
      ok: false,
      reply:
        `I couldn't confidently parse ${missing.join(" and ")} from "${prompt}". ` +
        `Say it like "mine tattoo artists in Dallas, TX" — name a real vertical and a real city. ` +
        `Nothing was run.`,
      action: "none",
      params: {},
      provider: "rules",
    };
  }

  return {
    ok: true,
    // Keep this echo deterministic. The console uses this object as the
    // confirmation plan; it must never silently substitute a default market
    // or category before the miner receives it.
    reply: `Parsed mining plan: industry="${industry}"; location="${location}"; limit=${count}. Confirm to mine.`,
    action: "mine",
    params: { industry, location, limit: count },
    needsConfirm: true,
    confirmationRequired: true,
    provider: "rules",
  };
}

function parseDeterministic(prompt, stats) {
  const lower = String(prompt || "").toLowerCase();
  if (/\b(advance|build previews?|next stage|proceed)\b/.test(lower)) {
    return {
      ok: true,
      reply: "Advancing the pipeline - building previews for any leads at 'new'.",
      action: "advance",
      params: {},
      provider: "rules",
    };
  }
  if (/\bmine|harvest|find (new )?leads?|scrape|prospect\b/.test(lower)) {
    return parseMineIntent(prompt, lower);
  }
  if (/\b(live|real|actually send|send for real)\b/.test(lower) && /\b(send|campaign|email|blast|outreach)\b/.test(lower)) {
    const batch = clampBatch(num(lower, 10), 10);
    return {
      ok: true,
      reply: `Ready to send a LIVE campaign to ${batch} queued leads. Confirm to proceed.`,
      action: "run_live_campaign",
      params: { batch },
      provider: "rules",
    };
  }
  if (/\b(dry.?run|test|preview|simulate)\b/.test(lower) && /\b(send|campaign|email|batch|run)\b/.test(lower)) {
    const batch = clampBatch(num(lower, 10), 10);
    return {
      ok: true,
      reply: `Running a DRY-RUN campaign over ${batch} leads - composing and compliance-checking, sending nothing.`,
      action: "run_dry_campaign",
      params: { batch },
      provider: "rules",
    };
  }
  if (/\b(run|start|launch|kick off)\b.*\bcampaign\b/.test(lower) || (/\bcampaign\b/.test(lower) && /\b(now|go)\b/.test(lower))) {
    const batch = clampBatch(num(lower, 10), 10);
    return {
      ok: true,
      reply: `I'll run a DRY-RUN of ${batch} first (safe default). Say "send live ${batch}" to actually deliver.`,
      action: "run_dry_campaign",
      params: { batch },
      provider: "rules",
    };
  }
  if (/\bhow many|count|status|summary|overview|queued|reach|report|doing|going|progress|leads?|sent|emails?\b/.test(lower)) {
    if (!stats) return { needsSnapshot: true };
    return {
      ok: true,
      reply: statsReply(stats),
      action: "none",
      stats,
      provider: "rules",
    };
  }
  return null;
}

function llmProvider() {
  const requested = (process.env.GHOST_AGENCY_LLM_PROVIDER || "").trim().toLowerCase();
  if (requested) return requested;
  if (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GHOST_AGENCY_LLM_KEY) return "anthropic";
  return "openai";
}

function llmConfigured() {
  return Boolean(
    (process.env.GHOST_AGENCY_LLM_KEY && process.env.GHOST_AGENCY_LLM_KEY.trim()) ||
      (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) ||
      (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()),
  );
}

function systemPrompt(stats = {}) {
  return [
    "You are the Woodward Ghost Agency cockpit Copilot.",
    "Return ONLY a JSON object with keys: reply, action, params.",
    `Allowed actions: ${[...ALLOWED_ACTIONS].join(", ")}.`,
    "Never execute sends, charges, publishes, deletes, or external side effects. Return an action for the UI to confirm.",
    "Use run_dry_campaign for ambiguous campaign requests. Use run_live_campaign only when the user explicitly asks for live/real sending.",
    "Drafting, explaining, support copy, planning, and read-only analysis should use action none.",
    "For mine actions, params should include industry, location, and limit.",
    "For campaign actions, params should include batch.",
    "Current stats:",
    JSON.stringify(stats),
  ].join("\n");
}

function extractTextFromOpenAi(json = {}) {
  if (typeof json.output_text === "string") return json.output_text;
  if (Array.isArray(json.output)) {
    return json.output
      .flatMap((item) => item.content || [])
      .map((part) => part.text || part.output_text || "")
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(json.choices)) {
    return json.choices.map((choice) => choice.message && choice.message.content).filter(Boolean).join("\n");
  }
  return "";
}

function extractTextFromAnthropic(json = {}) {
  if (Array.isArray(json.content)) {
    return json.content.map((part) => part.text || "").filter(Boolean).join("\n");
  }
  return "";
}

async function callOpenAi(prompt, stats) {
  const key = (process.env.OPENAI_API_KEY || process.env.GHOST_AGENCY_LLM_KEY || "").trim();
  if (!key) return { ok: false, error: "openai_key_missing" };
  const endpoint = (process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses").trim();
  const model = (process.env.GHOST_AGENCY_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: systemPrompt(stats) },
        { role: "user", content: prompt },
      ],
      max_output_tokens: 700,
      temperature: 0.2,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, status: response.status, error: json.error || json };
  return { ok: true, provider: "openai", text: extractTextFromOpenAi(json) };
}

async function callAnthropic(prompt, stats) {
  const key = (process.env.ANTHROPIC_API_KEY || (llmProvider() === "anthropic" ? process.env.GHOST_AGENCY_LLM_KEY : "") || "").trim();
  if (!key) return { ok: false, error: "anthropic_key_missing" };
  const model = (process.env.GHOST_AGENCY_LLM_MODEL || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest").trim();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt(stats),
      max_tokens: 700,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, status: response.status, error: json.error || json };
  return { ok: true, provider: "anthropic", text: extractTextFromAnthropic(json) };
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
  }
  throw new Error("llm_json_parse_failed");
}

function normalizeLlmResult(parsed = {}, provider) {
  let action = String(parsed.action || "none").trim();
  if (!ALLOWED_ACTIONS.has(action)) action = "none";
  const params = parsed.params && typeof parsed.params === "object" ? { ...parsed.params } : {};
  if (action === "run_live_campaign" || action === "run_dry_campaign") {
    params.batch = clampBatch(params.batch, 10);
  }
  if (action === "mine") {
    params.limit = clampBatch(params.limit, 10);
    const industry = approvedIndustry(params.industry);
    const location = String(params.location || "").trim().slice(0, 120);
    if (!industry || !location) {
      return {
        ok: false,
        refused: true,
        reply: "I could not confidently parse an approved industry and city/location. Nothing was run.",
        action: "none",
        params: {},
        provider,
      };
    }
    return {
      ok: false,
      refused: true,
      reply: `For safety, use the explicit command: "mine ${industry} in ${location}". Nothing was run.`,
      action: "none",
      params: {},
      provider,
      reason: "mine_requires_deterministic_command",
    };
  }
  const result = {
    ok: true,
    reply: String(parsed.reply || "I parsed that, but I need a clearer next step.").slice(0, 4000),
    action,
    params,
    provider,
  };
  return result;
}

async function runLlm(prompt, stats) {
  if (!llmConfigured()) {
    return {
      ok: false,
      mode: "not_configured",
      error: "Set GHOST_AGENCY_LLM_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to unlock free-form Copilot.",
    };
  }
  const raw = llmProvider() === "anthropic" ? await callAnthropic(prompt, stats) : await callOpenAi(prompt, stats);
  if (!raw.ok) return raw;
  return normalizeLlmResult(parseJsonObject(raw.text), raw.provider);
}

function fallbackReply() {
  return {
    ok: true,
    action: "none",
    reply:
      "I can do these right now: ask about status/leads/emails, \"advance pipeline\", " +
      "\"dry-run campaign of 5\", \"send live 10\", or \"mine roofing in San Diego\". " +
      "Connect an LLM key to unlock free-form questions, site-message drafting, and richer planning.",
    llmConfigured: llmConfigured(),
    provider: "fallback",
  };
}

module.exports = {
  APPROVED_CATEGORIES,
  approvedIndustry,
  fallbackReply,
  llmConfigured,
  normalizeLlmResult,
  parseDeterministic,
  promptPreview,
  runLlm,
  snapshot,
  statsReply,
};
