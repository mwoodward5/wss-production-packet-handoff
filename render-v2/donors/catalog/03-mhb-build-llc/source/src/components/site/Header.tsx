import { client } from "@/lib/bridge";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Phone, Menu, X, ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";
import { business } from "@/lib/business";
import { Button } from "@/components/ui/button";

const nav = [
  { to: "/", label: "Home" },
  { to: "/services", label: "Services" },
  { to: "/projects", label: "Projects" },
  { to: "/service-area", label: "Service Area" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Estimate" },
];

export const Header = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();

  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`sticky top-0 z-50 transition-all duration-500 ${scrolled ? "bg-background/90 backdrop-blur-xl border-b border-foreground/5" : "bg-transparent"}`}>
      <div className="container-wide flex h-20 items-center justify-between">
        <Link to="/" className="flex items-baseline gap-2.5 group" aria-label={`${business.name} — Home`}>
          <span className="grid h-9 w-9 place-items-center rounded-md bg-foreground text-background font-display text-sm font-semibold tracking-tight">
            <img src={client.identity.logoOnLight} alt={business.name} className="h-full w-full object-contain" />
          </span>
          <span className="font-display text-xl font-light tracking-tight hidden sm:inline">
            <span className="font-medium">{business.name}</span>
          </span>
          <span className="hidden md:inline mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">— {business.city}, {business.state}</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-9">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}
              className={({ isActive }) => `text-sm link-underline ${isActive ? "text-accent font-medium" : "text-foreground/75 hover:text-foreground"}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-5">
          <a href={business.phoneHref} className="flex items-center gap-2 text-sm font-medium text-foreground/85 hover:text-accent transition-colors mono">
            {business.phone}
          </a>
          <Button asChild className="bg-foreground text-background hover:bg-accent hover:text-accent-foreground rounded-full h-11 px-5 transition-colors">
            <Link to="/contact">Request Estimate <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
          </Button>
        </div>

        <button className="lg:hidden p-2" onClick={() => setOpen(!open)} aria-label="Toggle menu" aria-expanded={open}>
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden border-t bg-background/95 backdrop-blur-md">
          <div className="container-wide py-6 flex flex-col gap-4">
            {nav.map(n => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"}
                className={({ isActive }) => `text-base py-2 ${isActive ? "text-accent font-semibold" : "text-foreground/80"}`}>
                {n.label}
              </NavLink>
            ))}
            <a href={business.phoneHref} className="flex items-center gap-2 pt-3 border-t font-semibold text-foreground mono">
              <Phone className="h-4 w-4" /> {business.phone}
            </a>
            <Button asChild className="bg-foreground text-background hover:bg-accent hover:text-accent-foreground w-full rounded-full">
              <Link to="/contact">Request Estimate</Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
};
