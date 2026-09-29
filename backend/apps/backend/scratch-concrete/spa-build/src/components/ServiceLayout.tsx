import { Link } from "@tanstack/react-router";
import { ChevronRight, CheckCircle2 } from "lucide-react";
import { CallButton } from "./CallButton";
import { TrustChips } from "./TrustChips";
import { InShortBlock } from "./InShortBlock";
import { SectionHeading } from "./SectionHeading";
import { ProcessSteps } from "./ProcessSteps";
import { CityChips } from "./CityChips";
import { FAQ, type FaqItem } from "./FAQ";
import { ContactForm } from "./ContactForm";
import { RelatedServices } from "./RelatedServices";
import { Reveal } from "./Reveal";
import { useLiveAreas, slugify } from "@/lib/wssc";

export type ServicePageProps = {
  slug: string;
  title: string;
  heroHeadline: string;
  heroSub: string;
  heroImage: string;
  heroImageAlt: string;
  inShort: string;
  whyBest: string[];
  affordable: string;
  cost: { range: string; factors: string[] };
  hireChecklist: string[];
  problems: string[];
  faqs: FaqItem[];
  highIntentAnswers: { q: string; a: string }[];
  /** New rich content blocks (optional) */
  narrative?: string[];
  benefits?: { title: string; body: string }[];
  materials?: { label: string; value: string }[];
  projectTypes?: string[];
};

export function ServiceLayout(p: ServicePageProps) {
  const areas = useLiveAreas();
  const topAreas = areas.slice(0, 6);
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div className="absolute inset-0 opacity-40">
          <img src={p.heroImage} alt={p.heroImageAlt} className="h-full w-full object-cover" loading="eager" />
          <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/70 to-primary/30" />
          <div className="absolute inset-0 bg-mesh-animated opacity-50" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-28">
          <nav className="mb-6 flex items-center gap-2 text-sm text-primary-foreground/70" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-primary-foreground">Home</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-primary-foreground">{p.title}</span>
          </nav>
          <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-tight md:text-5xl lg:text-6xl">
            {p.heroHeadline}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-primary-foreground/85">{p.heroSub}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <CallButton variant="gold" location={`hero-${p.slug}`} className="animate-glow" />
            <Link to="/contact" className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/15">
              Get a Quote
            </Link>
          </div>
          <div className="mt-7"><TrustChips tone="dark" /></div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-14 lg:px-6">
        <InShortBlock>{p.inShort}</InShortBlock>

        {/* NARRATIVE BODY (rich content) */}
        {p.narrative && p.narrative.length > 0 && (
          <Reveal>
            <h2 className="mt-12 font-display text-3xl font-semibold md:text-4xl">
              About our <span className="gold-underline">{p.title.toLowerCase()}</span> work
            </h2>
            <div className="mt-5 space-y-5 text-lg leading-relaxed text-foreground">
              {p.narrative.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </Reveal>
        )}

        <h2 className="mt-12 font-display text-3xl font-semibold md:text-4xl">
          What good <span className="gold-underline">{p.title.toLowerCase()}</span> looks like
        </h2>
        <ul className="mt-5 space-y-3">
          {p.whyBest.map((b, i) => (
            <li key={i} className="flex gap-3 text-base text-foreground">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {/* BENEFITS GRID */}
        {p.benefits && p.benefits.length > 0 && (
          <>
            <h2 className="mt-12 font-display text-3xl font-semibold md:text-4xl">
              What you get when you hire us
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {p.benefits.map((b, i) => (
                <div key={i} className="flex gap-3 rounded-2xl border border-border bg-card p-5 shadow-card">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                  <div>
                    <div className="font-display text-base font-semibold">{b.title}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{b.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* MATERIALS & FINISHES */}
        {p.materials && p.materials.length > 0 && (
          <>
            <h2 className="mt-12 font-display text-3xl font-semibold md:text-4xl">
              Materials, finishes &amp; specs we work with
            </h2>
            <p className="mt-3 text-muted-foreground">
              Transparent about what goes into the work — and it's spelled out on the quote.
            </p>
            <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              <dl className="divide-y divide-border">
                {p.materials.map((m) => (
                  <div key={m.label} className="grid grid-cols-1 gap-1 px-5 py-4 md:grid-cols-3 md:gap-4">
                    <dt className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</dt>
                    <dd className="text-sm text-foreground md:col-span-2">{m.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        )}

        {/* PROJECT TYPES */}
        {p.projectTypes && p.projectTypes.length > 0 && (
          <>
            <h2 className="mt-12 font-display text-3xl font-semibold md:text-4xl">
              Project types we serve
            </h2>
            <div className="mt-5 flex flex-wrap gap-2">
              {p.projectTypes.map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
                  <CheckCircle2 className="h-3 w-3 text-gold" />
                  {t}
                </span>
              ))}
            </div>
          </>
        )}

        <h2 className="mt-12 font-display text-3xl font-semibold md:text-4xl">Fair, transparent {p.title.toLowerCase()} pricing</h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{p.affordable}</p>

        <h2 className="mt-12 font-display text-3xl font-semibold md:text-4xl">How much does {p.title.toLowerCase()} cost?</h2>
        <p className="mt-3 text-lg text-muted-foreground"><strong className="text-foreground">Quoted per project.</strong> {p.cost.range}</p>
        <p className="mt-2 text-sm text-muted-foreground">Final price depends on:</p>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {p.cost.factors.map((f, i) => (
            <li key={i} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">{f}</li>
          ))}
        </ul>

        <h2 className="mt-12 font-display text-3xl font-semibold md:text-4xl">What to look for when hiring</h2>
        <ul className="mt-5 space-y-3">
          {p.hireChecklist.map((b, i) => (
            <li key={i} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" /><span>{b}</span></li>
          ))}
        </ul>

        <h2 className="mt-12 font-display text-3xl font-semibold md:text-4xl">Common problems we solve</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {p.problems.map((b, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 text-sm shadow-card">{b}</div>
          ))}
        </div>

        {/* High-intent answers */}
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {p.highIntentAnswers.map((a, i) => (
            <div key={i} data-speakable className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h3 className="font-display text-base font-semibold">{a.q}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{a.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Process */}
      <section className="bg-secondary py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionHeading eyebrow="Our Process" title="A clear 5-step path from first call to clean job site." />
          <div className="mt-10"><ProcessSteps /></div>
          <div className="mt-10 flex justify-center"><CallButton variant="gold" location={`process-${p.slug}`} /></div>
        </div>
      </section>

      {/* Areas — anchors into the service-area page */}
      <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
        <SectionHeading eyebrow="Areas We Serve" title={`${p.title} in {{CITY}} and the surrounding area`} subtitle="Coverage is confirmed with your address at quote time." />
        <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {topAreas.map((name) => (
            <Link
              key={name}
              to="/service-area"
              hash={slugify(name)}
              className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-gold hover:shadow-elegant"
            >
              <div>
                <div className="font-display text-base font-semibold">{p.title} in {name}</div>
                <div className="text-xs text-muted-foreground">See coverage details</div>
              </div>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
        <div className="mt-6"><CityChips /></div>
      </section>

      {/* FAQ */}
      <section className="bg-secondary py-16">
        <div className="mx-auto max-w-4xl px-4 lg:px-6">
          <SectionHeading eyebrow="FAQ" title="Answers to common questions" />
          <div className="mt-8"><FAQ items={p.faqs} /></div>
        </div>
      </section>

      {/* Related services */}
      <RelatedServices exclude={p.slug} />

      {/* Final CTA + form — the in-page lead route (id="estimate") */}
      <section id="estimate" className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-semibold md:text-4xl">Ready for a no-pressure quote?</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Send a few details and you'll get a written response with next steps.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <CallButton variant="gold" location={`final-${p.slug}`} />
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold">
                Full contact options
              </Link>
            </div>
          </div>
          <div><ContactForm compact /></div>
        </div>
      </section>
    </>
  );
}
