import {CLIENT,ROUTES,routeFor} from "@/lib/wss";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./components/Layout";
import Index from "./pages/Index";
import RoofReplacement from "./pages/RoofReplacement";
import RoofRepair from "./pages/RoofRepair";
import Commercial from "./pages/Commercial";
import GuttersSiding from "./pages/GuttersSiding";
import Contact from "./pages/Contact";
import ServiceAreaPage from "./pages/ServiceAreaPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Index /> },
      { path: "/roof-replacement", element: <RoofReplacement /> },
      { path: "/roof-repair", element: <RoofRepair /> },
      { path: "/commercial-roofing", element: <Commercial /> },
      { path: "/gutters-siding-trim", element: <GuttersSiding /> },
      { path: "/service-area", element: <ServiceAreaPage /> },
      { path: "/contact", element: <Contact /> },
      ...CLIENT.services.filter(s=>s.href && ![...ROUTES,'/contact','/service-area'].includes(s.href)).map(s=>({path:s.href,element:routeFor(s)==='/roof-replacement'?<RoofReplacement serviceOverride={s}/>:routeFor(s)==='/commercial-roofing'?<Commercial serviceOverride={s}/>:routeFor(s)==='/gutters-siding-trim'?<GuttersSiding serviceOverride={s}/>:<RoofRepair serviceOverride={s}/>})),
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
