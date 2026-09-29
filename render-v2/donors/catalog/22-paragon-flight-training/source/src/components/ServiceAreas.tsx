import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Car, Plane, ChevronRight, ArrowRight } from "lucide-react";

import { CITIES, cityPath, HUB_PATH, type CitySlug } from "@/data/local";
import { ParallaxLayer } from "@/components/motion/ParallaxLayer";

/**
 * City guide for service areas — replaces the generic 5-column tile band
 * with an editorial city ledger. Each city is a small "guide entry"
 * with drive context and an inline FAQ-style snippet for voice search.
 */
const cityGuide = CITIES.map(c => ({...c, snippet:c.intro, nearby:c.landmarks, primary:false}));

export const ServiceAreas = () => {
  if (!cityGuide.length) return null;
  return (
    <section
      id="areas"
      className="relative overflow-hidden py-24 md:py-32"
      aria-label="Service areas"
    >
      <div className="container-page">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-end">
          <ParallaxLayer offset={28} className="lg:col-span-7">
            <span className="eyebrow">
              <span className="h-px w-8 bg-primary" /> 05 — Service Areas
            </span>
            <h2 className="display-xl mt-4 text-4xl text-balance sm:text-5xl md:text-6xl">
              {client.identity.businessName} service areas.
            </h2>
          </ParallaxLayer>
          <ParallaxLayer offset={18} reverse as="div" className="lg:col-span-5">
            <p className="text-base leading-relaxed text-muted-foreground">
              {paragraphs(sitePlan?.content?.["service-area"]).join(" ")}
            </p>
          </ParallaxLayer>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-sm bg-border lg:grid-cols-5">
          {cityGuide.map((c, i) => (
            <motion.div
              key={c.slug}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
              className={c.primary ? "bg-surface-elevated" : "bg-background"}
            >
              <Link
                to={cityPath(c.slug)}
                aria-label={`Open ${c.name} flight school page`}
                className={
                  "group relative flex h-full flex-col gap-4 p-6 transition-colors " +
                  (c.primary ? "" : "hover:bg-surface")
                }
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary">
                    0{i + 1}
                  </span>
                  {c.primary ? (
                    <span className="inline-flex items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-primary">
                      <Plane className="h-2.5 w-2.5" /> Home base
                    </span>
                  ) : (
                    <Car className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>

                <div>
                  <h3 className="font-display text-lg font-semibold text-foreground group-hover:text-primary">{c.name}</h3>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    {[c.minutes,c.drive].filter(Boolean).join(" · ")}
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-muted-foreground">{c.snippet}</p>

                <ul className="space-y-1">
                  {c.nearby.map((n) => (
                    <li
                      key={n}
                      className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
                    >
                      <ChevronRight className="h-3 w-3 text-primary/60" /> {n}
                    </li>
                  ))}
                </ul>

                <span className="mt-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Open page <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <Link
            to={HUB_PATH}
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-primary hover:text-primary-glow"
          >
            All service areas & programs <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {client.content.faqs.length > 0 && <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {client.content.faqs.slice(0,3).map(f => <div key={f.q} className="rounded-sm border border-border bg-surface p-6"><div className="hud-tag">Questions</div><p className="mt-3 font-display text-base text-foreground">{f.q}</p><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p></div>)}
        </div>}
        {mediaSlot('flightscene-bg') && <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-sm bg-border md:grid-cols-3">
          <div className="md:col-span-2 relative min-h-[280px]">
            <img src={mediaSlot('flightscene-bg')} alt={client.identity.businessName} loading="lazy" width={1600} height={1100} className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-sky-deep/60 via-transparent to-transparent" />
          </div>
          <div className="bg-surface-elevated p-8">
            <div className="hud-tag">About</div>
            <p className="mt-3 font-display text-xl text-foreground">{client.content.whyHeadline}</p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{client.content.about}</p>
          </div>
        </div>}
      </div>
    </section>
  );
};
