import { createFileRoute } from "@tanstack/react-router";
import heroImg from "@/assets/service-driveways.webp";
import { ServiceLayout } from "@/components/ServiceLayout";
import { jsonLd, servicePageLd } from "@/lib/schema";
import type { FaqItem } from "@/components/FAQ";

const faqs: FaqItem[] = [
  { q: "How much does a driveway cost?", a: "Driveways are quoted per project — size, thickness, reinforcement, finish, demo of any existing slab, and haul-off each appear as their own line in the written quote." },
  { q: "How long does a driveway take?", a: "A typical residential driveway runs a few days from prep to pour plus a cure window before vehicles return. The exact schedule is stated in the quote." },
  { q: "Can you match my existing concrete?", a: "Color, stamp, and finish matching for additions and partial replacements is part of the trade — it gets looked at on the site visit and stated honestly in the quote." },
  { q: "What finish should I choose?", a: "Broom for traction and low maintenance, smooth or sealed for looks, stamped or exposed-aggregate for decorative work. The quote prices each finish as its own line." },
  { q: "Do you demolish the old slab?", a: "Yes — saw-cut, break-out, and haul-off of existing concrete is quoted alongside the new pour." },
  { q: "Will my driveway crack?", a: "All concrete moves as it cures and as temperature changes. Proper sub-base, reinforcement, and control joints decide where — that is the difference between hairline shrinkage and a broken slab." },
];

export const Route = createFileRoute("/flatwork-driveways")({
  head: () => ({
    meta: [
      { title: "Driveway & Flatwork Contractor in {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      {
        name: "description",
        content:
          "Driveways, sidewalks, patios and warehouse floors in {{CITY}}, {{STATE}}. Written, itemized quotes.[[NEED:PHONE]] Call {{PHONE}}.[[/NEED]][[NEED:!PHONE]] Request an estimate online.[[/NEED]]",
      },
      { property: "og:title", content: "Driveway & Flatwork Contractor in {{CITY}}, {{STATE}}" },
      { property: "og:description", content: "Smooth-finish driveways, sidewalks, patios and warehouse floors in {{CITY}}, {{STATE}}." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/flatwork-driveways" }],
    scripts: [
      jsonLd(servicePageLd(
        "Flatwork & Driveways",
        "Driveways, sidewalks, patios and warehouse floors — broom through stamped finishes — in {{CITY}}, {{STATE}}.",
        "/flatwork-driveways",
        faqs,
        [
          { name: "Home", path: "/" },
          { name: "Flatwork & Driveways", path: "/flatwork-driveways" },
        ],
      )),
    ],
  }),
  component: () => (
    <ServiceLayout
      slug="flatwork-driveways"
      title="Flatwork & Driveways"
      heroHeadline="Flatwork that finishes like it was poured yesterday."
      heroSub="Driveways, sidewalks, patios, warehouse floors — broom through stamped finishes, placed on prep that earns it."
      heroImage={heroImg}
      heroImageAlt="Newly finished concrete driveway"
      inShort="{{BUSINESS_NAME}} pours driveways and flatwork in {{CITY}}, {{STATE}} — residential and commercial, quoted itemized in writing with the finish, thickness, and reinforcement each named."
      whyBest={[
        "Prep before pour: sub-base, reinforcement, and joint layout decided on paper first.",
        "Finish matched to use — traction where feet and tires go, smooth where looks matter.",
        "Decorative matching for additions and partial replacements, assessed on the site visit.",
        "Old-slab demolition and haul-off quoted alongside the new pour.",
        "Control joints planned so cracks, when concrete moves, stay hairline and where they belong.",
      ]}
      affordable="A fair flatwork price follows the spec — thickness, reinforcement, finish, and what lies under the slab. Quotes itemize each, so a cheaper bid can be checked for what it quietly left out instead of trusted for being cheaper."
      cost={{
        range: "Quoted per project — the finish, thickness, and prep each appear as their own line rather than one square-foot number.",
        factors: [
          "Slab thickness and strength",
          "Reinforcement (rebar or mesh)",
          "Finish — broom, smooth, sealed, stamped, exposed-aggregate",
          "Size and layout (straight runs vs. curves and detail work)",
          "Demolition of existing concrete",
          "Sub-base prep and compaction",
          "Site access and pump requirements",
        ],
      }}
      hireChecklist={[
        "Ask what is under the slab — sub-base and compaction should be in the quote.",
        "Get the joint plan in writing; joints decide where concrete cracks.",
        "Confirm thickness and reinforcement as line items, not assumptions.",
        "Ask how existing concrete is removed and hauled.",
        "Check the cure timeline before vehicles or loads return.",
        "Ask for photos of recent driveways with the same finish.",
      ]}
      problems={[
        "Driveways cracking across the middle from missing control joints.",
        "Puddling and drainage issues from a pour that ignored the grade.",
        "Spalling surfaces from finishing that trapped water.",
        "Slabs settling where sub-base was never compacted.",
        "Color and stamp mismatches on additions and repairs.",
        "Curb and walkway transitions that trip feet and catch shovels.",
      ]}
      highIntentAnswers={[
        { q: "Who should pour my driveway?", a: "A crew that quotes the sub-base, reinforcement, thickness, and joint plan in writing — the four things that decide how the slab ages." },
        { q: "Broom or smooth finish?", a: "Broom for traction and easy upkeep; smooth or sealed where the look matters and foot traffic is light. Decorative finishes are priced as their own line." },
        { q: "How do I compare driveway bids?", a: "Line by line: thickness, reinforcement, sub-base, finish, demo, and haul-off. The cheapest bid usually thins one of them." },
        { q: "Can you match my existing concrete?", a: "Often — color, stamp, and finish matching is assessed on the site visit and the honest answer about how close it will get is written into the quote." },
      ]}
      faqs={faqs}
      narrative={[
        "Flatwork is where concrete meets daily life — the driveway you back out of, the sidewalk the mail carrier uses, the patio the family eats on. It takes the most abuse of any concrete, which means the prep underneath it matters most.",
        "The parts nobody talks about are the parts that decide the outcome: sub-base compacted so the slab has something to sit on, reinforcement placed where it does work, a joint plan so movement stays controlled, and a finish matched to how the surface will be used.",
        "Residential or commercial, a driveway or a warehouse floor — the spec is written the same way, as an itemized quote you can compare against any other bid line for line.",
      ]}
      benefits={[
        { title: "Prep before pour", body: "Sub-base, reinforcement, and joints planned on paper before the truck arrives." },
        { title: "Finish matched to use", body: "Traction where it matters, smooth where it shows, decorative where it counts." },
        { title: "Demolition included", body: "Old slabs cut, broken out, and hauled off as part of the scope." },
        { title: "Drainage-conscious", body: "Grade and runoff considered in the layout, not discovered after the rain." },
        { title: "Itemized quotes", body: "Every spec line named so bids compare fairly." },
      ]}
      materials={[
        { label: "Concrete strength", value: "Per spec — driveway and floor mixes quoted by line" },
        { label: "Reinforcement", value: "Rebar or welded wire mesh per use and load" },
        { label: "Finishes", value: "Broom, hard-trowel, sealed, stamped, exposed-aggregate, color" },
        { label: "Joints", value: "Control and expansion joints per layout" },
      ]}
      projectTypes={[
        "Residential driveways and aprons",
        "Sidewalks and walkways",
        "Patios and pool decks",
        "RV and boat pads",
        "Warehouse and shop floors",
        "Approaches, curbs, and gutters",
      ]}
    />
  ),
});
