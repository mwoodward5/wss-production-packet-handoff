import {site} from '@/lib/wss';
export function JsonLd({data}:{data:unknown}) { return <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(data).replace(/</g,'\\u003c')}}/>; }
export function LocalBusinessSchema() { return <JsonLd data={{'@context':'https://schema.org','@type':'GeneralContractor',name:site.identity.businessName,url:site.identity.website,telephone:site.identity.phoneTel.replace('tel:',''),address:{'@type':'PostalAddress',addressLocality:site.identity.city,addressRegion:site.identity.state},areaServed:site.trust.areas}}/>; }
export function ServiceSchema({name,description,image}:{name:string;description:string;slug:string;image?:string}) { return <JsonLd data={{'@context':'https://schema.org','@type':'Service',name,description,image,provider:{'@type':'GeneralContractor',name:site.identity.businessName}}}/>; }
export function ContactPageSchema(){return null;}
export function ServiceAreaSchema(){return null;}
export function ReviewsPageSchema() {
  const {reviews, aggregate} = site.trust;
  const completeAggregate = aggregate && aggregate.rating !== null && aggregate.count !== null;
  if (!reviews.length && !completeAggregate) return null;
  return <JsonLd data={{
    '@context':'https://schema.org', '@type':'GeneralContractor',
    name:site.identity.businessName, url:site.identity.website,
    ...(completeAggregate ? {aggregateRating:{
      '@type':'AggregateRating', ratingValue:aggregate.rating,
      reviewCount:aggregate.count, url:aggregate.sourceUrl,
    }} : {}),
    ...(reviews.length ? {review:reviews.map(review=>({
      '@type':'Review', author:{'@type':'Person',name:review.author},
      reviewBody:review.text, url:review.sourceUrl,
      ...(review.rating !== null ? {reviewRating:{'@type':'Rating',ratingValue:review.rating,bestRating:5}} : {}),
    }))} : {}),
  }}/>;
}
