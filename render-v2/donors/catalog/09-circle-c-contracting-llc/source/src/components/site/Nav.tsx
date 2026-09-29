import { useClient } from "@/wss/bridge";
import { useEffect, useState } from "react";
import { Phone, Menu, X } from "lucide-react";


const baseLinks = [
  { href: "#services", label: "Services" },
  { href: "#work", label: "Work" },
  { href: "#why", label: "Why Us" },
  { href: "#process", label: "Process" },
  { href: "#area", label: "Service Area" },
  { href: "#contact", label: "Contact" },
];

export function Nav({solid = false}: {solid?: boolean}) {
  const {client, plan} = useClient();
  const links = baseLinks.filter(l => l.href !== '#process' && (l.href !== '#work' || client.media.some(m => m.role === 'gallery')) && (l.href !== '#area' || client.trust.areas.length > 0)).map(l => ({...l, href: '/' + l.href}));
  const [scrolled, setScrolled] = useState(solid);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(solid || window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [solid]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-background/95 backdrop-blur border-b border-border shadow-card"
          : "bg-transparent"
      }`}
    >
      <div className="container-tight flex items-center justify-between h-16 md:h-20">
        <a href="/#top" className="flex items-center gap-3">
          <img
            src={scrolled ? client.identity.logoOnLight : client.identity.logoOnDark}
            alt={client.identity.businessName + " logo"}
            width={48}
            height={48}
            className="h-10 w-10 md:h-12 md:w-12 object-contain"
          />
          <div className="leading-tight hidden sm:block">
            <div
              className={`font-display text-base md:text-lg font-bold tracking-wide ${
                scrolled ? "text-accent" : "text-accent"
              }`}
            >
              {client.identity.businessName}
            </div>
            <div
              className={`text-[11px] uppercase tracking-[0.18em] ${
                scrolled ? "text-muted-foreground" : "text-primary-foreground/80"
              }`}
            >
              {client.identity.city}, {client.identity.state}
            </div>
          </div>
        </a>

        <nav className="hidden lg:flex items-center gap-8">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`text-sm font-medium transition-colors hover:text-accent ${
                scrolled ? "text-foreground" : "text-primary-foreground"
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href={client.identity.phoneTel}
            className="hidden md:inline-flex items-center gap-2 bg-gradient-amber text-accent-foreground font-semibold px-4 py-2.5 rounded-md shadow-card hover:brightness-105 transition"
          >
            <Phone className="h-4 w-4" />
            <span>{client.identity.phoneDisplay}</span>
          </a>
          <button
            type="button"
            aria-label="Toggle menu" aria-expanded={open}
            className={`lg:hidden p-2 rounded-md ${scrolled ? "text-foreground" : "text-primary-foreground"}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden bg-background border-t border-border shadow-card">
          <div className="container-tight py-4 flex flex-col gap-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="py-3 px-2 text-foreground font-medium border-b border-border/60 last:border-0"
              >
                {l.label}
              </a>
            ))}
            <a
              href={client.identity.phoneTel}
              className="mt-3 inline-flex items-center justify-center gap-2 bg-gradient-amber text-accent-foreground font-semibold px-4 py-3 rounded-md"
            >
              <Phone className="h-4 w-4" /> Call {client.identity.phoneDisplay}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}