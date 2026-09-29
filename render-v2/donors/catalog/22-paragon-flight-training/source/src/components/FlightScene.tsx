import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { FlightPath } from "@/components/motion/FlightPath";
import { useReducedMotion } from "@/hooks/use-reduced-motion";


/**
 * FlightScene — a scroll-choreographed cinematic interlude.
 * - Tall section with sticky viewport-height stage
 * - Animated SVG flight trail draws as the user scrolls
 * - HUD telemetry (altitude, heading, airspeed, ETA) interpolates
 *   along the route between three Southwest Florida waypoints
 * - Background pans with parallax to suggest forward motion
 */

const WAYPOINTS = [
  { code: "01", name: "Departure", note: "Departure", alt: 0, hdg: 230, ias: 0 },
  { code: "02", name: "Climb", note: "Climb", alt: 2400, hdg: 196, ias: 118 },
  { code: "03", name: "Cruise", note: "Cross-country", alt: 3500, hdg: 178, ias: 124 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const FlightScene = () => mediaSlot('flightscene-bg') ? <FlightSceneContent /> : null;
const FlightSceneContent = () => {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  // Smooth the scroll progress so HUD numbers feel "instrumented"
  const smooth = useSpring(scrollYProgress, { stiffness: 80, damping: 22, mass: 0.6 });

  // Background parallax
  const bgY = useTransform(smooth, [0, 1], ["-8%", "8%"]);
  const bgScale = useTransform(smooth, [0, 1], [1.1, 1.25]);

  // HUD live values driven by progress
  const alt = useTransform(smooth, (p) => {
    if (p < 0.5) return Math.round(lerp(WAYPOINTS[0].alt, WAYPOINTS[1].alt, p / 0.5));
    return Math.round(lerp(WAYPOINTS[1].alt, WAYPOINTS[2].alt, (p - 0.5) / 0.5));
  });
  const hdg = useTransform(smooth, (p) => {
    if (p < 0.5) return Math.round(lerp(WAYPOINTS[0].hdg, WAYPOINTS[1].hdg, p / 0.5));
    return Math.round(lerp(WAYPOINTS[1].hdg, WAYPOINTS[2].hdg, (p - 0.5) / 0.5));
  });
  const ias = useTransform(smooth, (p) => {
    if (p < 0.5) return Math.round(lerp(WAYPOINTS[0].ias, WAYPOINTS[1].ias, p / 0.5));
    return Math.round(lerp(WAYPOINTS[1].ias, WAYPOINTS[2].ias, (p - 0.5) / 0.5));
  });
  const eta = useTransform(smooth, (p) => {
    const total = 38; // minutes — concept value
    return Math.max(0, Math.round(total * (1 - p)));
  });

  return (
    <section
      ref={ref}
      id="flightscene"
      aria-label="Illustrative flight scene"
      className="relative bg-sky-deep"
    >
      {/* Tall scroll track — pin the stage inside */}
      <div className="relative h-[260vh]">
        <div className="sticky top-0 h-screen overflow-hidden">
          {/* Parallax sky background */}
          <motion.div
            style={reduced ? undefined : { y: bgY, scale: bgScale }}
            className="absolute inset-0 -z-10"
          >
            <img
              src={mediaSlot("flightscene-bg")}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover opacity-40"
            />
          </motion.div>

          {/* Layered atmospheric scrim */}
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-sky-deep/85 via-sky-deep/70 to-sky-deep" />
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_hsl(var(--sky-deep))_80%)]" />

          {/* Faint grid horizon */}
          <div className="absolute inset-x-0 bottom-0 -z-10 h-1/2 opacity-30 [background-image:linear-gradient(hsl(var(--primary)/0.25)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--primary)/0.15)_1px,transparent_1px)] [background-size:80px_60px] [transform:perspective(600px)_rotateX(60deg)] [transform-origin:bottom]" />

          {/* The flight path crossing the stage */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-full max-w-[1600px] px-8">
              <FlightPath
                progress={smooth}
                className="h-[60vh] w-full"
                viewBox="0 0 1600 540"
              />
            </div>
          </div>

          {/* Editorial copy on the left */}
          <div className="container-page relative z-10 flex h-full flex-col justify-between py-20">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="max-w-xl"
            >
              <span className="eyebrow">
                <span className="h-px w-8 bg-primary" /> 03 — Illustrative Route
              </span>
              <h2 className="display-xl mt-4 text-4xl text-balance sm:text-5xl md:text-6xl">
                {client.identity.businessName}
              </h2>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
                {client.content.seasonalNote}
              </p>
            </motion.div>

            {/* Bottom HUD strip — instruments pinned to bottom */}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border/60 bg-border/60 sm:grid-cols-4">
              <Instrument label="Altitude" unit="ft" value={alt} />
              <Instrument label="Heading" unit="°" value={hdg} pad={3} />
              <Instrument label="Airspeed" unit="kt" value={ias} />
              <Instrument label="Illustrative ETA" unit="min" value={eta} />
            </div>
          </div>

          {/* Waypoint chips along the bottom edge */}
          <div className="pointer-events-none absolute inset-x-0 bottom-44 hidden justify-between px-12 lg:flex">
            {WAYPOINTS.map((w, i) => (
              <motion.div
                key={w.code}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 + i * 0.1 }}
                className="flex flex-col items-center gap-1.5"
              >
                <span className="h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                <div className="rounded-sm border border-border bg-background/80 px-2 py-1 text-center backdrop-blur-md">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
                    {w.code}
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground">{w.note}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const Instrument = ({
  label,
  unit,
  value,
  pad,
}: {
  label: string;
  unit: string;
  value: ReturnType<typeof useTransform<number, number>>;
  pad?: number;
}) => {
  return (
    <div className="bg-background/85 p-4 backdrop-blur-md">
      <div className="hud-tag flex items-center gap-1.5">
        <span className="h-1 w-1 animate-pulse rounded-full bg-primary" />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1 font-mono text-base text-foreground tabular-nums">
        <NumberOut value={value} pad={pad} />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
};

const NumberOut = ({
  value,
  pad,
}: {
  value: ReturnType<typeof useTransform<number, number>>;
  pad?: number;
}) => {
  const display = useTransform(value, (v: number) =>
    pad ? Math.round(v).toString().padStart(pad, "0") : Math.round(v).toString(),
  );
  return <motion.span>{display}</motion.span>;
};
