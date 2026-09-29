import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { ArtistIntro } from "@/components/ArtistIntro";
import { Portfolio } from "@/components/Portfolio";
import { Flash } from "@/components/Flash";
import { ProcessSection } from "@/components/ProcessSection";
import { Reviews } from "@/components/Reviews";
import { BookingForm } from "@/components/BookingForm";
import { Footer } from "@/components/Footer";
import { BookingAgent } from "@/components/BookingAgent";
import { RelatedStrip } from "@/components/RelatedStrip";
import { siteConfig } from "@/config/siteConfig";

function scrollToBooking() {
  document.getElementById("booking")?.scrollIntoView({ behavior: "smooth" });
}

function LandingPage() {
  return (
    <div className="wss min-h-screen bg-ink text-bone">
      <Nav onBook={scrollToBooking} />
      <main id="main">
        <Hero onBook={scrollToBooking} />
        <ArtistIntro />
        <Portfolio />
        <Flash onBook={scrollToBooking} />
        <ProcessSection />
        <Reviews />
        <BookingForm />
        <RelatedStrip
          items={[
            { title: `Meet ${siteConfig.artistName.split(" ")[0]}`, blurb: "Bio, credentials, and studio timeline.", to: "/artist" },
            { title: "Pricing & Process", blurb: "How booking works, session bands, aftercare.", to: "/process" },
            { title: "Visit the Studio", blurb: "Hours, directions, parking, transit.", to: "/visit" },
          ]}
        />
      </main>
      <Footer />
      <BookingAgent onBook={scrollToBooking} />
    </div>
  );
}

const title = `${siteConfig.studioName} — Custom Tattoos in ${siteConfig.city}, ${siteConfig.state}`;
const description = `${siteConfig.tagline} Private appointment-only studio in ${siteConfig.neighborhood}. Books open ${siteConfig.bookingStatus}.`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: siteConfig.siteUrl + "/" },
      { property: "og:image", content: `${siteConfig.siteUrl}/og-home.jpg` },
      { name: "twitter:image", content: `${siteConfig.siteUrl}/og-home.jpg` },
    ],
    links: [{ rel: "canonical", href: siteConfig.siteUrl + "/" }],
  }),
  component: LandingPage,
});
