import { BUSINESS } from "@/lib/business";
import { SERVICES, CITIES } from "@/lib/services-data";
import { client, sectionCopy, sectionItems } from "@/lib/wss-bridge";
import type { ComponentType, SVGProps } from "react";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ArrowRight,
  Phone,
  ShieldCheck,
  ClipboardList,
  Wrench,
  Search,
  AlertTriangle,
  Home,
  TreeDeciduous,
  TreePine,
  Scissors,
  Snowflake,
  Truck,
  CloudLightning,
  Axe,
  Sprout,
  Layers,
  Leaf,
  Mountain,
} from "lucide-react";

type IconType = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
export type ProblemItem = {title:string;body:string;icon?:IconType};
export const PROBLEM_SETS: Record<string,ProblemItem[]> = {};

export function InShortBlock({
  topic,
  bullets,
}: {
  topic: string;
  bullets: string[];
}) {
  if (!bullets.length) return null;
  return (
    <section className="py-10 sm:py-12" aria-labelledby="in-short-heading">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
            <ClipboardList className="h-4 w-4" /> In short
          </div>
          <h2 id="in-short-heading" className="mt-2 text-2xl font-bold text-foreground">
            {topic}
          </h2>
          <ul className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}


export function CostFactorsBlock({
  serviceLabel = "tree work",
  rangeLow = 0,
  rangeHigh = 2000,
  factors,
}: {
  serviceLabel?: string;
  rangeLow?: number;
  rangeHigh?: number;
  factors?: { label: string; detail: string }[];
}) {
  const items = sectionItems('Cost factors').map(s => ({label:s.title,detail:s.body}));
  if (!items.length) return null;
  return (
    <section className="bg-muted/40 py-14 sm:py-16" aria-labelledby="cost-factors-heading">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <h2 id="cost-factors-heading" className="text-3xl font-bold sm:text-4xl">
          What Affects the Cost of {serviceLabel.charAt(0).toUpperCase() + serviceLabel.slice(1)}
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {items.map((f) => (
            <div key={f.label} className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="text-base font-bold text-foreground">{f.label}</div>
              <p className="mt-2 text-sm text-muted-foreground">{f.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


export function ProcessBlock({
  steps,
}: {
  steps?: { title: string; body: string }[];
}) {
  const items = sectionItems('Our process');
  if (!items.length) return null;
  return (
    <section className="py-14 sm:py-16" aria-labelledby="process-heading">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <h2 id="process-heading" className="text-3xl font-bold sm:text-4xl">Our Process</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <div key={s.title} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="text-base font-bold text-foreground">{s.title}</div>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


export function HiringGuideBlock() {
  const items = sectionItems("Hiring guide");
  if (!items.length) return null;
  return (
    <section className="bg-muted/40 py-14 sm:py-16" aria-labelledby="hiring-guide-heading">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
          <Search className="h-4 w-4" /> Hiring guide
        </div>
        <h2 id="hiring-guide-heading" className="mt-2 text-3xl font-bold sm:text-4xl">
          Hiring Guide
        </h2>
        <div className="mt-6 space-y-4">
          {items.map((it) => (
            <div key={it.title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <div className="text-base font-bold text-foreground">{it.title}</div>
                  <p className="mt-2 text-sm text-muted-foreground">{it.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


export function ProblemsSolvedBlock({
  problems,
  topicSlug,
}: {
  problems?: ProblemItem[];
  /** Optional service slug to auto-pick a curated, icon-rich problem set */
  topicSlug?: keyof typeof PROBLEM_SETS;
}) {
  const items: ProblemItem[] = sectionItems('Problems we solve');
  if (!items.length) return null;
  return (
    <section className="py-14 sm:py-16" aria-labelledby="problems-heading">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <h2 id="problems-heading" className="text-3xl font-bold sm:text-4xl">
          Problems We Solve
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => {
            const Icon = p.icon ?? Wrench;
            return (
              <div
                key={p.title}
                className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition-smooth hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow"
              >
                <div className="relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-secondary text-primary transition-smooth before:absolute before:-right-1 before:top-2 before:h-3 before:w-3 before:rounded-full before:bg-accent group-hover:border-primary/40 group-hover:bg-primary/10">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-bold">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}


export function StormBucketSnowBlock() {
  const capabilities = sectionItems('Capabilities');
  if (!capabilities.length) return null;
  return (
    <section className="bg-muted/40 py-14 sm:py-16" aria-labelledby="bucket-storm-snow-heading">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <h2 id="bucket-storm-snow-heading" className="text-3xl font-bold sm:text-4xl">
          Capabilities
        </h2>
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {capabilities.map(c => <div key={c.title} className="rounded-2xl border border-border bg-card p-6 shadow-sm"><h3 className="text-lg font-bold">{c.title}</h3><p className="mt-2 text-sm text-muted-foreground">{c.body}</p></div>)}
        </div>
      </div>
    </section>
  );
}


export function ServiceAreaInlineBlock({ excludeSlug }: { excludeSlug?: string }) {
  if (!CITIES.length) return null;
  return (
    <section className="py-14 sm:py-16" aria-labelledby="inline-areas-heading">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <h2 id="inline-areas-heading" className="text-3xl font-bold sm:text-4xl">
          Service Areas
        </h2>
        <div className="mt-6 flex flex-wrap gap-2">
          {CITIES.filter((c) => c.slug !== excludeSlug).map((c) => (
            <Link
              key={c.slug}
              to={c.path}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-smooth hover:-translate-y-0.5 hover:border-primary hover:text-primary"
            >
              {c.city}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}


export function InternalLinkHubBlock({ excludeServiceSlug, excludeCitySlug }: { excludeServiceSlug?: string; excludeCitySlug?: string }) {
  const services = SERVICES.filter((s) => s.slug !== excludeServiceSlug);
  const cities = CITIES.filter((c) => c.slug !== excludeCitySlug);
  return (
    <section className="bg-surface py-14 text-surface-foreground sm:py-16" aria-labelledby="link-hub-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 id="link-hub-heading" className="text-3xl font-bold sm:text-4xl">Explore More Tree Services & Service Areas</h2>
        <p className="mt-3 text-surface-foreground/75">
          Explore services and contact details.
        </p>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wider text-primary-glow">Services</div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {services.map((s) => (
                <li key={s.slug}>
                  <Link to={s.path} className="inline-flex items-center gap-1 text-sm font-semibold hover:text-primary-glow">
                    <ArrowRight className="h-3.5 w-3.5" /> {s.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-sm font-semibold uppercase tracking-wider text-primary-glow">Service areas</div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {cities.map((c) => (
                <li key={c.slug}>
                  <Link to={c.path} className="inline-flex items-center gap-1 text-sm font-semibold hover:text-primary-glow">
                    <ArrowRight className="h-3.5 w-3.5" /> {c.city}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={`tel:${BUSINESS.phoneRaw}`} className="inline-flex items-center gap-2 rounded-md bg-cta-gradient px-5 py-3 text-sm font-bold text-accent-foreground shadow-amber">
            <Phone className="h-4 w-4" /> Call {BUSINESS.phoneDisplay}
          </a>
          <Link to="/contact" className="inline-flex items-center gap-2 rounded-md border border-white/20 px-5 py-3 text-sm font-semibold">
            Request an estimate <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
