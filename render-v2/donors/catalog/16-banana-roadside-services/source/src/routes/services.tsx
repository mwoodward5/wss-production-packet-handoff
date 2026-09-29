import {structuredData} from "@/data/metadata";
import {ClientImage} from "@/components/site/ClientImage";
import {client,serviceItems,european,mediaItems,hoursText,pageCopy} from "@/data/bridge";
import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { CallButton } from "@/components/site/CallButton";
import { ASSETS } from "@/assets/manifest";

export const Route = createFileRoute("/services")({
  head: () => ({scripts:structuredData("/services"),meta:[{title: "Services — " + client.identity.businessName}],links:[{rel:"canonical",href:new URL("/services",client.identity.website).href}]}),
  component: ServicesPage,
});

const SERVICES=serviceItems.map(s=>({...s,image:undefined}));

export function ServicesPage({selected}: {selected?: (typeof serviceItems)[number]} = {}) {
  return (
    <SiteLayout>
      {/* HERO */}
      <section className="relative isolate overflow-hidden bg-[color:var(--asphalt)] py-24 text-white sm:py-32">
        <div className="absolute inset-0 -z-10">
          <ClientImage
            src={ASSETS.changing_wheel.url}
            alt=""
            className="ken-burns h-full w-full object-cover opacity-50"
          />
          <div className="absolute inset-0 hero-scrim" />
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)] ring-1 ring-white/20">
            Our Services
          </span>
          <h1 className="mt-6 max-w-3xl font-display text-[clamp(2.8rem,7vw,5.5rem)] leading-[0.95] tracking-tight">
            {selected?.name || "Our roadside services."}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/85 sm:text-xl">{selected ? client.identity.businessName : client.content.serviceIntro}</p>
          <div className="mt-8">
            <CallButton size="xl" />
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section className="bg-background py-20 sm:py-28">
        <div className="mx-auto max-w-7xl space-y-20 px-4 sm:px-6 sm:space-y-28">
          {(selected ? SERVICES.filter(s=>s.name===selected.name) : SERVICES).map((s, i) => (
            <article
              key={s.name}
              id={s.href.slice(1)}
              className="grid items-center gap-12 lg:grid-cols-12"
            >
              <div
                className={`lg:col-span-7 ${
                  i % 2 === 1 ? "lg:order-2" : ""
                }`}
              >
                <div className="aspect-[3/2] overflow-hidden rounded-2xl border border-border shadow-md bg-[color:var(--cream)]">
                  <ClientImage
                    src={s.image}
                    alt={s.name}
                    className="h-full w-full object-cover"
                    width={1200}
                    height={800}
                    loading={i === 0 ? "eager" : "lazy"}
                  />
                </div>
              </div>
              <div className={`lg:col-span-5 ${i % 2 === 1 ? "lg:order-1" : ""}`}>
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
                  Service 0{i + 1}
                </span>
                <h2 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
                  {s.name}
                </h2>
                <p className="mt-5 text-lg leading-relaxed text-foreground/75">
                  {s.description}
                </p>
                <div className="mt-7">
                  <CallButton size="lg" label={`Call for ${s.name.split(" ")[0]}`} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}
