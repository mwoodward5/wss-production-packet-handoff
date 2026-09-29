import type {AnchorHTMLAttributes} from 'react';
export function Link({to,hash,activeOptions,activeProps,...props}:AnchorHTMLAttributes<HTMLAnchorElement>&{to:string;hash?:string;activeOptions?:unknown;activeProps?:{className?:string}}) {
 const active=typeof window!=='undefined' && window.location.pathname===to;
 return <a {...props} href={to+(hash?'#'+hash:'')} className={active?activeProps?.className||props.className:props.className} />;
}
