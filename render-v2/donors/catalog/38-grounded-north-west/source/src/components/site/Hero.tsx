import { motion } from "framer-motion";
import { Phone, Mail, ArrowRight, ShieldCheck, MapPin, Home, Zap, Activity, Star } from "lucide-react";
import { useClient, HeroMedia } from "@/lib/wss";
import { GoogleReviewButton } from "./ReviewsTrust";

export const Hero = () => {
  const c=useClient();
  const proof=c.trust.badges.map(b=>({icon:ShieldCheck,label:b.label}));
  const ticker=c.trust.areas;
  return (
    <section className="relative pt-28 md:pt-36 pb-24 md:pb-28 overflow-hidden bg-gradient-hero isolate">
      <div aria-hidden className="absolute inset-0 grid-bg opacity-60 [mask-image:radial-gradient(ellipse_at_30%_40%,black_20%,transparent_75%)]" />
      <div aria-hidden className="absolute inset-0 topo-bg opacity-70 pointer-events-none" />
      <div aria-hidden className="absolute -top-40 -left-40 w-[640px] h-[640px] ambient-orb pointer-events-none" />
      <div aria-hidden className="absolute top-1/2 -right-40 w-[520px] h-[520px] rounded-full bg-secondary/10 blur-[160px] pointer-events-none" />

      <div className="container relative grid lg:grid-cols-12 gap-12 lg:gap-10 items-center">
        {/* LEFT */}
        <motion.div
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: "easeOut" }}
          className="lg:col-span-7 relative"
        >
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card text-[10px] uppercase tracking-[0.28em] text-muted-foreground shadow-sm">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-secondary animate-ping opacity-75" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-secondary" />
              </span>
              {c.hero.eyebrow}
            </div>
          </div>

          <h1 className="font-display font-medium text-[2.5rem] sm:text-5xl md:text-6xl lg:text-[4.5rem] leading-[0.98] tracking-[-0.03em] text-foreground">
            <span className="block">{c.hero.line1}</span>
            <span className="relative inline-block">
              <span className="copper-text italic font-semibold">{c.hero.emphasis}</span>
              <span aria-hidden className="absolute -bottom-2 left-0 right-0 h-[3px] bg-gradient-trust rounded-full opacity-90" />
            </span>
            <span className="block mt-2">{c.hero.line3}</span>
          </h1>

          <p className="mt-7 max-w-xl text-base md:text-lg text-muted-foreground leading-relaxed">
            {c.hero.support}
          </p>

          <ul className="mt-7 flex flex-wrap gap-2">
            {proof.map((p) => (
              <li key={p.label} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-foreground shadow-sm">
                <p.icon className="w-3.5 h-3.5 text-primary" />
                {p.label}
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4">
            <a href={c.identity.phoneTel} className="group relative inline-flex items-center justify-center gap-2 rounded-full bg-secondary text-secondary-foreground px-7 py-4 font-medium shadow-glow hover:scale-[1.02] transition-transform overflow-hidden">
              <Phone className="w-4 h-4 relative" />
              <span className="relative">Call {c.identity.phoneDisplay}</span>
              <ArrowRight className="w-4 h-4 relative opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
            </a>
            {c.identity.email && <a href={"mailto:" + c.identity.email} className="inline-flex items-center justify-center gap-2 rounded-full border border-primary/30 bg-card px-7 py-4 font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors">
              <Mail className="w-4 h-4" /> Email us
            </a>}
            <GoogleReviewButton />
          </div>

          {ticker.length > 0 && <div className="mt-10 hidden md:flex items-center gap-4 max-w-xl">
            <div className="mono text-[10px] uppercase tracking-[0.3em] text-primary/70 shrink-0 font-medium">Serving →</div>
            <div className="relative flex-1 h-5 overflow-hidden mask-fade">
              <div className="absolute inset-0 flex items-center gap-6 mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground animate-ticker whitespace-nowrap">
                {[...ticker, ...ticker].map((c, i) => (
                  <span key={i} className="flex items-center gap-6">
                    {c}
                    <span className="w-1 h-1 rounded-full bg-secondary/70" />
                  </span>
                ))}
              </div>
            </div>
          </div>}
        </motion.div>

        {/* RIGHT */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, delay: 0.15, ease: "easeOut" }}
          className="lg:col-span-5 relative"
        >
          <div className="relative rounded-[28px] overflow-hidden ring-1 ring-border shadow-elevated clip-hero-asym bg-card">
            <HeroMedia />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/40 via-transparent to-transparent" />

            <div aria-hidden className="absolute top-4 left-4 w-7 h-7 border-t-2 border-l-2 border-secondary" />
            <div aria-hidden className="absolute top-4 right-4 w-7 h-7 border-t-2 border-r-2 border-secondary" />
            <div aria-hidden className="absolute bottom-4 left-4 w-7 h-7 border-b-2 border-l-2 border-secondary" />
            <div aria-hidden className="absolute bottom-4 right-4 w-7 h-7 border-b-2 border-r-2 border-secondary" />

            {c.trust.badges[0] && <div className="absolute left-5 bottom-5 right-5 inline-flex items-center justify-between gap-3 mono text-[10px] uppercase tracking-[0.28em] text-primary-foreground bg-primary/85 backdrop-blur px-4 py-2 rounded-md">
              <span className="inline-flex items-center gap-2"><Activity className="w-3 h-3" /> {c.trust.badges[0].label}</span>
            </div>}
          </div>
        </motion.div>
      </div>

      <style>{`.mask-fade{ -webkit-mask-image: linear-gradient(90deg, transparent, black 12%, black 88%, transparent); mask-image: linear-gradient(90deg, transparent, black 12%, black 88%, transparent); }`}</style>
    </section>
  );
};
