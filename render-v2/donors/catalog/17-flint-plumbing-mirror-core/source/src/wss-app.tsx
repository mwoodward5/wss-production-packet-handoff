import { useEffect } from 'react';
import { clientData, sitePlan, applyBranding, serviceDetail } from './wss-bridge';
import { HomePage, SectionShell } from './routes/index';
import { AreaPage } from './routes/$trade.$area';
import { BrandMark } from './components/CinematicHero';
import { ClientCopy, ContactBand } from './components/ClientContent';
import { TrustProvider } from './trust-widgets/TrustProvider';
import { trustConfig } from './trust.config';
import { ServiceMenuGrid } from './trust-widgets/components/ServiceMenuGrid';
import { VoiceAnswerBlock } from './trust-widgets/components/VoiceAnswerBlock';
import { PortfolioLightbox } from './trust-widgets/components/PortfolioLightbox';
import { ServiceAreaBanner } from './trust-widgets/components/ServiceAreaBanner';
import { LocalMap } from './components/LocalMap';
import { areaSlug } from './lib/areas';

export function resolvePage(path: string) {
  const route = path === '/' ? '/' : path.replace(/\/$/, '');
  if (route === '/') return { kind: 'home' as const, title: clientData.identity.businessName };
  const service = clientData.services.find(s => s.href === route);
  if (service) return { kind: 'service' as const, title: service.name, service };
  const area = clientData.trust.areas.find(a => route === `/plumber/${areaSlug(a)}`);
  if (area) return { kind: 'area' as const, title: `Plumber in ${area}`, area };
  const page = sitePlan?.pages?.find(p => `/${String(p.slug || '').replace(/^\/+|\/+$/g, '')}` === route);
  const key = route.slice(1);
  if (page && ['about', 'contact', 'services', 'gallery', 'service-area', 'service-areas'].includes(key)) {
    return { kind: 'content' as const, title: page.title || key.replaceAll('-', ' '), key };
  }
  return { kind: 'missing' as const, title: 'Page not found' };
}

export function configureDocument() {
  applyBranding(document.documentElement);
  // Preserve the donor families. No font provider is contacted by this build;
  // locally supplied font files may be integrated by the coordinator.
}

export function App({ path = window.location.pathname }: { path?: string }) {
  const page = resolvePage(path);
  useEffect(() => { document.title = page.kind === 'home' ? page.title : `${page.title} — ${clientData.identity.businessName}`; }, [page.title]);
  if (page.kind === 'home') return <HomePage />;
  if (page.kind === 'area') return <AreaPage area={page.area} />;
  if (page.kind === 'missing') return <main className="grid min-h-screen place-items-center p-8"><div><h1>Page not found</h1><a href="/">Home</a></div></main>;
  const key = page.kind === 'content' ? page.key : '';
  return <TrustProvider config={trustConfig} className="min-h-screen bg-background text-foreground">
    <header className="mx-auto w-full max-w-[1180px] px-5 py-10"><BrandMark /><a className="mt-6 inline-block text-mint" href="/">Home</a></header>
    <SectionShell eyebrow={clientData.identity.businessName} title={page.title}>
      {page.kind === 'service' ? <ClientCopy text={serviceDetail(page.service)} /> : <>
        {key === 'about' && <ClientCopy text={sitePlan?.content?.['about'] || clientData.content.about} />}
        {key === 'services' && <><ClientCopy text={clientData.content.serviceIntro} /><ServiceMenuGrid /></>}
        {key === 'gallery' && <PortfolioLightbox />}
        {(key === 'service-area' || key === 'service-areas') && <><ClientCopy text={sitePlan?.content?.['service-area'] || ''} /><LocalMap /><ServiceAreaBanner /></>}
      </>}
    </SectionShell>
    {page.kind === 'service' && <SectionShell id="faq"><VoiceAnswerBlock /></SectionShell>}
    <ContactBand />
  </TrustProvider>;
}
