import { createFileRoute } from "@tanstack/react-router";
import heroImg from "@/assets/service-foundations.webp";
import { ServiceLayout } from "@/components/ServiceLayout";
import { jsonLd, servicePageLd } from "@/lib/schema";
import type { FaqItem } from "@/components/FAQ";

const faqs: FaqItem[] = [
  { q: "What does a foundation project include?", a: "Engineered footings, stem walls, monolithic slabs, and the site prep underneath them — excavation, sub-base compaction, and moisture protection, each quoted as its own line." },
  { q: "How is a foundation quoted?", a: "By the spec: footing depth and width, concrete strength, reinforcement schedule, excavation volume, and sub-base conditions. The written quote itemizes each so it can be compared against any other bid." },
  { q: "Do you handle excavation too?", a: "Yes — excavation, grading, and haul-off are quoted alongside the foundation work, which removes the scheduling gap between two trades." },
  { q: "What about inspections?", a: "Inspection scheduling is coordinated as part of the scope — the reinforcement is in place and the paperwork ready when the inspector arrives." },
  { q: "Can you match an engineered drawing?", a: "Yes. Stamped drawings get built as drawn, and any field condition that conflicts with them gets raised in writing before work continues." },
];

export const Route = createFileRoute("/foundations-excavation")({
  head: () => ({
    meta: [
      { title: "Foundation & Excavation Contractor in {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      {
        name: "description",
        content:
          "Foundations and excavation in {{CITY}}, {{STATE}} — engineered footings, stem walls, site prep. Written, itemized quotes.[[NEED:PHONE]] Call {{PHONE}}.[[/NEED]][[NEED:!PHONE]] Request an estimate online.[[/NEED]]",
      },
      { property: "og:title", content: "Foundation & Excavation Contractor in {{CITY}}, {{STATE}}" },
      { property: "og:description", content: "Engineered footings, stem walls, monolithic slabs and site prep in {{CITY}}, {{STATE}}." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/foundations-excavation" }],
    scripts: [
      jsonLd(servicePageLd(
        "Foundations & Excavation",
        "Engineered footings, stem walls, monolithic slabs and site prep in {{CITY}}, {{STATE}}.",
        "/foundations-excavation",
        faqs,
        [
          { name: "Home", path: "/" },
          { name: "Foundations & Excavation", path: "/foundations-excavation" },
        ],
      )),
    ],
  }),
  component: () => (
    <ServiceLayout
      slug="foundations-excavation"
      title="Foundations & Excavation"
      heroHeadline="Foundations poured to the drawing, not past it."
      heroSub="Engineered footings, stem walls, monolithic slabs and full site prep — excavated, formed, reinforced, and inspected."
      heroImage={heroImg}
      heroImageAlt="Foundation footing and stem wall formwork on a new build"
      inShort="{{BUSINESS_NAME}} handles foundations and excavation in {{CITY}}, {{STATE}} — footings, stem walls, and slabs with the site prep quoted as one scope, built to the engineered drawing, and inspected with the reinforcement in place."
      whyBest={[
        "The engineered drawing is the contract — anything the field contradicts gets raised in writing before work continues.",
        "Excavation and foundations under one scope, so there is no gap between two trades.",
        "Sub-base compaction and moisture protection quoted as their own lines, not buried in the pour.",
        "Reinforcement in place and paperwork ready when the inspector arrives.",
        "A written schedule for excavation, formwork, pour, and cure shared before work starts.",
      ]}
      affordable="Fair foundation pricing is a function of the spec — footing depth, concrete strength, reinforcement schedule, and what is actually under the site. Every quote itemizes those, so the number can be checked against the work instead of guessed at by the square foot."
      cost={{
        range: "Foundations vary with engineering and site conditions — the quote is written per project, with excavation, prep, concrete, and reinforcement each as their own line.",
        factors: [
          "Footing depth and width per the engineered drawing",
          "Concrete strength (PSI) and mix design",
          "Reinforcement schedule (rebar grade and spacing)",
          "Excavation volume and haul-off",
          "Sub-base conditions and compaction",
          "Formwork complexity",
          "Inspection sequencing",
          "Site access for equipment",
        ],
      }}
      hireChecklist={[
        "Ask how field conditions that conflict with the drawings get handled — in writing is the only good answer.",
        "Confirm excavation, prep, and pour are one accountable scope.",
        "Ask for the reinforcement schedule in the quote, not a lump sum.",
        "Check who schedules inspections and who meets the inspector.",
        "Get the cure and loading timeline in writing.",
        "Ask for references on similar foundation work.",
      ]}
      problems={[
        "Footings out of level or dimension from shortcuts in formwork.",
        "Settling and cracking from uncompacted or unsuitable sub-base.",
        "Failed inspections from reinforcement missing or misplaced.",
        "Water management issues from skipped moisture protection.",
        "Excavation left open and unfinished between trades.",
        "Schedule slips when the excavator and the pour crew are different companies.",
      ]}
      highIntentAnswers={[
        { q: "Who should pour my foundation?", a: "A contractor who builds to the engineered drawing, quotes excavation and prep as part of the scope, and welcomes the inspection with reinforcement in place." },
        { q: "How do I compare foundation bids?", a: "Compare the spec lines — depth, strength, reinforcement, sub-base, excavation, and haul-off. Bids that differ usually differ in one of those." },
        { q: "What if site conditions are worse than expected?", a: "It gets raised in writing with options and costs before work continues — a change you approved beats a surprise on the invoice." },
        { q: "How long does a foundation take?", a: "Excavation, formwork, pour, and cure each take their turn — the schedule is written into the quote with the inspection points marked." },
      ]}
      faqs={faqs}
      narrative={[
        "A foundation is the one part of a building nobody sees and everything depends on. The work is unglamorous by design: excavation to grade, sub-base compacted and proofed, formwork set to the drawing's dimensions, reinforcement tied to the schedule, and concrete placed at the specified strength.",
        "Doing excavation and foundations as one scope removes the classic gap — the excavator blames the grade, the pour crew blames the excavation, and the schedule pays for it. One accountable scope means one standard.",
        "Soil decides more of a foundation than any drawing: expansive clay, fill, rock, and sand each change depth, reinforcement, and moisture protection. What is actually under the site gets looked at during the site visit and priced honestly in the quote.",
      ]}
      benefits={[
        { title: "Built to the drawing", body: "Engineered specs followed exactly, with conflicts raised in writing." },
        { title: "One scope, start to finish", body: "Excavation, formwork, reinforcement, pour, and inspection under one contract." },
        { title: "Inspection-ready", body: "Reinforcement in place and paperwork ready when the inspector arrives." },
        { title: "Honest sub-base pricing", body: "Compaction and moisture protection quoted as their own lines." },
        { title: "Written schedule", body: "Dig, form, pour, cure — dates shared before work starts." },
      ]}
      materials={[
        { label: "Concrete PSI", value: "Per engineered spec" },
        { label: "Reinforcement", value: "Rebar grade and spacing per schedule" },
        { label: "Sub-base", value: "Compacted and proofed per conditions" },
        { label: "Moisture protection", value: "Vapor barrier where the spec calls for it" },
      ]}
      projectTypes={[
        "New residential foundations",
        "Commercial footings and stem walls",
        "Monolithic slabs",
        "Additions and accessory structures",
        "Site prep and grading",
        "Excavation with haul-off",
      ]}
    />
  ),
});
