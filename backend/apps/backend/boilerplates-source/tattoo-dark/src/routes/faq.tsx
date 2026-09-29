import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RelatedStrip } from "@/components/RelatedStrip";
import { siteConfig } from "@/config/siteConfig";
import { breadcrumbSchema, faqSchema } from "@/lib/jsonld";

const lastUpdated = "August 2026";

function FaqPage() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="min-h-screen bg-ink text-bone">
      <Nav onBook={() => {}} />
      <Breadcrumbs trail={[{ name: "Home", path: "/" }, { name: "FAQ", path: "/faq" }]} />
      <main id="main" className="container-wss pb-16">
        <header className="pt-4 pb-10 max-w-3xl">
          <h1 className="text-5xl md:text-6xl font-bold leading-[1.02] mb-4">
            Every question <span className="italic text-signal">most clients ask.</span>
          </h1>
          <p className="text-lg text-fadetext leading-relaxed">
            Pricing, healing, cover-ups, cancellation, parking, allergies — all of it, in {siteConfig.artistName}'s own words. Missing something? Email {siteConfig.email}.
          </p>
          <p className="text-xs text-fadetext mt-3">Last updated {lastUpdated}</p>
        </header>

        <div className="max-w-3xl grid gap-3">
          {siteConfig.faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q} id={`faq-${i}`} className="glass overflow-hidden">
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-start justify-between gap-6 text-left px-6 py-5"
                  aria-expanded={isOpen}
                >
                  <h2 className="font-display font-semibold text-lg leading-tight">{f.q}</h2>
                  <ChevronDown
                    size={20}
                    className={`shrink-0 mt-1 transition ${isOpen ? "rotate-180 text-signal" : "text-fadetext"}`}
                  />
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="faq-answer px-6 pb-6 text-fadetext leading-relaxed">{f.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <section className="glass p-10 text-center mt-20 max-w-3xl">
          <h2 className="text-2xl font-display font-bold mb-3">Still have a question?</h2>
          <p className="text-fadetext mb-6">
            Chat with the studio assistant on the bottom-right of the page — it knows {siteConfig.artistName}'s pricing, styles, and policies. Or start a full request.
          </p>
          <Link
            to="/"
            hash="booking"
            className="inline-flex items-center gap-2 bg-signal text-ink font-semibold px-7 py-3.5 rounded-full emboss"
          >
            Start a request →
          </Link>
        </section>
      </main>

      <RelatedStrip
        items={[
          { title: "Process", blurb: "Booking steps, pricing, aftercare.", to: "/process" },
          { title: "Visit", blurb: "Location, hours, parking.", to: "/visit" },
          { title: "Artist", blurb: `Meet ${siteConfig.artistName.split(" ")[0]} and see credentials.`, to: "/artist" },
        ]}
      />
      <Footer />
    </div>
  );
}

const title = `Tattoo FAQ — ${siteConfig.studioName} | ${siteConfig.city}`;
const description = `Answers on cost, walk-ins, cover-ups, healing, cancellation, and more from ${siteConfig.artistName} at ${siteConfig.studioName}.`;

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: `${siteConfig.siteUrl}/faq` },
    ],
    links: [{ rel: "canonical", href: `${siteConfig.siteUrl}/faq` }],
    scripts: [
      { type: "application/ld+json", children: JSON.stringify(faqSchema()) },
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "FAQ", path: "/faq" }]),
        ),
      },
    ],
  }),
  component: FaqPage,
});
