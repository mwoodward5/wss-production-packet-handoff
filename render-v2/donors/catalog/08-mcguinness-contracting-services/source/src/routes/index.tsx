import { schemas } from "@/lib/wss";
import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Services } from "@/components/site/Services";
import { Work } from "@/components/site/Work";
import { Why } from "@/components/site/Why";
import { Process } from "@/components/site/Process";
import { Area } from "@/components/site/Area";
import { Faq } from "@/components/site/Faq";
import { Contact } from "@/components/site/Contact";
import { Footer } from "@/components/site/Footer";
import { MobileCTA } from "@/components/site/MobileCTA";

export const Route = createFileRoute("/")({ component: Index });

export function Index() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Services />
        <Work />
        <Why />
        <Process />
        <Area />
        <Faq />
        <Contact />
      </main>
      <Footer />
      <MobileCTA />
      <Toaster position="top-center" richColors />
      {schemas().map((schema,i)=><script key={i} type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema).replace(/</g,'\\u003c')}} />)}
    </>
  );
}
