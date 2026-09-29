import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { CITIES } from '@/lib/cities';
import { BUSINESS, SERVICES } from '@/lib/business';
import { routeHead } from '@/lib/wss-route-head';
import { PageHeader } from '@/components/site/PageHeader';
import { Breadcrumbs } from '@/components/site/Breadcrumbs';
import { CtaBanner } from '@/components/site/CtaBanner';
export const Route = createFileRoute('/service-areas/$city')({
 loader: ({params}) => { const city=CITIES.find(c=>c.slug===params.city); if(!city) throw notFound(); return {city}; },
 head: ({loaderData})=>routeHead(loaderData?.city.city || 'Service area'),
 component: CityPage,
});
function CityPage() {
 const {city}=Route.useLoaderData();
 return <><PageHeader eyebrow="Service area" title={city.city} intro={BUSINESS.name} />
 <Breadcrumbs items={[{label:'Home',to:'/'},{label:'Service Area',to:'/service-area'},{label:city.city}]} />
 <section className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:grid-cols-12 md:px-8">
   <div className="md:col-span-7"><div className="eyebrow">Services</div><div className="mt-6 grid gap-5 md:grid-cols-2">{SERVICES.map(s=><Link key={s.slug} to={s.href} className="rounded-2xl border border-border bg-card p-6"><h2 className="display text-2xl">{s.name}</h2><p className="mt-3 text-sm text-muted-foreground">{s.short}</p></Link>)}</div></div>
   <aside className="md:col-span-5"><div className="sticky top-28 rounded-2xl border border-border bg-card p-7"><h2 className="display text-3xl">Discuss your address in {city.city}</h2><a className="mt-6 block font-semibold" href={BUSINESS.phoneHref}>{BUSINESS.phone}</a><Link to="/contact" className="mt-4 inline-block rounded-full bg-[var(--gold)] px-5 py-3 text-sm text-[var(--ink)]">Contact {BUSINESS.name}</Link></div></aside>
 </section>
 {CITIES.length>1 && <section className="bg-secondary"><div className="mx-auto max-w-7xl px-5 py-16 md:px-8"><div className="eyebrow">Other service areas</div><div className="mt-5 flex flex-wrap gap-2">{CITIES.filter(c=>c.slug!==city.slug).map(c=><Link key={c.slug} to="/service-areas/$city" params={{city:c.slug}} className="rounded-full border border-border bg-background px-4 py-2 text-sm">{c.city}</Link>)}</div></div></section>}
 <CtaBanner /></>;
}
