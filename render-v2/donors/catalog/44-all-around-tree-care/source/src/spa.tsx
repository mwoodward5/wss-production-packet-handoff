import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, RouterProvider, Outlet, HeadContent, type RouterHistory } from "@tanstack/react-router";
import { HomePage } from "./routes/index";
import { ServicesPage } from "./routes/services";
import { TreeRemovalPage } from "./routes/tree-removal";
import { LawnLandscapingPage } from "./routes/lawn-landscaping";
import { ContactPage } from "./routes/contact";
import { DATA } from "./wss/bridge";
import { BRAND, SERVICES } from "./config";

export function createAppRouter(history?: RouterHistory) {
  function head(path: string, title: string, description: string) {
    const service = DATA.services.find(s => s.href === path);
    const richService = SERVICES.find(s => s.route === path);
    const finalTitle = richService?.metaTitle || `${service?.name || title} | ${DATA.identity.businessName}`;
    const finalDescription = richService?.metaDescription || service?.description || description;
    return {
      meta: [{ title: finalTitle }, { property: "og:title", content: finalTitle },
        { property: "og:image", content: new URL(DATA.hero.poster, DATA.identity.website).href },
        ...(finalDescription ? [{ name: "description", content: finalDescription }, { property: "og:description", content: finalDescription }] : [])],
      links: [{ rel: "canonical", href: new URL(path, DATA.identity.website).href }],
      scripts: service ? [{ type: "application/ld+json", children: JSON.stringify({ "@context": "https://schema.org", "@type": "Service", name: service.name, description: service.description, provider: { "@type": "LocalBusiness", name: DATA.identity.businessName, telephone: DATA.identity.phoneTel.slice(4) } }).replace(/</g, "\\u003c") }] : [],
    };
  }
  const root = createRootRoute({
    component: () => <><HeadContent /><Outlet /></>,
    notFoundComponent: () => <main className="max-w-7xl mx-auto px-5 py-20"><h1 className="text-4xl">Page not found</h1><a href="/services">View services</a></main>,
  });
  const pages = [
    { path: "/", component: HomePage, title: DATA.identity.businessName, description: DATA.hero.support },
    { path: "/services", component: ServicesPage, title: "Services", description: DATA.content.serviceIntro },
    { path: "/tree-removal", component: TreeRemovalPage, title: "Services", description: "" },
    { path: "/lawn-landscaping", component: LawnLandscapingPage, title: "Services", description: "" },
    { path: "/contact", component: ContactPage, title: "Contact", description: "" },
  ];
  const routes = pages.map(page => createRoute({ getParentRoute: () => root, path: page.path, component: page.component,
    head: () => head(page.path, page.title, page.description),
  }));
  for (const service of DATA.services) {
    if (!service.href || pages.some(p => p.path === service.href)) continue;
    const ServicePage = /\b(lawn|landscaping|landscape|firewood)\b/i.test(service.name) ? LawnLandscapingPage : TreeRemovalPage;
    routes.push(createRoute({ getParentRoute: () => root, path: service.href,
      component: () => <ServicePage serviceSlug={service.href.slice(1)} />,
      head: () => head(service.href, service.name, service.description),
    }));
  }
  return createRouter({ routeTree: root.addChildren(routes), history, scrollRestoration: true });
}

export function mount() {
  document.documentElement.style.setProperty("--gold", BRAND.accent);
  const node = document.getElementById("root");
  if (!node) throw new Error("wss_root_missing");
  createRoot(node).render(<RouterProvider router={createAppRouter()} />);
}
