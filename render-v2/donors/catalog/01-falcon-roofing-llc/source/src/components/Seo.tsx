import { Helmet } from "react-helmet-async";
import { BUSINESS } from "@/lib/business";

interface SeoProps {
  title: string;
  description: string;
  path: string;
  schema?: object | object[];
}

export const Seo = ({ title, description, path, schema }: SeoProps) => {
  const url = `${BUSINESS.url}${path}`;
  const schemas = Array.isArray(schema) ? schema : schema ? [schema] : [];
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={BUSINESS.name} />
      <meta name="twitter:card" content="summary_large_image" />
      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json">{JSON.stringify(s)}</script>
      ))}
    </Helmet>
  );
};
