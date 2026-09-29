import { DATA, gallery } from "@/wss/bridge";
import { Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader, CallCTA } from "@/components/site/Sections";
import { SignatureHero } from "@/components/site/SignatureHero";
import { SatelliteServiceMap } from "@/components/site/SatelliteServiceMap";
import { mapEmbedUrl } from "@/components/site/NativeMapLinks";
import { ProofGallery } from "@/components/site/ProofGallery";
import { LocalBusinessSchema, OrganizationSchema, WebSiteSchema, BreadcrumbSchema, SpeakableSchema } from "@/components/site/Schema";
import { ArrowRight } from "lucide-react";
import { CLIENT, SERVICES, SEO, TRUST, absoluteUrl, servicePhoto } from "@/config";



export function HomePage() {
  return (
    <SiteLayout>
      <LocalBusinessSchema />
      <OrganizationSchema />
      <WebSiteSchema />
      <BreadcrumbSchema items={[{ name: "Home", url: absoluteUrl("/") }]} />
      <SpeakableSchema url={absoluteUrl("/")} />

      <SignatureHero />

      {/* Clear the overlapping dispatch widget on desktop */}
      <div className="hidden lg:block h-20" />

      {TRUST.stats.length > 0 && <div className="bg-[oklch(0.96_0.018_85)]">
        <Section className="!py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {TRUST.stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-border bg-card p-6 text-center shadow-[var(--shadow-card)]">
                <div className="text-3xl md:text-4xl font-bold text-primary">{s.value}</div>
                <div className="text-xs md:text-sm text-muted-foreground mt-2">{s.label}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>}

      <Section>
        <SectionHeader eyebrow="What We Do" title={<>Explore our <span className="text-primary">services</span></>} intro={DATA.content.serviceIntro} />
        <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SERVICES.map((s) => (
            <Link key={s.slug} to={s.route} className="group rounded-2xl border border-border bg-card overflow-hidden hover:shadow-[var(--shadow-elevated)] transition-all">
              <div className="aspect-[4/3] overflow-hidden bg-muted">
                {servicePhoto(s.slug) && <img
                  src={servicePhoto(s.slug)}
                  alt={s.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />}
              </div>
              <div className="p-6">
                <h3 className="text-xl font-bold">{s.name}</h3>
                <p className="text-muted-foreground mt-2 leading-relaxed text-sm">{s.shortDesc}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Learn more <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {gallery.length > 0 && <div style={{ background: "linear-gradient(180deg, oklch(0.32 0.04 135) 0%, oklch(0.22 0.025 140) 100%)" }} className="text-white">
        <Section>
          <SectionHeader
            eyebrow="Gallery"
            title={<span className="text-white">{CLIENT.businessName} <span className="text-[var(--gold)]">gallery</span></span>}
            intro=""
          />
          <div className="mt-10">
            <ProofGallery />
          </div>
        </Section>
      </div>}

      {(DATA.trust.areas.length > 0 || mapEmbedUrl || DATA.trust.mapUrl) && <div style={{ background: "linear-gradient(180deg, oklch(0.94 0.025 130 / 0.55) 0%, oklch(0.96 0.018 85) 100%)" }}>
        <Section>
          <SectionHeader
            eyebrow="Service Area"
            title={<><span className="text-primary">{CLIENT.serviceAreaLabel || "Location"}</span></>}
            intro={DATA.trust.areas.join(" · ")}
          />
          <div className="mt-10">
            <SatelliteServiceMap />
          </div>
        </Section>
      </div>}

      <Section className="!pb-10">
        <CallCTA heading="Ready to get started?" sub={`Call ${CLIENT.phone} or send a message.`} />
      </Section>
    </SiteLayout>
  );
}
