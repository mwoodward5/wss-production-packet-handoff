// WSS donor identity — EVERY identity string is a Mirror Engine token.
// The donor business (an Arizona concrete contractor) was tokenized at source
// in the verbatim port: nothing below may ever name the source business.
// Values are substituted by lib/mirror-engine/hydrate.js across every shipped
// text file, so the SAME string lands in the prerendered HTML and in this
// module's compiled literals — which is what keeps hydration tear-free.
//
// Optional tokens (PHONE, EMAIL, PROFILE_URL, …) render through the WSSC store
// (src/lib/wssc.ts) so a blank fact collapses its construct at runtime instead
// of shipping "Call " with nothing after it.
export const site = {
  name: "{{BUSINESS_NAME}}",
  legalName: "{{BUSINESS_NAME}}",
  phone: "{{PHONE}}",
  phoneTel: "{{PHONE_DIGITS}}",
  email: "{{EMAIL}}",
  city: "{{CITY}}",
  state: "{{STATE}}",
  region: "{{STATE}}",
  address: {
    locality: "{{ADDRESS_CITY}}",
    region: "{{STATE}}",
    country: "US",
  },
  url: "{{SITE_URL}}",
  profileUrl: "{{PROFILE_URL}}",
  logoUrl: "{{LOGO_URL}}",
  // Hours are NEVER template copy — a Mon–Sat schedule is a claim the source
  // business published. They render only from the verified content island.
  hours: "",
};

// Template-default service lines. These are the design's own cards (neutral
// trade vocabulary, no geography, no claims) and are the FALLBACK when the
// engine's content island carries no verified services. Live services from
// window.__WSS_CONTENT__ replace them on real builds (src/lib/wssc.ts).
export type ServiceLine = {
  slug: string;
  title: string;
  short: string;
  icon: string;
};

export const services: ServiceLine[] = [
  { slug: "commercial-concrete", title: "Commercial Concrete", short: "Slabs, pads, ADA ramps & site concrete for commercial builds.", icon: "Building2" },
  { slug: "foundations-excavation", title: "Foundations & Excavation", short: "Engineered footings, stem walls & site prep for new construction.", icon: "Layers" },
  { slug: "flatwork-driveways", title: "Flatwork & Driveways", short: "Smooth-finish driveways, sidewalks, patios and warehouse floors.", icon: "Square" },
  { slug: "concrete-demolition", title: "Concrete Demolition", short: "Saw-cut, break-out and haul-off for slabs, footings and walls.", icon: "Hammer" },
  { slug: "commercial-renovation", title: "Commercial Renovation", short: "Tenant improvements, retail buildouts & ADA upgrades.", icon: "Paintbrush" },
  { slug: "home-renovation", title: "Home Renovation & Repairs", short: "Bathroom remodeling, concrete decks, home repairs & renovations.", icon: "Home" },
  { slug: "flooring-services", title: "Flooring Services", short: "Tile, laminate, and vinyl plank flooring installed clean and level.", icon: "LayoutGrid" },
];

// Template-default FAQ — neutral trade copy over REQUIRED tokens only. The
// island's verified FAQs replace these on real builds (src/lib/wssc.ts).
export const templateFaqs: { q: string; a: string }[] = [
  { q: "Do you handle both commercial and residential concrete?", a: "Yes. Commercial concrete — foundations, flatwork, demolition, excavation — plus residential driveways, patios, and remodels. Tell us the scope through the estimate form and we will confirm fit in writing." },
  { q: "How do I request a quote?", a: "Use the estimate form on this page[[NEED:PHONE]] or call {{PHONE}}[[/NEED]]. Describe the project, the approximate size, and your timeline, and you will get a written response with next steps." },
  { q: "Where do you work?", a: "We are based in {{CITY}}, {{STATE}} and take on projects in the surrounding area. If your site is nearby, send the address with your request and we will confirm coverage." },
  { q: "What affects the cost of a concrete project?", a: "Slab thickness, concrete strength (PSI), reinforcement, sub-base prep, finish, site access, and whether demolition or excavation is included. Every quote is itemized so you can see each of these as its own line." },
  { q: "Do you pull permits?", a: "When the jurisdiction requires them, yes — permit coordination and inspection scheduling are part of the scope we quote in writing." },
  { q: "Will my concrete crack?", a: "All concrete moves as it cures and as temperature changes. Proper sub-base, reinforcement, and saw-cut control joints decide where and how much — that is the difference between hairline shrinkage and structural failure." },
];
