import {client} from "@/wss/bridge";
import { business } from "@/data/business";

const items=client.trust.badges.map(b=>b.label);

export function TrustBar() {
  if(!items.length)return null;
  return (
    <section
      aria-label="Business credentials"
      className="border-y border-border bg-secondary/60"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-2 px-4 py-3 text-xs sm:text-sm">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full border border-border bg-background px-3 py-1 font-medium text-foreground/80"
          >
            {item}
          </span>
        ))}
        <a
          href={`tel:${business.telephone}`}
          data-event="click_call"
          className="rounded-full bg-brand px-3 py-1 font-semibold text-brand-foreground"
        >
          {business.displayPhone}
        </a>
      </div>
    </section>
  );
}
