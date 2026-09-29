import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import { readSite, SiteModel } from "./wss/bridge";

const queryClient = new QueryClient();

const App = ({site = readSite()}: {site?: SiteModel | null}) => !site ? (
  <main className="min-h-screen flex items-center justify-center"><p role="alert">Site unavailable: required client data is missing or invalid.</p></main>
) : (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index site={site} />} />
          {site.client.services.filter(s => s.href).map(s => <Route key={s.href} path={s.href} element={<Index key={s.href} site={site} service={s} />} />)}
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
