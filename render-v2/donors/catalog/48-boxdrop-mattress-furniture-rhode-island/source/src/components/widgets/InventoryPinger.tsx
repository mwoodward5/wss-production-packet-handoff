import {client} from "@/wss/bridge";
import { useMemo, useState } from "react";
import { business } from "@/data/business";
import { MessageSquare, PackageSearch } from "lucide-react";

const SIZES = client.services.map(s=>s.name);
const STYLES = ["Availability", "Price", "Visit"];

export function InventoryPinger() {
  const [size, setSize] = useState(SIZES[0]);
  const [style, setStyle] = useState(STYLES[0]);

  const href = useMemo(() => {
    const body = encodeURIComponent(`Hi ${business.name} — I have a question about ${size}: ${style}.`);
    return `sms:${business.telephone}?body=${body}`;
  }, [size, style]);

  return (
    <div className="card-elevate p-6">
      <div className="flex items-center gap-2">
        <PackageSearch className="h-5 w-5 text-brand" />
        <p className="eyebrow !text-brand !tracking-[0.18em]">Inventory Pinger</p>
      </div>
      <h3 className="mt-2 text-2xl font-bold">Is it in stock today?</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Prepare a question for the showroom.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Product</span>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Question</span>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {STYLES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <a
        href={href}
        data-event="check_inventory"
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-full btn-glow px-5 py-3 text-sm font-bold"
      >
        <MessageSquare className="h-4 w-4" /> Text "{size} {style}" to the showroom
      </a>
    </div>
  );
}
