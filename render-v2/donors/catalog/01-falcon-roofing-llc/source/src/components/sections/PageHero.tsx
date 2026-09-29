import {CLIENT} from "@/lib/wss";
import { Link } from "react-router-dom";
import { ChevronRight, Phone } from "lucide-react";
import { HeroMedia } from "@/components/HeroMedia";
import { BUSINESS } from "@/lib/business";

interface Crumb { label: string; href?: string }

export const PageHero = ({ eyebrow, title, subtitle, image, imageAlt, crumbs }: {
  eyebrow: string; title: string; subtitle: string; image?: string; imageAlt: string; crumbs: Crumb[];
}) => (
  <section className="relative isolate overflow-hidden bg-primary text-primary-foreground">
    {/* Full-bleed image plate */}
    <div className="relative h-[68vh] min-h-[520px] w-full md:h-[78vh]">
      <HeroMedia
        poster={image}
        posterAlt={imageAlt}
        width={1920}
        height={1080}
        objectPosition="center 40%"
        overlayClassName="bg-gradient-to-b from-primary/30 via-primary/20 to-primary/95"
      />
      {/* Roofline scan beam */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-70 page-hero-scan" aria-hidden="true" />
      {/* Blueprint hairline at top */}
      <div className="pointer-events-none absolute inset-0 blueprint-grid-dark opacity-25" aria-hidden="true" />

      {/* Floating spec stamp — bottom-right */}
      {CLIENT.trust.badges.length > 0 && <div className="pointer-events-none absolute right-5 top-24 hidden md:block">
        <div className="rotate-[-3deg] border-2 border-accent/80 bg-primary/55 px-4 py-2 backdrop-blur-sm" style={{ borderRadius: "2px" }}>
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-accent">{CLIENT.identity.businessName}</div>
          <div className="font-display text-xs font-bold text-primary-foreground">{CLIENT.trust.badges[0]?.label}</div>
        </div>
      </div>}

      {/* Title block: bottom-anchored, asymmetric */}
      <div className="absolute inset-x-0 bottom-0">
        <div className="container-tight pb-10 md:pb-14">
          <nav aria-label="Breadcrumb" className="mb-5 text-xs">
            <ol className="flex flex-wrap items-center gap-1 text-primary-foreground/75">
              {crumbs.map((c, i) => (
                <li key={i} className="flex items-center gap-1">
                  {c.href ? <Link to={c.href} className="hover:text-accent-glow">{c.label}</Link> : <span className="text-primary-foreground">{c.label}</span>}
                  {i < crumbs.length - 1 && <ChevronRight className="h-3 w-3" />}
                </li>
              ))}
            </ol>
          </nav>
          <div className="grid items-end gap-6 md:grid-cols-12">
            <div className="md:col-span-9">
              <div className="flex items-center gap-3">
                <span className="inline-block h-3 w-3 rotate-45 bg-accent" aria-hidden="true" />
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-accent-glow">{eyebrow}</span>
                <span className="h-px flex-1 bg-primary-foreground/25" aria-hidden="true" />
              </div>
              <h1 className="mt-4 font-display text-[34px] font-extrabold leading-[0.98] tracking-tight sm:text-5xl md:text-[64px]">
                {title}
              </h1>
            </div>
            <a
              href={`tel:${BUSINESS.phoneTel}`}
              className="group hidden items-center justify-between gap-3 border-l-2 border-accent bg-primary/65 px-4 py-3 backdrop-blur-sm md:col-span-3 md:flex"
              style={{ borderRadius: "2px" }}
            >
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/65">Direct line</div>
                <div className="font-display text-base font-bold text-primary-foreground transition group-hover:text-accent-glow">{BUSINESS.phoneDisplay}</div>
              </div>
              <Phone className="h-5 w-5 text-accent" />
            </a>
          </div>
        </div>
      </div>
    </div>

    {/* Subtitle band — below the image plate, on the dark surface */}
    <div className="border-t border-primary-foreground/10 bg-primary/95">
      <div className="container-tight grid gap-6 py-8 md:grid-cols-12 md:py-10">
        <p className="max-w-3xl text-base text-primary-foreground/85 md:col-span-9 md:text-lg">{subtitle}</p>
        <div className="flex items-center gap-2 md:col-span-3 md:justify-end">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-signal">{BUSINESS.city}, {BUSINESS.region}</span>
        </div>
      </div>
    </div>
  </section>
);
