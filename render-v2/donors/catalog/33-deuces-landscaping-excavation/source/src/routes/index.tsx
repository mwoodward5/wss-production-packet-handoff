import { WSS, PLAN, bridge } from "@/wss/bridge";
import {CertifiedMarkdown as ReactMarkdown} from '@/wss/CertifiedMarkdown';
import { FAQ } from "@/components/site/Sections";
import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader, CallCTA } from "@/components/site/Sections";
import { AnimatedHero } from "@/components/site/AnimatedHero";
import { TrustBadges } from "@/components/site/TrustBadges";
import { LeadForm } from "@/components/site/LeadForm";
import { LocalBusinessSchema, OrganizationSchema, WebSiteSchema, BreadcrumbSchema, SpeakableSchema } from "@/components/site/Schema";
import { GoogleMapEmbed } from "@/components/site/GoogleBusiness";
import { ReviewsCarousel } from "@/components/site/ReviewsCarousel";
import { JobGallery } from "@/components/site/JobGallery";
import { FounderCard } from "@/components/site/FounderCard";
import { StickyContactBubble } from "@/components/site/StickyContactBubble";
import { Mountain, Trees, Square, Axe, Route as RouteIcon, Waves, Pipette, Hammer, CloudLightning } from "lucide-react";
import { CLIENT, SERVICES, SEO, absoluteUrl } from "@/config";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Mountain, Trees, Square, Axe, Route: RouteIcon, Waves, Pipette, Hammer, CloudLightning,
};

export function HomePage() {
  return (
    <SiteLayout>
      <LocalBusinessSchema />
      <OrganizationSchema />
      <WebSiteSchema />
      <BreadcrumbSchema items={[{ name: "Home", url: absoluteUrl("/") }]} />
      <SpeakableSchema url={absoluteUrl("/")} />

      <AnimatedHero />
      <TrustBadges />

      <Section>
        <SectionHeader
          eyebrow="What We Do"
          title={<>Our <span className="text-primary">Services</span></>}
          intro={WSS.content.serviceIntro}
        />
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {SERVICES.map((s) => {
            const Icon = ICONS[s.icon] ?? Mountain;
            return (
              <div key={s.slug} className="premium-card p-6">
                <Icon className="w-7 h-7 text-primary" />
                <h3 className="mt-4 text-lg font-bold capitalize">{s.href ? <a href={s.href}>{s.name}</a> : s.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.shortDesc}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {bridge.gallery.length > 0 && <Section className="!pt-0">
        <SectionHeader
          eyebrow="Recent Work"
          title={<>Our <span className="text-primary">Projects</span></>}
          intro="Tap any image to enlarge."
        />
        <div className="mt-10">
          <JobGallery />
        </div>
      </Section>}

      <Section className="!pt-0">
        <SectionHeader
          center
          eyebrow="About us"
          title={WSS.content.whyHeadline || CLIENT.businessName}
          intro={PLAN.content?.about ? undefined : WSS.content.about}
        />
        {PLAN.content?.about && <div className="mt-6 text-lg text-muted-foreground leading-relaxed space-y-5"><ReactMarkdown>{PLAN.content.about}</ReactMarkdown></div>}
        <div className="mt-10 grid md:grid-cols-3 gap-5">
          {WSS.content.values.map(v=><div key={v.title} className="premium-card p-6"><h3 className="font-bold">{v.title}</h3><p className="mt-2 text-sm text-muted-foreground">{v.body}</p></div>)}
        </div>
        <div className="mt-8 max-w-3xl mx-auto">
          <FounderCard />
        </div>
      </Section>

      {(WSS.trust.areas.length > 0 || WSS.trust.mapUrl) && <Section>
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <SectionHeader
              eyebrow="Service Area"
              title={<>{CLIENT.city}, <span className="text-primary">{CLIENT.region}</span></>}
              intro={WSS.trust.areas.join(" · ")}
            />
            <div className="mt-6 flex flex-wrap gap-2">{WSS.trust.areas.map(c=><span key={c} className="px-3 py-1.5 rounded-full text-sm border border-border bg-muted/40 text-foreground">{c}</span>)}</div>
            <p className="mt-6 text-sm text-muted-foreground">
              Service area: {CLIENT.serviceAreaLabel}. Don&apos;t see your town? Call {CLIENT.phone}.
            </p>
          </div>
          <GoogleMapEmbed />
        </div>
        {PLAN.content?.['service-area'] && <div className="mt-6 text-muted-foreground"><ReactMarkdown>{PLAN.content['service-area']}</ReactMarkdown></div>}
      </Section>}

      {WSS.trust.reviews.length > 0 && <Section className="!pt-2">
        <SectionHeader
          center
          eyebrow="Reviews"
          title={<>Client <span className="text-primary">Reviews</span></>}
          
        />
        <div className="mt-10">
          <ReviewsCarousel />
        </div>
      </Section>}

      <Section id="contact">
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <div>
            <SectionHeader
              eyebrow="Contact"
              title={<>Contact us <span className="text-primary">today</span></>}
              intro={WSS.content.ctaBody || undefined}
            />
            {PLAN.content?.contact && <div className="mt-5 text-muted-foreground"><ReactMarkdown>{PLAN.content.contact}</ReactMarkdown></div>}
            <div className="mt-6 grid gap-3 text-sm">
              <a href={`tel:${CLIENT.phoneE164}`} className="inline-flex items-center gap-2 text-foreground hover:text-primary">📞 {CLIENT.phone}</a>
              {CLIENT.email && <a href={`mailto:${CLIENT.email}`} className="inline-flex items-center gap-2 text-foreground hover:text-primary break-all">✉ {CLIENT.email}</a>}
              <span className="inline-flex items-center gap-2 text-muted-foreground">📍 {CLIENT.serviceAreaLabel}</span>
            </div>
          </div>
          <div className="premium-card p-6 md:p-8">
            <LeadForm topic="Homepage contact" cta="Send message" />
          </div>
        </div>
      </Section>

      {WSS.content.faqs.length > 0 && <Section><SectionHeader title="Questions & answers"/><div className="mt-10"><FAQ items={WSS.content.faqs}/></div></Section>}
      <Section className="!pb-10">
        <CallCTA heading={WSS.content.ctaHeadline || "Contact us"} sub={`Call ${CLIENT.phone} to discuss your project.`} />
      </Section>

      <StickyContactBubble />
    </SiteLayout>
  );
}
