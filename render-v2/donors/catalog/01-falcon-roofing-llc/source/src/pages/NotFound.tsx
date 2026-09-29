import {BUSINESS} from "@/lib/business";
import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Seo } from "@/components/Seo";

const NotFound = () => {
  const location = useLocation();
  useEffect(() => {
    console.error("404:", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <Seo title={`Page not found | ${BUSINESS.name}`} description="The page you're looking for doesn't exist." path={location.pathname} />
      <section className="container-tight grid min-h-[60vh] place-items-center py-20 text-center">
        <div>
          <div className="font-display text-7xl font-bold text-accent">404</div>
          <h1 className="mt-4 font-display text-3xl font-bold">Page not found</h1>
          <p className="mt-3 text-muted-foreground">The page you're looking for doesn't exist or has moved.</p>
          <Link to="/" className="mt-8 inline-flex items-center gap-2 rounded-md bg-gradient-accent px-6 py-3 text-sm font-semibold text-accent-foreground shadow-cta">
            Back to home
          </Link>
        </div>
      </section>
    </>
  );
};

export default NotFound;
