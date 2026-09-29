import { SiteShell } from './SiteShell';
export function UnavailablePage() {
 return <SiteShell><section className="bg-hero py-20 text-surface-foreground sm:py-28"><div className="mx-auto max-w-5xl px-4 text-center"><h1 className="text-4xl font-bold sm:text-6xl">Page unavailable</h1><p className="mt-5">No certified client content is available for this address.</p></div></section></SiteShell>;
}
