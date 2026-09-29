import {client,services,serviceImages,serviceNarrative} from '@/lib/site';
import {ServiceLayout} from './ServiceLayout';
export function BoundService({slug}:{slug:string}) {
 const s=services.find(s=>s.slug===slug);
 if (!s) return <section className="mx-auto max-w-4xl px-4 py-24"><h1 className="font-display text-4xl">Service not available</h1></section>;
 const narrative=serviceNarrative(slug);
 return <ServiceLayout slug={slug} title={s.title} heroHeadline={s.title} heroSub={s.short} heroImage={serviceImages[slug] || ''} heroImageAlt={s.title} inShort="" narrative={narrative ? narrative.split(/\n\s*\n/) : []} whyBest={[]} affordable="" cost={{range:'',factors:[]}} hireChecklist={[]} problems={[]} faqs={client.content.faqs} highIntentAnswers={[]}/>;
}
