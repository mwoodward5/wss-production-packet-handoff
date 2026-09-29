import { CLIENT } from "@/lib/wss";
import { Plus } from "lucide-react";
import { useState } from "react";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const faqs=CLIENT.content.faqs;
  if (!faqs.length) return null;

  return (
    <section id="faq" className="relative py-24 md:py-32 bg-secondary/40 border-t border-border">
      <div className="container mx-auto px-5 md:px-8 grid lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-4">
          <p className="text-xs font-bold tracking-[0.25em] uppercase text-[var(--coral)]">
            Common questions
          </p>
          <h2 className="mt-3 text-3xl md:text-5xl uppercase leading-[1.05]">
            Answers before you call.
          </h2>
        </div>

        <div className="lg:col-span-8 divide-y divide-border border-y border-border">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 py-5 md:py-6 text-left"
                  aria-expanded={isOpen}
                >
                  <h3 className="text-base md:text-lg font-display uppercase">{f.q}</h3>
                  <Plus
                    className={`h-5 w-5 shrink-0 text-[var(--coral)] transition-transform duration-300 ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-300 ${
                    isOpen ? "grid-rows-[1fr] opacity-100 pb-6" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="text-muted-foreground leading-relaxed text-sm md:text-base font-sans">
                      {f.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
