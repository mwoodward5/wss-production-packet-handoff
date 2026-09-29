/**
 * Lead intake endpoint — Resend via Lovable connector gateway.
 */
import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { z } from "zod";
import { CLIENT } from "@/config";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

const LeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  message: z.string().trim().min(1).max(2000),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  service: z.string().trim().max(120).optional().or(z.literal("")),
  address: z.string().trim().max(255).optional().or(z.literal("")),
  topic: z.string().trim().max(120).optional().or(z.literal("")),
  website: z.string().max(0).optional().or(z.literal("")), // honeypot
});

const hits = new Map<string, number[]>();
function rateLimited(ip: string, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limit;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export const Route = createFileRoute("/api/lead")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
          if (rateLimited(ip)) {
            return Response.json({ ok: false, message: "Too many requests" }, { status: 429 });
          }
          const json = await request.json().catch(() => null);
          const parsed = LeadSchema.safeParse(json);
          if (!parsed.success) {
            return Response.json(
              { ok: false, message: "Name, email, and message are required.", issues: parsed.error.flatten() },
              { status: 400 },
            );
          }
          const lead = parsed.data;
          if (lead.website) {
            return Response.json({ ok: true, message: "Thanks — we got your message and will reply shortly." });
          }

          const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
          const RESEND_API_KEY = process.env.RESEND_API_KEY;
          if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
            console.error("lead: missing API keys", { hasLovable: !!LOVABLE_API_KEY, hasResend: !!RESEND_API_KEY });
            return Response.json(
              { ok: false, message: "Email service not configured. Please call us directly." },
              { status: 500 },
            );
          }

          const from = process.env.RESEND_FROM_EMAIL || "Woodward Lead Desk <forms@wss-ai.com>";
          const topic = lead.topic || "Website contact";
          const safeMessage = escapeHtml(lead.message).replace(/\n/g, "<br>");

          const html = `
            <h2>New website lead — DEUCES Landscaping &amp; Excavation</h2>
            <p><b>Topic:</b> ${escapeHtml(topic)}<br>
            <b>Name:</b> ${escapeHtml(lead.name)}<br>
            <b>Email:</b> ${escapeHtml(lead.email)}<br>
            <b>Phone:</b> ${escapeHtml(lead.phone || "(not provided)")}<br>
            <b>Service:</b> ${escapeHtml(lead.service || "(not specified)")}<br>
            <b>Address:</b> ${escapeHtml(lead.address || "(not provided)")}<br>
            <b>IP:</b> ${escapeHtml(ip)}</p>
            <h3>Message</h3>
            <p>${safeMessage}</p>
          `;
          const text = [
            `New website lead — DEUCES Landscaping & Excavation`,
            `Topic: ${topic}`,
            `Name: ${lead.name}`,
            `Email: ${lead.email}`,
            `Phone: ${lead.phone || "(not provided)"}`,
            `Service: ${lead.service || "(not specified)"}`,
            `Address: ${lead.address || "(not provided)"}`,
            ``,
            `Message:`,
            lead.message,
          ].join("\n");

          const bcc = process.env.LEAD_CC_EMAIL || "woodwardsoftware@gmail.com";

          const res = await fetch(`${GATEWAY_URL}/emails`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": RESEND_API_KEY,
            },
            body: JSON.stringify({
              from,
              to: [CLIENT.email || "deucesexcavation@yahoo.com"],
              bcc: bcc ? [bcc] : undefined,
              subject: "New website lead - DEUCES Landscaping & Excavation",
              html,
              text,
              reply_to: lead.email,
            }),
          });

          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            console.error("lead: resend send failed", { status: res.status, body: errBody, from, to: CLIENT.email });
            return Response.json(
              { ok: false, message: "Failed to send lead. Please try again later or call us directly." },
              { status: 500 },
            );
          }

          return Response.json({
            ok: true,
            message: "Thanks — we got your message and will reply shortly.",
          });
        } catch (err) {
          console.error("lead: unhandled error", err);
          return Response.json(
            { ok: false, message: "Something went wrong. Please try again later." },
            { status: 500 },
          );
        }
      },
    },
  },
});
