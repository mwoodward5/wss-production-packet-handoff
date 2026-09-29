import { Header } from "@/components/site/Header";
import { Hero } from "@/components/site/Hero";
import { Services } from "@/components/site/Services";
import { Gallery } from "@/components/site/Gallery";
import { Planner } from "@/components/site/Planner";
import { ServiceArea } from "@/components/site/ServiceArea";
import { Faq } from "@/components/site/Faq";
import { Footer } from "@/components/site/Footer";
import { SectionDivider } from "@/components/site/SectionDivider";
import { MobileCta } from "@/components/site/MobileCta";
import { Reviews } from "@/components/site/Reviews";
export function Index() {
  return (
    <div className="min-h-screen bg-cream font-sans text-ink">
      <Header />
      <main>
        <Hero />
        <Services />
        <SectionDivider tone="cream" />
        <Gallery />
        <Reviews />
        <Planner />
        <ServiceArea />
        <SectionDivider tone="cream" />
        <Faq />
      </main>
      <Footer />
      <MobileCta />
    </div>
  );
}
