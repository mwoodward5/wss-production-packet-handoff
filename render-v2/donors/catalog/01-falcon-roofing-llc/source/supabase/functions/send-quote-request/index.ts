import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.104.0/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().min(7, "Phone is required").max(40),
  email: z.string().trim().email("Valid email is required").max(255),
  service: z.string().trim().min(1, "Service is required").max(120),
  address: z.string().trim().max(255).optional().default(""),
  message: z.string().trim().min(1, "Message is required").max(4000),
  // Honeypot — must be empty. Bots fill hidden fields.
  website: z.string().max(0).optional().default(""),
});

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const TO_EMAIL = "mforchione@falcon-roofing.net";
const DEFAULT_FROM = Deno.env.get("RESEND_FROM_EMAIL") || "leads@wss-ai.com";
const WSS_LEAD_COPY_EMAIL = Deno.env.get("WSS_LEAD_COPY_EMAIL") || "adclimbercl@gmail.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse + validate
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const data = parsed.data;

  // Honeypot — silently accept (return ok) so bots don't probe, but don't email.
  if (data.website && data.website.length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM = Deno.env.get("RESEND_FROM_EMAIL") || DEFAULT_FROM;

  if (!RESEND_API_KEY) {
    // No silent fake success.
    console.error("send-quote-request: RESEND_API_KEY not configured");
    return new Response(
      JSON.stringify({
        error:
          "Email delivery is not yet active. Please call (614) 715-0496 or email mforchione@falcon-roofing.net directly — we'll get right back to you.",
        code: "email_not_configured",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const subject = `New quote request — ${data.name} (${data.service})`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#16181c;line-height:1.5">
      <h2 style="margin:0 0 12px;color:#16181c">New quote request — Falcon Roofing</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280"><strong>Name</strong></td><td>${escapeHtml(data.name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280"><strong>Phone</strong></td><td><a href="tel:${escapeHtml(data.phone)}">${escapeHtml(data.phone)}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280"><strong>Email</strong></td><td><a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280"><strong>Service</strong></td><td>${escapeHtml(data.service)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280"><strong>Address / area</strong></td><td>${escapeHtml(data.address || "—")}</td></tr>
      </table>
      <h3 style="margin:20px 0 6px">Message</h3>
      <div style="white-space:pre-wrap;border-left:3px solid #b91c1c;padding:8px 12px;background:#f8f5f0">${escapeHtml(data.message)}</div>
      <p style="margin-top:24px;color:#6b7280;font-size:12px">Sent from the falcon-roofing.net quote form.</p>
    </div>`;
  const text =
    `New quote request — Falcon Roofing\n\n` +
    `Name: ${data.name}\nPhone: ${data.phone}\nEmail: ${data.email}\n` +
    `Service: ${data.service}\nAddress/area: ${data.address || "—"}\n\nMessage:\n${data.message}\n`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO_EMAIL],
        bcc: [WSS_LEAD_COPY_EMAIL],
        reply_to: data.email,
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Resend error", res.status, detail);
      return new Response(
        JSON.stringify({
          error: "We couldn't send your message right now. Please call (614) 715-0496.",
          code: "resend_error",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-quote-request fatal", err);
    return new Response(
      JSON.stringify({ error: "Unexpected error sending message. Please call (614) 715-0496." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});