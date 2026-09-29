import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { SERVICES } from "@/lib/business";
export function ServicesPreview() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <div className="eyebrow">Our Disciplines</div>
          <h2 className="display mt-3 text-4xl md:text-5xl">
            Services for your project.
          </h2>
        </div>
        <Link
          to="/services"
          className="inline-flex items-center gap-2 rounded-full border border-foreground px-5 py-3 text-sm font-semibold text-foreground hover:bg-foreground hover:text-background transition-colors"
        >
          View all services <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-6 md:auto-rows-[280px]">
        {SERVICES.map((s, i) => {
          const span =
            i === 0
              ? "md:col-span-4"
              : i === 1
                ? "md:col-span-2"
                : i === 2
                  ? "md:col-span-2"
                  : i === 3
                    ? "md:col-span-2"
                    : i === 4
                      ? "md:col-span-2"
                      : "md:col-span-6";
          return (
            <Link
              key={s.slug}
              to={s.href}
              className={`group relative overflow-hidden rounded-2xl bg-[var(--ink)] text-[var(--bone)] ${span}`}
            >
              {s.imagePath && <img
                src={s.imagePath}
                alt="Client-provided project photograph"
                loading="lazy"
                decoding="async"
                width={800}
                height={600}
                className="absolute inset-0 h-full w-full object-cover opacity-60 transition-all duration-700 group-hover:scale-105 group-hover:opacity-50"
              />}
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--ink)] via-[var(--ink)]/30 to-transparent" />
              <div className="relative z-10 flex h-full flex-col justify-between p-6 min-h-[260px]">
                <div className="font-mono text-[0.65rem] uppercase tracking-widest text-[var(--gold)]">
                  0{i + 1}
                </div>
                <div>
                  <h3 className="display text-2xl md:text-3xl">{s.name}</h3>
                  <div className="mt-2 flex items-center justify-between text-xs text-[var(--bone)]/70">
                    <span className="max-w-md">{s.short}</span>
                    <ArrowUpRight className="h-5 w-5 text-[var(--gold)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
