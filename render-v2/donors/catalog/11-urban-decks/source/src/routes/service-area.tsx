import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, ClosingBand } from "./services";
const projectModern = CLIENT.hero.poster;
import { MapPin } from "lucide-react";
import { SITE, CITY_DETAILS, CITY_SLUGS } from "@/lib/site";
import { LocationMap } from "@/components/site/LocationMap";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/service-area")({
  head: () =>
    pageHead({
      title: "Service area · " + SITE.name,
      description: SITE.shortDescription,
      path: "/service-area",
    }),
  component: ServiceAreaPage,
});

function ServiceAreaPage() {
  return (
    <>
      <PageHero
        eyebrow="Service Area"
        title={<>Service area</>}
        intro={SITE.serviceArea.join(" · ")}
        image={projectModern}
      />

      <section className="section bg-background">
        <div className="mx-auto max-w-5xl px-5 md:px-8">
          <p className="eyebrow text-cedar">Communities we serve</p>
          <h2 className="mt-3 font-display text-3xl md:text-5xl text-ink leading-tight">
            {SITE.city}, {SITE.region}
          </h2>
          {PLAN.content?.['service-area'] && <p className="mt-5 text-ink/75 leading-relaxed">{PLAN.content['service-area']}</p>}
          <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CITY_SLUGS.map((slug) => {
              const c = CITY_DETAILS[slug];
              return (
                <li
                  key={slug}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4"
                >
                  <MapPin className="h-4 w-4 text-cedar shrink-0" />
                  <span className="font-medium text-ink"><Link to="/service-area/$city" params={{city:slug}}>{c.city}</Link></span>
                </li>
              );
            })}
          </ul>
          <p className="mt-8 text-sm text-ink/65">
            Not sure if your address is in our service range? Just{" "}
            <Link to="/contact" className="underline decoration-cedar underline-offset-4">
              call us
            </Link>{" "}
            to ask.
          </p>
        </div>
      </section>

      <LocationMap />

      <ClosingBand />
    </>
  );
}
