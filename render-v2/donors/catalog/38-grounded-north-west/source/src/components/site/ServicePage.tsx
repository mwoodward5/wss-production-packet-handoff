import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, ArrowRight } from "lucide-react";
import { Seo, Breadcrumbs, localBusinessSchema } from "@/components/site/Seo";
import { PageHero } from "@/components/site/PageHero";
import { ContactClose } from "@/components/site/ContactClose";
import { useClient } from "@/lib/wss";

interface ServicePageProps {
  seoTitle: string;
  seoDesc: string;
  path: string;
  eyebrow: string;
  title: ReactNode;
  intro: string;
  image?: string;
  imageAlt: string;
  bullets: { title: string; body: string }[];
  bodyLead: string;
  body: ReactNode;
  related: { label: string; href: string }[];
  serviceName: string;
}

export const ServicePage = (p: ServicePageProps) => {
  const c=useClient();
  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: p.serviceName,
    provider: { "@type": "ElectricalContractor", name: c.identity.businessName, telephone: c.identity.phoneTel.slice(4) },
    areaServed: c.trust.areas,
    url: new URL(p.path,c.identity.website).href,
  };
  return (
    <>
      <Seo title={p.seoTitle} description={p.seoDesc} path={p.path} schema={[localBusinessSchema, serviceSchema]} />
      <PageHero eyebrow={p.eyebrow} title={p.title} intro={p.intro} image={p.image} imageAlt={p.imageAlt} />
      <div className="container pt-6">
        <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: p.eyebrow, href: p.path }]} />
      </div>

      <section className="container py-16 grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-7 space-y-6">
          {p.bodyLead && <p className="text-xl leading-relaxed">{p.bodyLead}</p>}
          <div className="hairline" />
          <div className="prose prose-invert max-w-none text-muted-foreground space-y-5 leading-relaxed">{p.body}</div>
        </div>
        <aside className="lg:col-span-5 space-y-4">
          {p.bullets.length > 0 && <div className="rounded-2xl border border-border bg-gradient-card p-6">
            <div className="text-xs uppercase tracking-[0.22em] text-primary mb-4">What's included</div>
            <ul className="space-y-3">
              {p.bullets.map(b => (
                <li key={b.title} className="flex gap-3">
                  <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">{b.title}</div>
                    <div className="text-sm text-muted-foreground">{b.body}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>}
          {p.related.length > 0 && <div className="rounded-2xl border border-border bg-background/40 p-6">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground mb-3">Related services</div>
            <ul className="space-y-2">
              {p.related.map(r => (
                <li key={r.href}>
                  <Link to={r.href} className="inline-flex items-center gap-2 text-sm hover:text-primary">
                    <ArrowRight className="w-3.5 h-3.5" /> {r.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>}
        </aside>
      </section>

      <ContactClose heading="Let's plan your project." />
    </>
  );
};
