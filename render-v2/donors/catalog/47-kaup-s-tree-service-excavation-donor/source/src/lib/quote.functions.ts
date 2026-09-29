import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const QuoteSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80),
  phone: z
    .string()
    .trim()
    .min(7, "Phone number is too short")
    .max(25)
    .regex(/^[+()\-\s\d.]+$/, "Phone has invalid characters"),
  email: z.string().trim().email("Invalid email").max(160),
  service: z.enum([
    "tree-removal",
    "tree-trimming",
    "stump-grinding",
    "stump-removal",
    "land-clearing",
    "excavation",
    "dirt-work",
    "storm-cleanup",
    "storm-shelter",
    "other",
  ]),
  zip: z.string().trim().max(20).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  // honeypot
  website: z.string().max(0).optional().or(z.literal("")),
});

export type QuoteInput = z.infer<typeof QuoteSchema>;

const SERVICE_LABEL: Record<QuoteInput["service"], string> = {
  "tree-removal": "Tree Removal",
  "tree-trimming": "Tree Trimming & Pruning",
  "stump-grinding": "Stump Grinding",
  "stump-removal": "Stump Removal",
  "land-clearing": "Land Clearing",
  excavation: "Excavation",
  "dirt-work": "Dirt Work",
  "storm-cleanup": "Storm Cleanup",
  "storm-shelter": "Storm Shelter / Cellar Installation",
  other: "Other",
};

// in-memory rate limit (best-effort, per worker instance)
const lastByIp = new Map<string, number>();

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export const submitQuote = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => QuoteSchema.parse(data))
  .handler(async ({ data }) => {
    // Honeypot — silently accept but do nothing.
    if (data.website && data.website.length > 0) {
      return { ok: true as const };
    }

    // Rate limit by IP (30s)
    try {
      const { getRequestIP } = await import("@tanstack/react-start/server");
      const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
      const now = Date.now();
      const last = lastByIp.get(ip) ?? 0;
      if (now - last < 30_000) {
        return { ok: false as const, error: "Please wait a moment before sending another request." };
      }
      lastByIp.set(ip, now);
    } catch {
      // best effort only
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not configured");
      return { ok: false as const, error: "Email service is not configured. Call (731) 610-2627." };
    }

    const serviceLabel = SERVICE_LABEL[data.service];
    const subject = `[New Quote] ${serviceLabel} — ${data.name} (${data.phone})`;

    const text = [
      `New quote request from kaupstreeservicellc.com`,
      ``,
      `Name:    ${data.name}`,
      `Phone:   ${data.phone}`,
      `Email:   ${data.email}`,
      `Service: ${serviceLabel}`,
      `Zip:     ${data.zip || "—"}`,
      ``,
      `Message:`,
      data.message || "(none)",
      ``,
      `Reply directly to this email to respond to the customer.`,
    ].join("\n");

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#0F2A1D;max-width:560px">
        <h2 style="margin:0 0 12px;font-family:'Bricolage Grotesque',Arial,sans-serif">New quote request</h2>
        <p style="margin:0 0 18px;color:#5b6a60">From the Kaup's Tree Service & Excavation website.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr><td style="padding:6px 0;color:#5b6a60;width:110px">Name</td><td><strong>${esc(data.name)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#5b6a60">Phone</td><td><a href="tel:${esc(data.phone)}">${esc(data.phone)}</a></td></tr>
          <tr><td style="padding:6px 0;color:#5b6a60">Email</td><td><a href="mailto:${esc(data.email)}">${esc(data.email)}</a></td></tr>
          <tr><td style="padding:6px 0;color:#5b6a60">Service</td><td>${esc(serviceLabel)}</td></tr>
          <tr><td style="padding:6px 0;color:#5b6a60">Zip</td><td>${esc(data.zip || "—")}</td></tr>
        </table>
        <h3 style="margin:18px 0 6px;font-family:'Bricolage Grotesque',Arial,sans-serif">Message</h3>
        <div style="white-space:pre-wrap;background:#F4F1EA;padding:12px 14px;border-radius:8px;font-size:14px">${esc(data.message || "(none)")}</div>
        <p style="margin-top:20px;font-size:12px;color:#9aa49d">Reply directly to this email to respond to the customer.</p>
      </div>`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Kaup's Tree Service <onboarding@resend.dev>",
          to: ["kaupstreeservice@gmail.com"],
          reply_to: data.email,
          subject,
          text,
          html,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error("Resend send failed", res.status, body);
        return {
          ok: false as const,
          error: "We couldn't send your request. Please call (731) 610-2627.",
        };
      }
      return { ok: true as const };
    } catch (err) {
      console.error("Resend send threw", err);
      return {
        ok: false as const,
        error: "Network error. Please call (731) 610-2627.",
      };
    }
  });
