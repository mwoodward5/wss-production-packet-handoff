import { getSite, plannedPage, serviceCopy } from './lib/wss';
import { Index } from './routes/index';
import { TopBar } from './components/site/TopBar';
import { Footer } from './components/site/Footer';
import { Contact } from './components/site/Contact';
import { About } from './components/site/About';
import { Services } from './components/site/Services';
import { JobPlanner } from './components/site/JobPlanner';
import { Gallery } from './components/site/Gallery';
import { Trust } from './components/site/Trust';
import { StickyCta } from './components/site/StickyCta';
export function App({path}:{path:string}) {
  const c=getSite();
  path=path.replace(/\/+$/,'') || '/';
  if(path==='/') return <Index />;
  const service=c.services.find(s=>s.href===path);
  if (!service && plannedPage(path)) {
    // Reuse the donor's actual section layouts, only for declared, supported pages.
    const section=path==='/about' ? <About /> : path==='/contact' ? <Contact /> :
      path==='/services' ? <><Services /><JobPlanner /><Contact /></> :
      path==='/gallery' && c.media.some(m=>m.role==='gallery') ? <Gallery /> :
      path==='/service-area' && c.trust.areas.length ? <Trust /> : null;
    if (section) return <main className="bg-background text-foreground pt-16"><TopBar />{section}<Footer /><StickyCta contactHref={path==='/contact'||path==='/services' ? '#contact' : '/#contact'} /></main>;
  }
  if(!service) return <main className="p-10"><h1>Page not found</h1><a href="/">Home</a></main>;
  return <main className="bg-background text-foreground"><div className="bg-loam h-16"><TopBar /></div><article className="mx-auto max-w-7xl px-5 sm:px-8 py-24 sm:py-32"><a href="/">Home</a><h1 className="font-display text-4xl sm:text-6xl mt-8">{service.name}</h1><p className="text-lg mt-8 max-w-3xl whitespace-pre-line">{serviceCopy(service)}</p><a href="#contact" className="inline-block rounded-full bg-accent text-accent-foreground px-7 py-4 mt-8">Discuss this service</a></article><Contact initialService={service.name} /><Footer /><StickyCta /></main>;
}
