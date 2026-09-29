import { CLIENT } from "@/lib/wss";



export function Footer() {
  return (
    <footer className="bg-gradient-ink text-white/80 pb-20 lg:pb-0">
      <div className="container mx-auto px-5 md:px-8 py-12 grid md:grid-cols-3 gap-8 items-start">
        <div className="flex items-center gap-3">
          <img src={CLIENT.identity.logoOnDark} alt={CLIENT.identity.businessName} width={48} height={48} className="h-12 w-12 rounded-sm object-contain p-1.5 bg-white/5 ring-1 ring-white/10" />
          <div>
            <div className="font-display text-base uppercase text-white">{CLIENT.identity.businessName}</div>
            <div className="text-xs uppercase tracking-[0.2em] text-white/50">{CLIENT.identity.city}, {CLIENT.identity.state}</div>
          </div>
        </div>
        <div className="text-sm space-y-1 font-sans">
          <div><a href={CLIENT.identity.phoneTel} className="hover:text-white">{CLIENT.identity.phoneDisplay}</a></div>
          {CLIENT.identity.email && <div><a href={`mailto:${CLIENT.identity.email}`} className="hover:text-white break-all">{CLIENT.identity.email}</a></div>}
          {CLIENT.trust.socials.map(url=><div key={url}><a href={url} rel="noreferrer" target="_blank" className="hover:text-white">{new URL(url).hostname}</a></div>)}
        </div>
        <div className="text-sm md:text-right font-sans">
          <div>{CLIENT.identity.city}, {CLIENT.identity.state}</div>
          <div className="text-white/50 mt-1">{CLIENT.trust.areas.join(" · ")}</div>
          <div className="mt-2"><a href="/sitemap" className="text-white/50 hover:text-white text-xs uppercase tracking-wider">Sitemap</a></div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container mx-auto px-5 md:px-8 py-5 text-xs text-white/50 flex flex-col sm:flex-row gap-2 sm:justify-between font-sans">
          <span>© {new Date().getFullYear()} {CLIENT.identity.businessName}. All rights reserved.</span>
          <span>{CLIENT.services[0].name}</span>
        </div>
      </div>
    </footer>
  );
}
