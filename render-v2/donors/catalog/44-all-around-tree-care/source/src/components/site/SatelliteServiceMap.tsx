/**
 * SatelliteServiceMap — premium real-world service-area treatment.
 * Uses Google Maps satellite embed + outbound Google/Apple Maps buttons.
 * Lists primary coverage towns; no fabricated addresses.
 */
import { CLIENT } from "@/config";
import { DATA } from "@/wss/bridge";
import { NativeMapLinks, mapEmbedUrl, verifiedGeo } from "./NativeMapLinks";
import { MapPin, Compass, Navigation, Radar } from "lucide-react";

const COVERAGE = DATA.trust.areas;

export function SatelliteServiceMap() {
  if (!mapEmbedUrl && !DATA.trust.mapUrl && !COVERAGE.length) return null;
  return (
    <div className={`grid ${mapEmbedUrl ? "lg:grid-cols-[1.1fr_0.9fr]" : ""} gap-6 items-stretch`}>
      {/* Map frame */}
      {mapEmbedUrl && <div className="relative rounded-3xl overflow-hidden border border-foreground/10 shadow-[var(--shadow-elevated)] aspect-[4/3] lg:aspect-auto lg:min-h-[440px] bg-foreground">
        <iframe
          src={mapEmbedUrl}
          title={`${CLIENT.businessName} location`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="absolute inset-0 w-full h-full"
        />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_52%_48%,transparent_0_22%,rgba(255,148,0,0.22)_23%,transparent_24%),linear-gradient(135deg,rgba(11,18,12,0.18),transparent_42%,rgba(215,180,106,0.12))]" />
        <svg className="absolute inset-0 h-full w-full pointer-events-none opacity-80" viewBox="0 0 800 560" preserveAspectRatio="none" aria-hidden>
          <path d="M88 390 C190 320 248 342 330 268 C430 178 526 220 702 118" className="service-route-line" />
          <path d="M118 440 C246 376 316 396 424 318 C514 254 610 274 726 214" className="service-route-line service-route-line-alt" />
          <circle cx="330" cy="268" r="8" fill="#D7B46A" />
          <circle cx="702" cy="118" r="7" fill="#FF9400" />
        </svg>
        {/* HUD overlays */}
        <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-md bg-black/55 backdrop-blur px-2.5 py-1.5 text-[10px] font-mono tracking-wider uppercase text-[oklch(0.92_0.08_85)] border border-[var(--gold)]/30 pointer-events-none">
          <Compass className="w-3 h-3 text-[var(--gold)]" /> Satellite location
        </div>
        <div className="absolute left-3 bottom-3 flex flex-wrap gap-2 pointer-events-none">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-black/55 backdrop-blur px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-white border border-white/20"><Navigation className="h-3 w-3 text-[var(--gold)]" /> Location</span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-black/55 backdrop-blur px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-white border border-white/20"><Radar className="h-3 w-3 text-[var(--gold)]" /> Satellite view</span>
        </div>
        <div className="absolute bottom-3 right-3 rounded-md bg-black/55 backdrop-blur px-2.5 py-1.5 text-[10px] font-mono text-white border border-white/20 pointer-events-none">
          {verifiedGeo?.lat}, {verifiedGeo?.lng}
        </div>
      </div>}

      {/* Coverage panel */}
      <div className="relative rounded-3xl border border-foreground/10 bg-white p-6 lg:p-8 flex flex-col">
        <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#FF9400]">
          <MapPin className="w-3 h-3" /> Primary Coverage
        </div>
        <h3 className="mt-3 text-2xl font-bold tracking-tight">
          {CLIENT.serviceAreaLabel || "Service area"}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Contact us to discuss service at your property.
        </p>

        <ul className="mt-5 grid grid-cols-2 gap-2 text-sm">
          {COVERAGE.map((city) => (
            <li
              key={city}
              className="flex items-center gap-2 rounded-lg border border-foreground/10 bg-[oklch(0.97_0.015_85)] px-3 py-2"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#4F5F3E]" />
              <span className="font-medium">{city}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-6">
          <NativeMapLinks />
        </div>
      </div>
    </div>
  );
}
