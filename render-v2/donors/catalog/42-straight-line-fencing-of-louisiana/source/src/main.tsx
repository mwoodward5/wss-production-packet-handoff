import { createRoot } from 'react-dom/client';
import { initialize } from './wss/bridge';
import { resolveRoute } from './wss/model';
import { CertifiedCopy } from './wss/CertifiedCopy';
import Index, { DonorPage } from './routes/index';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
try {
  const site = initialize(document);
  const route = resolveRoute(site, window.location.pathname);
  document.title = route.kind === 'service' ? `${route.title} | ${site.identity.businessName}` : site.identity.businessName;
  if (route.kind === 'home') root.render(<Index />);
  else if (route.kind === 'section') root.render(<DonorPage section={route.section} />);
  else if (route.kind === 'service') root.render(<main className="px-6 md:px-10 py-24 mx-auto max-w-[1400px]"><a href="/" className="eyebrow">{site.identity.businessName}</a><div className="grid grid-cols-12 gap-8 mt-20"><div className="col-span-12 md:col-span-3 eyebrow">Services</div><article className="col-span-12 md:col-span-9"><h1 className="font-serif text-5xl">{route.title}</h1><CertifiedCopy text={route.body} className="mt-10 text-lg leading-relaxed" /><a className="link-arrow mt-12 inline-block" href={site.identity.phoneTel}>{site.identity.phoneDisplay}</a></article></div></main>);
  else root.render(<main className="p-10"><h1 className="font-serif text-5xl">404</h1><p>Page not found.</p><a href="/">Go home</a></main>);
} catch {
  document.title = 'Site unavailable';
  root.render(<main className="p-10"><h1 className="font-serif text-3xl">Site unavailable</h1><p>Required business information is unavailable.</p></main>);
}
