import { Instagram, Mail, MapPin, Phone } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";
export function Footer() {
  return (
    <footer className="border-t border-line py-14 container-wss">
      <div className="grid md:grid-cols-2 gap-8">
        <div><h3 className="font-display text-2xl font-bold mb-3">✦ {siteConfig.studioName}</h3><p className="text-fadetext max-w-sm">{siteConfig.tagline}</p></div>
        <div className="flex flex-col gap-3 text-fadetext md:items-end">
          <a href={`tel:${siteConfig.phone}`} className="flex items-center gap-2 hover:text-bone"><Phone size={16}/>{siteConfig.phone}</a>
          <a href={`mailto:${siteConfig.email}`} className="flex items-center gap-2 hover:text-bone"><Mail size={16}/>{siteConfig.email}</a>
          <a href={siteConfig.instagram} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-bone"><Instagram size={16}/>Instagram</a>
          <span className="flex items-center gap-2"><MapPin size={16}/>{siteConfig.address}</span>
        </div>
      </div>
      <p className="text-xs text-fadetext mt-10">© {new Date().getFullYear()} {siteConfig.studioName}. Built by WSS-AI.</p>
    </footer>
  );
}
