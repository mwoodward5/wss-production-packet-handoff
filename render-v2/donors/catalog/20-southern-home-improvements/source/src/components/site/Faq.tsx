import { useSite } from "@/lib/wss";
export function Faq() {
  const {client, area, hours, emailHref, googleMaps, appleMaps, plan} = useSite();
  const faqs=client.content.faqs;
  if(!faqs.length) return null;
  return (
    <section className="bg-cream py-24">
      <div className="mx-auto max-w-4xl px-5 lg:px-8">
        <p className="eyebrow">Common questions</p>
        <h2 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl lg:text-5xl">
          Your questions, answered.
        </h2>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {faqs.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6">
                <span className="font-display text-lg leading-snug text-ink">{f.q}</span>
                <span className="mt-1 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full border border-ink/20 text-ink transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-[15px] leading-[1.65] text-ink-soft">{f.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper p-5">
          <div>
            <div className="font-display text-lg text-ink">Different question?</div>
            <p className="text-sm text-ink-soft">Contact us with your question.</p>
          </div>
          <a
            href={emailHref || client.identity.phoneTel}
            className="inline-flex items-center gap-2 rounded-full border border-ink/20 px-4 py-2.5 text-sm font-semibold text-ink hover:border-ink/50"
          >
            Ask a question →
          </a>
        </div>
      </div>
    </section>
  );
}
