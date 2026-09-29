import {client} from "@/wss/bridge";
import { useState } from "react";
import { business } from "@/data/business";
import { Phone, MessageSquare, MapPin, Truck, BedDouble, Sofa, CreditCard } from "lucide-react";

type Tab = "stock" | "size" | "visit";

const sizes = client.services.map(s=>s.name);
const styles = client.services.map(s=>s.name);

export function HeroQuickAction() {
  const [tab, setTab] = useState<Tab>("stock");
  const [size, setSize] = useState<(typeof sizes)[number]>(sizes[0]);
  const [style, setStyle] = useState<(typeof styles)[number] | "">("");
  const [zip, setZip] = useState("");

  const stockMsg = `Hi ${business.name}! Do you have a ${size}${style ? ` and a ${style}` : ""} in stock today?`;
  const priceMsg = `Hi ${business.name}! What is the current price for ${size}?`;
  const visitMsg = `Hi ${business.name}! I'm in ${zip || client.identity.city} — can I swing by today to look at ${size}?`;
  const sms = (t: string) => `${business.smsHref}?body=${encodeURIComponent(t)}`;

  return (
    <div className="glass-card relative overflow-hidden p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="eyebrow">Showroom widget</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-brand-foreground shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-foreground/80" /> Ask us
        </span>
      </div>

      {/* Tabs */}
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-full bg-foreground/5 p-1 text-xs font-bold">
        {([
          { k: "stock", label: "In stock?", Icon: BedDouble },
          { k: "size", label: "Get a price", Icon: CreditCard },
          { k: "visit", label: "Visit today", Icon: MapPin },
        ] as { k: Tab; label: string; Icon: typeof BedDouble }[]).map((t) => (
          <button
            key={t.k}
            role="tab"
            aria-selected={tab === t.k}
            onClick={() => setTab(t.k)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 transition ${
              tab === t.k ? "bg-foreground text-background shadow" : "text-foreground/70 hover:text-foreground"
            }`}
          >
            <t.Icon className="h-3.5 w-3.5" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Panels */}
      <div className="mt-5 min-h-[180px]">
        {tab === "stock" && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-foreground/60">Product</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {sizes.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                    size === s ? "bg-brand text-brand-foreground shadow" : "border border-foreground/30 bg-white text-foreground hover:border-brand hover:bg-brand/5"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs font-bold uppercase tracking-wider text-foreground/60">Additional request (optional)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setStyle("")}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  style === "" ? "bg-foreground text-background" : "border border-foreground/30 bg-white text-foreground hover:border-brand hover:bg-brand/5"
                }`}
              >
                None
              </button>
              {styles.map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    style === s ? "bg-foreground text-background" : "border border-foreground/30 bg-white text-foreground hover:border-brand hover:bg-brand/5"
                  }`}
                >
                  <Sofa className="h-3 w-3" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === "size" && (
          <div>
            <p className="text-sm text-foreground/80">
              Ask about current pricing.
            </p>
          </div>
        )}
        {tab === "visit" && (
          <div>
            <label htmlFor="visit-zip" className="block text-xs font-bold uppercase tracking-wider text-foreground/60">Your ZIP</label>
            <input
              id="visit-zip"
              inputMode="numeric"
              maxLength={5}
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="ZIP code"
              className="mt-2 w-full rounded-xl border border-foreground/15 bg-white/70 px-4 py-3 text-base font-bold tabnum outline-none ring-brand/40 focus:ring-2"
            />
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-foreground/70">
              <Truck className="h-3.5 w-3.5 text-brand" /> Ask about visiting.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap gap-2">
        <a
          href={`tel:${business.telephone}`}
          data-event="click_call"
          className="btn-glow btn-beam inline-flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-extrabold sm:flex-none"
        >
          <Phone className="h-4 w-4" /> Call <span className="tabnum">{business.displayPhone}</span>
        </a>
        <a
          href={sms(tab === "visit" ? visitMsg : tab === "size" ? priceMsg : stockMsg)}
          data-event="click_sms"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-foreground/20 bg-foreground/5 px-5 py-3 text-sm font-bold text-foreground transition hover:border-brand hover:bg-foreground/10 sm:flex-none"
        >
          <MessageSquare className="h-4 w-4" /> Text us
        </a>
        {business.mapDirectionsUrl && <a
          href={business.mapDirectionsUrl}
          target="_blank"
          rel="noreferrer"
          data-event="click_directions"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-foreground/20 bg-foreground/5 px-4 py-3 text-sm font-bold text-foreground transition hover:border-brand hover:bg-foreground/10"
          aria-label="Get directions"
        >
          <MapPin className="h-4 w-4" />
        </a>}
      </div>
      <p className="mt-3 text-[11px] text-foreground/55">
        Opens your messaging app. Your message is sent only when you choose to send it.
      </p>
    </div>
  );
}
