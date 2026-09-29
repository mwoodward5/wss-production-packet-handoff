import {site, hoursText} from "@/lib/wss";
import { Link } from "@/lib/navigation";
import { business } from "@/lib/business";


export function Footer() {
  return (
    <footer className="relative mt-32 border-t border-rule bg-ink text-cream">
      <div className="mx-auto max-w-[1400px] px-5 py-16 lg:px-10 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <img
              src={site.identity.logoOnDark}
              alt={business.name}
              className="mb-6 h-20 w-auto"
            />
            <p className="eyebrow text-amber-glow">{business.city}, {business.state}</p>
            <h2 className="mt-4 font-display text-4xl leading-[0.95] tracking-tight text-cream sm:text-5xl">{business.name}</h2>
            {site.content.seasonalNote && <p className="mt-6 max-w-md text-pretty text-cream/70">{site.content.seasonalNote}</p>}
            <Link to="/contact" className="btn-amber mt-8">
              Start your project
              <span aria-hidden>→</span>
            </Link>
          </div>

          <div className="grid gap-10 sm:grid-cols-3 lg:col-span-7">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-glow/80">Visit</p>
              <p className="mt-3 font-display text-lg text-cream">{business.city}, {business.state}</p>
              
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50">{hoursText ? "Hours" : ""}</p>
              <p className="mt-2 text-sm text-cream/80">{hoursText}</p>
              
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-glow/80">Contact</p>
              <a href={`tel:${business.phoneTel}`} className="mt-3 block font-display text-lg text-cream link-underline">
                {business.phone}
              </a>
              {business.email && (<a href={`mailto:${business.email}`} className="mt-1 block text-sm text-cream/70 link-underline break-all">
                {business.email}
              </a>)}
              {site.trust.socials.map(url=><a key={url} href={url} className="mt-2 block text-sm text-cream/70 link-underline">{new URL(url).hostname}</a>)}
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-glow/80">Site</p>
              <ul className="mt-3 space-y-2 text-sm">
                <li><Link to="/services" className="text-cream/80 link-underline">Services</Link></li>
                <li><Link to="/gallery" className="text-cream/80 link-underline">Gallery</Link></li>
                <li><Link to="/service-area" className="text-cream/80 link-underline">Service Area</Link></li>
                <li><Link to="/about" className="text-cream/80 link-underline">About</Link></li>
                <li><Link to="/reviews" className="text-cream/80 link-underline">Reviews</Link></li>
                <li><Link to="/faq" className="text-cream/80 link-underline">FAQ</Link></li>
                <li><Link to="/contact" className="text-cream/80 link-underline">Contact</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-cream/15 pt-8 text-xs text-cream/50 sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} {business.name}.</p>
          
        </div>
      </div>
    </footer>
  );
}
