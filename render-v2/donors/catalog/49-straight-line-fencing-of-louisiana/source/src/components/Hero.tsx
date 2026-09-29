'use client'

import { motion } from 'framer-motion'
import { Menu, X, Phone } from 'lucide-react'
import { useState, useEffect } from 'react'
import { heroImg, logoImg, SLF } from '@/lib/slfAssets'

const navLinks = [
  { href: '#services', label: 'Services' },
  { href: '#portfolio', label: 'Recent Work' },
  { href: '#about', label: 'Process' },
  { href: '#team', label: 'Gallery' },
  { href: '#awards', label: 'Why Us' },
  { href: '#contact', label: 'Contact' },
]

export function Hero() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 50)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : 'unset'
    return () => { document.body.style.overflow = 'unset' }
  }, [isMobileMenuOpen])

  return (
    <div className="relative h-screen w-full overflow-hidden" style={{ background: '#1a1f17' }}>
      {/* Cinematic hero image with slow Ken Burns */}
      <div className="absolute inset-0 hero-kenburns">
        <img
          src={heroImg}
          alt="Custom wood privacy fence by Straight Line Fencing Of Louisiana"
          className="w-full h-full object-cover"
          style={{ filter: 'brightness(0.72) saturate(1.05)' }}
        />
      </div>
      {/* Warm cinematic overlay (≈10% lighter than typical dark hero) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, rgba(20,24,16,0.35) 0%, rgba(20,24,16,0.15) 35%, rgba(20,24,16,0.55) 100%)',
        }}
      />
      {/* Subtle grain */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)',
          backgroundSize: '3px 3px',
        }}
      />

      {/* Navbar */}
      <motion.nav
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3 }}
        className="fixed top-0 left-0 right-0 w-full z-[110]"
      >
        <div
          className={`w-full px-6 sm:px-8 lg:px-12 py-4 transition-all duration-300 ease-out ${
            isScrolled ? 'bg-black/70 backdrop-blur-xl border-b border-white/10' : 'bg-transparent'
          }`}
        >
          <div className="flex items-center justify-between">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="flex items-center gap-3 cursor-pointer"
              aria-label="Straight Line Fencing"
            >
              <img src={logoImg} alt="Straight Line Fencing logo" className="h-10 w-10 rounded-md object-cover" />
              <span className="hidden sm:block text-white font-black tracking-tight leading-tight text-left">
                Straight Line
                <span className="block text-xs font-medium tracking-[0.2em] text-white/70">FENCING · LOUISIANA</span>
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
              <a
                href={SLF.phoneHref}
                className="hidden sm:inline-flex items-center gap-2 bg-[#946936] hover:bg-[#7d5a2d] text-white font-semibold px-5 py-3 rounded-md gentle-animation"
              >
                <Phone className="w-4 h-4" />
                Call For An Estimate
              </a>
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="lg:hidden glass-effect p-3 rounded-full text-white"
                aria-label="Toggle menu"
              >
                {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-md z-[80]"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: isMobileMenuOpen ? '0%' : '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="lg:hidden fixed top-0 right-0 h-full w-72 max-w-[85vw] bg-black/90 backdrop-blur-xl border-l border-white/10 z-[90]"
      >
        <div className="flex flex-col h-full p-6 pt-20 text-white">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setIsMobileMenuOpen(false)}
              className="px-4 py-3 hover:bg-white/10 rounded-lg font-medium text-lg"
            >
              {l.label}
            </a>
          ))}
          <a
            href={SLF.phoneHref}
            className="mt-6 inline-flex items-center justify-center gap-2 bg-[#946936] text-white font-semibold px-5 py-3 rounded-md"
          >
            <Phone className="w-4 h-4" />
            {SLF.phone}
          </a>
        </div>
      </motion.div>

      {/* Hero content */}
      <div className="absolute inset-0 z-40 flex items-end">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="container mx-auto px-6 sm:px-8 lg:px-12 pb-16 lg:pb-24"
        >
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-4 py-1.5 mb-6">
              <span className="w-2 h-2 rounded-full bg-[#b9c468] animate-pulse" />
              <span className="text-white/90 text-xs font-semibold tracking-wider uppercase">
                Serving Louisiana · Family Owned
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black leading-[1.05] text-white text-shadow-medium">
              <span className="block">Fences built</span>
              <span className="block">straight, strong,</span>
              <span className="block text-[#cbb189]">and built to last.</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-white/85 max-w-2xl leading-relaxed">
              Custom wood, privacy, and property-line fencing across Louisiana. Honest quotes, clean installs,
              and craftsmanship you can see from the street.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href={SLF.phoneHref}
                className="inline-flex items-center gap-2 bg-[#946936] hover:bg-[#7d5a2d] text-white font-bold text-lg px-7 py-4 rounded-md gentle-animation"
              >
                <Phone className="w-5 h-5" />
                {SLF.phone}
              </a>
              <a
                href="#contact"
                className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/30 text-white font-semibold px-7 py-4 rounded-md gentle-animation"
              >
                Request a Quote
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
