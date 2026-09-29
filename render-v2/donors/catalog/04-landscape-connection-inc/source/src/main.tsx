import { createRoot } from "react-dom/client";
import type { CSSProperties } from "react";
import Index from "./routes/index";
import { readSite, SiteContext } from "./wss-bridge";
import "./styles.css";
const root = createRoot(document.getElementById("root")!);
try {
  const site = readSite(document);
  document.title = site.client.identity.businessName;
  const description = document.querySelector('meta[name="description"]');
  description?.setAttribute("content", site.client.content.serviceIntro);
  root.render(
    <SiteContext.Provider value={site}>
      <div style={site.style as CSSProperties}>
        <Index path={window.location.pathname} />
      </div>
    </SiteContext.Provider>,
  );
} catch {
  document.title = "Site unavailable";
  document.querySelector('meta[name="description"]')?.setAttribute("content", "");
  root.render(
    <main className="container-x py-24">
      <h1 className="text-4xl">Site unavailable</h1>
      <p className="mt-5">Business information is unavailable.</p>
    </main>,
  );
}
