import { motion } from "framer-motion";
import { ChevronRight, Flame, Sparkles } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";
import { HeroBookingWidget } from "./HeroBookingWidget";

export function Hero({ onBook }: { onBook: () => void }) {
  const { pricing } = siteConfig;
  return (
    <section className="relative min-h-[100vh] flex items-center pt-28 pb-20 overflow-hidden">
      {/* Background media stack */}
      <div className="absolute inset-0 z-0">
        <img
          src={siteConfig.heroImage}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover ken-burns"
        />
        <video
          className="absolute inset-0 w-full h-full object-cover ken-burns motion-reduce:hidden"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={siteConfig.heroImage}
          aria-hidden="true"
        >
          <source src={siteConfig.heroVideo} type="video/mp4" />
        </video>
        <div className="grain-overlay" />
        <div className="vignette" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/85 to-ink/40" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />
      </div>

      <div className="container-wss relative z-10 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center">
        {/* Comet audit item 8: the hero is visible by default. framer-motion
              starts from the animate state (initial={false}) so SSR markup and
              no-JS renders are never opacity-gated; the entrance is a pure CSS
              keyframe that runs with or without JS. */}
        <motion.div
          initial={false}
          transition={{ duration: 0.8 }}
          className="fade-up"
        >
          <div className="inline-flex items-center gap-2 tag text-signal border-signal/40 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-signal pulse-dot" />
            <Flame size={14} />
            {siteConfig.bookingStatus}
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.02] mb-6 tracking-tight">
            Custom tattoos <span className="italic text-signal">drawn</span> for the body you're in.
          </h1>
          <p className="text-fadetext text-lg md:text-xl max-w-xl mb-8 leading-relaxed">{siteConfig.tagline}</p>
          <div className="flex flex-wrap items-center gap-5 mb-12">
            <button
              onClick={onBook}
              className="bg-signal text-ink font-semibold px-8 py-4 rounded-full flex items-center gap-2 hover:brightness-110 transition emboss text-base"
            >
              <Sparkles size={18} /> Start your request <ChevronRight size={18} />
            </button>
            <a href="#portfolio" className="text-bone hover:text-signal underline underline-offset-8 decoration-signal/40 decoration-1 transition">
              View portfolio
            </a>
          </div>
          <div className="flex gap-10 pt-6 border-t border-line/60 max-w-md">
            {[["Deposit", pricing.deposit], ["Minimum", pricing.minimum], ["Rate", pricing.hourly]].map(([l, v]) => (
              <div key={l}>
                <div className="text-2xl md:text-3xl font-display font-bold">{v}</div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-fadetext mt-1">{l}</div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={false}
          transition={{ duration: 0.9, delay: 0.2 }}
          className="hidden lg:block fade-up"
        >
          <HeroBookingWidget onSubmit={onBook} />
        </motion.div>
      </div>

      {/* Scroll cue */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 text-[10px] uppercase tracking-[0.3em] text-fadetext/70 flex flex-col items-center gap-2 motion-reduce:hidden">
        <span>Scroll</span>
        <span className="w-px h-8 bg-gradient-to-b from-signal to-transparent" />
      </div>
    </section>
  );
}
