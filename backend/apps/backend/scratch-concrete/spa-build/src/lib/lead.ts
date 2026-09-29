// SERVER-SIDE LEAD CAPTURE — the fleet's shared contract.
//
// The donor source's forms did nothing recoverable (a mailto: handoff on the
// contact form, a success flag with no transmission on the estimator). Both
// forms now POST to the one shared endpoint with ONE payload:
//   { slug, name, phone, email, service, message, website }
// `slug` is the first label of the serving host; `website` is the honeypot
// and must arrive empty.

export type LeadPayload = {
  slug: string;
  name: string;
  phone: string;
  email: string;
  service: string;
  message: string;
  website: string;
};

export const LEAD_ENDPOINT = "https://ghost.wss-ai.com/api/quote-request";

function slugFromHost(): string {
  try {
    return String(window.location.hostname).split(".")[0] || "";
  } catch {
    return "";
  }
}

export async function submitLead(data: Omit<LeadPayload, "slug" | "website">, honeypot = ""): Promise<{ ok: true }> {
  const payload: LeadPayload = { ...data, slug: slugFromHost(), website: honeypot };
  const res = await fetch(LEAD_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Lead endpoint responded ${res.status}`);
  return { ok: true };
}
