import type { TrustConfig, VoiceAnswer } from "../trust.config";


/**
 * Voice/AI-answer helpers. These build 40-60 word direct answers from CONFIG FACTS ONLY.
 * If the underlying facts are missing, the answer is omitted rather than guessed.
 */
export function derivedVoiceAnswers(cfg: TrustConfig): VoiceAnswer[] {
  const out: VoiceAnswer[] = [];
  const city = cfg.location?.primary?.city;
  const phone = cfg.contact?.phoneDisplay || cfg.contact?.phone;

  if (city && cfg.business?.name && cfg.business?.category) {
    out.push({
      id: "who",
      question: `Who does ${cfg.business.category.toLowerCase()} near me in ${city}?`,
      answer: `${cfg.business.name} provides ${cfg.business.category.toLowerCase()} in ${city}${
        cfg.location?.serviceAreas?.length ? ` and ${cfg.location.serviceAreas.slice(0, 3).join(", ")}` : ""
      }.${phone ? ` Call ${phone}.` : ""}${cfg.contact?.bookingUrl ? " Online booking is available." : ""}`,
    });
  }

  // Deterministic on server and client: state the posted hours, never "right
  // now" — a clock-dependent string here caused a hydration mismatch, and the
  // live open/closed state is already handled by <OpenNowStatus />.
  const openDays = cfg.hours.weekly.filter((d) => d.open && d.close);
  if (cfg.hours.open24 || openDays.length) {
    const first = openDays[0];
    const everyDay = openDays.length === 7;
    const sameSpan =
      everyDay && openDays.every((d) => d.open === first?.open && d.close === first?.close);
    out.push({
      id: "hours",
      question: `What are ${cfg.business.name}'s hours?`,
      answer: cfg.hours.open24
        ? `${cfg.business.name} is open 24 hours, every day.${phone ? ` Call ${phone} any time.` : ""}`
        : `${cfg.business.name} is open ${
            sameSpan && first
              ? `every day from ${first.open} to ${first.close}`
              : openDays.map((d) => `${d.day} ${d.open}–${d.close}`).join(", ")
          }.${phone ? ` Call ${phone} to confirm before you drive out.` : ""}`,
    });
  }


  const priced = cfg.services.filter((s) => s.priceFrom);
  const lead = priced[0];
  if (lead) {
    out.push({
      id: "cost",
      question: `How much does ${lead.name.toLowerCase()} cost${city ? ` in ${city}` : ""}?`,
      answer: `${lead.name} starts at $${lead.priceFrom}${lead.priceTo ? ` and typically runs to $${lead.priceTo}` : ""}${lead.priceUnit ? ` ${lead.priceUnit}` : ""}. Final pricing depends on scope; ${cfg.labels.quoteCta.toLowerCase()} for an exact figure.`,
    });
  }

  const em = cfg.availability?.emergency;
  if (em?.available) {
    out.push({
      id: "emergency",
      question: `Do you offer emergency ${cfg.business.category.toLowerCase()}?`,
      answer: `Yes. ${cfg.business.name} handles emergency calls${cfg.availability.responseTimeMinutes ? ` with a typical ${cfg.availability.responseTimeMinutes}-minute response` : ""}.${em.phone || phone ? ` Call ${em.phone || phone}.` : ""}${em.note ? ` ${em.note}` : ""}`,
    });
  }

  return out;
}

/** Authored answers win; derived ones fill gaps. */
export function voiceAnswers(cfg: TrustConfig): VoiceAnswer[] {
  const authored = cfg.voice?.answers ?? [];
  const ids = new Set(authored.map((a) => a.id));
  return authored;
}

export function wordCount(s: string) { return s.trim().split(/\s+/).filter(Boolean).length; }
