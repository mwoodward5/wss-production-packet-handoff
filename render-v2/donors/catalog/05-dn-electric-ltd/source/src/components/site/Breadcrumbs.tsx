import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Visible breadcrumb trail. Render directly inside the page (after hero or
 * at top of main content). JSON-LD BreadcrumbList is emitted separately in
 * each route's head().
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mx-auto max-w-7xl px-5 pt-6 md:px-8"
    >
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {c.to && !last ? (
                <Link
                  to={c.to}
                  className="hover:text-foreground underline-offset-4 hover:underline"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  className={last ? "font-medium text-foreground" : undefined}
                  aria-current={last ? "page" : undefined}
                >
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight className="h-3 w-3 opacity-50" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
