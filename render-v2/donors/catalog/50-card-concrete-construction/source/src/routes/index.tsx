import { Hero } from "@/components/site/hero";
import {
  Nav, ServiceStack, Gallery, ProcessRail, ServiceArea, Faq, ContactSection, Footer, StickyCta,
} from "@/components/site/sections";
import { SERVICES } from "@/content/services";
import { FAQS } from "@/content/faqs";
import { SITE } from "@/lib/site";
import { CC_ASSETS } from "@/assets/cc";

export function Index() {
  return (
    <main className="min-h-screen bg-[var(--ink)]">
      <Nav />
      <Hero />
      <ServiceStack />
      <Gallery />
      <ProcessRail />
      <ServiceArea />
      <Faq />
      <ContactSection />
      <Footer />
      <StickyCta />
    </main>
  );
}
