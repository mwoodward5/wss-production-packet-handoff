import {CLIENT,serviceFor,guideFor,Service} from "@/lib/wss";
import {BUSINESS} from "@/lib/business";
import {CertifiedCopy} from "@/components/CertifiedCopy";
import NotFound from "./NotFound";
import { Seo } from "@/components/Seo";
import { PageHero } from "@/components/sections/PageHero";
import { Faq } from "@/components/sections/Faq";
import { CtaBand } from "@/components/sections/CtaBand";
import { localBusinessSchema, serviceSchema, faqSchema } from "@/lib/schema";
import { ASSETS } from "@/lib/assets";
const processImg = ASSETS.process;
import { Cloud, Droplets, Search, ShieldCheck, Wrench, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";

const RoofRepair = ({serviceOverride}:{serviceOverride?:Service}) => {
const service=serviceOverride || serviceFor('/roof-repair');
const guide=guideFor(service);
const services=guide.slice(0,6).map((block,i)=>({icon:Wrench,t:block.match(/^##+\s+([^\n]+)/)?.[1] || `${service?.shortLabel} · ${i+1}`,d:block.replace(/^##+[^\n]+\n?/, '')}));
const faqs:{q:string;a:string}[]=[]; // CSD has no route-specific FAQ provenance.

return !service ? <NotFound /> : (
  <>
    <Seo
      title={`${service.name} | ${BUSINESS.name}`}
      description={service.description}
      path={serviceOverride?.href || "/roof-repair"}
      schema={[
        localBusinessSchema,
        serviceSchema(service.name,service.description,serviceOverride?.href || "/roof-repair"),

      ]}
    />

    <PageHero
      eyebrow={service.shortLabel}
      title={service.name}
      subtitle={service.description}
      image={processImg}
      imageAlt={service.name}
      crumbs={[{label:"Home",href:"/"},{label:service.name}]}
    />

{services.length > 0 &&     <section className="py-20 md:py-28">
      <div className="container-tight grid gap-12 lg:grid-cols-[2fr_3fr]">
        <div>
          <span className="eyebrow">Repair scope</span>
          <h2 className="heading-section mt-3">{service.name}</h2>
          <p className="mt-4 text-muted-foreground">{service.description}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {services.map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-xl border border-border bg-card p-6 shadow-card">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-accent/10 text-accent">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>}

{guide.length > 6 &&     <section className="bg-secondary/40 py-20">
      <div className="container-tight grid gap-10 lg:grid-cols-[1fr_2fr]">
        <div>
          <span className="eyebrow">Service guide</span>
          <h2 className="heading-section mt-3">{service.name}</h2>
        </div>
        <div className="space-y-8 text-[15px] leading-relaxed text-muted-foreground">
          <CertifiedCopy blocks={guide.slice(6)} />
        </div>
      </div>
    </section>}

    <Faq faqs={faqs} title="Roof repair FAQs" />
    <CtaBand />
  </>
);
};

export default RoofRepair;