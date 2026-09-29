import { MapPin, Phone, ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { CLIENT } from "@/lib/wss";
import { SITE } from "@/lib/site";

type Props = {
  /** Optional eyebrow override */
  eyebrow?: string;
  /** Optional heading override */
  heading?: string;
  /** Optional sub-copy */
  copy?: string;
};

export function LocationMap({
  eyebrow = "Where we work",
  heading = SITE.city + ", " + SITE.region,
  copy = SITE.serviceArea.join(" · "),
}: Props) {
  if (!CLIENT.trust.mapUrl) return null;
  return (
    <section className="section bg-background border-t border-border" aria-labelledby="location-map-heading">
      <div className="mx-auto max-w-7xl px-5 md:px-8 grid gap-10 lg:grid-cols-12 lg:gap-12 items-start">
        <div className="lg:col-span-5">
          <p className="eyebrow text-cedar">{eyebrow}</p>
          <h2 id="location-map-heading" className="mt-3 font-display text-3xl md:text-4xl text-ink leading-tight">
            {heading}
          </h2>
          <p className="mt-4 text-ink/75 max-w-prose">{copy}</p>

          <ul className="mt-7 space-y-4 text-sm">
            <li className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 text-cedar shrink-0" aria-hidden />
              <div>
                <div className="font-semibold text-ink">{SITE.city}, {SITE.region}</div>
                <div className="text-ink/70">{SITE.serviceArea.join(" · ")}</div>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <Phone className="mt-0.5 h-4 w-4 text-cedar shrink-0" aria-hidden />
              <div>
                <a href={SITE.phoneHref} className="font-semibold text-ink hover:text-cedar">
                  {SITE.phone}
                </a>
                <div className="text-ink/70">{SITE.hoursNote}</div>
              </div>
            </li>
          </ul>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-full bg-cedar px-6 py-3 text-sm font-semibold text-cream btn-magnetic shadow-cedar"
            >
              Contact
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={SITE.phoneHref}
              className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-3 text-sm font-medium text-ink hover:border-cedar/60"
            >
              <Phone className="h-4 w-4" />
              {SITE.phone}
            </a>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-cedar">
            <div className="aspect-[16/11] w-full">
              {CLIENT.trust.mapUrl && <a href={CLIENT.trust.mapUrl} rel="noreferrer" className="flex h-full items-center justify-center text-cedar">View location and directions</a>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-3">
              <div className="text-xs uppercase tracking-[0.18em] text-ink/60">
                {SITE.city}, {SITE.region}
              </div>
              <Link
                to="/contact"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cedar hover:text-cedar/80"
              >
                Confirm your address
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
