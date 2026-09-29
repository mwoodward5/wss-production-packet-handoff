import {BUSINESS} from '@/lib/business';
// The donor's form is replaced at its existing call sites with supported direct actions.
// There is no configured submission endpoint or delivery-success state.
export function ContactForm(_props:{defaultService?:string;compact?:boolean;source?:string;locationSlug?:string;locationLabel?:string}){return <div className="grid sm:grid-cols-2 gap-4"><a href={`tel:${BUSINESS.phoneE164}`} className="btn-volt">Call {BUSINESS.phone}</a>{BUSINESS.email && <a href={`mailto:${BUSINESS.email}`} className="btn-ghost-ink">Email {BUSINESS.email}</a>}</div>}
