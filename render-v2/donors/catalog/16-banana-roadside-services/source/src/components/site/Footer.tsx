import {ClientImage} from "./ClientImage";
import {client,serviceItems,european,hoursText,mediaFor,pageCopy} from "@/data/bridge";
import { Link } from "@tanstack/react-router";
import { MapPin, Clock, Phone, ExternalLink } from "lucide-react";
import { ASSETS } from "@/assets/manifest";
import {
  GOOGLE_REVIEW_URL,
  GBP_URL,
  HOURS_LINE,
  PHONE_DISPLAY,
  PHONE_TEL,
  SERVICE_AREA_LINE,
} from "@/data/site";

const SERVICES=serviceItems.map(s=>({to:s.href || "/services",label:s.name}));

export function Footer() {
  return (
    <footer className="bg-[color:var(--asphalt)] text-white">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-4">
          <span className="shimmer-wrap inline-block">
            <ClientImage
              src={client.identity.logoOnDark}
              alt={client.identity.businessName}
              className="h-16 w-auto"
              width={200}
              height={64}
            />
          </span>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/70">{client.identity.businessName}</p>
          {GOOGLE_REVIEW_URL && (<a
            href={GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noopener"
            className="mt-6 inline-flex items-center gap-3 rounded-full bg-white/5 px-4 py-2.5 text-sm font-medium ring-1 ring-white/15 transition-colors hover:bg-white/10"
          >
            
            Read reviews
            <ExternalLink className="size-3.5 opacity-70" />
          </a>)}
        </div>

        <div className="md:col-span-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)]">
            Services
          </h3>
          <ul className="mt-5 space-y-3 text-sm text-white/80">
            {SERVICES.map((s, i) => (
              <li key={i}>
                <a href={s.to} className="hover:text-white">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)]">
            Contact
          </h3>
          <ul className="mt-5 space-y-4 text-sm text-white/80">
            <li className="flex items-start gap-3">
              <Phone className="mt-0.5 size-4 text-[color:var(--banana)]" />
              <a href={`tel:${PHONE_TEL}`} className="font-semibold text-white hover:underline">
                {PHONE_DISPLAY}
              </a>
            </li>
            {HOURS_LINE && (<li className="flex items-start gap-3">
              <Clock className="mt-0.5 size-4 text-[color:var(--banana)]" />
              <span>
                {HOURS_LINE}
                
              </span>
            </li>)}
            {SERVICE_AREA_LINE && (<li className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-4 text-[color:var(--banana)]" />
              <span>{SERVICE_AREA_LINE}</span>
            </li>)}
          </ul>
        </div>

        <div className="md:col-span-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)]">
            Find us
          </h3>
          <ul className="mt-5 space-y-3 text-sm text-white/80">
            <li>
              {GBP_URL && (<a
                href={GBP_URL}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-2 hover:text-white"
              >
                Business location
                <ExternalLink className="size-3.5 opacity-70" />
              </a>)}
            </li>
            <li>
              {GOOGLE_REVIEW_URL && (<a
                href={GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-2 hover:text-white"
              >
                Reviews
                <ExternalLink className="size-3.5 opacity-70" />
              </a>)}
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 py-6 text-xs text-white/55 sm:flex-row sm:items-center sm:px-6">
          <p>© {new Date().getFullYear()} {client.identity.businessName}. All rights reserved.</p>
          <p>{client.identity.city}, {client.identity.state}</p>
        </div>
      </div>
    </footer>
  );
}
