import { Link } from "react-router-dom";
import { ArrowRight, MapPin, Navigation, Phone } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { CallToAction } from "@/components/site/CallToAction";
import { client, pageCopy } from "@/lib/bridge";
import { business } from "@/lib/business";
import { breadcrumb, localBusinessSchema } from "@/lib/schema";

const ServiceArea = () => (
  <Layout>
    <SEO
      title={`Service Area — ${business.city}, ${business.state} | ${business.name}`}
      description={`Service area information for ${business.name} in ${business.city}, ${business.state}.`}
      path="/service-area"
      schema={[localBusinessSchema, breadcrumb([{ name: "Home", path: "/" }, { name: "Service Area", path: "/service-area" }])]}
    />

    <section className="bg-gradient-canvas">
      <div className="container-tight pt-20 pb-12 md:pt-28 md:pb-16">
        <p className="eyebrow"><MapPin className="h-3.5 w-3.5" /> Where we work</p>
        <h1 className="mt-3 font-display text-5xl md:text-6xl max-w-3xl leading-[1.05]">
          Service area for <span className="display-italic text-accent">{business.name}.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
          {pageCopy("service-area")}
        </p>
      </div>
    </section>

    <section className="section">
      <div className="container-tight grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl overflow-hidden border shadow-card">
          <div className="w-full h-[420px] md:h-[520px] bg-secondary flex flex-col items-center justify-center gap-5 p-8 text-center">
            <MapPin className="h-10 w-10 text-accent" />
            <p className="font-display text-3xl">{business.city}, {business.state}</p>
            {client.trust.mapUrl && <a href={client.trust.mapUrl} target="_blank" rel="noopener noreferrer" className="text-accent link-underline">View business map</a>}
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-2xl border bg-card p-7 shadow-card">
            <h2 className="font-display text-2xl">Location</h2>
            <p className="mt-3 text-muted-foreground">
              {business.city}, {business.state}<br />
              {business.region}
            </p>
            <div className="mt-6 flex flex-col gap-3">
              {client.trust.mapUrl && <Button asChild className="rounded-full bg-foreground text-background hover:bg-accent hover:text-accent-foreground">
                <a href={client.trust.mapUrl} target="_blank" rel="noopener noreferrer">
                  <Navigation className="mr-2 h-4 w-4" /> View business map
                </a>
              </Button>}
              <a href={business.phoneHref} className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-foreground/20 hover:border-accent hover:text-accent transition mono text-sm">
                <Phone className="h-4 w-4" /> {business.phone}
              </a>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-7 shadow-card">
            <h3 className="font-display text-xl">Not sure if you're in range?</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Call to ask whether your project location is in the service area.
            </p>
            <Button asChild variant="outline" className="mt-5 rounded-full">
              <Link to="/contact">Request an Estimate <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </aside>
      </div>
    </section>

    <CallToAction />
  </Layout>
);

export default ServiceArea;
