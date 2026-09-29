import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import { applyBrand, readSite } from './lib/wss';
import ServiceDetail from './pages/ServiceDetail';

const queryClient = new QueryClient();

const App = () => {
  let site;
  try { site = readSite(); applyBrand(site.client); }
  catch { return <main className="min-h-screen bg-background text-foreground grid place-items-center"><div role="alert"><h1>Site unavailable</h1><p>Certified client data is required.</p></div></main>; }
  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index site={site} />} />
          {site.client.services.filter(s => s.href).map(service => <Route key={service.href} path={service.href} element={<ServiceDetail site={site} service={service} />} />)}
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
); };

export default App;
