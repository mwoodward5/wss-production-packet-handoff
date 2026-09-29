import {CLIENT,planCopy} from "@/lib/wss";
import { Seo } from "@/components/Seo";
import { Mail, MapPin, Phone, Clock, ExternalLink } from "lucide-react";
import { BUSINESS, NAP_LINE } from "@/lib/business";
import { localBusinessSchema, organizationSchema } from "@/lib/schema";
import { QuoteForm } from "@/components/sections/QuoteForm";

const Contact = () => {
  return (
    <>
      <Seo
        title={`Contact | ${BUSINESS.name}`}
        description={planCopy("contact") || BUSINESS.name}
        path="/contact"
        schema={[organizationSchema, localBusinessSchema]}
      />

      <section className="bg-gradient-charcoal text-primary-foreground">
        <div className="container-tight py-20 md:py-28">
          <span className="eyebrow text-accent-glow">Contact · Service Area</span>
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Let's talk about your roof.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-primary-foreground/85">
            {planCopy("contact")}
          </p>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="container-tight grid gap-10 lg:grid-cols-[3fr_2fr]">
          <QuoteForm />

          {/* Info */}
          <div className="space-y-5">
            <InfoCard icon={Phone} label="Call">
              <a
                href={`tel:${BUSINESS.phoneTel}`}
                data-event="contact_call_infocard"
                className="font-semibold"
              >
                {BUSINESS.phoneDisplay}
              </a>
            </InfoCard>
            {BUSINESS.email && <InfoCard icon={Mail} label="Email">
              <a
                href={`mailto:${BUSINESS.email}`}
                data-event="contact_email_infocard"
                className="break-all font-semibold"
              >
                {BUSINESS.email}
              </a>
            </InfoCard>}
            <InfoCard icon={MapPin} label="Location">
              <div className="font-semibold">{NAP_LINE}</div>
            </InfoCard>
            {CLIENT.trust.hours && typeof CLIENT.trust.hours==='object' && 'text' in CLIENT.trust.hours && typeof CLIENT.trust.hours.text==='string' && <InfoCard icon={Clock} label="Hours">{CLIENT.trust.hours.text}</InfoCard>}
            {CLIENT.trust.aggregate?.rating != null && CLIENT.trust.aggregate?.count != null && <a href={CLIENT.trust.aggregate.sourceUrl} className="block rounded-xl border border-border bg-card p-5 shadow-card">{CLIENT.trust.aggregate.rating} / 5 · {CLIENT.trust.aggregate.count} reviews</a>}
            {CLIENT.trust.reviews.slice(0,6).map(review=><blockquote key={review.sourceUrl+review.author} className="rounded-xl border border-border bg-card p-5 shadow-card"><p>{review.text}</p><a href={review.sourceUrl} className="mt-3 block font-semibold">{review.author}</a></blockquote>)}
          </div>
        </div>
      </section>

      {/* Service area visual */}
      {BUSINESS.serviceArea.length > 0 && <section className="border-t border-border bg-secondary/40 py-20">
        <div className="container-tight">
          <span className="eyebrow">Where we work</span>
          <h2 className="heading-section mt-3">Service area</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {planCopy("service-area")}
          </p>
          {CLIENT.trust.mapUrl && <a href={CLIENT.trust.mapUrl} className="mt-8 block border border-border bg-card p-6">Map and directions <ExternalLink className="inline h-4 w-4" /></a>}
          <div className="mt-8 grid gap-3 sm:grid-cols-3 md:grid-cols-5">
            {BUSINESS.serviceArea.map((c) => (
              <div key={c} className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm">
                <MapPin className="h-4 w-4 text-accent" /> {c}
              </div>
            ))}
          </div>
        </div>
      </section>}
    </>
  );
};

const InfoCard = ({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) => (
  <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-5 shadow-card">
    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
      <Icon className="h-5 w-5" />
    </div>
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  </div>
);

export default Contact;
