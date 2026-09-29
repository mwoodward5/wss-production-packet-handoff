import { useParams, Link, Navigate } from "react-router-dom";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { SEO } from "@/components/SEO";
import { CallToAction } from "@/components/site/CallToAction";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { services, business } from "@/lib/business";
import { breadcrumb, faqSchema, serviceSchema } from "@/lib/schema";
import { projects } from "@/lib/projects";
import { serviceDetails as details } from "@/lib/bridge";

const ServiceDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const service = services.find(s => s.slug === slug);
  const detail = slug ? details[slug] : undefined;

  if (!service || !detail) return <Navigate to="/services" replace />;

  const related = services.filter(s => s.slug !== slug).slice(0, 4);
  const title = `${service.name} in ${business.city}, ${business.state} | ${business.name}`;
  const desc = `${service.name} from ${business.name} in ${business.city}, ${business.state}. ${service.short} Call ${business.phone}.`;

  return (
    <Layout>
      <SEO
        title={title}
        description={desc}
        path={`/services/${slug}`}
        schema={[
          serviceSchema(service.name, detail.intro, service.slug),
          ...(detail.faqs.length ? [faqSchema(detail.faqs)] : []),
          breadcrumb([{name:"Home",path:"/"},{name:"Services",path:"/services"},{name:service.name,path:`/services/${slug}`}]),
        ]}
      />

      <section className="relative isolate overflow-hidden bg-gradient-ink text-primary-foreground">
        <div className="absolute inset-0 -z-10 blueprint opacity-30" aria-hidden />
        <div className="absolute inset-x-0 top-0 h-[500px] bg-gradient-radial-brass opacity-50 -z-10" aria-hidden />
        <div className="container-tight pt-24 pb-20">
          <nav className="text-sm text-primary-foreground/70 mb-6" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-accent">Home</Link> <span className="mx-2">/</span>
            <Link to="/services" className="hover:text-accent">Services</Link> <span className="mx-2">/</span>
            <span className="text-primary-foreground">{service.name}</span>
          </nav>
          <p className="eyebrow text-accent">{business.name}</p>
          <h1 className="mt-4 font-display text-5xl md:text-6xl max-w-3xl leading-tight">{service.name} in {business.city}, {business.state}</h1>
          <p className="mt-6 text-lg text-primary-foreground/85 max-w-2xl leading-relaxed">{detail.intro}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-brass h-12 rounded-full">
              <Link to="/contact">Request an Estimate <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <a href={business.phoneHref} className="inline-flex items-center gap-2 h-12 px-5 rounded-full border border-primary-foreground/30 hover:bg-primary-foreground/10 transition font-medium mono text-sm">
              {business.phone}
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container-tight grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <article>
            <p className="eyebrow">What's included</p>
            <h2 className="mt-3 font-display text-3xl md:text-4xl">{service.name}</h2>
            {[detail.intro].map((p, i) => (
              <p key={i} className="mt-5 text-muted-foreground text-lg leading-relaxed">{p}</p>
            ))}
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {detail.bullets.map(b => (
                <li key={b} className="flex gap-2 text-sm"><CheckCircle2 className="h-5 w-5 text-accent shrink-0 mt-0.5" />{b}</li>
              ))}
            </ul>

            {(() => {
              const photos = projects.filter(p => p.categories.includes(slug || "")).slice(0, 4);
              if (photos.length === 0) return null;
              return (
                <div className="mt-12">
                  <p className="eyebrow">{service.name} photos</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {photos.map(p => (
                      <figure key={p.src} className="overflow-hidden rounded-xl border bg-card shadow-card">
                        <img src={p.src} alt={p.alt} loading="lazy" decoding="async" className="w-full h-56 object-cover" />
                      </figure>
                    ))}
                  </div>
                </div>
              );
            })()}
          </article>

          <aside className="lg:sticky lg:top-28 h-fit space-y-5">
            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <h3 className="font-display text-xl">Discuss your project.</h3>
              <p className="mt-2 text-sm text-muted-foreground">Tell us about your project and ask about the next steps.</p>
              <Button asChild className="mt-5 w-full bg-accent text-accent-foreground hover:bg-accent/90 rounded-full">
                <Link to="/contact">Request an Estimate</Link>
              </Button>
              <p className="mt-4 text-sm text-muted-foreground">Or call <a href={business.phoneHref} className="text-foreground font-semibold">{business.phone}</a></p>
              {business.email && <p className="mt-1 text-sm text-muted-foreground">Email <a href={business.emailHref} className="text-foreground font-semibold break-all">{business.email}</a></p>}
            </div>
            <div className="rounded-2xl border bg-secondary/40 p-6">
              <h3 className="font-display text-base font-semibold">Related services</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {related.map(r => (
                  <li key={r.slug}><Link to={`/services/${r.slug}`} className="link-underline text-primary hover:text-accent">{r.name}</Link></li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>

      {detail.faqs.length > 0 && <section className="section bg-secondary/40">
        <div className="container-tight max-w-4xl">
          <p className="eyebrow">Common questions</p>
          <h2 className="mt-3 font-display text-3xl md:text-4xl">{service.name} — FAQs</h2>
          <Accordion type="single" collapsible className="mt-8">
            {detail.faqs.map((f, i) => (
              <AccordionItem key={i} value={`f-${i}`} className="border-b">
                <AccordionTrigger className="text-left font-display text-lg hover:text-accent">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed text-base">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>}

      <CallToAction title={`Plan your ${service.name.toLowerCase()} project.`} />
    </Layout>
  );
};

export default ServiceDetail;
