import { Link } from "@/wss/Link";
import { Phone, Mail, MapPin, Clock, Facebook } from "lucide-react";
import { CLIENT, SOCIAL, BRAND } from "@/config";

import { NAV, WSS } from '@/wss/bridge';
import { HOURS } from '@/config';
const SERVICES_LIST=WSS.services.map(s=>s.name);

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-card">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-16 grid gap-12 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="logo-plaque logo-plaque-lg mb-5 inline-flex">
            <img src={BRAND.logoDark} alt={CLIENT.businessName} className="h-11 w-auto" />
          </span>
          <p className="text-sm text-muted-foreground leading-relaxed">{CLIENT.shortDescription}</p>
          <div className="mt-4 flex items-center gap-3">
            {SOCIAL.facebook && (
              <a aria-label="Facebook" href={SOCIAL.facebook} target="_blank" rel="noopener noreferrer me"
                className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-primary">
                <Facebook className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold tracking-wider uppercase text-primary mb-4">Services</h4>
          <ul className="space-y-2 text-sm text-muted-foreground capitalize">
            {SERVICES_LIST.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold tracking-wider uppercase text-primary mb-4">Navigate</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {NAV.map((n) => (
              <li key={n.to}><Link to={n.to} className="hover:text-foreground">{n.label}</Link></li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold tracking-wider uppercase text-primary mb-4">Contact</h4>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-2"><Phone className="w-4 h-4 mt-0.5 text-primary" /><a href={`tel:${CLIENT.phoneE164}`} className="hover:text-foreground">{CLIENT.phone}</a></li>
            {CLIENT.email && <li className="flex gap-2"><Mail className="w-4 h-4 mt-0.5 text-primary" /><a href={`mailto:${CLIENT.email}`} className="hover:text-foreground break-all">{CLIENT.email}</a></li>}
            <li className="flex gap-2"><MapPin className="w-4 h-4 mt-0.5 text-primary" /><span>{CLIENT.serviceAreaLabel}</span></li>
            {HOURS && <li className="flex gap-2"><Clock className="w-4 h-4 mt-0.5 text-primary" /><span>{HOURS}</span></li>}
          </ul>
          {CLIENT.gbp?.mapsUrl && (
            <a href={CLIENT.gbp.mapsUrl} target="_blank" rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
              Map and directions →
            </a>
          )}

        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} {CLIENT.businessName}. All rights reserved.</span>
          <span>{CLIENT.city}, {CLIENT.region} · {CLIENT.serviceAreaLabel}</span>
        </div>
      </div>
    </footer>
  );
}
