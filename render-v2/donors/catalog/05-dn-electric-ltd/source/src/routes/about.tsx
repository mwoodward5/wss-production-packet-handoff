import { routeHead } from "@/lib/wss-route-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BUSINESS, FAQS } from "@/lib/business";
import { PageHeader } from "@/components/site/PageHeader";
import { CtaBanner } from "@/components/site/CtaBanner";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Check, Phone, BadgeCheck } from "lucide-react";
import { getClient, clientPhoto } from "@/lib/wss-client";
import { pageCopy } from "@/lib/wss-location";
import { RichText } from "@/components/site/RichText";
const client = getClient();


export const Route = createFileRoute("/about")({
  head: () => routeHead("About"),
  component: About,
});

function About() {
  return (
    <>
      <PageHeader
        eyebrow="Our Story"
        title={client.content.whyHeadline || `About ${BUSINESS.name}`}
        intro={client.content.about}
        image={clientPhoto("about")}
      />

      <Breadcrumbs
        items={[
          { label: "Home", to: "/" },
          { label: "About" },
        ]}
      />

      <section className="mx-auto grid max-w-7xl gap-16 px-5 py-16 md:grid-cols-12 md:px-8">
        <div className="md:col-span-7 space-y-6 text-base leading-relaxed text-foreground/85">
          <RichText text={pageCopy("about") || client.content.about} />
          <ul className="grid gap-3 pt-4">{client.content.values.map(v => <li key={v.title} className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 shrink-0 text-[var(--gold)]" /><span>{v.title}: {v.body}</span></li>)}</ul>
        </div>

        {client.trust.badges.length > 0 && <aside className="md:col-span-5">
          <div className="sticky top-28 space-y-5">{client.trust.badges.map(b => <div key={b.label} className="rounded-2xl border border-border bg-card p-7 shadow-[var(--shadow-couture)]">
            <BadgeCheck className="h-5 w-5 text-[var(--gold)]" /><h3 className="display mt-2 text-3xl">{b.label}</h3><p className="mt-2 text-sm text-muted-foreground">{b.sublabel}</p>{b.meta && <p>{b.meta}</p>}
          </div>)}</div>
        </aside>}
      </section>

      {FAQS.length > 0 && <section className="bg-secondary">
        <div className="mx-auto max-w-5xl px-5 py-16 md:px-8">
          <div className="eyebrow">Common Questions</div>
          <h2 className="display mt-2 text-3xl md:text-4xl">Common questions</h2>
          <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-background">
            {FAQS.slice(0, 4).map((f) => (
              <details key={f.q} className="group p-6 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer items-start justify-between gap-4 font-semibold">
                  {f.q}
                  <span className="ml-4 text-[var(--gold)] transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-6 text-sm">
            <Link to="/contact" className="font-semibold underline-offset-4 hover:underline">
              Have a different question? Reach out →
            </Link>
          </div>
        </div>
      </section>

      }
      <CtaBanner />
    </>
  );
}
