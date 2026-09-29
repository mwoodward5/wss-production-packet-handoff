import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, Phone, X, MessageSquare, ChevronDown } from "lucide-react";
import { client } from "@/lib/wss-bridge";
const ftsLogo = client.identity.logoOnDark;
import { BUSINESS, TEL_HREF, SMS_HREF } from "@/lib/business";
import { SERVICES, CITIES } from "@/lib/services-data";
import { cn } from "@/lib/utils";

const NAV_TOP = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [areasOpen, setAreasOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="group flex items-center gap-3" aria-label={`${BUSINESS.name} home`}>
          <span className="relative grid h-12 w-12 place-items-center rounded-full bg-[oklch(0.16_0.02_155)] ring-1 ring-[oklch(0.71_0.135_70)]/40 shadow-[0_8px_24px_-10px_oklch(0_0_0/0.45)] transition-transform group-hover:rotate-3">
            <img src={ftsLogo} alt="" aria-hidden className="h-10 w-10 object-contain" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-serif text-[19px] font-semibold tracking-tight text-foreground sm:text-[21px]">
              {BUSINESS.name}
            </span>
            <span className="mt-1 font-serif text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
              {BUSINESS.city}, {BUSINESS.region}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Main">
          <Link to="/" className="text-sm font-medium text-foreground/80 transition-colors hover:text-primary" activeProps={{ className: "text-primary font-semibold" }} activeOptions={{ exact: true }}>Home</Link>

          <div className="relative" onMouseEnter={() => setServicesOpen(true)} onMouseLeave={() => setServicesOpen(false)}>
            <Link to="/services" className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 transition-colors hover:text-primary" activeProps={{ className: "text-primary font-semibold" }}>
              Services <ChevronDown className="h-3.5 w-3.5" />
            </Link>
            {servicesOpen && (
              <div className="absolute left-0 top-full w-72 rounded-xl border border-border bg-popover p-2 shadow-elegant">
                {SERVICES.map((s) => (
                  <Link key={s.slug} to={s.path} className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">
                    {s.title}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="relative" onMouseEnter={() => setAreasOpen(true)} onMouseLeave={() => setAreasOpen(false)}>
            <Link to="/service-area" className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 transition-colors hover:text-primary" activeProps={{ className: "text-primary font-semibold" }}>
              Service Area <ChevronDown className="h-3.5 w-3.5" />
            </Link>
            {areasOpen && (
              <div className="absolute left-0 top-full w-64 rounded-xl border border-border bg-popover p-2 shadow-elegant">
                {CITIES.map((c) => (
                  <Link key={c.slug} to={c.path} className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">
                    {c.city}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {NAV_TOP.filter((n) => n.to !== "/").map((item) => (
            <Link key={item.to} to={item.to} className="text-sm font-medium text-foreground/80 transition-colors hover:text-primary" activeProps={{ className: "text-primary font-semibold" }}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <a href={SMS_HREF} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-smooth hover:bg-muted">
            <MessageSquare className="h-4 w-4" aria-hidden /> Contact
          </a>
          <a href={TEL_HREF} className="inline-flex items-center gap-1.5 rounded-md bg-cta-gradient px-4 py-2 text-sm font-semibold text-accent-foreground shadow-amber transition-smooth hover:opacity-95">
            <Phone className="h-4 w-4" aria-hidden /> {BUSINESS.phoneDisplay}
          </a>
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={open}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border lg:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div className={cn("border-t border-border bg-background lg:hidden", open ? "block" : "hidden")}>
        <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3" aria-label="Mobile">
          <Link to="/" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted" activeProps={{ className: "bg-muted text-primary" }} activeOptions={{ exact: true }}>Home</Link>

          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
              <span>Services</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="ml-2 mt-1 flex flex-col gap-0.5 border-l border-border pl-3">
              <Link to="/services" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-semibold text-primary hover:bg-muted">All Services</Link>
              {SERVICES.map((s) => (
                <Link key={s.slug} to={s.path} onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-muted">
                  {s.title}
                </Link>
              ))}
            </div>
          </details>

          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
              <span>Service Area</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="ml-2 mt-1 flex flex-col gap-0.5 border-l border-border pl-3">
              <Link to="/service-area" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-semibold text-primary hover:bg-muted">Full Service Area</Link>
              {CITIES.map((c) => (
                <Link key={c.slug} to={c.path} onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-muted">
                  {c.city}
                </Link>
              ))}
            </div>
          </details>

          {NAV_TOP.filter((n) => n.to !== "/").map((item) => (
            <Link key={item.to} to={item.to} onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted" activeProps={{ className: "bg-muted text-primary" }}>
              {item.label}
            </Link>
          ))}

          <div className="mt-2 grid grid-cols-2 gap-2">
            <a href={SMS_HREF} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4" /> Contact
            </a>
            <a href={TEL_HREF} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-cta-gradient px-3 py-2 text-sm font-semibold text-accent-foreground">
              <Phone className="h-4 w-4" /> Call
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}
