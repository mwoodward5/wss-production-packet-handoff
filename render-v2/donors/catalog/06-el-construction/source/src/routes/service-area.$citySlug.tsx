import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, MapPin, Phone, ChevronRight, CheckCircle2, Building2, Layers, Square, Hammer } from "lucide-react";
import { CallButton } from "@/components/CallButton";
import { SectionHeading } from "@/components/SectionHeading";
import { InShortBlock } from "@/components/InShortBlock";
import { FAQ } from "@/components/FAQ";
import { ContactForm } from "@/components/ContactForm";
import { TrustChips } from "@/components/TrustChips";
import { site, services } from "@/lib/site";
import { citiesData, getCityBySlug } from "@/lib/cities-data";
import { breadcrumbSchema, faqSchema, jsonLd, cityLocalBusinessSchema, webPageSchema } from "@/lib/schema";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Building2, Layers, Square, Hammer,
};

export const Route=createFileRoute('/service-area/$citySlug')({loader:({params})=>{if(!getCityBySlug(params.citySlug)) throw notFound();},component:CityPage});
export function CityPage() {
  const { citySlug } = Route.useParams();
  const c = getCityBySlug(citySlug)!;
  const siblings = citiesData.filter((x) => x.slug !== c.slug).slice(0, 6);

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div className="absolute inset-0 opacity-40">
          <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/85 to-primary/40" />
          <div className="absolute inset-0 bg-mesh-animated opacity-50" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-28">
          <nav className="mb-6 flex items-center gap-2 text-sm text-primary-foreground/70" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-primary-foreground">Home</Link>
            <ChevronRight className="h-3 w-3" />
            <Link to="/service-area" className="hover:text-primary-foreground">Service Area</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-primary-foreground">{c.name}</span>
          </nav>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur">
            <MapPin className="h-3 w-3 text-gold" />
            {c.distanceFromHQ}
          </div>
          <h1 className="mt-5 max-w-3xl text-balance font-display text-4xl font-semibold leading-tight md:text-5xl lg:text-6xl">
            {site.name} in <span className="text-gold">{c.name}</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-primary-foreground/85">{c.intro}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <CallButton variant="gold" location={`hero-city-${c.slug}`} label={`Call ${site.phone}`} className="animate-glow" />
            <Link to="/contact" className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/15">
              Get a {c.name} Quote <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-7"><TrustChips tone="dark" /></div>
        </div>
      </section>

      {/* IN SHORT + BODY */}
      <section className="mx-auto max-w-4xl px-4 py-14 lg:px-6">
        <InShortBlock>{c.name}</InShortBlock>

        {/* SERVICES OFFERED IN THIS CITY */}
        <h2 className="mt-14 font-display text-3xl font-semibold md:text-4xl">
          Services
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {services.map((s) => {
            const Icon = iconMap[s.icon] || Building2;
            return (
              <Link
                key={s.slug}
                to={`/${s.slug}` as string}
                className="group flex gap-4 rounded-2xl border border-border bg-card p-5 shadow-card transition-all hover:-translate-y-1 hover:border-gold hover:shadow-elegant"
              >
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-gold text-gold-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.short}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                    Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

      </section>

      {/* FAQ */}
      {c.faqs.length > 0 && <section className="bg-secondary py-16">
        <div className="mx-auto max-w-4xl px-4 lg:px-6">
          <SectionHeading eyebrow={`${c.name} FAQ`} title={`Questions about ${c.name}`} />
          <div className="mt-8"><FAQ items={c.faqs} /></div>
        </div>
      </section>

      }
      {/* SIBLING CITIES */}
      <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
        <SectionHeading eyebrow="Service area" title="Other areas we serve" />
        <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {siblings.map((s) => (
            <Link
              key={s.slug}
              to="/service-area/$citySlug"
              params={{ citySlug: s.slug }}
              className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-gold hover:shadow-elegant"
            >
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 text-gold" />
                <div>
                  <div className="font-display text-base font-semibold">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.distanceFromHQ}</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link to="/service-area" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            See all service areas <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* CONTACT */}
      <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow={`${c.name} Quote`} title={`Ready to start your ${c.name} concrete project?`} subtitle="Call to discuss your project." />
            <div className="mt-6 flex flex-wrap gap-3">
              <CallButton variant="gold" location={`final-city-${c.slug}`} label={`Call ${site.phone}`} />
            </div>
          </div>
          <ContactForm compact />
        </div>
      </section>
    </>
  );
}
