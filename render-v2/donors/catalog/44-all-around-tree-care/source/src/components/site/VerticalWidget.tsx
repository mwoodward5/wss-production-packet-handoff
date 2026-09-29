import { CLIENT, FEATURES } from "@/config";
import { LeadForm } from "./LeadForm";
import { Section, SectionHeader } from "./Sections";
import { Phone } from "lucide-react";
export function VerticalWidget() {
  if (!FEATURES.verticalWidget) return null;
  return <Section>
    <SectionHeader eyebrow="Get in Touch" title={<>Request a <span className="text-primary">quote</span></>} intro="Tell us about your project." />
    <div className="mt-8 max-w-2xl mx-auto rounded-2xl border border-border bg-card p-6">
      <a href={`tel:${CLIENT.phoneE164}`} className="flex items-center gap-2 text-sm text-muted-foreground mb-4"><Phone className="w-4 h-4 text-primary" /> Or call {CLIENT.phone}</a>
      <LeadForm topic="Quote request" />
    </div>
  </Section>;
}
