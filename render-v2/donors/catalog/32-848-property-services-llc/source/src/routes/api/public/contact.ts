import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { ContactSchema, type ContactPayload } from "@/lib/contact-schema";
import { BUSINESS } from "@/lib/business";

const RESEND_URL = "https://connector-gateway.lovable.dev/resend/emails";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]!));
}

// In-memory rate limit (best-effort; resets when Worker restarts)
const HITS = new Map<string, number[]>();
function rateLimited(ip: string, max = 4, windowMs = 60_000) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  HITS.set(ip, arr);
  return arr.length > max;
}

async function notifyDiscordFailure(d: ContactPayload, reason: string) {
  const url = process.env.DISCORD_FORM_FAILURE_WEBHOOK_URL;
  if (!url) return false;
  const sanitized = reason.replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]").slice(0, 500);
  const content = [
    `**848 Property Services — Lead delivery FAILED (fallback alert)**`,
    `**Time:** ${new Date().toISOString()}`,
    `**Source page:** ${d.source || "(unknown)"} · **Location:** ${d.locationLabel || d.locationSlug || "(none)"}`,
    `**Reason:** ${sanitized}`,
    `**Name:** ${d.name}`,
    `**Phone:** ${d.phone}`,
    `**Email:** ${d.email}`,
    `**ZIP:** ${d.zip || "—"}`,
    `**Service:** ${d.service} · **Urgency:** ${d.urgency} · **Property:** ${d.propertyType}`,
    `**Message:**`,
    "```",
    d.message.slice(0, 1500),
    "```",
  ].join("\n");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, username: "848 Lead Fallback" }),
    });
    return res.ok;
  } catch (e) {
    console.error("Discord fallback failed", e);
    return false;
  }
}

export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }),
      POST: async ({ request }) => {
        const cors = {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        };
        const ip = request.headers.get("cf-connecting-ip")
          || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
          || "unknown";
        if (rateLimited(ip)) {
          return new Response(JSON.stringify({ ok: false, error: "Too many requests. Please wait a moment." }), { status: 429, headers: cors });
        }

        let body: unknown;
        try { body = await request.json(); }
        catch { return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), { status: 400, headers: cors }); }

        const parsed = ContactSchema.safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }), { status: 400, headers: cors });
        }
        const d = parsed.data;

        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        const RESEND_API_KEY = process.env.RESEND_API_KEY;

        const locationTag = d.locationLabel || (d.zip ? `ZIP ${d.zip}` : "Unspecified location");
        const sourceTag = d.source ? ` · ${d.source}` : "";
        const subject = `[${locationTag}] ${d.service} — ${d.name}${sourceTag}`;
        const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
  <div style="background:#0f0f0f;color:#caff3d;padding:18px 24px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;font-size:12px">
    848 Property Services · New Lead · ${escapeHtml(locationTag)}
  </div>
  <div style="padding:24px;background:#fff">
    <h2 style="margin:0 0 16px;font-family:Georgia,serif;font-weight:600">${escapeHtml(d.name)}</h2>
    <table style="width:100%;font-size:14px;line-height:1.6">
      <tr><td style="color:#666;padding-right:12px">Service</td><td><strong>${escapeHtml(d.service)}</strong></td></tr>
      <tr><td style="color:#666">Property</td><td>${escapeHtml(d.propertyType)}</td></tr>
      <tr><td style="color:#666">Timing</td><td>${escapeHtml(d.urgency)}</td></tr>
      <tr><td style="color:#666">Phone</td><td><a href="tel:${escapeHtml(d.phone)}">${escapeHtml(d.phone)}</a></td></tr>
      <tr><td style="color:#666">Email</td><td><a href="mailto:${escapeHtml(d.email)}">${escapeHtml(d.email)}</a></td></tr>
      ${d.zip ? `<tr><td style="color:#666">ZIP</td><td>${escapeHtml(d.zip)}</td></tr>` : ""}
      ${d.locationLabel ? `<tr><td style="color:#666">Service area</td><td><strong>${escapeHtml(d.locationLabel)}</strong></td></tr>` : ""}
      ${d.source ? `<tr><td style="color:#666">Source page</td><td>${escapeHtml(d.source)}</td></tr>` : ""}
    </table>
    <h3 style="margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:#666">Project details</h3>
    <p style="white-space:pre-wrap;background:#f7f6f1;padding:16px;border-left:3px solid #caff3d;margin:0">${escapeHtml(d.message)}</p>
  </div>
  <div style="padding:14px 24px;background:#f7f6f1;color:#666;font-size:11px">Sent from 848propertyservices.com contact form</div>
</div>`;

        const tags: { name: string; value: string }[] = [
          { name: "service", value: d.service },
          { name: "urgency", value: d.urgency },
          { name: "property", value: d.propertyType },
        ];
        if (d.locationSlug) tags.push({ name: "location", value: d.locationSlug });
        if (d.source) tags.push({ name: "source", value: d.source.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) });

        let primaryOk = false;
        let failureReason = "";

        if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
          failureReason = "Email provider not configured";
        } else {
          try {
            const res = await fetch(RESEND_URL, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${LOVABLE_API_KEY}`,
                "X-Connection-Api-Key": RESEND_API_KEY,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "848 Property Services <onboarding@resend.dev>",
                to: [BUSINESS.email],
                reply_to: d.email,
                subject,
                html,
                tags,
              }),
            });
            if (res.ok) {
              primaryOk = true;
            } else {
              const text = await res.text().catch(() => "");
              failureReason = `Resend ${res.status}: ${text.slice(0, 300)}`;
              console.error("Resend send failed", res.status, text);
            }
          } catch (e) {
            failureReason = `Resend request error: ${e instanceof Error ? e.message : String(e)}`;
            console.error(failureReason);
          }
        }

        if (primaryOk) {
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
        }

        const fallbackOk = await notifyDiscordFailure(d, failureReason);
        if (fallbackOk) {
          // Lead is recoverable via Discord — confirm to visitor as success.
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
        }

        return new Response(JSON.stringify({ ok: false, error: "Could not send right now. Please call us." }), { status: 502, headers: cors });
      },
    },
  },
});
