import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { CallButton } from "./CallButton";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

const primaryNav = [
  { to: "/about", label: "About" },
  { to: "/home-renovation", label: "Renovations" },
  { to: "/flooring-services", label: "Flooring" },
  { to: "/foundations-excavation", label: "Foundations" },
] as const;

const servicesMenu = [
  { to: "/service-area", label: "Service Area" },
  { to: "/home-renovation", label: "Home Renovation" },
  { to: "/flooring-services", label: "Flooring" },
  { to: "/commercial-concrete", label: "Construction" },
  { to: "/commercial-renovation", label: "Commercial Renovation" },
  { to: "/commercial-concrete", label: "Commercial Concrete" },
  { to: "/foundations-excavation", label: "Foundations" },
  { to: "/flatwork-driveways", label: "Flatwork" },
  { to: "/concrete-demolition", label: "Demolition" },
] as const;

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const menuId = "site-services-menu";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const closeTimer = useRef<number | null>(null);

  const closeMenu = useCallback((opts?: { focusTrigger?: boolean }) => {
    setServicesOpen(false);
    setActiveIndex(-1);
    if (opts?.focusTrigger) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback((startIndex = -1) => {
    setServicesOpen(true);
    setActiveIndex(startIndex);
  }, []);

  const cancelClose = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setServicesOpen(false);
      setActiveIndex(-1);
    }, 120);
  };

  // Outside click & Escape close
  useEffect(() => {
    if (!servicesOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const root = containerRef.current;
      if (root && !root.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu({ focusTrigger: true });
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [servicesOpen, closeMenu]);

  // Move DOM focus to active item
  useEffect(() => {
    if (!servicesOpen || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex, servicesOpen]);

  // Lock body scroll when mobile menu open
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Close menus when crossing the lg breakpoint
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = () => {
      setMobileOpen(false);
      closeMenu();
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [closeMenu]);

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "Enter":
      case " ":
        e.preventDefault();
        openMenu(0);
        break;
      case "ArrowUp":
        e.preventDefault();
        openMenu(servicesMenu.length - 1);
        break;
      case "Escape":
        if (servicesOpen) {
          e.preventDefault();
          closeMenu();
        }
        break;
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % servicesMenu.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? servicesMenu.length - 1 : i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(servicesMenu.length - 1);
        break;
      case "Tab":
        closeMenu();
        break;
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 lg:px-6">
        <Link to="/" className="group flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <Logo variant="header" />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {primaryNav.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              activeProps={{ className: "text-foreground bg-muted" }}
              activeOptions={{ exact: false }}
            >
              {n.label}
            </Link>
          ))}

          <div
            ref={containerRef}
            className="relative"
            onMouseEnter={() => {
              cancelClose();
              setServicesOpen(true);
            }}
            onMouseLeave={scheduleClose}
          >
            <button
              ref={triggerRef}
              type="button"
              onClick={() => (servicesOpen ? closeMenu() : openMenu())}
              onKeyDown={onTriggerKeyDown}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-haspopup="menu"
              aria-expanded={servicesOpen}
              aria-controls={menuId}
            >
              Services
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", servicesOpen && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            <div
              id={menuId}
              role="menu"
              aria-label="Services"
              hidden={!servicesOpen}
              onKeyDown={onMenuKeyDown}
              className={cn(
                "absolute left-0 top-full z-50 mt-1 w-64 rounded-2xl border border-border bg-card p-2 shadow-elegant transition-all duration-150",
                servicesOpen
                  ? "pointer-events-auto opacity-100 translate-y-0"
                  : "pointer-events-none opacity-0 -translate-y-1",
              )}
            >
              {servicesMenu.map((s, i) => (
                <Link
                  key={s.label}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  to={s.to}
                  role="menuitem"
                  tabIndex={activeIndex === i ? 0 : -1}
                  onClick={() => closeMenu()}
                  onMouseEnter={() => setActiveIndex(i)}
                  className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
                >
                  {s.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            to="/contact"
            className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Get Quote
          </Link>
          <CallButton variant="gold" location="header" />
        </div>

        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-md p-2 lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="site-mobile-menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div
        id="site-mobile-menu"
        className={cn("border-t border-border lg:hidden", mobileOpen ? "block" : "hidden")}
      >
        <div className="mx-auto max-w-7xl px-4 py-3">
          <nav className="flex flex-col" aria-label="Mobile">
            <Link
              to="/"
              onClick={() => setMobileOpen(false)}
              className="rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              activeProps={{ className: "text-foreground bg-muted" }}
            >
              Home
            </Link>
            {primaryNav.map((n) => (
              <Link
                key={n.label}
                to={n.to}
                onClick={() => setMobileOpen(false)}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                activeProps={{ className: "text-foreground bg-muted" }}
              >
                {n.label}
              </Link>
            ))}
            <div className="mt-2 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              Services
            </div>
            {servicesMenu.map((s) => (
              <Link
                key={s.label}
                to={s.to}
                onClick={() => setMobileOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {s.label}
              </Link>
            ))}
            <Link
              to="/contact"
              onClick={() => setMobileOpen(false)}
              className="mt-3 rounded-full border border-border px-4 py-2 text-center text-sm font-medium hover:bg-muted"
            >
              Get Quote
            </Link>
            <div className="mt-2">
              <CallButton variant="gold" location="mobile-menu" className="w-full justify-center" />
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}
