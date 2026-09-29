import { CLIENT, sections } from "@/lib/wss";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";

export const Route=createFileRoute("/sitemap")({component:SitemapPage});

export function SitemapPage() {
 const links=[{href:"/#top",label:"Home"},...sections(),...CLIENT.services.filter(s=>s.href).map(s=>({href:s.href,label:s.name}))];
  return (
    <>
      <Nav />
      <main className="pt-32 pb-24 min-h-[70vh]">
        <div className="container mx-auto px-5 md:px-8 max-w-3xl">
          <p className="text-xs font-bold tracking-[0.25em] uppercase text-[var(--coral)]">
            Sitemap
          </p>
          <h1 className="mt-3 text-3xl md:text-5xl uppercase leading-[1.05]">
            Find your way around.
          </h1>
          <p className="mt-4 text-muted-foreground font-sans">
            {CLIENT.identity.businessName}
          </p>

          <ul className="mt-10 divide-y divide-border border-y border-border">
            {links.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  className="flex items-center justify-between py-4 font-display uppercase text-lg hover:text-[var(--coral)] transition"
                >
                  <span>{s.label}</span>
                  <span className="text-xs font-mono text-muted-foreground tracking-widest">{s.href}</span>
                </a>
              </li>
            ))}
            <li>
              <a
                href="/"
                className="flex items-center justify-between py-4 font-display uppercase text-lg hover:text-[var(--coral)] transition"
              >
                <span>Back to home</span>
                <span className="text-xs font-mono text-muted-foreground tracking-widest">/</span>
              </a>
            </li>
          </ul>

        </div>
      </main>
      <Footer />
    </>
  );
}
