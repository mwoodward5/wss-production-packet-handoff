import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { JsonLd } from "@/components/JsonLd";

export type FAQItem = { q: string; a: string };

export function FAQ({
  items,
  heading = "Frequently Asked Questions",
  includeSchema = true,
  variant = "light",
}: {
  items: FAQItem[];
  heading?: string;
  includeSchema?: boolean;
  variant?: "light" | "dark";
}) {
  if (!items.length) return null;
  const isDark = variant === "dark";
  return (
    <section
      className={
        isDark
          ? "relative overflow-hidden bg-faq-dark py-16 text-surface-foreground sm:py-20"
          : "py-16 sm:py-20"
      }
      aria-labelledby="faq-heading"
    >
      {isDark && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-primary-glow/10 blur-3xl"
        />
      )}
      <div className="relative mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h2
          id="faq-heading"
          className={`text-3xl font-bold sm:text-4xl ${isDark ? "text-glow" : ""}`}
        >
          {heading}
        </h2>
        <p
          className={`mt-3 ${isDark ? "text-surface-foreground/70" : "text-muted-foreground"}`}
        >
          Answers to your questions.
        </p>
        <Accordion
          type="single"
          collapsible
          className={`mt-8 ${isDark ? "[&_[data-slot=accordion-item]]:border-white/10" : ""}`}
        >
          {items.map((item, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger
                className={`text-left text-base font-semibold ${
                  isDark ? "text-surface-foreground hover:text-primary-glow" : ""
                }`}
              >
                {item.q}
              </AccordionTrigger>
              <AccordionContent
                className={isDark ? "text-surface-foreground/75" : "text-muted-foreground"}
              >
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
      {includeSchema && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: items.map((it) => ({
              "@type": "Question",
              name: it.q,
              acceptedAnswer: { "@type": "Answer", text: it.a },
            })),
          }}
        />
      )}
    </section>
  );
}
