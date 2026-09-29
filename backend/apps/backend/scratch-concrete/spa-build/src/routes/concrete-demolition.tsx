import { createFileRoute } from "@tanstack/react-router";
import heroImg from "@/assets/service-demolition.webp";
import { ServiceLayout } from "@/components/ServiceLayout";
import { jsonLd, servicePageLd } from "@/lib/schema";
import type { FaqItem } from "@/components/FAQ";

const faqs: FaqItem[] = [
  { q: "How much does concrete demolition cost?", a: "Demo is quoted by the scope — slab thickness, access, whether the material is reinforced, and haul-off volume each appear as their own line in the written quote." },
  { q: "Is haul-off included?", a: "Yes — break-out and haul-off are quoted together, so the site is left clean and there is no surprise line for disposal." },
  { q: "Can you demo part of a slab and leave the rest?", a: "Yes. Saw-cut boundaries let a section come out cleanly while the surrounding concrete stays in service." },
  { q: "What about dust and debris?", a: "Dust control and site cleanup are part of the quoted scope, not an afterthought." },
  { q: "Do you demo footings and walls too?", a: "Yes — slabs, footings, walls, curbs, and pads, with the equipment matched to access and thickness." },
  { q: "Can you demo and re-pour in one mobilization?", a: "Often, yes — demolition, prep, and the new pour as one scope removes a scheduling gap between trades and is quoted that way when the work allows." },
];

export const Route = createFileRoute("/concrete-demolition")({
  head: () => ({
    meta: [
      { title: "Concrete Demolition & Removal in {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      {
        name: "description",
        content:
          "Concrete demolition with haul-off in {{CITY}}, {{STATE}} — slabs, footings, walls, curbs. Written, itemized quotes.[[NEED:PHONE]] Call {{PHONE}}.[[/NEED]][[NEED:!PHONE]] Request an estimate online.[[/NEED]]",
      },
      { property: "og:title", content: "Concrete Demolition & Removal in {{CITY}}, {{STATE}}" },
      { property: "og:description", content: "Saw-cut, break-out and haul-off for slabs, footings and walls in {{CITY}}, {{STATE}}." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/concrete-demolition" }],
    scripts: [
      jsonLd(servicePageLd(
        "Concrete Demolition",
        "Saw-cut, break-out and haul-off for slabs, footings and walls in {{CITY}}, {{STATE}}.",
        "/concrete-demolition",
        faqs,
        [
          { name: "Home", path: "/" },
          { name: "Concrete Demolition", path: "/concrete-demolition" },
        ],
      )),
    ],
  }),
  component: () => (
    <ServiceLayout
      slug="concrete-demolition"
      title="Concrete Demolition"
      heroHeadline="Demolition that leaves a clean slate."
      heroSub="Saw-cut, break-out, and haul-off for slabs, footings, and walls — dust controlled, site cleaned, boundaries cut clean."
      heroImage={heroImg}
      heroImageAlt="Concrete slab being saw-cut for demolition"
      inShort="{{BUSINESS_NAME}} handles concrete demolition in {{CITY}}, {{STATE}} — slabs, footings, walls, and curbs broken out and hauled off, with the re-pour quotable as one scope when the project calls for it."
      whyBest={[
        "Clean boundaries — saw-cut edges keep the concrete that stays, serviceable.",
        "Haul-off quoted with the demo, so the number you sign is the number you pay.",
        "Dust control and cleanup as part of the scope, not an extra.",
        "Equipment matched to access — alley slabs to open commercial pads.",
        "Demo and re-pour as one mobilization when the work allows.",
      ]}
      affordable="Fair demolition pricing follows the material and the access — thickness, reinforcement, and how the debris leaves the site. The quote itemizes those, so a cheaper number elsewhere can be checked for what it left behind."
      cost={{
        range: "Quoted per project — thickness, reinforcement, access, and haul-off volume each named as their own line.",
        factors: [
          "Slab thickness and reinforcement",
          "Access for equipment and trucks",
          "Whether utilities run through the slab",
          "Saw-cut boundaries for partial removal",
          "Haul-off volume and disposal",
          "Dust control requirements",
          "Site conditions and prep for what comes next",
        ],
      }}
      hireChecklist={[
        "Confirm haul-off and disposal are included in the written price.",
        "Ask how utilities in the slab are located and handled.",
        "Check that partial removals get saw-cut boundaries.",
        "Ask about dust control and what the site looks like at the end of the day.",
        "Confirm whether demo and re-pour can be one scope.",
        "Ask for the schedule — demo windows matter when the site is in use.",
      ]}
      problems={[
        "Slabs broken out with no boundary cuts, damaging concrete that stays.",
        "Debris left on site because haul-off was never in the quote.",
        "Utility strikes from demo that skipped locating.",
        "Dust complaints from neighbors and tenants.",
        "Settled fill where slab removal left the sub-base a mess.",
        "Scheduling gaps between the demo crew and the pour crew.",
      ]}
      highIntentAnswers={[
        { q: "Who should handle concrete demolition?", a: "A crew that quotes break-out AND haul-off together, cuts clean boundaries, and can quote the re-pour as one scope." },
        { q: "How do I compare demolition bids?", a: "Check for haul-off, disposal, dust control, and boundary cutting — the cheapest bid usually leaves one of those out." },
        { q: "Can just part of a slab come out?", a: "Yes — saw-cut boundaries let a section be removed while the surrounding slab stays in service." },
        { q: "What does the site look like when you leave?", a: "Clean: material hauled, debris swept, and the area ready for what comes next — that standard is written into the quote." },
      ]}
      faqs={faqs}
      narrative={[
        "Demolition is the start of somebody else's project — a re-pour, a new build, a repair. The measure of good demo work is what it leaves behind: a clean boundary, a stable sub-base, no debris, and a site ready for the next trade.",
        "Saw-cutting is the difference between removal and damage. A cut line lets a slab section come out while the concrete on the other side keeps its edge — no spalled, fractured mess to patch later.",
        "Because the same crews quote the re-pour, demolition here is priced with the whole project in mind: demo, prep, and new concrete as one mobilization when the scope allows, instead of two contracts pointing at each other.",
      ]}
      benefits={[
        { title: "Saw-cut boundaries", body: "The concrete that stays keeps a clean, serviceable edge." },
        { title: "Haul-off included", body: "Break-out and disposal quoted as one number." },
        { title: "Dust control", body: "Water and containment matched to the site." },
        { title: "Utility-aware", body: "Locating before breaking — no surprises under the slab." },
        { title: "One-scope re-pour", body: "Demo and new concrete as one mobilization when possible." },
      ]}
      materials={[
        { label: "Cutting", value: "Slab saw, wall saw, and hand-held cutting per depth" },
        { label: "Break-out", value: "Skid-steer rammer to excavator-mounted breaker per access" },
        { label: "Haul-off", value: "Trucked and disposed; recycling where available" },
        { label: "Surface prep", value: "Sub-base left graded and ready for the next scope" },
      ]}
      projectTypes={[
        "Driveway and patio removal",
        "Interior slab removal (tenant improvement)",
        "Footings and foundation removal",
        "Curbs, gutters, and sidewalk removal",
        "Equipment pad and dock removal",
        "Partial slab removal with boundary cuts",
      ]}
    />
  ),
});
