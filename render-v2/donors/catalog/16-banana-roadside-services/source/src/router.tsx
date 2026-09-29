import { QueryClient } from "@tanstack/react-query";
import { createRouter, createRoute } from "@tanstack/react-router";
import { serviceItems } from "./data/bridge";
import { ServicesPage } from "./routes/services";
import { Route as rootRoute } from "./routes/__root";
import { routeTree } from "./routeTree.gen";

const originalChildren=Object.values(routeTree.children || {});

export const getRouter = (history?: ReturnType<typeof import("@tanstack/react-router").createMemoryHistory>) => {
  const queryClient = new QueryClient();

  const fixed = ['/', '/about-us', '/services', '/gallery', '/contact-us', '/european-battery-services'];
  const extra = serviceItems.filter(s=>s.href && !fixed.includes(s.href)).map(service=>createRoute({getParentRoute:()=>rootRoute,path:service.href,component:()=> <ServicesPage selected={service}/>,head:()=>({meta:[{title:service.name}]})}));
  const tree = routeTree.addChildren([...originalChildren,...extra]);
  const router = createRouter({
    routeTree: tree,
    history,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
