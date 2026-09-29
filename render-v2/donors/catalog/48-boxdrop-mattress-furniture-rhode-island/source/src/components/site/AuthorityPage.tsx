import {client} from "@/wss/bridge";
import type { SeoPage } from "@/data/seoPages";
import { business } from "@/data/business";
import { TrustBar } from "./TrustBar";
import { FAQAccordion } from "./FAQAccordion";
import { RelatedLinks } from "./RelatedLinks";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { ProofTicker } from "./ProofTicker";
import { OpenNowPill } from "./OpenNowPill";
import { Sparkles, MapPin, Phone, MessageSquare } from "lucide-react";
import {
  CallButton,
  TextButton,
  DirectionsButton,
  FinancingButton,
  InventoryButton,
  BookVisitButton,
} from "./CTAButtons";

export function AuthorityPage({ page }: { page: SeoPage }) {
  const isLocation = page.type === "location" || page.type === "near_me";
  const isCategory = page.type === "category";

  return (
    <article>
      <BreadcrumbBar label={page.h1} />

      {/* Hero band */}
      <section className="relative isolate overflow-hidden border-b border-border bg-navy text-white">
        <div aria-hidden className="surface-aurora absolute inset-0 opacity-40" />
        <div aria-hidden className="bg-orb absolute -top-24 -left-10 h-[360px] w-[360px] rounded-full opacity-60" />
        <div aria-hidden className="bg-orb absolute -bottom-32 -right-10 h-[420px] w-[420px] rounded-full opacity-40" style={{ animationDelay: "-2s" }} />

        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-[1.3fr_1fr] md:py-16">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip-glass">
                <Sparkles className="h-3.5 w-3.5 text-brand-glow" /> {page.eyebrow}
              </span>
              <OpenNowPill className="!bg-white/10 !text-white !border-white/20" />
              {isLocation && (
                <span className="chip-glass">
                  <MapPin className="h-3.5 w-3.5 text-brand-glow" /> {client.identity.city}, {client.identity.state}
                </span>
              )}
            </div>

            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight md:text-5xl lg:text-6xl">
              {page.h1}
            </h1>
            <p className="answer-block mt-5 max-w-2xl text-lg text-white/85">
              {page.description}
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href={`tel:${business.telephone}`}
                data-event="click_call"
                className="btn-glow btn-beam inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-base font-extrabold"
              >
                <Phone className="h-5 w-5" /> Call <span className="tabnum">{business.displayPhone}</span>
              </a>
              <a
                href={business.smsHref}
                data-event="click_sms"
                className="glass-dark inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-base font-bold text-white hover:bg-white/15"
              >
                <MessageSquare className="h-5 w-5" /> Text us
              </a>
              {business.mapDirectionsUrl && <a
                href={business.mapDirectionsUrl}
                target="_blank"
                rel="noreferrer"
                data-event="click_directions"
                className="glass-dark inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-base font-bold text-white hover:bg-white/15"
              >
                <MapPin className="h-5 w-5" />
              </a>}
            </div>

            <div className="mt-6">
              <ProofTicker />
            </div>
          </div>

          {/* Inline glass info card */}
          <aside className="glass-card relative overflow-hidden p-5 text-foreground md:self-start">
            <p className="eyebrow">Quick facts</p>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <span>
                  <span className="font-bold">{business.address.streetAddress}</span>
                  <br />
                  <span className="text-foreground/70">
                    {business.address.addressLocality}, {business.address.addressRegion} {business.address.postalCode}
                  </span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <a href={`tel:${business.telephone}`} className="tabnum font-bold hover:text-brand">
                  {business.displayPhone}
                </a>
              </li>
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href={`tel:${business.telephone}`}
                data-event="click_call"
                className="btn-glow btn-beam inline-flex items-center justify-center rounded-full px-3 py-2.5 text-xs font-extrabold"
              >
                Call
              </a>
              <a
                href={business.smsHref}
                data-event="click_sms"
                className="inline-flex items-center justify-center rounded-full border border-foreground/15 bg-white/60 px-3 py-2.5 text-xs font-bold hover:border-brand"
              >
                Text
              </a>
            </div>
          </aside>
        </div>
      </section>

      <TrustBar />
      {page.type==="contact" && client.identity.email && <div className="mx-auto max-w-6xl px-4 pt-8"><a href={`mailto:${client.identity.email}`}>{client.identity.email}</a></div>}

      {/* Body */}
      <section className="mx-auto max-w-6xl px-4 py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1fr_280px]">
          <div className="space-y-10">
            {page.sections.map((section, i) => (
              <div key={section.heading} className={i === 0 ? "" : "border-t border-border pt-10"}>
                <h2 className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">
                  {section.heading}
                </h2>
                <div className="mt-4 space-y-4 text-base leading-relaxed text-foreground/85">
                  {section.body.map((paragraph, idx) => (
                    <p key={idx} className={i === 0 && idx === 0 ? "answer-block" : ""}>
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            ))}


          </div>

          {/* Sticky desktop rail */}
          <aside className="hidden md:block">
            <div className="sticky top-24 space-y-4">
              <div className="glass-card p-5">
                <p className="eyebrow">Talk to the showroom</p>
                <p className="mt-2 text-sm text-foreground/75">
                  Call or text with your questions.
                </p>
                <div className="mt-4 space-y-2">
                  <CallButton />
                  <TextButton variant="outline" />
                  <DirectionsButton />
                  <BookVisitButton />
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* Big closer */}
      <section className="relative isolate overflow-hidden border-t border-border bg-navy text-white">
        <div aria-hidden className="bg-orb absolute -top-20 left-1/3 h-[360px] w-[360px] rounded-full opacity-60" />
        <div className="relative mx-auto max-w-4xl px-4 py-14 text-center">
          <p className="eyebrow text-brand-glow">Ready when you are</p>
          <h2 className="mt-2 font-display text-3xl font-extrabold md:text-4xl">
            Want to know what's available today?
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm opacity-90 md:text-base">
            Call or text <span className="tabnum font-bold">{business.displayPhone}</span>.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <CallButton />
            <InventoryButton variant="outline" />
            <FinancingButton variant="outline" />
          </div>
        </div>
      </section>

      <FAQAccordion faqs={page.faqs} />
      <RelatedLinks page={page} />
    </article>
  );
}
