import { CLIENT } from '@/lib/wss';
import { Nav } from './Nav';
import { Footer } from './Footer';
import { Contact } from './Contact';
import { useParams } from '@tanstack/react-router';

export function ServiceDetail({ path }: {path:string}) {
  const service=CLIENT.services.find(s=>s.href===path);
  if (!service) return <main className="container mx-auto px-5 py-32"><h1>Page not found</h1><a href="/">Home</a></main>;
  return <><Nav /><main><section className="relative py-24 md:py-32 bg-gradient-ink text-white"><div className="container mx-auto px-5 md:px-8 pt-16 max-w-3xl"><p className="text-xs font-bold tracking-[0.25em] uppercase text-[var(--gold)]">{CLIENT.identity.businessName}</p><h1 className="mt-3 text-3xl md:text-5xl uppercase leading-[1.05]">{service.name}</h1><p className="mt-5 text-lg font-sans whitespace-pre-line">{service.description}</p><a className="inline-flex mt-9 rounded-sm bg-gradient-warm text-[var(--ink)] px-7 py-4 font-bold uppercase" href="#contact">Discuss this service</a></div></section><Contact /></main><Footer /></>;
}
export function ServicePage() {
  const {serviceSlug}=useParams({strict:false}) as {serviceSlug:string};
  return <ServiceDetail path={'/'+serviceSlug} />;
}
