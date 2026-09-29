import { SITE } from './site';
import { CLIENT } from './wss';
export const localBusinessJsonLd={
 '@context':'https://schema.org','@type':'LocalBusiness','@id':SITE.url+'/#localbusiness',name:SITE.name,url:SITE.url,
 telephone:SITE.phone,...(SITE.email?{email:SITE.email}:{}),description:SITE.shortDescription,
 image:new URL(CLIENT.hero.poster,SITE.url).href,logo:new URL(CLIENT.identity.logoOnLight,SITE.url).href,
 address:{'@type':'PostalAddress',addressLocality:SITE.city,addressRegion:SITE.region},
 areaServed:SITE.serviceArea,hasOfferCatalog:{'@type':'OfferCatalog',name:'Services',itemListElement:SITE.services.map(s=>({'@type':'Service',name:s.title,description:s.summary,url:SITE.url+'/services/'+s.slug}))}
};
export const organizationJsonLd={'@context':'https://schema.org','@type':'Organization',name:SITE.name,url:SITE.url,logo:new URL(CLIENT.identity.logoOnLight,SITE.url).href};
export function breadcrumbsJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

export function faqJsonLd(faqs: Array<{ q: string; a: string }>) {
  if (!faqs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function serviceJsonLd(opts: {
  name: string;
  description: string;
  url: string;
  areaServed?: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    provider: { "@id": `${SITE.url}/#localbusiness` },
    areaServed: (opts.areaServed ?? SITE.serviceArea).map((c) => ({
      "@type": "City",
      name: c,
    })),
    serviceType: opts.name,
  };
}

export function blogPostingJsonLd(opts: {
  title: string;
  description: string;
  url: string;
  image?: string;
  datePublished: string;
  dateModified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: opts.title,
    description: opts.description,
    mainEntityOfPage: opts.url,
    url: opts.url,
    image: opts.image ?? new URL(CLIENT.hero.poster,SITE.url).href,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    author: { "@type": "Organization", name: SITE.name, url: SITE.url },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      logo: { "@type": "ImageObject", url: new URL(CLIENT.identity.logoOnLight,SITE.url).href },
    },
  };
}
