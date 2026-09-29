import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, PlaneTakeoff, Phone } from "lucide-react";

import { ControlButton } from "@/components/motion/ControlButton";
import { ParallaxLayer } from "@/components/motion/ParallaxLayer";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export const Discovery = () => {
  const reduced = useReducedMotion();
  const [t, setT] = useState({ alt: 1500, hdg: 230, spd: 110 });

  // Gentle, instrument-like drift on the discovery readouts
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setT((prev) => ({
        alt: Math.max(1400, Math.min(1600, prev.alt + (Math.random() * 30 - 15))),
        hdg: (prev.hdg + (Math.random() * 4 - 2) + 360) % 360,
        spd: Math.max(102, Math.min(118, prev.spd + (Math.random() * 2 - 1))),
      }));
    }, 1600);
    return () => clearInterval(id);
  }, [reduced]);

  const service = discoveryService();
  if (!service || !mediaSlot("discovery-view")) return null;
  return (
    <section id="discovery" className="relative overflow-hidden py-24 md:py-32">
      <div className="container-page">
        <div className="grid grid-cols-1 items-stretch gap-px overflow-hidden rounded-sm bg-border lg:grid-cols-2">
          {/* Image side */}
          <motion.div
            initial={{ opacity: 0, scale: 1.05 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
            className="relative min-h-[420px] overflow-hidden bg-surface"
          >
            <img
              src={mediaSlot("discovery-view")}
              alt={service.name}
              loading="lazy"
              width={1600}
              height={1100}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-sky-deep/60 via-transparent to-transparent" />

            {/* HUD frame corners */}
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-3 w-3 border-l-2 border-t-2 border-primary/70" />
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-3 h-3 w-3 border-r-2 border-t-2 border-primary/70" />
            <span aria-hidden="true" className="pointer-events-none absolute bottom-3 left-3 h-3 w-3 border-b-2 border-l-2 border-primary/70" />
            <span aria-hidden="true" className="pointer-events-none absolute bottom-3 right-3 h-3 w-3 border-b-2 border-r-2 border-primary/70" />

            {/* Radiating focus highlight — instrument-spotlight that pulses behind the live tag */}
            {!reduced && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 h-72 w-72 -translate-x-1/3 -translate-y-1/3 animate-focus-pulse rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.35),transparent_65%)] blur-2xl"
              />
            )}

            <div className="absolute left-6 top-6 flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse-glow rounded-full bg-primary" />
              <span className="hud-tag text-foreground">Illustrative flight instruments</span>
            </div>
            <div className="absolute bottom-6 left-6 right-6 grid grid-cols-3 gap-4 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/90">
              <div>
                <div className="text-muted-foreground">ALT</div>
                <div className="text-base tabular-nums">{Math.round(t.alt).toLocaleString()} ft</div>
              </div>
              <div>
                <div className="text-muted-foreground">HDG</div>
                <div className="text-base tabular-nums">
                  {Math.round(t.hdg).toString().padStart(3, "0")}°
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">SPD</div>
                <div className="text-base tabular-nums">{Math.round(t.spd)} kts</div>
              </div>
            </div>
          </motion.div>

          {/* Content side */}
          <ParallaxLayer offset={36} reverse as="div" className="bg-surface-elevated p-8 md:p-12 lg:p-16">
            <span className="eyebrow">
              <span className="h-px w-8 bg-primary" /> 03 — {service.shortLabel}
            </span>
            <h2 className="display-xl mt-4 text-4xl text-balance sm:text-5xl">
              {service.name}
            </h2>
            <p className="mt-6 text-base leading-relaxed text-muted-foreground">
              {service.description}
            </p>

            <ul className="mt-8 space-y-4">
              {([] as string[]).map((line) => (
                <li key={line} className="flex gap-3 text-sm text-foreground/90">
                  <span className="mt-2 h-px w-4 flex-none bg-primary" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <ControlButton
                href="#contact"
                variant="primary"
                size="lg"
                icon={<PlaneTakeoff className="h-4 w-4" />}
                trailingIcon={<ArrowRight className="h-4 w-4" />}
              >
                Request Information
              </ControlButton>
              <ControlButton
                href={client.identity.phoneTel}
                variant="ghost"
                size="lg"
                icon={<Phone className="h-4 w-4" />}
                ariaLabel={`Call ${client.identity.businessName} at ${client.identity.phoneDisplay}`}
              >
                {client.identity.phoneDisplay}
              </ControlButton>
            </div>
          </ParallaxLayer>
        </div>
      </div>
    </section>
  );
};
