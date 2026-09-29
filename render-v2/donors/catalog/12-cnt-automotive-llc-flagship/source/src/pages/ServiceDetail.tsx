import { Phone, Mail, Wrench, ArrowRight } from 'lucide-react';
import { type Service, type Site } from '@/lib/wss';
import CertifiedCopy from '@/components/CertifiedCopy';

// The donor console's milled two-pane layout, expanded for a certified service route.
export default function ServiceDetail({site, service}: {site: Site; service: Service}) {
  const {identity} = site.client;
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border bg-background/80"><div className="container mx-auto px-4 flex items-center justify-between h-16">
      <a href="/" className="flex items-center gap-3"><img src={identity.logoOnDark} alt={`${identity.businessName} logo`} width={40} height={40} className="h-10 w-10 object-contain" /><span className="font-bold text-sm tracking-wider">{identity.businessName}</span></a>
      <a href={identity.phoneTel} className="gradient-red px-4 py-2 inline-flex gap-2"><Phone className="h-5 w-5" />{identity.phoneDisplay}</a>
    </div></header>
    <main className="py-24 gradient-steel relative overflow-hidden"><div className="absolute inset-0 bg-grid-dense opacity-20" />
      <div className="container mx-auto px-4 relative">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary mb-4">// Repair Path Console</div>
        <h1 className="text-4xl md:text-6xl font-bold mb-12">{service.name}</h1>
        <div className="max-w-5xl mx-auto border border-primary/40 bg-card/80 backdrop-blur shadow-deep">
          <div className="flex justify-between px-4 py-3 border-b border-border font-mono text-xs uppercase"><span className="text-primary">SCOPE_DETAIL</span><span>{site.location}</span></div>
          <div className="grid md:grid-cols-12">
            <nav aria-label="Services" className="md:col-span-5 border-r border-border p-2">{site.client.services.map(s => <a key={s.name} href={s.href || '/#services'} aria-current={s.name === service.name ? 'page' : undefined} className={`block px-4 py-3 font-mono text-sm uppercase ${s.name === service.name ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}>{s.name}</a>)}</nav>
            <div className="md:col-span-7 p-8"><Wrench className="h-10 w-10 text-primary mb-4" /><div className="text-muted-foreground mb-8"><CertifiedCopy text={site.serviceCopy.find(s => s.href === service.href)?.detail || service.description} /></div>
              <div className="flex flex-wrap gap-3"><a href={identity.phoneTel} className="px-4 py-3 gradient-red font-bold uppercase">Discuss This Service</a>{identity.email && <a href={`mailto:${identity.email}`} className="inline-flex gap-2 px-4 py-3 border border-border"><Mail className="h-5 w-5" />Email the Shop</a>}</div>
            </div>
          </div>
        </div>
        <a href="/#services" className="inline-flex gap-2 mt-10 text-primary">All services <ArrowRight className="h-5 w-5" /></a>
      </div>
    </main>
  </div>;
}
