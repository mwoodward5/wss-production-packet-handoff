import { CLIENT, SITE } from "@/lib/site";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/10 py-8">
      <h2 className="text-lg font-semibold tracking-wide text-white uppercase">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-white/75">{children}</div>
    </section>
  );
}

export function TrustPage() {
  return (
    <main className="min-h-screen bg-[var(--ink)] text-white">
      <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Trust & Privacy</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">How we handle your information</h1>
        <p className="mt-4 text-sm text-white/70">
          {SITE.name} · Contact options and website behavior.
        </p>
        <Section title="Job ticket drafts">
          <p>The work order form prepares a draft in this browser. It does not submit your information to a server. Leaving or reloading the page clears the draft.</p>
        </Section>
        <Section title="Phone & email">
          <p>Phone links open your calling app. Email links open your email app with a draft for you to review and send.</p>
        </Section>
        <Section title="External links">
          <p>Map, review and social links open external websites. Those sites handle their own privacy settings.</p>
        </Section>
        {CLIENT.trust.badges.length > 0 && <Section title="Business information">
          {CLIENT.trust.badges.map(b => <p key={b.label}>{b.label} {b.sublabel} {b.meta}</p>)}
        </Section>}
        {CLIENT.trust.reviews.length > 0 && <Section title="Reviews">
          {CLIENT.trust.reviews.map((r, i) => <blockquote key={i}><p>{r.text}</p><cite>{r.author}</cite> · <a className="underline" href={r.sourceUrl}>Source</a></blockquote>)}
        </Section>}
        <Section title="Contact">
          <p>{SITE.name}<br />{SITE.address.city}, {SITE.address.region}<br />
            <a className="underline" href={SITE.phoneHref}>{SITE.phone}</a>
            {SITE.email && <> · <a className="underline" href={SITE.mailtoHref}>{SITE.email}</a></>}
          </p>
          {CLIENT.trust.socials.map(url => <p key={url}><a className="underline" href={url}>{new URL(url).hostname}</a></p>)}
        </Section>

        <div className="mt-10">
          <a
            href="/"
            className="inline-flex items-center rounded-md border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
          >
            ← Back home
          </a>
        </div>
      </div>
    </main>
  );
}
