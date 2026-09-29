import { CLIENT, sections } from "@/lib/wss";
import { useEffect, useState } from "react";
import { Phone, Menu, X } from "lucide-react";


export function Nav() {
 const links=sections();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const solid = scrolled || (typeof window !== "undefined" && window.location.pathname !== "/");

  useEffect(() => {
    let ticking = false;
    let lastY = window.scrollY;
    const update = () => { setScrolled(lastY > 24); ticking = false; };
    const onScroll = () => {
      lastY = window.scrollY;
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        solid
          ? "bg-background/90 backdrop-blur-xl border-b border-border shadow-card text-foreground"
          : "bg-transparent text-white"
      }`}
    >
      <div className="container mx-auto px-5 md:px-8 flex items-center justify-between h-16 md:h-20">
        <a href="/#top" className="flex items-center gap-3">
          <img
            src={CLIENT.identity.logoOnDark}
            alt={CLIENT.identity.businessName}
            width={44}
            height={44}
            className={`h-10 w-10 md:h-11 md:w-11 rounded-sm object-contain p-1 ${solid ? "bg-[var(--ink)]" : "bg-white/10 ring-1 ring-white/20"}`}
          />
          <span className="hidden sm:flex flex-col leading-tight">
            <span className="font-display text-sm md:text-base uppercase tracking-tight">
              {CLIENT.identity.businessName}
            </span>
            <span className={`text-[10px] uppercase tracking-[0.2em] ${solid ? "text-muted-foreground" : "text-white/60"}`}>
              {CLIENT.identity.city}, {CLIENT.identity.state}
            </span>
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-7">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium opacity-85 hover:opacity-100 transition-opacity">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href={CLIENT.identity.phoneTel}
            className={`hidden sm:inline-flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-bold uppercase tracking-wider transition shadow-card ${
              solid
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-gradient-warm text-[var(--ink)] hover:scale-[1.02]"
            }`}
          >
            <Phone className="h-4 w-4" />
            {CLIENT.identity.phoneDisplay}
          </a>
          <button
            aria-label="Toggle menu"
            aria-expanded={open}
            className={`lg:hidden p-2 rounded-sm transition ${
              solid
                ? "text-foreground hover:bg-muted"
                : "text-white bg-white/10 hover:bg-white/20 ring-1 ring-white/25"
            }`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden border-t border-border bg-background/98 backdrop-blur-xl text-foreground shadow-card">
          <nav className="container mx-auto px-5 py-4 flex flex-col gap-1">
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="py-3 px-2 rounded-sm text-sm font-medium text-foreground hover:bg-muted">
                {l.label}
              </a>
            ))}
            <a href={CLIENT.identity.phoneTel} className="mt-2 inline-flex items-center justify-center gap-2 rounded-sm bg-primary text-primary-foreground px-4 py-3 text-sm font-bold uppercase tracking-wider">
              <Phone className="h-4 w-4" /> {CLIENT.identity.phoneDisplay}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
