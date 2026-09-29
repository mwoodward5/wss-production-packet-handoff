import { useSite } from "@/lib/wss";
import { MapPin, Navigation, Compass } from "lucide-react";

export function ServiceArea() {
  const {client, area, hours, emailHref, googleMaps, appleMaps, plan} = useSite();
  return (
    <section id="area" className="relative bg-paper py-24">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 lg:grid-cols-12 lg:px-8">
        <div className="lg:col-span-5">
          <p className="eyebrow">Service area</p>
          <h2 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl lg:text-5xl">
            <span className="italic text-clay">{area}</span>
          </h2>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-ink-soft">
            {plan.content?.["service-area"] || "Call to discuss your project location."}
          </p>

          {googleMaps && <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={googleMaps}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-cream shadow-card transition hover:bg-clay"
            >
              <MapPin className="h-4 w-4" /> Directions · Google Maps
            </a>
            {appleMaps && <a
              href={appleMaps}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-ink/20 px-5 py-3 text-sm font-medium text-ink hover:border-ink/50"
            >
              <Navigation className="h-4 w-4" /> Directions · Apple Maps
            </a>}
          </div>}

          <dl className="mt-10 grid grid-cols-2 gap-y-5 gap-x-6 border-t border-line pt-6 text-sm">
            {hours && <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-soft">Hours</dt>
              <dd className="mt-1 text-ink">{hours}</dd>
            </div>}
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-soft">Phone</dt>
              <dd className="mt-1">
                <a href={client.identity.phoneTel} className="text-ink hover:text-clay">{client.identity.phoneDisplay}</a>
              </dd>
            </div>
            {emailHref && <div className="col-span-2">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-soft">Email</dt>
              <dd className="mt-1">
                <a
                  href={emailHref}
                  className="text-ink hover:text-clay break-all"
                >
                  {client.identity.email}
                </a>
              </dd>
            </div>}
          </dl>
        </div>

        <div className="lg:col-span-7"><div className="rounded-2xl border border-line bg-cream p-8"><p className="eyebrow">About</p>{client.content.whyHeadline && <h2 className="mt-3 font-display text-3xl text-ink">{client.content.whyHeadline}</h2>}<p className="mt-5 text-sm leading-relaxed text-ink-soft">{client.content.about}</p>{client.content.values.map(v=><div key={v.title} className="mt-6 border-t border-line pt-5"><h3 className="font-display text-xl">{v.title}</h3><p className="mt-2 text-sm text-ink-soft">{v.body}</p></div>)}</div></div>
      </div>
    </section>
  );
}
