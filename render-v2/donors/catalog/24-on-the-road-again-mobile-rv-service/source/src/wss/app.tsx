import {type AnyRoute,createRootRoute,createRoute,createRouter,RouterProvider,Outlet} from '@tanstack/react-router';
import { HomePage } from '../routes/index';
import { ServicesPage } from '../routes/services';
import { AboutPage } from '../routes/about-us';
import { ContactPage } from '../routes/contact';
import { WSS,applyBrand } from './bridge';
import { SiteLayout } from '../components/site/Layout';
import { Section,CallCTA } from '../components/site/Sections';
applyBrand();
const root=createRootRoute({component:Outlet,notFoundComponent:()=> <SiteLayout><Section><h1>Page not found</h1><a href="/">Home</a></Section></SiteLayout>});
const routes:AnyRoute[]=[createRoute({getParentRoute:()=>root,path:'/',component:HomePage}),createRoute({getParentRoute:()=>root,path:'/services',component:ServicesPage}),createRoute({getParentRoute:()=>root,path:'/about-us',component:AboutPage}),createRoute({getParentRoute:()=>root,path:'/contact',component:ContactPage}),createRoute({getParentRoute:()=>root,path:'/contact-us',component:ContactPage})];
for(const s of WSS.services){if(s.href&&!['/','/services','/about-us','/contact','/contact-us'].includes(s.href))routes.push(createRoute({getParentRoute:()=>root,path:s.href,component:()=> <SiteLayout><Section><span className="chip mb-5">Services</span><h1 className="font-serif text-3xl md:text-5xl font-semibold">{s.name}</h1><p className="mt-5 text-lg text-muted-foreground leading-relaxed">{s.description}</p></Section><Section><CallCTA heading="Contact us"/></Section></SiteLayout>}));}
export const router=createRouter({routeTree:root.addChildren(routes)});
export function App(){return <RouterProvider router={router}/>;}

