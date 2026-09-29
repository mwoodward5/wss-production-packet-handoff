import { createFileRoute } from "@tanstack/react-router";
import { Hero } from "@/components/home/Hero";
import { ServicePathSelector } from "@/components/home/ServicePathSelector";
import { ServicesPreview } from "@/components/home/ServicesPreview";
import { TrustStrip } from "@/components/home/TrustStrip";
import { ProcessBlueprint } from "@/components/home/ProcessBlueprint";
import { LocalAuthority } from "@/components/home/LocalAuthority";
import { FaqPreview } from "@/components/home/FaqPreview";
import { CtaBanner } from "@/components/site/CtaBanner";
import { BUSINESS } from "@/lib/business";
import { routeHead } from "@/lib/wss-route-head";

export const Route = createFileRoute("/")({
  head: () => routeHead("Electrical services in " + BUSINESS.region),
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <Hero />
      <ServicePathSelector />
      <TrustStrip />
      <ServicesPreview />
      <ProcessBlueprint />
      <LocalAuthority />
      <FaqPreview />
      <CtaBanner />
    </>
  );
}
