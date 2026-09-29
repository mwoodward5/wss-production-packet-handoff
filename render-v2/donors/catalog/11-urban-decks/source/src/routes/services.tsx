import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Phone } from "lucide-react";
import { SITE } from "@/lib/site";
import { pageHead } from "@/lib/seo";
const projectTimber = CLIENT.hero.poster;

export const Route = createFileRoute("/services")({
  head: () =>
    pageHead({
      title: "Services · " + SITE.name,
      description: CLIENT.content.serviceIntro,
      path: "/services",
    }),
  component: ServicesPage,
});

function ServicesPage() {
  return (
    <>
      <PageHero
        eyebrow="Services"
        title={<>Our services</>}
        intro={CLIENT.content.serviceIntro}
        image={projectTimber}
      />
      <section className="section bg-background">
        <div className="mx-auto max-w-7xl px-5 md:px-8 grid gap-6 md:grid-cols-2">
          {SITE.services.map((svc, i) => (
            <article
              key={svc.slug}
              className="group relative flex flex-col rounded-2xl border border-border bg-card p-7 md:p-9"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-display text-cedar text-sm">0{i + 1}</span>
                <span className="text-[10px] uppercase tracking-[0.22em] text-ink/50">Service</span>
              </div>
              <h2 className="mt-5 font-display text-3xl text-ink leading-tight">{svc.title}</h2>
              <p className="mt-3 text-ink/70 leading-relaxed">{svc.summary}</p>
              <ul className="mt-6 grid gap-2 text-sm text-ink/85">
                {svc.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-cedar mt-0.5 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/services/$slug" params={{ slug: svc.slug }} className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-cream">
                  Learn more <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/contact" className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink">
                  Contact
                </Link>
                <a href={SITE.phoneHref} className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink">
                  <Phone className="h-3.5 w-3.5" /> {SITE.phone}
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <ClosingBand />
    </>
  );
}

export function PageHero({
  eyebrow,
  title,
  intro,
  image,
}: {
  eyebrow: string;
  title: React.ReactNode;
  intro: string;
  image: string;
}) {
  return (
    <section className="relative isolate bg-ink text-cream pt-32 pb-24 md:pt-44 md:pb-32 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <img src={image} alt="" className="h-full w-full object-cover img-cinematic opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink via-ink/85 to-ink" />
      </div>
      <div className="mx-auto max-w-7xl px-5 md:px-8 grid gap-10 md:grid-cols-12 items-end">
        <div className="md:col-span-8">
          <p className="eyebrow text-cedar">{eyebrow}</p>
          <h1 className="mt-4 font-display text-5xl md:text-7xl leading-[0.98] tracking-tight">
            {title}
          </h1>
        </div>
        <div className="md:col-span-4 md:pb-3">
          <p className="text-cream/75 leading-relaxed">{intro}</p>
        </div>
      </div>
    </section>
  );
}

export function ClosingBand() {
  return (
    <section className="bg-cream border-t border-border">
      <div className="mx-auto max-w-7xl px-5 md:px-8 py-16 md:py-20 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div>
          <h2 className="font-display text-3xl md:text-4xl text-ink leading-tight">
            {CLIENT.content.ctaHeadline || "Contact"}
          </h2>
          <p className="mt-2 text-ink/70">{CLIENT.content.ctaBody}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/contact" className="inline-flex items-center gap-2 rounded-full bg-cedar px-6 py-3 text-sm font-semibold text-cream btn-magnetic shadow-cedar">
            Start my project <ArrowRight className="h-4 w-4" />
          </Link>
          <a href={SITE.phoneHref} className="inline-flex items-center gap-2 rounded-full border border-ink/20 px-6 py-3 text-sm font-medium text-ink">
            <Phone className="h-4 w-4" /> {SITE.phone}
          </a>
        </div>
      </div>
    </section>
  );
}
