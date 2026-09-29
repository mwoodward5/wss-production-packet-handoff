import { ShieldCheck, MapPin, Zap, Award } from "lucide-react";

import {client} from "@/lib/site";
const chips=client.trust.badges.map(b=>({...b,icon:Award}));

export function TrustChips({ tone = "light" }: { tone?: "light" | "dark" }) {
  if (!chips.length) return null;
  const cls =
    tone === "dark"
      ? "border-white/15 bg-white/10 text-white/90 backdrop-blur"
      : "border-border bg-card text-muted-foreground";
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <span key={c.label} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${cls}`}>
          <c.icon className="h-3.5 w-3.5 text-gold" />
          {c.label}
        </span>
      ))}
    </div>
  );
}
