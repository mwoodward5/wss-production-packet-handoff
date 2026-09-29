import { createFileRoute } from "@tanstack/react-router";
import heroImg from "@/assets/service-flatwork.webp";
import { ServiceLayout } from "@/components/ServiceLayout";
import { jsonLd, servicePageLd } from "@/lib/schema";
import type { FaqItem } from "@/components/FAQ";

const faqs: FaqItem[] = [
  { q: "How much does commercial concrete cost?", a: "Every project is quoted individually in writing after the scope is known — thickness, strength, reinforcement, finish, prep, and demolition each appear as their own line, so bids can be compared line against line." },
  { q: "How long does a commercial concrete pour take?", a: "It depends on the scope. A mid-size slab typically runs a few days from prep to pour, followed by a cure window before loads and full design strength. Your schedule is stated in the written quote." },
  { q: "Do you do ADA ramps and parking-lot concrete?", a: "Yes — ADA-compliant ramps, sidewalks, curbs, wheel stops, and parking-lot pads are core commercial work." },
  { q: "Can you work as a sub for a GC?", a: "Yes. Subbing for general contractors and working direct-to-owner are both part of the scope — the spec and schedule are written either way." },
  { q: "Do you handle permits?", a: "When the jurisdiction requires them, permit coordination and inspection scheduling are quoted as part of the scope." },
  { q: "Will my concrete crack?", a: "All concrete moves as it cures and as temperature changes. Proper sub-base, reinforcement, and saw-cut control joints decide where and how much — that is the difference between hairline shrinkage and structural failure." },
];

export const Route = createFileRoute("/commercial-concrete")({
  head: () => ({
    meta: [
      { title: "Commercial Concrete Contractor in {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      {
        name: "description",
        content:
          "Commercial concrete in {{CITY}}, {{STATE}} — slabs, ADA ramps, parking pads, structural pours. Written, itemized quotes.[[NEED:PHONE]] Call {{PHONE}}.[[/NEED]][[NEED:!PHONE]] Request an estimate online.[[/NEED]]",
      },
      { property: "og:title", content: "Commercial Concrete Contractor in {{CITY}}, {{STATE}}" },
      { property: "og:description", content: "Slabs, foundations, flatwork, ADA ramps — {{CITY}}, {{STATE}} and the surrounding area." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/commercial-concrete" }],
    scripts: [
      jsonLd(servicePageLd(
        "Commercial Concrete",
        "Commercial slabs, ADA ramps, parking-lot concrete and structural pours in {{CITY}}, {{STATE}}.",
        "/commercial-concrete",
        faqs,
        [
          { name: "Home", path: "/" },
          { name: "Commercial Concrete", path: "/commercial-concrete" },
        ],
      )),
    ],
  }),
  component: () => (
    <ServiceLayout
      slug="commercial-concrete"
      title="Commercial Concrete"
      heroHeadline="Commercial concrete built for spec and schedule."
      heroSub="Slabs, ADA ramps, parking-lot pads, structural pours and tilt-up support — engineered, finished, and walked with you at the end."
      heroImage={heroImg}
      heroImageAlt="Polished commercial concrete floor inside a warehouse"
      inShort="{{BUSINESS_NAME}} handles commercial concrete in {{CITY}}, {{STATE}} — slabs, ADA ramps, parking pads, and structural pours, quoted itemized in writing with the spec you can hold the work to."
      whyBest={[
        "A written spec before the pour — strength, thickness, reinforcement, finish, prep, and haul-off each named.",
        "One point of contact from quote through walkthrough, for GCs and direct owners alike.",
        "Itemized quotes that make bids comparable line against line.",
        "Permit and inspection coordination quoted as part of the scope.",
        "Concrete finished for how the surface will actually be used — broom, smooth, or sealed.",
      ]}
      affordable="Fair commercial pricing means the right spec at an honest number — no padded line items, and no winning a bid by quietly cutting depth, reinforcement, or prep. Every quote itemizes exactly what is included so a lower bid elsewhere can be checked for what it silently omits."
      cost={{
        range: "Every project is priced individually — the quote itemizes the spec instead of quoting a single square-foot number.",
        factors: [
          "Slab thickness (4\" vs 6\" vs 8\"+)",
          "Concrete PSI and mix design",
          "Reinforcement grade, spacing, and welded wire mesh",
          "Sub-base prep and moisture protection",
          "Surface finish (broom, smooth, sealed)",
          "Site access and pump requirements",
          "Demolition or excavation included",
          "Saw-cut joints, sealing, curing compounds",
        ],
      }}
      hireChecklist={[
        "Ask for an itemized quote — not a one-line lump sum.",
        "Confirm who runs the crews and who holds the contract.",
        "Ask about sub-base prep, reinforcement grade, and joint spacing — vague answers are a red flag.",
        "Get the spec in the contract, not a verbal promise.",
        "Ask for recent commercial references.",
        "Confirm permit and inspection responsibilities in writing.",
      ]}
      problems={[
        "Cracking, spalling, or settling slabs from poor sub-base prep.",
        "Failed inspections from missing reinforcement, joint spacing, or thickness.",
        "Schedule overruns from contractors juggling too many jobs.",
        "ADA ramps and curbs that don't meet code on first inspection.",
        "Old slabs in tenant improvements that need cut, removed, and re-poured.",
        "Loading-dock and forklift slabs cracking under heavy point loads.",
      ]}
      highIntentAnswers={[
        { q: "Who should I hire for commercial concrete?", a: "A contractor that gives written itemized quotes, runs crews it stands behind, and puts the spec — PSI, thickness, reinforcement, joints — in the contract before the pour." },
        { q: "How do I compare concrete bids?", a: "Line against line: sub-base, reinforcement grade and spacing, thickness, finish, joint plan, and haul-off. The cheapest bid usually differs in one of those, not in price alone." },
        { q: "What drives commercial concrete cost?", a: "Thickness, mix design, reinforcement, prep, finish, access, and whether demolition or excavation is included — each appears as its own line in the quote." },
        { q: "When can work start?", a: "Start dates are stated in the written quote alongside permits, engineering, and concrete-delivery scheduling — the schedule is shared before you sign anything." },
      ]}
      faqs={faqs}
      narrative={[
        "Commercial concrete is the backbone of every commercial build, and the difference between a slab that performs and one that fails is almost entirely about prep — sub-base compaction, moisture protection, reinforcement grade and spacing, joint layout, and the discipline to do the boring work right before the truck arrives.",
        "The work spans foundation pours that have to hit a tight engineered spec, warehouse slabs that will see daily forklift traffic for decades, ADA retrofits on existing concrete, parking-lot re-pours, tilt-up panel footings, and equipment pads. The mix of warehouse, retail, tenant improvement, and retrofit work is what keeps crews sharp on all of it.",
        "Climate is a real factor in scheduling: hot-weather pours need temperature management, retarders, and careful cure protection; wet-season work needs scheduling that respects the forecast. The plan for all of it is written into the quote, not improvised on pour day.",
        "If your project is a new ground-up slab, an ADA retrofit, a parking-lot re-pour, a tilt-up footing system, or a warehouse pad with heavy point-load reinforcement — it can be quoted. Site visits are scheduled through the contact page, and the written quote itemizes every line.",
      ]}
      benefits={[
        { title: "One point of contact", body: "Quote, schedule, pour, and walkthrough — the same name stays accountable." },
        { title: "Itemized written quotes", body: "Strength, thickness, reinforcement, finish, prep, haul-off — all spelled out." },
        { title: "Spec in the contract", body: "The mix, depth, and joint plan are written down before the pour, not after." },
        { title: "Permits & inspections handled", body: "Permit coordination and inspection scheduling quoted as part of the scope." },
        { title: "ADA-code expertise", body: "Ramps, curb cuts, detectable warnings — laid out to pass inspection." },
        { title: "Honest bid comparisons", body: "If a cheaper bid is missing reinforcement, prep, or jointing — it gets shown to you." },
      ]}
      materials={[
        { label: "Concrete PSI", value: "3,000 / 3,500 / 4,000 / 4,500+ psi mixes per spec" },
        { label: "Reinforcement", value: "Rebar grades and spacing, welded wire mesh, fiber per engineered spec" },
        { label: "Finishes", value: "Broom, hard-trowel, sealed, or polished per use" },
        { label: "Joints", value: "Saw-cut control joints and expansion joints per plan" },
      ]}
      projectTypes={[
        "Warehouse and distribution slabs",
        "Retail and office pads",
        "ADA ramps and sidewalk retrofits",
        "Parking-lot pads and re-pours",
        "Loading docks and dumpster pads",
        "Equipment pads (HVAC, generator, standby)",
        "Tilt-up panel footings",
        "Tenant-improvement saw-cut and re-pour",
      ]}
    />
  ),
});
