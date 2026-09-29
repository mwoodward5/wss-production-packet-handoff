import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const InquirySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  level: z.enum(["New", "Some experience", "Instructor", "Competitor"]),
  format: z.enum(["Cabo", "Online semi-private", "Host a seminar", "Just a question"]),
  location: z.string().trim().max(120).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  hp: z.string().max(0).optional().default(""), // honeypot — must be empty
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendMail(payload: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  reply_to?: string;
}) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    throw new Error("Email credentials not configured");
  }
  const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": RESEND_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend gateway ${res.status}: ${body}`);
  }
  return res.json();
}

export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
            status: 400,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        const parsed = InquirySchema.safeParse(raw);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }),
            { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
          );
        }
        const data = parsed.data;
        if (data.hp) {
          // honeypot tripped — pretend success, do nothing
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }

        const TO = process.env.CONTACT_TO_EMAIL || "rami@bajoelfilo.com";
        const FROM = process.env.CONTACT_FROM_EMAIL || "Bajo El Filo <onboarding@resend.dev>";

        const subject = `Bajo El Filo inquiry — ${data.format} — ${data.name}`;
        const html = `
<div style="font-family:Georgia,serif;line-height:1.6;color:#141210;max-width:640px">
  <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8a7f75;margin:0 0 24px">Bajo El Filo · new inquiry</p>
  <h2 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 20px">${esc(data.name)} — <em style="color:#6b625a">${esc(data.format)}</em></h2>
  <table style="border-collapse:collapse;width:100%;margin:0 0 24px">
    <tr><td style="padding:8px 0;color:#8a7f75;width:120px">Email</td><td style="padding:8px 0"><a href="mailto:${esc(data.email)}" style="color:#141210">${esc(data.email)}</a></td></tr>
    <tr><td style="padding:8px 0;color:#8a7f75">Level</td><td style="padding:8px 0">${esc(data.level)}</td></tr>
    <tr><td style="padding:8px 0;color:#8a7f75">Format</td><td style="padding:8px 0">${esc(data.format)}</td></tr>
    ${data.location ? `<tr><td style="padding:8px 0;color:#8a7f75">Location</td><td style="padding:8px 0">${esc(data.location)}</td></tr>` : ""}
  </table>
  ${data.notes ? `<div style="border-top:1px solid #e6dfd7;padding-top:16px"><p style="color:#8a7f75;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 8px">Notes</p><p style="white-space:pre-wrap;margin:0">${esc(data.notes)}</p></div>` : ""}
</div>`;

        try {
          await sendMail({
            from: FROM,
            to: [TO],
            reply_to: data.email,
            subject,
            html,
          });

          // Autoreply to the visitor — best-effort. If the Resend sender
          // isn't a verified domain, `onboarding@resend.dev` only delivers to
          // the account owner and this will 403. That's fine — the notification
          // above is what matters; we don't fail the whole request.
          try {
            await sendMail({
              from: FROM,
              to: [data.email],
              subject: "Got your note — Rami · Bajo El Filo",
              html: `
<div style="font-family:Georgia,serif;line-height:1.7;color:#141210;max-width:560px">
  <p>${esc(data.name.split(" ")[0] || "Hey")},</p>
  <p>Got your note. I read every one. I'll come back to you shortly with next steps for <em>${esc(data.format)}</em>.</p>
  <p style="margin-top:32px">— Rami<br/><span style="color:#8a7f75;font-size:14px">Bajo El Filo · Cabo · Slovenia · Romania · Spain · Mexico</span></p>
</div>`,
            });
          } catch (autoReplyErr) {
            console.warn("[contact] autoreply skipped:", autoReplyErr);
          }

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("[contact] send failed", err);
          return new Response(
            JSON.stringify({ ok: false, error: "Could not deliver — try again in a moment." }),
            { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
