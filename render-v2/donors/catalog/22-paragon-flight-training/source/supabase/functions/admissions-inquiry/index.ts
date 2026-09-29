// Admissions inquiry — Resend-backed form handler.
// Reads RESEND_WSS_AI_API_KEY (preferred) or RESEND_API_KEY server-side only.
// If neither is configured, returns 501 so the client falls back to demo mode
// without exposing any secret state to the browser.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

const BodySchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(7).max(20),
  interest: z.enum(["discovery", "private", "instrument", "commercial", "career", "other"]),
  city: z.string().trim().max(60).optional().or(z.literal("")),
  message: z.string().trim().max(1000).optional().or(z.literal("")),
  company: z.string().max(0).optional(), // honeypot
  meta: z
    .object({
      form_type: z.string().max(64).optional(),
      source_page: z.string().max(255).optional(),
      submitted_at: z.string().max(64).optional(),
    })
    .optional(),
});

const SENDER = "Woodward Software <forms@wss-ai.com>";
const RECIPIENT = Deno.env.get("ADMISSIONS_RECIPIENT_EMAIL"); // optional override
const CLIENT_SLUG = "paragonflight-com";
const TARGET_DOMAIN = "fort-myers-paragonflight.wss-ai.com";

const interestLabel: Record<string, string> = {
  discovery: "Discovery Flight",
  private: "Private Pilot",
  instrument: "Instrument Rating",
  commercial: "Commercial Pilot",
  career: "Career Pathway",
  other: "Other",
};

// Per-IP token bucket — simple anti-spam guard.
const bucket = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string, limit = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = bucket.get(ip);
  if (!entry || entry.reset < now) {
    bucket.set(ip, { count: 1, reset: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Anti-spam: per-IP rate limit
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  if (!rateLimit(ip)) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const data = parsed.data;

  // Honeypot — silently accept, do not send.
  if (data.company && data.company.length > 0) {
    return new Response(JSON.stringify({ ok: true, mode: "ignored" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey =
    Deno.env.get("RESEND_WSS_AI_API_KEY") || Deno.env.get("RESEND_API_KEY");

  if (!apiKey || !RECIPIENT) {
    // Not configured — tell the client cleanly so it falls back to demo state.
    return new Response(
      JSON.stringify({
        error: "Email delivery not configured",
        reason: !apiKey ? "missing_api_key" : "missing_recipient",
      }),
      { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const subject = `New admissions inquiry — ${data.name} (${interestLabel[data.interest]})`;

  const html = `
    <div style="font-family:'IBM Plex Sans',-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
      <h2 style="margin:0 0 8px;font-family:'Space Grotesk',sans-serif;letter-spacing:-0.01em;">
        New admissions inquiry
      </h2>
      <p style="margin:0 0 24px;color:#475569;font-size:13px;">
        Submitted via ${TARGET_DOMAIN}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tbody>
          ${row("Name", data.name)}
          ${row("Email", `<a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a>`)}
          ${row("Phone", `<a href="tel:${escapeHtml(data.phone)}">${escapeHtml(data.phone)}</a>`)}
          ${row("City", data.city || "—")}
          ${row("Primary interest", interestLabel[data.interest])}
          ${row("Message", (data.message || "—").replace(/\n/g, "<br>"))}
          ${row("Source page", data.meta?.source_page || "/")}
          ${row("Submitted at", data.meta?.submitted_at || new Date().toISOString())}
        </tbody>
      </table>
    </div>
  `;

  const text = [
    `New admissions inquiry — ${TARGET_DOMAIN}`,
    ``,
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone}`,
    `City: ${data.city || "—"}`,
    `Interest: ${interestLabel[data.interest]}`,
    `Message: ${data.message || "—"}`,
    `Source: ${data.meta?.source_page || "/"}`,
    `At: ${data.meta?.submitted_at || new Date().toISOString()}`,
  ].join("\n");

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: SENDER,
      to: [RECIPIENT],
      reply_to: data.email,
      subject,
      html,
      text,
      tags: [
        { name: "client_slug", value: CLIENT_SLUG },
        { name: "domain", value: TARGET_DOMAIN.replace(/\./g, "_") },
        { name: "form_type", value: data.meta?.form_type || "admissions_inquiry" },
        { name: "source_page", value: (data.meta?.source_page || "/").slice(0, 60) },
      ],
    }),
  });

  if (!resendRes.ok) {
    const body = await resendRes.text();
    console.error("[admissions-inquiry] resend error", resendRes.status, body);
    return new Response(JSON.stringify({ error: "Email send failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, mode: "live" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 12px;background:#f1f5f9;border:1px solid #e2e8f0;font-weight:600;width:160px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;background:#ffffff;border:1px solid #e2e8f0;vertical-align:top;">${value}</td>
    </tr>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
