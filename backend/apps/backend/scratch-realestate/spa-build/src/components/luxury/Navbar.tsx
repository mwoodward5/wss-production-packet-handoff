import { useState, useEffect } from "react";
import { Menu, X, Phone } from "lucide-react";
import { fact } from "@/lib/facts";
import { showReviewsSection } from "@/lib/content";

const BUSINESS_NAME = fact("BUSINESS_NAME");
const LOGO_URL = fact("LOGO_URL");
const PHONE = fact("PHONE");
const PHONE_DIGITS = fact("PHONE_DIGITS");
const TEL_HREF = PHONE_DIGITS ? "tel:+1" + PHONE_DIGITS : "";

// Every href resolves to a section that actually renders: the Testimonials
// link collapses with its section (the landscaping walkthrough's dead-anchor
// lesson), and nothing here points at an id the page never mounts.
const navLinks = [
  { label: "Properties", href: "#collections" },
  { label: "About", href: "#about" },
  { label: "Expertise", href: "#expertise" },
  ...(showReviewsSection ? [{ label: "Testimonials", href: "#testimonials" }] : []),
  { label: "FAQ", href: "#faq" },
  { label: "Contact", href: "#contact" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 60);
      const sections = navLinks.map(l => l.href.slice(1)).filter(Boolean);
      for (let i = sections.length - 1; i >= 0; i--) {
        const el = document.getElementById(sections[i]);
        if (el && el.getBoundingClientRect().top <= 200) {
          setActiveSection(sections[i]);
          return;
        }
      }
      setActiveSection("");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-700 ${
        scrolled
          ? "bg-charcoal/90 backdrop-blur-xl py-3 border-b border-gold/10"
          : "bg-transparent py-7"
      }`}
    >
      <div className="luxury-section flex items-center justify-between">
        <a href="#top" className="flex items-center gap-4 group">
          {LOGO_URL ? (
            <img
              src={LOGO_URL}
              alt={BUSINESS_NAME}
              className="h-9 md:h-11 w-auto object-contain transition-all duration-500 group-hover:scale-105"
            />
          ) : (
            <span className="font-display text-lg md:text-xl font-semibold tracking-editorial text-ivory">
              {BUSINESS_NAME}<span className="text-gold">.</span>
            </span>
          )}
        </a>

        <div className="hidden lg:flex items-center gap-12">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`relative font-body text-[11px] tracking-luxury uppercase transition-colors duration-300
                after:content-[''] after:absolute after:bottom-[-4px] after:left-1/2 after:-translate-x-1/2 after:w-0 after:h-px after:bg-gold after:transition-all after:duration-500 hover:after:w-full
                ${activeSection === link.href.slice(1) ? "text-gold after:w-full" : "text-ivory/60 hover:text-gold"}`}
            >
              {link.label}
            </a>
          ))}
        </div>

        <a
          href="#contact"
          className="hidden lg:inline-block font-body text-[11px] tracking-luxury uppercase border border-gold/30 text-gold px-10 py-4 hover:bg-gold hover:text-charcoal transition-all duration-500 shimmer-btn"
        >
          Private Consultation
        </a>

        <button
          className="lg:hidden text-ivory relative z-50"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Full-screen mobile overlay */}
      <div
        className={`fixed inset-0 bg-charcoal z-40 flex flex-col items-center justify-center transition-all duration-700 lg:hidden ${
          mobileOpen ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none"
        }`}
      >
        <div className="flex flex-col items-center gap-9">
          {navLinks.map((link, i) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="font-display text-3xl text-ivory/80 hover:text-gold transition-all duration-500"
              style={{
                opacity: mobileOpen ? 1 : 0,
                transform: mobileOpen ? "translateY(0)" : "translateY(30px)",
                transitionDelay: mobileOpen ? `${0.1 + i * 0.06}s` : "0s",
              }}
            >
              {link.label}
            </a>
          ))}
          {PHONE && (
            <a
              href={TEL_HREF}
              onClick={() => setMobileOpen(false)}
              className="inline-flex items-center gap-2 font-body text-xs tracking-luxury uppercase text-ivory/60 hover:text-gold transition-colors duration-500"
            >
              <Phone size={14} /> {PHONE}
            </a>
          )}
          <a
            href="#contact"
            onClick={() => setMobileOpen(false)}
            className="font-body text-xs tracking-luxury uppercase border border-gold/40 text-gold px-10 py-4 hover:bg-gold hover:text-charcoal transition-all duration-500 mt-6"
            style={{
              opacity: mobileOpen ? 1 : 0,
              transform: mobileOpen ? "translateY(0)" : "translateY(30px)",
              transitionDelay: mobileOpen ? `${0.1 + navLinks.length * 0.06}s` : "0s",
            }}
          >
            Private Consultation
          </a>
        </div>
      </div>
    </nav>
  );
}
