import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "leads@wss-ai.com";
const WSS_LEAD_COPY_EMAIL = process.env.WSS_LEAD_COPY_EMAIL || "adclimbercl@gmail.com";
const InquirySchema = z.object({
  name: z.string().trim().min(1, "Name required").max(120),
  email: z.string().trim().email("Valid email required").max(200),
  phone: z.string().trim().max(40).optional().default(""),
  city: z.string().trim().max(120).optional().default(""),
  service: z.string().trim().min(1, "Service required").max(120),
  timeline: z.string().trim().max(60).optional().default(""),
  budget: z.string().trim().max(60).optional().default(""),
  message: z.string().trim().min(5, "Please include a brief message").max(2000),
  contactPreference: z.enum(["phone", "text", "email", "either"]).default("either"),
});

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const sendContactInquiry = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InquirySchema.parse(data))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

    const subject = `New inquiry · ${data.service} · ${data.name}`;
    const html = `
      <div style="font-family:Georgia,serif;color:#1a1612;max-width:640px;margin:0 auto;">
        <p style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#7a5230;margin:0;">
          [ Peppers Structural · New Inquiry ]
        </p>
        <h1 style="font-size:28px;font-weight:400;margin:8px 0 24px;">${escape(data.name)}</h1>
        <table style="width:100%;border-collapse:collapse;font-family:Inter,Arial,sans-serif;font-size:14px;">
          ${row("Service", data.service)}
          ${row("Email", data.email)}
          ${row("Phone", data.phone || "—")}
          ${row("City / Town", data.city || "—")}
          ${row("Timeline", data.timeline || "—")}
          ${row("Budget", data.budget || "—")}
          ${row("Best way to reach", data.contactPreference)}
        </table>
        <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 8px;">Message</h2>
        <p style="white-space:pre-wrap;line-height:1.6;color:#2a2a2a;">${escape(data.message)}</p>
        <hr style="border:none;border-top:1px solid #d8cfc1;margin:32px 0;" />
        <p style="font-family:'Courier New',monospace;font-size:11px;color:#999;">
          Sent from pepper.wss-ai.com contact form · ${new Date().toISOString()}
        </p>
      </div>
    `;

    const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: ["jimpeppers707@gmail.com"],
        bcc: [WSS_LEAD_COPY_EMAIL],
        reply_to: data.email,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Email delivery failed", { status: res.status, body });
      throw new Error(`Email delivery failed [${res.status}]: ${body.slice(0, 200)}`);
    }

    return { ok: true };
  });

function row(label: string, value: string) {
  return `<tr>
    <td style="padding:8px 12px 8px 0;color:#7a5230;font-family:'Courier New',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;vertical-align:top;width:160px;">${label}</td>
    <td style="padding:8px 0;border-bottom:1px solid #eee9df;">${escape(value)}</td>
  </tr>`;
}
