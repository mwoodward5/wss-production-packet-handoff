import { RouteLink } from "./RouteLink";
import { ChevronRight, Home } from "lucide-react";

export function BreadcrumbBar({ label }: { label: string }) {
  return (
    <nav aria-label="Breadcrumb" className="border-b border-border bg-secondary/30">
      <ol className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 text-xs font-medium text-muted-foreground">
        <li>
          <RouteLink to="/" className="inline-flex items-center gap-1 hover:text-brand">
            <Home className="h-3.5 w-3.5" /> Home
          </RouteLink>
        </li>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" />
        <li className="truncate font-semibold text-foreground">{label}</li>
      </ol>
    </nav>
  );
}
