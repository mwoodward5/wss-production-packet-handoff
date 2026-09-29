import {getClient} from '@/wss/bridge';
const client=getClient();
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";


type NavItem = {
  to: "/training" | "/seminars" | "/arts" | "/media" | "/contact";
  label: string;
  sub?: Array<{ to: NavItem["to"]; label: string; note: string }>;
};

const nav:NavItem[]=[{to:'/training',label:'Training',sub:client.services.slice(0,3).map(s=>({to:'/training',label:s.shortLabel,note:''}))},{to:'/seminars',label:'Seminars'},{to:'/arts',label:'Arts'},{to:'/media',label:'Media'},{to:'/contact',label:'Contact'}];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 80);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${scrolled ? "glass" : "bg-transparent"}`}
      onMouseLeave={() => setHover(null)}
    >
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-5 md:px-10 md:py-6">
        <Link to="/" className="group flex items-center gap-4" aria-label={client.identity.businessName + " — home"}>
          <BrandMark size={52} className="text-edge stamp-in" />
          <span className="leading-none">
            <span className="brand-shimmer block font-serif text-2xl tracking-tight md:text-[28px]">
              {client.identity.businessName}
            </span>
            <span className="eyebrow mt-2 block text-[10px] text-bone-dim">
              {client.identity.city}
            </span>
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {nav.map((n) => (
            <div key={n.to} className="relative" onMouseEnter={() => setHover(n.label)}>
              <Link
                to={n.to}
                className="eyebrow text-[11px] text-bone-dim transition-colors hover:text-bone"
                activeProps={{ className: "eyebrow text-[11px] text-edge" }}
              >
                {n.label}
              </Link>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/contact"
            className="eyebrow hidden rounded-full border border-bone/30 px-4 py-2 text-bone transition-colors hover:border-edge hover:text-edge md:inline-flex"
          >
            Contact
          </Link>
          <button
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-11 w-11 flex-col items-center justify-center gap-1.5 md:hidden"
          >
            <span className={`h-px w-6 bg-bone transition-transform ${open ? "translate-y-[3px] rotate-45" : ""}`} />
            <span className={`h-px w-6 bg-bone transition-transform ${open ? "-translate-y-[3px] -rotate-45" : ""}`} />
          </button>
        </div>
      </div>

      {/* Desktop mega-hint */}
      {hover && (
        <div className="glass hidden border-t border-hairline md:block">
          <div className="mx-auto flex max-w-[1440px] gap-8 px-6 py-5 md:px-10">
            {nav.find((n) => n.label === hover)?.sub?.map((s, i) => (
              <Link key={i} to={s.to} className="group flex-1">
                <div className="eyebrow text-[10px] text-edge">{s.label}</div>
                <div className="mt-1 text-sm text-bone-dim group-hover:text-bone">{s.note}</div>
              </Link>
            ))}
            {!nav.find((n) => n.label === hover)?.sub && (
              <div className="text-sm text-bone-dim">Reach out — direct inquiries only.</div>
            )}
          </div>
        </div>
      )}

      {/* Mobile menu */}
      {open && (
        <div className="glass border-t border-hairline md:hidden">
          <nav aria-label="Mobile" className="mx-auto flex max-w-[1440px] flex-col px-6 py-4">
            {nav.map((n) => (
              <div key={n.to} className="border-b border-hairline py-4">
                <Link
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className="block font-serif text-2xl text-bone"
                >
                  {n.label}
                </Link>
                {n.sub && (
                  <ul className="mt-2 space-y-1">
                    {n.sub.map((s, i) => (
                      <li key={i}>
                        <Link
                          to={s.to}
                          onClick={() => setOpen(false)}
                          className="eyebrow text-[10px] text-edge"
                        >
                          {s.label} · <span className="text-bone-dim">{s.note}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <Link
              to="/contact"
              onClick={() => setOpen(false)}
              className="eyebrow mt-6 inline-flex justify-center rounded-full border border-edge px-4 py-3 text-edge"
            >
              Contact
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

/* BrandMark is imported from '@/components/brand/BrandMark' — the hand-authored "Edge Seal". */

export function FloatingCTA() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 800);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <Link
      to="/contact"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      className={`glass fixed bottom-6 right-6 z-40 hidden items-center gap-2 rounded-full px-5 py-3 transition-all duration-500 md:inline-flex ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-edge" />
      <span className="eyebrow text-bone">Contact</span>
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative mt-32 overflow-hidden border-t border-hairline bg-ink">
      {/* Papyrus divider */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: "linear-gradient(90deg, transparent, var(--edge) 20%, var(--edge) 80%, transparent)" }}
      />
      <div className="mx-auto grid max-w-[1440px] gap-12 px-6 py-16 md:grid-cols-12 md:gap-8 md:px-10">
        <div className="md:col-span-5">
          <div className="flex items-center gap-3">
            <BrandMark size={48} className="text-edge" />
            <div className="brand-shimmer font-serif text-3xl md:text-4xl">{client.identity.businessName}</div>
          </div>
          <p className="eyebrow mt-2 text-bone-dim">{client.identity.city + ", " + client.identity.state}</p>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-steel">
            {client.content.about}
          </p>
        </div>
        <div className="md:col-span-3">
          <div className="eyebrow mb-4 text-bone-dim">Rooms</div>
          <ul className="space-y-2 font-serif text-lg">
            <li><Link to="/training" className="text-bone hover:text-edge">Training</Link></li>
            <li><Link to="/seminars" className="text-bone hover:text-edge">Seminars</Link></li>
            <li><Link to="/arts" className="text-bone hover:text-edge">Arts</Link></li>
            <li><Link to="/media" className="text-bone hover:text-edge">Media</Link></li>
            <li><Link to="/contact" className="text-bone hover:text-edge">Contact</Link></li>
          </ul>
        </div>
        <div className="md:col-span-4">
          <div className="eyebrow mb-4 text-bone-dim">Reach</div>
          <p className="text-sm text-steel">
            <a href={client.identity.phoneTel}>{client.identity.phoneDisplay}</a>
            {client.identity.email && <a className="block mt-3" href={"mailto:"+client.identity.email}>{client.identity.email}</a>}
          </p>
          <Link
            to="/contact"
            className="eyebrow mt-6 inline-flex items-center gap-3 rounded-full border border-edge px-5 py-3 text-edge hover:bg-edge hover:text-ink"
          >
            Begin a conversation →
          </Link>
          {client.trust.socials.map(url=><a key={url} className="block mt-3 text-edge" href={url} rel="noopener noreferrer">{new URL(url).hostname}</a>)}
          {/* Compass rose */}
          <div className="mt-8 flex items-center gap-3 text-bone-dim">
            <svg width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden>
              <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="0.6" opacity="0.5" />
              <path d="M20 4 L22 20 L20 24 L18 20 Z" fill="var(--edge)" />
              <path d="M20 36 L18 20 L20 16 L22 20 Z" fill="currentColor" opacity="0.5" />
            </svg>
            <span className="eyebrow text-[10px]">{client.trust.areas.join(" · ")}</span>
          </div>
        </div>
      </div>
      <div className="border-t border-hairline">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-2 px-6 py-6 text-[11px] text-steel md:flex-row md:items-center md:px-10">
          <div>© {new Date().getFullYear()} {client.identity.businessName}. All rights reserved.</div>
          <div className="eyebrow">{client.identity.businessName}</div>
        </div>
      </div>
    </footer>
  );
}
