import { Link } from "@tanstack/react-router";
import { Phone, Mail, Clock, MapPin } from "lucide-react";
import { CLIENT } from "@/lib/wss";
import { SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="bg-ink text-cream/85">
      <div className="mx-auto max-w-7xl px-5 md:px-8 py-16 md:py-20 grid gap-12 md:grid-cols-12">
        <div className="md:col-span-5">
          <img src={CLIENT.identity.logoOnDark} alt={SITE.name} className="h-8 w-auto mb-3" /><div className="font-display text-3xl md:text-4xl text-cream tracking-tight">
            {SITE.name}
          </div>
          <p className="mt-4 max-w-md text-cream/70 leading-relaxed">
            {SITE.longDescription}
          </p>
          <a
            href={SITE.phoneHref}
            className="mt-8 inline-flex items-center gap-3 rounded-full bg-cedar px-6 py-3 text-cream font-semibold btn-magnetic"
          >
            <Phone className="h-4 w-4" /> {SITE.phone}
          </a>
        </div>

        <div className="md:col-span-3">
          <div className="eyebrow text-cedar mb-4">Explore</div>
          <ul className="space-y-2.5 text-cream/80">
            <li><Link to="/services" className="hover:text-cedar transition-colors">Services</Link></li>
            <li><Link to="/projects" className="hover:text-cedar transition-colors">Projects</Link></li>
            <li><Link to="/about" className="hover:text-cedar transition-colors">About</Link></li>
            <li><Link to="/service-area" className="hover:text-cedar transition-colors">Service Area</Link></li>
            <li><Link to="/faq" className="hover:text-cedar transition-colors">FAQ</Link></li>
            <li><Link to="/contact" className="hover:text-cedar transition-colors">Contact</Link></li>
          </ul>
        </div>

        <div className="md:col-span-4 space-y-5">
          <div className="eyebrow text-cedar">Contact</div>
          <div className="space-y-3 text-cream/80">
            <div className="flex items-start gap-3">
              <Phone className="h-4 w-4 mt-1 text-cedar shrink-0" />
              <a href={SITE.phoneHref} className="hover:text-cedar">{SITE.phone}</a>
            </div>
            {SITE.email && <div className="flex items-start gap-3">
              <Mail className="h-4 w-4 mt-1 text-cedar shrink-0" />
              <a href={`mailto:${SITE.email}`} className="hover:text-cedar">{SITE.email}</a>
            </div>}
            <div className="flex items-start gap-3">
              <MapPin className="h-4 w-4 mt-1 text-cedar shrink-0" />
              <span>{SITE.city}, {SITE.region}</span>
            </div>
            {SITE.hoursNote && <div className="flex items-start gap-3">
              <Clock className="h-4 w-4 mt-1 text-cedar shrink-0" />
              <div>
                <div>{SITE.hoursNote}</div>
                <div className="text-cream/70"></div>
              </div>
            </div>}
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-5 md:px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-cream/50">
          <div>© {new Date().getFullYear()} {SITE.name}. All rights reserved.</div>
          <div>{SITE.serviceArea.join(" · ")}</div>
        </div>
      </div>
    </footer>
  );
}
