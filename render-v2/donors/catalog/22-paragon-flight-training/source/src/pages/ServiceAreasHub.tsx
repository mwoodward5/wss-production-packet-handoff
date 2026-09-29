import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { Link } from "react-router-dom";
import { ArrowRight, MapPin, Plane } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { StickyCallBar } from "@/components/StickyCallBar";
import { StickyDesktopCTA } from "@/components/StickyDesktopCTA";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import { LocalSEO } from "@/components/local/LocalSEO";
import { ControlButton } from "@/components/motion/ControlButton";
import {
  CITIES,
  PROGRAMS,
  SITE,
  HUB_PATH,
  cityPath,
  programPath,
} from "@/data/local";

const ServiceAreasHub = () => {
  const title = `Service Areas & Programs | ${SITE.name}`;
  const description = paragraphs(sitePlan?.content?.['service-area']).join('\n\n') || client.trust.areas.join(' · ');

  return (
    <div className="min-h-screen bg-background">
      <ScrollProgress />
      <Nav />

      <LocalSEO
        title={title}
        description={description}
        path={HUB_PATH}
        keywords={client.trust.areas.join(", ")}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Service Areas", path: HUB_PATH },
        ]}
        graph={[
          {
            "@type": "ItemList",
            name: "Service Areas",
            itemListElement: CITIES.map((c, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${SITE.url}${cityPath(c.slug)}`,
              name: `Flight school for ${c.name} pilots`,
            })),
          },
          {
            "@type": "ItemList",
            name: "Training Programs",
            itemListElement: PROGRAMS.map((p, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${SITE.url}${programPath(p.slug)}`,
              name: p.name,
            })),
          },
        ]}
      />

      <main className="pt-24 md:pt-28">
        <div className="container-page">
          <nav aria-label="Breadcrumb" className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-2">
              <li><Link to="/" className="hover:text-primary">Home</Link></li>
              <li aria-hidden="true">/</li>
              <li className="text-foreground">Service Areas</li>
            </ol>
          </nav>
        </div>

        <section className="container-page pt-10 md:pt-14">
          <span className="eyebrow">
            <span className="h-px w-8 bg-primary" /> Service Areas Hub
          </span>
          <h1 data-speakable className="display-xl mt-5 max-w-4xl text-4xl text-balance sm:text-5xl md:text-6xl">
            {SITE.name}. <span className="text-primary">Service Areas & Programs.</span>
          </h1>
          <p data-speakable className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            {description}
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <ControlButton href="/#contact" trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
              Request Info
            </ControlButton>
            <ControlButton href={SITE.phoneTel} variant="secondary" ariaLabel={`Call ${SITE.phoneDisplay}`}>
              {SITE.phoneDisplay}
            </ControlButton>
          </div>
        </section>

        {/* City grid */}
        <section className="container-page mt-20">
          <div className="hud-tag flex items-center gap-2">
            <MapPin className="h-3 w-3" /> Cities served
          </div>
          <h2 className="display-xl mt-3 text-3xl md:text-4xl">By city.</h2>

          <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-sm bg-border md:grid-cols-2 lg:grid-cols-5">
            {CITIES.map((c, i) => (
              <Link
                key={c.slug}
                to={cityPath(c.slug)}
                className="group flex flex-col gap-3 bg-background p-6 transition-colors hover:bg-surface-elevated"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary">0{i + 1}</span>
                  <Plane className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground">{c.name}</h3>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  {[c.minutes,c.drive].filter(Boolean).join(" · ")}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{c.intro}</p>
                <span className="mt-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
                  Open page <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Program grid */}
        <section className="container-page mt-24">
          <div className="hud-tag">Programs</div>
          <h2 className="display-xl mt-3 text-3xl md:text-4xl">By program.</h2>

          <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-sm bg-border md:grid-cols-2 lg:grid-cols-5">
            {PROGRAMS.map((p, i) => (
              <Link
                key={p.slug}
                to={programPath(p.slug)}
                className="group flex flex-col gap-3 bg-background p-6 transition-colors hover:bg-surface-elevated"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary">P{i + 1}</span>
                <h3 className="font-display text-lg font-semibold text-foreground">{p.name}</h3>
                <p className="text-xs italic text-primary/80">{p.tagline}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{p.intro}</p>
                <span className="mt-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
                  Open page <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <div className="h-24" />
      </main>

      <Footer />
      <StickyCallBar />
      <StickyDesktopCTA />
    </div>
  );
};

export default ServiceAreasHub;
