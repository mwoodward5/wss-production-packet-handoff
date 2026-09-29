import { useEffect } from 'react';
import { createRootRoute, createRoute, createRouter, RouterProvider, Outlet, useLocation } from '@tanstack/react-router';
import { client, applyBrand } from './lib/wss-bridge';
import { serviceBinding, serviceAt } from './lib/service-bindings';
import { CITIES } from './lib/services-data';
import { HomePage } from './routes/index';
import { AboutPage } from './routes/about';
import { ContactPage } from './routes/contact';
import { ServicesPage } from './routes/services.index';
import { ServiceAreaPage } from './routes/service-area';
import { EmergencyPage } from './routes/emergency-tree-service';
import { TreeRemovalPage } from './routes/tree-removal-stump-grinding';
import { ServicePageTemplate } from './components/ServicePageTemplate';
import { CityPageTemplate } from './components/CityPageTemplate';
import { UnavailablePage } from './components/UnavailablePage';

export function ClientRoute({ path }: { path: string }) {
 if (path === '/') return <HomePage />;
 if (path === '/about') return <AboutPage />;
 if (path === '/contact') return <ContactPage />;
 if (path === '/services') return <ServicesPage />;
 if (path === '/service-area') return <ServiceAreaPage />;
 const service = serviceAt(path);
 if (service) {
  if (/emergency/i.test(service.name)) return <EmergencyPage service={service} />;
  if (/tree removal|stump grinding/i.test(service.name)) return <TreeRemovalPage service={service} />;
  return <ServicePageTemplate {...serviceBinding(service)} />;
 }
 const city = CITIES.find(c => c.path === path);
 if (city) return <CityPageTemplate city={city} heroImg="" heroAlt="" body={null} faqs={client.content.faqs} />;
 return <UnavailablePage />;
}
function CurrentPage() {
 const location = useLocation();
 const path = location.pathname.replace(/\/$/, '') || '/';
 useEffect(() => {
  const title = serviceAt(path)?.name || ({'/':'Home','/about':'About','/contact':'Contact','/services':'Services','/service-area':'Service Areas'} as Record<string,string>)[path] || CITIES.find(c=>c.path===path)?.city || 'Page unavailable';
  document.title = title + ' | ' + client.identity.businessName;
  applyBrand();
 }, [path]);
 return <ClientRoute path={path} />;
}
const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: UnavailablePage });
const home = createRoute({getParentRoute:()=>rootRoute,path:'/',component:CurrentPage});
const pages = createRoute({getParentRoute:()=>rootRoute,path:'$',component:CurrentPage});
const routeTree = rootRoute.addChildren([home,pages]);
let router: ReturnType<typeof createRouter> | undefined;
export function WssApp() { router ??= createRouter({ routeTree }); return <RouterProvider router={router} />; }
