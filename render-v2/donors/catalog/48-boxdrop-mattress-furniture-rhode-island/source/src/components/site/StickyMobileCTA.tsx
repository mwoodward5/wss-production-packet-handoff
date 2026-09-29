import { Phone, MessageSquare, MapPin, CreditCard, PackageSearch } from "lucide-react";
import { business } from "@/data/business";

type Item = {
  href: string;
  event: string;
  label: string;
  Icon: typeof Phone;
  external?: boolean;
  highlight?: boolean;
};

const items: Item[] = [
  { href: `tel:${business.telephone}`, event: "click_call", label: "Call", Icon: Phone, highlight: true },
  { href: business.smsHref, event: "click_sms", label: "Text", Icon: MessageSquare },
  { href: business.mapDirectionsUrl || "/about", event: "click_directions", label: business.mapDirectionsUrl ? "Map" : "About", Icon: MapPin, external: true },
  { href: "/contact", event: "contact", label: "Contact", Icon: CreditCard },
  { href: business.smsHref, event: "check_inventory", label: "In Stock?", Icon: PackageSearch },
];

export function StickyMobileCTA() {
  return (
    <nav
      aria-label="Quick contact actions"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-5">
        {items.map(({ href, event, label, Icon, external, highlight }) => (
          <li key={label} className="relative">
            <a
              href={href}
              data-event={event}
              {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10.5px] font-bold ${
                highlight ? "text-brand" : "text-foreground"
              }`}
            >
              {highlight && <span className="pulse-ring absolute inset-1 rounded-xl" aria-hidden />}
              <Icon className={`h-5 w-5 ${highlight ? "text-brand" : "text-foreground/80"}`} aria-hidden />
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
