import type {CSSProperties} from 'react';
import {SiteContext,brandStyle,type Site} from './lib/wss';
import {Index} from './routes/index';
import {PrivacyPage} from './routes/privacy';
import {Header} from './components/site/Header';
import {Footer} from './components/site/Footer';
export function App({site,path='/' }:{site:Site;path?:string}){
 const route=path.replace(/\/$/,'')||'/';
 const service=site.client.services.find(s=>s.href===route);
 const page=site.plan.pages?.find(p=>'/'+p.slug.replace(/^\/+|\/+$/g,'')===route);
 const contentKey=route.slice(1);
 const content=site.plan.content?.[contentKey];
 return <SiteContext.Provider value={site}><div style={brandStyle(site) as CSSProperties}>{route==='/'?<Index/>:route==='/privacy'?<><Header/><PrivacyPage/><Footer/></>:<><Header/><main className="bg-cream"><section className="mx-auto max-w-3xl px-5 py-20 lg:px-8"><p className="eyebrow">{site.client.identity.businessName}</p><h1 className="mt-3 font-display text-4xl text-ink sm:text-5xl">{service?.name || (page && content ? page.title || contentKey : 'Page unavailable')}</h1><div className="mt-12 space-y-10 text-sm leading-relaxed text-ink-soft whitespace-pre-line">{service?.description || (page && content ? content : 'Please return home or contact us.')}</div><a href={site.client.identity.phoneTel} className="mt-8 inline-flex rounded-full bg-ink px-5 py-3 text-cream">{site.client.identity.phoneDisplay}</a><a href="/" className="ml-5 text-clay">Back home</a></section></main><Footer/></>}</div></SiteContext.Provider>;
}
