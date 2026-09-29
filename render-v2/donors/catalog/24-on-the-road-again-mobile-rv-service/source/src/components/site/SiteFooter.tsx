import { hoursText } from '@/wss/bridge';
import { Link } from "@tanstack/react-router";
import { Phone, MessageSquare, Mail, MapPin, Clock } from "lucide-react";
import { CLIENT, SERVICES, SOCIAL } from "@/config";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-card">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-16 grid gap-12 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="font-serif text-xl font-semibold tracking-tight text-foreground mb-4">
            {CLIENT.businessName}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{CLIENT.shortDescription}</p>
        </div>

        <div>
          <h4 className="text-sm font-semibold tracking-wider uppercase text-primary mb-4">What We Do</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {SERVICES.map((s) => (
              <li key={s.slug}>
                <Link to="/services" hash={s.slug} className="hover:text-foreground">{s.name}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold tracking-wider uppercase text-primary mb-4">Company</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link to="/" className="hover:text-foreground">Home</Link></li>
            <li><Link to="/services" className="hover:text-foreground">Services</Link></li>
            <li><Link to="/about-us" className="hover:text-foreground">About Us</Link></li>
            <li><Link to="/contact" className="hover:text-foreground">Contact</Link></li>
          </ul>
          {SOCIAL.googleMaps && (
            <a href={SOCIAL.googleMaps} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block text-xs text-muted-foreground hover:text-primary">
              View map →
            </a>
          )}
        </div>

        <div>
          <h4 className="text-sm font-semibold tracking-wider uppercase text-primary mb-4">Get In Touch</h4>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3 text-muted-foreground">
              <Phone className="w-4 h-4 mt-0.5 text-primary" />
              <a href={`tel:${CLIENT.phoneE164}`} className="hover:text-foreground">{CLIENT.phone}</a>
            </li>
            {CLIENT.email && <li className="flex items-start gap-3 text-muted-foreground">
              <Mail className="w-4 h-4 mt-0.5 text-primary" />
              {CLIENT.email && <a href={`mailto:${CLIENT.email}`} className="hover:text-foreground break-all">{CLIENT.email}</a>}
            </li>}
            {CLIENT.serviceAreaLabel && <li className="flex items-start gap-3 text-muted-foreground">
              <MapPin className="w-4 h-4 mt-0.5 text-primary" />
              <span>Serving {CLIENT.serviceAreaLabel}</span>
            </li>}
            {hoursText().length > 0 && <li className="flex items-start gap-3 text-muted-foreground">
              <Clock className="w-4 h-4 mt-0.5 text-primary" />
              <div className="text-xs">
                {hoursText().map(line=><div key={line}>{line}</div>)}
              </div>
            </li>}
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-6 flex flex-col md:flex-row gap-3 items-center justify-between text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} {CLIENT.businessName}. All rights reserved.</div>
        </div>
      </div>
    </footer>
  );
}
