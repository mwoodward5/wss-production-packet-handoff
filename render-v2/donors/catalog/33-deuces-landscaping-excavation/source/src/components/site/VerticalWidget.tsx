/**
 * VerticalWidget — industry-aware lead/CTA block.
 * Renders a different inline widget based on CLIENT.industry.
 * All variants are stubs that funnel into LeadForm (which posts /api/lead).
 */
import { CLIENT, FEATURES } from "@/config";
import { LeadForm } from "@/components/site/LeadForm";
import { Section, SectionHeader } from "@/components/site/Sections";
import { Phone, CalendarDays, ClipboardList, Stethoscope, Zap } from "lucide-react";

function EmergencyCta({ label }: { label: string }) {
  return (
    <a
      href={`tel:${CLIENT.phoneE164}`}
      className="inline-flex items-center gap-2 rounded-lg bg-destructive text-destructive-foreground px-5 py-3 text-sm font-semibold hover:opacity-90"
    >
      <Zap className="w-4 h-4" /> {label} {CLIENT.phone}
    </a>
  );
}

export function VerticalWidget() {
  if (!FEATURES.verticalWidget) return null;

  switch (CLIENT.industry) {
    case "roofing":
      return (
        <Section>
          <SectionHeader
            eyebrow="Free Inspection"
            title={<>Schedule a <span className="text-primary">free roof inspection</span></>}
            intro="Tell us a bit about your property and we'll come out at no cost."
          />
          <div className="mt-8 max-w-2xl mx-auto rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <CalendarDays className="w-4 h-4 text-primary" /> Typically scheduled within 48 hours
            </div>
            <LeadForm topic="Free roof inspection" />
          </div>
        </Section>
      );

    case "rv-repair":
      return (
        <Section>
          <SectionHeader
            eyebrow="Service Request"
            title={<>Request <span className="text-primary">RV service</span></>}
            intro="Describe the issue — we'll get back same day."
          />
          <div className="mt-8 max-w-2xl mx-auto rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <ClipboardList className="w-4 h-4 text-primary" /> Mobile service available
            </div>
            <LeadForm topic="RV service request" />
          </div>
        </Section>
      );

    case "veterinarian":
    case "dentist":
      return (
        <Section>
          <SectionHeader
            eyebrow="Book"
            title={<>Request an <span className="text-primary">appointment</span></>}
            intro="We'll confirm within one business day."
          />
          <div className="mt-8 max-w-2xl mx-auto rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Stethoscope className="w-4 h-4 text-primary" /> New patients welcome
            </div>
            <LeadForm topic="Appointment request" />
          </div>
        </Section>
      );

    case "electrician":
    case "plumber":
    case "hvac":
      return (
        <Section>
          <SectionHeader
            center
            eyebrow="24/7 Service"
            title={<>Emergency? <span className="text-primary">Call now.</span></>}
            intro="Or send a non-urgent request below."
          />
          <div className="mt-6 flex justify-center">
            <EmergencyCta label="Call" />
          </div>
          <div className="mt-8 max-w-2xl mx-auto rounded-2xl border border-border bg-card p-6">
            <LeadForm topic="Service request" />
          </div>
        </Section>
      );

    case "landscaping":
    case "auto-detailing":
    case "law-firm":
    case "restaurant":
    case "generic":
    default:
      return (
        <Section>
          <SectionHeader
            eyebrow="Get in Touch"
            title={<>Request a <span className="text-primary">quote</span></>}
            intro="Tell us what you need — we'll respond promptly."
          />
          <div className="mt-8 max-w-2xl mx-auto rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Phone className="w-4 h-4 text-primary" /> Or call {CLIENT.phone}
            </div>
            <LeadForm topic="Quote request" />
          </div>
        </Section>
      );
  }
}
