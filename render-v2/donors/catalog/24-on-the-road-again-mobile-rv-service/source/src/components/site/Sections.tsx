import type { ReactNode } from "react";
import { Phone, MessageSquare, ArrowRight } from "lucide-react";
import { CLIENT } from "@/config";

export function Section({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`mx-auto max-w-7xl px-5 lg:px-8 py-20 ${className}`}>{children}</section>;
}

export function SectionHeader({
  eyebrow, title, intro, center = false,
}: { eyebrow?: string; title: ReactNode; intro?: string; center?: boolean }) {
  return (
    <div className={`max-w-3xl ${center ? "mx-auto text-center" : ""}`}>
      {eyebrow && <span className="chip mb-5">{eyebrow}</span>}
      <h2 className="font-serif text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1]">{title}</h2>
      {intro && <p className="mt-5 text-lg text-muted-foreground leading-relaxed">{intro}</p>}
    </div>
  );
}

export function CallCTA({
  heading,
  sub,
  secondaryHref = "/services",
  secondaryLabel = "Services",
}: {
  heading: string;
  sub?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-[var(--gradient-card)] p-8 md:p-12">
      <div className="absolute inset-0 grid-overlay opacity-40 pointer-events-none" />
      <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <h3 className="font-serif text-2xl md:text-3xl font-semibold leading-tight">{heading}</h3>
          {sub && <p className="mt-2 text-muted-foreground max-w-xl">{sub}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={`tel:${CLIENT.phoneE164}`} className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold">
            <Phone className="w-4 h-4" /> Call Now
          </a>
          
          <a href={secondaryHref} className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted">
            {secondaryLabel} <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

export function FAQ({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((it) => (
        <details key={it.q} className="group rounded-2xl border border-border bg-card p-6 cursor-pointer">
          <summary className="flex items-center justify-between gap-4 list-none font-semibold">
            <span>{it.q}</span>
            <span className="text-primary text-xl transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="mt-3 text-muted-foreground leading-relaxed">{it.a}</p>
        </details>
      ))}
    </div>
  );
}
