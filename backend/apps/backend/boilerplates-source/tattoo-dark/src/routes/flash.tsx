import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Flash } from "@/components/Flash";
import { FlashDropForm } from "@/components/FlashDropForm";
import { RelatedStrip } from "@/components/RelatedStrip";
import { siteConfig } from "@/config/siteConfig";
import { breadcrumbSchema } from "@/lib/jsonld";

function scrollToBooking() {
  window.location.href = "/#booking";
}

function FlashPage() {
  return (
    <div className="min-h-screen bg-ink text-bone">
      <Nav onBook={scrollToBooking} />
      <Breadcrumbs trail={[{ name: "Home", path: "/" }, { name: "Flash", path: "/flash" }]} />
      <main id="main">
        <header className="container-wss pt-4 pb-10 max-w-3xl">
          <h1 className="text-5xl md:text-6xl font-bold leading-[1.02] mb-4">
            Flash — <span className="italic text-signal">first come, first inked.</span>
          </h1>
          <p className="text-lg text-fadetext leading-relaxed">
            Repeatable and one-time flash pieces available for quick booking. Priced flat, no consultation needed. New flash drops every Tuesday at noon Central — subscribers get it 24 hours early.
          </p>
        </header>
        <div className="container-wss mb-16">
          <FlashDropForm />
        </div>
        <Flash onBook={scrollToBooking} />
      </main>
      <RelatedStrip
        items={[
          { title: "Portfolio", blurb: "Custom work if flash isn't your fit.", to: "/portfolio" },
          { title: "Process", blurb: "How flash booking works.", to: "/process" },
          { title: "FAQ", blurb: "Walk-ins, sizing, and touch-ups.", to: "/faq" },
        ]}
      />
      <Footer />
    </div>
  );
}

const title = `Tattoo Flash Sheet — ${siteConfig.studioName} | ${siteConfig.city}`;
const description = `Available flash designs by ${siteConfig.artistName}. Flat pricing, quick booking. New drops every Tuesday.`;

export const Route = createFileRoute("/flash")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: `${siteConfig.siteUrl}/flash` },
    ],
    links: [{ rel: "canonical", href: `${siteConfig.siteUrl}/flash` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Flash", path: "/flash" }]),
        ),
      },
    ],
  }),
  component: FlashPage,
});
