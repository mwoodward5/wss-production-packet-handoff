import { useSite } from "@/lib/wss";
export function PrivacyPage() {
 const {client,emailHref}=useSite();
  return (
    <main className="bg-cream">
      <section className="mx-auto max-w-3xl px-5 py-20 lg:px-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
          Privacy & Trust
        </div>
        <h1 className="mt-3 font-display text-4xl text-ink sm:text-5xl">
          How we handle your information
        </h1>
        <p className="mt-4 text-sm text-ink-soft">
          Contact {client.identity.businessName} for its privacy policy.
        </p>

        <div className="mt-12 space-y-10 text-ink">
          {emailHref && <Section title="Project brief">
            <p>The project planner prepares a draft in your email app. You review and send the draft yourself.</p>
          </Section>}
          <Section title="Contact us about your data">
            <p>
              For privacy questions, contact{" "}
              <a
                href={emailHref || client.identity.phoneTel}
                className="font-medium text-clay hover:underline"
              >
                {client.identity.email || client.identity.phoneDisplay}
              </a>{" "}
              or call{" "}
              <a href={client.identity.phoneTel} className="font-medium text-clay hover:underline">
                {client.identity.phoneDisplay}
              </a>
              .
            </p>
          </Section>
        </div>

        <div className="mt-16 border-t border-line pt-6 text-sm">
          <a href="/" className="text-clay hover:underline">
            ← Back home
          </a>
        </div>
      </section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-xl text-ink">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-ink-soft">{children}</div>
    </div>
  );
}
