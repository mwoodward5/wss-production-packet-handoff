import {createRoot} from 'react-dom/client';
import {createRouter,createRoute,RouterProvider,useParams} from '@tanstack/react-router';
import {routeTree} from './routeTree.gen';
import {Route as root} from './routes/__root';
import {BoundService} from './components/BoundService';
const serviceRoute=createRoute({getParentRoute:()=>root,path:'$serviceSlug',component:()=>{const {serviceSlug}=useParams({strict:false}) as {serviceSlug:string};return <BoundService slug={serviceSlug}/>;}});
const children=routeTree.children as unknown as Record<string,any>;
const tree=root.addChildren([...Object.values(children),serviceRoute]);
export function createAppRouter(history?:ReturnType<typeof import("@tanstack/react-router").createMemoryHistory>){return createRouter({routeTree:tree,history});}
export function mount(element:HTMLElement){const router=createAppRouter();createRoot(element).render(<RouterProvider router={router}/>);}
