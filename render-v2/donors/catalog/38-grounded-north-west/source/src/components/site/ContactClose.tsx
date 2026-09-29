import { useClient } from "@/lib/wss";
import { Phone, Mail } from "lucide-react";
import { GoogleReviewButton, BbbSeal } from "./ReviewsTrust";

export const ContactClose = ({ heading = "Ready when you are." }: { heading?: string }) => { const c=useClient(); return (
  <section className="container py-24">
    <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-card p-10 md:p-16">
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="relative grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-primary mb-4">Contact</div>
          <h2 className="font-display text-4xl md:text-5xl leading-tight">{c.content.ctaHeadline || heading}</h2>
          <p className="mt-5 text-muted-foreground max-w-md">
            {c.content.ctaBody}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <GoogleReviewButton />
            <BbbSeal />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <a href={c.identity.phoneTel} className="group flex items-center justify-between rounded-2xl border border-border bg-background/40 p-6 hover:border-primary transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-copper grid place-items-center text-primary-foreground"><Phone className="w-5 h-5" /></div>
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Call</div>
                <div className="font-display text-2xl">{c.identity.phoneDisplay}</div>
              </div>
            </div>
            <span className="text-primary text-sm">Tap →</span>
          </a>
          {c.identity.email && <a href={"mailto:" + c.identity.email} className="group flex items-center justify-between rounded-2xl border border-border bg-background/40 p-6 hover:border-primary transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-copper grid place-items-center text-primary-foreground"><Mail className="w-5 h-5" /></div>
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Email</div>
                <div className="font-display text-xl break-all">{c.identity.email}</div>
              </div>
            </div>
            <span className="text-primary text-sm">Email →</span>
          </a>}
          {c.trust.bookingUrl && <a href={c.trust.bookingUrl} className="rounded-2xl border border-border bg-background/40 p-6 hover:border-primary transition-colors">Book an appointment</a>}
        </div>
      </div>
    </div>
  </section>
); };
