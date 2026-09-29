import { useClient } from "@/wss/bridge";
import { mapEmbed } from "@/wss/model";
import { MapPin } from "lucide-react";


export function ServiceArea() {
  const {client, plan} = useClient();
  const towns = client.trust.areas;
  const embed = mapEmbed(plan);
  if (!towns.length) return null;
  return (
    <section id="area" className="py-24 md:py-32 bg-background">
      <div className="container-tight grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <div className="reveal">
          <span className="eyebrow mb-5">Service Area</span>
          <h2 className="font-display text-4xl md:text-5xl lg:text-[3.5rem] font-bold uppercase leading-[0.98] mb-6 text-balance mt-4">
            {client.identity.city}, <span className="text-accent">{client.identity.state}</span>
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            {plan?.content?.["service-area"] || ""}
          </p>
          <ul className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
            {towns.map((t) => (
              <li key={t} className="flex items-center gap-2 text-foreground py-2 border-b border-border/60">
                <MapPin className="h-3.5 w-3.5 text-accent shrink-0" />
                <span className="text-sm font-medium">{t}</span>
              </li>
            ))}
          </ul>
        </div>
        {embed ? <div className="reveal reveal-delay-1 relative rounded-2xl overflow-hidden shadow-deep border border-border aspect-[4/3] bg-secondary"><iframe title={client.identity.businessName + ' map'} src={embed} className="absolute inset-0 h-full w-full border-0" loading="lazy" /><div className="pointer-events-none absolute bottom-4 left-4 bg-primary/90 text-primary-foreground px-4 py-2.5 rounded-md shadow-card backdrop-blur">{client.identity.city}, {client.identity.state}</div></div> : client.trust.mapUrl && <a href={client.trust.mapUrl} target="_blank" rel="noreferrer" className="reveal reveal-delay-1 relative rounded-2xl overflow-hidden shadow-deep border border-border aspect-[4/3] bg-secondary flex items-center justify-center">
          <span className="bg-primary text-primary-foreground p-5 rounded-md"><MapPin className="h-6 w-6 text-accent" />View map and directions<br />{client.identity.city}, {client.identity.state}</span>
        </a>}
      </div>
    </section>
  );
}
