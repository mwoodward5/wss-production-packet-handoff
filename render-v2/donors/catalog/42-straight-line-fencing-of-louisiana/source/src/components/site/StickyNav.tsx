import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { site } from "@/wss/bridge";

const links = [
  { label: "Services", href: "#services" },
  { label: "Work", href: "#work" },
  { label: "Process", href: "#process" },
  { label: "Quote", href: "#quote" },
];

export function StickyNav() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className="fixed top-0 inset-x-0 z-40 transition-all duration-700"
      style={{
        transform: shown ? "translateY(0)" : "translateY(-100%)",
        background: "color-mix(in oklch, var(--background) 78%, transparent)",
        backdropFilter: "blur(16px) saturate(160%)",
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4 md:px-10">
        <a href="#top" className="flex items-center gap-3 group" data-cursor="link" aria-label={site.identity.businessName}>
          <span className="logo-mark">
            <img src={site.identity.logoOnLight} alt={site.identity.businessName} width={44} height={44} loading="eager" decoding="async" />
          </span>
          <span className="eyebrow hidden md:inline ml-1">{site.identity.businessName}</span>
        </a>
        <nav className="hidden md:flex items-center gap-8">
          {links.filter(l => (l.href !== "#work" || site.gallery.length > 0) && (l.href !== "#process" || site.process.length > 0)).map((l) => (
            <a
              key={l.href}
              href={l.href}
              data-cursor="link"
              className="text-sm underline-sweep text-foreground/80 hover:text-foreground transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-5">
          <ThemeToggle />
          <a
            href={site.identity.phoneTel}
            data-cursor="link"
            className="hidden sm:inline-flex text-sm link-arrow"
            style={{ color: "var(--brass)" }}
          >
            {site.identity.phoneDisplay}
          </a>
        </div>
      </div>
    </header>
  );
}



