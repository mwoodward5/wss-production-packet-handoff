import { routeHead } from "@/lib/wss-route-head";
import { createFileRoute } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";
import { VERIFIED_GOOGLE_MAPS_SHARE } from "@/lib/cities";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Phone, Mail, MapPin, Clock, Navigation, ArrowUpRight, LogIn } from "lucide-react";
import { JobberWorkRequest } from "@/components/site/JobberWorkRequest";
import { MAP_URL, MAP_EMBED, pageCopy } from "@/lib/wss-location";
import { RichText } from "@/components/site/RichText";

const DIRECTIONS_URL = MAP_URL;
const CONTACT_MAP_EMBED = MAP_EMBED;

export const Route = createFileRoute("/contact")({
  head: () => routeHead("Contact"),
  component: Contact,
});

function Contact() {
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Home", to: "/" },
          { label: "Contact" },
        ]}
      />
      <section className="mx-auto grid max-w-7xl gap-12 px-5 pt-6 pb-16 md:grid-cols-12 md:px-8 md:pb-24">
      <div className="md:col-span-5 lg:col-span-4">
        <div className="eyebrow">Reach Out</div>
        <h1 className="display mt-2 text-4xl md:text-5xl">Let's talk through your project.</h1>
        <p className="mt-4 text-foreground/80">
          Contact the company to discuss your project and availability.
        </p>

        <div className="mt-8 space-y-4">
          <a
            href={BUSINESS.phoneHref}
            className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-[var(--gold)]"
          >
            <Phone className="h-5 w-5 mt-0.5 text-[var(--gold)]" />
            <div>
              <div className="text-xs eyebrow">Call</div>
              <div className="text-lg font-semibold">{BUSINESS.phone}</div>
              <div className="text-xs text-muted-foreground mt-0.5">General business line</div>
            </div>
          </a>
          {BUSINESS.email && <a
            href={`mailto:${BUSINESS.email}`}
            className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-[var(--gold)]"
          >
            <Mail className="h-5 w-5 mt-0.5 text-[var(--gold)]" />
            <div>
              <div className="text-xs eyebrow">Email</div>
              <div className="text-base font-semibold">{BUSINESS.email}</div>
            </div>
          </a>}
          <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5">
            <MapPin className="h-5 w-5 mt-0.5 text-[var(--gold)]" />
            <div>
              <div className="text-xs eyebrow">Based in</div>
              <div className="text-base font-semibold">
                {BUSINESS.city}, {BUSINESS.state} {BUSINESS.zip}
              </div>
              <div className="text-xs text-muted-foreground">{BUSINESS.serviceArea}</div>
            </div>
          </div>
          {BUSINESS.hours.length > 0 && <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5">
            <Clock className="h-5 w-5 mt-0.5 text-[var(--gold)]" />
            <div>
              <div className="text-xs eyebrow">Hours</div>
              <div className="text-sm">
                {BUSINESS.hours.map((h) => (
                  <div key={h.day}>
                    <span className="font-semibold">{h.day}</span> · {h.hours}
                  </div>
                ))}
              </div>
            </div>
          </div>}
        </div>
      </div>

      <div className="md:col-span-7 lg:col-span-8">
        <div
          id="book-your-project"
          className="scroll-mt-28 md:scroll-mt-32 rounded-3xl border border-border bg-white p-3 md:p-5 shadow-[var(--shadow-couture)]"
        >
          <div className="px-4 pt-4 md:px-5 md:pt-5">
            <div className="eyebrow">Book your project</div>
            <h2 className="display mt-2 text-2xl md:text-3xl">Discuss your project.</h2>
            {pageCopy("contact") && <RichText text={pageCopy("contact")} />}
          </div>
          <div className="mt-5 px-1 md:px-2">
            <JobberWorkRequest />
          </div>
        </div>
      </div>
    </section>

    {(MAP_URL || MAP_EMBED) && <section className="mx-auto max-w-7xl px-5 pb-20 md:px-8 md:pb-28">
      <div className="eyebrow">Find us</div>
      <h2 className="display mt-2 text-3xl md:text-4xl">
        {BUSINESS.city}, {BUSINESS.state}
      </h2>
      <div className="mt-8 grid gap-8 md:grid-cols-12">
        {MAP_EMBED && <div className="md:col-span-7">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border bg-secondary">
            <iframe
              title={`Map for ${BUSINESS.name}`}
              src={CONTACT_MAP_EMBED}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-full w-full"
            />
          </div>
        </div>}
        <div className="md:col-span-5">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 mt-0.5 text-[var(--gold)]" />
              <div>
                <div className="text-xs eyebrow">Service base</div>
                <div className="text-base font-semibold">
                  {BUSINESS.city}, {BUSINESS.state} {BUSINESS.zip}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{BUSINESS.serviceArea}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-2">
              {MAP_URL && <a
                href={DIRECTIONS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-[var(--ink)]"
              >
                <Navigation className="h-4 w-4" /> Get Directions
              </a>}
              {MAP_URL && <a
                href={VERIFIED_GOOGLE_MAPS_SHARE}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-background px-5 py-3 text-sm font-semibold text-foreground"
              >
                View service map <ArrowUpRight className="h-4 w-4" />
              </a>}
              {MAP_URL && <a
                href={BUSINESS.phoneHref}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-background px-5 py-3 text-sm font-semibold text-foreground"
              >
                <Phone className="h-4 w-4" /> {BUSINESS.phone}
              </a>}
            </div>
            {BUSINESS.hours.length > 0 && <div className="mt-5 border-t border-border pt-4">
              <div className="text-xs eyebrow inline-flex items-center gap-2">
                <Clock className="h-3 w-3 text-[var(--gold)]" /> Hours
              </div>
              <ul className="mt-2 text-sm text-foreground">
                {BUSINESS.hours.map((h) => (
                  <li key={h.day}>
                    <span className="font-semibold">{h.day}</span> · {h.hours}
                  </li>
                ))}
              </ul>
            </div>}
            {BUSINESS.primaryServiceAreas.length > 0 && <div className="mt-5 border-t border-border pt-4">
              <div className="text-xs eyebrow">Cities we serve</div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {BUSINESS.primaryServiceAreas.map((c) => (
                  <li
                    key={c}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground"
                  >
                    <MapPin className="h-3 w-3 text-[var(--gold)]" /> {c}
                  </li>
                ))}
              </ul>
            </div>}
          </div>
        </div>
      </div>
    </section>}
    </>
  );
}
