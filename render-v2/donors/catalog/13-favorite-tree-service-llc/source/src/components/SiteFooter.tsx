import { Link } from "@tanstack/react-router";
import { Phone, Mail, MapPin, Clock, Facebook, Star, MessageSquare, ShieldCheck, Map } from "lucide-react";
import { BUSINESS, TEL_HREF, SMS_HREF, REVIEW_URL, MAPS_LINK } from "@/lib/business";
import { SERVICES, CITIES } from "@/lib/services-data";
import { client } from "@/lib/wss-bridge";
const ftsEmblem = client.identity.logoOnDark;

export function SiteFooter() {
  return (
    <footer className="bg-surface text-surface-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-5 lg:px-8">
        <div className="space-y-5 lg:col-span-2">
          <div className="flex items-center gap-4">
            <img src={ftsEmblem} alt={BUSINESS.name} className="h-20 w-20 object-contain shrink-0 rounded-full ring-1 ring-white/10 shadow-[0_10px_30px_-10px_oklch(0_0_0/0.6)]" loading="lazy" width={80} height={80} />
            <div>
              <div className="font-serif text-2xl leading-none">
                {BUSINESS.name}
              </div>
              <div className="mt-2 font-serif text-[10px] uppercase tracking-[0.32em] text-surface-foreground/55">
                {BUSINESS.city}, {BUSINESS.region}
              </div>
            </div>
          </div>
          <p className="font-serif text-sm italic text-surface-foreground/70">
            {client.content.seasonalNote}
          </p>
          <p className="text-sm text-surface-foreground/70">
            {client.content.ctaBody}
          </p>

          <ul className="space-y-3 pt-2 text-sm">
            <li><a href={TEL_HREF} className="flex items-center gap-2 hover:text-primary-glow"><Phone className="h-4 w-4" aria-hidden /> {BUSINESS.phoneDisplay}</a></li>
            <li><a href={SMS_HREF} className="flex items-center gap-2 hover:text-primary-glow"><MessageSquare className="h-4 w-4" aria-hidden /> Contact</a></li>
            {BUSINESS.email && <li><a href={`mailto:${BUSINESS.email}`} className="flex items-center gap-2 hover:text-primary-glow break-all"><Mail className="h-4 w-4 shrink-0" aria-hidden /> {BUSINESS.email}</a></li>}
            <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{BUSINESS.city}, {BUSINESS.region}</span></li>

          </ul>

          {REVIEW_URL && <a
            href={REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-cta-gradient px-4 py-2 text-sm font-semibold text-accent-foreground shadow-amber transition-smooth hover:opacity-95"
          >
            <Star className="h-4 w-4" aria-hidden /> Read reviews
          </a>}
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary-glow">Services</h3>
          <ul className="space-y-2 text-sm">
            {SERVICES.map((s) => (
              <li key={s.slug}>
                <Link to={s.path} className="hover:text-primary-glow">{s.shortTitle}</Link>
              </li>
            ))}
            <li><Link to="/services" className="hover:text-primary-glow font-semibold">All Services →</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary-glow">Service Areas</h3>
          <ul className="space-y-2 text-sm">
            {CITIES.map((c) => (
              <li key={c.slug}>
                <Link to={c.path} className="hover:text-primary-glow">{c.city}</Link>
              </li>
            ))}
            <li><Link to="/service-area" className="hover:text-primary-glow font-semibold">Full Service Area →</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary-glow">Company</h3>
          <ul className="space-y-2 text-sm">
            <li><Link to="/about" className="hover:text-primary-glow">About Us</Link></li>
            <li><Link to="/contact" className="hover:text-primary-glow">Contact</Link></li>
          </ul>
          <div className="mt-5 space-y-2 text-sm">
            {client.trust.socials.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary-glow">{new URL(url).hostname}</a>)}
            {MAPS_LINK && <a href={MAPS_LINK} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary-glow"><Map className="h-4 w-4" /> Map and directions</a>}
            {REVIEW_URL && <a href={REVIEW_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary-glow"><Star className="h-4 w-4" /> Reviews</a>}
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-surface-foreground/60 sm:flex-row sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} {BUSINESS.name}. All rights reserved.</p>
          <p>{BUSINESS.city}, {BUSINESS.region}</p>
        </div>
      </div>
    </footer>
  );
}
