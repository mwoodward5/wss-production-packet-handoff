import { FileText, Compass, Star } from 'lucide-react';
import { getClient } from '@/lib/wss-client';
const client = getClient();
const aggregate = client.trust.aggregate;
const ITEMS = [
  ...(aggregate ? [{ icon: Star, k: `${aggregate.rating} / 5`, v: `${aggregate.count} public reviews`, href: aggregate.sourceUrl }] : []),
  ...client.trust.badges.map(b => ({ icon: FileText, k: b.label, v: b.sublabel, href: '' })),
].slice(0, 4);
export function TrustStrip() {
  if (!ITEMS.length && !client.trust.reviews.length) return null;
  return <section className="border-y border-border bg-secondary">
    <div className="mx-auto grid max-w-7xl gap-x-8 gap-y-6 px-5 py-10 sm:grid-cols-2 md:grid-cols-4 md:px-8">
      {ITEMS.map(it => <div key={it.k} className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--gold)]"><it.icon className="h-5 w-5" /></div>
        <div><div className="text-sm font-semibold">{it.k}</div>
          {it.href ? <a href={it.href} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline">{it.v}</a> : <div className="text-xs text-muted-foreground">{it.v}</div>}
        </div>
      </div>)}
    </div>
    {client.trust.reviews.length > 0 && <div className="mx-auto grid max-w-7xl gap-6 px-5 pb-10 md:grid-cols-2 md:px-8">
      {client.trust.reviews.slice(0, 4).map((r, i) => <blockquote key={i} className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm leading-relaxed">{r.text}</p><cite className="mt-3 block text-xs not-italic"><a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{r.author}</a></cite>
      </blockquote>)}
    </div>}
  </section>;
}
