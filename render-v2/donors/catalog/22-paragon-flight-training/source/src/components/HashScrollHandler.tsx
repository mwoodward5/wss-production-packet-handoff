import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Mounted once at the App root. When the route changes to "/" with a hash,
 * scroll the target into view (router doesn't do this by default).
 */
export const HashScrollHandler = () => {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = hash.replace("#", "");
    // Wait a tick so the target has mounted after route change.
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(t);
  }, [pathname, hash]);
  return null;
};
