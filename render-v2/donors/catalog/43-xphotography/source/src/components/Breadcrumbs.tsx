import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useSite } from "@/wss/bridge";

export interface Crumb { name: string; path: string; }

export default function Breadcrumbs({ trail, hideVisual }: { trail: Crumb[]; hideVisual?: boolean }) {
  const {client}=useSite();
  const BRAND={url:client.identity.website.replace(/\/$/, "")};
  const items = [{ name: "Home", path: "/" }, ...trail];
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: new URL(c.path, BRAND.url).href,
    })),
  };
  return (
    <>
      <Helmet><script type="application/ld+json">{JSON.stringify(ld)}</script></Helmet>
      {!hideVisual && (
        <nav aria-label="Breadcrumb" className="container pt-32 pb-2">
          <ol className="flex flex-wrap items-center gap-2 label-eyebrow text-ivory/50">
            {items.map((c, i) => (
              <li key={c.path} className="flex items-center gap-2">
                {i > 0 && <span className="text-ivory/30">/</span>}
                {i === items.length - 1
                  ? <span className="text-molten">{c.name}</span>
                  : <Link to={c.path} className="hover:text-molten">{c.name}</Link>}
              </li>
            ))}
          </ol>
        </nav>
      )}
    </>
  );
}
