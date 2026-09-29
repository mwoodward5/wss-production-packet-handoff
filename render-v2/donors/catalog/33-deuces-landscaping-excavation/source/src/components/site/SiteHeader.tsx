/**
 * Site header — DEUCES, 5-page nav.
 */
import { Link } from "@/wss/Link";
import { useState } from "react";
import { Phone, Menu, X } from "lucide-react";
import { CLIENT, BRAND } from "@/config";
import { ThemeToggle } from "./ThemeToggle";

import { NAV } from '@/wss/bridge';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 flex items-center justify-between h-20">
        <Link to="/" className="flex items-center gap-3 group" aria-label={CLIENT.businessName}>
          <span className="logo-plaque">
            <img
              src={BRAND.logoDark}
              alt={`${CLIENT.businessName} logo`}
              className="h-9 md:h-10 w-auto block"
              width={180}
              height={40}
            />
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
          <ThemeToggle />
          <a href={`tel:${CLIENT.phoneE164}`} className="hidden md:inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold shadow-sm hover:brightness-105 transition">
            <Phone className="w-4 h-4" /> {CLIENT.phone}
          </a>
          <button
            aria-label="Toggle menu"
            onClick={() => setOpen((o) => !o)}
            className="lg:hidden p-2 rounded-lg border border-border text-foreground"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden border-t border-border bg-background">
          <nav className="flex flex-col px-5 py-4 gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className="px-3 py-3 rounded-lg text-sm font-medium text-muted-foreground hover:text-primary hover:bg-muted"
              >
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
