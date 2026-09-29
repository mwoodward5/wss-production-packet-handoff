import { createFileRoute } from "@tanstack/react-router";
import { QuoteSchema } from "@/lib/quote";
import { SITE } from "@/lib/site";

const recent = new Map<string, number>();
function rateLimited(ip: string) {
  const now = Date.now();
  const last = recent.get(ip) ?? 0;
  // prune occasionally
  if (recent.size > 500) {
    for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  }
  if (now - last < 10_000) return true;
  recent.set(ip, now);
  return false;
}

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const Route = createFileRoute("/api/public/quote")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";

        if (rateLimited(ip)) {
          return Response.json(
            { ok: false, error: "Too many requests — please wait a few seconds." },
            { status: 429 },
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
        }

        const parsed = QuoteSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { ok: false, error: "Please check the form fields and try again." },
            { status: 400 },
          );
        }
        const d = parsed.data;

        // honeypot
        if (d.company_website && d.company_website.length > 0) {
          return Response.json({ ok: true }); // silently accept
        }

        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
          console.error("Missing email credentials");
          return Response.json(
            { ok: false, error: "Email service is not configured. Please call us instead." },
            { status: 500 },
          );
        }

        const subject = `New Quote Request — ${d.service_type || "General"}${
          d.city || d.zip ? ` — ${[d.city, d.zip].filter(Boolean).join(" ")}` : ""
        }`;

        const lines = [
          ["Name", d.name],
          ["Phone", d.phone],
          ["Email", d.email || "—"],
          ["City / ZIP", [d.city, d.zip].filter(Boolean).join(", ") || "—"],
          ["Service", d.service_type || "—"],
          ["Urgency", d.urgency || "—"],
          ["Footprint (sq ft)", d.footprint_sqft ? String(d.footprint_sqft) : "—"],
          ["Site condition", d.condition || "—"],
          ["Source", d.source],
        ] as const;

        const text = [
          `New quote request for ${SITE.name}`,
          "",
          ...lines.map(([k, v]) => `${k}: ${v}`),
          "",
          "Message:",
          d.message || "—",
          "",
          `IP: ${ip}`,
        ].join("\n");

        const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px">
  <div style="background:#04080E;color:#12C11A;padding:18px 22px;font-weight:700;font-size:18px;letter-spacing:0.02em">
    New Quote Request
  </div>
  <div style="padding:18px 22px;background:#ffffff;color:#04080E">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${lines
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 0;color:#475569;width:40%">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`,
        )
        .join("")}
    </table>
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb">
      <div style="color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.08em">Message</div>
      <div style="white-space:pre-wrap;margin-top:6px">${esc(d.message || "—")}</div>
    </div>
    <a href="tel:${esc(d.phone)}" style="display:inline-block;margin-top:18px;background:#12C11A;color:#04080E;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">
      Call ${esc(d.name)} at ${esc(d.phone)}
    </a>
  </div>
</div>`;

        const replyTo = d.email && d.email.length > 0 ? d.email : undefined;

        try {
          const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": RESEND_API_KEY,
            },
            body: JSON.stringify({
              from: "Card Concrete Quotes <onboarding@resend.dev>",
              to: [SITE.email],
              subject,
              html,
              text,
              ...(replyTo ? { reply_to: replyTo } : {}),
            }),
          });

          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            console.error("Resend send failed", res.status, detail);
            return Response.json(
              {
                ok: false,
                error:
                  "We couldn't send your request right now. Please call (931) 261-9710 or email us directly.",
              },
              { status: 502 },
            );
          }

          return Response.json({ ok: true });
        } catch (err) {
          console.error("Resend gateway error", err);
          return Response.json(
            {
              ok: false,
              error:
                "We couldn't send your request right now. Please call (931) 261-9710 or email us directly.",
            },
            { status: 502 },
          );
        }
      },
    },
  },
});