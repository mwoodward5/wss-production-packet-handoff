import { createFileRoute } from "@tanstack/react-router";
import heroImg from "@/assets/projects/project-06.webp";
import { ServiceLayout } from "@/components/ServiceLayout";
import { jsonLd, servicePageLd } from "@/lib/schema";
import type { FaqItem } from "@/components/FAQ";

const faqs: FaqItem[] = [
  { q: "What does a home renovation include?", a: "Bathroom remodels, concrete decks and patios, repairs, and full residential renovation scopes — each trade's work itemized in the written quote." },
  { q: "How long does a bathroom remodel take?", a: "Depends on scope — a remodel with plumbing and tile changes runs longer than a cosmetic refresh. The written quote states the schedule with phases." },
  { q: "Can you match existing finishes?", a: "Color, stamp, and finish matching for concrete additions and repairs is assessed on the site visit, with an honest written answer about how close the match will be." },
  { q: "How is a renovation quoted?", a: "Line by line — demolition, plumbing and electrical coordination, concrete, finishes, and cleanup each named, so nothing rides on a lump sum." },
  { q: "Do you do repairs, not just remodels?", a: "Yes — concrete repairs, deck work, and smaller residential scopes get the same written-quote treatment as full remodels." },
];

export const Route = createFileRoute("/home-renovation")({
  head: () => ({
    meta: [
      { title: "Home Renovation & Repairs in {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      {
        name: "description",
        content:
          "Bathroom remodels, concrete decks, home repairs and full residential renovations in {{CITY}}, {{STATE}}. Written, itemized quotes.[[NEED:PHONE]] Call {{PHONE}}.[[/NEED]][[NEED:!PHONE]] Request an estimate online.[[/NEED]]",
      },
      { property: "og:title", content: "Home Renovation & Repairs in {{CITY}}, {{STATE}}" },
      { property: "og:description", content: "Bathroom remodeling, concrete decks, home repairs and full residential renovations." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/home-renovation" }],
    scripts: [
      jsonLd(servicePageLd(
        "Home Renovation & Repairs",
        "Bathroom remodels, concrete decks, home repairs and full residential renovations in {{CITY}}, {{STATE}}.",
        "/home-renovation",
        faqs,
        [
          { name: "Home", path: "/" },
          { name: "Home Renovation", path: "/home-renovation" },
        ],
      )),
    ],
  }),
  component: () => (
    <ServiceLayout
      slug="home-renovation"
      title="Home Renovation & Repairs"
      heroHeadline="Renovations finished like they're our own."
      heroSub="Bathroom remodels, concrete decks, home repairs and full residential renovations — scoped, scheduled, and quoted in writing."
      heroImage={heroImg}
      heroImageAlt="Completed bathroom remodel"
      inShort="{{BUSINESS_NAME}} handles home renovation and repairs in {{CITY}}, {{STATE}} — from bathroom remodels to concrete decks, with every trade's work itemized and a written schedule before the first hammer swings."
      whyBest={[
        "A written scope and schedule before work starts — no mystery phases.",
        "Concrete work (decks, pads, flatwork) in-house alongside the remodel trades.",
        "Finish matching assessed honestly on the site visit.",
        "One point of contact from demo to the final walkthrough.",
        "Repairs get the same written-quote treatment as full remodels.",
      ]}
      affordable="Fair renovation pricing is a scope you can read: demolition, plumbing and electrical coordination, concrete, finishes, and cleanup each as their own line — so the number matches the work, and changes get priced in writing before they happen."
      cost={{
        range: "Quoted per project — phases and trades itemized rather than one lump number.",
        factors: [
          "Demolition and disposal",
          "Plumbing and electrical changes",
          "Concrete and structural work",
          "Tile, fixtures, and finishes",
          "Subfloor and prep conditions",
          "Permit requirements",
          "Phasing if the home stays occupied",
        ],
      }}
      hireChecklist={[
        "Ask for the schedule phase by phase, in writing.",
        "Confirm who coordinates plumbing and electrical.",
        "Get fixture and finish allowances itemized.",
        "Check change-order terms before signing.",
        "Ask how the work area is contained and cleaned daily.",
        "Ask for references on similar remodels.",
      ]}
      problems={[
        "Remodels that stall between trades with no one owning the schedule.",
        "Surprise costs from lump-sum quotes with no line items.",
        "Tile and finish failures from skipped prep.",
        "Concrete work done by a trade that never pours concrete.",
        "Change orders improvised by text message.",
        "Repairs that become remodels without a written price.",
      ]}
      highIntentAnswers={[
        { q: "Who should run my remodel?", a: "A contractor who writes the scope and schedule before starting, itemizes each trade, and answers the phone after the walkthrough." },
        { q: "How do I keep a remodel on budget?", a: "Itemized lines and written change-order terms — additions priced and approved before they happen, never discovered on the invoice." },
        { q: "Can you do just repairs?", a: "Yes — concrete repairs, deck work, and small scopes get the same written quote as full remodels." },
        { q: "How disruptive will the work be?", a: "Containment and cleanup are part of the quoted scope; phasing options get written down when the home stays occupied." },
      ]}
      faqs={faqs}
      narrative={[
        "A home renovation lives or dies on the boring parts: the schedule, the sequencing, the written scope. The tile and fixtures are the fun decisions — the quote and the phases are what get the project finished.",
        "Because the concrete side is in-house — decks, pads, flatwork, and the structural bits other remodelers subcontract — the parts of a renovation that carry weight stay inside one accountable scope.",
        "Repairs get the same treatment as remodels: looked at, written down, and priced honestly, so a small scope never becomes an open-ended one.",
      ]}
      benefits={[
        { title: "Written scope first", body: "Phases, trades, and schedule on paper before work starts." },
        { title: "Concrete in-house", body: "Decks, pads, and structural work without a second contract." },
        { title: "One point of contact", body: "Demo through walkthrough, the same name answers." },
        { title: "Honest finish matching", body: "What a match can and can't achieve, written before you commit." },
        { title: "Repairs welcome", body: "Small scopes quoted with the same care as big ones." },
      ]}
      materials={[
        { label: "Concrete", value: "Decks, pads, and flatwork per spec" },
        { label: "Tile", value: "Ceramic, porcelain, and natural stone per selection" },
        { label: "Fixtures", value: "Itemized allowances in the quote" },
        { label: "MEP", value: "Licensed subcontractors, coordinated under one schedule" },
      ]}
      projectTypes={[
        "Bathroom remodels",
        "Concrete decks and patios",
        "Garage and basement conversions",
        "Kitchen refresh scopes",
        "Home repairs and small scopes",
        "Accessibility modifications",
      ]}
    />
  ),
});
