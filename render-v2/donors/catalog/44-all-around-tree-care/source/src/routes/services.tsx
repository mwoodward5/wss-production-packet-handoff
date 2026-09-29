import { DATA, gallery } from "@/wss/bridge";
import { Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader, CallCTA } from "@/components/site/Sections";
import { BreadcrumbSchema } from "@/components/site/Schema";
import { ServicesGallery } from "@/components/site/ServicesGallery";
import { SERVICES, CLIENT, absoluteUrl, servicePhoto } from "@/config";
import { ArrowRight, Leaf } from "lucide-react";




const VALUES = DATA.content.values.map((value) => ({ ...value, icon: Leaf }));

export function ServicesPage() {
  return (
    <SiteLayout>
      <BreadcrumbSchema items={[
        { name: "Home", url: absoluteUrl("/") },
        { name: "Services", url: absoluteUrl("/services") },
      ]} />

      <Section>
        <SectionHeader
          as="h1"
          eyebrow="What We Do"
          title={<>Services for <span className="text-primary">your property</span></>}
          intro={DATA.content.serviceIntro}
        />
      </Section>

      <Section className="!pt-2">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SERVICES.map((s) => (
            <Link id={s.slug} key={s.slug} to={s.route} className="group rounded-2xl border border-border bg-card overflow-hidden hover:shadow-[var(--shadow-elevated)] transition-all">
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

      {gallery.length > 0 && <Section className="!pt-2">
        <SectionHeader
          eyebrow="Image Gallery"
          title={<>Explore the <span className="text-primary">gallery</span></>}
          intro=""
        />
        <div className="mt-10">
          <ServicesGallery />
        </div>
      </Section>}

      <div style={{ background: "linear-gradient(180deg, oklch(0.94 0.025 130 / 0.55) 0%, oklch(0.96 0.018 85) 100%)" }}>

        <Section>
          <SectionHeader
            eyebrow="About Us"
            title={DATA.content.whyHeadline || `About ${CLIENT.businessName}`}
            intro={DATA.content.about}
          />
          <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {VALUES.map((v) => (
              <div key={v.title} className="rounded-2xl border border-border bg-card p-6">
                <v.icon className="w-6 h-6 text-primary mb-3" />
                <h3 className="text-lg font-bold">{v.title}</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section>
        <div className="grid lg:grid-cols-2 gap-10 items-start">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{CLIENT.serviceAreaLabel || `${CLIENT.city}, ${CLIENT.region}`}</h2>

            <p className="text-muted-foreground leading-relaxed mt-4">
              Call {CLIENT.phone} to discuss your project.
            </p>
            {DATA.trust.mapUrl && <a
              href={DATA.trust.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              View map
            </a>}
          </div>
          <div className="rounded-2xl overflow-hidden border border-border bg-muted">
            {servicePhoto("tree-removal") && <img
              src={servicePhoto("tree-removal")}
              alt={`${CLIENT.businessName} gallery`}
              className="w-full h-full object-cover"
            />}
          </div>
        </div>
      </Section>

      <Section className="!pb-10">
        <CallCTA heading={DATA.content.ctaHeadline || "Discuss your project"} sub={DATA.content.ctaBody || `Call ${CLIENT.phone}.`} />
      </Section>
    </SiteLayout>
  );
}
