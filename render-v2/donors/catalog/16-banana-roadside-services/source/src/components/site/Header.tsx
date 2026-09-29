import {ClientImage} from "./ClientImage";
import {aggregate,client,serviceItems,european,hoursText,mediaFor,pageCopy} from "@/data/bridge";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { AnnouncementBar } from "./AnnouncementBar";
import { CallButton } from "./CallButton";
import { ASSETS } from "@/assets/manifest";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/about-us", label: "About Us" },
  { to: "/services", label: "Services" },
  { to: "/european-battery-services", label: "European Battery" },
  { to: "/gallery", label: "Gallery" },
  { to: "/contact-us", label: "Contact Us" },
].filter(n => n.to !== "/european-battery-services" || european);

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50">
      <AnnouncementBar />
      <div
        className={cn(
          "w-full transition-all duration-300",
          scrolled ? "glass-nav shadow-[var(--shadow-soft)]" : "bg-background",
        )}
      >
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          {/* Desktop-only brand mark. On mobile the call button takes this slot. */}
          <Link
            to="/"
            className="hidden items-center gap-3 lg:flex"
            aria-label={client.identity.businessName + " — Home"}
          >
            <span className="shimmer-wrap">
              <ClientImage
                src={ASSETS.logo.url}
                alt={client.identity.businessName}
                className="h-14 w-auto"
                width={180}
                height={56}
              />
            </span>
          </Link>

          {/* Mobile-only call button in the former logo slot */}
          <CallButton size="md" className="lg:hidden" />

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.to === "/" }}
                activeProps={{ className: "text-foreground bg-foreground/[0.06]" }}
                inactiveProps={{ className: "text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]" }}
                className="rounded-full px-3 py-2 text-sm font-medium tracking-tight transition-colors"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 xl:flex">
              {aggregate && <a href={aggregate.sourceUrl}>{aggregate.rating}/5 · {aggregate.count} reviews</a>}
              {client.trust.badges.map(b=><span key={b.label}>{b.label}</span>)}
              
              
            </div>
            <CallButton size="md" className="hidden lg:inline-flex" />
            <Sheet open={open} onOpenChange={setOpen}>

              <SheetTrigger
                className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-background lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="right" className="w-[88vw] max-w-sm">
                <SheetTitle className="sr-only">Site navigation</SheetTitle>
                <div className="mt-2 flex items-center gap-3">
                  <ClientImage src={ASSETS.logo.url} alt={client.identity.businessName} className="h-10 w-auto" />
                </div>
                <nav className="mt-8 flex flex-col gap-1" aria-label="Mobile">
                  {NAV.map((n) => (
                    <Link
                      key={n.to}
                      to={n.to}
                      onClick={() => setOpen(false)}
                      activeOptions={{ exact: n.to === "/" }}
                      activeProps={{ className: "bg-foreground/[0.06] text-foreground" }}
                      inactiveProps={{ className: "text-foreground/80" }}
                      className="rounded-xl px-4 py-3 text-base font-medium"
                    >
                      {n.label}
                    </Link>
                  ))}
                </nav>
                <div className="mt-8 space-y-4">
                  <CallButton size="lg" className="w-full" />
                  <div className="flex items-center gap-3">
                    
                    
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
