import { Hero } from "@/components/site/Hero";
import { Marquee } from "@/components/site/Marquee";
import { Services } from "@/components/site/Services";
import { JobPlanner } from "@/components/site/JobPlanner";
import { Gallery } from "@/components/site/Gallery";
import { About } from "@/components/site/About";
import { Trust } from "@/components/site/Trust";
import { Faq } from "@/components/site/Faq";
import { Contact } from "@/components/site/Contact";
import { Footer } from "@/components/site/Footer";
import { TopBar } from "@/components/site/TopBar";
import { StickyCta } from "@/components/site/StickyCta";

export function Index() {
  return (
    <main className="relative overflow-x-hidden bg-background text-foreground">
      <TopBar />
      <Hero />
      <Marquee />
      <Services />
      <JobPlanner />
      <Trust />
      <Gallery />
      <About />
      <Faq />
      <Contact />
      <Footer />
      <StickyCta />
    </main>
  );
}
