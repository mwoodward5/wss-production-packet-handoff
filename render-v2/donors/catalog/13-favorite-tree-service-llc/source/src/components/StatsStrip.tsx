import { Shield, Clock, Star, BadgeCheck } from "lucide-react";

import { client } from '@/lib/wss-bridge';
const STATS = client.trust.badges.map(b => ({icon:BadgeCheck,value:b.label,label:b.sublabel}));

export function StatsStrip() {
  if (!STATS.length) return null;
  return (
    <section aria-label="Trust and credentials" className="border-y border-border bg-card">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-8">
        {STATS.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <s.icon className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <div className="text-2xl font-bold leading-none text-foreground">{s.value}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
