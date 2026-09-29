import {client,serviceList} from "@/lib/bridge";
import { Link } from "@tanstack/react-router";
import { Phone, Mail, MapPin, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { business } from "@/lib/business";

const LOGO_SRC = client.identity.logoOnLight;
const LOGO_ALT = client.identity.businessName+" logo";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/services", label: "Services" },
  { to: "/drywall", label: "Drywall" },
  { to: "/plaster", label: "Plaster" },
  { to: "/painting", label: "Painting" },
  { to: "/about", label: "About" },
  { to: "/reviews", label: "Reviews" },
  { to: "/gallery", label: "Gallery" },
  { to: "/service-area", label: "Service Area" },
  { to: "/contact", label: "Contact" },
].filter(n=>!["/drywall","/plaster","/painting"].includes(n.to)||serviceList(n.to.slice(1)).length);

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* utility bar */}
      <div className="hidden md:block bg-ink text-bone">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 flex h-9 items-center justify-between text-[12px]">
          <div className="flex items-center gap-5 font-mono tracking-wider uppercase opacity-90">
            <span className="inline-flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-amber" />{business.city}, {business.state} {business.zip}</span>
            <span className="opacity-40">/</span>
            <span>{client.hero.eyebrow}</span>
          </div>
          <div className="flex items-center gap-5">
            {business.email && (<a href={`mailto:${business.email}`} className="inline-flex items-center gap-2 hover:text-amber transition-colors"><Mail className="h-3.5 w-3.5" />{business.email}</a>)}
            <a href={`tel:${business.phoneRaw}`} className="inline-flex items-center gap-2 hover:text-amber transition-colors"><Phone className="h-3.5 w-3.5" />{business.phone}</a>
          </div>
        </div>
      </div>

      <header
        className={
          "sticky top-0 z-40 transition-all duration-300 " +
          (scrolled
            ? "bg-background/85 backdrop-blur-md border-b border-border shadow-soft"
            : "bg-background border-b border-transparent")
        }
      >
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 flex h-20 lg:h-28 items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-3 group shrink-0" aria-label={LOGO_ALT}>
            {LOGO_SRC && (<img
              src={LOGO_SRC}
              alt={LOGO_ALT}
              className="h-16 sm:h-20 lg:h-24 w-auto object-contain"
              loading="eager"
              decoding="async"
            />)}
          </Link>

          <nav className="hidden lg:flex items-center gap-1 text-[14px]">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="px-3 py-2 rounded-sm text-ink/80 hover:text-ink hover:bg-secondary transition-colors"
                activeProps={{ className: "px-3 py-2 rounded-sm text-ink bg-secondary font-medium" }}
                activeOptions={{ exact: n.to === "/" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={`tel:${business.phoneRaw}`}
              className="hidden md:inline-flex items-center gap-2 px-4 py-2.5 rounded-sm bg-ink text-bone hover:bg-iron transition-colors text-[13px] font-medium"
            >
              <Phone className="h-4 w-4 text-amber" />
              {business.phone}
            </a>
            <Link
              to="/contact"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-sm bg-amber text-ink hover:brightness-95 transition-all text-[13px] font-semibold shadow-amber"
            >
              Contact
            </Link>
            <button
              aria-label="Open menu"
              className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-sm border border-border"
              onClick={() => setOpen((v) => !v)}
            >
              <span className="sr-only">Menu</span>
              <div className="space-y-1.5">
                <span className="block h-0.5 w-5 bg-ink" />
                <span className="block h-0.5 w-5 bg-ink" />
                <span className="block h-0.5 w-5 bg-ink" />
              </div>
            </button>
          </div>
        </div>

        {open && (
          <div className="lg:hidden border-t border-border bg-background">
            <nav className="px-6 py-4 grid gap-1 text-[15px]">
              {NAV.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className="py-2 text-ink/85"
                  activeProps={{ className: "py-2 text-ink font-semibold" }}
                  activeOptions={{ exact: n.to === "/" }}
                >
                  {n.label}
                </Link>
              ))}
              <a href={`tel:${business.phoneRaw}`} className="mt-2 inline-flex items-center gap-2 px-4 py-3 rounded-sm bg-ink text-bone">
                <Phone className="h-4 w-4 text-amber" /> {business.phone}
              </a>
              <a href="/contact" className="inline-flex items-center gap-2 px-4 py-3 rounded-sm bg-secondary text-ink">
                <MessageSquare className="h-4 w-4" /> Contact us
              </a>
            </nav>
          </div>
        )}
      </header>
    </>
  );
}

export function StickyMobileCTA() {
  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-2 gap-px border-t border-border bg-ink/95 backdrop-blur-md">
      <a href={`tel:${business.phoneRaw}`} className="flex items-center justify-center gap-2 py-3.5 text-bone text-[14px] font-medium">
        <Phone className="h-4 w-4 text-amber" /> Call Now
      </a>
      <a href="/contact" className="flex items-center justify-center gap-2 py-3.5 bg-amber text-ink text-[14px] font-semibold">
        <MessageSquare className="h-4 w-4" /> Contact us
      </a>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative bg-ink text-bone">
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-amber to-transparent" />
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-20 pb-10">
        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            {LOGO_SRC && (<img
              src={LOGO_SRC}
              alt={LOGO_ALT}
              className="h-24 lg:h-28 w-auto object-contain mb-6 bg-bone p-3 rounded-sm"
              loading="lazy"
              decoding="async"
            />)}
            <div className="eyebrow !text-bone/60">{client.trust.badges.map(b=>b.label).join(" · ")}</div>
            <h2 className="mt-4 font-display text-[34px] lg:text-[44px] leading-[1.05] text-bone">
              <span className="text-amber italic">{business.name}</span>
            </h2>
            <p className="mt-5 max-w-md text-bone/70 leading-relaxed">{client.content.ctaBody}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={`tel:${business.phoneRaw}`} className="inline-flex items-center gap-2 px-5 py-3 rounded-sm bg-amber text-ink font-semibold text-[14px]">
                <Phone className="h-4 w-4" /> {business.phone}
              </a>
              <a href="/contact" className="inline-flex items-center gap-2 px-5 py-3 rounded-sm border border-bone/20 text-bone hover:bg-bone/5 text-[14px]">
                <MessageSquare className="h-4 w-4" /> Contact us
              </a>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="eyebrow !text-bone/50">Pages</div>
            <ul className="mt-4 space-y-2 text-[14px] text-bone/80">
              {NAV.map((n) => (
                <li key={n.to}><Link to={n.to} className="hover:text-amber transition-colors">{n.label}</Link></li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2">
            <div className="eyebrow !text-bone/50">Reach Us</div>
            <ul className="mt-4 space-y-2 text-[14px] text-bone/80">
              <li><a href={business.websiteSource} target="_blank" rel="noreferrer" className="hover:text-amber">Official site</a></li>
              <li>{business.googleMaps && (<a href={business.googleMaps} target="_blank" rel="noreferrer" className="hover:text-amber">Google Maps</a>)}</li>
              <li>{business.googleReview && (<a href={business.googleReview} target="_blank" rel="noreferrer" className="hover:text-amber">Google reviews</a>)}</li>
              <li>{business.facebook && (<a href={business.facebook} target="_blank" rel="noreferrer" className="hover:text-amber">Facebook</a>)}</li>
              <li>{business.angi && (<a href={business.angi} target="_blank" rel="noreferrer" className="hover:text-amber">Angi</a>)}</li>
              <li>{business.yelp && (<a href={business.yelp} target="_blank" rel="noreferrer" className="hover:text-amber">Yelp</a>)}</li>
              <li>{business.bbb && (<a href={business.bbb} target="_blank" rel="noreferrer" className="hover:text-amber">BBB profile</a>)}</li>
            </ul>
          </div>

          <div className="lg:col-span-2">
            <div className="eyebrow !text-bone/50">Local</div>
            <ul className="mt-4 space-y-2 text-[14px] text-bone/80">
              <li>{business.city}, {business.state} {business.zip}</li>
              <li><a href={`tel:${business.phoneRaw}`} className="hover:text-amber">{business.phone}</a></li>
              <li className="break-all">{business.email && (<a href={`mailto:${business.email}`} className="hover:text-amber">{business.email}</a>)}</li>
            </ul>
          </div>
        </div>

        <div className="mt-16 pt-6 border-t border-bone/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[12px] text-bone/55 font-mono uppercase tracking-wider">
          <div>© {new Date().getFullYear()} {business.name}. All rights reserved.</div>
          <div className="flex items-center gap-4">
            <Link to="/privacy-policy" className="hover:text-amber">Privacy Policy</Link>
            <span className="hidden sm:inline">{business.region}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
