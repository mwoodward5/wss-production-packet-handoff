import { CLIENT, SITE, SERVICES, PLAN } from "@/lib/wss";
import { Link } from "@tanstack/react-router";
import { BUSINESS, NAV } from "@/lib/business";
import { Phone, Mail, MapPin, Clock, ShieldCheck, Facebook } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="bg-ink text-bone">
      <div className="container-edge py-20 grid gap-14 md:grid-cols-12">
        <div className="md:col-span-5">
          <div className="eyebrow text-volt mb-4">{BUSINESS.city}, {BUSINESS.state}</div>
          <h2 className="display-lg text-bone max-w-md">
            {CLIENT.content.ctaHeadline || BUSINESS.name}
          </h2>
          <p className="mt-6 text-bone/70 max-w-sm leading-relaxed text-[15px]">
            {CLIENT.content.ctaBody}
          </p>

          <img src={CLIENT.identity.logoOnDark} alt={BUSINESS.name} className="h-20 w-20 object-contain mt-7" />
          {CLIENT.trust.socials.length>0 && <div className="mt-7 flex flex-wrap items-center gap-3">{CLIENT.trust.socials.map(url=><a key={url} href={url} rel="noopener noreferrer" className="border border-bone/20 p-3">{new URL(url).hostname}</a>)}</div>}

          <Link to="/contact" className="mt-7 inline-flex btn-volt">Start your project →</Link>
        </div>

        <div className="md:col-span-3">
          <div className="eyebrow text-bone/50 mb-5">Sitemap</div>
          <ul className="space-y-3 text-[14px]">
            {NAV.map(n => (
              <li key={n.to}><Link to={n.to} className="text-bone/85 hover:text-volt">{n.label}</Link></li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-4">
          <div className="eyebrow text-bone/50 mb-5">Contact</div>
          {/* hCard microformat (h-card / vCard) — read by Apple Maps, Bing,
              Yelp, and other directory crawlers as a verified business pin. */}
          <ul className="h-card space-y-4 text-[14px] text-bone/85">
            <li className="hidden">
              <span className="p-name fn org">{BUSINESS.name}</span>
            </li>
            <li className="flex items-start gap-3">
              <Phone size={16} className="text-volt mt-0.5 shrink-0" aria-hidden="true" />
              <a href={`tel:${BUSINESS.phoneE164}`} className="p-tel hover:text-volt">{BUSINESS.phone}</a>
            </li>
            {BUSINESS.email && <li className="flex items-start gap-3">
              <Mail size={16} className="text-volt mt-0.5 shrink-0" aria-hidden="true" />
              <a href={`mailto:${BUSINESS.email}`} className="u-email hover:text-volt break-all">{BUSINESS.email}</a>
            </li>}
            <li className="flex items-start gap-3">
              <MapPin size={16} className="text-volt mt-0.5 shrink-0" aria-hidden="true" />
              <span className="p-adr h-adr">
                <span className="p-locality">{BUSINESS.city}</span>,{" "}
                <span className="p-region">{BUSINESS.state}</span>{" "}
                
                {BUSINESS.region && <span className="text-bone/55"> · serving {BUSINESS.region}</span>}
              </span>
            </li>
            {BUSINESS.hours && <li className="flex items-start gap-3">
              <Clock size={16} className="text-volt mt-0.5 shrink-0" aria-hidden="true" />
              <span>{BUSINESS.hours}</span>
            </li>}
          </ul>

          {/* County markers — verified coverage. */}
          {CLIENT.trust.areas.length>0 && <div className="mt-6 pt-5 border-t border-bone/10">
            <div className="eyebrow text-bone/50 mb-3">Service areas</div>
            <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[12px] uppercase tracking-[0.12em] text-bone/75">
              {CLIENT.trust.areas.map((c) => (
                <li key={c} className="inline-flex items-center gap-1.5">
                  <MapPin size={12} className="text-volt shrink-0" aria-hidden="true" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>}
        </div>
      </div>

      <div className="border-t border-bone/10">
        <div className="container-edge py-6 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between text-[12px] text-bone/55">
          <div>© {new Date().getFullYear()} {BUSINESS.name}. All rights reserved.</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link to="/privacy" className="hover:text-volt">Privacy Policy</Link>
            <span className="text-bone/25" aria-hidden="true">·</span>
            <span>{BUSINESS.city}, {BUSINESS.state}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
