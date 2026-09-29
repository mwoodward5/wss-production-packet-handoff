import { Helmet } from "react-helmet-async";
import { useSite } from "@/wss/bridge";

interface Props {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  type?: "website" | "article" | "profile";
  noindex?: boolean;
}

export default function Seo({ title, description, path, ogImage, type = "website", noindex }: Props) {
  const {client}=useSite();
  const BRAND={url:client.identity.website,name:client.identity.businessName};
  const url = new URL(path, BRAND.url).href;
  const image = new URL(ogImage || client.hero.poster, BRAND.url).href;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta name="robots" content={noindex ? "noindex,nofollow" : "index,follow"} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={type} />
      <meta property="og:image" content={image} />
      <meta property="og:site_name" content={BRAND.name} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  );
}
