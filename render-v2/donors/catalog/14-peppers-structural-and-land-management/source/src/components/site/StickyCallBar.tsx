import { Link } from "@/lib/navigation";
import { business } from "@/lib/business";

export function StickyCallBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/20 bg-cream/95 backdrop-blur lg:hidden">
      <div className="grid grid-cols-2">
        <a
          href={`tel:${business.phoneTel}`}
          className="flex items-center justify-center gap-2 border-r border-ink/20 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-ink"
        >
          <span aria-hidden>☎</span> Call
        </a>
        <Link
          to="/contact"
          className="flex items-center justify-center gap-2 bg-ink py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-cream"
        >
          Contact <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
