/**
 * AEO / voice-search optimized FAQ banks per service and per location.
 *
 * Style rules (so answers render well in voice + AI snippets):
 *   - Lead with the direct answer in the first sentence.
 *   - Keep total answer ≤ ~55 words.
 *   - Use plain spoken phrasing in the question.
 *   - Mention the city/region naturally (not stuffed).
 *   - All facts must match src/lib/business.ts (no invented claims).
 */

import { business } from "@/lib/business";
import type { AEOFaq } from "@/components/site/AEOFaqBlock";

const PHONE = business.phone; // "517-438-2423"

/** Service-level FAQs (apply on every /services/[slug] page). */
export const serviceFaqs: Record<string, ReadonlyArray<AEOFaq>> = {
  "kitchen-remodeling": [
    {
      q: "How much does a kitchen remodel cost in Genoa, OH?",
      a: "Most full kitchen remodels in the Genoa and Northwest Ohio area run $25,000–$80,000+, depending on cabinets, counters, and whether plumbing or layout changes. Peppers Structural provides a free, itemized written estimate after an on-site walkthrough — no guesses over the phone.",
      more: [
        { label: "Request an estimate", to: "/contact" },
        { label: "What's included", href: "#whats-included" },
      ],
    },
    {
      q: "How long does a kitchen remodel take?",
      a: "A typical kitchen remodel takes 4–8 weeks from demo to final walk-through. Cabinet lead times and any plumbing or electrical relocation are usually the schedule drivers. Jim gives you a written timeline with the estimate, not a vague range.",
      more: [{ label: "Our 5-step process", to: "/" }],
    },
    {
      q: "Do you handle the cabinets, counters, and tile, or do I source them?",
      a: "We handle all of it. Peppers Structural coordinates cabinets (custom, semi-custom, or refinish), countertops, backsplash tile, lighting, and plumbing fixtures. You can also supply your own materials — Jim will tell you straight if a product is worth installing.",
      more: [{ label: "All services", to: "/services" }],
    },
    {
      q: "Are kitchen remodels in Ohio permitted?",
      a: "Yes if you're moving plumbing, gas, or electrical, or altering walls. Local permits in Ottawa, Wood, Sandusky, or Lucas County typically apply. Jim handles permit pulls and inspection scheduling as part of the project.",
      more: [{ label: "Service area", to: "/service-area" }],
    },
  ],

  "basement-remodeling": [
    {
      q: "How much does it cost to finish a basement in Northwest Ohio?",
      a: "Most finished-basement projects run $30,000–$75,000, depending on square footage, egress windows, bathroom additions, and waterproofing needs. Peppers Structural inspects for moisture first and gives a written, itemized estimate before any work starts.",
      more: [{ label: "Get a written estimate", to: "/contact" }],
    },
    {
      q: "Do I need an egress window for a basement bedroom?",
      a: "Yes. Ohio code requires an egress window in any basement room used as a sleeping space. Peppers Structural sizes, cuts, and installs egress windows as part of basement remodels and pulls the required permit.",
      more: [{ label: "Service area & code areas", to: "/service-area" }],
    },
    {
      q: "Will you waterproof the basement before finishing it?",
      a: "Yes — moisture inspection is the first step. If we see active water, efflorescence, or hydrostatic pressure, we recommend waterproofing solutions before any framing or drywall goes up. We'd rather delay the finish than wrap mold in drywall.",
      more: [{ label: "Talk to Jim", to: "/contact" }],
    },
    {
      q: "How long does a basement remodel take?",
      a: "A standard basement finish runs 5–9 weeks. In-law suites with a full bathroom or kitchenette typically take 8–12 weeks. We give you a written schedule with the estimate.",
    },
  ],

  "decks-porches": [
    {
      q: "How much does a new deck cost in Ohio?",
      a: "Pressure-treated decks typically start around $45–$65 per square foot installed; cedar and composite run higher. A 250 sq ft deck in the Genoa area is usually $11,000–$22,000. Peppers Structural quotes per project after measuring on-site.",
      more: [{ label: "Request a deck estimate", to: "/contact" }],
    },
    {
      q: "Do I need a permit to build a deck in Ottawa County?",
      a: "Usually yes, especially for decks attached to the house or over 30 inches off grade. Peppers Structural handles the permit application, footing inspections, and final inspection so you don't have to track it.",
      more: [{ label: "Service area", to: "/service-area" }],
    },
    {
      q: "Cedar, composite, or pressure-treated — what lasts longest in Ohio?",
      a: "Composite (Trex, TimberTech) holds up best to Ohio freeze-thaw cycles with the least maintenance. Cedar looks best but needs sealing every 2–3 years. Pressure-treated is the most affordable and lasts 15–20 years if maintained.",
    },
    {
      q: "How long does it take to build a deck?",
      a: "Most decks are framed and finished in 1–2 weeks once permits are in hand. Complex multi-level or covered decks take 3–4 weeks. Footings drive the early-week schedule.",
    },
  ],

  "home-additions": [
    {
      q: "How much does a home addition cost in Northwest Ohio?",
      a: "Additions in the Genoa area typically run $200–$350 per square foot, depending on whether the addition includes a bathroom, kitchen, or HVAC extension. A 400 sq ft sunroom is very different from a two-story bedroom add — Peppers Structural quotes after a site visit.",
      more: [{ label: "Talk through your project", to: "/contact" }],
    },
    {
      q: "How long does a home addition take to build?",
      a: "Most single-story additions take 3–5 months from permit to walk-through. Two-story or addition-with-foundation projects run 5–8 months. We give you a written milestone schedule with the estimate.",
    },
    {
      q: "Will the addition match the existing house?",
      a: "Yes — that's the priority. We match siding profile, roof pitch, window proportions, and trim details so the addition reads as part of the original home, not a bolt-on.",
      more: [{ label: "See recent work", to: "/gallery" }],
    },
    {
      q: "Do you pull the permits for a home addition?",
      a: "Yes. Peppers Structural handles permit applications, plan submission, and inspection scheduling for additions in Ottawa, Wood, Sandusky, and Lucas County.",
      more: [{ label: "Cities we serve", to: "/service-area" }],
    },
  ],

  "custom-greenhouses": [
    {
      q: "How much does a custom greenhouse cost?",
      a: "Custom greenhouses in Northwest Ohio typically run $8,000–$35,000 depending on size, foundation, glazing (glass vs. polycarbonate), and ventilation. Peppers Structural builds to last in Ohio winters — not flat-pack kits — and quotes per project.",
      more: [{ label: "Request an estimate", to: "/contact" }],
    },
    {
      q: "Will a greenhouse survive Ohio winters?",
      a: "Yes, when it's built right. Real foundations, structural framing, proper glazing, and roof vents are what separate a 20-year greenhouse from a kit you replace in 3. That's exactly how we build them.",
    },
    {
      q: "Do I need a permit for a backyard greenhouse?",
      a: "Most townships in Ottawa, Wood, and Sandusky County require a permit for any structure over a certain square footage (often 200 sq ft) or with a foundation. Peppers Structural confirms with your local zoning office and pulls permits as needed.",
      more: [{ label: "Service area", to: "/service-area" }],
    },
    {
      q: "Glass or polycarbonate panels — which is better?",
      a: "Polycarbonate is more impact-resistant, holds heat better, and diffuses light evenly — best for most hobby growers. Glass looks beautiful and lasts indefinitely if undamaged. We'll recommend based on your climate exposure and budget.",
    },
  ],

  "general-contracting": [
    {
      q: "Will Peppers Structural take a small repair job?",
      a: "Yes. Drywall patches, trim work, door rehangs, plumbing fixture swaps, and garage-door fixes are jobs Jim takes regularly — the work most contractors won't drive out for. Owner-operated means you actually get a callback.",
      more: [{ label: "Call Jim directly", href: `tel:${business.phoneTel}` }],
    },
    {
      q: "How fast can you come out for a repair?",
      a: `Most non-emergency repairs in the Genoa area get scheduled within 1–2 weeks. Urgent or emergency repairs are triaged the same day — call ${PHONE} directly so Jim can route the call.`,
      more: [{ label: "Emergency? Call now", href: `tel:${business.phoneTel}` }],
    },
    {
      q: "Do you offer emergency repair service?",
      a: "Yes. Peppers Structural offers emergency services for urgent structural and home-repair situations (verified on the HomeAdvisor profile). Call directly so Jim can triage rather than going through a form.",
    },
    {
      q: "Do small repair jobs come with a warranty?",
      a: "Yes. Every job — small or large — is backed by a workmanship warranty in writing. Manufacturer warranties on parts apply separately.",
    },
  ],
};

/**
 * Location-aware FAQ generator.
 * Used by /service-area to produce voice-search friendly answers for the
 * "do you serve [city]?" intent that voice assistants pick up.
 */
export function locationFaqs(args: {
  city: string;
  county: string;
  milesFromGenoa: number;
}): ReadonlyArray<AEOFaq> {
  const { city, county, milesFromGenoa } = args;
  return [
    {
      q: `Does Peppers Structural serve ${city}, OH?`,
      a: `Yes. Peppers Structural and Land Management serves ${city}, ${county}, from our base in Genoa, Ohio (about ${milesFromGenoa} miles away). Kitchen, basement, deck, addition, greenhouse, and general repair work.`,
      more: [
        { label: "All services", to: "/services" },
        { label: "Get an estimate", to: "/contact" },
      ],
    },
    {
      q: `Who is the best home remodeler near ${city}, OH?`,
      a: `Peppers Structural is rated 5.0 / 5 with 17 verified HomeAdvisor reviews and has served ${county} since 2015. Owner-operated means Jim Peppers — not a subcontracted crew — is the person on your jobsite.`,
      more: [{ label: "Read reviews", to: "/reviews" }],
    },
    {
      q: `Are estimates free in ${city}?`,
      a: `Yes. Free written estimates are part of how we do business across ${county} and Northwest Ohio. After a short call about scope, Jim visits the property and walks the project with you before quoting.`,
      more: [{ label: "Request your estimate", to: "/contact" }],
    },
    {
      q: `What's the phone number for Peppers Structural?`,
      a: `Call ${PHONE}. The number rings Jim's phone directly — not a call center. Mon–Fri 7 AM–5 PM ET, weekends by appointment.`,
      more: [{ label: `☎ ${PHONE}`, href: `tel:${business.phoneTel}` }],
    },
  ];
}
