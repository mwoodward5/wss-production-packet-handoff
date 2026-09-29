import { clientData, sitePlan } from '@/wss-bridge';

// Certified Markdown is rendered as text, never injected HTML. Paragraph and
// heading structure is retained without accepting scripts or untrusted links.
export function ClientCopy({ text }: { text: string }) {
  return <div className="space-y-5 text-base leading-relaxed text-muted-foreground">{text.split(/\n\s*\n/).filter(Boolean).map((p, i) =>
    /^#{1,6}\s/.test(p) ? <h2 key={i} className="font-[Archivo] text-2xl font-bold text-cream">{p.replace(/^#{1,6}\s+/, '')}</h2> : <p key={i} className="whitespace-pre-line">{p}</p>
  )}</div>;
}

export function HoursText() {
  const hours = clientData.trust.hours;
  if (!hours || typeof hours !== 'object') return null;
  if ('text' in hours && typeof hours.text === 'string') return <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{hours.text}</p>;
  return null; // Arbitrary hours objects have no typed schedule/timezone contract.
}

export function ContactBand() {
  const c = clientData;
  return <section id="contact" className="relative px-5 py-20 sm:px-8 bg-[color-mix(in_oklab,var(--coral)_18%,transparent)]">
    <div className="mx-auto w-full max-w-[1180px]">
      <h2 className="font-[Archivo] text-3xl font-extrabold text-cream sm:text-5xl">{c.content.ctaHeadline || 'Contact'}</h2>
      {c.content.ctaBody && <p className="mt-5 max-w-2xl text-muted-foreground">{c.content.ctaBody}</p>}
      {sitePlan?.content?.['contact'] && <ClientCopy text={sitePlan.content['contact']} />}
      <div className="mt-8 flex flex-wrap gap-4">
        <a className="rounded-full bg-coral px-7 py-3.5 font-semibold text-accent-foreground" href={c.identity.phoneTel}>Call {c.identity.phoneDisplay}</a>
        {c.identity.email && <a className="rounded-full border border-border px-7 py-3.5" href={`mailto:${c.identity.email}`}>{c.identity.email}</a>}
        {c.trust.bookingUrl && <a className="rounded-full border border-border px-7 py-3.5" href={c.trust.bookingUrl}>Book online</a>}
      </div>
    </div>
  </section>;
}
