import { WSS, pageCopy } from '@/wss/bridge';

import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader } from "@/components/site/Sections";
import { BreadcrumbSchema, LocalBusinessSchema } from "@/components/site/Schema";
import { LeadForm } from "@/components/site/LeadForm";
import { CLIENT, absoluteUrl } from "@/config";
import { Phone, Mail, MapPin } from "lucide-react";

export function ContactPage() {
  return (
    <SiteLayout>
      <LocalBusinessSchema />
      <BreadcrumbSchema items={[
        { name: "Home", url: absoluteUrl("/") },
        { name: "Contact", url: absoluteUrl("/contact") },
      ]} />

      <Section>
        <SectionHeader
          eyebrow="Contact"
          title="Contact us about RV service"
          intro={pageCopy("contact", "Call to discuss your service needs.")}
        />

        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 items-start mt-8">
          <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
            <h2 className="font-serif text-2xl font-semibold mb-4">Request scheduled service</h2>
            <LeadForm topic="Contact Page" cta="Send Request" />
          </div>

          <div className="grid gap-4">
            <a href={`tel:${CLIENT.phoneE164}`} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5 hover:bg-muted/40 transition">
              <Phone className="w-5 h-5 mt-1 text-primary" />
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Call</div>
                <div className="font-semibold text-lg">{CLIENT.phone}</div>
              </div>
            </a>
            {CLIENT.email && <a href={`mailto:${CLIENT.email}`} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5 hover:bg-muted/40 transition">
              <Mail className="w-5 h-5 mt-1 text-primary" />
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Email</div>
                <div className="font-semibold">{CLIENT.email}</div>
              </div>
            </a>
            }
            {WSS.trust.areas.length > 0 && <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5">
              <MapPin className="w-5 h-5 mt-1 text-primary" />
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Service area</div>
                <div className="font-semibold">{CLIENT.serviceAreaLabel}</div>
                <div className="text-sm text-muted-foreground mt-1"></div>
              </div>
            </div>}
          </div>
        </div>
      </Section>
    </SiteLayout>
  );
}
