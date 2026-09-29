import { useSite } from "@/lib/wss";
import { MapPin, Phone, Mail, Clock, Navigation } from "lucide-react";

export function Footer() {
  const {client, area, hours, emailHref, googleMaps, appleMaps, plan} = useSite();
  return (
    <footer id="contact" className="relative border-t border-line bg-cream">
      {/* Contact strip */}
      <div className="border-b border-line/70 bg-paper">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-6 text-sm sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <ContactItem icon={Phone} label="Call">
            <a href={client.identity.phoneTel} className="font-semibold text-ink hover:text-clay">{client.identity.phoneDisplay}</a>
          </ContactItem>
          {emailHref && <ContactItem icon={Mail} label="Email">
            <a href={emailHref} className="font-medium text-ink hover:text-clay break-all">
              {client.identity.email}
            </a>
          </ContactItem>}
          {hours && <ContactItem icon={Clock} label="Hours">
            <span className="font-medium text-ink">{hours}</span>
          </ContactItem>}
          <ContactItem icon={MapPin} label="Area">
            <span className="font-medium text-ink">{area}</span>
          </ContactItem>
        </div>
      </div>

      {/* Editorial contact strip with map buttons + mini satellite */}
      {googleMaps && <div className="border-b border-line">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-8 flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">Directions</div>
              <div className="mt-1 text-ink">{area}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={googleMaps}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-cream hover:bg-clay"
              >
                <MapPin className="h-4 w-4" /> Google Maps
              </a>
              {appleMaps && <a
                href={appleMaps}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-ink/20 px-4 py-2.5 text-sm font-medium text-ink hover:border-ink/50"
              >
                <Navigation className="h-4 w-4" /> Apple Maps
              </a>}
            </div>
          </div>
        </div>
      </div>}

      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 lg:grid-cols-12 lg:px-8">
        <div className="lg:col-span-6">
          <div className="flex items-start gap-5">
            <div className="grid h-[96px] w-[96px] flex-none place-items-center rounded-2xl bg-paper ring-1 ring-ink/8 shadow-card">
              <img
                src={client.identity.logoOnLight}
                alt={client.identity.businessName}
                width={96}
                height={96}
                className="h-[96px] w-[96px] object-contain"
                loading="lazy"
              />
            </div>
            <div>
              <div className="font-display text-2xl text-ink">{client.identity.businessName}</div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
                {area}
              </div>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-ink-soft">
                {client.content.ctaBody || plan.content?.contact}
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-soft">Sections</div>
          <ul className="mt-4 space-y-2 text-sm">
            <li><a href="/#services" className="text-ink hover:text-clay">Services</a></li>
            {client.media.some(m=>m.role==="gallery") && <li><a href="/#gallery" className="text-ink hover:text-clay">Gallery</a></li>}
            {emailHref && <li><a href="/#planner" className="text-ink hover:text-clay">Plan a project</a></li>}
            <li><a href="/#area" className="text-ink hover:text-clay">Service area</a></li>
            <li><a href="/privacy" className="text-ink hover:text-clay">Privacy & trust</a></li>
          </ul>
        </div>

        {client.trust.badges.length > 0 && <div className="lg:col-span-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-soft">Credentials</div>
          <ul className="mt-4 space-y-2 text-sm text-ink-soft">
            {client.trust.badges.map(b=><li key={b.label}>· {b.label} {b.sublabel}</li>)}
          </ul>
        </div>}
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-5 py-5 text-xs text-ink-soft sm:flex-row sm:items-center lg:px-8">
          <span>© {new Date().getFullYear()} {client.identity.businessName} · Serving {area}</span>
          <span className="font-mono tracking-wider">{client.identity.businessName}</span>
        </div>
      </div>
    </footer>
  );
}

function ContactItem({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-cream text-clay ring-1 ring-line">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">{label}</div>
        <div className="mt-0.5 truncate">{children}</div>
      </div>
    </div>
  );
}
