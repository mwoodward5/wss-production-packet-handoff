import {site,plan} from "@/lib/wss";
import { business } from "@/lib/business";

/**
 * Truthful, no-API-key map module.
 * Renders an OpenStreetMap embed centered on the verified service-area
 * midpoint (Genoa, OH 43430 — business.lat/lng) with a clear "Get Directions"
 * CTA that hands off to Google Maps.
 *
 * NAP and copy intentionally match the LocalBusiness JSON-LD in Schema.tsx
 * (city/state/zip from src/lib/business.ts) — we do NOT publish a street
 * address because the business is owner-operated out of a private residence
 * and only the locality is publicly verified.
 */
export function LocationMap({
  heading = "Location",
  eyebrow = "[ Map · Service area ]",
  intro,
  className = "",
}: {
  heading?: string;
  eyebrow?: string;
  intro?: string;
  className?: string;
}) {
  const {city,state,phone,phoneTel}=business;
 const geo=plan.localPresence?.mapAndDirections?.geo;
 if (!geo?.verified || typeof geo.lat!=="number" || typeof geo.lng!=="number" || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng) || Math.abs(geo.lat)>90 || Math.abs(geo.lng)>180) return null;
 const {lat,lng}=geo;

  // ~25mi bounding box around Genoa centroid (covers full served area).
  const dLat=0.02; // Viewport only, never a coverage claim. // ~25 miles N/S
  const dLng=0.02; // ~25 miles E/W at 41.5°N
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(",");
  const osmEmbed =
    `https://www.openstreetmap.org/export/embed.html` +
    `?bbox=${encodeURIComponent(bbox)}` +
    `&layer=mapnik` +
    `&marker=${lat},${lng}`;
  const osmView = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=10/${lat}/${lng}`;
  const directionsHref = site.trust.mapUrl || `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  return (
    <section className={`border-y border-rule bg-bone py-16 lg:py-20 ${className}`}>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
        <div className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="mt-3 font-display text-3xl leading-tight text-ink lg:text-4xl">
              {heading}
            </h2>
            {intro ? (
              <p className="mt-4 max-w-xl text-charcoal/80">{intro}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              Get directions →
            </a>
            <a href={`tel:${phoneTel}`} className="btn-ghost">
              ☎ {phone}
            </a>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="overflow-hidden border border-rule bg-cream">
              <iframe
                title={`Map of ${city}, ${state}`}
                src={osmEmbed}
                width="100%"
                height="420"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="block h-[320px] w-full sm:h-[420px]"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-charcoal/60">
                <span>
                  ▲ Centered on {city}, {state} 
                </span>
                <a
                  href={osmView}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-underline text-charcoal/70"
                >
                  View larger map ↗
                </a>
              </div>
            </div>
          </div>

          <aside className="lg:col-span-4">
            <div className="border border-rule bg-cream p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
                [ Based in ]
              </p>
              <p className="mt-2 font-display text-2xl text-ink">
                {city}, {state} 
              </p>
              <p className="mt-1 text-sm text-charcoal/70"></p>

              <hr className="my-5 border-rule" />
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
                [ Coverage ]
              </p>
              <p className="mt-2 text-sm text-charcoal/80">{site.trust.areas.join(" · ")}</p>

              <hr className="my-5 border-rule" />
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
                [ Direct line ]
              </p>
              <a
                href={`tel:${phoneTel}`}
                className="mt-2 block font-display text-xl text-ink link-underline"
              >
                {phone}
              </a>
              <p className="mt-3 text-xs text-charcoal/60"></p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
