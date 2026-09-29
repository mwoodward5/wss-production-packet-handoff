import {client,gallery} from "@/wss/bridge";
import {ProofTicker} from "@/components/site/ProofTicker";
import { RouteLink } from "@/components/site/RouteLink";
import { Sparkles, ShieldCheck, Truck, Tag, CreditCard, MessageSquare } from "lucide-react";
import { business } from "@/data/business";

import { pagesBySlug } from "@/data/seoPages";

import { HeroHome } from "@/components/site/HeroHome";
import { FAQAccordion } from "@/components/site/FAQAccordion";
import { PhotoGallery } from "@/components/site/PhotoGallery";
import { ReviewQuotes } from "@/components/site/ReviewQuotes";
import { MattressMatchQuiz } from "@/components/widgets/MattressMatchQuiz";
import { InventoryPinger } from "@/components/widgets/InventoryPinger";

import { ServiceAreaLookup } from "@/components/widgets/ServiceAreaLookup";
import { ShowroomMapCard } from "@/components/widgets/ShowroomMapCard";
const homePage = pagesBySlug.get("home")!;
const mattressCats=client.services.filter(s=>/mattress|bed|adjustable base/i.test(s.name)).map(s=>({to:s.href,title:s.shortLabel,sub:s.description}));
const furnCats=client.services.filter(s=>!/mattress|bed|adjustable base/i.test(s.name)).map(s=>({to:s.href,title:s.shortLabel,sub:s.description}));
export function HomePage() {
  return (
    <>
      <HeroHome />

      {/* Pillars row */}
      {client.content.values.length>0 && <section className="border-b border-border bg-secondary/40">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 md:grid-cols-3">
          {client.content.values.map(v=>({Icon:ShieldCheck,t:v.title,d:v.body})).map(({ Icon, t, d }) => (
            <div key={t} className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="font-bold text-foreground">{t}</p>
                <p className="text-sm text-muted-foreground">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>}

      {client.trust.aggregate && <section className="border-b border-border bg-background"><div className="mx-auto flex max-w-6xl justify-center px-4 py-8"><ProofTicker/></div></section>}

      {/* Interactive widgets — the conversion engine */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-8 max-w-2xl">
          <p className="eyebrow">Skip the guesswork</p>
          <h2 className="mt-2 font-display text-3xl font-extrabold md:text-4xl">
            Ask the showroom.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Choose your preferences and prepare a question.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {mattressCats.length>0 && <MattressMatchQuiz />}
          <InventoryPinger />

          <ServiceAreaLookup />
        </div>
      </section>

      {/* Categories with real BoxDrop icons */}
      {mattressCats.length>0 && <section className="border-y border-border bg-secondary/40">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Mattresses</p>
              <h2 className="mt-2 font-display text-3xl font-extrabold md:text-4xl">Shop by size &amp; style</h2>
            </div>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {mattressCats.map((c) => (
              <RouteLink
                key={c.to}
                to={c.to}
                data-event="category_cta"
                className="group relative flex items-center gap-5 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-1 hover:border-brand/60 hover:shadow-xl"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-extrabold leading-tight text-foreground group-hover:text-brand">
                    {c.title}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">{c.sub}</p>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-brand/80">
                    In-stock today?
                  </p>
                </div>
                <span className="text-xl text-brand transition group-hover:translate-x-1">→</span>
              </RouteLink>
            ))}
          </div>
        </div>
      </section>}

      {/* Furniture */}
      {furnCats.length>0 && <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">

            <div>
              <p className="eyebrow">Furniture</p>
              <h2 className="mt-1 font-display text-3xl font-extrabold md:text-4xl">{furnCats.map(c=>c.title).join(", ")}</h2>
            </div>
          </div>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {furnCats.map((c) => (
            <RouteLink
              key={c.to}
              to={c.to}
              data-event="category_cta"
              className="rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-brand"
            >
              <p className="text-base font-extrabold text-foreground">{c.title}</p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">Ask what's in today</p>
            </RouteLink>
          ))}
        </div>
      </section>}

      {/* Original navy authority band: certified about copy, no invented warranties. */}
      <section className="border-y border-border bg-navy text-white"><div className="mx-auto max-w-6xl px-4 py-16"><div className="mb-8 max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.22em] text-brand-glow">{business.name}</p>{client.content.whyHeadline && <h2 className="mt-2 font-display text-3xl font-extrabold text-white md:text-4xl">{client.content.whyHeadline}</h2>}<p className="mt-4 text-white/80">{client.content.about}</p></div></div></section>

      {/* Showroom map + client gallery */}
      {(gallery.length>0 || business.mapDirectionsUrl) && <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          {gallery.length>0 && <div>
            <p className="eyebrow">Gallery</p>
            <h2 className="mt-2 font-display text-3xl font-extrabold md:text-4xl">{business.name}</h2>
            <p className="mt-3 max-w-xl text-muted-foreground">
              Tap any photo to view full size.
            </p>
            <div className="mt-6"><PhotoGallery /></div>
          </div>}
          {business.mapDirectionsUrl && <div>
            <p className="eyebrow">Visit the showroom</p>
            <h2 className="mt-2 font-display text-3xl font-extrabold md:text-4xl">{client.identity.city}, {client.identity.state}</h2>
            <p className="mt-3 text-muted-foreground">
              
            </p>
            <div className="mt-6"><ShowroomMapCard /></div>
          </div>}
        </div>
      </section>}

      {client.trust.areas.length>0 && <section className="bg-primary text-primary-foreground"><div className="mx-auto max-w-6xl px-4 py-16"><p className="text-xs font-bold uppercase tracking-[0.22em] text-brand-glow">Service area</p><h2 className="mt-2 font-display text-3xl font-extrabold md:text-4xl">Areas we serve</h2><div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{client.trust.areas.map(area=><RouteLink key={area} to="/locations" className="flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm"><span>{area}</span><span>→</span></RouteLink>)}</div></div></section>}

      <ReviewQuotes />

      <FAQAccordion faqs={homePage.faqs} />

      {/* Final CTA */}
      <section className="relative isolate overflow-hidden border-t border-border bg-navy text-white">
        <div aria-hidden className="bg-orb absolute -top-32 left-1/3 h-[420px] w-[420px] rounded-full opacity-60" />
        <div className="relative mx-auto max-w-4xl px-4 py-16 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-brand-glow" />
          <h2 className="mt-3 font-display text-4xl font-extrabold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] md:text-5xl">
            {client.content.ctaHeadline || "Contact us"}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/85">
            {client.content.ctaBody}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a
              href={`tel:${business.telephone}`}
              data-event="click_call"
              className="btn-glow inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-base font-extrabold"
            >
              Call {business.displayPhone}
            </a>
            <a
              href={business.smsHref}
              data-event="click_sms"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-6 py-3.5 text-base font-bold text-white hover:bg-white/10"
            >
              <MessageSquare className="h-5 w-5" /> Text the showroom
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
