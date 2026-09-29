import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useClient } from "@/lib/wss";

interface Props {
  title: string;
  description: string;
  path: string;
  schema?: object | object[];
  children?: React.ReactNode;
}

export const Seo = ({ title, description, path, schema, children }: Props) => {
  const c=useClient();
  const url = new URL(path,c.identity.website).href;
  const business={"@context":"https://schema.org","@type":"ElectricalContractor",name:c.identity.businessName,url:c.identity.website,telephone:c.identity.phoneTel.slice(4),...(c.identity.email?{email:c.identity.email}:{}),areaServed:c.trust.areas,address:{"@type":"PostalAddress",addressLocality:c.identity.city,addressRegion:c.identity.state}};
  const service=c.services.find(s=>s.href===path);
  const supplied=(Array.isArray(schema) ? schema : schema ? [schema] : []).filter(s=>Object.keys(s).length);
  const schemas: object[] = [business,...supplied];
  if(service && !supplied.some(s=>s['@type']==='Service'))schemas.push({"@context":"https://schema.org","@type":"Service",name:service.name,description:service.description,provider:{"@type":"ElectricalContractor",name:c.identity.businessName},url});
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content="website" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json">{JSON.stringify(s).replace(/</g,'\\u003c')}</script>
      ))}
      {children}
    </Helmet>
  );
};

export const localBusinessSchema = {};

export const Breadcrumbs = ({ items }: { items: { name: string; href: string }[] }) => {
  const c=useClient();
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem", position: i + 1, name: it.name, item: new URL(it.href,c.identity.website).href,
    })),
  };
  return (
    <>
      <Helmet><script type="application/ld+json">{JSON.stringify(schema).replace(/</g,'\\u003c')}</script></Helmet>
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <ol className="flex flex-wrap gap-1">
          {items.map((it, i) => (
            <li key={it.href} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              {i < items.length - 1 ? <Link to={it.href} className="hover:text-foreground">{it.name}</Link> : <span className="text-foreground">{it.name}</span>}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
};
