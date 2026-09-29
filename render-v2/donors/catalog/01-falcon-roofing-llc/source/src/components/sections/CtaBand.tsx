import {CLIENT} from "@/lib/wss";
import { ArrowRight, Phone } from "lucide-react";
import { BUSINESS } from "@/lib/business";

/**
 * Quote band — full-width contractor stamp. No rounded card, no blurred orb.
 */
export const CtaBand = ({
  eyebrow = "Section · 06 / Quote request",
  title = CLIENT.content.ctaHeadline || "Contact us",
  body = CLIENT.content.ctaBody,
}: { eyebrow?: string; title?: string; body?: string }) => (
  <section className="relative overflow-hidden bg-primary text-primary-foreground">
    {/* Top safety tape rule */}
    <div className="h-2 tape-strip" aria-hidden="true" />
    <div className="absolute inset-0 blueprint-grid-dark opacity-30" aria-hidden="true" />
    <div className="container-tight relative grid gap-10 py-16 md:grid-cols-12 md:items-center md:py-20">
      <div className="md:col-span-8">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-signal">{eyebrow}</span>
        <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl md:text-[44px] md:leading-[1.05]">
          {title}
        </h2>
        <p className="mt-4 max-w-xl text-primary-foreground/80">{body}</p>
      </div>
      <div className="flex flex-col gap-3 md:col-span-4 md:items-end">
        <a
          href="/contact#quote"
          data-event="contact_quote_ctaband"
          className="btn-falcon w-full justify-center md:w-auto"
        >
          Contact us <ArrowRight className="h-4 w-4" />
        </a>
        <a
          href={`tel:${BUSINESS.phoneTel}`}
          data-event="contact_call_ctaband"
          className="btn-ghost-on-dark w-full justify-center md:w-auto"
        >
          <Phone className="h-4 w-4 text-signal" /> {BUSINESS.phoneDisplay}
        </a>
      </div>
    </div>
  </section>
);
