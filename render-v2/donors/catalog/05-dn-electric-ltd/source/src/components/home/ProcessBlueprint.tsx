import { getClient } from '@/lib/wss-client';
const client = getClient();
const STEPS = client.content.values.map((value, i) => ({ n: String(i + 1).padStart(2, '0'), t: value.title, d: value.body }));

export function ProcessBlueprint() {
  if (!STEPS.length) return null;
  return (
    <section className="relative bg-background">
      <div className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div className="max-w-2xl">
          <div className="eyebrow">About our work</div>
          <h2 className="display mt-3 text-4xl md:text-5xl">
            {client.content.whyHeadline || client.identity.businessName}
          </h2>
          <p className="mt-4 text-foreground/75">
            {client.content.serviceIntro}
          </p>
        </div>

        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-background p-6 md:p-8">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-[var(--gold)]">{s.n}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <h3 className="mt-4 display text-2xl">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
