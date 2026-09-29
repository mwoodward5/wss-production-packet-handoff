import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Outlet,Link,createRootRouteWithContext,HeadContent} from '@tanstack/react-router';
import {client} from '@/data/bridge';
export const Route=createRootRouteWithContext<{queryClient:QueryClient}>()({
 head:()=>({meta:[{title:client.identity.businessName},{name:'description',content:client.hero.support},{property:'og:image',content:client.hero.poster}]}),
 component:RootComponent,
 notFoundComponent:()=> <div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="max-w-md text-center"><h1 className="text-7xl font-bold">404</h1><h2 className="mt-4 text-xl font-semibold">Page not found</h2><Link to="/" className="mt-6 inline-flex rounded-full bg-primary px-4 py-3">Go home</Link></div></div>
});
function RootComponent(){const {queryClient}=Route.useRouteContext();return <QueryClientProvider client={queryClient}><HeadContent/><Outlet/></QueryClientProvider>}
