import { Link } from "react-router-dom";
import { ArrowRight, Compass } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { SEO } from "@/components/SEO";
import { CallToAction } from "@/components/site/CallToAction";
import { Button } from "@/components/ui/button";
import { business } from "@/lib/business";
import { breadcrumb, localBusinessSchema, orgSchema } from "@/lib/schema";
import { client, pageCopy, companyPhoto } from "@/lib/bridge";

const About = () => (
  <Layout>
    <SEO
      title={`About ${business.name} | ${business.city}, ${business.state}`}
      description={client.content.about}
      path="/about"
      schema={[orgSchema, localBusinessSchema, breadcrumb([{name:"Home",path:"/"},{name:"About",path:"/about"}])]}
    />

    <section className="bg-gradient-canvas">
      <div className="container-tight pt-20 pb-12 md:pt-28 md:pb-16">
        <p className="eyebrow"><Compass className="h-3.5 w-3.5" /> About</p>
        <h1 className="mt-3 font-display text-5xl md:text-6xl max-w-3xl leading-[1.05]">
          About {business.name}.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
          {client.content.about}
        </p>
      </div>
    </section>

    <section className="section">
      <div className="container-tight grid gap-12 lg:grid-cols-12">
        <article className="lg:col-span-8 space-y-6 text-lg leading-relaxed text-foreground/85">
          {(pageCopy("about") || client.content.about).split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          <p>
            Call <a href={business.phoneHref} className="text-accent link-underline">{business.phone}</a>
            {business.email && <> or email <a href={business.emailHref} className="text-accent link-underline break-all">{business.email}</a></>}.
          </p>
        </article>

        <aside className="lg:col-span-4 space-y-5">
          {companyPhoto && <figure className="overflow-hidden rounded-2xl border shadow-card">
            <img src={companyPhoto.src} alt={companyPhoto.alt} loading="lazy" decoding="async" className="w-full h-64 object-cover" />
          </figure>}
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <p className="mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Quick facts</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Company</dt>
                <dd className="font-medium">{business.legalName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Based in</dt>
                <dd className="font-medium">{business.city}, {business.state}</dd>
              </div>
              {business.region && <div>
                <dt className="text-muted-foreground">Service area</dt>
                <dd className="font-medium">{business.region}</dd>
              </div>}
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-medium"><a href={business.phoneHref} className="hover:text-accent">{business.phone}</a></dd>
              </div>
              {business.email && <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium break-all"><a href={business.emailHref} className="hover:text-accent">{business.email}</a></dd>
              </div>}
            </dl>
          </div>
          <Button asChild className="w-full rounded-full bg-foreground text-background hover:bg-accent hover:text-accent-foreground">
            <Link to="/contact">Request an Estimate <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </aside>
      </div>
    </section>

    <CallToAction />
  </Layout>
);

export default About;
