import { client } from "./lib/wss";
import { MotionConfig } from 'framer-motion';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import ServiceAreasHub from "./pages/ServiceAreasHub.tsx";
import CityLanding from "./pages/CityLanding.tsx";
import ProgramLanding from "./pages/ProgramLanding.tsx";
import { HashScrollHandler } from "./components/HashScrollHandler.tsx";

const queryClient = new QueryClient();

const App = () => (
  <MotionConfig reducedMotion="user"><QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <HashScrollHandler />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/service-areas" element={<ServiceAreasHub />} />
          <Route path="/flight-school/:city" element={<CityLanding />} />
          <Route path="/programs/:program" element={<ProgramLanding />} />
          {client.services.filter(s => s.href && s.href !== "/service-areas").map(s => <Route key={s.href} path={s.href} element={<ProgramLanding />} />)}
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider></MotionConfig>
);

export default App;
