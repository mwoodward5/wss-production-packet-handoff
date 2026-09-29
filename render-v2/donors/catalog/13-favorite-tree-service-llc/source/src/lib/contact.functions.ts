import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

const ContactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().max(255).email().or(z.literal("")),
  service: z.string().trim().min(1).max(80),
  message: z.string().trim().min(5).max(2000),
  website: z.string().max(0).optional().default(""), // honeypot must be empty
});

type RateLimitState = { count: number; firstAt: number };
const rateLimit = new Map<string, RateLimitState>();
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 5;

function checkRate(ip: string): boolean {
  const now = Date.now();
  const state = rateLimit.get(ip);
  if (!state || now - state.firstAt > WINDOW_MS) {
    rateLimit.set(ip, { count: 1, firstAt: now });
    return true;
  }
  if (state.count >= MAX_PER_WINDOW) return false;
  state.count += 1;
  return true;
}

const TO_EMAIL = "favoritetreeservice@aol.com";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "leads@wss-ai.com";
const WSS_LEAD_COPY_EMAIL = process.env.WSS_LEAD_COPY_EMAIL || "adclimbercl@gmail.com";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const sendContactEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ContactSchema.parse(input))
  .handler(async ({ data }) => {
    // honeypot
    if (data.website && data.website.length > 0) {
      return { ok: true as const };
    }

    let ip = "unknown";
    try {
      ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    } catch {
      // ignore
    }

    if (!checkRate(ip)) {
      return { ok: false as const, error: "Too many submissions. Please call us directly." };
    }

    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      console.error("Email service not configured");
      return { ok: false as const, error: "Email service not configured." };
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background:#1a3a2a;color:#ffffff;padding:20px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:20px;">New Lead — Favorite Tree Service</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;background:#ffffff;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;color:#111827;">
            <tr><td style="padding:8px 0;color:#6b7280;">Name</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(data.name)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Phone</td><td style="padding:8px 0;font-weight:600;"><a href="tel:${escapeHtml(data.phone)}">${escapeHtml(data.phone)}</a></td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Email</td><td style="padding:8px 0;">${data.email ? `<a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a>` : "—"}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Service</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(data.service)}</td></tr>
          </table>
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb;">
            <div style="color:#6b7280;font-size:12px;margin-bottom:6px;">MESSAGE</div>
            <div style="font-size:14px;line-height:1.5;white-space:pre-wrap;color:#111827;">${escapeHtml(data.message)}</div>
          </div>
          <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">
            Submitted from favoritetreeservice.com • IP: ${escapeHtml(ip)}
          </div>
        </div>
      </div>
    `;

    try {
      const res = await fetch(`${GATEWAY_URL}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": RESEND_API_KEY,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [TO_EMAIL],
          bcc: [WSS_LEAD_COPY_EMAIL],
          reply_to: data.email || undefined,
          subject: `New Lead: ${data.service} — ${data.name}`,
          html,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error("Resend send failed", res.status, body);
        return { ok: false as const, error: "Could not send message. Please call (540) 718-7032." };
      }

      return { ok: true as const };
    } catch (err) {
      console.error("Email send error", err);
      return { ok: false as const, error: "Could not send message. Please call (540) 718-7032." };
    }
  });
