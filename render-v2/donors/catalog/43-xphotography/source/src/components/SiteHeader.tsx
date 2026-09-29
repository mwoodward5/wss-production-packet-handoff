import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Menu, X, Phone } from "lucide-react";
import Monogram from "./Monogram";

import { useSite, serviceHref } from "@/wss/bridge";

export default function SiteHeader() {
  const {client}=useSite();
  const nav=[...client.services.map((s,i)=>({to:serviceHref(s,i),label:s.shortLabel})),{to:"/about",label:"About"}];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 backdrop-blur-md ${scrolled || open ? "bg-paper/90 border-b border-hairline" : "bg-paper/70"}`}>
      <div className="max-w-[1600px] mx-auto px-6 lg:px-10 flex items-center justify-between h-24">
        <Link to="/" className="text-ivory hover:text-molten transition">
          <Monogram size={64} withWordmark animated />
        </Link>

        <nav className="hidden lg:flex items-center gap-8">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to}
              className={({ isActive }) =>
                `label-eyebrow transition relative ${isActive ? "text-molten" : "text-ivory/70 hover:text-ivory"}`
              }>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-4">
          <a href={client.identity.phoneTel} className="hidden xl:inline-flex items-center gap-2 label-eyebrow text-ivory/70 hover:text-molten">
            <Phone className="w-3.5 h-3.5 text-molten" /> {client.identity.phoneDisplay}
          </a>
          <Link to="/reserve" className="px-5 py-3 bg-molten text-white label-eyebrow hover:bg-ivory hover:text-white transition-colors">
            Reserve
          </Link>
        </div>

        <button onClick={() => setOpen(!open)} className="lg:hidden text-ivory" aria-label="Menu" aria-expanded={open}>
          {open ? <X /> : <Menu />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden bg-paper border-t border-hairline">
          <div className="px-6 py-8 flex flex-col gap-5">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className="font-display text-3xl text-ivory">
                {n.label}
              </NavLink>
            ))}
            <Link to="/reserve" className="font-display text-3xl text-molten">Reserve →</Link>
            <a href={client.identity.phoneTel} className="label-eyebrow text-ivory/70 flex items-center gap-2 mt-4">
              <Phone className="w-3.5 h-3.5 text-molten" /> {client.identity.phoneDisplay}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
