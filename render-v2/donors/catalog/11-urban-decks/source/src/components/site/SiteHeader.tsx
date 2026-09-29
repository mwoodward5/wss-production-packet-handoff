import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Phone, Menu, X } from "lucide-react";
import { SITE } from "@/lib/site";
import { CLIENT } from "@/lib/wss";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/services", label: "Services" },
  { to: "/projects", label: "Projects" },
  { to: "/about", label: "About" },
  { to: "/service-area", label: "Service Area" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let ticking = false;
    let lastScrolled = false;
    const update = () => {
      const next = window.scrollY > 12;
      if (next !== lastScrolled) {
        lastScrolled = next;
        setScrolled(next);
      }
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-background/85 backdrop-blur-xl border-b border-border/60"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 md:px-8 md:py-4">
        <Link to="/" className="flex items-center gap-2 group" aria-label={SITE.name + " home"}>
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
              scrolled ? "bg-ink" : "bg-cream/10 ring-1 ring-cream/20 backdrop-blur"
            }`}
          >
            <img src={CLIENT.identity.logoOnDark} alt="" className="h-5 w-auto"  />
          </span>
          <span className={`font-display text-lg md:text-xl font-semibold tracking-tight transition-colors ${scrolled ? "text-foreground" : "text-cream"}`}>
            {SITE.name}
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-8">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`text-sm font-medium transition-colors ${scrolled ? "text-foreground/75 hover:text-foreground" : "text-cream/75 hover:text-cream"}`}
              activeProps={{ className: scrolled ? "text-foreground" : "text-cream" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={SITE.phoneHref}
            className={`hidden md:inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors hover:border-cedar hover:text-cedar ${scrolled ? "border-border/70 bg-background/60 text-foreground" : "border-cream/25 bg-cream/5 text-cream"}`}
          >
            <Phone className="h-3.5 w-3.5" />
            {SITE.phone}
          </a>
          <Link
            to="/contact"
            className="hidden sm:inline-flex items-center gap-2 rounded-full bg-cedar px-5 py-2.5 text-sm font-semibold text-cream btn-magnetic shadow-cedar"
          >
            Contact
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors ${scrolled ? "border-border/70 bg-background/70 text-foreground" : "border-cream/30 bg-cream/10 text-cream backdrop-blur"}`}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 bg-ink/95 backdrop-blur-xl flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <span className="font-display text-xl text-cream">{SITE.name}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-cream"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex-1 px-5 py-8 flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="font-display text-3xl text-cream/90 py-3 border-b border-white/10"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="px-5 pb-8 flex flex-col gap-3">
            <a
              href={SITE.phoneHref}
              className="flex items-center justify-center gap-2 rounded-full border border-cream/30 px-5 py-3 text-cream font-medium"
            >
              <Phone className="h-4 w-4" /> {SITE.phone}
            </a>
            <Link
              to="/contact"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center rounded-full bg-cedar px-5 py-3 text-cream font-semibold"
            >
              Contact
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
