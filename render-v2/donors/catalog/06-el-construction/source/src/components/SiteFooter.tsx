import { Link } from "@tanstack/react-router";
import { Phone, Mail, MapPin, Star } from "lucide-react";
import { site, services, client } from "@/lib/site";
import { citiesData } from "@/lib/cities-data";
import { trackPhoneClick, trackReviewClick } from "@/lib/track";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo variant="footer" />

            <p className="mt-4 max-w-sm text-sm text-primary-foreground/70">
              {client.content.seasonalNote}
            </p>


            <ul className="mt-6 space-y-3 text-sm">
              <li>
                <a
                  href={`tel:${site.phoneTel}`}
                  onClick={() => trackPhoneClick("footer")}
                  className="inline-flex items-center gap-2 hover:text-accent"
                >
                  <Phone className="h-4 w-4" /> {site.phone}
                </a>
              </li>
              {site.email && <li>
                <a href={`mailto:${site.email}`} className="inline-flex items-center gap-2 hover:text-accent">
                  <Mail className="h-4 w-4" /> {site.email}
                </a>
              </li>}
              <li className="inline-flex items-center gap-2 text-primary-foreground/80">
                <MapPin className="h-4 w-4" /> {site.city}, {site.state}
              </li>
              <li className="text-primary-foreground/60">{site.hours}</li>
              {client.trust.socials.map((url,index)=><li key={url}><a href={url} className="underline">Social profile {index+1}</a></li>)}
              {client.trust.bookingUrl && <li><a href={client.trust.bookingUrl} className="inline-flex rounded-full bg-gradient-gold px-5 py-2.5 text-gold-foreground">Book an appointment</a></li>}
            </ul>
          </div>

          <div>
            <h4 className="font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground/60">
              Services
            </h4>
            <ul className="mt-4 space-y-2 text-sm">
              {services.map((s) => (
                <li key={s.slug}>
                  <Link to={`/${s.slug}` as string} className="text-primary-foreground/80 hover:text-primary-foreground">
                    {s.title}
                  </Link>
                </li>
              ))}
              <li className="pt-2">
                <Link to="/about" className="text-primary-foreground/80 hover:text-primary-foreground">About Us</Link>
              </li>
              <li>
                <Link to="/contact" className="text-primary-foreground/80 hover:text-primary-foreground">Contact</Link>
              </li>
            </ul>
          </div>

          <div className="lg:col-span-2">
            <h4 className="font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground/60">
              Service Area
            </h4>
            <ul className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
              {citiesData.map((c) => (
                <li key={c.slug}>
                  <Link
                    to="/service-area/$citySlug"
                    params={{ citySlug: c.slug }}
                    className="text-primary-foreground/80 hover:text-primary-foreground"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link to="/service-area" className="mt-4 inline-block text-sm text-accent hover:underline">
              See service area →
            </Link>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-primary-foreground/15 pt-6 text-xs text-primary-foreground/60 md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} {site.legalName}. All rights reserved.</p>
          <p>{site.city}, {site.state}</p>
        </div>
      </div>
    </footer>
  );
}
