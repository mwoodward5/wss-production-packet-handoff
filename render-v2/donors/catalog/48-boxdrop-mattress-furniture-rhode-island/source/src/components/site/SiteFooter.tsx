import { RouteLink } from "./RouteLink";
import { business } from "@/data/business";
import {client,nav} from "@/wss/bridge";
import { pagesByPath } from "@/data/seoPages";

const categoryLinks=client.services.map(s=>({to:s.href,label:s.name}));
const guideLinks=nav.filter(n=>!client.services.some(s=>s.href===n.to));

export function SiteFooter() {


  return (
    <footer className="border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-4">
        <div className="md:col-span-1">
          <p className="font-display text-xl font-extrabold">{business.shortName}</p>
          <p className="mt-2 text-sm opacity-80">
            {client.content.serviceIntro}
          </p>
          <address className="mt-4 text-sm not-italic opacity-90">
            {business.address.streetAddress}
            <br />
            {business.address.addressLocality}, {business.address.addressRegion}{" "}
            {business.address.postalCode}
          </address>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <a
              href={`tel:${business.telephone}`}
              data-event="click_call"
              className="rounded-full bg-brand px-4 py-2 font-semibold text-brand-foreground"
            >
              Call {business.displayPhone}
            </a>
            <a
              href={business.smsHref}
              data-event="click_sms"
              className="rounded-full border border-primary-foreground/30 px-4 py-2 font-semibold"
            >
              Text
            </a>
            {business.mapDirectionsUrl && <a
              href={business.mapDirectionsUrl}
              data-event="click_directions"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-primary-foreground/30 px-4 py-2 font-semibold"
            >
              Directions
            </a>}
          </div>
          {client.identity.email && <p className="mt-4"><a href={`mailto:${client.identity.email}`}>{client.identity.email}</a></p>}
          {client.trust.hours && typeof client.trust.hours==='object' && 'text' in client.trust.hours && typeof client.trust.hours.text==='string' ? <div className="mt-5"><p className="text-sm font-semibold uppercase">Hours</p><p className="mt-2 text-sm">{client.trust.hours.text}</p></div> : null}
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-wider opacity-80">
            Shop by category
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {categoryLinks.map((c) => (
              <li key={c.to}>
                <RouteLink to={c.to} className="opacity-90 hover:opacity-100 hover:underline">
                  {c.label}
                </RouteLink>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-wider opacity-80">
            Service area
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {client.trust.areas.map(area=><li key={area}>{area}</li>)}
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-wider opacity-80">
            Explore
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {guideLinks.map((g) => (
              <li key={g.to}>
                <RouteLink to={g.to} className="opacity-90 hover:opacity-100 hover:underline">
                  {g.label}
                </RouteLink>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-primary-foreground/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 text-xs opacity-90 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            {client.trust.socials.map((url,i)=><a key={url} href={url} rel="noreferrer" target="_blank">Profile {i+1}</a>)}
          </div>
          <div className="flex flex-wrap gap-4">
            {guideLinks.map(n=><RouteLink key={n.to} to={n.to}>{n.label}</RouteLink>)}
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-4 text-xs opacity-70">
          &copy; {new Date().getFullYear()} {business.name}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
