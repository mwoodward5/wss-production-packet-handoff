import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { Phone } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ControlButton } from "@/components/motion/ControlButton";

/**
 * FAQs structured as voice-search / generative-answer blocks.
 * Each answer is a complete sentence aligned to a natural-language query
 * and tied to a visible service on the page.
 */
export const faqs = client.content.faqs;

export const FAQs = () => {
  if (!faqs.length) return null;
  return (
    <section id="faqs" className="relative bg-surface py-24 md:py-32">
      <div className="container-page">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <span className="eyebrow">
              <span className="h-px w-8 bg-primary" /> 06 — FAQ Answers
            </span>
            <h2 className="display-xl mt-4 text-4xl text-balance sm:text-5xl">
              Answers before your first flight.
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
              Contact us with your questions.
            </p>

            <div className="mt-8">
              <ControlButton
                href={client.identity.phoneTel}
                variant="link"
                size="sm"
                magnet={0}
                icon={<Phone className="h-3.5 w-3.5" />}
                ariaLabel={`Call ${client.identity.businessName} at ${client.identity.phoneDisplay}`}
              >
                {client.identity.phoneDisplay}
              </ControlButton>
            </div>

            <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border">
              <a
                href="#programs"
                className="bg-background p-4 transition-colors hover:bg-surface-elevated"
              >
                <div className="hud-tag">Jump to</div>
                <div className="mt-1 font-display text-sm text-foreground">Training programs</div>
              </a>
              <a
                href="#contact"
                className="bg-background p-4 transition-colors hover:bg-surface-elevated"
              >
                <div className="hud-tag">Jump to</div>
                <div className="mt-1 font-display text-sm text-foreground">Contact</div>
              </a>
              <a
                href="/service-areas"
                className="bg-background p-4 transition-colors hover:bg-surface-elevated"
              >
                <div className="hud-tag">Jump to</div>
                <div className="mt-1 font-display text-sm text-foreground">Service areas</div>
              </a>
              <a
                href="#contact"
                className="bg-background p-4 transition-colors hover:bg-surface-elevated"
              >
                <div className="hud-tag">Jump to</div>
                <div className="mt-1 font-display text-sm text-foreground">Contact options</div>
              </a>
            </div>
          </div>

          <div className="lg:col-span-7">
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((f, i) => (
                <AccordionItem
                  key={f.q}
                  value={`item-${i}`}
                  className="border-b border-border"
                >
                  <AccordionTrigger className="py-6 text-left font-display text-lg font-medium text-foreground hover:text-primary hover:no-underline">
                    <span className="flex items-baseline gap-4">
                      <span className="font-mono text-[11px] text-primary">
                        0{i + 1}
                      </span>
                      <span>{f.q}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pl-10 text-sm leading-relaxed text-muted-foreground">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </div>
    </section>
  );
};
