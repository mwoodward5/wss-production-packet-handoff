import {SITE} from './lib/site';
import {createRouter,createRoute,redirect,type RouterHistory} from '@tanstack/react-router';
import {Route as root} from './routes/__root';
import {Route as r0} from './routes/index';
import {Route as r1} from './routes/services';
import {Route as r2} from './routes/services.$slug';
import {Route as r3} from './routes/projects';
import {Route as r4} from './routes/about';
import {Route as r5} from './routes/service-area';
import {Route as r6} from './routes/service-area.$city';
import {Route as r7} from './routes/faq';
import {Route as r8} from './routes/contact';
import {Route as r9} from './routes/blog';
import {Route as r10} from './routes/blog.$slug';
const routes=[
r0.update({id:'/',path:'/',getParentRoute:()=>root} as never),
r1.update({id:'/services',path:'/services',getParentRoute:()=>root} as never),
r2.update({id:'/services/$slug',path:'/services/$slug',getParentRoute:()=>root} as never),
r3.update({id:'/projects',path:'/projects',getParentRoute:()=>root} as never),
r4.update({id:'/about',path:'/about',getParentRoute:()=>root} as never),
r5.update({id:'/service-area',path:'/service-area',getParentRoute:()=>root} as never),
r6.update({id:'/service-area/$city',path:'/service-area/$city',getParentRoute:()=>root} as never),
r7.update({id:'/faq',path:'/faq',getParentRoute:()=>root} as never),
r8.update({id:'/contact',path:'/contact',getParentRoute:()=>root} as never),
r9.update({id:'/blog',path:'/blog',getParentRoute:()=>root} as never),
r10.update({id:'/blog/$slug',path:'/blog/$slug',getParentRoute:()=>root} as never),
];
export function getRouter(history?:RouterHistory){return createRouter({history,routeTree:root.addChildren([...routes,...SITE.services.map(s=>createRoute({getParentRoute:()=>root,path:"/"+s.slug,beforeLoad:()=>{throw redirect({to:"/services/$slug",params:{slug:s.slug},replace:true});}}))]),scrollRestoration:true});}
