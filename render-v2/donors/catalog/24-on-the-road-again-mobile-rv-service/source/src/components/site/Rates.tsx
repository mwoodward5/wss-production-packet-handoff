import { Section, SectionHeader } from './Sections';
/** Retained donor layout. No CSD pricing field exists, so callers pass null. */
export interface CertifiedRates {dispatch:string;hourly:string;dispatchTerms:string;hourlyTerms:string}
export function Rates({rates}:{rates:CertifiedRates|null}) {
 if(!rates)return null;
 return <Section id="rates" className="!pt-6"><SectionHeader eyebrow="Rates" title={<>Service fee and <span className="text-primary">hourly rate</span>.</>}/><div className="mt-10 grid md:grid-cols-2 gap-6"><div className="rounded-2xl border border-border bg-card p-7"><div className="text-xs uppercase tracking-widest text-muted-foreground">Standard mobile service fee</div><div className="mt-2 font-serif text-4xl font-semibold text-primary">{rates.dispatch}</div><p className="mt-3 text-sm text-muted-foreground leading-relaxed">{rates.dispatchTerms}</p></div><div className="rounded-2xl border border-border bg-card p-7"><div className="text-xs uppercase tracking-widest text-muted-foreground">Standard hourly rate</div><div className="mt-2 font-serif text-4xl font-semibold text-primary">{rates.hourly}</div><p className="mt-3 text-sm text-muted-foreground leading-relaxed">{rates.hourlyTerms}</p></div></div></Section>;
}
