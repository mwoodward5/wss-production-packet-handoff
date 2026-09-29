import { Link } from "react-router-dom";
import { ArrowRight, HardHat, Home, Hammer, Frame, PaintRoller, Layers, SquareStack, Grid3x3, Wrench, Building2 } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { SEO } from "@/components/SEO";
import { CallToAction } from "@/components/site/CallToAction";
import { client } from "@/lib/bridge";
import { business, services } from "@/lib/business";
import { breadcrumb, localBusinessSchema } from "@/lib/schema";

const iconMap: Record<string, any> = { HardHat, Home, Hammer, Frame, PaintRoller, Layers, SquareStack, Grid3x3, Wrench, Building2 };

const Services = () => (
  <Layout>
    <SEO
      title={`Services | ${business.name}`}
      description={client.content.serviceIntro}
      path="/services"
      schema={[localBusinessSchema, breadcrumb([{name:"Home",path:"/"},{name:"Services",path:"/services"}])]}
    />

    <section className="bg-gradient-canvas">
      <div className="container-tight pt-20 pb-12 md:pt-28 md:pb-16">
        <p className="eyebrow"><HardHat className="h-3.5 w-3.5" /> What we do</p>
        <h1 className="mt-3 font-display text-5xl md:text-6xl max-w-3xl leading-[1.05]">Services from {business.name}.</h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
          {client.content.serviceIntro}
        </p>
      </div>
    </section>

    <section className="section">
      <div className="container-tight grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {services.map(s => {
          const Icon = iconMap[s.icon] || HardHat;
          return (
            <Link key={s.slug} to={`/services/${s.slug}`}
              className="group rounded-2xl border bg-card p-7 shadow-card hover:shadow-elegant hover:-translate-y-1 transition-all duration-500">
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-secondary group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="font-display text-xl font-semibold">{s.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.short}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary group-hover:text-accent">
                Learn more <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>

    <CallToAction />
  </Layout>
);

export default Services;
