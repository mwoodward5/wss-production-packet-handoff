import { CLIENT, SITE, BINDING } from '@/lib/site';
import { SERVICES } from '@/content/services';
import { Index } from './index';
import { TrustPage } from './trust';
import { Nav, Footer, StickyCta } from '@/components/site/sections';

export function App({path = window.location.pathname}: {path?: string}) {
  const route = path.replace(/\/$/, '') || '/';
  const service = SERVICES.find(s => s.href === route);
  return <>
    <title>{(route === '/trust' ? 'Trust & Privacy — ' : service ? service.name + ' — ' : '') + SITE.name}</title>
    <meta name="description" content={service?.blurb || CLIENT.hero.support} />
    <link rel="canonical" href={new URL(route, CLIENT.identity.website).href} />
    {route === '/' ? <><StructuredData /><Index /></> : route === '/trust' ? <TrustPage /> : service ?
      <main className="min-h-screen bg-[var(--ink)] text-white"><Nav /><section className="blueprint-grid pt-32 pb-20"><div className="mx-auto max-w-7xl px-5 sm:px-8"><span className="spec-mark">Service specifications</span><h1 className="font-display text-5xl sm:text-7xl mt-6">{service.name}</h1><p className="mt-6 max-w-2xl text-lg">{service.blurb}</p></div></section><section className="bg-[var(--paper)] text-[var(--ink)] py-20"><div className="mx-auto max-w-7xl px-5 sm:px-8">{service.details && <p className="whitespace-pre-line max-w-3xl">{service.details}</p>}<a className="inline-block mt-6 underline" href={SITE.phoneHref}>{SITE.phone}</a><br /><a href="/#quote" className="inline-block mt-6 bg-[var(--ink)] text-[var(--brand)] px-6 py-3">Prepare a job ticket →</a></div></section><Footer /><StickyCta /></main> :
      <main className="min-h-screen bg-[var(--ink)] text-white p-16"><h1 className="font-display text-5xl">Page not found</h1><a href="/">Back home</a></main>}
  </>;
}
function StructuredData() {
  const business = {'@context': 'https://schema.org', '@type': 'LocalBusiness', name: SITE.name, url: CLIENT.identity.website, telephone: CLIENT.identity.phoneTel.slice(4), ...(SITE.email ? {email: SITE.email} : {}), logo: CLIENT.identity.logoOnDark, image: CLIENT.hero.poster, address: {'@type': 'PostalAddress', addressLocality: SITE.address.city, addressRegion: SITE.address.region}, areaServed: CLIENT.trust.areas,
    ...(BINDING.coordinates ? {geo: {'@type': 'GeoCoordinates', latitude: BINDING.coordinates.lat, longitude: BINDING.coordinates.lng}} : {}),
    hasOfferCatalog: {'@type': 'OfferCatalog', itemListElement: SERVICES.map(s => ({'@type': 'Offer', itemOffered: {'@type': 'Service', name: s.name, description: s.blurb}}))}};
  const faq = {'@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: CLIENT.content.faqs.map(f => ({'@type': 'Question', name: f.q, acceptedAnswer: {'@type': 'Answer', text: f.a}}))};
  return <>{[business, ...(CLIENT.content.faqs.length ? [faq] : [])].map((x, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(x).replace(/</g, '\\u003c')}} />)}</>;
}
