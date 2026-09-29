import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { cities } from "@/lib/site";

export function CityChips() {
  return (
    <div className="flex flex-wrap gap-2">
      {cities.map((c) => (
        <Link
          key={c.slug}
          to="/service-area"
          hash={c.slug}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-gold hover:text-foreground"
        >
          <MapPin className="h-3 w-3 text-gold" />
          {c.name}
        </Link>
      ))}
    </div>
  );
}
