import { siteConfig } from "@/config/siteConfig";

interface BookingPayload {
  fullName: string;
  email: string;
  phone: string;
  placement: string;
  approxSize: string;
  style: string;
  colorPref: string;
  budget: string;
  description: string;
  availability: string;
  healthNotes?: string;
  referenceUrl?: string;
  requestNumber?: number;
  leadScore?: "high" | "warm" | "standard";
}

/**
 * Sends a notification email to the studio and a confirmation to the client.
 * Silent no-op if RESEND_API_KEY isn't set — safe to ship without email.
 */
export async function notifyBookingRequest(payload: BookingPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[notify] RESEND_API_KEY not set; skipping email send");
    return;
  }

  const number = payload.requestNumber
    ? `#${String(payload.requestNumber).padStart(5, "0")}`
    : "";

  const studioHtml = `
    <h2>New booking request ${number}</h2>
    <p><strong>${payload.fullName}</strong> &lt;${payload.email}&gt; · ${payload.phone}</p>
    <ul>
      <li><b>Style:</b> ${payload.style} (${payload.colorPref})</li>
      <li><b>Placement:</b> ${payload.placement}</li>
      <li><b>Size:</b> ${payload.approxSize}</li>
      <li><b>Budget:</b> ${payload.budget}</li>
      <li><b>Availability:</b> ${payload.availability}</li>
    </ul>
    <p><b>Idea:</b><br/>${escapeHtml(payload.description)}</p>
    ${payload.healthNotes ? `<p><b>Health notes:</b> ${escapeHtml(payload.healthNotes)}</p>` : ""}
    ${payload.referenceUrl ? `<p><b>Reference:</b> <a href="${payload.referenceUrl}">${payload.referenceUrl}</a></p>` : ""}
  `;

  const clientHtml = `
    <h2>Thanks — your request is in ${number}</h2>
    <p>Hi ${escapeHtml(payload.fullName.split(" ")[0])},</p>
    <p>${siteConfig.artistName} received your request and will reply with appointment options
    and a deposit link if it is a good fit. Please allow 2–5 business days.</p>
    <p><b>Recap:</b> ${payload.style} · ${payload.placement} · ${payload.approxSize}</p>
    <p style="color:#888;font-size:12px;margin-top:32px">${siteConfig.studioName} · ${siteConfig.address}</p>
  `;

  const scorePrefix =
    payload.leadScore === "high" ? "[HIGH-INTENT] " : "";

  await Promise.all([
    sendEmail(apiKey, {
      to: siteConfig.email,
      subject: `${scorePrefix}New booking request ${number} — ${payload.style}`,
      html: studioHtml,
      replyTo: payload.email,
    }),
    sendEmail(apiKey, {
      to: payload.email,
      subject: `We got your request — ${siteConfig.studioName}`,
      html: clientHtml,
    }),
  ]);
}

async function sendEmail(
  apiKey: string,
  opts: { to: string; subject: string; html: string; replyTo?: string },
) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${siteConfig.studioName} <onboarding@resend.dev>`,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      reply_to: opts.replyTo,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Resend failed ${res.status}: ${t}`);
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
