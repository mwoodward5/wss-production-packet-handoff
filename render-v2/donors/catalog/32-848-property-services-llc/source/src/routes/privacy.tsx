import {createFileRoute,Link} from '@tanstack/react-router';
import {BUSINESS} from '@/lib/business';
export const Route=createFileRoute('/privacy')({component:PrivacyPage});
export function PrivacyPage(){return <section className="bg-bone text-ink"><div className="container-edge max-w-3xl py-20"><nav className="text-[11px] font-mono tracking-[0.18em] uppercase text-ink/50 mb-6"><Link to="/">Home</Link> / Privacy</nav><h1 className="display-xl">Privacy <span className="italic">policy.</span></h1><div className="mt-10 space-y-8 text-[15.5px] leading-relaxed text-ink/80"><p>A privacy policy has not been supplied. Contact {BUSINESS.name} for privacy information.</p><a className="btn-ghost-ink" href={`tel:${BUSINESS.phoneE164}`}>{BUSINESS.phone}</a></div></div></section>}
