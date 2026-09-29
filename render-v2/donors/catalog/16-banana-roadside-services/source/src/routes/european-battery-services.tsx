import {structuredData} from "@/data/metadata";
import {ClientImage} from "@/components/site/ClientImage";
import {client,serviceItems,european,mediaItems,hoursText,pageCopy} from "@/data/bridge";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Battery } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { CallButton } from "@/components/site/CallButton";
import { ASSETS } from "@/assets/manifest";

export const Route = createFileRoute("/european-battery-services")({
  head: () => ({scripts:structuredData("/european-battery-services"),meta:[{title: "European Battery Services — " + client.identity.businessName}],links:[{rel:"canonical",href:new URL("/european-battery-services",client.identity.website).href}]}),
  component: EuropeanPage,
});

// The copied contract has no marque-specific copy/media or warning-sign slots.
const BRANDS: {name:string;headline:string;img:string;body:string}[]=[];
const SIGNS: {title:string;body:string}[]=[];

export function EuropeanPage() {
  if(!european) return <SiteLayout><section className="bg-background py-24"><div className="mx-auto max-w-7xl px-4"><h1 className="font-display text-5xl">Service unavailable</h1><p>{client.identity.businessName}</p></div></section></SiteLayout>;
  return (
    <SiteLayout>
      {/* HERO */}
      <section className="relative isolate overflow-hidden bg-[color:var(--asphalt)] py-24 text-white sm:py-32">
        <div className="absolute inset-0 -z-10">
          <ClientImage
            src={ASSETS.euro_hero.url}
            alt=""
            className="ken-burns h-full w-full object-cover opacity-60"
          />
          <div className="absolute inset-0 hero-scrim" />
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)] ring-1 ring-white/20">
            European Battery Services
          </span>
          <h1 className="mt-6 max-w-3xl font-display text-[clamp(2.8rem,7vw,5.5rem)] leading-[0.95] tracking-tight">
            {european.name}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/85 sm:text-xl">{client.identity.businessName}</p>
          <div className="mt-8">
            <CallButton size="xl" />
          </div>
        </div>
      </section>

      {/* INTRO */}
      <section className="bg-background py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-6">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
              Why specialized service matters
            </span>
            <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              {european.name}
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-foreground/75">{european.description}</p>

            <div className="mt-8">
              <CallButton size="lg" />
            </div>
          </div>
          <div className="lg:col-span-6">
            <div className="overflow-hidden rounded-3xl border border-border shadow-[var(--shadow-lift)]">
              <ClientImage
                src={ASSETS.euro_front.url}
                alt={client.identity.businessName}
                className="h-full w-full object-cover"
                width={1200}
                height={900}
              />
            </div>
          </div>
        </div>
      </section>

      {/* BRANDS — full-width rows */}
      {BRANDS.length > 0 && (<section className="bg-[color:var(--cream)] py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="max-w-3xl">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
              Brands we service
            </span>
            <h2 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              Vehicle brands
            </h2>
          </div>
          <div className="mt-14 space-y-10">
            {BRANDS.map((b, i) => (
              <article
                key={b.name}
                className="grid items-center gap-8 overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8 lg:grid-cols-12 lg:gap-12"
              >
                <div
                  className={`lg:col-span-5 ${i % 2 === 1 ? "lg:order-2" : ""}`}
                >
                  <div className="aspect-[4/3] overflow-hidden rounded-2xl">
                    <ClientImage
                      src={b.img}
                      alt={b.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div className={`lg:col-span-7 ${i % 2 === 1 ? "lg:order-1" : ""}`}>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
                    {b.name}
                  </div>
                  <h3 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                    {b.headline}
                  </h3>
                  <p className="mt-4 text-[15px] leading-relaxed text-foreground/75 sm:text-base">
                    {b.body}
                  </p>
                  <div className="mt-6">
                    <CallButton size="lg" label={`Call for ${b.name} service`} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>)}

      {/* WARNING SIGNS */}
      {SIGNS.length > 0 && (<section className="bg-background py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
              <AlertCircle className="size-3.5" />
              Warning signs
            </span>
            <h2 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              When to call us before you get stranded.
            </h2>
          </div>
          <ul className="mt-12 grid gap-5 md:grid-cols-2">
            {SIGNS.map((s) => (
              <li
                key={s.title}
                className="rounded-3xl border border-border bg-card p-7 shadow-[var(--shadow-soft)]"
              >
                <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-[image:var(--gradient-sun)] text-[color:var(--asphalt)] shadow-[var(--shadow-sun)]">
                  <Battery className="size-6" strokeWidth={2.2} />
                </span>
                <h3 className="mt-5 text-xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-foreground/70">{s.body}</p>
              </li>
            ))}
          </ul>
          <div className="mt-12 flex flex-col items-start gap-4 rounded-3xl border border-border bg-[color:var(--cream)] p-8 sm:flex-row sm:items-center sm:justify-between">
<p className="max-w-2xl text-base text-foreground/80">Contact us to discuss your vehicle.</p>
            <CallButton size="lg" />
          </div>
        </div>
      </section>)}
    </SiteLayout>
  );
}
