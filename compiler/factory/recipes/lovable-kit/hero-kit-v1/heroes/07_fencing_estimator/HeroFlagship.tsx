"use client";

import { motion } from "framer-motion";
import { Menu, X, Phone, ChevronDown } from "lucide-react";
import { useState, useEffect } from "react";
import { heroImg, logoImg, SLF } from "./_deps/slfAssets.example";
import { AtmosphereLayers } from "./_deps/AtmosphereLayers";
import { EstimatorWidget } from "./_deps/EstimatorWidget";

const navLinks = [
  { href: "#services", label: "Services" },
  { href: "#portfolio", label: "Recent Work" },
  { href: "#about", label: "Process" },
  { href: "#team", label: "Gallery" },
  { href: "#awards", label: "Why Us" },
  { href: "#contact", label: "Contact" },
];

const HEADLINE = ["Fences built", "straight, strong,", "and built to last."];

export function HeroFlagship() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : "unset";
    return () => { document.body.style.overflow = "unset"; };
  }, [isMobileMenuOpen]);

  return (
    <div className="relative min-h-[100svh] w-full overflow-hidden" style={{ background: "#0e110b" }}>
      {/* Cinematic Ken Burns plate */}
      <div className="absolute inset-0 hero-kenburns">
        <img src={heroImg} alt="Cinematic hero photo"
             className="w-full h-full object-cover"
             style={{ filter: "brightness(0.78) saturate(1.1) contrast(1.05)" }} />
      </div>

      <AtmosphereLayers />

      {/* Navbar */}
      <motion.nav initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.3 }}
                  className="fixed top-0 left-0 right-0 w-full z-[110]">
        <div className={`w-full px-6 sm:px-8 lg:px-12 py-4 transition-all duration-300 ease-out ${
                          isScrolled ? "bg-black/70 backdrop-blur-xl border-b border-white/10" : "bg-transparent"
                        }`}>
          <div className="flex items-center justify-between">
            <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                    className="flex items-center gap-3 cursor-pointer" aria-label={SLF.name}>
              <img src={logoImg} alt={`${SLF.name} logo`} className="h-10 w-10 rounded-md object-cover" />
              <span className="hidden sm:block text-white font-black tracking-tight leading-tight text-left">
                {SLF.short}
                <span className="block text-xs font-medium tracking-[0.2em] text-white/70">{SLF.tagline}</span>
              </span>
            </button>

            <div className="hidden lg:flex items-center space-x-7">
              {navLinks.map((l) => (
                <a key={l.href} href={l.href} className="text-white/90 hover:text-white font-medium gentle-animation">
                  {l.label}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <a href={SLF.phoneHref}
                 className="hidden sm:inline-flex items-center gap-2 bg-[#946936] hover:bg-[#7d5a2d] text-white font-semibold px-5 py-3 rounded-md gentle-animation">
                <Phone className="w-4 h-4" />
                Call For An Estimate
              </a>
              <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                      className="lg:hidden glass-effect p-3 rounded-full text-white" aria-label="Toggle menu">
                {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-md z-[80]"
             onClick={() => setIsMobileMenuOpen(false)} />
      )}
      <motion.div initial={{ x: "100%" }} animate={{ x: isMobileMenuOpen ? "0%" : "100%" }}
                  transition={{ type: "spring", damping: 25, stiffness: 200 }}
                  className="lg:hidden fixed top-0 right-0 h-full w-72 max-w-[85vw] bg-black/90 backdrop-blur-xl border-l border-white/10 z-[90]">
        <div className="flex flex-col h-full p-6 pt-20 text-white">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setIsMobileMenuOpen(false)}
               className="px-4 py-3 hover:bg-white/10 rounded-lg font-medium text-lg">{l.label}</a>
          ))}
          <a href={SLF.phoneHref}
             className="mt-6 inline-flex items-center justify-center gap-2 bg-[#946936] text-white font-semibold px-5 py-3 rounded-md">
            <Phone className="w-4 h-4" />{SLF.phone}
          </a>
        </div>
      </motion.div>

      {/* Hero content */}
      <div className="relative z-40 min-h-[100svh] flex items-end">
        <div className="container mx-auto px-6 sm:px-8 lg:px-12 pb-20 lg:pb-28 pt-32 lg:pt-28 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-end">
            <div className="lg:col-span-7">
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.7, delay: 0.4 }}
                          className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-4 py-1.5 mb-6">
                <span className="w-2 h-2 rounded-full bg-[#b9c468] animate-pulse" />
                <span className="text-white/90 text-[11px] font-bold tracking-[0.22em] uppercase">
                  Est. Louisiana · Crafted By Hand
                </span>
              </motion.div>

              <h1 className="text-[2.6rem] sm:text-6xl lg:text-[5.5rem] font-black leading-[1.02] text-white tracking-tight">
                {HEADLINE.map((line, i) => (
                  <span key={i} className="block overflow-hidden" style={{ paddingBottom: "0.08em" }}>
                    <motion.span className="block"
                                 initial={{ y: "110%", opacity: 0, filter: "blur(8px)" }}
                                 animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
                                 transition={{ duration: 0.95, delay: 0.55 + i * 0.18, ease: [0.22, 1, 0.36, 1] }}
                                 style={i === 2 ? {
                                   background: "linear-gradient(135deg, #efd9a8 0%, #cbb189 45%, #946936 100%)",
                                   WebkitBackgroundClip: "text",
                                   WebkitTextFillColor: "transparent",
                                   backgroundClip: "text",
                                 } : undefined}>
                      {line}
                    </motion.span>
                  </span>
                ))}
              </h1>

              <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 1.15 }}
                        className="mt-6 text-base sm:text-lg lg:text-xl text-white/85 max-w-2xl leading-relaxed">
                Custom wood, privacy, and property-line fencing across Louisiana. Honest quotes,
                clean installs, and craftsmanship you can see from the street.
              </motion.p>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 1.4 }}
                          className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-white/70 font-semibold tracking-wide">
                {["Family Owned", "Free On-Site Quotes", "Fully Insured", "Mon–Fri · 7–5"].map((t, i, arr) => (
                  <span key={t} className="flex items-center gap-3">
                    <span>{t}</span>
                    {i < arr.length - 1 && <span className="w-1 h-1 rounded-full bg-white/40" />}
                  </span>
                ))}
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.7, delay: 1.5 }}
                          className="mt-8 flex flex-wrap items-center gap-3">
                <a href={SLF.phoneHref}
                   className="inline-flex items-center gap-2 bg-[#946936] hover:bg-[#7d5a2d] text-white font-bold text-base px-6 py-3.5 rounded-md gentle-animation">
                  <Phone className="w-5 h-5" />
                  {SLF.phone}
                </a>
                <a href="#portfolio"
                   className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/30 text-white font-semibold px-6 py-3.5 rounded-md gentle-animation">
                  See Recent Work
                </a>
              </motion.div>
            </div>

            <div className="lg:col-span-5 flex lg:justify-end">
              <EstimatorWidget />
            </div>
          </div>
        </div>
      </div>

      <motion.a href="#services" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: 1, delay: 2 }}
                className="hidden lg:flex absolute bottom-5 left-1/2 -translate-x-1/2 z-50 flex-col items-center gap-1 text-white/55 hover:text-white text-[10px] tracking-[0.3em] uppercase font-bold">
        <span>Scroll</span>
        <motion.span animate={{ y: [0, 5, 0], opacity: [0.5, 1, 0.5] }}
                     transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}>
          <ChevronDown className="w-4 h-4" />
        </motion.span>
      </motion.a>
    </div>
  );
}
