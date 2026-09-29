import { Link, NavLink, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { Menu, X, Phone } from "lucide-react";
import { useClient } from "@/lib/wss";

const nav = [
  { to: "/", label: "Home" },
  { to: "/services", label: "Services" },
  { to: "/projects", label: "Projects" },
  { to: "/service-area", label: "Service Area" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
];

export const SiteHeader = () => {
  const c = useClient();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setOpen(false); }, [loc.pathname]);

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${scrolled ? "backdrop-blur-xl bg-background/95 border-b border-border shadow-sm" : "bg-background/80 backdrop-blur"}`}>
      <div className="container flex items-center justify-between py-3 gap-4">
        <Link to="/" className="flex items-center shrink-0" aria-label={c.identity.businessName + " home"}>
          <img
            src={c.identity.logoOnLight}
            alt={c.identity.businessName}
            className="h-12 md:h-14 w-auto"
          />
        </Link>

        <nav className="hidden lg:flex items-center gap-1">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}
              className={({ isActive }) => `px-3 py-2 rounded-md text-sm transition-colors ${isActive ? "text-primary font-semibold" : "text-foreground/70 hover:text-foreground"}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <a href={c.identity.phoneTel} className="inline-flex items-center gap-2 rounded-full bg-secondary text-secondary-foreground px-5 py-2.5 text-sm font-medium shadow-glow hover:scale-[1.02] transition-transform">
            <Phone className="w-4 h-4" /> {c.identity.phoneDisplay}
          </a>
        </div>

        <button onClick={() => setOpen(v => !v)} className="lg:hidden p-2 rounded-md border border-border bg-background text-foreground" aria-label="Menu" aria-expanded={open}>
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden fixed left-0 right-0 top-[68px] z-50 border-t border-border bg-background shadow-lg max-h-[calc(100vh-68px)] overflow-y-auto">
          <div className="container py-4 flex flex-col gap-1">
            {nav.map(n => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"}
                className={({ isActive }) => `px-3 py-3 rounded-md text-base ${isActive ? "text-primary bg-muted font-semibold" : "text-foreground hover:bg-muted"}`}>
                {n.label}
              </NavLink>
            ))}
            <a href={c.identity.phoneTel} className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-secondary text-secondary-foreground px-5 py-3 text-sm font-medium">
              <Phone className="w-4 h-4" /> Call {c.identity.phoneDisplay}
            </a>
          </div>
        </div>
      )}
    </header>
  );
};
