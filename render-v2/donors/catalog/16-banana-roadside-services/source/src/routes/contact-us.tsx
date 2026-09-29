import {ClientImage} from "@/components/site/ClientImage";
import {client,serviceItems,european,mediaItems,hoursText,pageCopy} from "@/data/bridge";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, MapPin, Phone } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { CallButton } from "@/components/site/CallButton";
import { ASSETS } from "@/assets/manifest";
import { HOURS_LINE, PHONE_DISPLAY, PHONE_TEL, SERVICE_AREA_LINE } from "@/data/site";

export const Route = createFileRoute("/contact-us")({
  head: () => ({meta:[{title: "Contact — " + client.identity.businessName}],links:[{rel:"canonical",href:new URL("/contact-us",client.identity.website).href}]}),
  component: ContactPage,
});

export function ContactPage() {
  return (
    <SiteLayout>
      {/* HERO + CONTACT CARD */}
      <section className="relative isolate overflow-hidden bg-[color:var(--asphalt)] text-white">
        <div className="absolute inset-0 -z-10">
          <ClientImage
            src={ASSETS.contact_hero.url}
            alt=""
            className="h-full w-full object-cover opacity-55"
            style={{ objectPosition: "center 20%" }}
          />
          <div className="absolute inset-0 hero-scrim" />
        </div>
        <div className="mx-auto grid min-h-[80vh] max-w-7xl items-center gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)] ring-1 ring-white/20">
              Contact
            </span>
            <h1 className="mt-6 font-display text-[clamp(2.8rem,8vw,6rem)] leading-[0.92] tracking-tight">
              Contact
              <br />
              <span className="text-[color:var(--banana)]">{client.identity.businessName}</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/85 sm:text-xl">{pageCopy("contact")}</p>
            <div className="mt-8">
              <CallButton size="xl" />
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-3xl border border-white/15 bg-white/[0.05] p-8 backdrop-blur-lg shadow-[var(--shadow-lift)]">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)]">
                Direct dial
              </div>
              <a
                href={`tel:${PHONE_TEL}`}
                className="mt-3 block font-display text-5xl tracking-tight text-white sm:text-6xl"
                aria-label={`Call ${client.identity.businessName} at ${PHONE_DISPLAY}`}
              >
                {PHONE_DISPLAY}
              </a>
              <div className="mt-6">
                <CallButton size="xl" className="w-full" />
              </div>
              <ul className="mt-8 space-y-4 text-sm text-white/85">
                {HOURS_LINE && (<li className="flex items-start gap-3">
                  <Clock className="mt-0.5 size-4 text-[color:var(--banana)]" />
                  <span>
                    {HOURS_LINE}
                    
                  </span>
                </li>)}
                {SERVICE_AREA_LINE && (<li className="flex items-start gap-3">
                  <MapPin className="mt-0.5 size-4 text-[color:var(--banana)]" />
                  <span>{SERVICE_AREA_LINE}</span>
                </li>)}
                <li className="flex items-start gap-3">
                  <Phone className="mt-0.5 size-4 text-[color:var(--banana)]" />
                  <span>{client.identity.email && <a href={`mailto:${client.identity.email}`}>{client.identity.email}</a>}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
