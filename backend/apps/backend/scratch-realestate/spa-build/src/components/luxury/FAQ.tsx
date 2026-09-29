import { useReveal } from "@/hooks/useReveal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { fact } from "@/lib/facts";
import { WSSC } from "@/lib/content";

const CITY = fact("CITY");
const STATE = fact("STATE");
const PLACE = CITY + ", " + STATE;
const COUNTY = fact("COUNTY");
const PHONE = fact("PHONE");
const EMAIL = fact("EMAIL");

// Trade-generic questions, stated as what the work involves — never a claim
// about a specific agent's track record, network, or named neighborhoods.
// On a real build the engine's verified FAQ set replaces these via the bridge.
const defaultFaqs = [
  {
    q: "What area do you serve?",
    a: COUNTY
      ? "The practice is based around " + PLACE + " and serves buyers and sellers throughout the " + COUNTY + " area."
      : "The practice is based around " + PLACE + " and serves buyers and sellers in the surrounding area.",
  },
  {
    q: "How does the buyer process begin?",
    a: "It starts with a detailed conversation about your lifestyle, priorities, and vision. From there, the search covers active listings and new opportunities as they surface, and every candidate property is weighed for long-term value and lifestyle fit before you ever step inside.",
  },
  {
    q: "What does a listing strategy involve?",
    a: "Positioning begins long before the first showing: an analysis of comparable sales, an honest read of current market conditions, preparation and presentation of the property, and a marketing narrative aimed at the buyers most likely to value it.",
  },
  {
    q: "Do you work with relocation and out-of-town clients?",
    a: "Yes. Relocation advisory — neighborhood orientation, timing, and a clear view of the local market — is a core part of the practice, handled with the same attention as any local engagement.",
  },
  {
    q: "How are offers and negotiations handled?",
    a: "With preparation and discretion. Every offer is grounded in real comparable data, structured around your goals, and negotiated to protect your interests from the first conversation through closing.",
  },
  {
    q: "How do I get started?",
    a: PHONE
      ? "Call " + PHONE + " or use the private consultation form on this page — every inquiry is handled with complete discretion."
      : EMAIL
        ? "Email " + EMAIL + " or use the private consultation form on this page — every inquiry is handled with complete discretion."
        : "Use the private consultation form on this page — every inquiry is handled with complete discretion.",
  },
];

const faqs =
  Array.isArray(WSSC.faqs) && WSSC.faqs.length
    ? WSSC.faqs.filter((f) => f && f.q && f.a)
    : defaultFaqs;

export default function FAQ() {
  const { ref, revealed } = useReveal();

  return (
    <section id="faq" className="scroll-mt-24 bg-ivory py-40 md:py-56" ref={ref}>
      <div className="luxury-section max-w-3xl mx-auto">
        <div className={`text-center mb-20 reveal-up ${revealed ? "revealed" : ""}`}>
          <p className="font-body text-[11px] tracking-[0.4em] uppercase text-gold mb-6">
            Common Questions
          </p>
          <h2 className="font-display font-medium text-charcoal leading-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Clarity Before <em className="italic">Commitment</em>
          </h2>
        </div>

        <div className={`reveal-up ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.2s" }}>
          <Accordion type="single" collapsible className="space-y-0">
            {faqs.map((faq, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="border-0 border-b border-border/40 relative data-[state=open]:border-b-gold/20"
              >
                <AccordionTrigger className="font-display text-base md:text-lg text-charcoal text-left hover:text-gold-dark transition-colors hover:no-underline py-7 pl-0 [&[data-state=open]]:text-gold-dark">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="font-body text-sm text-muted-foreground leading-[1.9] pb-8 pl-0">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
