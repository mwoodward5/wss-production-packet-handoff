import {CLIENT,planCopy} from "@/lib/wss";
import { MapPin, Mail, Phone, Navigation, ExternalLink } from "lucide-react";
import { BUSINESS } from "@/lib/business";
import { ASSETS } from "@/lib/assets";
const mapBg = ASSETS.serviceAreaMap;

const googleMapsUrl=CLIENT.trust.mapUrl;

/**
 * Exterior Protection Map / coverage band — full-width, no floating card.
 */
export const ServiceArea = () => !BUSINESS.serviceArea.length ? null : (
  <section id="service-area" className="relative bg-background py-20 md:py-24">
    <div className="container-tight">
      <div className="border border-border bg-card" style={{ borderRadius: "2px" }}>
        <div className="grid md:grid-cols-12">
          {/* Left: copy + city list */}
          <div className="md:col-span-7 md:border-r md:border-border">
            <div className="border-b border-border bg-muted/40 px-6 py-3 md:px-8">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
                Section · 05 / Coverage map
              </span>
            </div>
            <div className="p-6 md:p-9">
              <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                Service area
              </h2>
              <p className="mt-4 max-w-xl text-muted-foreground">
                {planCopy('service-area')}
              </p>
              <ul className="mt-7 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3">
                {BUSINESS.serviceArea.map((c) => (
                  <li
                    key={c}
                    className="flex items-center gap-2 bg-card px-3 py-2.5 font-display text-sm font-semibold"
                  >
                    <MapPin className="h-4 w-4 text-accent" /> {c}
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-2">
                {googleMapsUrl && <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-border bg-card px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-accent hover:text-accent"
                  style={{ borderRadius: "2px" }}
                >
                  <Navigation className="h-3.5 w-3.5 text-accent" /> Map and directions
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </a>}
              </div>
            </div>
          </div>

          {/* Right: HQ contact card over real aerial backdrop */}
          <div className="relative overflow-hidden bg-primary p-6 text-primary-foreground md:col-span-5 md:p-9">
            {mapBg && <img
              src={mapBg}
              alt={BUSINESS.city}
              width={1600}
              height={1000}
              loading="eager"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover opacity-95"
            />}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/45 via-primary/30 to-primary/82" aria-hidden="true" />
            <div className="absolute inset-0 blueprint-grid-dark opacity-30" aria-hidden="true" />
            <div className="relative">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-signal">
                Contact
              </div>
              <div className="mt-3 font-display text-2xl font-extrabold">{BUSINESS.name}</div>
              <div className="text-primary-foreground/80">{BUSINESS.city}, {BUSINESS.region}</div>

              <div className="mt-7 space-y-3">
                <a
                  href={`tel:${BUSINESS.phoneTel}`}
                  className="flex items-center justify-between border-b border-dashed border-primary-foreground/25 pb-3 transition hover:text-accent-glow"
                >
                  <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-primary-foreground/65">
                    <Phone className="h-3.5 w-3.5" /> Direct line
                  </span>
                  <span className="font-display text-base font-bold">{BUSINESS.phoneDisplay}</span>
                </a>
                {BUSINESS.email && <a
                  href={`mailto:${BUSINESS.email}`}
                  className="flex flex-col gap-1 transition hover:text-accent-glow"
                >
                  <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-primary-foreground/65">
                    <Mail className="h-3.5 w-3.5" /> Email
                  </span>
                  <span className="break-all font-display text-sm font-bold">{BUSINESS.email}</span>
                </a>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);
