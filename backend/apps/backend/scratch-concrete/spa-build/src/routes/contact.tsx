import { createFileRoute, Link } from "@tanstack/react-router";

import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { CallButton } from "@/components/CallButton";
import { ContactForm } from "@/components/ContactForm";
import { QuoteEstimator } from "@/components/QuoteEstimator";
import { SectionHeading } from "@/components/SectionHeading";
import { breadcrumbLd, jsonLd } from "@/lib/schema";
import { useLiveHours, useLiveIdentity, useMapEmbedUrl } from "@/lib/wssc";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact {{BUSINESS_NAME}} — Concrete Quote in {{CITY}}, {{STATE}}" },
      {
        name: "description",
        content:
          "Request a written concrete quote.[[NEED:PHONE]] Call {{PHONE}}.[[/NEED]][[NEED:!PHONE]] Use the estimate form.[[/NEED]] {{BUSINESS_NAME}} — concrete and general contracting in {{CITY}}, {{STATE}}.",
      },
      { property: "og:title", content: "Contact {{BUSINESS_NAME}} — {{CITY}}, {{STATE}}" },
      { property: "og:description", content: "Request a written quote for concrete and general contracting work." },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/contact" }],
    scripts: [jsonLd(breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "Contact", path: "/contact" },
    ]))],
  }),
  component: ContactPage,
});

function ContactPage() {
  const id = useLiveIdentity();
  const hours = useLiveHours();
  const mapUrl = useMapEmbedUrl();

  const cards: { icon: typeof Phone; label: string; value: string; href?: string }[] = [];
  if (id.phone) {
    const digits = id.phoneDigits.replace(/\D/g, "").replace(/^1/, "");
    cards.push({ icon: Phone, label: "Call", value: id.phone, href: digits ? `tel:+1${digits}` : `tel:${id.phone}` });
  }
  if (id.email) cards.push({ icon: Mail, label: "Email", value: id.email, href: `mailto:${id.email}` });
  cards.push({ icon: MapPin, label: "Based in", value: "{{CITY}}, {{STATE}}" });
  if (hours.length > 0) cards.push({ icon: Clock, label: "Hours", value: hours.join(" · ") });

  return (
    <>
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div className="absolute inset-0 bg-mesh-animated opacity-50" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-24">
          <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-tight md:text-6xl">
            Get a written quote.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-primary-foreground/85">
            {"[[NEED:PHONE]]Call, fill the form,[[/NEED]][[NEED:!PHONE]]Fill the form,[[/NEED]] or use the 4-step quote estimator — every path ends in a written response with next steps."}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <CallButton variant="gold" location="hero-contact" />
            {id.email && (
              <a href={`mailto:${id.email}`} className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/15">
                <Mail className="h-4 w-4" /> {id.email}
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => {
            const Inner = (
              <>
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground">
                  <c.icon className="h-5 w-5" />
                </div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
                <div className="mt-1 font-display text-base font-semibold break-words">{c.value}</div>
              </>
            );
            return c.href ? (
              <a key={c.label} href={c.href} className="rounded-2xl border border-border bg-card p-5 shadow-card transition-all hover:-translate-y-1 hover:shadow-elegant">
                {Inner}
              </a>
            ) : (
              <div key={c.label} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                {Inner}
              </div>
            );
          })}
        </div>
      </section>

      <section id="estimate" className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Quote Estimator" title="Get a tailored quote in 4 quick steps." />
            <div className="mt-6"><QuoteEstimator /></div>
          </div>
          <div>
            <SectionHeading eyebrow="Send a Message" title="Or share your project details directly." />
            <div className="mt-6"><ContactForm /></div>
          </div>
        </div>
      </section>

      <section className="bg-secondary py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionHeading eyebrow="Find Us" title={"{{CITY}}, {{STATE}}"} />
          <div className="mt-8 overflow-hidden rounded-3xl border border-border shadow-elegant">
            {mapUrl ? (
              <iframe
                src={mapUrl}
                width="100%"
                height="450"
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title={"{{BUSINESS_NAME}} location"}
              />
            ) : (
              <div className="grid h-[450px] place-items-center bg-mesh-animated text-sm text-muted-foreground">
                Location map
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 lg:px-6">
        <SectionHeading eyebrow="What happens next" title="From your message to a written quote." />
        <div className="mt-6 space-y-5 text-lg leading-relaxed text-muted-foreground">
          <p>
            When you send a message through the form above, here's exactly what happens. Your request is
            reviewed, and the response comes back in writing with a few clarifying questions and the next step —
            usually a site visit. The visit takes 20 to 45 minutes depending on scope: the area gets walked,
            measured, and photographed, the spec gets talked through, and anything that will drive cost (access,
            demo, sub-grade, reinforcement requirements) gets flagged on the spot.
          </p>
          <p>
            After the visit you receive an <strong className="text-foreground">itemized written quote</strong> —
            concrete PSI, slab thickness, reinforcement grade and spacing, sub-base prep, finish, joint plan, and
            haul-off each spelled out as separate line items. No one-line lump sums. If you're comparing against
            a cheaper bid, you'll be able to see exactly where the difference is.
          </p>
          <p>
            If you accept the quote, the work gets scheduled and the schedule is shared in writing — permits,
            inspections, pour day, and cure window all coordinated with your other trades. After the job, the
            finished work gets walked with you, and the same point of contact stays reachable.
          </p>
        </div>

        <SectionHeading eyebrow="What to have ready" title="A few details speed everything up." />
        <ul className="mt-6 grid gap-3 md:grid-cols-2">
          {[
            "City and rough address (so coverage and logistics can be confirmed)",
            "Project type — driveway, patio, slab, foundation, demo, ADA ramp",
            "Approximate square footage or dimensions",
            "Any existing concrete that needs demolition first",
            "Timing — ASAP, this month, this quarter, or planning ahead",
            "Whether engineered drawings exist (commercial / structural)",
            "Site access — alley, gate width, overhead clearance for trucks",
            "Photos of the area (huge help on first call)",
          ].map((b) => (
            <li key={b} className="rounded-2xl border border-border bg-card p-4 text-sm shadow-card">{b}</li>
          ))}
        </ul>

        <SectionHeading eyebrow="Contact FAQ" title="Quick answers before you reach out." />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            { q: "Are quotes itemized?", a: "Yes. Every quote is itemized and in writing — concrete, prep, reinforcement, finish, and haul-off as separate lines, so you can compare bids scope against scope." },
            { q: "How fast do you respond?", a: "Requests are reviewed every business day, and the response comes in writing with next steps." },
            { q: "Do you need plans to quote?", a: "Stamped engineered drawings help on commercial and structural work. For residential driveways, patios, and small slabs, measurements and a site walk are enough." },
            { q: "Is there a minimum job size?", a: "Small slabs and repairs are quoted like any other scope — mobilization may be its own line on very small jobs." },
            { q: "What about payment terms?", a: "Terms are stated in the written quote before any work is agreed — nothing about payment is improvised on site." },
          ].map((f) => (
            <div key={f.q} data-speakable className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h3 className="font-display text-base font-semibold">{f.q}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <Link to="/service-area" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold">
            See the service area
          </Link>
        </div>
      </section>
    </>
  );
}
