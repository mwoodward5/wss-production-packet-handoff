import {CLIENT,planCopy,paragraphs} from "@/lib/wss";
import {CertifiedCopy} from "@/components/CertifiedCopy";
import { Seo } from "@/components/Seo";
import { PageHero } from "@/components/sections/PageHero";
import { ServiceArea } from "@/components/sections/ServiceArea";
import { CtaBand } from "@/components/sections/CtaBand";
import { BUSINESS } from "@/lib/business";
import { localBusinessSchema } from "@/lib/schema";
import { ASSETS } from "@/lib/assets";
const processImg = ASSETS.process;
import { MapPin } from "lucide-react";
import { Link } from "react-router-dom";

const ServiceAreaPage = () => (
  <>
    <Seo
      title={`Service Area | ${BUSINESS.name}`}
      description={planCopy("service-area") || BUSINESS.name}
      path="/service-area"
      schema={[localBusinessSchema]}
    />

    <PageHero
      eyebrow="Service Area"
      title="Service area"
      subtitle={BUSINESS.serviceArea.join(" · ")}
      image={processImg}
      imageAlt={BUSINESS.city}
      crumbs={[{ label: "Home", href: "/" }, { label: "Service Area" }]}
    />

    <ServiceArea />

    <section className="bg-secondary/40 py-16 md:py-20">
      <div className="container-tight">
        <span className="eyebrow">Cities & towns we cover</span>
        <h2 className="heading-section mt-3">{BUSINESS.name}</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Not sure if your address is in our area? Call {BUSINESS.phoneDisplay} — we'll tell you straight.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-3 md:grid-cols-5">
          {BUSINESS.serviceArea.map((c) => (
            <div key={c} className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm">
              <MapPin className="h-4 w-4 text-accent" /> {c}
            </div>
          ))}
        </div>

        {CLIENT.trust.mapUrl && <a href={CLIENT.trust.mapUrl} className="mt-10 block border border-border bg-card p-6">Map and directions</a>}
      </div>
    </section>

    <section className="py-20">
      <div className="container-tight grid gap-10 lg:grid-cols-[1fr_2fr]">
        <div>
          <span className="eyebrow">About our coverage area</span>
          <h2 className="heading-section mt-3">{BUSINESS.city}, {BUSINESS.region}</h2>
          <p className="mt-4 text-muted-foreground">
            {BUSINESS.name}
          </p>
        </div>
        <div className="space-y-8 text-[15px] leading-relaxed text-muted-foreground">
          <CertifiedCopy blocks={paragraphs(planCopy('service-area'))} />
        </div>
      </div>
    </section>

    <CtaBand />
  </>
);

export default ServiceAreaPage;