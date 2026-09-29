import { createFileRoute, Link } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ProcessSection } from "@/components/ProcessSection";
import { RelatedStrip } from "@/components/RelatedStrip";
import { WaitlistForm } from "@/components/WaitlistForm";
import { siteConfig } from "@/config/siteConfig";
import { breadcrumbSchema } from "@/lib/jsonld";

const lastUpdated = "August 2026";

function ProcessPage() {
  return (
    <div className="min-h-screen bg-ink text-bone">
      <Nav onBook={() => {}} />
      <Breadcrumbs trail={[{ name: "Home", path: "/" }, { name: "Process", path: "/process" }]} />
      <main id="main" className="container-wss pb-16">
        <header className="pt-4 pb-10 max-w-3xl">
          <h1 className="text-5xl md:text-6xl font-bold leading-[1.02] mb-4">
            How booking <span className="italic text-signal">actually works.</span>
          </h1>
          <p className="text-lg text-fadetext leading-relaxed">
            Every project runs the same four steps. No mystery, no upsells, no scheduling ping-pong. Deposit is $150 and applies to your final cost.
          </p>
          <p className="text-xs text-fadetext mt-3">Last updated {lastUpdated}</p>
        </header>

        <ProcessSection />

        <section className="mt-24 mb-20">
          <div className="section-label mb-4">Pricing bands</div>
          <h2 className="text-3xl font-display font-bold mb-6">
            What does a tattoo cost in {siteConfig.city}?
          </h2>
          <p className="text-fadetext max-w-2xl mb-6 faq-answer">
            Every quote is set after {siteConfig.artistName.split(" ")[0]} reviews your concept. These are starting ranges — the actual number depends on placement, complexity, and session length. Studio minimum is {siteConfig.pricing.minimum} and the hourly rate is {siteConfig.pricing.hourly}.
          </p>
          <div className="glass overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-line">
                <tr>
                  <th className="text-left px-6 py-4 font-display font-semibold">Size</th>
                  <th className="text-left px-6 py-4 font-display font-semibold">Starting range</th>
                </tr>
              </thead>
              <tbody>
                {siteConfig.pricingBands.map((b) => (
                  <tr key={b.size} className="border-b border-line/50 last:border-0">
                    <td className="px-6 py-4 text-bone">{b.size}</td>
                    <td className="px-6 py-4 text-signal font-semibold">{b.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-20">
          <div className="section-label mb-4">Services</div>
          <div className="grid md:grid-cols-2 gap-4">
            {siteConfig.services.map((s) => (
              <div key={s.slug} className="glass p-6">
                <div className="flex items-baseline justify-between gap-4 mb-2">
                  <h3 className="font-display font-semibold text-lg">{s.name}</h3>
                  <span className="text-signal text-sm font-semibold whitespace-nowrap">{s.startingAt}</span>
                </div>
                <p className="text-sm text-fadetext">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-6 mb-20">
          <div className="glass p-8">
            <div className="section-label mb-4">Studio Policies</div>
            <ul className="space-y-3 text-sm">
              {siteConfig.policies.map((p) => (
                <li key={p} className="flex gap-3">
                  <span className="text-signal">✦</span>
                  <span className="text-fadetext">{p}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="glass p-8">
            <div className="section-label mb-4">Aftercare</div>
            <ul className="space-y-3 text-sm">
              {siteConfig.aftercare.map((a) => (
                <li key={a} className="flex gap-3">
                  <span className="text-signal">✦</span>
                  <span className="text-fadetext">{a}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-fadetext mt-6 pt-4 border-t border-line/50">
              Free touch-ups for settling or fade within 90 days of your original session. Just email {siteConfig.email} with a photo.
            </p>
          </div>
        </section>

        <section className="mb-20">
          <WaitlistForm />
        </section>

        <section className="glass p-10 text-center">
          <h2 className="text-3xl font-display font-bold mb-3">Ready to send a request?</h2>
          <p className="text-fadetext mb-6 max-w-md mx-auto">
            The more specific your first message, the faster {siteConfig.artistName.split(" ")[0]} can quote and schedule.
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
          { title: "FAQ", blurb: "20+ answers on cost, cover-ups, healing.", to: "/faq" },
          { title: "Portfolio", blurb: "Recent custom work across all styles.", to: "/portfolio" },
          { title: "Visit", blurb: "Location, hours, and directions.", to: "/visit" },
        ]}
      />
      <Footer />
    </div>
  );
}

const title = `Pricing, Deposits & Aftercare — ${siteConfig.studioName}`;
const description = `How tattoo booking works at ${siteConfig.studioName}: $150 deposit, ${siteConfig.pricing.hourly}, session bands, and free 90-day touch-ups.`;

export const Route = createFileRoute("/process")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: `${siteConfig.siteUrl}/process` },
    ],
    links: [{ rel: "canonical", href: `${siteConfig.siteUrl}/process` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Process", path: "/process" }]),
        ),
      },
    ],
  }),
  component: ProcessPage,
});
