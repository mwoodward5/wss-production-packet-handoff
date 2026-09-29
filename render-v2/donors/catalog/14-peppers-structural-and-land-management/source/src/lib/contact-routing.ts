/**
 * Contact-form routing map.
 *
 * Single source of truth for translating a service slug (URL) or service title
 * (data) into the EXACT option string used by the <select> on /contact, and
 * for generating the right follow-up confirmation microcopy after submit.
 *
 * Why this exists: the form's <select> options are intentionally
 * homeowner-friendly ("Home Addition" singular) but our `services` data uses
 * plural titles ("Home Additions"). Without this map, deep-links from service
 * pages would land on the form with the dropdown empty.
 */

export const CONTACT_SERVICE_OPTIONS = [
  "Kitchen Remodeling",
  "Basement Remodeling",
  "Decks & Porches",
  "Home Addition",
  "Custom Greenhouse",
  "General Repair / Carpentry",
  "Drywall / Trim",
  "Other (please describe)",
] as const;

export type ContactServiceOption = (typeof CONTACT_SERVICE_OPTIONS)[number];

/** slug (from /services/$slug) → exact <select> option label */
export const slugToFormService: Record<string, ContactServiceOption> = {
  "kitchen-remodeling": "Kitchen Remodeling",
  "basement-remodeling": "Basement Remodeling",
  "decks-porches": "Decks & Porches",
  "home-additions": "Home Addition",
  "custom-greenhouses": "Custom Greenhouse",
  "general-contracting": "General Repair / Carpentry",
};

/** Resolve any free-form service string to a valid select option. */
export function resolveFormService(input?: string | null): ContactServiceOption | "" {
  if (!input) return "";
  const trimmed = input.trim();
  if ((CONTACT_SERVICE_OPTIONS as readonly string[]).includes(trimmed)) {
    return trimmed as ContactServiceOption;
  }
  // Try slug lookup first
  if (slugToFormService[trimmed]) return slugToFormService[trimmed];
  // Loose title match (handles plural/punctuation drift)
  const norm = trimmed.toLowerCase().replace(/[^a-z]/g, "");
  for (const opt of CONTACT_SERVICE_OPTIONS) {
    if (opt.toLowerCase().replace(/[^a-z]/g, "") === norm) return opt;
  }
  // Common synonyms
  if (/kitchen/i.test(trimmed)) return "Kitchen Remodeling";
  if (/basement/i.test(trimmed)) return "Basement Remodeling";
  if (/(deck|porch)/i.test(trimmed)) return "Decks & Porches";
  if (/addition/i.test(trimmed)) return "Home Addition";
  if (/greenhouse/i.test(trimmed)) return "Custom Greenhouse";
  if (/(drywall|trim)/i.test(trimmed)) return "Drywall / Trim";
  if (/(repair|carpentry|handyman|fix)/i.test(trimmed)) return "General Repair / Carpentry";
  return "Other (please describe)";
}

/**
 * Per-service follow-up copy shown on the contact form's "thank you" state
 * AND on inline lead forms after submission.
 */
type FollowUp = {
  /** What the homeowner sees after sending */
  confirmHeadline: string;
  confirmBody: string;
  /** Suggested next step shown as a small CTA */
  nextLabel: string;
  nextHref: string;
};

const FOLLOWUPS: Record<ContactServiceOption | "default", FollowUp> = {
  "Kitchen Remodeling": {
    confirmHeadline: "Kitchen request received.",
    confirmBody:
      "Jim will reach out within one business day to set up an on-site walk-through. Photos of your current kitchen and a rough wishlist help us prep the most useful first conversation.",
    nextLabel: "See kitchen work →",
    nextHref: "/services/kitchen-remodeling",
  },
  "Basement Remodeling": {
    confirmHeadline: "Basement project — got it.",
    confirmBody:
      "We'll be in touch within one business day. For below-grade work, Jim usually wants to see the space in person before quoting — moisture, ceiling height, and egress all change the scope.",
    nextLabel: "Basement build details →",
    nextHref: "/services/basement-remodeling",
  },
  "Decks & Porches": {
    confirmHeadline: "Deck / porch request received.",
    confirmBody:
      "Jim reads every inquiry himself and will reply within one business day. If you can text photos of where the deck will tie into the house, that speeds up the first walk-through.",
    nextLabel: "How we build decks →",
    nextHref: "/services/decks-porches",
  },
  "Home Addition": {
    confirmHeadline: "Addition inquiry received.",
    confirmBody:
      "Additions take careful planning. We'll reach out within one business day to schedule an on-site visit and walk you through how scope, design, and permitting fit together.",
    nextLabel: "How additions work →",
    nextHref: "/services/home-additions",
  },
  "Custom Greenhouse": {
    confirmHeadline: "Greenhouse request received.",
    confirmBody:
      "Custom greenhouses are quoted on-site once we've seen sun exposure and grade. Jim will be in touch within one business day to set up a visit.",
    nextLabel: "Greenhouse builds →",
    nextHref: "/services/custom-greenhouses",
  },
  "General Repair / Carpentry": {
    confirmHeadline: "Repair request received.",
    confirmBody:
      "Smaller repair and carpentry jobs usually get scheduled within a week or two. Jim will text or call within one business day to confirm scope and timing.",
    nextLabel: "Repair & carpentry →",
    nextHref: "/services/general-contracting",
  },
  "Drywall / Trim": {
    confirmHeadline: "Drywall / trim request received.",
    confirmBody:
      "Jim will reply within one business day. If you can share a photo or rough square footage, we can usually give you a tighter ballpark before scheduling the visit.",
    nextLabel: "Repair & carpentry →",
    nextHref: "/services/general-contracting",
  },
  "Other (please describe)": {
    confirmHeadline: "Inquiry received.",
    confirmBody:
      "Jim will read your message personally and reach out within one business day to figure out the right next step.",
    nextLabel: "All services →",
    nextHref: "/services",
  },
  default: {
    confirmHeadline: "Thank you.",
    confirmBody:
      "Jim will read your message personally and get back to you within one business day.",
    nextLabel: "All services →",
    nextHref: "/services",
  },
};

export function followUpFor(service?: string | null, city?: string | null): FollowUp {
  const resolved = resolveFormService(service);
  const base = FOLLOWUPS[resolved || "default"] ?? FOLLOWUPS.default;
  if (city && city.trim()) {
    return {
      ...base,
      confirmBody: `${base.confirmBody} We've noted you're in ${city.trim()} — we work that area regularly, so scheduling should be straightforward.`,
    };
  }
  return base;
}

/**
 * Build a helpful prefilled message when a homeowner deep-links from a
 * service or city page into /contact.
 */
export function prefillMessage({
  service,
  city,
}: {
  service?: string | null;
  city?: string | null;
}): string {
  const s = resolveFormService(service);
  const parts: string[] = [];
  if (s && s !== "Other (please describe)") {
    parts.push(`I'm interested in ${s.toLowerCase()}.`);
  }
  if (city && city.trim()) {
    parts.push(`The project is in ${city.trim()}, OH.`);
  }
  if (parts.length === 0) return "";
  parts.push(""); // blank line for the homeowner to continue
  parts.push("A few details:");
  return parts.join("\n");
}
