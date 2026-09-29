import { useSite, serviceHref } from "@/wss/bridge";
import { Link } from "react-router-dom";
import { Phone, Mail, MapPin } from "lucide-react";
import Monogram from "./Monogram";

export default function SiteFooter() {
  const {client}=useSite();
  return (
    <footer className="bg-paper-soft text-ivory/85 pt-24 pb-10 relative overflow-hidden border-t border-hairline">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-10 grid md:grid-cols-12 gap-12 relative">
        <div className="md:col-span-6">
          <Link to="/" className="text-ivory inline-block">
            <Monogram size={64} withWordmark />
          </Link>
          <p className="mt-6 max-w-md text-ivory/65 leading-relaxed text-pretty">
            {client.hero.support}
          </p>
          {client.trust.areas.length > 0 && <Link to="/service-area" className="label-eyebrow text-molten block mt-6">{client.trust.areas.join(' · ')}</Link>}
          {client.trust.socials.length > 0 && <div className="flex flex-wrap gap-4 mt-6">{client.trust.socials.map(url=><a key={url} href={url} rel="noopener noreferrer" className="label-eyebrow text-molten">{new URL(url).hostname}</a>)}</div>}
          <div className="divider-gold my-8 max-w-xs" />
          <div className="space-y-3 text-sm">
            <a href={client.identity.phoneTel} className="flex items-center gap-3 hover:text-molten transition">
              <Phone className="w-4 h-4 text-molten" /> {client.identity.phoneDisplay}
            </a>
            {client.identity.email && <a href={`mailto:${client.identity.email}`} className="flex items-center gap-3 hover:text-molten transition">
              <Mail className="w-4 h-4 text-molten" /> {client.identity.email}
            </a>}
            <div className="flex items-center gap-3">
              <MapPin className="w-4 h-4 text-molten" /> {client.identity.city}, {client.identity.state}
            </div>
          </div>
        </div>

        <div className="md:col-span-3">
          <div className="label-eyebrow text-molten mb-5">Studio</div>
          <ul className="space-y-3 text-sm">
            <li><Link to="/about" className="hover:text-molten">About</Link></li>
            <li><Link to="/pricing" className="hover:text-molten">Pricing</Link></li>
            <li><Link to="/reserve" className="hover:text-molten">Reserve</Link></li>
            <li><Link to="/contact" className="hover:text-molten">Contact</Link></li>
          </ul>
        </div>

        <div className="md:col-span-3">
          <div className="label-eyebrow text-molten mb-5">Sessions</div>
          <ul className="space-y-3 text-sm">
            {client.services.map((s,i)=><li key={s.name}><Link to={serviceHref(s,i)} className="hover:text-molten">{s.name}</Link></li>)}
          </ul>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 lg:px-10 mt-16 pt-8 border-t border-hairline flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-ivory/55">
        <div>© {new Date().getFullYear()} {client.identity.businessName}.</div>
        <div className="label-eyebrow">{client.identity.city} · {client.identity.state}</div>
      </div>
    </footer>
  );
}
