import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, MapPin, Mail, Phone, Instagram, Car, Train } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MapEmbed } from "@/components/MapEmbed";
import { DirectionsBlock } from "@/components/DirectionsBlock";
import { RelatedStrip } from "@/components/RelatedStrip";
import { siteConfig } from "@/config/siteConfig";
import { breadcrumbSchema } from "@/lib/jsonld";

function VisitPage() {
  return (
    <div className="min-h-screen bg-ink text-bone">
      <Nav onBook={() => {}} />
      <Breadcrumbs trail={[{ name: "Home", path: "/" }, { name: "Visit", path: "/visit" }]} />
      <main id="main" className="container-wss pb-16">
        <header className="pt-4 pb-10 max-w-3xl">
          <h1 className="text-5xl md:text-6xl font-bold leading-[1.02] mb-4">
            Visit the <span className="italic text-signal">studio.</span>
          </h1>
          <p className="text-lg text-fadetext leading-relaxed">
            {siteConfig.studioName} is a private appointment-only tattoo studio in {siteConfig.neighborhood} — {siteConfig.landmarks}
          </p>
        </header>

        <section className="grid lg:grid-cols-[1.3fr_0.7fr] gap-8 mb-16">
          <MapEmbed />
          <div className="grid gap-5">
            <div className="glass p-6">
              <div className="flex items-start gap-3 mb-2">
                <MapPin size={18} className="text-signal shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-fadetext">Address</div>
                  <div className="font-display font-semibold">{siteConfig.addressLine1}</div>
                  <div className="text-sm text-fadetext">
                    {siteConfig.addressLocality}, {siteConfig.addressRegion} {siteConfig.postalCode}
                  </div>
                </div>
              </div>
            </div>
            <div className="glass p-6">
              <div className="flex items-start gap-3">
                <Clock size={18} className="text-signal shrink-0 mt-0.5" />
                <div className="grid gap-1 text-sm w-full">
                  <div className="text-[10px] uppercase tracking-widest text-fadetext mb-1">Hours</div>
                  {siteConfig.hours.map((h) => (
                    <div key={h.day} className="flex justify-between">
                      <span>{h.day}</span>
                      <span className="text-fadetext tabular-nums">
                        {h.open} – {h.close}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-fadetext/60 mt-1">
                    <span>Sun / Mon</span>
                    <span>Closed</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="glass p-6 grid gap-3 text-sm">
              <a href={`tel:${siteConfig.phoneTel}`} className="flex items-center gap-3 hover:text-signal transition">
                <Phone size={16} className="text-signal" /> {siteConfig.phone}
              </a>
              <a href={`mailto:${siteConfig.email}`} className="flex items-center gap-3 hover:text-signal transition">
                <Mail size={16} className="text-signal" /> {siteConfig.email}
              </a>
              <a
                href={siteConfig.instagram}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 hover:text-signal transition"
              >
                <Instagram size={16} className="text-signal" /> {siteConfig.instagramHandle}
              </a>
            </div>
          </div>
        </section>

        <section className="mb-16">
          <div className="section-label mb-4">Directions</div>
          <p className="text-fadetext max-w-2xl mb-5">Open in your favorite maps app.</p>
          <DirectionsBlock />
        </section>

        <section className="grid md:grid-cols-2 gap-6 mb-16">
          <div className="glass p-8">
            <div className="flex items-center gap-3 mb-3">
              <Car size={18} className="text-signal" />
              <div className="section-label">Parking</div>
            </div>
            <p className="text-fadetext">{siteConfig.parking}</p>
          </div>
          <div className="glass p-8">
            <div className="flex items-center gap-3 mb-3">
              <Train size={18} className="text-signal" />
              <div className="section-label">Transit</div>
            </div>
            <p className="text-fadetext">{siteConfig.transit}</p>
          </div>
        </section>

        <section className="mb-16">
          <div className="section-label mb-4">Areas Served</div>
          <div className="flex flex-wrap gap-2">
            {siteConfig.areasServed.map((a) => (
              <span key={a} className="tag">{a}</span>
            ))}
          </div>
        </section>

        <section className="glass p-10 text-center">
          <h2 className="text-3xl font-display font-bold mb-3">Book your session</h2>
          <p className="text-fadetext mb-6 max-w-md mx-auto">
            Private, appointment-only — every session is planned before you walk in.
          </p>
          <Link
            to="/"
            hash="booking"
            className="inline-flex items-center gap-2 bg-signal text-ink font-semibold px-7 py-3.5 rounded-full emboss"
          >
            Start your request →
          </Link>
        </section>
      </main>

      <RelatedStrip
        items={[
          { title: "Artist", blurb: `Meet ${siteConfig.artistName.split(" ")[0]} and see credentials.`, to: "/artist" },
          { title: "Process", blurb: "How booking, deposits, and pricing work.", to: "/process" },
          { title: "FAQ", blurb: "Cover-ups, walk-ins, healing, and more.", to: "/faq" },
        ]}
      />
      <Footer />
    </div>
  );
}

const title = `Visit — ${siteConfig.studioName} | ${siteConfig.addressLine1}, ${siteConfig.city}`;
const description = `${siteConfig.studioName} is at ${siteConfig.address}. Hours, directions, parking, and transit for the East Austin private tattoo studio.`;

export const Route = createFileRoute("/visit")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: `${siteConfig.siteUrl}/visit` },
    ],
    links: [{ rel: "canonical", href: `${siteConfig.siteUrl}/visit` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Visit", path: "/visit" }]),
        ),
      },
    ],
  }),
  component: VisitPage,
});
