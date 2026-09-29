import { routeHead } from "@/lib/wss-route-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";
import { CITIES, VERIFIED_GOOGLE_MAPS_SHARE } from "@/lib/cities";
import { PageHeader } from "@/components/site/PageHeader";
import { CtaBanner } from "@/components/site/CtaBanner";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { MapPin, ArrowUpRight, Navigation } from "lucide-react";
import { clientPhoto } from "@/lib/wss-client";
import { MAP_URL, MAP_EMBED, pageCopy } from "@/lib/wss-location";
import { RichText } from "@/components/site/RichText";

const DIRECTIONS_URL = MAP_URL;

export const Route = createFileRoute("/service-area")({
  head: () => routeHead("Service Area"),
  component: ServiceArea,
});

function ServiceArea() {
  return (
    <>
      <PageHeader
        eyebrow="Where We Work"
        title={`Service area · ${BUSINESS.name}`}
        intro={BUSINESS.serviceArea}
        image={clientPhoto("hero")}
      />

      <Breadcrumbs
        items={[
          { label: "Home", to: "/" },
          { label: "Service Area" },
        ]}
      />

      <section className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:grid-cols-12 md:px-8">
        {(MAP_URL || MAP_EMBED) && <div className="md:col-span-7">
          {MAP_EMBED && <div className="relative overflow-hidden rounded-2xl border border-border bg-secondary aspect-[4/3]">
            <iframe
              title={`Service area map for ${BUSINESS.name}`}
              src={MAP_EMBED}
              loading="lazy"
              className="h-full w-full"
            />
          </div>}
          <div className="mt-3 flex flex-wrap gap-2">
            {MAP_URL && <a
              href={VERIFIED_GOOGLE_MAPS_SHARE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-4 py-2 text-xs font-semibold text-[var(--ink)]"
            >
              <Navigation className="h-3.5 w-3.5" /> View service area
            </a>}
            {MAP_URL && <a
              href={DIRECTIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground"
            >
              Get Directions <ArrowUpRight className="h-3.5 w-3.5" />
            </a>}
          </div>
        </div>}

        <div className="md:col-span-5">
          <div className="eyebrow">Cities & Communities</div>
          <h2 className="display mt-2 text-3xl">Service area</h2>
          {pageCopy("service-area") && <RichText text={pageCopy("service-area")} />}
          <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CITIES.map((c) => (
              <li key={c.slug}>
                <Link to="/service-areas/$city" params={{city:c.slug}}
                  className="group flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm hover:bg-secondary"
                >
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-[var(--gold)]" /> {c.city}, {c.state}
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-foreground/40 group-hover:text-[var(--gold)]" />
                </Link>
              </li>
            ))}
            {BUSINESS.primaryServiceAreas
              .filter((c) => !CITIES.some((cc) => cc.city === c))
              .map((c) => (
                <li
                  key={c}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm"
                >
                  <MapPin className="h-4 w-4 text-[var(--gold)]" /> {c}
                </li>
              ))}
          </ul>
          <Link
            to="/contact"
            className="mt-8 inline-flex rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background"
          >
            Check if we cover your address →
          </Link>
        </div>
      </section>

      <CtaBanner />
    </>
  );
}
