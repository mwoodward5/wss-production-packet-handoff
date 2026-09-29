import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Camera, CheckCircle2, HardHat, Home, Hammer, Frame, PaintRoller, Layers, SquareStack, Grid3x3, Wrench, Building2 } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { CallToAction } from "@/components/site/CallToAction";
import { PremiumHero } from "@/components/site/PremiumHero";
import { business, services } from "@/lib/business";
import { localBusinessSchema, orgSchema, websiteSchema, faqSchema, breadcrumb } from "@/lib/schema";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { featuredProjects } from "@/lib/projects";
import { client, pageCopy, processSteps } from "@/lib/bridge";

const iconMap: Record<string, any> = { HardHat, Home, Hammer, Frame, PaintRoller, Layers, SquareStack, Grid3x3, Wrench, Building2 };

const faqs = client.content.faqs;

const Index = () => (
  <Layout>
    <SEO
      title={`${business.name} | ${business.city}, ${business.state}`}
      description={client.hero.support}
      path="/"
      imageAlt={business.name}
      schema={[orgSchema, websiteSchema, localBusinessSchema, ...(faqs.length ? [faqSchema(faqs)] : []), breadcrumb([{name:"Home",path:"/"}])]}
    />

    <PremiumHero />

    {/* Editorial intro + service marquee */}
    <section className="py-20 md:py-28 border-b">
      <div className="container-wide grid lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-3">
          <p className="mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">/ 02 — Approach</p>
        </div>
        <div className="lg:col-span-9">
          <p className="font-display text-2xl md:text-4xl leading-[1.25] tracking-tight text-foreground/90">
            <span className="display-italic text-accent">{client.content.about}</span>
          </p>
        </div>
      </div>

      <div className="mt-20 overflow-hidden border-y py-6">
        <div className="marquee-track flex gap-16 whitespace-nowrap font-display text-3xl md:text-5xl text-foreground/80">
          {[...services, ...services].map((s, i) => (
            <span key={i} className="flex items-center gap-16">
              {s.name}
              <span className="text-accent">✦</span>
            </span>
          ))}
        </div>
      </div>
    </section>

    {/* Editorial services index */}
    <section className="section">
      <div className="container-wide grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4 lg:sticky lg:top-28 self-start">
          <p className="mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">/ 03 — Services</p>
          <h2 className="mt-5 font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">
            Explore our <span className="display-italic text-accent">services.</span>
          </h2>
          <p className="mt-5 text-muted-foreground leading-relaxed">
            {client.content.serviceIntro}
          </p>
          <Button asChild variant="outline" className="mt-8 rounded-full">
            <Link to="/services">All services <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>

        <ol className="lg:col-span-8 divide-y border-t border-b">
          {services.map((s, i) => {
            const Icon = iconMap[s.icon] || HardHat;
            return (
              <li key={s.slug}>
                <Link to={`/services/${s.slug}`}
                  className="group relative grid grid-cols-[auto_1fr_auto] items-center gap-6 py-6 md:py-7 transition-all hover:bg-secondary/60 -mx-4 px-4 rounded-xl shine-sweep">
                  <span className="mono text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-foreground/15 group-hover:border-accent group-hover:text-accent group-hover:shadow-glow-brass transition-all">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-xl md:text-2xl truncate group-hover:translate-x-1 transition-transform">{s.name}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5 truncate">{s.short}</p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-5 w-5 text-foreground/40 group-hover:text-accent group-hover:rotate-0 -rotate-45 transition-all" />
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>

    {/* Client gallery */}
    {featuredProjects.length > 0 && <section className="section border-t">
      <div className="container-wide">
        <div className="flex flex-wrap items-end justify-between gap-6 mb-12">
          <div className="max-w-2xl">
            <p className="mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">/ 04 — Recent Work</p>
            <h2 className="mt-5 font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">
              A closer <span className="display-italic text-accent">look.</span>
            </h2>
          </div>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/projects">View full gallery <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {featuredProjects.map((p, i) => (
            <Link
              key={p.src}
              to="/projects"
              className={`group relative overflow-hidden rounded-xl border bg-card shadow-card hover:shadow-elegant transition-all duration-500 ${
                i === 0 ? "col-span-2 md:col-span-2 lg:col-span-3 row-span-2 aspect-[4/3] lg:aspect-auto" : "aspect-square"
              }`}
            >
              <img
                src={p.src}
                alt={p.alt}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-white font-display text-sm leading-tight">{p.caption}</p>
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-8 mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-2">
          <Camera className="h-3.5 w-3.5 text-accent" /> {business.name} gallery.
        </p>
      </div>
    </section>}

    {/* Editorial process */}
    {processSteps.length > 0 && <section className="section bg-gradient-ink text-primary-foreground relative overflow-hidden grain">
      <div className="absolute inset-0 blueprint opacity-25" aria-hidden />
      <div className="absolute inset-0 bg-gradient-glow opacity-50" aria-hidden />
      <div className="container-wide relative">
        <div className="grid lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-7">
            <p className="mono text-[11px] uppercase tracking-[0.24em] text-accent">/ 04 — The Process</p>
            <h2 className="mt-5 font-display font-light text-4xl md:text-6xl leading-[1.02] tracking-tight">
              Our <span className="display-italic text-accent">process.</span>
            </h2>
          </div>
          <p className="lg:col-span-5 text-primary-foreground/70 text-lg leading-relaxed">
            {pageCopy("process")}
          </p>
        </div>

        <ol className="mt-20 grid md:grid-cols-2 lg:grid-cols-4 gap-px bg-primary-foreground/10 border border-primary-foreground/10 rounded-3xl overflow-hidden">
          {processSteps.map(({ title: t, body: d }, i) => (
            <li key={t} className="bg-[hsl(var(--ink))] p-8 md:p-10 relative">
              <span className="mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-6 font-display text-2xl">{t}</h3>
              <p className="mt-3 text-sm text-primary-foreground/70 leading-relaxed">{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>}

    {/* Client values and supplied trust */}
    <section className="section border-t">
      <div className="container-wide grid lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-5">
          <p className="mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">/ 05 - Why {business.name}</p>
          <h2 className="mt-5 font-display text-4xl md:text-6xl leading-[1.02] tracking-tight">
            <span className="display-italic text-accent">{client.content.whyHeadline || business.name}</span>
          </h2>
          <p className="mt-6 text-muted-foreground text-lg leading-relaxed">
            {client.content.about}
          </p>
        </div>

        <dl className="lg:col-span-7 grid sm:grid-cols-2 gap-x-10 gap-y-8">
          {client.content.values.map(({ title: t, body: d }) => (
            <div key={t}>
              <dt className="font-display text-xl flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {t}
              </dt>
              <dd className="mt-2 text-muted-foreground text-sm leading-relaxed pl-5">{d}</dd>
            </div>
          ))}
          {client.trust.badges.map((badge) => (
            <div key={badge.label}>
              <dt className="font-display text-xl flex items-center gap-3"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{badge.label}</dt>
              {(badge.sublabel || badge.meta) && <dd className="mt-2 text-muted-foreground text-sm leading-relaxed pl-5">{[badge.sublabel, badge.meta].filter(Boolean).join(" · ")}</dd>}
            </div>
          ))}
          {client.trust.aggregate?.rating != null && client.trust.aggregate?.count != null && client.trust.aggregate.sourceUrl && (
            <div>
              <dt className="font-display text-xl">{client.trust.aggregate.rating} / 5</dt>
              <dd className="mt-2 text-muted-foreground text-sm"><a href={client.trust.aggregate.sourceUrl} target="_blank" rel="noreferrer">{client.trust.aggregate.count} reviews</a></dd>
            </div>
          )}
        </dl>
      </div>
    </section>

    {/* Service area */}
    <section className="section bg-secondary/40 border-t">
      <div className="container-wide grid lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7">
          <p className="mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">/ 06 — Service Area</p>
          <h2 className="mt-5 font-display text-4xl md:text-6xl leading-[1.02] tracking-tight">
            {business.region ? "Serving " : "Based in "}<span className="display-italic text-accent">{business.region || `${business.city}, ${business.state}`}.</span>
          </h2>
          <p className="mt-6 text-muted-foreground text-lg leading-relaxed max-w-xl">
            {pageCopy("service-area") || `Contact ${business.name} to discuss your project location.`}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="rounded-full bg-foreground text-background hover:bg-accent hover:text-accent-foreground">
              <Link to="/service-area">View Service Area <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/contact">Request an Estimate</Link>
            </Button>
            <a href={business.phoneHref} className="inline-flex items-center gap-2 h-10 px-5 rounded-full border border-foreground/20 hover:border-accent hover:text-accent transition mono text-sm">
              {business.phone}
            </a>
          </div>
        </div>

        <ul className="lg:col-span-5 grid grid-cols-1 gap-3 text-sm">
          {services.slice(0, 4).map(({ name: t, short: d }) => (
            <li key={t} className="flex gap-3 rounded-xl border bg-card p-4 shadow-card">
              <CheckCircle2 className="h-5 w-5 text-accent shrink-0 mt-0.5" />
              <div>
                <p className="font-display text-base">{t}</p>
                <p className="text-muted-foreground text-xs mt-0.5">{d}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>

    {/* FAQ */}
    {faqs.length > 0 && <section className="section border-t">
      <div className="container-wide grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4">
          <p className="mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">/ 07 — Answers</p>
          <h2 className="mt-5 font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">
            Questions, <span className="display-italic text-accent">answered.</span>
          </h2>
          <p className="mt-5 text-muted-foreground">Don't see yours? Call <a href={business.phoneHref} className="text-accent link-underline">{business.phone}</a> {business.email && <>or email <a href={business.emailHref} className="text-accent link-underline break-all">{business.email}</a></>}.</p>
        </div>
        <div className="lg:col-span-8">
          <Accordion type="single" collapsible>
            {faqs.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border-b border-foreground/15">
                <AccordionTrigger className="text-left font-display text-xl md:text-2xl hover:text-accent py-6">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed text-base pb-6">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>}

    <CallToAction />
  </Layout>
);

export default Index;
