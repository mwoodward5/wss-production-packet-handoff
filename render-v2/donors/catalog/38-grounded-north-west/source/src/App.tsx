import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { useClient, serviceKind } from "@/lib/wss";
import About from "./pages/About";
import { legacyServiceRoutes } from './lib/donor-routes';
import { HelmetProvider } from "react-helmet-async";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SiteLayout } from "@/components/site/SiteLayout";
import Index from "./pages/Index.tsx";
import Residential from "./pages/Residential.tsx";
import Panel from "./pages/Panel.tsx";
import EvChargers from "./pages/EvChargers.tsx";
import WholeHomeGenerators from "./pages/WholeHomeGenerators.tsx";
import CustomLighting from "./pages/CustomLighting.tsx";
import Rewires from "./pages/Rewires.tsx";
import CustomSolutions from "./pages/CustomSolutions.tsx";
import Services from "./pages/Services.tsx";
import Projects from "./pages/Projects.tsx";
import ServiceArea from "./pages/ServiceArea.tsx";
import Contact from "./pages/Contact.tsx";
import Faq from "./pages/Faq.tsx";
import NotFound from "./pages/NotFound.tsx";
import Troubleshooting from "./pages/Troubleshooting.tsx";

const queryClient = new QueryClient();

export const SiteRoutes = () => {
  const c=useClient();
  const components={residential:Residential,panel:Panel,ev:EvChargers,generator:WholeHomeGenerators,lighting:CustomLighting,rewires:Rewires,solutions:CustomSolutions,troubleshooting:Troubleshooting};
  return <Routes>
    <Route element={<SiteLayout />}>
      <Route path="/" element={<Index />} />
      <Route path="/services" element={<Services />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/service-area" element={<ServiceArea />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/faq" element={<Faq />} />
      <Route path="/about" element={<About />} />
      {c.services.map(s=>{const Page=components[serviceKind(s)!];return <Route key={s.href} path={s.href} element={<Page />}/>;})}
      {legacyServiceRoutes.filter(([path])=>!c.services.some(s=>s.href===path)).map(([path,kind])=>{
        const matches=c.services.filter(s=>serviceKind(s)===kind);
        return <Route key={path} path={path} element={matches.length===1?<Navigate to={matches[0].href} replace/>:<NotFound/>}/>;
      })}
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>;
};

const App = () => (
  <HelmetProvider>
    <MotionConfig reducedMotion="user">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <SiteRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
    </MotionConfig>
  </HelmetProvider>
);

export default App;
