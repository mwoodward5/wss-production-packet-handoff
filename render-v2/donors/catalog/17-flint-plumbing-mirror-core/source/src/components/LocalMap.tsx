/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: near-me map, lat/lng pin caption, and the
 * │ Google / Apple / Waze directions deep links.
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client.
 * │ WHAT THE ENGINE FEEDS IT:
 * │   trustConfig.location.primary.geo.lat/lng <- Places Details location.latitude/longitude
 * │   trustConfig.location.primary.street/city/region/postal <- Places addressComponents
 * │   trustConfig.location.primary.mapUrl      <- Places googleMapsUri (or dir/?api=1&destination=)
 * │   trustConfig.location.serviceAreas[]      <- Firecrawl scrape of the site's service-area page
 * │   clientConfig.maps.zoom                   <- leave default unless rural
 * │ IF YOU CANNOT SOURCE geo: delete it — the map and directions row vanish
 * │ cleanly, and no other widget breaks.
 * │ FULL SPEC: MIRRORING-ENGINE.md §Geo and directions
 * └──────────────────────────────────────────────────────────────────────────
 */
import * as React from "react";

import { clientConfig } from "@/client.config";
import { trustConfig } from "@/trust.config";
import { clientData, sitePlan } from "@/wss-bridge";

/**
 * Geo-pinned coverage map. Uses the Google Maps browser key from the connector
 * when present (real pin at the exact lat/lng), and falls back to the keyless
 * embed otherwise. Every location renders its lat/lng and full directions
 * deep links for Apple Maps, Google Maps and Waze.
 */
export function LocalMap() {
  const geo = sitePlan?.localPresence?.mapAndDirections?.geo;
  const verified = geo?.verified === true && geo.schemaAllowed === true && typeof geo.lat === 'number' && typeof geo.lng === 'number' && Math.abs(geo.lat) <= 90 && Math.abs(geo.lng) <= 180;
  const mapUrl = clientData.trust.mapUrl;
  if (!verified) return mapUrl ? <div className="glass-panel rounded-3xl p-6"><a className="rounded-full border border-border px-5 py-3" href={mapUrl}>View map and directions</a></div> : null;
  const active = { id: 'primary', label: clientData.identity.businessName, city: clientData.identity.city, region: clientData.identity.state, street: '', postal: '', geo: { lat: geo!.lat!, lng: geo!.lng! } };
  const locs = [active];
  const setActiveId = (_id: string) => {};
  const coordinates = `${active.geo.lat},${active.geo.lng}`;
  const links = { google: `https://www.google.com/maps/dir/?api=1&destination=${coordinates}`, apple: `https://maps.apple.com/?daddr=${coordinates}`, waze: `https://waze.com/ul?ll=${coordinates}&navigate=yes` };
  const embedSrc = `https://www.google.com/maps?q=${coordinates}&output=embed`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(260px,0.8fr)_1.2fr]">
      <div className="glass-panel rounded-3xl p-6">
        {locs.length > 1 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {locs.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setActiveId(l.id)}
                aria-pressed={l.id === active.id}
                className={
                  "rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition-colors " +
                  (l.id === active.id
                    ? "border-mint text-mint"
                    : "border-border text-muted-foreground hover:text-cream")
                }
              >
                {l.label}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-mint">Location</p>
        <address className="mt-3 not-italic leading-relaxed text-cream">
          <strong className="font-[Archivo] text-lg font-bold">{active.label}</strong>
          <br />
          {active.street}
          <br />
          {active.city}, {active.region} {active.postal}
        </address>

        {active.geo && (
          <p className="mt-4 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span className="inline-block size-2 animate-pulse-ring rounded-full bg-coral" aria-hidden />
            {`${Math.abs(active.geo.lat).toFixed(4)}°${active.geo.lat >= 0 ? 'N' : 'S'}, ${Math.abs(active.geo.lng).toFixed(4)}°${active.geo.lng >= 0 ? 'E' : 'W'}`}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {links && (
            <>
              <a
                className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition-transform hover:-translate-y-0.5"
                href={links.google}
                target="_blank"
                rel="noreferrer"
              >
                Directions
              </a>
              <a
                className="rounded-full border border-border px-4 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-mint"
                href={links.apple}
                target="_blank"
                rel="noreferrer"
              >
                Apple Maps
              </a>
              <a
                className="rounded-full border border-border px-4 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-mint"
                href={links.waze}
                target="_blank"
                rel="noreferrer"
              >
                Waze
              </a>
            </>
          )}
        </div>

        {trustConfig.location.serviceAreas?.length ? (
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            Service areas:{" "}
            <span className="text-cream">{trustConfig.location.serviceAreas.join(", ")}</span>
            {trustConfig.location.serviceRadiusKm
              ? ` — roughly a ${Math.round(trustConfig.location.serviceRadiusKm * 0.621)} mile radius.`
              : "."}
          </p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-3xl border border-border shadow-float">
        <iframe
          title={`Map showing ${active.label} in ${active.city}, ${active.region}`}
          src={embedSrc}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="h-[420px] w-full"
        />
      </div>
    </div>
  );
}
