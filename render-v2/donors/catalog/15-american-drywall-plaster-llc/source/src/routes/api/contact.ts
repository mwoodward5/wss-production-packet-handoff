import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

const ContactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(255),
  city: z.string().trim().max(120).optional().default(""),
  project: z.string().trim().max(120).optional().default("Other"),
  message: z.string().trim().min(1).max(5000),
  // honeypot — bots fill it; humans don't see it
  company: z.string().max(0).optional(),
});

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const Route = createFileRoute("/api/contact")({
  // @ts-expect-error - server handlers are valid TanStack Start runtime
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
          return new Response(
            JSON.stringify({ error: "Email service is not configured." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const parsed = ContactSchema.safeParse(payload);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: "Please check your form and try again." }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        // Honeypot trip — pretend success.
        if (parsed.data.company) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { name, phone, email, city, project, message } = parsed.data;
        const TO = "aldin.subasic@icloud.com";
        const FROM = process.env.RESEND_FROM_EMAIL || "leads@wss-ai.com";
const WSS_LEAD_COPY_EMAIL = process.env.WSS_LEAD_COPY_EMAIL || "adclimbercl@gmail.com";
        const subject = `New quote request — ${name} (${project})`;

        const rows = [
          ["Name", name],
          ["Phone", phone],
          ["Email", email],
          ["City", city || "—"],
          ["Project", project],
        ]
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 12px;border:1px solid #e5e5e5;background:#fafafa;font-weight:600">${escape(
                k
              )}</td><td style="padding:6px 12px;border:1px solid #e5e5e5">${escape(
                v
              )}</td></tr>`
          )
          .join("");

        const html = `<div style="font-family:Inter,Arial,sans-serif;color:#111;max-width:640px">
  <h2 style="margin:0 0 12px">New quote request</h2>
  <table style="border-collapse:collapse;font-size:14px">${rows}</table>
  <h3 style="margin:20px 0 6px">Project details</h3>
  <p style="white-space:pre-wrap;font-size:14px;line-height:1.5">${escape(message)}</p>
</div>`;

        const text = `New quote request

Name: ${name}
Phone: ${phone}
Email: ${email}
City: ${city || "—"}
Project: ${project}

Details:
${message}
`;

        const res = await fetch(`${GATEWAY_URL}/emails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body: JSON.stringify({
            from: FROM,
            to: [TO],
            bcc: [WSS_LEAD_COPY_EMAIL],
            reply_to: email,
            subject,
            html,
            text,
          }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(`Resend send failed [${res.status}]: ${detail}`);
          return new Response(
            JSON.stringify({
              error:
                "We couldn't send your message. Please call or text (515) 249-7306.",
            }),
            { status: 502, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
