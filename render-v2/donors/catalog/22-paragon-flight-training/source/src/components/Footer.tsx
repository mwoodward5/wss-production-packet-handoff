import { links } from "./Nav";
import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { Phone, MapPin } from "lucide-react";

export const Footer = () => {
  return (
    <footer className="relative border-t border-border bg-sky-deep py-14">
      {/* Runway-light marquee — top of footer */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-2 flex overflow-hidden"
      >
        <div className="flex shrink-0 animate-[runway-march_8s_linear_infinite] gap-4">
          {Array.from({ length: 80 }).map((_, i) => (
            <span
              key={i}
              className={
                "h-1.5 w-8 rounded-full " +
                (i % 6 === 0 ? "bg-primary shadow-runway" : "bg-primary/30")
              }
            />
          ))}
        </div>
        <div className="flex shrink-0 animate-[runway-march_8s_linear_infinite] gap-4" aria-hidden="true">
          {Array.from({ length: 80 }).map((_, i) => (
            <span
              key={i}
              className={
                "h-1.5 w-8 rounded-full " +
                (i % 6 === 0 ? "bg-primary shadow-runway" : "bg-primary/30")
              }
            />
          ))}
        </div>
      </div>
      <div className="container-page pt-6">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-gradient-runway">
<img src={client.identity.logoOnDark} alt={client.identity.businessName} className="relative h-9 w-9 object-contain" />
              </span>
              <div className="leading-tight">
                <div className="font-display text-sm font-semibold tracking-wide">{client.identity.businessName}</div>
                <div className="hud-tag">{client.identity.city}</div>
              </div>
            </div>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {client.content.about}
            </p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {client.identity.city}, {client.identity.state}
            </p>
          </div>

          <div className="md:col-span-3">
            <div className="hud-tag">Site</div>
            <ul className="mt-4 space-y-2 text-sm">
              {links.map(({label:l, href:h}) => (
                <li key={l}>
                  <a href={h} className="text-muted-foreground hover:text-primary">
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-4">
            <div className="hud-tag">Contact</div>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a
                  href={client.identity.phoneTel}
                  className="inline-flex items-center gap-2 text-foreground hover:text-primary"
                >
                  <Phone className="h-4 w-4 text-primary" /> {client.identity.phoneDisplay}
                </a>
              </li>
              <li className="inline-flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 text-primary" />
                {client.identity.city}, {client.identity.state}
              </li>
              <li className="font-mono text-xs text-muted-foreground">{new URL(client.identity.website).hostname}</li>
            </ul>

            <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border">
              <div className="bg-background p-3">
                <div className="hud-tag">Category</div>
                <div className="mt-1 font-mono text-xs text-foreground">Flight School</div>
              </div>
              <div className="bg-background p-3">
                <div className="hud-tag">Region</div>
                <div className="mt-1 font-mono text-xs text-foreground">{client.identity.state}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="horizon-line mt-12" />

        <div className="mt-6 flex flex-col items-start justify-between gap-3 text-xs text-muted-foreground md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} {client.identity.businessName}. All rights reserved.</p>
          <div className="flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-[0.2em]">
            {client.trust.socials.map(url => <a key={url} href={url}>{new URL(url).hostname}</a>)}
          </div>
        </div>
      </div>
    </footer>
  );
};
