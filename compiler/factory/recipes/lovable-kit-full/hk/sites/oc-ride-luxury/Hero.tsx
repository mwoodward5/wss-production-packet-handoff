import React from 'react';
import { motion } from 'framer-motion';
import GoldParticles from './_deps/GoldParticles';
import heroBg from './_assets/hero-bg.jpg';

const easing: [number, number, number, number] = [0.23, 1, 0.32, 1];

const Hero: React.FC = () => (
  <section className="relative h-svh w-full flex items-center justify-center overflow-hidden bg-background">
    <div className="absolute inset-0 hero-gradient-bg" />
    <motion.div
      initial={{ scale: 1.15, opacity: 0 }}
      animate={{ scale: 1, opacity: 0.85 }}
      transition={{ duration: 3, ease: easing }}
      className="absolute inset-0 bg-cover bg-center"
      style={{ backgroundImage: `url(${heroBg})` }}
    />
    <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/20 to-background" />
    <div className="absolute inset-0 bg-gradient-to-r from-background/30 via-transparent to-background/30" />
    <GoldParticles count={50} />
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 2 }}>
      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 0.15, scale: 1 }} transition={{ delay: 1, duration: 2 }} className="w-[600px] h-[600px] md:w-[900px] md:h-[900px] rounded-full border border-primary/20" />
      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 0.08, scale: 1 }} transition={{ delay: 1.3, duration: 2 }} className="absolute w-[800px] h-[800px] md:w-[1200px] md:h-[1200px] rounded-full border border-primary/10" />
    </div>
    <div className="relative z-10 text-center max-w-5xl px-6">
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2, ease: easing }} className="backdrop-blur-xl bg-background/20 border border-primary/10 p-8 md:p-16 relative overflow-hidden">
        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.8, duration: 1.5, ease: easing }} className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.8, ease: easing }} className="text-primary font-mono text-xs tracking-[0.5em] uppercase mb-6">
          Established 2012 — Costa Mesa, California
        </motion.p>
        <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 1, ease: easing }} className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-serif text-foreground mb-4 leading-[1.05]">
          First Class Transportation.
        </motion.h1>
        <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 1, ease: easing }} className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-serif italic text-foreground/90 mb-8 leading-[1.05]">
          Every Ride.
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.8 }} className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
          White-glove chauffeur service for discerning clients across Southern California. Discretion, punctuality, and elegance — guaranteed.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 0.8 }} className="flex flex-col sm:flex-row gap-4 justify-center">
          <motion.a href="/book" whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="group relative px-10 py-5 text-sm font-bold tracking-widest uppercase bg-primary text-primary-foreground border border-primary overflow-hidden transition-all">
            <span className="relative z-10">Reserve Your Vehicle</span>
            <div className="absolute inset-0 gold-shimmer-sweep opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.a>
          <motion.a href="#fleet" whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="group relative px-10 py-5 text-sm font-bold tracking-widest uppercase bg-transparent text-primary border border-primary/30 overflow-hidden transition-all hover:border-primary">
            <span className="relative z-10">View Our Fleet</span>
            <div className="absolute inset-0 gold-shimmer-sweep opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.a>
        </motion.div>
        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1, duration: 1.5, ease: easing }} className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
      </motion.div>
    </div>
  </section>
);

export default Hero;
