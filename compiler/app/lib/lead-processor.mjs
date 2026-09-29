import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "config", "enterprise-domains.json");
const clean = (value, max = 3000) => String(value ?? "").trim().slice(0, max);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function configuredDomains(env = process.env) {
  let fileDomains = [];
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    fileDomains = Array.isArray(parsed) ? parsed : parsed.domains || [];
  } catch {}
  const envDomains = clean(env.SITEFORGE_ENTERPRISE_DOMAINS, 10000).split(",");
  return new Set([...fileDomains, ...envDomains].map((domain) => clean(domain, 255).toLowerCase().replace(/^@/, "")).filter(Boolean));
}

export function normalizeLeadPayload(input = {}) {
  const data = input.data && typeof input.data === "object" ? input.data : input;
  const contact = clean(data.email_or_phone, 180);
  const email = clean(data.email, 160) || (emailPattern.test(contact) ? contact : "");
  const phone = clean(data.phone, 40) || (!email && contact ? contact : "");
  return {
    id: clean(input.id || data.id, 120),
    timestamp: clean(input.timestamp || data.timestamp, 60) || new Date().toISOString(),
    form_id: clean(input.form_id || data.form_id, 120) || "siteforge-lead",
    data: {
      name: clean(data.name, 100),
      email: emailPattern.test(email) ? email.toLowerCase() : "",
      phone,
      message: clean(data.body || data.message, 3000),
      business_name: clean(data.business_name, 160),
    },
    utm_source: clean(input.utm_source || data.utm_source, 120),
    utm_medium: clean(input.utm_medium || data.utm_medium, 120),
    utm_campaign: clean(input.utm_campaign || data.utm_campaign, 160),
    utm_content: clean(input.utm_content || data.utm_content, 160),
    utm_term: clean(input.utm_term || data.utm_term, 160),
    consent_given: input.consent_given === true || data.consent_given === true || input.consent_given === "true" || data.consent_given === "true",
    honeypot: clean(input.website || data.website, 300),
  };
}

export function scoreLead(payload, { env = process.env } = {}) {
  const lead = normalizeLeadPayload(payload);
  let score = 0;
  if (lead.data.name) score += 10;
  if (lead.data.email) score += 20;
  if (lead.data.phone) score += 20;
  if (lead.data.message.length >= 20) score += 20;
  if (lead.utm_source) score += 5;
  if (lead.consent_given) score += 5;
  const domain = lead.data.email.split("@")[1] || "";
  const enterprise = Boolean(domain && configuredDomains(env).has(domain));
  if (enterprise) score += 20;
  return {
    score: Math.min(100, score),
    segment: enterprise ? "enterprise" : score >= 60 ? "high_intent" : score >= 35 ? "qualified" : "standard",
    enterprise,
    email_domain: domain || null,
  };
}

async function requestWithRetries({ url, options, fetchImpl, retries = 3, sleepImpl = sleep }) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, options);
      if (response.ok) return { ok: true, status: response.status, attempts: attempt + 1 };
      lastError = new Error(`notification returned ${response.status}`);
      lastError.status = response.status;
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await sleepImpl(Math.min(1200, 150 * (2 ** attempt)));
  }
  return { ok: false, status: lastError?.status || null, attempts: retries + 1, error: "notification_failed" };
}

const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

export async function processLeadNotification(payload, {
  ownerEmail,
  projectName = "SiteForge website",
  leadId = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  onFailure = async () => {},
} = {}) {
  const lead = normalizeLeadPayload(payload);
  const scoring = scoreLead(lead, { env });
  const channels = {};
  const failures = [];
  const recipient = clean(ownerEmail, 160);
  const resendKey = clean(env.RESEND_API_KEY, 500);
  const resendFrom = clean(env.SITEFORGE_LEAD_FROM || env.RESEND_FROM, 200);

  if (recipient && emailPattern.test(recipient) && resendKey && resendFrom && typeof fetchImpl === "function") {
    const prefix = scoring.enterprise ? "[ENTERPRISE] " : scoring.segment === "high_intent" ? "[HIGH INTENT] " : "";
    const result = await requestWithRetries({
      url: "https://api.resend.com/emails",
      fetchImpl,
      sleepImpl,
      options: {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `siteforge-lead/${leadId || lead.id || lead.timestamp}` },
        body: JSON.stringify({
          from: resendFrom,
          to: [recipient],
          subject: `${prefix}New website lead - ${clean(projectName, 120)}`,
          html: `<h1>New website lead</h1><p><b>${escapeHtml(lead.data.name || "Unnamed visitor")}</b></p><p>${escapeHtml(lead.data.email || lead.data.phone || "No contact supplied")}</p><p>${escapeHtml(lead.data.message || "No message supplied")}</p><hr><p>Lead score: ${scoring.score}/100 (${escapeHtml(scoring.segment)})</p>`,
        }),
      },
    });
    channels.resend = result;
    if (!result.ok) failures.push({ channel: "resend", attempts: result.attempts, status: result.status });
  } else {
    channels.resend = { ok: false, skipped: true, reason: "not_configured" };
  }

  const slackUrl = clean(env.SITEFORGE_LEAD_WEBHOOK_URL || env.LEAD_WEBHOOK_URL, 1000);
  if (slackUrl && validWebhookUrl(slackUrl) && typeof fetchImpl === "function") {
    const result = await requestWithRetries({
      url: slackUrl,
      fetchImpl,
      sleepImpl,
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `New ${scoring.segment} website lead for ${clean(projectName, 120)}. Score ${scoring.score}/100. Open SiteForge to review contact details.` }),
      },
    });
    channels.slack = result;
    if (!result.ok) failures.push({ channel: "slack", attempts: result.attempts, status: result.status });
  } else {
    channels.slack = { ok: false, skipped: true, reason: "not_configured" };
  }

  for (const failure of failures) {
    await onFailure({
      lead_id: leadId || lead.id || null,
      channel: failure.channel,
      attempts: failure.attempts,
      response_status: failure.status,
      error_code: "notification_failed",
      failed_at: new Date().toISOString(),
    });
  }

  return { scoring, channels, failed: failures.length > 0 };
}

function validWebhookUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}
