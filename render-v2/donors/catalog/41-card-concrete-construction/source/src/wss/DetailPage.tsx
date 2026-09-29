import {useDonor} from './bridge';
import type {Client} from './bridge';
export function DetailPage({service}:{service?:Client['services'][number]}){
 const {client,plan,style}=useDonor();
 const rich=service&&plan.services?.find(s=>s.name===service.name&&'/'+s.slug===service.href);
 return <div style={style} className="bg-ink text-bone min-h-screen"><main className="mx-auto max-w-3xl px-6 py-32"><a href="/" className="font-mono-spec text-amber">← BACK</a><p className="mt-6 font-mono-spec text-cement-soft">{client.identity.businessName}</p><h1 className="mt-6 font-display text-5xl">{service?.name||'Page not found'}</h1>{service&&<><p className="mt-10 text-cement leading-relaxed whitespace-pre-line">{rich?.longDescMd||service.description}</p><a href={client.identity.phoneTel} className="mt-10 inline-flex rounded-full bg-amber px-6 py-3 text-ink">{client.identity.phoneDisplay}</a></>}</main></div>;
}
