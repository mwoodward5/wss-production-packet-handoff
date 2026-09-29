import { business } from '../../data/business';
import type { SeoPage } from '../../data/seoPages';
import { absoluteUrl } from '../../data/seoPages';

// TODO(pricing): replace with real per-product prices once an inventory feed exposes them.
// The site is currently "category-only, no live prices" (see public/products-feed.json),
// so we emit a placeholder price to satisfy Google's Product rich-result requirement
// (offers/review/aggregateRating). Keep "0.00" until real prices ship.
const PLACEHOLDER_PRICE = '0.00';

// Canonical URLs for the hardcoded category Products surfaced in LocalBusiness.makesOffer.
// Keys match the display names in the makesOffer list below.
const CATEGORY_URLS: Record<string, string> = {
  'Queen mattresses': `${business.url}/queen-mattresses-rhode-island`,
  'King mattresses': `${business.url}/king-mattresses-rhode-island`,
  'Hybrid mattresses': `${business.url}/hybrid-mattresses-rhode-island`,
  'Memory foam mattresses': `${business.url}/memory-foam-mattresses-rhode-island`,
  'Adjustable bases': `${business.url}/adjustable-bases-rhode-island`,
  Sectionals: `${business.url}/sectionals-rhode-island`,
  Sofas: `${business.url}/sofas-rhode-island`,
  Loveseats: `${business.url}/loveseats-rhode-island`,
  Recliners: `${business.url}/recliners-rhode-island`,
};

const oneYearFromToday = (): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

const defaultOffer = (url: string, price?: string) => ({
  '@type': 'Offer',
  priceCurrency: 'USD',
  price: price ?? PLACEHOLDER_PRICE,
  availability: 'https://schema.org/InStock',
  url,
  priceValidUntil: oneYearFromToday(),
});

interface ProductInput {
  name: string;
  url: string;
  description?: string;
  image?: string | string[];
  brand?: string;
  price?: string;
}

/**
 * Single source of truth for Product JSON-LD. Every Product emitted by the site
 * MUST go through this helper so it always carries a valid `offers` block and
 * passes Google's Product rich-result validation.
 */
export const productSchema = ({ name, url, description, image, brand, price }: ProductInput) => {
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    url,
    offers: defaultOffer(url, price),
  };
  if (description) node.description = description;
  if (image) node.image = image;
  if (brand) node.brand = { '@type': 'Brand', name: brand };
  return node;
};

const baseLocalBusiness = () => ({
  '@context': 'https://schema.org',
  '@type': ['LocalBusiness', 'Store', 'FurnitureStore'],
  '@id': `${business.url}/#localbusiness`,
  name: business.name,
  alternateName: business.shortName,
  url: business.url,
  telephone: business.telephone,
  address: {
    '@type': 'PostalAddress',
    streetAddress: business.address.streetAddress,
    addressLocality: business.address.addressLocality,
    addressRegion: business.address.addressRegion,
    postalCode: business.address.postalCode,
    addressCountry: business.address.addressCountry
  },
  geo: {
    '@type': 'GeoCoordinates',
    latitude: business.address.latitude,
    longitude: business.address.longitude
  },
  areaServed: business.serviceAreas,
  sameAs: [
    business.social.facebook,
    business.social.youtube,
    business.social.yelp,
    business.social.mapquest,
    business.social.googleMaps,
    business.social.booking,
  ].filter(Boolean),
  openingHoursSpecification: business.hours
    .filter((h) => h.opens && h.closes)
    .flatMap((h) => h.days.map((day) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: day,
      opens: h.opens,
      closes: h.closes
    }))),
  makesOffer: {
    '@type': 'OfferCatalog',
    name: 'Mattress and furniture category availability',
    itemListElement: [
      'Queen mattresses', 'King mattresses', 'Hybrid mattresses', 'Memory foam mattresses',
      'Adjustable bases', 'Sectionals', 'Sofas', 'Loveseats', 'Recliners'
    ].map((name) => ({
      '@type': 'Offer',
      availability: 'https://schema.org/InStoreOnly',
      itemOffered: productSchema({ name, url: CATEGORY_URLS[name] ?? business.url }),
    }))
  }
});

const faqSchema = (page: SeoPage) => page.faqs.length ? ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: page.faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: { '@type': 'Answer', text: faq.answer }
  }))
}) : null;

const breadcrumbSchema = (page: SeoPage) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: business.url },
    { '@type': 'ListItem', position: 2, name: page.h1, item: absoluteUrl(page) }
  ]
});

const articleSchema = (page: SeoPage) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: page.title,
  description: page.description,
  mainEntityOfPage: absoluteUrl(page),
  author: { '@type': 'Organization', name: business.name, url: business.url },
  publisher: { '@type': 'Organization', name: business.name, url: business.url },
  datePublished: page.lastmod,
  dateModified: page.lastmod
});

const webpageSchema = (page: SeoPage) => ({
  '@context': 'https://schema.org',
  '@type': page.type === 'guide' ? 'Article' : 'WebPage',
  '@id': `${absoluteUrl(page)}#webpage`,
  url: absoluteUrl(page),
  name: page.title,
  description: page.description,
  about: { '@id': `${business.url}/#localbusiness` },
  primaryImageOfPage: undefined,
  speakable: {
    '@type': 'SpeakableSpecification',
    cssSelector: ['h1', '.answer-block', '.faq-section']
  }
});

const offerCatalogSchema = (page: SeoPage) => ({
  '@context': 'https://schema.org',
  '@type': 'OfferCatalog',
  name: `${page.h1} category guide`,
  url: absoluteUrl(page),
  itemListElement: page.secondaryKeywords.map((keyword) => ({
    '@type': 'Offer',
    name: keyword,
    availability: 'https://schema.org/InStoreOnly',
    itemOffered: productSchema({ name: keyword, url: absoluteUrl(page) }),
  }))
});

export function buildSchemas(page: SeoPage): Record<string, unknown>[] {
  const schemas: Record<string, unknown>[] = [
    baseLocalBusiness(),
    webpageSchema(page),
    breadcrumbSchema(page),
  ];
  const faq = faqSchema(page);
  if (faq) schemas.push(faq);
  if (page.type === 'guide') schemas.push(articleSchema(page));
  if (page.type === 'category') schemas.push(offerCatalogSchema(page));
  return schemas;
}
