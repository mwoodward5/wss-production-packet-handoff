import {ClientImage} from "./ClientImage";
import {client,serviceItems,european,hoursText,mediaFor,pageCopy} from "@/data/bridge";
import { ExternalLink, MapPin } from "lucide-react";
import { GBP_URL, MAP_EMBED_SRC, SERVICE_AREA_LINE } from "@/data/site";

const CITIES=client.trust.areas;

export function ServiceAreaSection() {
  if(!CITIES.length && !client.trust.mapUrl) return null;
  return (
    <section className="bg-background py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <span className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.05] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/70">
            <MapPin className="size-3.5 text-[color:var(--banana-deep)]" />
            Service area
          </span>
          <h2 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
            Service area
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-foreground/75">{SERVICE_AREA_LINE}</p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {CITIES.map((c) => (
              <li
                key={c}
                className="rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground/80"
              >
                {c}
              </li>
            ))}
          </ul>
          {GBP_URL && (<a
            href={GBP_URL}
            target="_blank"
            rel="noopener"
            className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            View business location
            <ExternalLink className="size-4" />
          </a>)}
        </div>
        <div className="lg:col-span-7">
          <div className="overflow-hidden rounded-3xl border border-border shadow-[var(--shadow-lift)]">
            <div className="flex h-[420px] w-full items-center justify-center bg-[color:var(--cream)]">{client.trust.mapUrl && <a href={client.trust.mapUrl} target="_blank" rel="noopener">Open location map</a>}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
