import { RouteLink } from "./RouteLink";
import { Phone } from "lucide-react";
import { business } from "@/data/business";
import {client,nav} from "@/wss/bridge";
import { OpenNowPill } from "./OpenNowPill";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <RouteLink to="/" className="flex items-center gap-2">
          <img src={client.identity.logoOnLight} alt={business.name} className="h-8 w-auto max-w-40 object-contain" width={128} height={32} />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="font-display text-base font-extrabold tracking-tight text-foreground">
              {business.name}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {client.identity.city}, {client.identity.state}
            </span>
          </span>
        </RouteLink>
        <nav className="hidden items-center gap-5 text-sm font-medium text-foreground/80 lg:flex">
          {nav.map((item) => (
            <RouteLink key={item.to} to={item.to} className="transition-colors hover:text-foreground">
              {item.label}
            </RouteLink>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <OpenNowPill className="hidden md:inline-flex" />
          <a
            href={`tel:${business.telephone}`}
            data-event="click_call"
            className="btn-glow inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold"
          >
            <Phone className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{business.displayPhone}</span>
            <span className="sm:hidden">Call</span>
          </a>
        </div>
      </div>
    </header>
  );
}
