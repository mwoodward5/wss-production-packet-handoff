import { Link } from "@/lib/navigation";
import { business } from "@/lib/business";

/**
 * Mid-section lead-capture CTAs.
 *
 * Variants are intentionally distinct so the same visitor sees several
 * different "shapes" of next-step as they read. Each has:
 *   - a unique microcopy line (no repeated CTA strings)
 *   - a primary action (form, call, or specific page)
 *   - a secondary, lighter touch
 *
 * Visual variants:
 *   - rail   : thin horizontal bar (good between content blocks)
 *   - card   : small inline card (good in a sidebar or grid gap)
 *   - banner : full-width tinted banner with image-free emphasis
 *   - quiet  : ultra-minimal one-liner (good for after long-form copy)
 */

type Variant = "rail" | "card" | "banner" | "quiet";

type Props = {
  variant?: Variant;
  /** Short eyebrow tag, e.g. "[ Estimate · 1 business day ]". */
  eyebrow: string;
  /** Headline microcopy. Keep it specific and verb-led. */
  headline: React.ReactNode;
  /** Subline that explains the next step in plain language. */
  subline?: string;
  /** Primary action — uses the typed router Link. Optional `search` deep-links query params (e.g. service / city) into the target page. */
  primary: { label: string; to: string; search?: Record<string, string> };
  /** Optional secondary action — `tel:` or another route. */
  secondary?:
    | { label: string; tel: true }
    | { label: string; to: string; search?: Record<string, string> }
    | { label: string; href: string };
  /** Optional accent: e.g. "Ottawa County · Today" timestamp-style chip. */
  accent?: string;
};

export function LeadCTA({
  variant = "rail",
  eyebrow,
  headline,
  subline,
  primary,
  secondary,
  accent,
}: Props) {
  const Secondary = () => {
    if (!secondary) return null;
    if ("tel" in secondary) {
      return (
        <a href={`tel:${business.phoneTel}`} className="btn-ghost">
          ☎ {business.phone}
        </a>
      );
    }
    if ("href" in secondary) {
      return (
        <a href={secondary.href} className="btn-ghost">
          {secondary.label}
        </a>
      );
    }
    return (
      <Link to={secondary.to as never} search={secondary.search as never} className="btn-ghost">
        {secondary.label}
      </Link>
    );
  };

  if (variant === "rail") {
    return (
      <aside className="border-y border-rule bg-bone">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:px-10">
          <div className="flex-1">
            <p className="eyebrow">{eyebrow}</p>
            <h3 className="mt-2 font-display text-2xl leading-snug text-ink lg:text-3xl">
              {headline}
            </h3>
            {subline && (
              <p className="mt-2 max-w-2xl text-sm text-charcoal/75">{subline}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
            {accent && (
              <span className="hidden lg:inline-block font-mono text-[10px] uppercase tracking-[0.22em] text-amber-glow">
                ◆ {accent}
              </span>
            )}
            <Link to={primary.to as never} search={primary.search as never} className="btn-primary whitespace-nowrap">
              {primary.label}
            </Link>
            <Secondary />
          </div>
        </div>
      </aside>
    );
  }

  if (variant === "banner") {
    return (
      <section className="border-y border-rule bg-ink text-cream">
        <div className="mx-auto grid max-w-[1400px] gap-8 px-5 py-14 lg:grid-cols-12 lg:items-center lg:px-10 lg:py-20">
          <div className="lg:col-span-8">
            <p className="eyebrow text-amber-glow">{eyebrow}</p>
            <h3 className="mt-3 font-display text-3xl leading-tight text-cream lg:text-4xl">
              {headline}
            </h3>
            {subline && (
              <p className="mt-4 max-w-2xl text-cream/75">{subline}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:col-span-4 lg:justify-end">
            <Link
              to={primary.to as never}
              search={primary.search as never}
              className="bg-amber-glow px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-cream hover:bg-clay hover:text-cream"
            >
              {primary.label}
            </Link>
            {secondary &&
              ("tel" in secondary ? (
                <a
                  href={`tel:${business.phoneTel}`}
                  className="border border-cream/30 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-cream hover:border-amber-glow hover:text-amber-glow"
                >
                  ☎ {business.phone}
                </a>
              ) : "href" in secondary ? (
                <a
                  href={secondary.href}
                  className="border border-cream/30 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-cream hover:border-amber-glow hover:text-amber-glow"
                >
                  {secondary.label}
                </a>
              ) : (
                <Link
                  to={secondary.to as never}
                  search={(secondary as { search?: Record<string, string> }).search as never}
                  className="border border-cream/30 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-cream hover:border-amber-glow hover:text-amber-glow"
                >
                  {secondary.label}
                </Link>
              ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === "card") {
    return (
      <aside className="border border-rule bg-cream p-6 shadow-deep lg:p-8">
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="mt-3 font-display text-2xl leading-snug text-ink">
          {headline}
        </h3>
        {subline && (
          <p className="mt-3 text-sm text-charcoal/75">{subline}</p>
        )}
        {accent && (
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-umber">
            ◆ {accent}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to={primary.to as never} search={primary.search as never} className="btn-primary">
            {primary.label}
          </Link>
          <Secondary />
        </div>
      </aside>
    );
  }

  // quiet
  return (
    <p className="mx-auto max-w-3xl border-y border-rule bg-cream py-6 text-center text-sm text-charcoal/80">
      <span className="eyebrow inline-flex">{eyebrow}</span>{" "}
      <span className="ml-2 font-display text-lg text-ink">{headline}</span>{" "}
      <Link
        to={primary.to as never}
        search={primary.search as never}
        className="ml-3 link-underline font-mono text-[11px] uppercase tracking-[0.22em] text-ink"
      >
        {primary.label} →
      </Link>
    </p>
  );
}
