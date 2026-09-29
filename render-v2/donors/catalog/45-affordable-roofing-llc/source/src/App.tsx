import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import ServiceDetail from './pages/ServiceDetail';

const queryClient = new QueryClient();

import { ClientContext, readBridge } from './wss/bridge';
const App = () => {
  let bridge;
  try { bridge = readBridge(document); } catch { return <main role="alert">Site unavailable. Certified client data is required.</main>; }
  return <ClientContext.Provider value={bridge}>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<ServiceDetail />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider></ClientContext.Provider>;
};

export default App;
