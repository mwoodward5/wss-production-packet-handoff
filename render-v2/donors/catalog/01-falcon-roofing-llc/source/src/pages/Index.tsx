import {CLIENT,planCopy,paragraphs} from "@/lib/wss";
import {BUSINESS} from "@/lib/business";
import {CertifiedCopy} from "@/components/CertifiedCopy";
import { Seo } from "@/components/Seo";
import { Hero } from "@/components/sections/Hero";
import { Services } from "@/components/sections/Services";
import { Process } from "@/components/sections/Process";
import { ResVsCommercial } from "@/components/sections/ResVsCommercial";
import { ServiceArea } from "@/components/sections/ServiceArea";
import { Faq } from "@/components/sections/Faq";
import { CtaBand } from "@/components/sections/CtaBand";
import { QuoteForm } from "@/components/sections/QuoteForm";
import { localBusinessSchema, organizationSchema, websiteSchema, faqSchema } from "@/lib/schema";

const faqs=CLIENT.content.faqs;

const Index = () => (
  <>
    <Seo
      title={BUSINESS.name}
      description={CLIENT.hero.support}
      path="/"
      schema={[organizationSchema, websiteSchema, localBusinessSchema, ...(faqs.length ? [faqSchema(faqs)] : [])]}
    />
    <Hero />
    <Services />
    <Process />
    <ResVsCommercial />
    <ServiceArea />
    <CtaBand />
    <section className="bg-secondary/30 py-20 md:py-24">
      <div className="container-tight grid gap-10 lg:grid-cols-[3fr_2fr] lg:items-start">
        <QuoteForm />
        <div className="space-y-4">
          <span className="eyebrow">Quote · Direct line</span>
          <h2 className="heading-section">{CLIENT.content.whyHeadline || BUSINESS.name}</h2>
          <CertifiedCopy blocks={paragraphs(planCopy('contact') || CLIENT.content.about)} />
          <a href={CLIENT.identity.phoneTel} className="font-semibold text-accent">{BUSINESS.phoneDisplay}</a>
          {BUSINESS.email && <a href={`mailto:${BUSINESS.email}`} className="block font-semibold text-accent">{BUSINESS.email}</a>}
        </div>
      </div>
    </section>
    <Faq faqs={faqs} />
  </>
);

export default Index;
