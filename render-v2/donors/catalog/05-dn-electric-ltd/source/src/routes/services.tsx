import { useState } from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { SERVICES, BUSINESS } from "@/lib/business";
import { getClient, clientPhoto } from "@/lib/wss-client";
import { routeHead } from "@/lib/wss-route-head";
import { ArrowUpRight } from "lucide-react";
import { CtaBanner } from "@/components/site/CtaBanner";
import { PageHeader } from "@/components/site/PageHeader";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { ImageLightbox } from "@/components/site/ImageLightbox";
const LIGHTBOX_ITEMS = SERVICES.filter(s => s.imagePath).map((s) => ({
  src: s.imagePath,
  alt: `Client-provided project photograph from ${BUSINESS.name}`,
  caption: `Client-provided photograph from ${BUSINESS.name}`,
}));

export const Route = createFileRoute("/services")({
  head: () => routeHead("Services"),
  component: ServicesIndex,
});

function ServicesIndex() {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const pathname = useRouterState({ select: s => s.location.pathname });
  if (pathname.replace(/\/+$/, "") !== "/services") return <Outlet />;

  return (
    <>
      <PageHeader
        eyebrow="What We Do"
        title={`Services from ${BUSINESS.name}`}
        intro={getClient().content.serviceIntro}
        image={clientPhoto("hero")}
      />

      <Breadcrumbs
        items={[
          { label: "Home", to: "/" },
          { label: "Services" },
        ]}
      />

      <section className="mx-auto max-w-7xl px-5 py-16 md:px-8">
        <div className="grid gap-px bg-border md:grid-cols-2 lg:grid-cols-3 overflow-hidden rounded-2xl border border-border">
          {SERVICES.map((s, i) => (
            <div key={s.slug} className="group bg-background p-7 transition-colors hover:bg-secondary">
              <div className="relative mb-5 aspect-[16/10] overflow-hidden rounded-lg bg-muted">
                {s.imagePath && <button
                  type="button"
                  onClick={() => setLightbox(LIGHTBOX_ITEMS.findIndex(item => item.src === s.imagePath))}
                  aria-label={`View larger client photograph for ${s.name}`}
                  className="block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
                >
                  <img
                    src={s.imagePath}
                    alt={`Client-provided project photograph from ${BUSINESS.name}`}
                    loading="lazy"
                    decoding="async"
                    width={800}
                    height={500}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                </button>}
                <div className="pointer-events-none absolute left-3 top-3 rounded bg-[var(--ink)]/85 px-2 py-1 font-mono text-[0.65rem] uppercase tracking-widest text-[var(--gold)]">
                  0{i + 1}
                </div>
              </div>
              <Link
                to={s.href}
                className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] rounded"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="display text-2xl text-foreground">{s.name}</h2>
                  <ArrowUpRight className="h-5 w-5 shrink-0 text-foreground/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--gold)]" />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{s.short}</p>
              </Link>
            </div>
          ))}
        </div>
      </section>

      <ImageLightbox
        items={LIGHTBOX_ITEMS}
        index={lightbox}
        onIndexChange={setLightbox}
        onClose={() => setLightbox(null)}
      />

      <CtaBanner />
    </>
  );
}
