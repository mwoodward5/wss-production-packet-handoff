import { fact } from "@/lib/facts";
import { showReviewsSection } from "@/lib/content";

const BUSINESS_NAME = fact("BUSINESS_NAME");
const CITY = fact("CITY");
const STATE = fact("STATE");
const PLACE = CITY + ", " + STATE;
const PHONE = fact("PHONE");
const PHONE_DIGITS = fact("PHONE_DIGITS");
const TEL_HREF = PHONE_DIGITS ? "tel:+1" + PHONE_DIGITS : "";
const EMAIL = fact("EMAIL");
const LOGO_URL = fact("LOGO_URL");
const PROFILE_URL = fact("PROFILE_URL");
const LICENSE = fact("LICENSE");

// Section links, not fabricated destinations: the source design's dead
// neighborhood/legal/social "#" links are gone. Every anchor here resolves to
// a section that renders (the Testimonials link collapses with its section).
const explore = [
  { label: "Properties", href: "#collections" },
  { label: "About", href: "#about" },
  { label: "Expertise", href: "#expertise" },
  ...(showReviewsSection ? [{ label: "Testimonials", href: "#testimonials" }] : []),
  { label: "FAQ", href: "#faq" },
];

const services = [
  "Buyer Advisory", "Seller Representation", "Investment Strategy",
  "Relocation Services", "Market Analysis", "Private Consultations",
];

export default function Footer() {
  return (
    <footer className="relative bg-charcoal py-24 md:py-32 overflow-hidden border-t border-gold/10">
      {/* Client-logo watermark — only when the engine placed a verified logo */}
      {LOGO_URL && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.02] pointer-events-none">
          <img src={LOGO_URL} alt="" className="w-[700px] md:w-[900px] h-auto object-contain" style={{ animation: "rotate-slow 180s linear infinite" }} />
        </div>
      )}

      <div className="luxury-section relative z-10">
        <div className="grid md:grid-cols-4 gap-14 mb-20">
          <div className="md:col-span-1">
            <a href="#top" className="flex items-center gap-2">
              {LOGO_URL ? (
                <img src={LOGO_URL} alt={BUSINESS_NAME} className="h-12 w-auto object-contain opacity-80" />
              ) : (
                <span className="font-display text-xl font-semibold tracking-editorial text-ivory">
                  {BUSINESS_NAME}<span className="text-gold">.</span>
                </span>
              )}
            </a>
            <p className="font-body text-xs text-ivory/25 leading-[1.9] mt-6">
              Elevated real estate representation for buyers, sellers, investors and
              relocating clients in the {PLACE} market.
            </p>
          </div>

          <div>
            <p className="font-body text-[11px] tracking-[0.3em] uppercase text-gold/60 mb-6">Explore</p>
            <ul className="space-y-3">
              {explore.map((n) => (
                <li key={n.label}>
                  <a href={n.href} className="font-body text-xs text-ivory/25 hover:text-gold transition-colors duration-300">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-body text-[11px] tracking-[0.3em] uppercase text-gold/60 mb-6">Services</p>
            <ul className="space-y-3">
              {services.map((s) => (
                <li key={s}>
                  <a href="#contact" className="font-body text-xs text-ivory/25 hover:text-gold transition-colors duration-300">
                    {s}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-body text-[11px] tracking-[0.3em] uppercase text-gold/60 mb-6">Connect</p>
            <div className="space-y-3 font-body text-xs text-ivory/25">
              {EMAIL && (
                <p><a href={`mailto:${EMAIL}`} className="hover:text-gold transition-colors duration-300 break-all">{EMAIL}</a></p>
              )}
              {PHONE && (
                <p><a href={TEL_HREF} className="hover:text-gold transition-colors duration-300">{PHONE}</a></p>
              )}
              <p className="mt-5">{PLACE}</p>
              {PROFILE_URL && (
                <p>
                  <a href={PROFILE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-gold transition-colors duration-300">
                    Google Business Profile
                  </a>
                </p>
              )}
              {LICENSE && <p className="mt-5">{LICENSE}</p>}
            </div>
          </div>
        </div>

        <div className="border-t border-ivory/5 pt-10 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="font-body text-[11px] text-ivory/10">
            © {new Date().getFullYear()} {BUSINESS_NAME}. All rights reserved.
          </p>
          <a
            href="https://wss-ai.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-body text-[11px] text-ivory/10 hover:text-gold transition-colors duration-300"
          >
            Built by wss-ai.com
          </a>
        </div>
      </div>
    </footer>
  );
}
