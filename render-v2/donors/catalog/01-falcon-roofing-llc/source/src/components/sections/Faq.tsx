import {BUSINESS} from "@/lib/business";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const Faq = ({ faqs, title = "Common questions" }: { faqs: { q: string; a: string }[]; title?: string }) => !faqs.length ? null : (
  <section className="bg-muted/40 py-20 md:py-24">
    <div className="container-tight grid gap-10 lg:grid-cols-[1fr_2fr]">
      <div>
        <span className="eyebrow">Section · 07 / FAQ</span>
        <h2 className="heading-section mt-3">{title}</h2>
        <p className="mt-4 text-muted-foreground">
          Don't see your question? Call <span className="font-semibold text-foreground">{BUSINESS.phoneDisplay}</span> — we're happy to talk it through.
        </p>
      </div>
      <Accordion type="single" collapsible className="border border-border bg-card" style={{ borderRadius: "2px" }}>
        {faqs.map((f, i) => (
          <AccordionItem key={i} value={`i${i}`} className="border-b border-border last:border-b-0">
            <AccordionTrigger className="px-6 py-5 text-left font-display text-base font-bold hover:no-underline">
              <span className="flex items-baseline gap-3">
                <span className="font-mono text-[10px] font-semibold tracking-[0.22em] text-accent">Q·{String(i + 1).padStart(2, "0")}</span>
                <span>{f.q}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pl-[60px] text-muted-foreground">{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  </section>
);
