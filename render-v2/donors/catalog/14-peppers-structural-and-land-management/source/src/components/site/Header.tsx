import {site} from "@/lib/wss";
import { Link } from "@/lib/navigation";
import { useState } from "react";
import { business } from "@/lib/business";


const nav = [
  { to: "/services", label: "Services" },
  { to: "/gallery", label: "Gallery" },
  { to: "/about", label: "About" },
  { to: "/reviews", label: "Reviews" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
] as const;

export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="relative z-50 border-b border-rule bg-cream/85 backdrop-blur supports-[backdrop-filter]:bg-cream/70">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-5 py-4 lg:px-10">
        <Link to="/" className="group flex items-center gap-3">
          <img
            src={site.identity.logoOnLight}
            alt={business.name}
            className="h-12 w-auto sm:h-14"
          />
          <span className="hidden sm:flex flex-col leading-tight">
            <span className="font-display text-[15px] tracking-tight text-ink">{business.name}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber">{business.city}, {business.state}</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-9 lg:flex">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="font-mono text-[11px] uppercase tracking-[0.22em] text-charcoal hover:text-ink link-underline"
              activeProps={{ className: "text-ink" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a
            href={`tel:${business.phoneTel}`}
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-charcoal hover:text-ink"
          >
            {business.phone}
          </a>
          <Link to="/contact" className="btn-primary">
            Request an Estimate
            <span aria-hidden>→</span>
          </Link>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
          className="lg:hidden flex h-10 w-10 items-center justify-center border border-ink"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <div className="flex flex-col gap-[5px]">
            <span className="block h-[1.5px] w-5 bg-ink" />
            <span className="block h-[1.5px] w-5 bg-ink" />
          </div>
        </button>
      </div>

      {open && (
        <div className="border-t border-rule bg-cream lg:hidden">
          <nav className="mx-auto flex max-w-[1400px] flex-col px-5 py-4">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="border-b border-rule py-4 font-display text-2xl text-ink"
              >
                {item.label}
              </Link>
            ))}
            <a
              href={`tel:${business.phoneTel}`}
              className="border-b border-rule py-4 font-mono text-[11px] uppercase tracking-[0.22em] text-umber"
            >
              Call · {business.phone}
            </a>
            <Link to="/contact" onClick={() => setOpen(false)} className="btn-primary mt-5 justify-center">
              Request an Estimate →
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
