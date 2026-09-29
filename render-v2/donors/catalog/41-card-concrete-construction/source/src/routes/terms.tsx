import {useDonor} from '../wss/bridge';
export function TermsPage(){
 const {NAME,style}=useDonor();
 return <div style={style} className="bg-ink text-bone min-h-screen"><div className="mx-auto max-w-3xl px-6 py-32"><a href="/" className="font-mono-spec text-amber">← BACK</a><h1 className="mt-6 font-display text-5xl">Terms</h1><p className="mt-2 font-mono-spec text-cement-soft">{NAME}</p><div className="mt-10 space-y-6 text-cement leading-relaxed"><p>Terms information is currently unavailable.</p></div></div></div>;
}
