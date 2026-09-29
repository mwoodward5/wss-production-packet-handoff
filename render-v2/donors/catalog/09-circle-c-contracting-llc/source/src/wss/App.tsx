import {Nav} from '@/components/site/Nav';
import {Hero} from '@/components/site/Hero';
import {Services} from '@/components/site/Services';
import {Work} from '@/components/site/Work';
import {WhyUs} from '@/components/site/WhyUs';
import {Process} from '@/components/site/Process';
import {ServiceArea} from '@/components/site/ServiceArea';
import {Contact} from '@/components/site/Contact';
import {Footer} from '@/components/site/Footer';
import {StickyMobileCTA} from '@/components/site/StickyMobileCTA';
import {useReveal} from '@/hooks/use-reveal';
import {useClient} from './bridge';
function FAQ() {
 const {client} = useClient();
 if (!client.content.faqs.length) return null;
 return <section id="faq" className="container-tight py-24"><h2 className="font-display text-4xl uppercase mb-8">Questions &amp; answers</h2>{client.content.faqs.map(f => <details key={f.q} className="border-b border-border py-5"><summary className="font-display text-xl cursor-pointer">{f.q}</summary><p className="mt-4 text-muted-foreground">{f.a}</p></details>)}</section>;
}
function Proof() {
 const {client} = useClient(); const {reviews, aggregate} = client.trust;
 if (!reviews.length && (aggregate?.rating == null || aggregate?.count == null)) return null;
 return <section id="reviews" className="bg-primary text-primary-foreground py-24"><div className="container-tight"><h2 className="font-display uppercase text-4xl mb-8">Reviews</h2>{aggregate?.rating != null && aggregate.count != null && <a href={aggregate.sourceUrl}>{aggregate.rating} / 5 · {aggregate.count} reviews</a>}<div className="grid md:grid-cols-2 gap-5 mt-8">{reviews.map((r,i) => <blockquote key={i} className="p-8 border border-accent/30 rounded-2xl"><p>{r.text}</p><footer className="mt-5 text-accent"><a href={r.sourceUrl}>{r.author}</a></footer></blockquote>)}</div></div></section>;
}
export function App({path = window.location.pathname}: {path?: string}) {
 useReveal();
 const {client,plan} = useClient();
 const route = path.replace(/\/$/,'') || '/';
 const service = client.services.find(s => s.href === route);
 const richService = service && plan?.services?.find(s => s.name === service.name);
 const sectionRoutes: Record<string, React.ReactNode> = {'/services':<Services />, '/gallery':<Work />, '/about':<WhyUs />, '/service-area':<ServiceArea />, '/contact':<Contact />};
 let page: React.ReactNode;
 if (route === '/') page = <><Hero /><Services /><Work /><Proof /><WhyUs /><Process /><ServiceArea /><FAQ /><Contact /></>;
 else if (service) page = <><section className="container-tight py-24"><span className="eyebrow">{client.identity.businessName}</span><h1 className="font-display text-5xl md:text-7xl uppercase mt-8">{service.name}</h1><p className="mt-8 max-w-3xl whitespace-pre-line text-lg">{richService?.longDescMd || service.description}</p><a className="inline-block mt-8 text-accent underline" href="/#contact">Discuss this service</a></section><Contact /></>;
 else if (sectionRoutes[route]) page = sectionRoutes[route];
 else page = <section className="container-tight py-24"><h1 className="font-display text-5xl">Page not found</h1><a href="/">Return home</a></section>;
 return <div className="min-h-screen bg-background text-foreground"><Nav solid={route !== "/"} /><main className={route !== '/' ? 'pt-20' : ''}>{page}</main><Footer /><StickyMobileCTA /></div>;
}
