import {QueryClient} from '@tanstack/react-query';
import {createRouter,createRoute} from '@tanstack/react-router';
import {Route as root} from './routes/__root';
import {Route as home} from './routes/index';
import {Route as training} from './routes/training';
import {Route as seminars} from './routes/seminars';
import {Route as arts} from './routes/arts';
import {Route as detail,ArtDetail,loadArt} from './routes/arts.$slug';
import {Route as media} from './routes/media';
import {Route as contact} from './routes/contact';
import {getClient,serviceSlug,pageMeta} from './wss/bridge';
export function getRouter(){
 const pages=[['/',home],['/training',training],['/seminars',seminars],['/arts',arts],['/arts/$slug',detail],['/media',media],['/contact',contact]] as const;
 const children:any[]=pages.map(([path,route])=>route.update({id:path,path,getParentRoute:()=>root} as any));
 const reserved=new Set(pages.map(([p])=>p));
 for(const s of getClient().services){const path='/'+serviceSlug(s);if(reserved.has(path as any))continue;children.push(createRoute({getParentRoute:()=>root,path,loader:()=>loadArt(serviceSlug(s)),head:()=>pageMeta(s.name),component:()=> <ArtDetail slug={serviceSlug(s)}/>}));}
 return createRouter({routeTree:root.addChildren(children),context:{queryClient:new QueryClient()},scrollRestoration:true});
}
