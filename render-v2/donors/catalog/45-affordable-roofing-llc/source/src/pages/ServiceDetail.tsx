import { useLocation } from 'react-router-dom';
import { useClient } from '../wss/bridge';
import NotFound from './NotFound';
import { Phone, Wrench } from 'lucide-react';

export default function ServiceDetail() {
  const {client} = useClient();
  const {pathname} = useLocation();
  const service = client.services.find(s => s.href && s.href === pathname.replace(/\/$/, ''));
  if (!service) return <NotFound />;
  return <div className="min-h-screen bg-background text-foreground">
    <header className="container-x flex items-center justify-between py-5"><a href="/"><img src={client.identity.logoOnLight} alt={`${client.identity.businessName} logo`} className="w-auto h-auto max-w-[120px]" /></a><a href={client.identity.phoneTel} className="btn-clay"><Phone className="h-4 w-4"/>{client.identity.phoneDisplay}</a></header>
    <div className="roof-divider" aria-hidden />
    <main className="py-24 md:py-32 alt-section"><div className="container-x"><a href="/#services" className="eyebrow text-clay">Our services</a><article className="mt-8 bg-white border border-border p-6 md:p-12 rounded-sm"><Wrench className="h-12 w-12 text-clay"/><h1 className="display text-4xl md:text-6xl mt-6">{service.name}</h1><p className="mt-6 max-w-3xl text-muted-foreground md:text-lg whitespace-pre-line">{service.description}</p><a href="/#contact" className="btn-charcoal mt-8">Contact {client.identity.businessName}</a></article></div></main>
  </div>;
}
