import { client } from "@/lib/bridge";
import { Link } from "react-router-dom";
import { Phone, Mail, MapPin } from "lucide-react";
import { business, services } from "@/lib/business";

export const Footer = () => (
  <footer className="bg-primary text-primary-foreground mt-20">
    <div className="container-tight py-16 grid gap-10 md:grid-cols-4">
      <div className="md:col-span-1">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-accent text-accent-foreground font-display text-sm font-semibold"><img src={client.identity.logoOnDark} alt={business.name} className="h-full w-full object-contain" /></span>
          <span className="font-display text-xl font-light">{business.name}</span>
        </Link>
        <p className="mt-4 text-sm text-primary-foreground/70 leading-relaxed">
          {business.tagline}
        </p>
      </div>

      <div>
        <h4 className="font-display text-lg mb-4">Explore</h4>
        <ul className="space-y-2 text-sm text-primary-foreground/80">
          <li><Link to="/" className="hover:text-accent">Home</Link></li>
          <li><Link to="/services" className="hover:text-accent">Services</Link></li>
          <li><Link to="/projects" className="hover:text-accent">Projects</Link></li>
          <li><Link to="/service-area" className="hover:text-accent">Service Area</Link></li>
          <li><Link to="/about" className="hover:text-accent">About</Link></li>
          <li><Link to="/contact" className="hover:text-accent">Request Estimate</Link></li>
        </ul>
      </div>

      <div>
        <h4 className="font-display text-lg mb-4">Services</h4>
        <ul className="space-y-2 text-sm text-primary-foreground/80">
          {services.slice(0, 7).map(s => (
            <li key={s.slug}><Link to={`/services/${s.slug}`} className="hover:text-accent">{s.name}</Link></li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="font-display text-lg mb-4">Contact</h4>
        <ul className="space-y-3 text-sm text-primary-foreground/80">
          <li className="flex gap-2"><MapPin className="h-4 w-4 mt-0.5 shrink-0 text-accent" />{business.city}, {business.state}{business.region && ` — ${business.region}`}</li>
          <li className="flex gap-2"><Phone className="h-4 w-4 mt-0.5 shrink-0 text-accent" /><a href={business.phoneHref} className="hover:text-accent">{business.phone}</a></li>
          {business.email && <li className="flex gap-2"><Mail className="h-4 w-4 mt-0.5 shrink-0 text-accent" /><a href={business.emailHref} className="hover:text-accent break-all">{business.email}</a></li>}
        </ul>
      </div>
    </div>
    <div className="border-t border-primary-foreground/10">
      <div className="container-tight py-6 flex flex-col sm:flex-row gap-3 justify-between text-xs text-primary-foreground/60">
        <p>© {new Date().getFullYear()} {business.legalName}. All rights reserved.</p>
        <p>{business.city}, {business.state} · {business.region}</p>
      </div>
    </div>
  </footer>
);
