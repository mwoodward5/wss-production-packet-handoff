import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Camera } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { SEO } from "@/components/SEO";
import { CallToAction } from "@/components/site/CallToAction";
import { Button } from "@/components/ui/button";
import { pageCopy } from "@/lib/bridge";
import { business } from "@/lib/business";
import { breadcrumb, localBusinessSchema } from "@/lib/schema";
import { projects, projectCategories } from "@/lib/projects";

const FILTERS = [{ key: "all", label: "All Photos" }, ...projectCategories];

const Projects = () => {
  const [filter, setFilter] = useState<string>("all");
  const [lightbox, setLightbox] = useState<number | null>(null);

  const filtered = useMemo(
    () => filter === "all" ? projects : projects.filter(p => p.categories.includes(filter)),
    [filter]
  );

  return (
    <Layout>
      <SEO
        title={`Photo Gallery | ${business.name}, ${business.city}, ${business.state}`}
        description={`Photo gallery for ${business.name}.`}
        path="/projects"
        schema={[localBusinessSchema, breadcrumb([{name:"Home",path:"/"},{name:"Projects",path:"/projects"}])]}
      />

      <section className="bg-gradient-canvas">
        <div className="container-tight pt-20 pb-10 md:pt-28 md:pb-14">
          <p className="eyebrow"><Camera className="h-3.5 w-3.5" /> Photo Gallery</p>
          <h1 className="mt-3 font-display text-5xl md:text-6xl max-w-3xl leading-[1.05]">
            Photos from <span className="display-italic text-accent">{business.name}.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
            {pageCopy("gallery")}
          </p>
        </div>
      </section>

      <section className="py-8 border-y bg-background sticky top-16 z-30 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="container-tight flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setLightbox(null); }}
              className={`mono text-[11px] uppercase tracking-[0.18em] px-4 py-2 rounded-full border transition-colors ${
                filter === f.key
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-muted-foreground border-foreground/15 hover:border-accent hover:text-accent"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="container-wide">
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-5 [column-fill:_balance]">
            {filtered.map((p, i) => (
              <button
                key={p.src + i}
                onClick={() => setLightbox(i)}
                className="group mb-5 block w-full overflow-hidden rounded-xl border bg-card shadow-card hover:shadow-elegant transition-all duration-500 break-inside-avoid text-left"
              >
                <div className="relative overflow-hidden">
                  <img
                    src={p.src}
                    alt={p.alt}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-auto transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white font-display text-sm">{p.caption}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-20">No photos in this category yet.</p>
          )}
        </div>
      </section>

      <section className="section bg-secondary/40 border-t">
        <div className="container-tight text-center max-w-2xl">
          <p className="eyebrow justify-center"><Camera className="h-3.5 w-3.5" /> Have a project in mind?</p>
          <h2 className="mt-3 font-display text-4xl md:text-5xl">Let's talk about your project.</h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Tell us about your project.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild className="rounded-full bg-foreground text-background hover:bg-accent hover:text-accent-foreground">
              <Link to="/contact">Request an Estimate <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/services">Browse Services</Link>
            </Button>
          </div>
        </div>
      </section>

      {lightbox !== null && filtered[lightbox] && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            className="absolute top-5 right-5 text-white/80 hover:text-white mono text-xs uppercase tracking-widest"
            aria-label="Close"
          >
            Close ✕
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox((lightbox - 1 + filtered.length) % filtered.length); }}
            className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl mono"
            aria-label="Previous"
          >‹</button>
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox((lightbox + 1) % filtered.length); }}
            className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl mono"
            aria-label="Next"
          >›</button>
          <figure className="max-w-6xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={filtered[lightbox].src}
              alt={filtered[lightbox].alt}
              className="max-h-[80vh] w-auto object-contain rounded-lg"
            />
            <figcaption className="mt-4 text-white/85 text-sm font-display text-center">
              {filtered[lightbox].caption}
              <span className="block mt-1 mono text-[10px] uppercase tracking-widest text-white/50">
                {lightbox + 1} / {filtered.length}
              </span>
            </figcaption>
          </figure>
        </div>
      )}

      <CallToAction />
    </Layout>
  );
};

export default Projects;
