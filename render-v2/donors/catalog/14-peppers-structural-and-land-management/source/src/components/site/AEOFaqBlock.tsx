import { Link } from "@tanstack/react-router";
import { FAQSchema } from "@/components/site/FAQSchema";

/**
 * AEO / voice-search friendly FAQ block.
 *
 * Each entry has:
 *  - q: a natural-language question (the way someone would speak it)
 *  - a: a SHORT direct answer (≤ ~55 words, leads with the answer in the
 *       first sentence — what voice assistants and AI engines extract).
 *  - more: optional inline supporting links to related sections / pages.
 *
 * Renders both visible HTML (for users + on-page SEO) AND FAQPage JSON-LD
 * (for Google, Bing, ChatGPT, Perplexity, voice assistants).
 */

export type AEOFaq = {
  q: string;
  a: string;
  more?: ReadonlyArray<{ label: string; to?: string; href?: string; params?: Record<string, string> }>;
};

type Props = {
  eyebrow?: string;
  heading?: React.ReactNode;
  intro?: string;
  faqs: ReadonlyArray<AEOFaq>;
  /** When true, also emit FAQPage JSON-LD for this block. */
  emitSchema?: boolean;
};

export function AEOFaqBlock({
  eyebrow = "[ Quick answers · Voice-search friendly ]",
  heading,
  intro,
  faqs,
  emitSchema = true,
}: Props) {
  return (
    <section className="border-t border-rule bg-cream py-20 lg:py-28" aria-label="Frequently asked questions">
      {emitSchema && <FAQSchema faqs={faqs.map((f) => ({ q: f.q, a: f.a }))} />}
      <div className="mx-auto grid max-w-[1400px] gap-10 px-5 lg:grid-cols-12 lg:px-10">
        <div className="lg:col-span-4">
          <p className="eyebrow">{eyebrow}</p>
          {heading && (
            <h2 className="mt-4 font-display text-4xl leading-tight text-ink lg:text-5xl">
              {heading}
            </h2>
          )}
          {intro && <p className="mt-5 max-w-md text-charcoal/75">{intro}</p>}
        </div>

        <div className="lg:col-span-8">
          <ul className="divide-y divide-rule border-y border-rule">
            {faqs.map((f, i) => (
              <li key={f.q} className="py-7" itemScope itemType="https://schema.org/Question">
                <h3
                  className="font-display text-xl leading-snug text-ink lg:text-2xl"
                  itemProp="name"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-umber/70">
                    Q{String(i + 1).padStart(2, "0")} ·{" "}
                  </span>
                  {f.q}
                </h3>
                <div
                  itemProp="acceptedAnswer"
                  itemScope
                  itemType="https://schema.org/Answer"
                >
                  {/* Short direct answer — first sentence is the voice-search snippet. */}
                  <p
                    className="mt-3 max-w-3xl text-pretty text-base leading-relaxed text-charcoal/85"
                    itemProp="text"
                  >
                    {f.a}
                  </p>
                  {f.more && f.more.length > 0 && (
                    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-umber">
                      <span aria-hidden className="text-amber-glow">→ More:</span>
                      {f.more.map((m) => {
                        const cls =
                          "underline decoration-rule underline-offset-4 hover:decoration-amber-glow hover:text-ink";
                        if (m.to) {
                          return (
                            <Link
                              key={m.label}
                              to={m.to as never}
                              params={m.params as never}
                              className={cls}
                            >
                              {m.label}
                            </Link>
                          );
                        }
                        return (
                          <a key={m.label} href={m.href} className={cls}>
                            {m.label}
                          </a>
                        );
                      })}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
