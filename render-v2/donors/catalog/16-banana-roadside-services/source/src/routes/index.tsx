import {structuredData} from "@/data/metadata";
import {ClientImage} from "@/components/site/ClientImage";
import {client,serviceItems,european,mediaItems,hoursText,pageCopy} from "@/data/bridge";
import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BatteryCharging,
  Car,
  CircleParking,
  KeyRound,
  Zap,
} from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { CallButton } from "@/components/site/CallButton";
import { HeroCinematic } from "@/components/site/HeroCinematic";
// HeroWelcomeAudio now mounted inside HeroCinematic
import { ASSETS } from "@/assets/manifest";
import { PHONE_DISPLAY } from "@/data/site";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/")({
  head: () => ({scripts:structuredData("/"),meta:[{title: "Home — " + client.identity.businessName}],links:[{rel:"canonical",href:new URL("/",client.identity.website).href}]}),
  component: HomePage,
});

const SERVICES=serviceItems.map(s=>({...s,icon:/battery/i.test(s.name)?BatteryCharging:/tire/i.test(s.name)?CircleParking:/lockout/i.test(s.name)?KeyRound:Car,blurb:s.description}));
const FAQS=client.content.faqs;

export function HomePage() {
  return (
    <SiteLayout>
      {/* HERO — full-viewport cinematic video */}
      <HeroCinematic />


      {/* ABOUT */}
      <section className="bg-background py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
              About us
            </span>
            <h2 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              {client.content.whyHeadline || client.identity.businessName}
            </h2>

            <p className="mt-6 text-lg leading-relaxed text-foreground/75">{client.content.about}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/about-us"
                className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background transition-transform hover:-translate-y-0.5"
              >
                More about us
                <ArrowRight className="size-4" />
              </Link>
              <CallButton size="md" />
            </div>
          </div>
          <div className="lg:col-span-5">
            <div className="relative">
              <div className="overflow-hidden rounded-3xl border border-border shadow-[var(--shadow-lift)]">
                <ClientImage
                  src={ASSETS.reliable.url}
                  alt={client.identity.businessName}
                  className="aspect-[4/5] h-full w-full object-cover"
                  width={800}
                  height={1000}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section className="bg-[color:var(--cream)] py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
                Our Roadside Services
              </span>
              <h2 className="mt-3 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
                Our services
              </h2>
            </div>
            <Link
              to="/services"
              className="inline-flex items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
            >
              See every service
              <ArrowRight className="size-4" />
            </Link>
          </div>
          <ul className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map(({ icon: Icon, name, blurb }) => (
              <li
                key={name}
                className="group relative flex flex-col rounded-2xl border border-border bg-card p-7 shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
              >
                <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-[image:var(--gradient-sun)] text-[color:var(--asphalt)] shadow-[var(--shadow-sun)]">
                  <Icon className="size-6" strokeWidth={2.2} />
                </span>
                <h3 className="mt-5 text-2xl font-bold tracking-tight">{name}</h3>
                <p className="mt-2 flex-1 text-[15px] leading-relaxed text-foreground/70">
                  {blurb}
                </p>
                <CallButton size="sm" className="mt-6 self-start" label="Call now" />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      {FAQS.length > 0 && (<section className="bg-background py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="max-w-4xl">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana-deep)]">
              Frequently Asked Questions
            </span>
            <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Quick answers, no runaround.
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-foreground/75">Call us with your questions.</p>
            <div className="mt-7">
              <CallButton size="lg" />
            </div>
          </div>
          <div className="mt-12">
            <Accordion type="single" collapsible className="space-y-3">
              {FAQS.map((f, i) => (
                <AccordionItem
                  key={i}
                  value={`q-${i}`}
                  className="rounded-2xl border border-border bg-card px-6"
                >
                  <AccordionTrigger className="py-6 text-left text-lg font-semibold tracking-tight sm:text-xl md:text-2xl">
                    {f.q}
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 text-base leading-relaxed text-foreground/75 sm:text-[17px]">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <div className="mt-10 flex justify-center">
              <CallButton size="lg" />
            </div>
          </div>
        </div>
      </section>)}
    </SiteLayout>
  );
}
