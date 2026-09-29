import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowRight, Phone, MapPin, PlayCircle, PlaneTakeoff, Route } from "lucide-react";

import { ScrambleText } from "@/components/motion/ScrambleText";
import { ControlButton } from "@/components/motion/ControlButton";
import { FlightPath } from "@/components/motion/FlightPath";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Cinematic, video-ready hero with scroll-linked parallax,
 * scramble headline accent, magnetic CTAs, and an animated SVG
 * flight path drawing across the sky.
 */
export const Hero = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const [videoFailed, setVideoFailed] = useState(false);
  const [telemetry, setTelemetry] = useState({ alt: 2400, hdg: 142, ias: 118 });

  // Scroll-linked transforms for parallax layers
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const yMedia = useTransform(scrollYProgress, [0, 1], ["0%", reducedMotion ? "0%" : "18%"]);
  const yScrim = useTransform(scrollYProgress, [0, 1], ["0%", reducedMotion ? "0%" : "8%"]);
  const yCopy = useTransform(scrollYProgress, [0, 1], ["0%", reducedMotion ? "0%" : "-10%"]);
  const opacityCopy = useTransform(scrollYProgress, [0, 0.6], [1, 0.2]);

  // Pointer-tracked horizon parallax — image shifts a few pixels with cursor
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 60, damping: 18, mass: 0.6 });

  useEffect(() => {
    if (reducedMotion) return;
    const onMove = (e: PointerEvent) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Range: ~ -12px → 12px horizontal, ~ -8px → 8px vertical
      px.set(((e.clientX / w) - 0.5) * -24);
      py.set(((e.clientY / h) - 0.5) * -16);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reducedMotion, px, py]);

  // Live-feeling telemetry — drifts gently, never wild
  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(() => {
      setTelemetry((t) => ({
        alt: Math.max(2200, Math.min(2600, t.alt + (Math.random() * 40 - 20))),
        hdg: (t.hdg + (Math.random() * 4 - 2) + 360) % 360,
        ias: Math.max(110, Math.min(126, t.ias + (Math.random() * 2 - 1))),
      }));
    }, 1400);
    return () => clearInterval(id);
  }, [reducedMotion]);

  return (
    <section
      ref={sectionRef}
      id="top"
      className="relative isolate min-h-[100svh] overflow-hidden grain"
      aria-label={client.identity.businessName}
    >
      {/* Background media — scroll parallax + pointer-tracked horizon shift */}
      <motion.div
        style={{ y: yMedia, x: sx }}
        className="absolute inset-0 -z-20 will-change-transform"
      >
        <motion.img
          src={client.hero.poster}
          alt={client.identity.businessName}
          width={1920}
          height={1080}
          style={{ y: sy }}
          className={
            "absolute inset-0 h-full w-full object-cover [object-position:60%_center] sm:[object-position:center] " +
            (reducedMotion ? "" : "animate-ken-burns")
          }
        />
        {client.hero.video && !reducedMotion && !videoFailed && <video
          data-wss-hero-video autoPlay muted loop playsInline preload="metadata"
          poster={client.hero.poster} src={client.hero.video} onError={() => setVideoFailed(true)}
          className="absolute inset-0 h-full w-full object-cover [object-position:60%_center] sm:[object-position:center]" />}
      </motion.div>

      {/* Cinematic gradient overlays */}
      <motion.div style={{ y: yScrim }} className="absolute inset-0 -z-10 bg-gradient-hero" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_bottom,_hsl(var(--sky-deep)/0.95),_transparent_70%)]" />

      {/* Ambient horizon glow — slow drift left↔right behind everything */}
      {!reducedMotion && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[55%] animate-horizon-drift bg-[radial-gradient(60%_50%_at_30%_100%,hsl(var(--horizon)/0.18),transparent_70%)]"
        />
      )}

      {/* Light sweep — windshield-glare style, fires every ~9s */}
      {!reducedMotion && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -inset-y-10 -left-1/3 h-[140%] w-1/3 -skew-x-12 animate-light-sweep bg-[linear-gradient(90deg,transparent,hsl(var(--primary-glow)/0.08),hsl(0_0%_100%/0.05),transparent)] mix-blend-screen" />
        </div>
      )}

      {/* Animated flight path crossing the sky */}
      <div className="pointer-events-none absolute inset-x-0 top-[12%] -z-10 h-[55%] opacity-70">
        <FlightPath className="h-full w-full" />
      </div>

      {/* HUD frame corners */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-6 top-24 h-px w-16 bg-primary/60 md:left-12" />
        <div className="absolute left-6 top-24 h-16 w-px bg-primary/60 md:left-12" />
        <div className="absolute right-6 top-24 h-px w-16 bg-primary/60 md:right-12" />
        <div className="absolute right-6 top-24 h-16 w-px bg-primary/60 md:right-12" />
      </div>

      <motion.div
        style={{ y: yCopy, opacity: opacityCopy }}
        className="container-page relative flex min-h-[100svh] flex-col justify-between pb-10 pt-28 md:pt-32"
      >
        {/* Top HUD telemetry strip */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="flex max-w-[calc(100%-3rem)] flex-wrap items-center gap-x-5 gap-y-2 md:max-w-none"
        >
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="hud-tag text-foreground/80">Flight Deck · Illustration</span>
          </div>
          <span className="hud-tag flex items-center gap-2 whitespace-nowrap">
            <MapPin className="h-3 w-3 flex-none" />
            <span className="sm:hidden">{client.identity.city}</span>
            <span className="hidden sm:inline">{client.identity.city}, {client.identity.state}</span>
          </span>
          <span className="hud-tag hidden items-center gap-2 whitespace-nowrap sm:flex">
            <PlayCircle className="h-3 w-3 flex-none" /> {client.identity.businessName}
          </span>
        </motion.div>

        {/* Main hero copy */}
        <div className="max-w-4xl">
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="eyebrow"
          >
            <span className="h-px w-8 bg-primary" />
            <span className="sm:hidden">{client.hero.eyebrow}</span>
            <span className="hidden sm:inline">{client.hero.eyebrow}</span>
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.2 }}
            className="display-xl mt-5 text-balance text-5xl text-foreground sm:text-6xl md:text-7xl lg:text-[5.5rem]"
          >
            {client.hero.line1}{" "}
            <span className="relative inline-block">
              <span className="bg-gradient-to-r from-runway via-runway-glow to-horizon bg-clip-text text-transparent">
                <ScrambleText text={client.hero.emphasis} duration={1100} />
              </span>
            </span>
            {" "}{client.hero.line3}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            {client.hero.support}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.55 }}
            className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <ControlButton
              href="#contact"
              variant="primary"
              size="lg"
              trailingIcon={<ArrowRight className="h-4 w-4" />}
            >
              Request Info
            </ControlButton>
            <ControlButton
              href="#programs"
              variant="secondary"
              size="lg"
              icon={<PlaneTakeoff className="h-4 w-4" />}
            >
              Explore Programs
            </ControlButton>
            <ControlButton
              href={client.identity.phoneTel}
              variant="ghost"
              size="lg"
              icon={<Route className="h-4 w-4" />}
            >
              Talk to the Team
            </ControlButton>
            <ControlButton
              href={client.identity.phoneTel}
              variant="link"
              size="sm"
              magnet={0}
              icon={<Phone className="h-3.5 w-3.5" />}
              ariaLabel={`Call ${client.identity.businessName} at ${client.identity.phoneDisplay}`}
            >
              {client.identity.phoneDisplay}
            </ControlButton>
          </motion.div>

          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.7 }}
            className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70"
          >
            {client.trust.badges.map(b => <li key={b.label} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{b.label}</li>)}
            {client.trust.aggregate && <li><a href={client.trust.aggregate.sourceUrl}>{client.trust.aggregate.rating}/5 · {client.trust.aggregate.count} reviews</a></li>}
          </motion.ul>
        </div>

        {/* Bottom HUD telemetry — now live-drifting */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border/60 bg-border/60 sm:grid-cols-4"
        >
          {[
            { k: "City", v: client.identity.city, live: false },
            { k: "Illustration · Altitude", v: `${Math.round(telemetry.alt)} ft`, live: true },
            { k: "Illustration · Heading", v: `${Math.round(telemetry.hdg).toString().padStart(3, "0")}°`, live: true },
            { k: "Illustration · Airspeed", v: `${Math.round(telemetry.ias)} kt`, live: true },
          ].map((s) => (
            <div key={s.k} className="bg-background/80 p-4 backdrop-blur-md">
              <div className="hud-tag flex items-center gap-1.5">
                {s.live && <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />}
                {s.k}
              </div>
              <div className="mt-1 font-mono text-sm text-foreground tabular-nums">{s.v}</div>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* scanning line */}
      <div className="pointer-events-none absolute inset-x-0 top-20 h-px overflow-hidden">
        <div className="h-px w-1/3 animate-scan bg-gradient-to-r from-transparent via-primary to-transparent" />
      </div>

      {/* Scroll cue */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 hidden -translate-x-1/2 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-foreground/60 md:flex">
        <span className="h-px w-8 bg-primary/60" /> Scroll <span className="h-px w-8 bg-primary/60" />
      </div>
    </section>
  );
};
