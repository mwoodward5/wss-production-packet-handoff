import { Rates } from '@/components/site/Rates';
import { WSS, pageCopy } from '@/wss/bridge';

import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader, CallCTA, FAQ } from "@/components/site/Sections";
import { BreadcrumbSchema, LocalBusinessSchema } from "@/components/site/Schema";
import { CLIENT, SERVICES, SPECIALTY_SERVICES, absoluteUrl } from "@/config";
import { MEDIA } from "@/config/media";
import { Wrench, Settings, Snowflake, ClipboardCheck, BookOpen, Sun, ShieldCheck, AlertTriangle, CheckCircle2, Wind, Flame, Droplets, Refrigerator, Zap } from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Wrench, Settings, Snowflake, ClipboardCheck, BookOpen, Sun, ShieldCheck,
};

const SPECIALTY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Wind, Flame, Droplets, Refrigerator, Zap, Wrench,
};

const FAQS = WSS.content.faqs;
const SERVICE_COPY: Record<string,{details:string[]}> = {};

export function ServicesPage() {
  return (
    <SiteLayout>
      <LocalBusinessSchema />
      <BreadcrumbSchema items={[
        { name: "Home", url: absoluteUrl("/") },
        { name: "Services", url: absoluteUrl("/services") },
      ]} />

      <Section className="!pb-8">
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
          <div className="max-w-3xl">
            <span className="chip mb-5">Services</span>
            <h1 className="font-serif text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
              Our <span className="text-primary">services</span>.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground leading-relaxed">
              {WSS.content.serviceIntro}
            </p>
          </div>
          {MEDIA.service.length > 0 && <div className="grid grid-cols-2 gap-3">{MEDIA.service.map(g=><div key={g.src} className="rounded-2xl overflow-hidden border border-border bg-muted aspect-square"><img src={g.src} alt={g.alt} className="w-full h-full object-cover" /></div>)}</div>}
        </div>
      </Section>

      <Section className="!pt-0">
        <div className="grid gap-6 md:grid-cols-2">
          {SERVICES.map((s) => {
            const Icon = ICONS[s.icon] ?? Wrench;
            const copy = s.details.length ? {details:s.details} : null;
            return (
              <article key={s.slug} id={s.slug} className="rounded-2xl border border-border bg-card p-7 scroll-mt-24">
                <Icon className="w-7 h-7 text-primary mb-4" />
                <h2 className="font-serif text-2xl font-semibold">{s.name}</h2>
                <p className="mt-2 text-muted-foreground leading-relaxed">{s.shortDesc}</p>
                {copy && (
                  <ul className="mt-5 space-y-2 text-sm">
                    {copy.details.map((d) => (
                      <li key={d} className="flex items-start gap-2 text-foreground">
                        <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> {d}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </Section>

      <Rates rates={null} />
      {FAQS.length > 0 &&       <Section className="!pt-2">
        <SectionHeader center eyebrow="FAQ" title={<>Service <span className="text-primary">questions</span></>} />
        <div className="mt-10"><FAQ items={FAQS} /></div>
      </Section>

      }
      <Section className="!pb-10">
        <CallCTA heading={WSS.content.ctaHeadline || "Contact us"} sub={WSS.content.ctaBody} secondaryHref="/contact" secondaryLabel="Contact" />
      </Section>
    </SiteLayout>
  );
}
