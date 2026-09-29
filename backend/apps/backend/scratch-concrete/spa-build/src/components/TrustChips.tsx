import { ShieldCheck, MapPin, Zap, Star } from "lucide-react";
import { useLiveAreas, useLiveIdentity, useLiveServices } from "@/lib/wssc";

/**
 * TRUST LAW: a chip renders only when it is COMPOSED (a count over verified
 * services/areas) or EVIDENCE (a verified license or rating pair). "Licensed &
 * Insured", "Same-Week Quotes" and donor geography were the source business's
 * own claims — published evidence or nothing.
 */
export function TrustChips({ tone = "light" }: { tone?: "light" | "dark" }) {
  const id = useLiveIdentity();
  const areas = useLiveAreas();
  const serviceLines = useLiveServices();

  const cls =
    tone === "dark"
      ? "border-white/15 bg-white/10 text-white/90 backdrop-blur"
      : "border-border bg-card text-muted-foreground";

  const chips: { icon: typeof MapPin; label: string }[] = [];
  chips.push({ icon: MapPin, label: areas.length > 1 ? `${areas.length} Areas Served` : `${id.city}, ${id.state}` });
  if (serviceLines.length > 1) chips.push({ icon: Zap, label: `${serviceLines.length} Service Lines` });
  if (id.license) chips.push({ icon: ShieldCheck, label: id.license.split(/[+,]/)[0].trim().slice(0, 30) });
  if (id.rating && id.reviewCount) chips.push({ icon: Star, label: `${id.rating} from ${id.reviewCount} reviews` });

  return (
    <div className="flex flex-wrap gap-2">
      {chips.slice(0, 4).map((c) => (
        <span key={c.label} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${cls}`}>
          <c.icon className="h-3.5 w-3.5 text-gold" />
          {c.label}
        </span>
      ))}
    </div>
  );
}
