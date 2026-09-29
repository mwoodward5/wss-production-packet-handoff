import { createFileRoute, Link } from "@tanstack/react-router";
import { Award, CheckCircle2, MapPin } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RelatedStrip } from "@/components/RelatedStrip";
import { siteConfig } from "@/config/siteConfig";
import { breadcrumbSchema, personSchema } from "@/lib/jsonld";

function ArtistPage() {
  return (
    <div className="min-h-screen bg-ink text-bone">
      <Nav onBook={() => {}} />
      <Breadcrumbs trail={[{ name: "Home", path: "/" }, { name: "Artist", path: "/artist" }]} />

      <main id="main" className="container-wss pb-24">
        <header className="pt-6 pb-12 max-w-3xl">
          <div className="section-label">The Artist</div>
          <h1 className="text-5xl md:text-6xl font-bold leading-[1.02] mb-5">
            {siteConfig.artistName}
          </h1>
          <p className="text-xl text-fadetext leading-relaxed">{siteConfig.bio}</p>
          <div className="flex items-center gap-2 text-fadetext mt-5 text-sm">
            <MapPin size={14} /> {siteConfig.address}
          </div>
        </header>

        <section className="grid lg:grid-cols-[1.2fr_0.8fr] gap-12 mb-20">
          <div className="prose-wss space-y-5 text-fadetext text-lg leading-relaxed">
            <p className="text-bone text-xl italic font-display">
              "{siteConfig.quote}"
            </p>
            {siteConfig.longBio.map((paragraph, i) => (
              <p key={i}>
                {paragraph}
                {i === siteConfig.longBio.length - 1 && (
                  <>
                    {" "}Instagram <a href={siteConfig.instagram} target="_blank" rel="noreferrer" className="text-signal underline underline-offset-4">{siteConfig.instagramHandle}</a> is where new work goes first, along with any flash releases.
                  </>
                )}
              </p>
            ))}
          </div>

          <aside className="glass p-8 h-fit sticky top-32">
            <div className="section-label mb-4">Credentials</div>
            <ul className="space-y-4 text-sm">
              {siteConfig.credentials.map((c) => (
                <li key={c.label} className="flex gap-3">
                  <Award size={16} className="text-signal shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-bone">{c.label}</div>
                    <div className="text-fadetext text-xs mt-0.5">{c.value}</div>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <section className="mb-20">
          <div className="section-label mb-6">Studio Timeline</div>
          <div className="grid gap-4">
            {siteConfig.timeline.map((t) => (
              <div key={t.year} className="glass p-6 flex gap-6 items-baseline">
                <div className="text-3xl font-display font-bold text-signal tabular-nums w-20 shrink-0">
                  {t.year}
                </div>
                <p className="text-fadetext text-lg">{t.event}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-20">
          <div className="section-label mb-6">Selected Work</div>
          <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
            {siteConfig.gallery.slice(0, 9).map((g) => (
              <div key={g.title} className="aspect-square overflow-hidden rounded-lg frame-plate">
                <img src={g.image} alt={g.title} loading="lazy" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
          <Link
            to="/portfolio"
            className="inline-flex items-center gap-2 text-signal underline underline-offset-4"
          >
            See full portfolio →
          </Link>
        </section>

        <section className="glass p-10 text-center">
          <h2 className="text-3xl font-display font-bold mb-3">Ready to work with {siteConfig.artistName.split(" ")[0]}?</h2>
          <p className="text-fadetext mb-6 max-w-md mx-auto">
            Books are open for {siteConfig.bookingStatus.replace("Books open for ", "")}. Every request is reviewed personally.
          </p>
          <Link
            to="/"
            hash="booking"
            className="inline-flex items-center gap-2 bg-signal text-ink font-semibold px-7 py-3.5 rounded-full emboss"
          >
            <CheckCircle2 size={18} /> Start your request
          </Link>
        </section>
      </main>

      <RelatedStrip
        items={[
          { title: "Portfolio", blurb: "Full gallery with lightbox and style filters.", to: "/portfolio" },
          { title: "Process", blurb: "How booking, deposits, and sessions work.", to: "/process" },
          { title: "Visit", blurb: "Studio hours, directions, and parking.", to: "/visit" },
        ]}
      />
      <Footer />
    </div>
  );
}

const title = `${siteConfig.artistName} — Custom Tattoo Artist in ${siteConfig.city}`;
const description = `Meet ${siteConfig.artistName}, owner of ${siteConfig.studioName}. Fine-line, blackwork & illustrative tattooer based in ${siteConfig.neighborhood}. Licensed since 2017.`;

export const Route = createFileRoute("/artist")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: `${siteConfig.siteUrl}/artist` },
      { property: "og:type", content: "profile" },
    ],
    links: [{ rel: "canonical", href: `${siteConfig.siteUrl}/artist` }],
    scripts: [
      { type: "application/ld+json", children: JSON.stringify(personSchema()) },
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Artist", path: "/artist" }]),
        ),
      },
    ],
  }),
  component: ArtistPage,
});
