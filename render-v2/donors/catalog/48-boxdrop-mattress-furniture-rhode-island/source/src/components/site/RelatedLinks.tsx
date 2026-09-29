import { RouteLink } from "./RouteLink";
import { getRelatedPages, type SeoPage } from "@/data/seoPages";

export function RelatedLinks({ page }: { page: SeoPage }) {
  const related = getRelatedPages(page);
  if (!related.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <h2 className="text-2xl font-bold">Related pages</h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {related.map((item) => (
          <RouteLink
            key={item.slug}
            to={item.path}
            data-event="category_cta"
            className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition hover:border-brand"
          >
            <span className="text-base font-semibold text-foreground group-hover:text-brand">
              {item.h1}
            </span>
            <span className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
              {item.primaryKeyword}
            </span>
          </RouteLink>
        ))}
      </div>
    </section>
  );
}
