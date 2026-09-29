import { BUSINESS } from "@/lib/business";
import { getSite } from "@/lib/wss";

export function Footer() {
  return (
    <footer className="bg-foreground text-background">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 py-12 grid grid-cols-12 gap-6">
        <div className="col-span-12 sm:col-span-6 lg:col-span-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-background/10 ring-1 ring-background/20">
              <img src={getSite().identity.logoOnDark} alt="" aria-hidden="true" loading="lazy" width={64} height={64} className="h-7 w-7 object-contain" />
            </span>
            <div className="font-display text-xl">{BUSINESS.name}</div>
          </div>
          <p className="mt-3 text-sm text-background/60 max-w-sm">
            {getSite().services.map(s=>s.name).join(" · ")}
          </p>
          <p className="mt-3 text-xs text-background/45">{BUSINESS.city}, {BUSINESS.state}</p>
        </div>
        <div className="col-span-6 sm:col-span-3 lg:col-span-2">
          <div className="text-[10px] uppercase tracking-[0.28em] text-background/50">Reach us</div>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li><a href={BUSINESS.phoneHref} className="hover:text-accent transition">{BUSINESS.phone}</a></li>
            {BUSINESS.email && <li><a href={`mailto:${BUSINESS.email}`} className="hover:text-accent transition break-all">{BUSINESS.email}</a></li>}
            {getSite().trust.socials.map((url,i)=><li key={url}><a href={url} className="hover:text-accent transition">Social profile {i+1}</a></li>)}
          </ul>
        </div>
        <div className="col-span-6 sm:col-span-3 lg:col-span-2">
          <div className="text-[10px] uppercase tracking-[0.28em] text-background/50">Explore</div>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li><a href="/#services" className="hover:text-accent transition">Services</a></li>
            <li><a href="/#estimator" className="hover:text-accent transition">Services guide</a></li>
            {getSite().media.some(m=>m.role==="gallery") && <li><a href="/#work" className="hover:text-accent transition">Work</a></li>}
            <li><a href="/#about" className="hover:text-accent transition">About</a></li>
            {getSite().content.faqs.length > 0 && <li><a href="/#faq" className="hover:text-accent transition">FAQ</a></li>}
            <li><a href="/#contact" className="hover:text-accent transition">Contact</a></li>
          </ul>
        </div>
        {BUSINESS.hours && <div className="col-span-12 lg:col-span-3">
          <div className="text-[10px] uppercase tracking-[0.28em] text-background/50">Hours</div>
          <p className="mt-3 text-sm text-background/70">{BUSINESS.hours}</p>
          <p className="mt-2 text-xs text-background/50">{BUSINESS.serviceAreas.join(" · ")}</p>
        </div>}
      </div>
      <div className="border-t border-background/15">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-6 flex flex-col sm:flex-row gap-3 justify-between text-xs text-background/50">
          <span>© {new Date().getFullYear()} {BUSINESS.name}. All rights reserved.</span>
          <span>{BUSINESS.city} · {BUSINESS.state}</span>
        </div>
      </div>
    </footer>
  );
}
