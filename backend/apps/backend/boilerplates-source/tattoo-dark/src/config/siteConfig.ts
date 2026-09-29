import heroPoster from "@/assets/hero-poster.jpg";
import heroLoop from "@/assets/hero-loop.mp4.asset.json";
import gallery01 from "@/assets/gallery-01.jpg";
import gallery02 from "@/assets/gallery-02.jpg";
import gallery03 from "@/assets/gallery-03.jpg";
import gallery04 from "@/assets/gallery-04.jpg";
import gallery05 from "@/assets/gallery-05.jpg";
import gallery06 from "@/assets/gallery-06.jpg";
import process01 from "@/assets/process-01.jpg";
import process02 from "@/assets/process-02.jpg";
import process03 from "@/assets/process-03.jpg";
import process04 from "@/assets/process-04.jpg";

// Studio geo — used for maps, deep-link directions, and LocalBusiness schema.
const geo = { lat: 30.2635, lng: -97.7333 } as const;
const encAddress = encodeURIComponent("100 Main Street, Austin, TX 78701");

export const siteConfig = {
  artistName: "Studio Artist",
  studioName: "STUDIO NAME",
  domain: "example.com",
  city: "Austin",
  state: "TX",
  postalCode: "78702",
  neighborhood: "East Austin",
  phone: "(555) 555-0100",
  phoneTel: "+15555550100",
  email: "booking@example.com",
  instagram: "https://instagram.com/example",
  instagramHandle: "@example",
  address: "100 Main Street, Austin, TX",
  addressLine1: "100 Main Street",
  addressLocality: "Austin",
  addressRegion: "TX",
  geo,
  tagline: "Custom blackwork, fine-line & illustrative tattoos built around your story.",
  bio: "Specializes in intentional, precise custom work for clients who want something meaningful — not rushed. Every piece is drawn to fit your body.",
  quote: "Every tattoo I put on a person is drawn for the body that walks in — not pulled off a wall.",
  longBio: [
    "Placeholder biography — replace with the artist's real background, training, and studio story at hydration time. Never ship this placeholder to a live client site.",
    "Placeholder paragraph — real client copy must come from verified facts (their own site, socials, or direct interview), never invented.",
    "Placeholder paragraph — third paragraph slot for guest-spot/press/community details if the client has them.",
  ],
  bookingStatus: "Books open for September & October",
  pricing: { deposit: "$150", minimum: "$250", hourly: "$220/hr", priceRange: "$$" },
  heroImage: heroPoster,
  heroVideo: heroLoop.url,

  hours: [
    { day: "Tuesday",   open: "12:00", close: "20:00" },
    { day: "Wednesday", open: "12:00", close: "20:00" },
    { day: "Thursday",  open: "12:00", close: "20:00" },
    { day: "Friday",    open: "12:00", close: "20:00" },
    { day: "Saturday",  open: "11:00", close: "19:00" },
  ],
  closedDays: ["Sunday", "Monday"],

  directions: {
    google: `https://www.google.com/maps/dir/?api=1&destination=${encAddress}`,
    apple: `https://maps.apple.com/?daddr=${encAddress}&t=m`,
    waze: `https://waze.com/ul?ll=${geo.lat},${geo.lng}&navigate=yes`,
    googleEmbed:
      `https://www.google.com/maps?q=${encAddress}&z=15&output=embed`,
  },
  parking: "Placeholder — replace with the studio's real parking situation.",
  transit: "Placeholder — replace with real transit directions.",
  landmarks: "Between Sabine Street and Waller Street — three doors down from Hotel Vegas, across from Cisco's Restaurant.",
  areasServed: ["Austin", "East Austin", "Downtown Austin", "South Congress", "Cedar Park", "Round Rock", "Pflugerville"],

  credentials: [
    { label: "Studio License", value: "Placeholder — insert the real state/local license number." },
    { label: "Bloodborne Pathogen Certification", value: "OSHA-compliant, renewed annually" },
    { label: "Autoclave Sterilization", value: "Placeholder — insert the real sterilization equipment/schedule." },
    { label: "Health Inspection", value: "Placeholder — insert the real inspecting authority and date." },
    { label: "Single-use needles", value: "Every needle and cartridge is disposed after your session" },
  ],

  timeline: [
    { year: "20XX", event: "Placeholder — replace with the artist's real training/apprenticeship milestone." },
    { year: "20XX", event: "Placeholder — replace with when they went independent or opened the studio." },
    { year: "20XX", event: "Placeholder — replace with a real press feature or notable milestone, if any." },
    { year: "20XX", event: "Placeholder — replace with the studio's real opening milestone." },
    { year: "20XX", event: "Placeholder — replace with current booking cadence." },
    { year: "20XX", event: "Placeholder — replace with the current booking-status milestone." },
  ],

  services: [
    { slug: "fine-line",     name: "Fine-Line Custom",   startingAt: "$250", desc: "Delicate single-needle work — botanical, script, symbolic. Best on inner arm, ribs, ankle." },
    { slug: "blackwork",     name: "Blackwork & Bold",   startingAt: "$450", desc: "Saturated black, negative space, ornamental panels. Multi-session for larger pieces." },
    { slug: "illustrative",  name: "Illustrative",       startingAt: "$400", desc: "Editorial-style illustration with botanical and object motifs. Drawn to your anatomy." },
    { slug: "ornamental",    name: "Ornamental",         startingAt: "$500", desc: "Symmetrical mandalas, chest ornaments, decorative bands. Engineered for the body's lines." },
    { slug: "cover-up",      name: "Cover-Up",           startingAt: "$650", desc: "Reworking older tattoos into something you'll actually wear. Requires an in-person consult." },
    { slug: "touch-up",      name: "Touch-Up",           startingAt: "Free within 90 days", desc: "Any settling or fade correction inside 90 days of your original session — on the house." },
  ],

  pricingBands: [
    { size: "Small (under 3\")",     range: "$250 – $450" },
    { size: "Medium (3\" – 6\")",    range: "$450 – $900" },
    { size: "Large (6\" – 10\")",    range: "$900 – $2,000" },
    { size: "Half sleeve",            range: "$1,800 – $3,500" },
    { size: "Full sleeve / back",    range: "$4,000+ multi-session" },
  ],

  specialties: ["Blackwork", "Fine Line", "Botanical", "Ornamental", "Illustrative"],

  gallery: [
    { title: "Botanical Spine",     slug: "botanical-spine",     style: "Botanical",    placement: "Back",     size: "Large",  image: gallery01, aspect: "tall"   as const, note: "Fine botanical linework flowing along the spine. Session est. 3–4 hrs." },
    { title: "Fine Line Hand",      slug: "fine-line-hand",      style: "Fine Line",    placement: "Hand",     size: "Small",  image: gallery02, aspect: "square" as const, note: "Minimalist symbol set — clean, healed pigment. Session est. 1 hr." },
    { title: "Blackwork Panel",     slug: "blackwork-panel",     style: "Blackwork",    placement: "Arm",      size: "Medium", image: gallery03, aspect: "tall"   as const, note: "Bold saturated blackwork with negative-space geometry. Session est. 4–5 hrs." },
    { title: "Ornamental Chest",    slug: "ornamental-chest",    style: "Ornamental",   placement: "Chest",    size: "Large",  image: gallery04, aspect: "square" as const, note: "Symmetrical mandala engineered for the sternum. Session est. 5–6 hrs." },
    { title: "Illustrative Dagger", slug: "illustrative-dagger", style: "Illustrative", placement: "Forearm",  size: "Medium", image: gallery05, aspect: "tall"   as const, note: "Illustrative dagger with botanical wrap. Session est. 3–4 hrs." },
    { title: "Star Set",            slug: "star-set",            style: "Fine Line",    placement: "Wrist",    size: "Small",  image: gallery06, aspect: "square" as const, note: "Micro fine-line star cluster. Session est. 45 min." },
  ],

  flash: [
    { title: "Moon Moth",         price: "$280", size: "Palm size",    note: "Repeatable",    status: "Available" as const },
    { title: "Thorn Band",        price: "$350", size: "Wrist / ankle", note: "Blackwork",     status: "Available" as const },
    { title: "Botanical Dagger",  price: "$480", size: "Forearm",       note: "One-time only", status: "One left"  as const },
  ],
  nextFlashDropAt: "2026-08-04T12:00:00-05:00", // next Tuesday noon CT

  process: [
    { step: "01", title: "Send your idea",   text: "Share concept, placement, size, budget and references. The more specific, the better the fit review.", image: process01 },
    { step: "02", title: "Artist review",    text: "The artist personally reviews every request within 3 business days — creative fit, timing, and session estimate.", image: process02 },
    { step: "03", title: "Reserve your date", text: "Approved projects receive available dates, a deposit link, and a private prep guide.", image: process03 },
    { step: "04", title: "Create the piece",  text: "Final art drawn for your anatomy and preferences. Small adjustments handled the day of.", image: process04 },
  ],

  policies: [
    "Non-refundable deposit reserves your appointment and applies to the final cost.",
    "One reschedule allowed with 72+ hours notice.",
    "No-shows or cancellations inside 72 hours forfeit the deposit.",
    "Arrivals 20+ minutes late may be treated as a no-show.",
    "Large custom pieces require a consultation before booking.",
    "Free touch-ups for settling or fade within 90 days of your original session.",
    "18+ only. Government-issued photo ID required at your appointment.",
  ],
  aftercare: [
    "Leave wrap on 2–4 hours (or as instructed).",
    "Wash gently with fragrance-free soap, pat dry.",
    "Apply thin layer of aftercare balm 2–3x daily.",
    "No pools, ocean, saunas, or direct sun for 2–3 weeks.",
    "Do not pick or scratch while healing.",
  ],

  faqs: [
    { q: "How do I book a tattoo appointment?", a: "Submit the request form on any page with your placement, size, style, budget, and references. The artist personally reviews every request within 3 business days. If it's a fit, you'll receive appointment options and a deposit link." },
    { q: "How much does a custom tattoo cost?", a: "Small pieces start at $250. Medium work runs $450–$900. Half sleeves start around $1,800. Every quote is set after the artist reviews the concept — no surprises the day of." },
    { q: "Do you take walk-ins?", a: "This is a private, appointment-only studio. Occasional flash walk-ins are announced on Instagram." },
    { q: "Can I bring my own design?", a: "Yes. It will usually be redrawn to fit your body and match the studio's illustrative style. The redraw is included — no extra fee." },
    { q: "How far out are you booked?", a: "Books typically run 3–6 months out. Right now Sept and Oct 2026 are open." },
    { q: "Do you offer touch-ups?", a: "Yes. Any settling, fading, or gaps inside 90 days of the original session are corrected free of charge." },
    { q: "What styles do you specialize in?", a: "Fine-line, blackwork, botanical, ornamental, and illustrative tattoos. Cover-ups by consultation only." },
    { q: "Can I see the final drawing before my appointment?", a: "Yes. Custom artwork is finalized close to your appointment date. Small adjustments are handled the day of." },
    { q: "Where is the studio located?", a: "Placeholder — replace with the real address and cross-street landmarks." },
    { q: "Is there parking?", a: "Placeholder — replace with the real parking situation." },
    { q: "How long will my tattoo take to heal?", a: "Surface healing runs 2–3 weeks; full deep healing takes about 90 days. A written aftercare guide is emailed with your appointment confirmation." },
    { q: "Do you tattoo over scars or stretch marks?", a: "Yes — mature scars (12+ months old) and stretch marks are usually tattooable. It's discussed at consultation." },
    { q: "Can I get a tattoo if I'm pregnant or breastfeeding?", a: "No. Studio policy is to defer until you're no longer pregnant or breastfeeding. Health and safety, no exceptions." },
    { q: "Do you tattoo minors?", a: "No. AURELIA INK is 18+ only. Government-issued photo ID is required at every appointment." },
    { q: "What's your cancellation policy?", a: "One reschedule allowed with 72+ hours notice. Cancellations inside 72 hours or no-shows forfeit the deposit." },
    { q: "How much is the deposit?", a: "$150, applied toward the final cost. It reserves your appointment and is non-refundable." },
    { q: "Do you accept card and Apple Pay?", a: "Yes — all major cards, Apple Pay, Google Pay, and cash. For pieces over $800 we can offer 4-payment financing on request." },
    { q: "Can I bring a friend to my appointment?", a: "One guest is welcome. The studio stays quiet by design — extra guests slow the work down." },
    { q: "How should I prep the day of?", a: "Eat a real meal, hydrate, wear something comfortable that exposes the area, and skip alcohol for 24 hours before. Full prep guide is emailed with your confirmation." },
    { q: "Do you work with sensitive skin or metal allergies?", a: "Yes — nickel-free needles and hypoallergenic pigments on request. Note allergies on the booking form and we'll adjust." },
    { q: "Can I use the photo of my healed tattoo for social?", a: "Absolutely. You can also opt in on the booking form to let the studio photograph your healed piece for portfolio use — no obligation." },
    { q: "Do you sell gift certificates?", a: "Yes. Email us for gift certificates in any amount toward a future session." },
  ],
  reviews: [
    { name: "Maya R.",   text: "The process felt calm and professional. The design was better than what I pictured." },
    { name: "Chris L.",  text: "Booking was simple, the policy was clear, and it healed beautifully." },
    { name: "Jenna P.",  text: "Best tattoo experience — private, clean, and intentional." },
    { name: "Sam D.",    text: "The artist took my rough idea and turned it into something I'll wear proudly forever." },
    { name: "Priya K.",  text: "Every step communicated. Zero surprises. The art speaks for itself." },
  ],

  siteUrl: "https://inkscribe-booking.lovable.app",
};

export type SiteConfig = typeof siteConfig;
