import { useEffect, useState } from "react";
import { Phone, ArrowUpRight } from "lucide-react";
import { BUSINESS } from "@/lib/business";
import { getSite } from "@/lib/wss";

export function TopBar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={[
        "fixed top-0 left-0 right-0 z-40 transition-all duration-500",
        scrolled
          ? "backdrop-blur-xl bg-background/85 border-b border-border/60 shadow-[0_8px_30px_-15px_rgba(0,0,0,0.18)]"
          : "backdrop-blur-md bg-loam/30 border-b border-bone/10",
      ].join(" ")}
    >
      <div className="mx-auto max-w-7xl flex items-center justify-between px-5 sm:px-8 h-14 sm:h-16">
        <a href="/#top" className="flex items-center gap-2.5 group" aria-label={`${BUSINESS.name} — home`}>
          <span
            className={[
              "inline-flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full transition-all duration-500",
              scrolled
                ? "bg-bone ring-1 ring-border"
                : "bg-bone/95 ring-1 ring-bone/40 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.55)]",
            ].join(" ")}
          >
            <img
              src={getSite().identity.logoOnLight}
              alt=""
              aria-hidden="true"
              className="h-7 w-7 sm:h-8 sm:w-8 object-contain"
              width={64}
              height={64}
            />
          </span>
          <span className="flex flex-col leading-none">
            <span
              className={[
                "font-display text-[15px] sm:text-base tracking-tight transition-colors",
                scrolled ? "text-foreground" : "text-bone drop-shadow-[0_1px_8px_rgba(0,0,0,0.5)]",
              ].join(" ")}
            >
              {BUSINESS.name}
            </span>
            <span
              className={[
                "mt-1 text-[9px] uppercase tracking-[0.32em] font-mono transition-colors",
                scrolled ? "text-muted-foreground" : "text-bone/75",
              ].join(" ")}
            >
              {BUSINESS.city} · {BUSINESS.state}
            </span>
          </span>
        </a>

        <nav className={["hidden md:flex items-center gap-8 text-sm transition-colors", scrolled ? "text-muted-foreground" : "text-bone/80"].join(" ")}>
          <a href="/#services" className={scrolled ? "hover:text-foreground transition" : "hover:text-bone transition"}>Services</a>
          <a href="/#estimator" className={scrolled ? "hover:text-foreground transition" : "hover:text-bone transition"}>Services guide</a>
          {getSite().media.some(m=>m.role==="gallery") && <a href="/#work" className={scrolled ? "hover:text-foreground transition" : "hover:text-bone transition"}>Work</a>}
          <a href="/#about" className={scrolled ? "hover:text-foreground transition" : "hover:text-bone transition"}>About</a>
          {getSite().content.faqs.length > 0 && <a href="/#faq" className={scrolled ? "hover:text-foreground transition" : "hover:text-bone transition"}>FAQ</a>}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={BUSINESS.phoneHref}
            className={[
              "hidden sm:inline-flex items-center gap-2 text-sm font-medium transition-colors",
              scrolled ? "text-foreground hover:text-accent" : "text-bone hover:text-accent",
            ].join(" ")}
          >
            <Phone className="h-4 w-4" />
            {BUSINESS.phone}
          </a>
          <a
            href="/#contact"
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs sm:text-sm font-medium transition-all",
              scrolled
                ? "bg-accent text-accent-foreground hover:bg-foreground"
                : "bg-bone text-loam hover:bg-accent hover:text-accent-foreground",
            ].join(" ")}
          >
            Contact
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}
