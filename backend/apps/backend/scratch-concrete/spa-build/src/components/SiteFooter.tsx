import { Link } from "@tanstack/react-router";
import { Phone, Mail, MapPin, Star } from "lucide-react";
import { services } from "@/lib/site";
import { trackPhoneClick, trackReviewClick } from "@/lib/track";
import { Logo } from "./Logo";
import { useLiveAreas, useLiveIdentity, useLiveHours, slugify } from "@/lib/wssc";

export function SiteFooter() {
  const id = useLiveIdentity();
  const areas = useLiveAreas();
  const hours = useLiveHours();

  return (
    <footer className="mt-24 border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo variant="footer" />

            <p className="mt-4 max-w-sm text-sm text-primary-foreground/70">
              Concrete and general contracting in {id.city}, {id.state} — foundations, flatwork, driveways,
              demolition, renovation and flooring, quoted in writing.
            </p>
            {id.profileUrl && (
              <a
                href={id.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackReviewClick("footer")}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground"
              >
                <Star className="h-4 w-4" /> Leave a Google Review
              </a>
            )}

            <ul className="mt-6 space-y-3 text-sm">
              {id.phone && (
                <li>
                  <a
                    href={`tel:${id.phoneDigits ? `+1${id.phoneDigits.replace(/^1/, "")}` : id.phone}`}
                    onClick={() => trackPhoneClick("footer")}
                    className="inline-flex items-center gap-2 hover:text-accent"
                  >
                    <Phone className="h-4 w-4" /> {id.phone}
                  </a>
                </li>
              )}
              {id.email && (
                <li>
                  <a href={`mailto:${id.email}`} className="inline-flex items-center gap-2 hover:text-accent">
                    <Mail className="h-4 w-4" /> {id.email}
                  </a>
                </li>
              )}
              {id.address && (
                <li className="inline-flex items-center gap-2 text-primary-foreground/80">
                  <MapPin className="h-4 w-4" /> {id.address} — {"{{ADDRESS_CITY}}"}, {"{{STATE}}"}
                </li>
              )}
              <li className="inline-flex items-center gap-2 text-primary-foreground/80">
                <MapPin className="h-4 w-4" /> {id.city}, {id.state}
              </li>
              {hours.length > 0 && (
                <li className="text-primary-foreground/60">{hours.join(" · ")}</li>
              )}
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
              {areas.map((name) => (
                <li key={name}>
                  <Link
                    to="/service-area"
                    hash={slugify(name)}
                    className="text-primary-foreground/80 hover:text-primary-foreground"
                  >
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link to="/service-area" className="mt-4 inline-block text-sm text-accent hover:underline">
              See full coverage map →
            </Link>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-primary-foreground/15 pt-6 text-xs text-primary-foreground/60 md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} {id.businessName}. All rights reserved.</p>
          <p>Concrete &amp; general contracting · {id.city}, {id.state}</p>
        </div>
      </div>
    </footer>
  );
}
