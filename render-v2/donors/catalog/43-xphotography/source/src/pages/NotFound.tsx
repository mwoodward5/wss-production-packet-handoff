import {useSite} from "@/wss/bridge";
import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import Seo from "@/components/Seo";
import Monogram from "@/components/Monogram";
import SideRail from "@/components/SideRail";

const NotFound = () => {
  const {client}=useSite();
  const location = useLocation();
  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <Seo title={`Page not found · ${client.identity.businessName}`} description="Page not found." path={location.pathname} noindex />
      <section className="relative min-h-[100svh] bg-paper overflow-hidden flex items-center pt-32 pb-24">
        <SideRail label="404 · LOST FRAME" meta={["NOT FOUND"]} />
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="container max-w-4xl text-center relative z-10">
          <Monogram size={84} className="text-molten mx-auto mb-10" animated />
          <div className="label-eyebrow text-molten mb-6">Folio 404 · Lost Frame</div>
          <h1 className="font-display text-[14.4vw] md:text-[8vw] lg:text-[6.4vw] text-ivory leading-[0.88] tracking-[-0.03em] mb-6">
            That frame is <span className="italic text-molten">missing</span>.
          </h1>
          <p className="text-ivory/70 text-lg max-w-xl mx-auto mb-12">
            The page you were looking for has wandered out of the gallery. Try one of these instead.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link to="/" className="px-7 py-4 bg-molten text-ink label-eyebrow hover:bg-ivory transition inline-flex items-center gap-2">Return Home <ArrowRight className="w-4 h-4" /></Link>
            <Link to="/portfolio" className="px-7 py-4 border border-ivory/30 text-ivory label-eyebrow hover:border-molten hover:text-molten transition">Portfolio</Link>
            <Link to="/pricing" className="px-7 py-4 border border-ivory/30 text-ivory label-eyebrow hover:border-molten hover:text-molten transition">Pricing</Link>
            <Link to="/reserve" className="px-7 py-4 border border-ivory/30 text-ivory label-eyebrow hover:border-molten hover:text-molten transition">Reserve a date</Link>
          </div>
        </div>
      </section>
    </>
  );
};

export default NotFound;
