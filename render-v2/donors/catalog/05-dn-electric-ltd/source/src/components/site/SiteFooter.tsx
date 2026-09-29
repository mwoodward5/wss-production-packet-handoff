import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";
import { BUSINESS, SERVICES } from "@/lib/business";
import { Phone, Mail, MapPin, Clock } from "lucide-react";

import { getClient } from "@/lib/wss-client";
export function SiteFooter() {
  const client = getClient();
  return (
    <footer className="bg-[var(--ink)] text-[var(--bone)] noise">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:grid-cols-12 md:px-8">
        <div className="md:col-span-4 space-y-5">
          <div className="[&_*]:text-[var(--bone)]">
            <Logo onDark />
          </div>
          <p className="text-sm text-[var(--bone)]/70 max-w-xs">
            {client.content.serviceIntro}
          </p>
        </div>

        <div className="md:col-span-3">
          <div className="eyebrow text-[var(--gold)] mb-4">Services</div>
          <ul className="space-y-2.5 text-sm">
            {SERVICES.map((s) => (
              <li key={s.slug}>
                <Link
                  to={s.href}
                  className="text-[var(--bone)]/80 hover:text-[var(--gold)] transition-colors"
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-3">
          <div className="eyebrow text-[var(--gold)] mb-4">Visit · Call · Email</div>
          <ul className="space-y-3 text-sm text-[var(--bone)]/80">
            <li className="flex items-start gap-3">
              <MapPin className="h-4 w-4 mt-0.5 text-[var(--gold)]" />
              <span>
                {BUSINESS.city}, {BUSINESS.state} {BUSINESS.zip}
                <br />
                {BUSINESS.serviceArea && <span className="text-[var(--bone)]/55 text-xs">{BUSINESS.serviceArea}</span>}
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Phone className="h-4 w-4 mt-0.5 text-[var(--gold)]" />
              <a href={BUSINESS.phoneHref} className="hover:text-[var(--gold)]">
                {BUSINESS.phone}
              </a>
            </li>
{BUSINESS.email && (            <li className="flex items-start gap-3">
              <Mail className="h-4 w-4 mt-0.5 text-[var(--gold)]" />
              <a href={`mailto:${BUSINESS.email}`} className="hover:text-[var(--gold)]">
                {BUSINESS.email}
              </a>
            </li>)}
          </ul>
        </div>

{BUSINESS.hours.length > 0 && (        <div className="md:col-span-2">
          <div className="eyebrow text-[var(--gold)] mb-4 inline-flex items-center gap-2">
            <Clock className="h-3 w-3" /> Hours
          </div>
          <ul className="space-y-2 text-sm text-[var(--bone)]/80">
            {BUSINESS.hours.map((h) => (
              <li key={h.day}>
                <div className="text-[var(--bone)]">{h.day}</div>
                <div className="text-[var(--bone)]/55 text-xs">{h.hours}</div>
              </li>
            ))}
          </ul>
        </div>)}
      </div>

      <div className="border-t border-[var(--bone)]/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-5 pt-5 pb-28 text-xs text-[var(--bone)]/55 sm:pb-5 md:flex-row md:px-8">
          <div>© {new Date().getFullYear()} {BUSINESS.name}. All rights reserved.</div>

          <div className="font-mono uppercase tracking-widest">
            {BUSINESS.region}
          </div>
        </div>
      </div>
    </footer>
  );
}
