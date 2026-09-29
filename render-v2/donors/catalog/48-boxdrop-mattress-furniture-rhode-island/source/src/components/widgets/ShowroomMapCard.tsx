import { MapPin, Phone, Navigation } from "lucide-react";
import { business } from "@/data/business";
import { OpenNowPill } from "@/components/site/OpenNowPill";

export function ShowroomMapCard() {
  if(!business.mapDirectionsUrl)return null;
  return (
    <div className="card-elevate overflow-hidden">
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-lg font-extrabold">{business.shortName}</p>
          <OpenNowPill />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {business.address.streetAddress}, {business.address.addressLocality}, {business.address.addressRegion} {business.address.postalCode}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={`tel:${business.telephone}`}
            data-event="click_call"
            className="inline-flex items-center gap-1.5 rounded-full btn-glow px-4 py-2 text-sm font-bold"
          >
            <Phone className="h-4 w-4" /> {business.displayPhone}
          </a>
          <a
            href={business.mapDirectionsUrl}
            target="_blank"
            rel="noreferrer"
            data-event="click_directions"
            className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 px-4 py-2 text-sm font-semibold"
          >
            <Navigation className="h-4 w-4" /> Directions
          </a>
        </div>
      </div>
    </div>
  );
}
