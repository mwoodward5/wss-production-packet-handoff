import { Link } from "react-router-dom";
import { Phone, Mail, MapPin } from "lucide-react";
import { useClient, hoursText } from "@/lib/wss";
import { GoogleReviewButton, BbbSeal, GeneracDealerBadge } from "./ReviewsTrust";

export const SiteFooter = () => { const c=useClient(); return (
  <footer className="border-t border-border mt-24 bg-gradient-card">
    <div className="container py-16 grid gap-12 md:grid-cols-4">
      <div className="md:col-span-2">
        <Link to="/" className="inline-block">
          <img src={c.identity.logoOnLight} alt={c.identity.businessName} className="h-16 w-auto" />
        </Link>
        <p className="mt-5 max-w-md text-muted-foreground text-sm leading-relaxed">
          {c.content.about}
        </p>
        <p className="mt-4 max-w-md text-foreground text-sm italic">
          {c.content.seasonalNote}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <GoogleReviewButton />
          <BbbSeal />
        </div>
        <div className="mt-6 flex items-center gap-3">
          <GeneracDealerBadge />
          
        </div>
      </div>

      <div>
        <h4 className="font-display text-base mb-4">Services</h4>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {c.services.map(s => (
            <li key={s.name}><Link to={s.href} className="hover:text-primary">{s.name}</Link></li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="font-display text-base mb-4">Contact</h4>
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li><a href={c.identity.phoneTel} className="inline-flex items-center gap-2 hover:text-primary"><Phone className="w-4 h-4 text-secondary" /> {c.identity.phoneDisplay}</a></li>
          {c.identity.email && <li><a href={"mailto:" + c.identity.email} className="inline-flex items-center gap-2 hover:text-primary"><Mail className="w-4 h-4 text-secondary" /> {c.identity.email}</a></li>}
          {c.trust.areas.length > 0 && <li className="inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-secondary" /> {c.trust.areas.join(" · ")}</li>}
          {hoursText(c) && <li>{hoursText(c)}</li>}
          {c.trust.socials.map((url,i)=><li key={url}><a href={url} rel="noopener noreferrer" target="_blank">Social profile {i+1}</a></li>)}
        </ul>
        <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
          <li><Link to="/services" className="hover:text-primary">All Services</Link></li>
          <li><Link to="/about" className="hover:text-primary">About</Link></li>
          <li><Link to="/service-area" className="hover:text-primary">Service Area</Link></li>
          <li><Link to="/faq" className="hover:text-primary">FAQ</Link></li>
          <li><Link to="/contact" className="hover:text-primary">Contact</Link></li>
        </ul>
      </div>
    </div>
    <div className="border-t border-border">
      <div className="container py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        <div>© {new Date().getFullYear()} {c.identity.businessName}. All rights reserved.</div>
        <div>{c.identity.city}, {c.identity.state}</div>
      </div>
    </div>
  </footer>
); };
