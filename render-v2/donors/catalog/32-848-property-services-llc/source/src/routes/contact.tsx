import { CLIENT, SITE, SERVICES, PLAN } from "@/lib/wss";
import { createFileRoute } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";
import { Phone, Mail, MapPin, Clock, MessageSquare, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
});

export function ContactPage() {
  return (
    <>
      <section className="bg-bone pt-20 pb-12">
        <div className="container-edge">
          <div className="num-badge text-ink/40 mb-3">— Contact</div>
          <h1 className="display-xl max-w-4xl">Let's talk about your project.</h1>
          <p className="mt-6 max-w-2xl text-[17px] text-ink/70 leading-relaxed">
            {PLAN.content?.contact || CLIENT.content.ctaBody}
          </p>
        </div>
      </section>

      <section className="bg-bone pb-28">
        <div className="container-edge grid lg:grid-cols-2 gap-6">
          <BigCTA
            icon={<Phone size={20}/>}
            eyebrow="Call now"
            value={BUSINESS.phone}
            sub={BUSINESS.name}
            href={`tel:${BUSINESS.phoneE164}`}
          />
          {BUSINESS.email && <BigCTA
            icon={<Mail size={20}/>}
            eyebrow="Email"
            value={BUSINESS.email}
            sub="Best for detailed scopes, drawings, or attachments."
            href={`mailto:${BUSINESS.email}`}
          />}
          <div className="bg-bone p-6 border border-ink/10 space-y-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="w-9 h-9 grid place-items-center bg-ink text-volt"><MapPin size={16}/></span>
                <span className="eyebrow text-ink/55">Service area</span>
              </div>
              <div className="font-display text-lg">{BUSINESS.city}, {BUSINESS.state} · {BUSINESS.region}</div>
            </div>
            {BUSINESS.hours && <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="w-9 h-9 grid place-items-center bg-ink text-volt"><Clock size={16}/></span>
                <span className="eyebrow text-ink/55">Hours</span>
              </div>
              <div className="font-display text-lg leading-tight">{BUSINESS.hours}</div>
            </div>}
          </div>
        </div>

        {(CLIENT.trust.mapUrl || CLIENT.trust.bookingUrl) && <div className="container-edge mt-10 flex flex-wrap gap-4">{CLIENT.trust.mapUrl && <a href={CLIENT.trust.mapUrl} className="btn-ghost-ink">View business map ↗</a>}{CLIENT.trust.bookingUrl && <a href={CLIENT.trust.bookingUrl} className="btn-volt">Book a project ↗</a>}</div>}
      </section>
    </>
  );
}

function BigCTA({ icon, eyebrow, value, sub, href }:{ icon:React.ReactNode; eyebrow:string; value:string; sub:string; href:string }) {
  return (
    <a href={href} className="group block bg-ink text-bone p-8 border border-ink hover:bg-volt hover:text-ink transition-colors">
      <div className="flex items-center justify-between mb-4">
        <span className="w-11 h-11 grid place-items-center bg-bone/10 group-hover:bg-ink/10 text-volt group-hover:text-ink">{icon}</span>
        <ArrowUpRight size={22} className="opacity-60 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="eyebrow text-volt group-hover:text-ink/70 mb-2">{eyebrow}</div>
      <div className="font-display text-2xl md:text-3xl leading-tight">{value}</div>
      <div className="mt-3 text-[13px] text-bone/70 group-hover:text-ink/70 leading-snug">{sub}</div>
    </a>
  );
}
