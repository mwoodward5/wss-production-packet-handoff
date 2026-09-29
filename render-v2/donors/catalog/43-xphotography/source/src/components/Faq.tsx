import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Plus, Minus } from "lucide-react";

export interface FaqItem { q: string; a: string; }
interface Props {
  items: FaqItem[];
  emitSchema?: boolean;
  heading?: string;
  eyebrow?: string;
}

export default function Faq({ items, emitSchema = false, heading, eyebrow }: Props) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="py-20 bg-paper border-t border-ivory/10">
      {emitSchema && (
        <Helmet>
          <script type="application/ld+json">{JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: items.map((it) => ({
              "@type": "Question",
              name: it.q,
              acceptedAnswer: { "@type": "Answer", text: it.a },
            })),
          })}</script>
        </Helmet>
      )}
      <div className="container max-w-4xl">
        {eyebrow && <div className="label-eyebrow text-molten mb-6">{eyebrow}</div>}
        {heading && (
          <h2 className="font-display text-[2.025rem] md:text-[2.7rem] text-ivory leading-tight mb-12 text-balance">{heading}</h2>
        )}
        <ul className="divide-y divide-ivory/10 border-y border-ivory/10">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <li key={i}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full py-6 flex items-start justify-between gap-6 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-display text-xl md:text-2xl text-ivory">{it.q}</span>
                  <span className="text-molten mt-2 shrink-0">{isOpen ? <Minus className="w-5 h-5" /> : <Plus className="w-5 h-5" />}</span>
                </button>
                {isOpen && (
                  <div className="pb-8 pr-12 text-ivory/70 leading-relaxed text-pretty">{it.a}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
