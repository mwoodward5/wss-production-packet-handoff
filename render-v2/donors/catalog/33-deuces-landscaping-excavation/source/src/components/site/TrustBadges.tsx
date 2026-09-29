/**
 * TrustBadges — renders TRUST.badges + TRUST.certifications.
 */
import { TRUST } from "@/config";
import { ShieldCheck } from "lucide-react";

export function TrustBadges() {
  if (TRUST.badges.length === 0 && TRUST.certifications.length === 0) return null;
  return (
    <section className="border-y border-border bg-muted/30">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-10 flex flex-wrap items-center justify-center gap-6">
        {TRUST.badges.map((b) => {
          const inner = b.image ? (
            <img src={b.image} alt={b.label} className="h-12 w-auto opacity-80" />
          ) : (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
              <ShieldCheck className="w-4 h-4 text-primary" /> {b.label}
            </span>
          );
          return b.href ? (
            <a key={b.label} href={b.href} target="_blank" rel="noopener noreferrer" aria-label={b.label}>
              {inner}
            </a>
          ) : (
            <div key={b.label}>{inner}</div>
          );
        })}
        {TRUST.certifications.map((c) => (
          <div key={c} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-primary" /> {c}
          </div>
        ))}
      </div>
    </section>
  );
}
