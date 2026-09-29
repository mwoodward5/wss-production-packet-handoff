import { useClient } from "@/wss/bridge";

import { Phone, Mail, MapPin } from "lucide-react";

export function Footer() {
  const {client, plan} = useClient();
  const year = new Date().getFullYear();
  return (
    <footer className="bg-primary text-primary-foreground py-14">
      <div className="container-tight">
        <div className="grid md:grid-cols-3 gap-10 md:gap-8">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <img src={client.identity.logoOnDark} alt={client.identity.businessName + " logo"} width={48} height={48} loading="lazy" className="h-12 w-12 object-contain" />
              <div>
                <div className="font-display font-bold uppercase tracking-wide">{client.identity.businessName}</div>
                <div className="text-xs uppercase tracking-[0.2em] text-primary-foreground/60">{client.identity.city}, {client.identity.state}</div>
              </div>
            </div>
            <p className="text-primary-foreground/70 text-sm leading-relaxed">
              {client.content.about}
            </p>
          </div>
          <div>
            <h4 className="font-display uppercase tracking-wider text-sm font-bold mb-4 text-accent">Services</h4>
            <ul className="space-y-2 text-primary-foreground/80 text-sm">
              {client.services.map(s => <li key={s.name}><a href={s.href || '/#services'}>{s.name}</a></li>)}
            </ul>
          </div>
          <div>
            <h4 className="font-display uppercase tracking-wider text-sm font-bold mb-4 text-accent">Contact</h4>
            <ul className="space-y-3 text-sm">
              <li><a href={client.identity.phoneTel} className="flex items-center gap-3 hover:text-accent transition"><Phone className="h-4 w-4" /> {client.identity.phoneDisplay}</a></li>
              {client.identity.email && <li><a href={"mailto:" + client.identity.email} className="flex items-center gap-3 hover:text-accent transition break-all"><Mail className="h-4 w-4 shrink-0" /><span>{client.identity.email}</span></a></li>}
              <li className="flex items-center gap-3 text-primary-foreground/80"><MapPin className="h-4 w-4" /> {client.identity.city}, {client.identity.state}</li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-6 border-t border-primary-foreground/10 flex flex-col sm:flex-row justify-between gap-3 text-xs text-primary-foreground/60">
          <div>&copy; {year} {client.identity.businessName}. All rights reserved.</div>
          <div>{client.trust.areas.join(" · ")}</div>
          {client.trust.socials.map((url,i) => <a key={url} href={url} rel="noreferrer" target="_blank">Social profile {i+1}</a>)}
        </div>
      </div>
    </footer>
  );
}
