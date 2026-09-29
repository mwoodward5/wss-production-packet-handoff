import { client, sitePlan, mediaSlot, discoveryService, serviceHref, paragraphs } from "@/lib/wss";
import { Phone, ClipboardList, PlaneTakeoff, MapPin } from "lucide-react";

/**
 * Conversion strip that sits directly under the hero.
 * Three task-oriented entry points + a phone CTA. Not a card-stack —
 * a single editorial band split by hairlines so it reads like a
 * mission-control control row.
 */
export const InquiryStrip = () => {
  return (
    <section
      aria-label="Quick admissions actions"
      className="relative border-y border-border bg-surface-elevated"
    >
      <div className="container-page">
        <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-4">
          <a
            href="#contact"
            className="group flex items-start gap-4 bg-surface-elevated p-6 transition-colors hover:bg-surface md:p-7"
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-sm bg-gradient-runway text-primary-foreground">
              <PlaneTakeoff className="h-4 w-4" />
            </span>
            <div>
              <div className="hud-tag">Step 01</div>
              <div className="mt-1 font-display text-base font-semibold text-foreground">
                Request Information
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Choose a contact option.
              </p>
            </div>
          </a>

          <a
            href="#programs"
            className="group flex items-start gap-4 bg-surface-elevated p-6 transition-colors hover:bg-surface md:p-7"
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-sm bg-gradient-instrument text-primary-foreground">
              <ClipboardList className="h-4 w-4" />
            </span>
            <div>
              <div className="hud-tag">Step 02</div>
              <div className="mt-1 font-display text-base font-semibold text-foreground">
                Review training programs
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {client.services.map(s => s.shortLabel).join(" · ")}
              </p>
            </div>
          </a>

          <a
            href="/service-areas"
            className="group flex items-start gap-4 bg-surface-elevated p-6 transition-colors hover:bg-surface md:p-7"
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-sm border border-border bg-surface text-primary">
              <MapPin className="h-4 w-4" />
            </span>
            <div>
              <div className="hud-tag">Step 03</div>
              <div className="mt-1 font-display text-base font-semibold text-foreground">
                View service areas
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {client.trust.areas.join(" · ")}
              </p>
            </div>
          </a>

          <a
            href={client.identity.phoneTel}
            className="group relative flex items-start gap-4 bg-surface-elevated p-6 transition-colors hover:bg-surface md:p-7"
            aria-label={`Call ${client.identity.businessName}`}
          >
            {/* armed channel accent rail */}
            <span aria-hidden="true" className="absolute left-0 top-0 h-full w-0.5 bg-gradient-to-b from-armed via-armed/60 to-transparent" />
            <span className="relative flex h-10 w-10 flex-none items-center justify-center rounded-sm border border-armed/40 bg-background text-armed">
              <Phone className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-armed shadow-[0_0_6px_hsl(var(--armed)/0.9)]" />
            </span>
            <div className="min-w-0">
              <div className="hud-tag flex items-center gap-1.5 text-armed">
                <span className="h-1 w-1 rounded-full bg-armed" /> Contact
              </div>
              <div className="mt-1 font-display text-base font-semibold text-foreground">
                {client.identity.phoneDisplay}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {client.identity.city}, {client.identity.state}
              </p>
            </div>
          </a>
        </div>
      </div>
    </section>
  );
};
