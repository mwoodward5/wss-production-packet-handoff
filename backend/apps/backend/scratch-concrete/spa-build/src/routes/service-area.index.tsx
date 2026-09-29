import { createFileRoute, Link } from "@tanstack/react-router";
import { MapPin, ArrowRight } from "lucide-react";
import heroImg from "@/assets/service-area.webp";
import { CallButton } from "@/components/CallButton";
import { CityChips } from "@/components/CityChips";
import { SectionHeading } from "@/components/SectionHeading";
import { breadcrumbLd, jsonLd } from "@/lib/schema";
import { useLiveAreas, useLiveIdentity, useMapEmbedUrl, slugify } from "@/lib/wssc";

export const Route = createFileRoute("/service-area/")({
  head: () => ({
    meta: [
      { title: "Service Area — {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      {
        name: "description",
        content:
          "Concrete and general contracting coverage around {{CITY}}, {{STATE}}. Confirm your address at quote time — every request gets a straight yes or no in writing.",
      },
      { property: "og:title", content: "Service Area — {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      { property: "og:description", content: "Coverage around {{CITY}}, {{STATE}} and the surrounding area." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/service-area" }],
    scripts: [jsonLd(breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "Service Area", path: "/service-area" },
    ]))],
  }),
  component: ServiceAreaPage,
});

function ServiceAreaPage() {
  const areas = useLiveAreas();
  const id = useLiveIdentity();
  const mapUrl = useMapEmbedUrl();

  return (
    <>
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div className="absolute inset-0 opacity-40">
          <img src={heroImg} alt="Service area coverage" className="h-full w-full object-cover" loading="eager" />
          <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/80 to-primary/40" />
          <div className="absolute inset-0 bg-mesh-animated opacity-50" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-28">
          <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-tight md:text-6xl">
            One base in {"{{CITY}}"}. <span className="text-gold">Work across the surrounding area.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-primary-foreground/85">
            Coverage for concrete, foundations, flatwork, and demolition is confirmed with your address at quote
            time — every request gets a straight answer in writing.
          </p>
          <div className="mt-7"><CallButton variant="gold" location="hero-service-area" className="cta-conic" /></div>
        </div>
      </section>

      {/* THE AREAS GRID — the areas content slot, rendered by this donor */}
      <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
        <SectionHeading
          eyebrow="Where We Work"
          title={areas.length > 1 ? `${areas.length} areas served from {{CITY}}.` : "Serving {{CITY}} and the surrounding area."}
          subtitle="Send your address with the request and coverage gets confirmed in writing."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {areas.map((name) => (
            <Link
              key={name}
              to="/service-area"
              hash={slugify(name)}
              className="group rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-1 hover:border-gold hover:shadow-elegant"
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground">
                <MapPin className="h-4 w-4" />
              </div>
              <h2 className="font-display text-xl font-semibold">Concrete contracting in {name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">Foundations, flatwork, driveways, demolition and renovation — confirmed by address.</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                See coverage <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-secondary py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <div className="overflow-hidden rounded-3xl border border-border shadow-elegant">
            {mapUrl ? (
              <iframe
                src={mapUrl}
                width="100%"
                height="500"
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title={"{{BUSINESS_NAME}} service area map"}
              />
            ) : (
              <div className="grid h-[500px] place-items-center bg-mesh-animated text-sm text-muted-foreground">
                Service area map
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 lg:px-6">
        <SectionHeading
          eyebrow="Coverage"
          title="One crew, one standard, wherever the address is."
        />
        <div data-speakable className="mt-6 space-y-5 text-lg leading-relaxed text-foreground">
          <p>
            {"{{BUSINESS_NAME}}"} works out of {"{{CITY}}"}, {"{{STATE}}"}, taking on concrete and general
            contracting projects across the surrounding area. The full list of communities served is what you
            see above — and it is the same list the quote team checks, so an address question gets answered in
            writing, not guessed at.
          </p>
          <p>
            All of the service lines are available across the coverage area:{" "}
            <Link to="/commercial-concrete" className="font-semibold text-foreground underline-offset-4 hover:underline">commercial concrete (slabs, ADA ramps, parking pads)</Link>,{" "}
            <Link to="/foundations-excavation" className="font-semibold text-foreground underline-offset-4 hover:underline">foundations and excavation</Link>,{" "}
            <Link to="/flatwork-driveways" className="font-semibold text-foreground underline-offset-4 hover:underline">flatwork and driveways</Link>, and{" "}
            <Link to="/concrete-demolition" className="font-semibold text-foreground underline-offset-4 hover:underline">concrete demolition with haul-off</Link>.
            Same written quotes, same spec, same crew standard everywhere the work runs.
          </p>
        </div>

        <SectionHeading eyebrow="Why it matters" title="A local crew answers the phone after the pour." />
        <div className="mt-6 space-y-5 text-lg leading-relaxed text-foreground">
          <p>
            Local means the crew that poured the work is the crew that stands behind it — close enough to walk
            the job again if anything needs a second look, and accountable to the same community the work
            lives in.
          </p>
          <p>
            If you would rather skip the coverage question and just talk, the fastest path is the{" "}
            <Link to="/contact" className="font-semibold text-foreground underline-offset-4 hover:underline">contact page</Link>
            {" "}or the estimate form. Tell us where the project is, roughly what the scope is, and when you
            would like to start.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 text-center lg:px-6">
        <h2 className="font-display text-3xl font-semibold md:text-4xl">Don't see your area?</h2>
        <p className="mt-3 text-muted-foreground">Send the address — coverage gets confirmed in writing, either way.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <CallButton variant="gold" location="service-area-bottom" />
          <Link to="/contact" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold">Get a Quote</Link>
        </div>
        <div className="mt-8 flex justify-center"><CityChips /></div>
      </section>
    </>
  );
}
