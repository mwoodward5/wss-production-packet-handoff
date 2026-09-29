import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import SiteLayout from "@/components/SiteLayout";
import SchemaProvider from "@/components/SchemaProvider";
import Home from "./pages/Home";
import About from "./pages/About";
import Pricing from "./pages/Pricing";
import Contact from "./pages/Contact";
import Reserve, { BookingRedirect } from "./pages/Reserve";
import NotFound from "./pages/NotFound.tsx";

import { useSite, serviceHref, richCopy } from "@/wss/bridge";
import {CertifiedServicePage} from "@/components/ServiceTemplate";
import {CertifiedAreaPage} from "@/components/LocationPage";
import Portfolio from "./pages/Portfolio";

const queryClient = new QueryClient();

const App = () => {
 const {client}=useSite();
 return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <SchemaProvider />
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/reserve" element={<Reserve />} />
            <Route path="/booking" element={<BookingRedirect />} />
            {client.services.map((service,index)=><Route key={service.name} path={serviceHref(service,index)} element={<CertifiedServicePage service={service} index={index}/>} />)}
            <Route path="/portfolio" element={<Portfolio/>}/>
            {(client.trust.areas.length>0 || richCopy('service-area')) && <Route path="/service-area" element={<CertifiedAreaPage/>}/>}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);
};

export default App;
