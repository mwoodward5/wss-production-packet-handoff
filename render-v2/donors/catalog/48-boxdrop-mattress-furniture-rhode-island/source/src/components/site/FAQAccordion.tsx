import type { FaqItem } from "@/data/seoPages";

export function FAQAccordion({ faqs }: { faqs: readonly FaqItem[] }) {
  if (!faqs.length) return null;
  return (
    <section className="faq-section mx-auto max-w-3xl px-4 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({"@context":"https://schema.org","@type":"FAQPage",mainEntity:faqs.map(f=>({"@type":"Question",name:f.question,acceptedAnswer:{"@type":"Answer",text:f.answer}}))}).replace(/</g,"\\u003c")}}/>
      <p className="text-xs font-semibold uppercase tracking-wider text-brand">
        Questions shoppers ask
      </p>
      <h2 className="mt-2 text-3xl font-bold">Frequently asked questions</h2>
      <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card">
        {faqs.map((faq) => (
          <details key={faq.question} className="group p-5 open:bg-secondary/30">
            <summary className="cursor-pointer list-none text-base font-semibold text-foreground marker:hidden">
              <span className="flex items-start justify-between gap-4">
                <span>{faq.question}</span>
                <span className="text-brand transition group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {faq.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
