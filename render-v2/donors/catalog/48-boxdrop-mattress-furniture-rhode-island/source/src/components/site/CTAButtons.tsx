import { RouteLink } from "./RouteLink";
import { business } from "@/data/business";
import { client } from "@/wss/bridge";

type Variant = "primary" | "ghost" | "outline";

const variantClass: Record<Variant, string> = {
  primary:
    "btn-glow btn-beam text-brand-foreground",
  ghost:
    "bg-foreground/5 text-foreground hover:bg-foreground/10",
  outline:
    "border border-foreground/20 text-foreground hover:bg-foreground/5 backdrop-blur",
};

function base(v: Variant) {
  return `inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition ${variantClass[v]}`;
}

export function CallButton({ variant = "primary" as Variant, label }: { variant?: Variant; label?: string }) {
  return (
    <a
      href={`tel:${business.telephone}`}
      data-event="click_call"
      className={base(variant)}
    >
      {label ?? `Call ${business.displayPhone}`}
    </a>
  );
}

export function TextButton({ variant = "ghost" as Variant, label }: { variant?: Variant; label?: string }) {
  return (
    <a href={business.smsHref} data-event="click_sms" className={base(variant)}>
      {label ?? "Text to check inventory"}
    </a>
  );
}

export function DirectionsButton({ variant = "outline" as Variant }: { variant?: Variant }) {
  if(!business.mapDirectionsUrl)return null;
  return (
    <a
      href={business.mapDirectionsUrl}
      target="_blank"
      rel="noreferrer"
      data-event="click_directions"
      className={base(variant)}
    >
      Get directions
    </a>
  );
}

export function FinancingButton({variant}: {variant?:Variant}) {return null;}

export function InventoryButton({ variant = "ghost" as Variant }: { variant?: Variant }) {
  return (
    <a
      href={business.smsHref}
      data-event="check_inventory"
      className={base(variant)}
    >
      Check today's inventory
    </a>
  );
}

export function BookVisitButton({ variant = "outline" as Variant }: { variant?: Variant }) {
  if (!client.trust.bookingUrl) return null;
  return (
    <a
      href={client.trust.bookingUrl}
      data-event="book_visit"
      className={base(variant)}
    >
      Book a showroom visit
    </a>
  );
}

export function PrimaryCTARow() {
  return (
    <div className="flex flex-wrap gap-2">
      <CallButton />
      <TextButton />
      <DirectionsButton />
    </div>
  );
}
