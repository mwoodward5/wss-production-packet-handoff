import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Portfolio } from "@/components/Portfolio";
import { RelatedStrip } from "@/components/RelatedStrip";
import { siteConfig } from "@/config/siteConfig";
import { breadcrumbSchema } from "@/lib/jsonld";

function PortfolioPage() {
  return (
    <div className="min-h-screen bg-ink text-bone">
      <Nav onBook={() => {}} />
      <Breadcrumbs trail={[{ name: "Home", path: "/" }, { name: "Portfolio", path: "/portfolio" }]} />
      <main id="main">
        <header className="container-wss pt-4 pb-8 max-w-3xl">
          <h1 className="text-5xl md:text-6xl font-bold leading-[1.02] mb-4">
            The <span className="italic text-signal">portfolio.</span>
          </h1>
          <p className="text-lg text-fadetext leading-relaxed">
            Recent custom work across fine-line, blackwork, botanical, ornamental, and illustrative styles. Every piece is drawn for the person wearing it. Filter by style, click any frame to open the full story.
          </p>
        </header>
        <Portfolio />
      </main>
      <RelatedStrip
        items={[
          { title: "Flash", blurb: "Available flash pieces — first-come.", to: "/flash" },
          { title: "Process", blurb: "How pricing and booking works.", to: "/process" },
          { title: "FAQ", blurb: "Cost, cover-ups, healing, walk-ins.", to: "/faq" },
        ]}
      />
      <Footer />
    </div>
  );
}

const title = `Tattoo Portfolio — ${siteConfig.studioName} | ${siteConfig.city} ${siteConfig.state}`;
const description = `Recent fine-line, blackwork & botanical tattoos by ${siteConfig.artistName} in ${siteConfig.city}. Every piece drawn custom.`;

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: `${siteConfig.siteUrl}/portfolio` },
      { property: "og:image", content: siteConfig.gallery[0].image },
      { name: "twitter:image", content: siteConfig.gallery[0].image },
    ],
    links: [{ rel: "canonical", href: `${siteConfig.siteUrl}/portfolio` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Portfolio", path: "/portfolio" }]),
        ),
      },
    ],
  }),
  component: PortfolioPage,
});
