import {createFileRoute,Link} from '@tanstack/react-router';
import {ExternalLink,ShieldCheck,ArrowUpRight} from 'lucide-react';
import {BUSINESS} from '@/lib/business';
export const Route=createFileRoute('/bbb-categories')({component:BbbCategoriesPage});
export function BbbCategoriesPage(){
 return <div className="bg-bone text-ink"><section className="container-edge pt-20 pb-12"><nav className="text-[11px] font-mono tracking-[0.18em] uppercase text-ink/50 mb-6"><Link to="/">Home</Link> / Credentials</nav><h1 className="display-xl text-ink max-w-3xl">Category documentation.</h1><p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink/70">No category documentation is available.</p><Link to="/services" className="mt-6 btn-ghost-ink">View services →</Link></section></div>;
}
