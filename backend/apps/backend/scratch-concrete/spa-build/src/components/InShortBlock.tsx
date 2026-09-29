import { Sparkles } from "lucide-react";

export function InShortBlock({ children }: { children: React.ReactNode }) {
  return (
    <aside data-speakable className="my-8 rounded-2xl border border-gold/40 bg-gradient-to-br from-card to-secondary p-6 shadow-card">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-gold" /> In short
      </div>
      <p className="text-base leading-relaxed text-foreground md:text-lg">{children}</p>
    </aside>
  );
}
