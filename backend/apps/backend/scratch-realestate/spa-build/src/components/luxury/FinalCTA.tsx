import { useReveal } from "@/hooks/useReveal";
import { useState } from "react";
import { toast } from "sonner";
import MagneticButton from "./MagneticButton";
import { fact } from "@/lib/facts";

const CITY = fact("CITY");
const STATE = fact("STATE");
const PLACE = CITY + ", " + STATE;
const PHONE = fact("PHONE");
const PHONE_DIGITS = fact("PHONE_DIGITS");
const TEL_HREF = PHONE_DIGITS ? "tel:+1" + PHONE_DIGITS : "";
const EMAIL = fact("EMAIL");
const LOGO_URL = fact("LOGO_URL");

const interests = ["Buying", "Selling", "Investing", "Relocating"];

// The inquiry form posts to the WSS lead endpoint — the same contract every
// donor-native form in the library uses (slug from the mirror's own hostname,
// "website" as the honeypot). No donor-local stub can swallow leads.
const LEAD_ENDPOINT = "https://ghost.wss-ai.com/api/quote-request";

export default function FinalCTA() {
  const { ref, revealed } = useReveal();
  const [selectedInterest, setSelectedInterest] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const first = String(data.get("firstName") || "").trim();
    const last = String(data.get("lastName") || "").trim();
    const name = [first, last].filter(Boolean).join(" ");
    if (!name || sending) return;
    setSending(true);
    try {
      const res = await fetch(LEAD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: typeof window !== "undefined" ? window.location.hostname.split(".")[0] : "",
          name,
          phone: String(data.get("phone") || ""),
          email: String(data.get("email") || ""),
          service: selectedInterest || "Real Estate Inquiry",
          message: [
            data.get("neighborhood") ? `Preferred neighborhood: ${data.get("neighborhood")}` : "",
            String(data.get("vision") || ""),
          ].filter(Boolean).join("\n"),
          page_url: typeof window !== "undefined" ? window.location.href : "",
          website: String(data.get("website") || ""),
        }),
      });
      if (!res.ok) throw new Error(`lead endpoint responded ${res.status}`);
      setSent(true);
      form.reset();
    } catch {
      toast.error(
        PHONE
          ? `That didn't send. Please call ${PHONE}.`
          : "That didn't send. Please try again in a moment.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="contact" className="scroll-mt-24 relative bg-charcoal py-40 md:py-56 overflow-hidden" ref={ref}>
      {/* Atmospheric background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 20% 40%, hsl(var(--gold) / 0.08) 0%, transparent 50%),
                           radial-gradient(circle at 80% 60%, hsl(var(--gold) / 0.05) 0%, transparent 50%),
                           radial-gradient(circle at 50% 80%, hsl(var(--charcoal-light)) 0%, transparent 40%)`
        }} />
      </div>

      {/* Client-logo watermark — only when the engine placed a verified logo */}
      {LOGO_URL && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.02] pointer-events-none">
          <img src={LOGO_URL} alt="" className="w-[500px] md:w-[700px] h-auto object-contain" style={{ animation: "rotate-slow 120s linear infinite" }} />
        </div>
      )}

      <div className="luxury-section relative z-10">
        <div className="grid lg:grid-cols-2 gap-20 lg:gap-28">
          <div className={`reveal-up ${revealed ? "revealed" : ""}`}>
            <p className="font-body text-[11px] tracking-[0.35em] uppercase text-gold mb-6">
              Begin a Private Conversation
            </p>
            <h2 className="font-display font-medium text-ivory leading-[1.05] mb-8"
                style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
              Let's Discuss<br />
              Your Next <em className="italic text-gold">Chapter</em>
            </h2>
            <div className={`luxury-divider-animate ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.3s" }} />
            <p className="font-body text-sm md:text-[15px] text-ivory/45 leading-[1.9] mt-10 mb-12 max-w-lg">
              Whether you're envisioning your next home, preparing to list a significant
              property, exploring the market as an investor, or planning a relocation to
              the {PLACE} area — this conversation is where clarity begins.
            </p>
            <div className="space-y-4 text-ivory/30 font-body text-sm">
              <p>{PLACE}</p>
              {EMAIL && (
                <p>
                  <a href={`mailto:${EMAIL}`} className="hover:text-gold transition-colors duration-300 break-all">{EMAIL}</a>
                </p>
              )}
              {PHONE && (
                <p>
                  <a href={TEL_HREF} data-cta="dock-call" className="hover:text-gold transition-colors duration-300">{PHONE}</a>
                </p>
              )}
            </div>
          </div>

          <div className={`reveal-up ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.2s" }}>
            {sent ? (
              <div className="border border-gold/25 bg-gold/5 p-10 text-center">
                <p className="font-display text-2xl text-ivory mb-4">Thank you.</p>
                <p className="font-body text-sm text-ivory/45 leading-[1.9]">
                  Your inquiry has been received and will be handled with complete
                  discretion. Expect a personal reply shortly.
                </p>
              </div>
            ) : (
            <form className="space-y-6" onSubmit={onSubmit}>
              {/* Honeypot — real visitors never see or fill this field. */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
              />
              <div className="grid grid-cols-2 gap-5">
                <div className="relative group">
                  <input
                    type="text"
                    placeholder=" "
                    id="firstName"
                    name="firstName"
                    className="w-full bg-transparent border-b border-ivory/10 text-ivory px-0 py-5 font-body text-sm focus:border-gold focus:outline-none transition-colors duration-500 peer"
                  />
                  <label htmlFor="firstName" className="absolute left-0 top-5 font-body text-sm text-ivory/25 transition-all duration-300 peer-focus:top-0 peer-focus:text-[10px] peer-focus:text-gold peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px]">
                    First Name
                  </label>
                </div>
                <div className="relative group">
                  <input
                    type="text"
                    placeholder=" "
                    id="lastName"
                    name="lastName"
                    className="w-full bg-transparent border-b border-ivory/10 text-ivory px-0 py-5 font-body text-sm focus:border-gold focus:outline-none transition-colors duration-500 peer"
                  />
                  <label htmlFor="lastName" className="absolute left-0 top-5 font-body text-sm text-ivory/25 transition-all duration-300 peer-focus:top-0 peer-focus:text-[10px] peer-focus:text-gold peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px]">
                    Last Name
                  </label>
                </div>
              </div>

              <div className="relative">
                <input type="email" placeholder=" " id="email" name="email"
                  className="w-full bg-transparent border-b border-ivory/10 text-ivory px-0 py-5 font-body text-sm focus:border-gold focus:outline-none transition-colors duration-500 peer" />
                <label htmlFor="email" className="absolute left-0 top-5 font-body text-sm text-ivory/25 transition-all duration-300 peer-focus:top-0 peer-focus:text-[10px] peer-focus:text-gold peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px]">
                  Email Address
                </label>
              </div>

              <div className="relative">
                <input type="tel" placeholder=" " id="phone" name="phone"
                  className="w-full bg-transparent border-b border-ivory/10 text-ivory px-0 py-5 font-body text-sm focus:border-gold focus:outline-none transition-colors duration-500 peer" />
                <label htmlFor="phone" className="absolute left-0 top-5 font-body text-sm text-ivory/25 transition-all duration-300 peer-focus:top-0 peer-focus:text-[10px] peer-focus:text-gold peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px]">
                  Phone Number
                </label>
              </div>

              <div className="pt-3">
                <p className="font-body text-[11px] text-ivory/25 mb-5 tracking-[0.3em] uppercase">I'm interested in:</p>
                <div className="flex flex-wrap gap-3">
                  {interests.map((interest) => (
                    <button
                      key={interest}
                      type="button"
                      onClick={() => setSelectedInterest(interest)}
                      className={`font-body text-[11px] tracking-luxury uppercase px-6 py-3 border transition-all duration-500 ${
                        selectedInterest === interest
                          ? "border-gold bg-gold text-charcoal"
                          : "border-ivory/10 text-ivory/35 hover:border-gold/30 hover:text-gold"
                      }`}
                    >
                      {interest}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <input type="text" placeholder=" " id="neighborhood" name="neighborhood"
                  className="w-full bg-transparent border-b border-ivory/10 text-ivory px-0 py-5 font-body text-sm focus:border-gold focus:outline-none transition-colors duration-500 peer" />
                <label htmlFor="neighborhood" className="absolute left-0 top-5 font-body text-sm text-ivory/25 transition-all duration-300 peer-focus:top-0 peer-focus:text-[10px] peer-focus:text-gold peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px]">
                  Preferred Neighborhood (optional)
                </label>
              </div>

              <div className="relative">
                <textarea placeholder=" " id="vision" name="vision" rows={3}
                  className="w-full bg-transparent border-b border-ivory/10 text-ivory px-0 py-5 font-body text-sm focus:border-gold focus:outline-none transition-colors duration-500 resize-none peer" />
                <label htmlFor="vision" className="absolute left-0 top-5 font-body text-sm text-ivory/25 transition-all duration-300 peer-focus:top-0 peer-focus:text-[10px] peer-focus:text-gold peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px]">
                  Tell us about your vision...
                </label>
              </div>

              <MagneticButton
                type="submit"
                disabled={sending}
                dataCta="dock-quote"
                className="w-full font-body text-[11px] tracking-luxury uppercase bg-gold text-charcoal px-8 py-5 hover:bg-gold-light transition-colors duration-500 shimmer-btn mt-6 disabled:opacity-60"
              >
                {sending ? "Sending…" : "Begin the Conversation"}
              </MagneticButton>

              <p className="font-body text-[10px] text-ivory/15 text-center pt-3">
                Your inquiry is handled with complete discretion and confidentiality.
              </p>
            </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
