import { createFileRoute } from "@tanstack/react-router";
import heroImg from "@/assets/projects/project-10.webp";
import { ServiceLayout } from "@/components/ServiceLayout";
import { jsonLd, servicePageLd } from "@/lib/schema";
import type { FaqItem } from "@/components/FAQ";

const faqs: FaqItem[] = [
  { q: "What does a commercial renovation include?", a: "Tenant improvements, retail buildouts, ADA upgrades, and full commercial construction — scoped and quoted in writing, with each trade's work itemized." },
  { q: "Can you work in an occupied space?", a: "Often, yes — phased scheduling, dust control, and after-hours windows are quoted as part of the scope when the business stays open during work." },
  { q: "How is a renovation quoted?", a: "By scope, line by line — demolition, framing, electrical and plumbing coordination, concrete, finishes, and cleanup each named in the written quote." },
  { q: "Do you handle ADA upgrades?", a: "Yes — ramps, restroom retrofits, and accessibility modifications laid out to pass inspection." },
  { q: "Who coordinates the trades?", a: "One point of contact coordinates the trades and the schedule, and the sequence is written into the quote before work starts." },
];

export const Route = createFileRoute("/commercial-renovation")({
  head: () => ({
    meta: [
      { title: "Commercial Renovation Contractor in {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      {
        name: "description",
        content:
          "Tenant improvements, retail buildouts, ADA upgrades and commercial construction in {{CITY}}, {{STATE}}. Written, itemized quotes.[[NEED:PHONE]] Call {{PHONE}}.[[/NEED]][[NEED:!PHONE]] Request an estimate online.[[/NEED]]",
      },
      { property: "og:title", content: "Commercial Renovation Contractor in {{CITY}}, {{STATE}}" },
      { property: "og:description", content: "Tenant improvements, retail buildouts, ADA upgrades and full commercial construction." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/commercial-renovation" }],
    scripts: [
      jsonLd(servicePageLd(
        "Commercial Renovation",
        "Tenant improvements, retail buildouts, ADA upgrades and commercial construction in {{CITY}}, {{STATE}}.",
        "/commercial-renovation",
        faqs,
        [
          { name: "Home", path: "/" },
          { name: "Commercial Renovation", path: "/commercial-renovation" },
        ],
      )),
    ],
  }),
  component: () => (
    <ServiceLayout
      slug="commercial-renovation"
      title="Commercial Renovation"
      heroHeadline="Renovations that respect the business inside."
      heroSub="Tenant improvements, retail buildouts, ADA upgrades and full commercial construction — scoped, sequenced, and quoted in writing."
      heroImage={heroImg}
      heroImageAlt="Commercial tenant improvement in progress"
      inShort="{{BUSINESS_NAME}} handles commercial renovation in {{CITY}}, {{STATE}} — buildouts, ADA upgrades, and full construction scopes, with the trades coordinated under one point of contact and one written schedule."
      whyBest={[
        "One point of contact for the trades — the schedule has a single owner.",
        "Phased work and dust control quoted for occupied spaces.",
        "ADA upgrades laid out to pass inspection the first time.",
        "Demolition, concrete, and finishes quotable as one connected scope.",
        "A written sequence before work starts, so surprises get found on paper.",
      ]}
      affordable="Fair renovation pricing follows the scope, not a percentage. Every trade's work — demo, framing, concrete, finishes, cleanup — appears as its own line, so the number can be audited against the work instead of trusted blindly."
      cost={{
        range: "Quoted per project — each trade and phase itemized rather than rolled into one square-foot number.",
        factors: [
          "Phasing and occupied-space requirements",
          "Demolition and disposal",
          "Structural and concrete work",
          "MEP coordination (mechanical, electrical, plumbing)",
          "ADA and code requirements",
          "Finishes and fixtures",
          "Permit and inspection sequencing",
          "After-hours or accelerated scheduling",
        ],
      }}
      hireChecklist={[
        "Ask for the schedule in writing, phase by phase.",
        "Confirm who owns trade coordination and who answers the phone.",
        "Check that permits and inspections are in the scope.",
        "Ask how occupied-space work is contained and dust-controlled.",
        "Get change-order terms in writing before work starts.",
        "Ask for references on similar buildouts.",
      ]}
      problems={[
        "Trades pointing at each other when the schedule slips.",
        "Surprise change orders that were never scoped on paper.",
        "ADA work that fails inspection and needs a second mobilization.",
        "Dust and noise shutting down a business that stayed open.",
        "Demolition that damaged structure meant to stay.",
        "Finishes delayed because phases were sequenced backwards.",
      ]}
      highIntentAnswers={[
        { q: "Who should run my buildout?", a: "A contractor who writes the sequence before starting, owns trade coordination, and quotes each phase as its own line." },
        { q: "Can we stay open during the renovation?", a: "Often — phasing, containment, and after-hours windows are quoted as part of the scope when the work allows it." },
        { q: "How do I keep a renovation on budget?", a: "Itemized scopes and written change-order terms — every addition priced and approved before it happens." },
        { q: "Do you handle the permits?", a: "Permit coordination and inspection scheduling are quoted as part of the scope when the jurisdiction requires them." },
      ]}
      faqs={faqs}
      narrative={[
        "A commercial renovation succeeds on paper before it succeeds on site. The sequence — demolition, structure, MEP rough-in, concrete, finishes, inspection — decides whether the space opens on time or becomes a chain of delays.",
        "Tenants, landlords, and owner-operators each need something slightly different from the same buildout: a business that keeps running, a space that leases faster, a layout that finally works. The scoping conversation happens first, and the quote reflects it line by line.",
        "Because the concrete side of the work is in-house — slabs, ramps, saw-cut, dock modifications — the renovation's structural spine stays inside one accountable scope.",
      ]}
      benefits={[
        { title: "One schedule owner", body: "Trades coordinated under a single point of contact." },
        { title: "Written phasing", body: "The sequence on paper before the first demo swing." },
        { title: "Occupied-space care", body: "Containment and dust control quoted for open businesses." },
        { title: "ADA that passes", body: "Accessibility work laid out to inspection standard." },
        { title: "Concrete in-house", body: "Slabs, ramps, and cuts inside the same contract." },
      ]}
      materials={[
        { label: "Framing", value: "Steel stud and wood framing per plan" },
        { label: "Concrete", value: "Slabs, ramps, and saw-cut work in-house" },
        { label: "Finishes", value: "Flooring, ceiling, and wall finishes per spec" },
        { label: "MEP", value: "Licensed subcontractors, coordinated under one schedule" },
      ]}
      projectTypes={[
        "Tenant improvements",
        "Retail buildouts",
        "Office reconfigurations",
        "ADA accessibility upgrades",
        "Restroom retrofits",
        "Warehouse and dock modifications",
      ]}
    />
  ),
});
