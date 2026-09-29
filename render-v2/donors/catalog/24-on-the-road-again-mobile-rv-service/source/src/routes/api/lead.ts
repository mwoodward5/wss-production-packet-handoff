/**
 * Lead intake — Resend via Lovable connector gateway.
 * Returns JSON only. Supports {test:true}/{dryRun:true} probes.
 */
import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { z } from "zod";
import { CLIENT } from "@/config";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Origin, X-Requested-With",
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
}

const LeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  address: z.string().trim().max(255).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  service: z.string().trim().max(120).optional().or(z.literal("")),
  serviceNeeded: z.string().trim().max(120).optional().or(z.literal("")),
  rvType: z.string().trim().max(120).optional().or(z.literal("")),
  timing: z.string().trim().max(120).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  topic: z.string().trim().max(80).optional(),
  sourceUrl: z.string().trim().max(500).optional().or(z.literal("")),
  website: z.string().trim().max(500).optional().or(z.literal("")), // honeypot
});

const hits = new Map<string, number[]>();
function rateLimited(ip: string, limit = 8, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limit;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function isResendConfigured() {
  return Boolean(process.env.LOVABLE_API_KEY && process.env.RESEND_API_KEY);
}

async function sendViaResend(args: { to: string; subject: string; html: string; replyTo?: string; bcc?: string }) {
  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const res = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": process.env.RESEND_API_KEY!,
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      bcc: args.bcc ? [args.bcc] : undefined,
      subject: args.subject,
      html: args.html,
      reply_to: args.replyTo,
    }),
  });
  if (!res.ok) {
    const data = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${data.slice(0, 500)}`);
  }
  return res.json();
}

export const Route = createFileRoute("/api/lead")({
  server: {
    handlers: {
      GET: async () =>
        jsonResponse({
          ok: true,
          endpoint: "lead",
          method: "POST",
          provider: "resend",
          configured: isResendConfigured(),
          recipient: CLIENT.email,
        }),
      OPTIONS: async () => new Response(null, { status: 204, headers: JSON_HEADERS }),
      POST: async ({ request }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        const json = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!json || typeof json !== "object" || Array.isArray(json)) {
          return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }

        // Probe / dry-run
        if (json.test === true || json.dryRun === true) {
          const configured = isResendConfigured();
          return jsonResponse({
            ok: true,
            provider: "resend",
            configured,
            recipient: CLIENT.email,
            wouldSend: configured,
          });
        }

        // Honeypot
        const honeypot = String(json.website ?? "").trim();
        if (honeypot) return jsonResponse({ ok: true, provider: "resend" });

        if (rateLimited(ip)) {
          return jsonResponse({ ok: false, error: "Too many requests" }, { status: 429 });
        }

        const parsed = LeadSchema.safeParse(json);
        if (!parsed.success) {
          return jsonResponse({ ok: false, error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
        }
        const lead = parsed.data;
        if (!lead.phone && !lead.email) {
          return jsonResponse({ ok: false, error: "Phone or email required" }, { status: 400 });
        }

        if (!isResendConfigured()) {
          return jsonResponse({
            ok: false,
            fallback: true,
            provider: "resend",
            errorCode: "RESEND_NOT_CONFIGURED",
          });
        }

        const topic = lead.topic || "Contact form";
        const serviceLabel = lead.service || lead.serviceNeeded || "";
        const safeMessage = escapeHtml(lead.message || "").replace(/\n/g, "<br>");
        const timestamp = new Date().toISOString();
        const adminHtml = `
          <h2>New ${escapeHtml(topic)} lead — ${escapeHtml(CLIENT.businessName)}</h2>
          <p>
            <b>Name:</b> ${escapeHtml(lead.name)}<br>
            <b>Phone:</b> ${escapeHtml(lead.phone || "(not provided)")}<br>
            <b>Email:</b> ${escapeHtml(lead.email || "(not provided)")}<br>
            <b>City:</b> ${escapeHtml(lead.city || "(not provided)")}<br>
            <b>Service needed:</b> ${escapeHtml(serviceLabel || "(not provided)")}<br>
            <b>RV type:</b> ${escapeHtml(lead.rvType || "(not provided)")}<br>
            <b>Preferred timing:</b> ${escapeHtml(lead.timing || "(not provided)")}<br>
            <b>Service address:</b> ${escapeHtml(lead.address || "(not provided)")}<br>
            <b>Source URL:</b> ${escapeHtml(lead.sourceUrl || "(unknown)")}<br>
            <b>Submitted:</b> ${escapeHtml(timestamp)}<br>
            <b>IP:</b> ${escapeHtml(ip)}
          </p>
          <h3>Message / notes</h3>
          <p>${safeMessage || "(no message)"}</p>
        `;

        try {
          await sendViaResend({
            to: CLIENT.email,
            subject: `[New Lead] ${topic} — ${lead.name}`,
            html: adminHtml,
            replyTo: lead.email || undefined,
            bcc: process.env.LEAD_CC_EMAIL || undefined,
          });
          return jsonResponse({ ok: true, provider: "resend" });
        } catch (err) {
          console.error("lead resend error", err);
          return jsonResponse({
            ok: false,
            fallback: true,
            provider: "resend",
            errorCode: "RESEND_SEND_FAILED",
          });
        }
      },
    },
  },
});
