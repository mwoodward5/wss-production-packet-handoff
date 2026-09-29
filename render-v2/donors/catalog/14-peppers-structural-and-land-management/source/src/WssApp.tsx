import {Header} from './components/site/Header';
import {useSyncExternalStore} from 'react';
import {Footer} from './components/site/Footer';
import {StickyCallBar} from './components/site/StickyCallBar';
import {Home} from './routes/index';
import {AboutPage} from './routes/about';
import {ContactPage} from './routes/contact';
import {GalleryPage} from './routes/gallery';
import {FAQPage} from './routes/faq';
import {ReviewsPage} from './routes/reviews';
import {ServiceAreaPage} from './routes/service-area';
import {ServicesPage} from './routes/services.index';
import {ServiceDetail} from './routes/services.$slug';
import {site,services} from './lib/wss';
import {LocalBusinessSchema} from './components/site/Schema';
export function WssApp() {
  const route=useSyncExternalStore(listener=>{window.addEventListener('popstate',listener);return ()=>window.removeEventListener('popstate',listener);},()=>window.location.pathname+window.location.search,()=>window.location.pathname+window.location.search);
  // Certified paths are ASCII slugs. Unknown/encoded paths go to the 404;
  // decoding only here would disagree with the service detail slug lookup.
  const path=window.location.pathname.replace(/\/$/,'') || '/';
  const pages:Record<string,()=>React.ReactNode>={'/':Home,'/about':AboutPage,'/contact':ContactPage,'/gallery':GalleryPage,'/faq':FAQPage,'/reviews':ReviewsPage,'/service-area':ServiceAreaPage,'/services':ServicesPage};
  const service=services.find(s=>s.href===path || '/services/'+s.slug===path);
  const Page=service ? ServiceDetail : pages[path];
  const title=service?.name || ({'/':'','/about':'About','/contact':'Contact','/gallery':'Gallery','/faq':'FAQ','/reviews':'Reviews','/service-area':'Service area','/services':'Services'} as Record<string,string>)[path] || 'Not found';
  if (typeof document!=='undefined') document.title=(path==='/'?'':title+' · ')+site.identity.businessName;
  return <div className="flex min-h-screen flex-col bg-cream pb-14 lg:pb-0"><LocalBusinessSchema/><Header/><main className="flex-1">{Page ? <Page key={route}/> : <div className="flex min-h-screen items-center justify-center bg-cream px-6"><div className="max-w-md text-center"><p className="eyebrow">[ 404 · Off the map ]</p><h1 className="mt-4 font-display text-6xl text-ink">Not found</h1><a href="/" className="btn-primary mt-8">Back to home →</a></div></div>}</main><Footer/><StickyCallBar/></div>;
}
