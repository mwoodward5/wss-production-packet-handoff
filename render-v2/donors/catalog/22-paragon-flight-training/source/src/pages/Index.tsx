import { useEffect } from "react";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { InquiryStrip } from "@/components/InquiryStrip";
import { Pathway } from "@/components/Pathway";
import { MissionControl } from "@/components/MissionControl";
import { Discovery } from "@/components/Discovery";
import { CampusMap } from "@/components/CampusMap";
import { FlightScene } from "@/components/FlightScene";
import { ServiceAreas } from "@/components/ServiceAreas";
import { FAQs, faqs } from "@/components/FAQs";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";
import { StickyCallBar } from "@/components/StickyCallBar";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import { HorizonBackdrop } from "@/components/motion/HorizonBackdrop";
import { StickyDesktopCTA } from "@/components/StickyDesktopCTA";

import { client } from '@/lib/wss';
import { SITE } from '@/data/local';
import { LocalSEO } from '@/components/local/LocalSEO';

const Index = () => {
  return (
    <div className="relative min-h-screen bg-background">
      <LocalSEO title={SITE.name} description={client.hero.support} path="/" breadcrumbs={[{name:'Home',path:'/'}]}
        graph={[{'@type':'Organization','@id':`${SITE.url}/#org`,name:SITE.name,url:SITE.url,telephone:SITE.phone,
          logo:client.identity.logoOnDark,sameAs:client.trust.socials},
          ...client.services.map(s => ({'@type':'Service',name:s.name,description:s.description,provider:{'@id':`${SITE.url}/#org`}})),
          ...(faqs.length ? [{'@type':'FAQPage',mainEntity:faqs.map(f => ({'@type':'Question',name:f.q,acceptedAnswer:{'@type':'Answer',text:f.a}}))}] : [])]} />
      <HorizonBackdrop />
      <ScrollProgress />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <InquiryStrip />
        <Pathway />
        <MissionControl />
        <Discovery />
        <FlightScene />
        <CampusMap />
        <ServiceAreas />
        <FAQs />
        <Contact />
      </main>
      <Footer />
      <StickyCallBar />
      <StickyDesktopCTA />
    </div>
  );
};

export default Index;
