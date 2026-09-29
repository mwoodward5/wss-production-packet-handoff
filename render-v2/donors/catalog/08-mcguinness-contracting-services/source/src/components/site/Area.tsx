import { CLIENT, PLAN, mapEmbed } from "@/lib/wss";
import { MapPin } from "lucide-react";

export function Area() {
 const cities=CLIENT.trust.areas;
 const embed=mapEmbed();
 if (!cities.length) return null;
  return (
    <section id="area" className="relative py-24 md:py-32">
      <div className="container mx-auto px-5 md:px-8 grid lg:grid-cols-5 gap-10 lg:gap-14 items-center">
        <div className="lg:col-span-2">
          <p className="text-xs font-bold tracking-[0.25em] uppercase text-[var(--coral)]">
            Service Area
          </p>
          <h2 className="mt-3 text-3xl md:text-5xl uppercase leading-[1.05]">
            {CLIENT.identity.city}, {CLIENT.identity.state}
          </h2>
          <p className="mt-5 text-muted-foreground text-lg font-sans">
            {PLAN?.content?.["service-area"] || ""}
          </p>

          <ul className="mt-8 grid grid-cols-2 gap-y-2.5 gap-x-4">
            {cities.map((c) => (
              <li key={c} className="flex items-center gap-2 text-sm text-foreground/85 font-sans">
                <MapPin className="h-3.5 w-3.5 text-[var(--coral)]" />
                {c}
              </li>
            ))}
          </ul>
        </div>

        {(embed || CLIENT.trust.mapUrl) && <div className="lg:col-span-3">
          <div className="relative rounded-sm overflow-hidden border border-border shadow-elegant aspect-[5/4]">
            {embed ? <iframe
              title={`${CLIENT.identity.businessName} map`}
              src={embed}
              className="absolute inset-0 h-full w-full"
              loading="lazy"
            /> : <a className="absolute inset-0 flex items-center justify-center" href={CLIENT.trust.mapUrl} target="_blank" rel="noreferrer">View map and directions</a>}
          </div>
        </div>}
      </div>
    </section>
  );
}
