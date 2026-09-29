import { BUSINESS } from "./business";

/**
 * Service-area + service-routing logic for incoming leads.
 *
 * Categorizes every inquiry by:
 *   - geographic zone (primary / extended / outside)
 *   - workflow lane (emergency / commercial / standard / estimate)
 *   - SLA expectation (response window)
 *
 * The result drives:
 *   - which inbox(es) get the lead email (To + Cc)
 *   - the subject-line prefix and tags Resend uses for filtering
 *   - the in-app confirmation copy shown to the visitor
 *
 * No fabricated data. Only the cities DN Electric publicly lists as
 * service areas count as "primary". Anything else is honestly flagged.
 */

// ─── Geographic coverage ────────────────────────────────────────────────────
// Primary = explicitly listed on the site as a service area.
const PRIMARY_CITIES = BUSINESS.primaryServiceAreas.map((c) => c.toLowerCase());

// Extended = Front Range / Denver metro adjacent — we'll work them but
// schedule and travel may differ.
const EXTENDED_CITIES = [
  "denver",
  "arvada",
  "thornton",
  "northglenn",
  "wheat ridge",
  "golden",
  "superior",
  "loveland",
  "fort collins",
  "windsor",
  "johnstown",
  "platteville",
  "dacono",
  "gunbarrel",
  "lyons",
  "hygiene",
  "nederland",
  "brighton",
  "commerce city",
];

export type ServiceZone = "primary" | "extended" | "outside";

export function classifyZone(rawCity: string): ServiceZone {
  const city = rawCity.trim().toLowerCase().replace(/,?\s*co\b.*$/i, "").trim();
  if (!city) return "outside";
  if (PRIMARY_CITIES.some((c) => city.includes(c))) return "primary";
  if (EXTENDED_CITIES.some((c) => city.includes(c))) return "extended";
  return "outside";
}

// ─── Workflow lane ──────────────────────────────────────────────────────────
export type Lane = "emergency" | "commercial" | "standard" | "estimate";

export function classifyLane(service: string, urgency: string): Lane {
  if (urgency === "emergency") return "emergency";
  if (service === "commercial-electrical") return "commercial";
  if (urgency === "estimate") return "estimate";
  return "standard";
}

// ─── Response SLA copy (truthful — no guarantees we can't keep) ─────────────
const SLA_BY_LANE: Record<Lane, string> = {
  emergency: "For fastest response, please also call (720) 417-0758 — we'll reach back out as soon as possible during business hours.",
  commercial: "A project lead will reach out within one business day.",
  standard: "We typically respond within one business day.",
  estimate: "We typically respond within one business day.",
};

// ─── Recipient routing ──────────────────────────────────────────────────────
// Single inbox today (scheduling@electricdn.com). The structure below lets us
// add specialized inboxes later without touching the API handler.
const PRIMARY_INBOX = BUSINESS.email; // scheduling@electricdn.com

export interface RoutingDecision {
  zone: ServiceZone;
  lane: Lane;
  to: string[];
  cc: string[];
  subjectPrefix: string;
  tags: Array<{ name: string; value: string }>;
  visitorMessage: string;
  inServiceArea: boolean;
  sla: string;
}

const ZONE_LABEL: Record<ServiceZone, string> = {
  primary: "PRIMARY-AREA",
  extended: "EXTENDED-AREA",
  outside: "OUT-OF-AREA",
};

const LANE_LABEL: Record<Lane, string> = {
  emergency: "🚨 EMERGENCY",
  commercial: "COMMERCIAL",
  standard: "LEAD",
  estimate: "ESTIMATE",
};

export function routeLead(opts: {
  city: string;
  service: string;
  urgency: string;
}): RoutingDecision {
  const zone = classifyZone(opts.city);
  const lane = classifyLane(opts.service, opts.urgency);

  const to = [PRIMARY_INBOX];
  const cc: string[] = [];

  // Subject prefix combines lane + zone so the inbox owner can triage at a glance
  const subjectPrefix = `[${LANE_LABEL[lane]} · ${ZONE_LABEL[zone]}]`;

  // Resend tags must match /^[A-Za-z0-9_-]+$/ — keep values simple
  const tags = [
    { name: "lane", value: lane },
    { name: "zone", value: zone },
    { name: "service", value: opts.service.replace(/[^A-Za-z0-9_-]/g, "_") },
    { name: "source", value: "website_contact_form" },
  ];

  // Visitor-facing copy — honest about coverage
  let visitorMessage: string;
  if (zone === "outside") {
    visitorMessage =
      "Thanks — we received your request. Your city isn't on our regular service map, so we'll review it and get back to you to confirm whether we can help or recommend someone who can.";
  } else if (lane === "emergency") {
    visitorMessage =
      "We received your emergency request. " + SLA_BY_LANE.emergency;
  } else {
    visitorMessage = `Thanks — we received your request. ${SLA_BY_LANE[lane]}`;
  }

  return {
    zone,
    lane,
    to,
    cc,
    subjectPrefix,
    tags,
    visitorMessage,
    inServiceArea: zone !== "outside",
    sla: SLA_BY_LANE[lane],
  };
}
