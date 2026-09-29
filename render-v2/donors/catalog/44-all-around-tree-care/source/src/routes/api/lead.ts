/**
 * Lead intake endpoint — Resend via Lovable connector gateway.
 * Primary delivery path. Returns JSON only (never SPA HTML).
 */
import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { z } from "zod";
import { CLIENT } from "@/config";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const RECIPIENT = CLIENT.email;

const LeadSchema = z.object({
  name: z.string().trim().min(1).max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().max(255).optional().or(z.literal("")),
  address: z.string().trim().max(255).optional().or(z.literal("")),
  message: z.string().trim().max(4000).optional().or(z.literal("")),
  service: z.string().trim().max(120).optional().or(z.literal("")),
  topic: z.string().trim().max(120).optional().or(z.literal("")),
  pageUrl: z.string().trim().max(500).optional().or(z.literal("")),
  test: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  website: z.string().max(0).optional().or(z.literal("")), // honeypot
}).passthrough();

const hits = new Map<string, number[]>();
function rateLimited(ip: string, limit = 8, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limit;
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function isConfigured() {
  return !!(process.env.LOVABLE_API_KEY && process.env.RESEND_API_KEY);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/lead")({
  server: {
    handlers: {
      GET: async () => json({
        ok: true,
        provider: "resend",
        configured: isConfigured(),
        recipient: RECIPIENT,
        mode: "probe",
      }),
      POST: async ({ request }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        if (rateLimited(ip)) return json({ ok: false, error: "Too many requests" }, 429);

        const body = await request.json().catch(() => null);
        const parsed = LeadSchema.safeParse(body);
        if (!parsed.success) {
          return json({ ok: false, error: "Invalid input", issues: parsed.error.flatten() }, 400);
        }
        const lead = parsed.data as Record<string, any>;

        // Honeypot: pretend success without sending
        if (lead.website) return json({ ok: true, provider: "resend", spam: true });

        // Basic validation: name + (phone OR email)
        const hasName = !!lead.name?.trim();
        const hasContact = !!(lead.phone?.trim() || lead.email?.trim());
        const isProbe = lead.test === true || lead.dryRun === true;
        if (!isProbe && (!hasName || !hasContact)) {
          return json({ ok: false, error: "Name and phone or email are required" }, 400);
        }

        const configured = isConfigured();

        if (isProbe) {
          return json({
            ok: true,
            provider: "resend",
            configured,
            recipient: RECIPIENT,
            wouldSend: configured,
            mode: lead.test ? "test" : "dryRun",
          });
        }

        if (!configured) {
          return json({
            ok: false,
            fallback: true,
            provider: "resend",
            errorCode: "RESEND_NOT_CONFIGURED",
          }, 503);
        }

        const timestamp = new Date().toISOString();
        const topic = lead.topic || "Contact form";
        const safeMessage = escapeHtml(lead.message || "(no message)").replace(/\n/g, "<br>");
        const fieldRows = Object.entries(lead)
          .filter(([k, v]) => !["website", "test", "dryRun"].includes(k) && v !== undefined && v !== "")
          .map(([k, v]) => `<tr><td style="padding:4px 10px;color:#666"><b>${escapeHtml(k)}</b></td><td style="padding:4px 10px">${escapeHtml(String(v))}</td></tr>`)
          .join("");

        const html = `
          <h2>New ${escapeHtml(topic)} lead — ${escapeHtml(CLIENT.businessName)}</h2>
          <p><b>Name:</b> ${escapeHtml(lead.name || "")}<br>
          <b>Phone:</b> ${lead.phone ? `<a href="tel:${escapeHtml(lead.phone)}">${escapeHtml(lead.phone)}</a>` : "(not provided)"}<br>
          <b>Email:</b> ${escapeHtml(lead.email || "(not provided)")}<br>
          <b>Service:</b> ${escapeHtml(lead.service || "(not specified)")}<br>
          <b>Page:</b> ${escapeHtml(lead.pageUrl || "(unknown)")}<br>
          <b>Submitted:</b> ${escapeHtml(timestamp)}<br>
          <b>IP:</b> ${escapeHtml(ip)}</p>
          <h3>Message</h3><p>${safeMessage}</p>
          <h3>All fields</h3>
          <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">${fieldRows}</table>
        `;

        const from = process.env.RESEND_FROM_EMAIL || "All-Around Tree Care <onboarding@resend.dev>";

        try {
          const res = await fetch(`${GATEWAY_URL}/emails`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": process.env.RESEND_API_KEY!,
            },
            body: JSON.stringify({
              from,
              to: [RECIPIENT],
              bcc: process.env.LEAD_CC_EMAIL ? [process.env.LEAD_CC_EMAIL] : undefined,
              subject: `[New Lead] ${topic} — ${lead.name || "Visitor"}`,
              html,
              reply_to: lead.email || undefined,
            }),
          });

          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            console.error("resend send failed", res.status, detail);
            return json({
              ok: false,
              fallback: true,
              provider: "resend",
              errorCode: "RESEND_SEND_FAILED",
            }, 502);
          }

          return json({ ok: true, provider: "resend" });
        } catch (err) {
          console.error("lead send error", err);
          return json({
            ok: false,
            fallback: true,
            provider: "resend",
            errorCode: "RESEND_SEND_FAILED",
          }, 502);
        }
      },
    },
  },
});
