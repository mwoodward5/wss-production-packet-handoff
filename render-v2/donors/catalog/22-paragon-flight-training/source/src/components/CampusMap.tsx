import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { motion } from "framer-motion";
import { MapPin, Plane, Compass, ArrowRight } from "lucide-react";

import { HeadingRose } from "@/components/motion/HeadingRose";
import { ControlButton } from "@/components/motion/ControlButton";

/**
 * Aviation Campus Map / Airport view.
 * Map-pin ready: structured to accept latitude, longitude, Place ID,
 * GBP URL, and a review link via the data-* attributes on the wrapper —
 * easy to wire up later without a redesign.
 */
const placePins: {city:string;code:string;note:string;x:number;y:number;primary?:boolean}[] = [];

export const CampusMap = () => {
  const mapInfo = sitePlan?.localPresence?.mapAndDirections;
  const candidate = mapInfo?.geo;
  const geo = candidate?.verified === true && candidate.schemaAllowed === true &&
    typeof candidate.lat === 'number' && Number.isFinite(candidate.lat) && Math.abs(candidate.lat) <= 90 &&
    typeof candidate.lng === 'number' && Number.isFinite(candidate.lng) && Math.abs(candidate.lng) <= 180 ? candidate : null;
  if (!client.trust.mapUrl || !mediaSlot('campus-aeronautical')) return null;
  return (
    <section
      id="campus"
      data-place-id={mapInfo?.googlePlaceId || undefined}
      data-gbp-url={client.trust.mapUrl}
      data-review-url=""
      data-latitude={geo?.verified && geo.schemaAllowed ? geo.lat ?? undefined : undefined}
      data-longitude={geo?.verified && geo.schemaAllowed ? geo.lng ?? undefined : undefined}
      className="relative overflow-hidden bg-surface py-24 md:py-32"
      aria-label={`${client.identity.businessName} location`}
    >
      <div className="container-page">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-5">
            <span className="eyebrow">
              <span className="h-px w-8 bg-primary" /> 04 — Location
            </span>
            <h2 className="display-xl mt-4 text-4xl text-balance sm:text-5xl">
              {client.identity.city}, {client.identity.state}
            </h2>
            <p className="mt-6 text-base leading-relaxed text-muted-foreground">
              {client.identity.businessName}
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border">
              {[
                { k: "City", v: client.identity.city },
                { k: "Region", v: client.identity.state },
              ].map((m) => (
                <div key={m.k} className="bg-background p-4">
                  <dt className="hud-tag">{m.k}</dt>
                  <dd className="mt-1 font-mono text-sm text-foreground">{m.v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <ControlButton
                href="#contact"
                variant="primary"
                size="md"
                trailingIcon={<ArrowRight className="h-4 w-4" />}
              >
                Request Information
              </ControlButton>
              <ControlButton
                href={client.trust.mapUrl}
                variant="ghost"
                size="md"
                icon={<MapPin className="h-4 w-4" />}
                ariaLabel="View location"
              >
                Get Directions
              </ControlButton>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9 }}
            className="relative aspect-[4/3] overflow-hidden rounded-sm border border-border lg:col-span-7"
          >
            <img
              src={mediaSlot("campus-aeronautical")}
              alt={client.identity.businessName}
              loading="lazy"
              width={1600}
              height={1200}
              className="absolute inset-0 h-full w-full object-cover opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-sky-deep/85 via-sky-deep/40 to-transparent" />

            {/* HUD frame */}
            <div className="pointer-events-none absolute inset-3 border border-primary/30" />
            <div className="absolute left-4 top-4 flex items-center gap-2">
              <Compass className="h-4 w-4 text-primary" />
              <span className="hud-tag text-foreground/90">{client.identity.city}</span>
            </div>
            <div className="absolute right-3 top-3 flex items-center gap-2">
              <div className="hidden flex-col items-end font-mono text-[9px] uppercase tracking-[0.2em] text-foreground/80 md:flex">
                <span className="text-primary">Illustration</span>
                <span className="text-muted-foreground">Compass</span>
              </div>
              <HeadingRose heading={230} size={56} />
            </div>

            {/* Animated route arcs from KFMY home pin to each city, with traveling diagnostic pulses */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              {placePins
                .filter((p) => !p.primary)
                .map((p, i) => {
                  const home = placePins.find((x) => x.primary)!;
                  const mx = (home.x + p.x) / 2;
                  const my = Math.min(home.y, p.y) - 14;
                  const d = `M ${home.x} ${home.y} Q ${mx} ${my} ${p.x} ${p.y}`;
                  return (
                    <g key={p.city}>
                      {/* Route arc — draws in once on enter */}
                      <motion.path
                        d={d}
                        fill="none"
                        stroke="hsl(var(--primary))"
                        strokeWidth="0.25"
                        strokeDasharray="0.6 0.8"
                        strokeLinecap="round"
                        initial={{ pathLength: 0, opacity: 0 }}
                        whileInView={{ pathLength: 1, opacity: 0.7 }}
                        viewport={{ once: true, margin: "-80px" }}
                        transition={{ duration: 1.6, delay: 0.3 + i * 0.15, ease: "easeInOut" }}
                      />
                      {/* Traveling pulse — small bright dot that walks the arc on a loop */}
                      <circle r="0.55" fill="hsl(var(--primary-glow))" opacity="0.95">
                        <animateMotion
                          dur={`${5 + i * 0.7}s`}
                          repeatCount="indefinite"
                          path={d}
                          rotate="auto"
                          begin={`${0.6 + i * 0.4}s`}
                        />
                        <animate
                          attributeName="opacity"
                          values="0;0.95;0.95;0"
                          keyTimes="0;0.1;0.85;1"
                          dur={`${5 + i * 0.7}s`}
                          repeatCount="indefinite"
                          begin={`${0.6 + i * 0.4}s`}
                        />
                      </circle>
                    </g>
                  );
                })}
            </svg>

            {/* Pins overlay */}
            {placePins.map((p) => (
              <div
                key={p.city}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <div className="group relative flex flex-col items-center">
                  {/* Radar sweep — radiates outward from the home pin every ~4s */}
                  {p.primary && (
                    <>
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-radar-sweep rounded-full border border-primary/60"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-radar-sweep rounded-full border border-primary/40"
                        style={{ animationDelay: "1.3s" }}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-radar-sweep rounded-full border border-primary/30"
                        style={{ animationDelay: "2.6s" }}
                      />
                    </>
                  )}
                  <span
                    className={
                      "relative flex h-3 w-3 " +
                      (p.primary ? "" : "opacity-90")
                    }
                  >
                    {p.primary && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
                    )}
                    <span
                      className={
                        "relative inline-flex h-3 w-3 rounded-full ring-2 ring-background " +
                        (p.primary ? "bg-primary" : "bg-secondary")
                      }
                    />
                  </span>
                  <div
                    className={
                      "mt-2 whitespace-nowrap rounded-sm border border-border bg-background/85 px-2 py-1 text-center font-mono text-[10px] uppercase tracking-[0.18em] backdrop-blur-md " +
                      (p.primary ? "text-primary" : "text-foreground/80")
                    }
                  >
                    <div>{p.city}</div>
                    <div className="text-[9px] text-muted-foreground">{p.code}</div>
                  </div>
                </div>
              </div>
            ))}

          </motion.div>
        </div>
      </div>
    </section>
  );
};
