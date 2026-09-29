import { Link } from "react-router-dom";
import { Mail, MapPin, Phone, Facebook, Map } from "lucide-react";
import { BUSINESS, NAP_LINE } from "@/lib/business";
import {CLIENT,routeFor} from "@/lib/wss";
const falconLogo=CLIENT.identity.logoOnDark;

export const Footer = () => (
  <footer className="relative overflow-hidden bg-primary text-primary-foreground">
    <div className="h-2 tape-strip" aria-hidden="true" />
    <div className="absolute inset-0 blueprint-grid-dark opacity-30" aria-hidden="true" />
    <div className="container-tight relative grid gap-12 py-16 md:grid-cols-12">
      <div className="md:col-span-5">
        <div className="flex items-center gap-3">
          <img
            src={falconLogo}
            alt={BUSINESS.name}
            className="h-auto w-60 max-w-full object-contain"
            width={240}
            height={80}
          />
        </div>
        <p className="mt-5 max-w-md text-sm leading-relaxed text-primary-foreground/75">
          {CLIENT.content.about}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {CLIENT.trust.socials.map((url,i)=><a key={url} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center border border-primary-foreground/20 px-4 font-mono text-[10px] uppercase tracking-[0.22em]">Profile {i+1}</a>)}
          {CLIENT.trust.badges.map(b=><span key={b.label} className="border border-primary-foreground/20 px-4 py-3 font-mono text-[10px]">{b.label}</span>)}
        </div>
      </div>

      <div className="md:col-span-3">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-accent">Sitemap · 01</h3>
        <ul className="mt-5 space-y-3 text-sm text-primary-foreground/80">
          {CLIENT.services.map(s=><li key={s.name}><Link to={s.href || routeFor(s)} className="hover:text-accent">{s.shortLabel}</Link></li>)}
          <li><Link to="/service-area" className="hover:text-accent">Service Area</Link></li>
          <li><Link to="/contact" className="hover:text-accent">Contact Us</Link></li>
        </ul>
      </div>

      <div className="md:col-span-4">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-accent">Direct line · 02</h3>
        <ul className="mt-5 space-y-3 text-sm text-primary-foreground/80">
          <li>
            <a className="flex items-start gap-2 hover:text-accent" href={`tel:${BUSINESS.phoneTel}`}>
              <Phone className="mt-0.5 h-4 w-4 text-signal" /> {BUSINESS.phoneDisplay}
            </a>
          </li>
          {BUSINESS.email && <li>
            <a className="flex items-start gap-2 break-all hover:text-accent" href={`mailto:${BUSINESS.email}`}>
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-signal" /> {BUSINESS.email}
            </a>
          </li>}
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-signal" /> {NAP_LINE}
          </li>
          {CLIENT.trust.mapUrl && <li>
            <a
              className="flex items-start gap-2 hover:text-accent"
              href={CLIENT.trust.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-event="contact_map_footer"
            >
              <Map className="mt-0.5 h-4 w-4 shrink-0 text-signal" /> Map and directions
            </a>
          </li>}
        </ul>
      </div>
    </div>
    <div className="relative border-t border-primary-foreground/10">
      <div className="container-tight flex flex-col items-center justify-between gap-3 py-6 font-mono text-[11px] uppercase tracking-[0.2em] text-primary-foreground/55 sm:flex-row">
        <div>© {new Date().getFullYear()} {BUSINESS.name}</div>
        <div>{BUSINESS.city}, {BUSINESS.region}</div>
      </div>
    </div>
  </footer>
);
