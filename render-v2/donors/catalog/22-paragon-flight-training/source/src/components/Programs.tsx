import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { motion } from "framer-motion";
import { Plane, Compass, Cloud, Briefcase, Radio, GraduationCap } from "lucide-react";

const programs = client.services.map((s,i) => ({code:String(i+1),icon:Plane,title:s.name,desc:s.description,topics:[] as string[]}));

export const Programs = () => {
  return (
    <section id="programs" className="relative py-24 md:py-32">
      <div className="container-page">
        <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <span className="eyebrow">
              <span className="h-px w-8 bg-primary" />
              01 — Training Programs
            </span>
            <h2 className="display-xl mt-4 text-4xl text-balance sm:text-5xl md:text-6xl">
              Explore training programs.
            </h2>
          </div>
          <p className="text-base leading-relaxed text-muted-foreground lg:col-span-5">
            {client.content.serviceIntro}
          </p>
        </div>

        <div className="horizon-line mt-14" />

        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-sm bg-border md:grid-cols-2 lg:grid-cols-3">
          {programs.map((p, i) => {
            const Icon = p.icon;
            return (
              <motion.article
                key={p.code}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -4, transition: { duration: 0.3, ease: "easeOut" } }}
                className="group relative bg-background p-8 transition-colors hover:bg-surface"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-border bg-surface-elevated text-primary transition-all group-hover:border-primary group-hover:shadow-runway">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    {p.code}
                  </span>
                </div>
                <h3 className="mt-6 font-display text-xl font-semibold text-foreground">
                  {p.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
                <ul className="mt-6 space-y-1.5">
                  {p.topics.map((t) => (
                    <li
                      key={t}
                      className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
                    >
                      <span className="h-px w-3 bg-primary/70" />
                      {t}
                    </li>
                  ))}
                </ul>
                <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
                  <div className="h-px w-0 bg-gradient-to-r from-transparent via-primary to-transparent transition-all duration-700 group-hover:w-full" />
                </div>
              </motion.article>
            );
          })}
        </div>

        <p className="mt-8 max-w-2xl font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Program details, prerequisites, and aircraft assignments confirmed during admissions.
        </p>
      </div>
    </section>
  );
};
