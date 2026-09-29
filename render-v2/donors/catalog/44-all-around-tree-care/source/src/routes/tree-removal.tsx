import { DATA } from "@/wss/bridge";

import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader, CallCTA, FAQ } from "@/components/site/Sections";
import { BreadcrumbSchema } from "@/components/site/Schema";
import { GoogleMapEmbed } from "@/components/site/GoogleBusiness";
import { CLIENT, SEO, SERVICES, absoluteUrl, servicePhoto } from "@/config";
import { TreeDeciduous } from "lucide-react";





export function TreeRemovalPage({ serviceSlug }: { serviceSlug?: string } = {}) {
  const SERVICE = SERVICES.find((service) => serviceSlug ? service.slug === serviceSlug : service.route === "/tree-removal");
  if (!SERVICE) return <SiteLayout><Section><SectionHeader eyebrow="Services" title="Explore available services" intro={DATA.content.serviceIntro} /><a href="/services" className="mt-6 inline-flex text-primary">View services</a></Section></SiteLayout>;
  const faqs = SERVICE.faqs.length ? SERVICE.faqs : DATA.content.faqs;
  const ITEMS = DATA.services.map((service) => ({ icon: TreeDeciduous, title: service.name, body: service.description }));
  return (
    <SiteLayout>
      <BreadcrumbSchema items={[
        { name: "Home", url: absoluteUrl("/") },
        { name: "Services", url: absoluteUrl("/services") },
        { name: SERVICE.name, url: absoluteUrl(SERVICE.route) },
      ]} />

      <Section>
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <SectionHeader as="h1" eyebrow={`${CLIENT.city}, ${CLIENT.region}`} title={<>{SERVICE.h1}</>} intro={SERVICE.shortDesc} />
            {SERVICE.longDescMd !== SERVICE.shortDesc && <p className="text-muted-foreground leading-relaxed mt-5">{SERVICE.longDescMd}</p>}
          </div>
          <div className="rounded-2xl overflow-hidden border border-border bg-muted aspect-[4/3]">
            {servicePhoto(SERVICE.slug) && <img src={servicePhoto(SERVICE.slug)} alt={SERVICE.name} className="w-full h-full object-cover" />}
          </div>
        </div>
      </Section>

      <div style={{ background: "linear-gradient(180deg, oklch(0.94 0.025 130 / 0.55) 0%, oklch(0.96 0.018 85) 100%)" }}>
        <Section>
          <SectionHeader eyebrow="Scope of Work" title={<>Explore our <span className="text-primary">services</span></>} />
          <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {ITEMS.map((i) => (
              <div key={i.title} className="rounded-2xl border border-border bg-card p-6">
                <i.icon className="w-6 h-6 text-primary mb-3" />
                <h3 className="text-lg font-bold">{i.title}</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{i.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section>
        <div className="grid lg:grid-cols-2 gap-10 items-start">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{DATA.content.whyHeadline || `About ${CLIENT.businessName}`}</h2>
            <ol className="mt-5 space-y-4 text-muted-foreground leading-relaxed">
              {DATA.content.values.map((value, index) => <li key={value.title}><strong className="text-foreground">{index + 1}. {value.title}.</strong> {value.body}</li>)}
            </ol>
            <p className="text-muted-foreground leading-relaxed mt-5">{DATA.content.about}</p>
          </div>
          <div>
            <GoogleMapEmbed />
            {DATA.trust.mapUrl && <a
              href={DATA.trust.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              View map
            </a>}
          </div>
        </div>
      </Section>

      {faqs.length > 0 && <Section>
        <SectionHeader eyebrow="FAQ" title={<>Your <span className="text-primary">questions</span></>} />
        <div className="mt-10">
          <FAQ items={faqs} />
        </div>
      </Section>}

      <Section className="!pb-10">
        <CallCTA heading={DATA.content.ctaHeadline || "Discuss your project"} sub={DATA.content.ctaBody || `Call ${CLIENT.phone}.`} />
      </Section>
    </SiteLayout>
  );
}
