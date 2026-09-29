import { Link } from "@tanstack/react-router";
import { ArrowRight, Building2, Layers, Square, Hammer, Paintbrush, Home, LayoutGrid } from "lucide-react";
import { services, serviceImages } from "@/lib/site";
import { SectionHeading } from "./SectionHeading";

const imageMap=serviceImages;

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Building2, Layers, Square, Hammer, Paintbrush, Home, LayoutGrid,
};

export function RelatedServices({ exclude }: { exclude?: string }) {
  const items = services.filter((s) => s.slug !== exclude);
  if (!items.length) return null;
  return (
    <section className="bg-secondary py-16">
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        <SectionHeading eyebrow="Related Services" title="Other services" />
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => {
            const Icon = iconMap[s.icon];
            return (
              <Link
                key={s.slug}
                to={`/${s.slug}` as string}
                className="group relative overflow-hidden rounded-3xl border border-border bg-card shadow-card transition-all hover:-translate-y-1 hover:shadow-elegant"
              >
                <div className="aspect-[4/3] overflow-hidden">
                  {imageMap[s.slug] && <img src={imageMap[s.slug]} alt={s.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />}
                </div>
                <div className="p-5">
                  <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground">
                    {Icon ? <Icon className="h-4 w-4" /> : null}
                  </div>
                  <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.short}</p>
                  <div className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                    Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
