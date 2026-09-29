import { Rates } from '@/components/site/Rates';
import { ReviewQuotes } from '@/components/site/ReviewQuotes';
import { WSS, pageCopy } from '@/wss/bridge';
import { Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader, CallCTA, FAQ } from "@/components/site/Sections";
import { AnimatedHero } from "@/components/site/AnimatedHero";
import { EstimatorWidget } from "@/components/site/EstimatorWidget";
import { ServiceAreaMap } from "@/components/site/ServiceAreaMap";
import {
  LocalBusinessSchema, OrganizationSchema, WebSiteSchema,
  BreadcrumbSchema, SpeakableSchema, FAQSchema,
} from "@/components/site/Schema";
import { ArrowRight, ShieldCheck, Wrench, Settings, Snowflake, ClipboardCheck, BookOpen, Sun, Wind, Flame, Droplets, Refrigerator, Zap } from "lucide-react";
import { CLIENT, SERVICES, SPECIALTY_SERVICES, TRUST, absoluteUrl } from "@/config";
import { MEDIA } from "@/config/media";

const SPECIALTY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Wind, Flame, Droplets, Refrigerator, Zap, Wrench,
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Wrench, Settings, Snowflake, ClipboardCheck, BookOpen, Sun, ShieldCheck,
};

const FAQS = WSS.content.faqs;

export function HomePage() {
  return (
    <SiteLayout>
      <LocalBusinessSchema />
      <OrganizationSchema />
      <WebSiteSchema />
      <BreadcrumbSchema items={[{ name: "Home", url: absoluteUrl("/") }]} />
      <SpeakableSchema url={absoluteUrl("/")} />
      <FAQSchema items={FAQS} />

      <AnimatedHero
        eyebrow={WSS.hero.eyebrow}
        headline={[WSS.hero.line1,WSS.hero.emphasis,WSS.hero.line3].join(" ")}
        subhead={WSS.hero.support}
        primaryCta={{ label: "Call Now", href: `tel:${CLIENT.phoneE164}` }}
        secondaryCta={{ label: "Services", href: "/services" }}
        rightRail={
          <div className="hidden lg:block">
            <EstimatorWidget variant="rail" />
          </div>
        }
      />

      {/* Mobile estimator below hero */}
      <Section className="!py-8 lg:hidden">
        <EstimatorWidget variant="inline" />
      </Section>

      {/* Trust stats */}
      {TRUST.stats.length > 0 && <Section className="!py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {TRUST.stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-6 text-center">
              <div className="font-serif text-3xl md:text-4xl font-semibold text-primary">{s.value}</div>
              <div className="text-xs md:text-sm text-muted-foreground mt-2">{s.label}</div>
            </div>
          ))}
        </div>
      </Section>

      }
      {/* Services */}
      <Section className="!pt-6">
        <SectionHeader
          eyebrow="What We Do"
          title={<>Our <span className="text-primary">services</span>.</>}
          intro={WSS.content.serviceIntro}
        />
        <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SERVICES.map((s) => {
            const Icon = ICONS[s.icon] ?? Wrench;
            return (
              <Link
                key={s.slug}
                to="/services"
                hash={s.slug}
                className="rounded-2xl border border-border bg-card p-6 hover:bg-muted/40 transition-colors group"
              >
                <Icon className="w-6 h-6 text-primary mb-4" />
                <h3 className="font-serif text-xl font-semibold">{s.name}</h3>
                <p className="text-muted-foreground mt-2 leading-relaxed text-sm">{s.shortDesc}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Learn more <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </div>
      </Section>

      <Rates rates={null} />
      {/* Rates and specialties omitted: no typed pricing or specialty evidence. */}
      {/* Founder proof band */}
      {MEDIA.founderBand && WSS.trust.badges.length > 0 && <section className="border-y border-border bg-muted/30">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-14 grid md:grid-cols-[1fr_1.1fr] gap-10 items-center">
          <div className="rounded-2xl overflow-hidden border border-border bg-card aspect-[4/3]">
            <img src={MEDIA.founderBand} alt={`${CLIENT.businessName} team`} className="w-full h-full object-cover" />
          </div>
          <div>
            <span className="chip mb-4">Credentials</span>
            <h2 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
              <span className="text-primary">Credentials</span>.
            </h2>
            <ul className="mt-6 grid sm:grid-cols-2 gap-3 text-sm">
              {WSS.trust.badges.map(b=>({mark:b.label,text:b.sublabel})).map((b) => (
                <li
                  key={b.mark}
                  className="flex items-center gap-3 rounded-lg border border-primary/30 bg-[oklch(0.985_0.012_95)] dark:bg-card p-3 shadow-sm min-w-0"
                >
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold/20 ring-1 ring-primary/40 font-serif text-[0.7rem] font-bold tracking-tight text-primary">
                    {b.mark}
                  </span>
                  <span className="text-foreground leading-snug font-medium min-w-0">{b.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>}

      {/* Service area */}
      {WSS.trust.areas.length > 0 && <Section>
        <SectionHeader
          eyebrow="Service Area"
          title={<>Serving <span className="text-primary">{CLIENT.serviceAreaLabel}</span>.</>}
          intro={pageCopy("service-area", "")}
        />
        <div className="mt-10">
          <ServiceAreaMap />
        </div>
      </Section>


      }
      {/* Gallery preview */}
      {MEDIA.homeGallery.length > 0 && <Section className="!pt-2">
        <SectionHeader
          eyebrow="On The Job"
          title={<>Photo <span className="text-primary">gallery</span>.</>}
          
        />
        <div className="mt-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {MEDIA.homeGallery.map((g) => (
            <figure key={g.src} className="group rounded-2xl overflow-hidden border border-border bg-card">
              <div className="aspect-[4/3] overflow-hidden bg-muted">
                <img
                  src={g.src}
                  alt={g.alt}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <figcaption className="px-4 py-3 text-xs text-muted-foreground">{g.caption}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      }
      <ReviewQuotes />

      {FAQS.length > 0 &&       <Section>
        <SectionHeader center eyebrow="FAQ" title={<>Common <span className="text-primary">questions</span></>} />
        <div className="mt-10"><FAQ items={FAQS} /></div>
      </Section>

      }
      <Section className="!pb-10">
        <CallCTA heading={WSS.content.ctaHeadline || "Contact us"} sub={WSS.content.ctaBody} />
      </Section>
    </SiteLayout>
  );
}
