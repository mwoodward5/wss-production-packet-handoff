import { CLIENT, SITE, SERVICES, PLAN } from "@/lib/wss";
import { Link } from "@tanstack/react-router";
import { BUSINESS, NAV } from "@/lib/business";
import { Phone, Menu, X } from "lucide-react";
import { useState } from "react";

const logo = CLIENT.identity.logoOnLight;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 bg-bone/90 backdrop-blur-md border-b border-ink/10">
      <div className="container-edge flex items-center justify-between h-24">
        <Link to="/" className="flex items-center gap-3.5 group">
          <img
            src={logo}
            alt={BUSINESS.name}
            width={240}
            height={240}
            className="h-16 w-16 md:h-20 md:w-20 object-contain"
          />

          <div className="hidden sm:block leading-tight">
            <div className="font-display text-[18px] md:text-[19px] font-semibold tracking-tight">{BUSINESS.name}</div>
            <div className="eyebrow text-muted-foreground text-[10px] mt-0.5">{BUSINESS.city}, {BUSINESS.state}</div>
          </div>
          <span className="sr-only sm:hidden">{BUSINESS.shortName} home</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-9" aria-label="Primary">
          {NAV.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className="text-[13px] font-medium text-ink/75 hover:text-ink transition-colors"
              activeProps={{ className: "text-ink !font-semibold" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a href={`tel:${BUSINESS.phoneE164}`} className="hidden md:inline-flex items-center gap-2 text-[13px] font-semibold text-ink hover:text-ink/70">
            <Phone size={15} className="text-ink" aria-hidden="true" /> {BUSINESS.phone}
          </a>
          <Link to="/contact" className="hidden md:inline-flex btn-volt !py-2.5 !px-4">Get a quote</Link>
          <button
            onClick={() => setOpen(v => !v)}
            className="lg:hidden p-2 -mr-2"
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden border-t border-ink/10 bg-bone">
          <nav className="container-edge py-4 flex flex-col gap-1" aria-label="Mobile">
            {NAV.map(item => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="py-3 text-base font-medium border-b border-ink/5"
              >
                {item.label}
              </Link>
            ))}
            <a href={`tel:${BUSINESS.phoneE164}`} className="py-3 text-base font-semibold flex items-center gap-2">
              <Phone size={16} className="text-ink" aria-hidden="true" /> {BUSINESS.phone}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

export function StickyMobileCTA() {
  return (
    <div
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-ink text-bone p-3 grid grid-cols-2 gap-2 shadow-[0_-12px_30px_-15px_rgba(0,0,0,0.5)]"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <a href={`tel:${BUSINESS.phoneE164}`} className="flex items-center justify-center gap-2 py-3 border border-bone/30 text-[12px] font-semibold uppercase tracking-[0.14em]">
        <Phone size={14} aria-hidden="true" /> Call now
      </a>
      <Link to="/contact" className="flex items-center justify-center gap-2 py-3 bg-volt text-ink text-[12px] font-bold uppercase tracking-[0.14em]">
        Get a quote
      </Link>
    </div>
  );
}
