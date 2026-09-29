import { Link } from "@tanstack/react-router";
import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { CLIENT, FULL_ADDRESS, SERVICES, BRAND } from "@/config";
import { DATA } from "@/wss/bridge";

function formatHours(h: typeof CLIENT.hours[keyof typeof CLIENT.hours]): string {
  if (!h) return "";
  if (h === "closed") return "Closed";
  if (h === "24h") return "Open 24h";
  return `${h.open} – ${h.close}`;
}

export function SiteFooter() {
  const hoursText = DATA.trust.hours && typeof DATA.trust.hours === "object" && "text" in DATA.trust.hours && typeof DATA.trust.hours.text === "string" ? DATA.trust.hours.text : "";
  const days: { key: keyof typeof CLIENT.hours; label: string }[] = [
    { key: "monday", label: "Mon" }, { key: "tuesday", label: "Tue" },
    { key: "wednesday", label: "Wed" }, { key: "thursday", label: "Thu" },
    { key: "friday", label: "Fri" }, { key: "saturday", label: "Sat" },
    { key: "sunday", label: "Sun" },
  ];

  return (
    <footer className="mt-24 border-t border-border text-[oklch(0.96_0.012_85)]" style={{ background: "linear-gradient(180deg, oklch(0.32 0.04 135) 0%, oklch(0.22 0.025 140) 100%)" }}>
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-16 grid gap-12 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-3 mb-5">
            <img src={BRAND.logoDark} alt={CLIENT.businessName} className="h-[4.55rem] w-auto" />
            <span className="font-bold tracking-tight">{CLIENT.businessName}</span>
          </div>
          <p className="text-sm text-[oklch(0.92_0.012_85/0.85)] leading-relaxed">{CLIENT.shortDescription}</p>
        </div>

        <div>
          <h4 className="text-sm font-semibold tracking-wider uppercase text-[var(--gold)] mb-4">Services</h4>
          <ul className="space-y-2 text-sm text-[oklch(0.92_0.012_85/0.85)]">
            {SERVICES.map((s) => (
              <li key={s.slug}><Link to={s.route} className="hover:text-white">{s.name}</Link></li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold tracking-wider uppercase text-[var(--gold)] mb-4">Company</h4>
          <ul className="space-y-2 text-sm text-[oklch(0.92_0.012_85/0.85)]">
            <li><Link to="/services" className="hover:text-white">All Services</Link></li>
            <li><Link to="/contact" className="hover:text-white">Contact</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold tracking-wider uppercase text-[var(--gold)] mb-4">Get In Touch</h4>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3 text-[oklch(0.92_0.012_85/0.9)]">
              <Phone className="w-4 h-4 mt-0.5 text-[var(--gold)]" />
              <a href={`tel:${CLIENT.phoneE164}`} className="hover:text-white">{CLIENT.phone}</a>
            </li>
            {CLIENT.email && <li className="flex items-start gap-3 text-[oklch(0.92_0.012_85/0.9)]">
              <Mail className="w-4 h-4 mt-0.5 text-[var(--gold)]" />
              <a href={`mailto:${CLIENT.email}`} className="hover:text-white break-all">{CLIENT.email}</a>
            </li>}
            <li className="flex items-start gap-3 text-[oklch(0.92_0.012_85/0.9)]">
              <MapPin className="w-4 h-4 mt-0.5 text-[var(--gold)]" /><span>{FULL_ADDRESS}</span>
            </li>
            {(hoursText || Object.keys(CLIENT.hours).length > 0) && <li className="flex items-start gap-3 text-[oklch(0.92_0.012_85/0.9)]">
              <Clock className="w-4 h-4 mt-0.5 text-[var(--gold)]" />
              <div className="text-xs">
                {hoursText && <p>{hoursText}</p>}
                {days.filter((d) => CLIENT.hours[d.key]).map((d) => (
                  <div key={d.key} className="flex justify-between gap-3 min-w-[12rem]">
                    <span>{d.label}</span><span>{formatHours(CLIENT.hours[d.key])}</span>
                  </div>
                ))}
              </div>
            </li>}
          </ul>
        </div>
      </div>

      <div className="border-t border-[oklch(1_0_0/0.12)]">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-6 text-xs text-[oklch(0.88_0.012_85/0.7)]">
          © {new Date().getFullYear()} {CLIENT.businessName}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
