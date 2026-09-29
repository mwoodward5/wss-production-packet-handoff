import { SITE } from "@/lib/site";
import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import { createFileRoute } from "@tanstack/react-router";
import { PageHero, ClosingBand } from "./services";
const detailRailing = CLIENT.hero.poster;
import { faqJsonLd } from "@/lib/schema";
import { pageHead } from "@/lib/seo";

const FAQS = CLIENT.content.faqs;

export const Route = createFileRoute("/faq")({
  head: () =>
    pageHead({
      title: "FAQ · " + SITE.name,
      description: SITE.shortDescription,
      path: "/faq",
      extraScripts: FAQS.length ? [
        { type: "application/ld+json", children: JSON.stringify(faqJsonLd(FAQS)) },
      ] : [],
    }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title={<>Straight answers<br />about your project.</>}
        intro="Questions and answers"
        image={detailRailing}
      />
      <section className="section bg-background">
        <div className="mx-auto max-w-3xl px-5 md:px-8">
          <ul className="divide-y divide-border">
            {FAQS.map((f) => (
              <li key={f.q} className="py-7">
                <h2 className="font-display text-2xl text-ink leading-snug">{f.q}</h2>
                <p className="mt-3 text-ink/75 leading-relaxed">{f.a}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <ClosingBand />
    </>
  );
}
