import {ClientImage} from "@/components/site/ClientImage";
import {client,serviceItems,european,mediaItems,hoursText,pageCopy} from "@/data/bridge";
import { createFileRoute } from "@tanstack/react-router";
import { Award, Clock, HeartHandshake, MapPin, ShieldCheck, Smile } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { CallButton } from "@/components/site/CallButton";
import { ASSETS } from "@/assets/manifest";

export const Route = createFileRoute("/about-us")({
  head: () => ({meta:[{title: "About Us — " + client.identity.businessName}],links:[{rel:"canonical",href:new URL("/about-us",client.identity.website).href}]}),
  component: AboutPage,
});

const COMMITMENTS=client.content.values.map(v=>({...v,icon:HeartHandshake}));

export function AboutPage() {
  return (
    <SiteLayout>
      {/* HERO */}
      <section className="relative isolate overflow-hidden bg-[color:var(--asphalt)] py-24 text-white sm:py-32">
        <div className="absolute inset-0 -z-10">
          <ClientImage
            src={ASSETS.about_divider.url}
            alt=""
            className="ken-burns h-full w-full object-cover opacity-50"
          />
          <div className="absolute inset-0 hero-scrim" />
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)] ring-1 ring-white/20">
            About Us
          </span>
          <h1 className="mt-6 max-w-3xl font-display text-[clamp(2.8rem,7vw,5.5rem)] leading-[0.95] tracking-tight">
            {client.identity.businessName}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/85 sm:text-xl">{client.identity.city}, {client.identity.state}</p>
        </div>
      </section>

      {/* OUR STORY */}
      <section className="bg-background py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-6">
            <div className="overflow-hidden rounded-3xl border border-border shadow-[var(--shadow-lift)]">
              <ClientImage
                src={ASSETS.about_story.url}
                alt={client.identity.businessName}
                className="aspect-[4/3] h-full w-full object-cover"
                width={1200}
                height={900}
              />
            </div>
          </div>
          <div className="lg:col-span-6">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
              Our Story
            </span>
            <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              {client.content.whyHeadline || "Our story"}
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-foreground/75">{pageCopy("about") || client.content.about}</p>
            <div className="mt-8">
              <CallButton size="lg" />
            </div>
          </div>
        </div>
      </section>

      {/* COMMITMENTS */}
      {COMMITMENTS.length > 0 && (<section className="bg-[color:var(--cream)] py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-6">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
                Our Commitment
              </span>
              <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
                Our commitments
              </h2>
            </div>
            <div className="lg:col-span-6">
              <div className="overflow-hidden rounded-3xl border border-border shadow-[var(--shadow-soft)]">
                <ClientImage
                  src={ASSETS.about_commitment.url}
                  alt={client.identity.businessName}
                  className="h-72 w-full object-cover"
                  width={1200}
                  height={600}
                />
              </div>
            </div>
          </div>

          <ul className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {COMMITMENTS.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="flex flex-col rounded-3xl border border-border bg-card p-7 shadow-[var(--shadow-soft)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
              >
                <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-[image:var(--gradient-sun)] text-[color:var(--asphalt)] shadow-[var(--shadow-sun)]">
                  <Icon className="size-6" strokeWidth={2.2} />
                </span>
                <h3 className="mt-5 text-xl font-bold tracking-tight">{title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-foreground/70">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>)}
    </SiteLayout>
  );
}
