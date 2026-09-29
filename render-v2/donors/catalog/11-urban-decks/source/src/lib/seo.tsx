import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { CLIENT } from "@/lib/wss";
import { SITE } from "@/lib/site";
import { breadcrumbsJsonLd } from "@/lib/schema";

export type Crumb = { name: string; path: string };

export function pageHead(opts: {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  extraScripts?: Array<{ type: string; children: string }>;
  crumbs?: Crumb[];
}) {
  const url = `${SITE.url}${opts.path}`;
  const image = opts.image ?? new URL(CLIENT.hero.poster,SITE.url).href;
  const meta = [
    { title: opts.title },
    { name: "description", content: opts.description },
    { property: "og:title", content: opts.title },
    { property: "og:description", content: opts.description },
    { property: "og:url", content: url },
    { property: "og:type", content: opts.type ?? "website" },
    { property: "og:image", content: image },
    { name: "twitter:title", content: opts.title },
    { name: "twitter:description", content: opts.description },
    { name: "twitter:image", content: image },
  ];
  const links = [{ rel: "canonical", href: url }];
  const scripts: Array<{ type: string; children: string }> = [];
  if (opts.crumbs && opts.crumbs.length > 0) {
    scripts.push({
      type: "application/ld+json",
      children: JSON.stringify(
        breadcrumbsJsonLd(opts.crumbs.map((c) => ({ name: c.name, url: `${SITE.url}${c.path}` })))
      ),
    });
  }
  if (opts.extraScripts) scripts.push(...opts.extraScripts.filter(s=>s.children !== 'null'));
  return { meta, links, scripts };
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-ink/55">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={c.path} className="flex items-center gap-1.5">
              {isLast ? (
                <span className="text-ink/80" aria-current="page">{c.name}</span>
              ) : (
                <Link to={c.path as never} className="hover:text-cedar">{c.name}</Link>
              )}
              {!isLast && <ChevronRight className="h-3 w-3 text-ink/40" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
