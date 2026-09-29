import type { ReactNode } from "react";
import { Phone, MessageSquare, Sparkles } from "lucide-react";
import { CLIENT } from "@/config";

export function Section({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`mx-auto max-w-7xl px-5 lg:px-8 py-20 ${className}`}>{children}</section>;
}

export function SectionHeader({
  eyebrow,
  title,
  intro,
  center = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: string;
  center?: boolean;
}) {
  return (
    <div className={`max-w-3xl ${center ? "mx-auto text-center" : ""}`}>
      {eyebrow && <span className="chip mb-5">{eyebrow}</span>}
      <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-[1.1]">{title}</h2>
      {intro && <p className="mt-5 text-lg text-muted-foreground leading-relaxed">{intro}</p>}
    </div>
  );
}

export function AnswerBlock({ id, question, answer }: { id?: string; question: string; answer: string }) {
  return (
    <div id={id} data-speakable className="speakable premium-card p-6 md:p-7">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-[var(--gold)]" />
        <span className="text-xs font-semibold tracking-widest uppercase text-[var(--gold)]">In Short</span>
      </div>
      <p className="font-semibold text-foreground" data-speakable-question>{question}</p>
      <p className="mt-2 text-muted-foreground leading-relaxed" data-speakable-answer>{answer}</p>
    </div>
  );
}

export function CallCTA({ heading, sub }: { heading: string; sub?: string }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-[oklch(0.82_0.13_88/0.25)] bg-[var(--gradient-card)] p-8 md:p-12">
      <div className="absolute inset-0 grid-overlay opacity-50 pointer-events-none" />
      <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <h3 className="text-2xl md:text-3xl font-bold leading-tight">{heading}</h3>
          {sub && <p className="mt-2 text-muted-foreground max-w-xl">{sub}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={`tel:${CLIENT.phoneE164}`} className="btn-gold"><Phone className="w-4 h-4" /> Call {CLIENT.phone}</a>
          <a href="/#contact" className="btn-ghost-gold"><MessageSquare className="w-4 h-4" /> Contact</a>
        </div>
      </div>
    </div>
  );
}

export function FAQ({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((it) => (
        <details key={it.q} className="group premium-card p-6 cursor-pointer">
          <summary className="flex items-center justify-between gap-4 list-none font-semibold">
            <span>{it.q}</span>
            <span className="text-[var(--gold)] text-xl transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="mt-3 text-muted-foreground leading-relaxed">{it.a}</p>
        </details>
      ))}
    </div>
  );
}
