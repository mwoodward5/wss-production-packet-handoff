import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { motion } from "framer-motion";
import {
  Plane,
  Cloud,
  Briefcase,
  Compass,
  GraduationCap,
  Radio,
  ArrowRight,
} from "lucide-react";
import { ScrambleText } from "@/components/motion/ScrambleText";
import { ControlButton } from "@/components/motion/ControlButton";

/**
 * Certification Mission Control — replaces the generic 6-card grid with a
 * single editorial ledger that reads like a flight-strip board.
 * Each row = one rating, with code · title · skill set · checkride badge.
 */
const ratings = client.services.map((s, i) => ({code: String(i+1).padStart(2,'0'), icon: Plane, title: s.name, blurb: s.description, topics: [] as string[], checkride: '', accent: i % 2 ? 'instrument' : 'runway', href: serviceHref(s)}));

export const MissionControl = () => {
  return (
    <section id="programs" className="relative py-24 md:py-32">
      <div className="container-page">
        <div className="grid grid-cols-1 items-end gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <span className="eyebrow">
              <span className="h-px w-8 bg-primary" />
              02 — Program Mission Control
            </span>
            <h2 className="display-xl mt-4 text-4xl text-balance sm:text-5xl md:text-6xl">
              Explore training programs.
            </h2>
          </div>
          <p className="text-base leading-relaxed text-muted-foreground lg:col-span-5">
            {client.content.serviceIntro}
          </p>
        </div>

        {/* Flight-strip ledger header */}
        <div className="mt-14 hidden grid-cols-12 items-center gap-4 border-b border-border pb-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground md:grid">
          <div className="col-span-1">Code</div>
          <div className="col-span-3">Rating</div>
          <div className="col-span-4">Skill Set</div>
          <div className="col-span-3">Details</div>
          <div className="col-span-1 text-right">→</div>
        </div>

        <ul className="mt-2">
          {ratings.map((r, i) => {
            const Icon = r.icon;
            return (
              <motion.li
                key={r.code}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: i * 0.04 }}
                whileHover={{ x: 4 }}
                className="group relative grid grid-cols-1 gap-4 border-b border-border py-6 transition-colors hover:bg-surface md:grid-cols-12 md:items-center md:gap-4 md:py-5"
              >
                {/* hover edge accent */}
                <span className="pointer-events-none absolute left-0 top-0 h-full w-0.5 origin-top scale-y-0 bg-gradient-to-b from-primary to-horizon transition-transform duration-500 group-hover:scale-y-100" />
                <div className="col-span-1 flex items-center gap-3">
                  <span
                    className={
                      "flex h-9 w-9 items-center justify-center rounded-sm border border-border " +
                      (r.accent === "runway"
                        ? "bg-gradient-runway text-primary-foreground"
                        : "bg-gradient-instrument text-primary-foreground")
                    }
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary md:hidden">
                    {r.code}
                  </span>
                </div>
                <div className="col-span-3">
                  <div className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-primary md:block">
                    <ScrambleText text={r.code} duration={700} />
                  </div>
                  <div className="mt-0.5 font-display text-lg font-semibold text-foreground transition-colors group-hover:text-primary">
                    {r.title}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.blurb}</p>
                </div>
                <ul className="col-span-4 flex flex-wrap gap-1.5">
                  {r.topics.map((t) => (
                    <li
                      key={t}
                      className="rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
                <div className="col-span-3">
                  {r.checkride && <div className="hud-tag">Details</div>}
                  <div className="mt-1 font-mono text-xs text-foreground/90">{r.checkride}</div>
                </div>
                <div className="col-span-1 flex md:justify-end">
                  <ControlButton
                    href={r.href}
                    variant="link"
                    size="sm"
                    magnet={0}
                    ariaLabel={`Inquire about ${r.title}`}
                    trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}
                  >
                    Explore
                  </ControlButton>
                </div>
              </motion.li>
            );
          })}
        </ul>

        <p className="mt-8 max-w-2xl font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Program details, prerequisites, and aircraft assignments confirmed during admissions.
        </p>
      </div>
    </section>
  );
};
