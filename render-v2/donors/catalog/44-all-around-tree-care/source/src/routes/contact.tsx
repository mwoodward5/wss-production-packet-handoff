import { DATA } from "@/wss/bridge";

import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader } from "@/components/site/Sections";
import { LocalBusinessSchema, SpeakableSchema, BreadcrumbSchema } from "@/components/site/Schema";
import { GoogleMapEmbed, GoogleReviewsCard } from "@/components/site/GoogleBusiness";
import { NativeMapLinks, mapEmbedUrl } from "@/components/site/NativeMapLinks";
import { Phone, Mail, MapPin, Clock, MessageSquare } from "lucide-react";
import { LeadForm } from "@/components/site/LeadForm";
import { VerticalWidget } from "@/components/site/VerticalWidget";
import { CLIENT, FULL_ADDRESS, absoluteUrl } from "@/config";



export function ContactPage() {
  const sms = CLIENT.smsE164;
  return (
    <SiteLayout>
      <LocalBusinessSchema />
      <SpeakableSchema url={absoluteUrl("/contact")} />
      <BreadcrumbSchema items={[
        { name: "Home", url: absoluteUrl("/") },
        { name: "Contact", url: absoluteUrl("/contact") },
      ]} />

      <Section>
        <h1 className="text-4xl md:text-5xl font-bold leading-[1.1] max-w-3xl">Contact us</h1>
        <p className="mt-5 text-lg text-muted-foreground max-w-2xl">Call {CLIENT.businessName} or use the contact form below.</p>
      </Section>

      <Section className="!pt-2">
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10">
          <div className="grid sm:grid-cols-2 gap-5">
            <a href={`tel:${CLIENT.phoneE164}`} className="rounded-2xl border border-border bg-white p-6 hover:bg-muted/40">
              <Phone className="w-6 h-6 text-primary mb-3" />
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Phone</div>
              <div className="text-xl font-bold mt-1">{CLIENT.phone}</div>
            </a>
            {sms && <a href={`sms:${sms}`} className="rounded-2xl border border-border bg-white p-6 hover:bg-muted/40">
              <MessageSquare className="w-6 h-6 text-primary mb-3" />
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Text</div>
              <div className="text-xl font-bold mt-1">{CLIENT.phone}</div>
            </a>}
            {CLIENT.email && <a href={`mailto:${CLIENT.email}`} className="rounded-2xl border border-border bg-white p-6 hover:bg-muted/40 sm:col-span-2">
              <Mail className="w-6 h-6 text-primary mb-3" />
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Email</div>
              <div className="text-lg font-bold mt-1 break-all">{CLIENT.email}</div>
            </a>}
            <div className="rounded-2xl border border-border bg-white p-6">
              <MapPin className="w-6 h-6 text-primary mb-3" />
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Location</div>
              <div className="text-base font-bold mt-1">{FULL_ADDRESS}</div>
              <NativeMapLinks className="mt-3" />
            </div>
            {CLIENT.serviceAreaLabel && <div className="rounded-2xl border border-border bg-white p-6">
              <Clock className="w-6 h-6 text-primary mb-3" />
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Service Area</div>
              <div className="text-base font-bold mt-1">{CLIENT.serviceAreaLabel}</div>
            </div>}
          </div>

          <div className="rounded-2xl border border-border bg-white p-7">
            <SectionHeader eyebrow="Send a Message" title={<>Tell us about your <span className="text-primary">project</span></>} />
            <LeadForm topic="Contact form" className="mt-6" />
          </div>
        </div>
      </Section>

      <VerticalWidget />

      {(mapEmbedUrl || DATA.trust.aggregate || DATA.trust.reviews.length > 0) && <div style={{ backgroundColor: "#FFFFFF" }}>
        <Section className="!pb-14">
          {mapEmbedUrl && <>
            <SectionHeader center eyebrow="Location" title={<>Find us on <span className="text-primary">Google Maps</span></>} />
            <div className="mt-8 w-full"><GoogleMapEmbed /></div>
          </>}
          {(DATA.trust.aggregate || DATA.trust.reviews.length > 0) && <div className="mt-8"><GoogleReviewsCard /></div>}
        </Section>
      </div>}
    </SiteLayout>
  );
}
