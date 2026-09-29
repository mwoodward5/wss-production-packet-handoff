import {faqs} from "@/lib/wss";
/**
 * HeroFAQMicro
 * Compact, AEO/voice-search–friendly FAQ strip placed directly under the hero.
 * Q/A pairs target primary service keywords for Genoa, OH and surrounding towns.
 * All answers are truth-checked against verified business data (see src/lib/business.ts).
 */
import { Link } from "@/lib/navigation";

type QA = { q: string; a: string; href?: string; cta?: string };

const items = faqs.slice(0, 2).map(f=>({...f,href:"/faq",cta:"FAQ"}));

export function HeroFAQMicro() {
 if (!items.length) return null;
  return (
    <section
      aria-labelledby="hero-faq-heading"
      className="border-b border-ink/10 bg-cream"
    >
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10 lg:py-14">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-umber">
              Quick answers
            </p>
            <h2
              id="hero-faq-heading"
              className="mt-2 font-display text-2xl text-ink lg:text-3xl"
            >
              People ask us this first.
            </h2>
          </div>
          <Link
            to="/faq"
            className="hidden font-mono text-[11px] uppercase tracking-[0.22em] text-ink underline-offset-4 hover:underline lg:inline-block"
          >
            See all FAQs →
          </Link>
        </div>

        <dl className="mt-6 grid gap-px overflow-hidden rounded-sm bg-ink/10 lg:grid-cols-2">
          {items.map((item) => (
            <div key={item.q} className="bg-cream p-5 lg:p-6">
              <dt className="font-display text-[15px] leading-snug text-ink lg:text-base">
                {item.q}
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-charcoal/80">
                {item.a}
                {item.href && item.cta && (
                  <>
                    {" "}
                    <Link
                      to={item.href}
                      className="font-mono text-[11px] uppercase tracking-[0.18em] text-umber underline-offset-4 hover:underline"
                    >
                      {item.cta} →
                    </Link>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <Link
          to="/faq"
          className="mt-6 inline-block font-mono text-[11px] uppercase tracking-[0.22em] text-ink underline-offset-4 hover:underline lg:hidden"
        >
          See all FAQs →
        </Link>
      </div>
    </section>
  );
}
