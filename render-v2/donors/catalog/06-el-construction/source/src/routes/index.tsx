import {RichCopy} from "@/components/RichCopy";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, Layers, Square, Hammer, Paintbrush, Home, LayoutGrid, Star, Phone, ShieldCheck, Clock, MapPin, ChevronDown } from "lucide-react";
import { CallButton } from "@/components/CallButton";
import { TrustChips } from "@/components/TrustChips";
import { SectionHeading } from "@/components/SectionHeading";
import { ProcessSteps } from "@/components/ProcessSteps";
import { CityChips } from "@/components/CityChips";
import { FAQ, type FaqItem } from "@/components/FAQ";
import { ContactForm } from "@/components/ContactForm";
import { InShortBlock } from "@/components/InShortBlock";
import { Marquee } from "@/components/Marquee";
import { StatCounter } from "@/components/StatCounter";
import { Testimonials } from "@/components/Testimonials";
import { TiltCard } from "@/components/TiltCard";
import { ProjectGallery } from "@/components/ProjectGallery";
import { HeroVideo } from "@/components/HeroVideo";
import { site, services, client, stats, cities, richCopy, serviceImages } from "@/lib/site";
import { faqSchema, jsonLd, webPageSchema } from "@/lib/schema";
import { trackReviewClick } from "@/lib/track";

const faqs=client.content.faqs;
export const Route=createFileRoute('/')({head:()=>({meta:[{title:site.name},{name:'description',content:client.hero.support}],scripts:faqs.length ? [jsonLd(faqSchema(faqs))] : []}),component:HomePage});

const serviceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  Building2, Layers, Square, Hammer, Paintbrush, Home, LayoutGrid,
};

export function HomePage() {
  return (
    <>
      {/* HERO */}
      <HeroVideo />

      {/* MARQUEE TRUST STRIP */}
      {client.trust.badges.length > 0 && <Marquee items={client.trust.badges.map(b=>b.label)} />}
      {stats.length > 0 && <section className="mx-auto max-w-7xl px-4 py-14 lg:px-6"><div className="grid grid-cols-2 gap-8 md:grid-cols-4">{stats.map(s=><StatCounter key={s.label} value={s.value} label={s.label}/>)}</div></section>}
      {client.trust.badges.length > 0 && <section className="border-b border-border bg-card"><div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-border md:grid-cols-4">{client.trust.badges.slice(0,4).map(s=><div key={s.label} className="flex items-center gap-3 bg-card px-5 py-6"><div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-gold"><Star className="h-5 w-5"/></div><div><div className="font-display text-base font-semibold">{s.label}</div><div className="text-xs text-muted-foreground">{s.sublabel}</div></div></div>)}</div></section>}

      {/* SERVICES GRID */}
      <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
        <SectionHeading eyebrow="What we do" title="Our services" subtitle={client.content.serviceIntro} />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {services.map((s) => {
            const Icon = serviceIcons[s.icon];
            return (
              <TiltCard key={s.slug}>
                <Link
                  to={`/${s.slug}` as string}
                  className="group relative block overflow-hidden rounded-3xl border border-border bg-card shadow-card transition-all hover:-translate-y-1 hover:shadow-elegant"
                >
                  <div className="aspect-[4/3] overflow-hidden">
                    {serviceImages[s.slug] && <img src={serviceImages[s.slug]} alt={s.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />}
                  </div>
                  <div className="p-5">
                    <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground">
                      {Icon ? <Icon className="h-4 w-4" /> : null}
                    </div>
                    <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{s.short}</p>
                    <div className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                      Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              </TiltCard>
            );
          })}
        </div>
      </section>

      {/* WHY US — In Short + answers */}
      <section className="bg-secondary py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="About us" title={client.content.whyHeadline || site.name} />
              <InShortBlock>{client.content.about}</InShortBlock>
              <ul className="mt-6 space-y-4">
                {client.content.values.map(v=>[v.title,v.body]).map(([t, b]) => (
                  <li key={t} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                    <div className="font-display text-lg font-semibold">{t}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{b}</p>
                  </li>
                ))}
              </ul>
            </div>

            {faqs.length > 0 && <div className="space-y-4">
              <h3 className="font-display text-2xl font-semibold">Quick answers</h3>
              {faqs.slice(0,4).map((it) => (
                <div key={it.q} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                  <div className="font-display text-base font-semibold">{it.q}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{it.a}</p>
                </div>
              ))}
            </div>}
          </div>
        </div>
      </section>

      {/* SERVICE AREA */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 lg:grid-cols-2 lg:px-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Service Area
            </div>
            <h2 className="mt-4 font-display text-4xl font-semibold leading-tight md:text-5xl">
              {site.city}, <span className="text-gold">{site.state}</span>
            </h2>
            <p className="mt-4 max-w-xl text-primary-foreground/80">
              {cities.map(c=>c.name).join(" · ")}
            </p>
            <div className="mt-6"><CityChips /></div>
            <div className="mt-8">
              <Link to="/service-area" className="inline-flex items-center gap-2 rounded-full bg-gradient-gold px-5 py-2.5 text-sm font-semibold text-gold-foreground shadow-glow">
                See full service area <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          {site.mapLink && <div className="overflow-hidden rounded-3xl border border-white/15 shadow-elegant p-8"><a href={site.mapLink} className="underline">Map and directions</a></div>}
        </div>
      </section>

      {/* PROJECT GALLERY — real photos from EL Construction */}
      <ProjectGallery />

      {/* TESTIMONIALS — carousel + review CTA, no fake reviews */}
      <Testimonials />

      {richCopy('home') && <section className="mx-auto max-w-4xl px-4 py-20 lg:px-6"><RichCopy text={richCopy('home')}/></section>}

      {/* FAQ */}
      {faqs.length > 0 && <section className="bg-secondary py-20">
        <div className="mx-auto max-w-4xl px-4 lg:px-6">
          <SectionHeading eyebrow="FAQ" title="Common questions about working with us" align="center" />
          <div className="mt-10"><FAQ items={faqs} /></div>
        </div>
      </section>

      }
      {/* CONTACT CTA */}
      <section id="quote" className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
        <div className="grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <SectionHeading eyebrow="Contact" title={client.content.ctaHeadline || "Tell us about your project."} subtitle={client.content.ctaBody} />
            <div className="mt-6 space-y-3 text-sm">
              <a href={`tel:${site.phoneTel}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
                <Phone className="h-5 w-5 text-gold" />
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Call us</div>
                  <div className="font-display text-lg font-semibold">{site.phone}</div>
                </div>
              </a>
            </div>
          </div>
          <div className="lg:col-span-3">
            <ContactForm compact />
          </div>
        </div>
      </section>
    </>
  );
}
