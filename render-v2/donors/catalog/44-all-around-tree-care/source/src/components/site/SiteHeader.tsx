/**
 * Site header — driven entirely by config.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Phone, Menu, X } from "lucide-react";
import { CLIENT, FEATURES, BRAND, SERVICES } from "@/config";
import { ThemeToggle } from "@/components/site/ThemeToggle";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/services", label: "Services" },
  ...SERVICES.filter((s, i, all) => s.route !== "/services" && all.findIndex((x) => x.route === s.route) === i).slice(0, 2).map((s) => ({ to: s.route, label: s.name })),
  { to: "/contact", label: "Contact" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 flex items-center justify-between h-20">
        <Link to="/" className="flex items-center gap-3 group" aria-label={`${CLIENT.businessName} home`}>
          <img
            src={BRAND.logoLight}
            alt={CLIENT.businessName}
            className="h-14 w-auto select-none"
            draggable={false}
          />
          <span className="hidden sm:flex flex-col leading-tight">
            <span className="font-bold text-base tracking-tight" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>{CLIENT.businessName}</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{[CLIENT.city, CLIENT.region].filter(Boolean).join(", ")}</span>
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "px-3 py-2 text-sm font-semibold text-primary" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {FEATURES.themeToggle && <ThemeToggle />}
          <a href={`tel:${CLIENT.phoneE164}`} className="hidden md:inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold">
            <Phone className="w-4 h-4" /> {CLIENT.phone}
          </a>
          <button aria-label="Toggle menu" onClick={() => setOpen((o) => !o)} className="lg:hidden p-2 rounded-lg border border-border text-foreground">
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden border-t border-border bg-background">
          <nav className="flex flex-col px-5 py-4 gap-1">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="px-3 py-3 rounded-lg text-sm font-medium text-muted-foreground hover:text-primary hover:bg-muted">
                {n.label}
              </Link>
            ))}
            <a href={`tel:${CLIENT.phoneE164}`} className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold">
              <Phone className="w-4 h-4" /> Call {CLIENT.phone}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
