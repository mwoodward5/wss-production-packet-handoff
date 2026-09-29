import {Outlet,createRootRouteWithContext,HeadContent,Link} from '@tanstack/react-router';
import type {QueryClient} from '@tanstack/react-query';
import {SiteHeader,SiteFooter,FloatingCTA} from '@/components/SiteChrome';
export const Route=createRootRouteWithContext<{queryClient:QueryClient}>()({component:()=> <><HeadContent/><SiteHeader/><main><Outlet/></main><SiteFooter/><FloatingCTA/></>,notFoundComponent:()=> <div className="px-6 py-40"><h1 className="font-serif text-5xl">Page not found</h1><Link to="/">Home</Link></div>,errorComponent:()=> <div className="px-6 py-40">This page is unavailable.</div>});
