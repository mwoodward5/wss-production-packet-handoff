import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

import { SectionReveal } from "@/components/motion/SectionReveal";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const steps = client.content.values.map((s,i) => ({n: String(i+1).padStart(2,'0'), ...s}));

export const Pathway = () => steps.length ? <PathwayContent /> : null;
const PathwayContent = () => {
  const reduced = useReducedMotion();
  const railRef = useRef<HTMLOListElement>(null);

  // Draw the rail in as the section scrolls through the viewport
  const { scrollYProgress } = useScroll({
    target: railRef,
    offset: ["start 75%", "end 60%"],
  });
  const railScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section id="pathway" className="relative overflow-hidden bg-surface py-24 md:py-32">
      <div className="absolute inset-0 -z-10 opacity-20 [background-image:linear-gradient(hsl(var(--border))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px)] [background-size:60px_60px]" />

      <div className="container-page">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
          <SectionReveal className="lg:col-span-5" from="left">
            <div className="lg:sticky lg:top-28">
              <span className="eyebrow">
                <span className="h-px w-8 bg-primary" /> 01 — Our Approach
              </span>
              <h2 className="display-xl mt-4 text-4xl text-balance sm:text-5xl md:text-6xl">
                {client.content.whyHeadline || client.identity.businessName}
              </h2>
              <p className="mt-6 text-base leading-relaxed text-muted-foreground">
                {client.content.about}
              </p>

              {mediaSlot("pathway-pilot") && <motion.div
                initial={
                  reduced
                    ? { opacity: 0 }
                    : { opacity: 1, clipPath: "inset(100% 0 0 0)" }
                }
                whileInView={
                  reduced
                    ? { opacity: 1 }
                    : { opacity: 1, clipPath: "inset(0% 0 0 0)" }
                }
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
                className="mt-10 overflow-hidden rounded-sm border border-border"
              >
                <img
                  src={mediaSlot("pathway-pilot")}
                  alt={`${client.identity.businessName} team`}
                  loading="lazy"
                  width={1080}
                  height={1600}
                  className="h-[420px] w-full object-cover transition-transform duration-[1200ms] ease-out hover:scale-[1.03]"
                />
              </motion.div>}
            </div>
          </SectionReveal>

          <ol ref={railRef} className="relative lg:col-span-7">
            {/* Static rail track (faint) */}
            <div className="absolute left-[27px] top-2 bottom-2 w-px bg-border" />
            {/* Drawing rail — scales vertically with scroll progress */}
            <motion.div
              aria-hidden="true"
              style={{
                scaleY: reduced ? 1 : railScale,
                transformOrigin: "top",
              }}
              className="absolute left-[27px] top-2 bottom-2 w-px bg-gradient-to-b from-primary via-primary/60 to-horizon shadow-[0_0_8px_hsl(var(--primary)/0.6)]"
            />
            {/* Sequenced approach lights along the rail */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-[24px] top-2 bottom-2 w-[7px]"
            >
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute left-1/2 h-[3px] w-[7px] -translate-x-1/2 rounded-full bg-primary/15"
                  style={{
                    top: `${(i / 24) * 100}%`,
                    animation: `runway-pulse 3.6s ease-in-out infinite`,
                    animationDelay: `${(i / 24) * 3.6}s`,
                  }}
                />
              ))}
              <style>{`
                @keyframes runway-pulse {
                  0%, 100% { background-color: hsl(var(--primary) / 0.12); box-shadow: none; }
                  20% { background-color: hsl(var(--primary)); box-shadow: 0 0 8px hsl(var(--primary) / 0.85); }
                  55% { background-color: hsl(var(--primary) / 0.35); }
                }
              `}</style>
            </div>
            {steps.map((s, i) => (
              <motion.li
                key={s.n}
                initial={{ opacity: 0, x: 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                className="group relative flex gap-6 pb-10 last:pb-0"
              >
                <div className="relative z-10 flex h-14 w-14 flex-none items-center justify-center rounded-sm border border-border bg-background font-mono text-sm text-primary shadow-deep transition-all duration-500 group-hover:border-primary group-hover:shadow-runway">
                  {/* Waypoint corner brackets — brighten on hover */}
                  <span aria-hidden="true" className="absolute left-1 top-1 h-1.5 w-1.5 border-l border-t border-primary/60 transition-colors group-hover:border-primary" />
                  <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 border-r border-t border-primary/60 transition-colors group-hover:border-primary" />
                  <span aria-hidden="true" className="absolute bottom-1 left-1 h-1.5 w-1.5 border-b border-l border-primary/60 transition-colors group-hover:border-primary" />
                  <span aria-hidden="true" className="absolute bottom-1 right-1 h-1.5 w-1.5 border-b border-r border-primary/60 transition-colors group-hover:border-primary" />
                  {s.n}
                </div>
                <div className="pt-1.5">
                  <div className="hud-tag">Waypoint · WP-{s.n}</div>
                  <h3 className="mt-0.5 font-display text-xl font-semibold text-foreground transition-colors group-hover:text-primary">
                    {s.title}
                  </h3>
                  <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                  {/* Hover reveal — thin underline that grows in */}
                  <div className="mt-3 h-px w-0 bg-gradient-to-r from-primary via-primary/40 to-transparent transition-all duration-700 ease-out group-hover:w-32" />
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
};
