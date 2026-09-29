import { Link } from "@/lib/navigation";
import {site} from '@/lib/wss';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const ldjson = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: c.to ? `${site.identity.website.replace(/\/$/,'')}${c.to}` : undefined,
    })),
  };

  return (
    <nav aria-label="Breadcrumb" className="border-b border-rule bg-bone/60">
      <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-charcoal/70 lg:px-10">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <span key={i} className="flex items-center gap-2">
              {c.to && !last ? (
                <Link to={c.to} className="hover:text-ink">{c.label}</Link>
              ) : (
                <span className={last ? "text-ink" : ""}>{c.label}</span>
              )}
              {!last && <span aria-hidden className="text-charcoal/30">/</span>}
            </span>
          );
        })}
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ldjson).replace(/</g,'\\u003c') }}
      />
    </nav>
  );
}
