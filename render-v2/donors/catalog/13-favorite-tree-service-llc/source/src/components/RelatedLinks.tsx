import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SERVICES, CITIES, EASTERN_CITIES } from "@/lib/services-data";

export function RelatedServices({ excludeSlug }: { excludeSlug?: string }) {
  const items = SERVICES.filter((s) => s.slug !== excludeSlug).slice(0, 6);
  return (
    <section className="bg-muted/40 py-16 sm:py-20" aria-labelledby="related-services-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 id="related-services-heading" className="text-2xl font-bold sm:text-3xl">
          Related Tree Services
        </h2>
        <p className="mt-2 text-muted-foreground">
          Explore our services.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <Link
              key={s.slug}
              to={s.path}
              className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-smooth hover:-translate-y-1 hover:shadow-glow"
            >
              <h3 className="text-lg font-bold text-foreground">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.blurb}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AreasWeServe({ excludeSlug }: { excludeSlug?: string }) {
  const items = CITIES.filter((c) => c.slug !== excludeSlug);
  if (!items.length) return null;
  return (
    <section className="py-16 sm:py-20" aria-labelledby="areas-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 id="areas-heading" className="text-2xl font-bold sm:text-3xl">
          Areas We Serve
        </h2>
        <p className="mt-2 text-muted-foreground">
          Contact us to discuss your location.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Link
              key={c.slug}
              to={c.path}
              className="group flex items-center justify-between rounded-xl border border-border bg-card p-5 shadow-sm transition-smooth hover:-translate-y-0.5 hover:shadow-glow"
            >
              <div>
                <div className="text-base font-bold text-foreground">{c.city}</div>
                <div className="text-xs text-muted-foreground"></div>
              </div>
              <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
          {EASTERN_CITIES.map((c) => (
            <div
              key={c.city}
              className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 p-5 shadow-sm"
            >
              <div>
                <div className="text-base font-bold text-foreground">{c.city}</div>
                <div className="text-xs text-muted-foreground"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
