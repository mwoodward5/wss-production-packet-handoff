import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Menu, Phone, X } from "lucide-react";
import { BUSINESS } from "@/lib/business";
import { cn } from "@/lib/utils";
import {CLIENT,routeFor} from "@/lib/wss";
const falconLogo=CLIENT.identity.logoOnLight;

const NAV = [...CLIENT.services.map((s,i)=>({to:s.href || routeFor(s),label:s.shortLabel,code:String(i+1).padStart(2,"0")})),{to:"/service-area",label:"Service Area",code:"05"},{to:"/contact",label:"Contact Us",code:"06"}];

export const Header = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors",
        scrolled
          ? "border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
          : "border-transparent bg-background"
      )}
    >
      {/* Top spec bar */}
      <div className="hidden bg-primary text-primary-foreground md:block">
        <div className="container-tight flex h-8 items-center justify-between font-mono text-[11px] uppercase tracking-[0.22em]">
          <span className="text-primary-foreground/70">{BUSINESS.name}</span>
          <span className="flex items-center gap-4 text-primary-foreground/80">
            <span>{BUSINESS.city}, {BUSINESS.region}</span>
            
            {CLIENT.trust.badges.slice(0,1).map(b=><span key={b.label}>{b.label}</span>)}
          </span>
        </div>
      </div>

      {/* Command bar */}
      <div className="container-tight flex h-20 items-center justify-between gap-4 sm:h-24">
        <Link to="/" className="group flex min-w-0 items-center gap-3" aria-label={`${BUSINESS.name} home`}>
          <span className="logo-falcon">
            <span className="logo-halo" aria-hidden="true" />
            <img
              src={falconLogo}
              alt={BUSINESS.name}
              className="logo-img relative z-[1] h-16 w-auto max-w-[300px] object-contain sm:h-20 sm:max-w-[360px]"
              width={360}
              height={120}
            />
            <span className="logo-shine" aria-hidden="true" />
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-2 px-3 py-2 font-display text-[13px] font-bold uppercase tracking-wider transition-colors hover:text-accent",
                  isActive ? "text-accent" : "text-foreground/85"
                )
              }
            >
              <span className="font-mono text-[10px] font-semibold tracking-[0.2em] text-muted-foreground group-hover:text-accent">{n.code}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={`tel:${BUSINESS.phoneTel}`}
            data-event="contact_call_header"
            className="hidden items-center gap-2 border-l-4 border-accent bg-primary px-4 py-2.5 font-display text-sm font-bold tracking-wide text-primary-foreground transition hover:bg-primary/90 sm:inline-flex"
            style={{ borderRadius: "2px" }}
          >
            <Phone className="h-4 w-4 text-accent" />
            <span className="flex flex-col items-start leading-none">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-primary-foreground/70">Direct line</span>
              <span className="mt-0.5">{BUSINESS.phoneDisplay}</span>
            </span>
          </a>
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center border border-border bg-card lg:hidden"
            style={{ borderRadius: "2px" }}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {/* Hairline accent rule */}
      <div className="h-[2px] w-full bg-gradient-to-r from-accent via-signal to-accent" aria-hidden="true" />

      {open && (
        <div className="border-t border-border bg-background lg:hidden">
          <nav className="container-tight flex flex-col py-3" aria-label="Mobile">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 border-b border-border/60 py-3 font-display text-base font-bold uppercase tracking-wider last:border-b-0",
                    isActive ? "text-accent" : "text-foreground"
                  )
                }
              >
                <span className="font-mono text-[11px] text-muted-foreground">{n.code}</span>
                {n.label}
              </NavLink>
            ))}
            <a
              href={`tel:${BUSINESS.phoneTel}`}
              data-event="contact_call_mobile_menu"
              className="btn-falcon mt-4 justify-center"
            >
              <Phone className="h-4 w-4" /> Call {BUSINESS.phoneDisplay}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
};
