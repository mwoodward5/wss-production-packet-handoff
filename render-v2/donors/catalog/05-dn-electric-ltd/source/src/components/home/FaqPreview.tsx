import { Link } from "@tanstack/react-router";
import { FAQS } from "@/lib/business";

export function FaqPreview() {
  if (!FAQS.length) return null;
  return (
    <section className="mx-auto max-w-5xl px-5 py-20 md:px-8 md:py-28">
      <div className="eyebrow">Questions and answers</div>
      <h2 className="display mt-3 text-4xl md:text-5xl">
        Answers about our services.
      </h2>

      <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-card">
        {FAQS.map((f) => (
          <details key={f.q} className="group p-6 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-start justify-between gap-4 text-base font-semibold">
              {f.q}
              <span className="ml-4 text-[var(--gold)] text-xl leading-none transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>

      <div className="mt-6 text-sm">
        <Link to="/contact" className="font-semibold underline-offset-4 hover:underline">
          Don't see your question? Ask us directly →
        </Link>
      </div>
    </section>
  );
}
