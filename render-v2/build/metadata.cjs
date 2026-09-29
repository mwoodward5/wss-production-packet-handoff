'use strict';

function esc(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, ch => {
    const code = ch.charCodeAt(0).toString(16).padStart(4, '0');
    return '\\u' + code;
  });
}

// Only canonical certified categories select business types. Project-name hints
// and donor example content are never a source of the customer's identity.
const BUSINESS_TYPES = Object.freeze({
  roofing: 'RoofingContractor', electrical: 'Electrician', plumbing: 'Plumber',
  landscaping: 'HomeAndConstructionBusiness', 'general contractor': 'HomeAndConstructionBusiness',
});
function categoryFor(client) {
  const category = String(client.source?.category || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9 -]{1,79}$/.test(category)) throw new Error('metadata_certified_category_required');
  return category;
}
function coordinate(value, min, max) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
function metadata(client, { publicUrl = '', sitePlan = null } = {}) {
  const category = categoryFor(client);
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  const title = client.identity.businessName + ' | ' + label + ' in ' + client.identity.city + ', ' + client.identity.state;
  const description = client.content.serviceIntro;
  const business = {
    '@context': 'https://schema.org',
    '@type': BUSINESS_TYPES[category] || 'LocalBusiness',
    name: client.identity.businessName,
    telephone: client.identity.phoneTel.replace(/^tel:/, ''),
    address: {
      '@type': 'PostalAddress',
      addressLocality: client.identity.city,
      addressRegion: client.identity.state,
      addressCountry: 'US',
    },
    areaServed: { '@type': 'City', name: client.identity.city + ', ' + client.identity.state },
    knowsAbout: client.services.map(x => x.name),
  };
  if (client.identity.founded) business.foundingDate = String(client.identity.founded);
  if (client.identity.email) business.email = client.identity.email;
  if (publicUrl) business.url = publicUrl;
  if (client.identity.website) business.sameAs = [client.identity.website, ...(client.trust.socials || [])];
  const geo = sitePlan?.localPresence?.mapAndDirections?.geo;
  const latitude = coordinate(geo?.lat, -90, 90), longitude = coordinate(geo?.lng, -180, 180);
  if (geo?.verified === true && geo.schemaAllowed !== false && latitude !== null && longitude !== null) {
    business.geo = { '@type': 'GeoCoordinates', latitude, longitude };
  }

  if (client.trust.aggregate) {
    business.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: client.trust.aggregate.rating,
      reviewCount: client.trust.aggregate.count,
    };
  }

  const graph = [business, { '@type': 'Organization', name: client.identity.businessName, url: publicUrl || client.identity.website }, { '@type': 'WebSite', name: client.identity.businessName, url: publicUrl || client.identity.website }];
  for (const service of client.services) {
    graph.push({
      '@type': 'Service',
      name: service.name,
      description: service.description,
      provider: { '@type': 'Organization', name: client.identity.businessName },
      areaServed: { '@type': 'City', name: client.identity.city + ', ' + client.identity.state },
    });
  }

  if (publicUrl) {
    const base = publicUrl.endsWith('/') ? publicUrl : publicUrl + '/';
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: base },
        ...client.services.filter(x => x.href).map((service, index) => ({
          '@type': 'ListItem', position: index + 2, name: service.name, item: new URL(service.href.replace(/^\//, ''), base).href,
        })),
      ],
    });
  }

  if (client.content.faqs.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: client.content.faqs.map(faq => ({
        '@type': 'Question',
        name: faq.q,
        acceptedAnswer: { '@type': 'Answer', text: faq.a },
      })),
    });
  }

  const head = [
    '<meta name="author" content="' + esc(client.identity.businessName) + '" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:title" content="' + esc(title) + '" />',
    '<meta property="og:description" content="' + esc(description) + '" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:title" content="' + esc(title) + '" />',
    '<meta name="twitter:description" content="' + esc(description) + '" />',
    '<script type="application/ld+json">' + safeJson({ '@context': 'https://schema.org', '@graph': graph.map(({ '@context': _, ...rest }) => rest) }) + '<\/script>',
  ].join('\n');

  return Object.freeze({ title, description, head, schemaGraph: graph });
}

module.exports = Object.freeze({ metadata, esc, safeJson, categoryFor, BUSINESS_TYPES, coordinate });
