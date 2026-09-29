import {Outlet,Link,createRootRoute,HeadContent} from '@tanstack/react-router';
import {SiteHeader} from '../components/SiteHeader';
import {SiteFooter} from '../components/SiteFooter';
import {StickyCallBar} from '../components/StickyCallBar';
import {client,site} from '../lib/site';
import {localBusinessSchema,jsonLd} from '../lib/schema';
export const Route=createRootRoute({head:()=>({meta:[{title:site.name},{name:'description',content:client.hero.support}],scripts:[jsonLd(localBusinessSchema)]}),component:RootComponent,notFoundComponent:()=> <section className="mx-auto max-w-4xl px-4 py-24"><h1 className="font-display text-4xl">Page not found</h1><Link to="/">Home</Link></section>});
export function RootComponent(){return <div className="flex min-h-screen flex-col bg-background"><HeadContent/><SiteHeader/><main className="flex-1"><Outlet/></main><SiteFooter/><StickyCallBar/><div className="h-16 lg:hidden"/></div>}
