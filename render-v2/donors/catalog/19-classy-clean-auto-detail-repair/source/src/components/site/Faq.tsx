import { getSite } from "@/lib/wss";
import { useState } from "react";
import { Plus, Minus } from "lucide-react";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const FAQS=getSite().content.faqs;
  if (!FAQS.length) return null;
  return (
    <section id="faq" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-5">
          <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground">§ 06 — Common questions</span>
          <h2 className="mt-4 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.02] tracking-tight text-balance">
            Straight answers,<br />
            no <em className="text-accent not-italic">runaround</em>.
          </h2>
          <p className="mt-5 text-muted-foreground max-w-md leading-relaxed">
            Don't see your question? Contact us.
          </p>
        </div>

        <ul className="col-span-12 lg:col-span-7 divide-y divide-border border-y border-border">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <li key={i}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full text-left py-6 flex items-start gap-6 group"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${i}`}
                  id={`faq-question-${i}`}
                >
                  <span className="font-mono text-xs text-accent pt-1.5 shrink-0">{String(i+1).padStart(2,'0')}</span>
                  <span className="font-display text-lg sm:text-xl flex-1 group-hover:text-accent transition-colors">{f.q}</span>
                  <span className="shrink-0 mt-1">
                    {isOpen ? <Minus className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                  </span>
                </button>
                <div
                  id={`faq-answer-${i}`}
                  aria-labelledby={`faq-question-${i}`}
                  aria-hidden={!isOpen}
                  className={`grid transition-all duration-500 ${isOpen ? "grid-rows-[1fr] opacity-100 pb-7" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <div className="overflow-hidden">
                    <p className="pl-10 pr-10 text-muted-foreground leading-relaxed text-pretty max-w-2xl">{f.a}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
