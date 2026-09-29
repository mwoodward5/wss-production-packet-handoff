import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { useEffect, useState } from "react";
import { Phone, Menu, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApproachLightBar } from "@/components/motion/ApproachLightBar";
import { ControlButton } from "@/components/motion/ControlButton";

export const links = [
  { href: "/#programs", label: "Programs" },
  { href: "/#pathway", label: "Pathway" },
  { href: "/#discovery", label: "Discovery" },
  { href: "/#campus", label: "Campus" },
  { href: "/service-areas", label: "Service Areas" },
  { href: "/#faqs", label: "FAQs" },
  { href: "/#contact", label: "Admissions" },
].filter(l => l.href !== '/#pathway' || client.content.values.length).filter(l => l.href !== '/#discovery' || (discoveryService() && mediaSlot('discovery-view'))).filter(l => l.href !== '/#campus' || (client.trust.mapUrl && mediaSlot('campus-aeronautical'))).filter(l => l.href !== '/#faqs' || client.content.faqs.length);

export const Nav = () => {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 z-50 w-full transition-all duration-500",
        scrolled
          ? "border-b border-border/60 bg-background/85 backdrop-blur-xl"
          : "bg-transparent",
      )}
    >
      <div className="container-page flex h-16 items-center justify-between md:h-20">
        <a href="/#top" className="group flex items-center gap-3">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-sm bg-gradient-runway shadow-runway">
            <span className="absolute inset-0 rounded-sm bg-gradient-runway opacity-60 blur-md transition group-hover:opacity-90" />
<img src={client.identity.logoOnDark} alt={client.identity.businessName} className="relative h-9 w-9 object-contain" />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-sm font-semibold tracking-wide">{client.identity.businessName}</span>
            <span className="hud-tag">{client.identity.city}</span>
          </div>
        </a>

        <nav className="hidden items-center gap-8 lg:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="group relative font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
              <span className="absolute -bottom-1.5 left-0 h-px w-0 bg-primary transition-all duration-500 group-hover:w-full" />
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 md:gap-3">
          <ControlButton
            href={client.identity.phoneTel}
            variant="ghost"
            size="sm"
            icon={<Phone className="h-3.5 w-3.5" />}
            className="hidden md:inline-flex"
            ariaLabel={`Call ${client.identity.businessName} at ${client.identity.phoneDisplay}`}
          >
            {client.identity.phoneDisplay}
          </ControlButton>
          <ControlButton
            href="/#contact"
            size="sm"
            trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}
            className="hidden md:inline-flex"
          >
            Request Info
          </ControlButton>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Open menu"
            className="rounded-sm border border-border p-2 text-foreground lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Runway approach lights — sequenced LED progression under the nav */}
      <ApproachLightBar />

      {open && (
        <div className="border-t border-border bg-background/95 backdrop-blur-xl lg:hidden">
          <div className="container-page flex flex-col gap-1 py-4">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-sm px-3 py-3 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {l.label}
              </a>
            ))}
            <a
              href={client.identity.phoneTel}
              className="mt-2 inline-flex items-center gap-2 rounded-sm border border-border px-3 py-3 font-mono text-xs text-foreground"
            >
              <Phone className="h-3.5 w-3.5" /> {client.identity.phoneDisplay}
            </a>
          </div>
        </div>
      )}
    </header>
  );
};
