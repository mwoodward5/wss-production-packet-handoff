import { useState } from "react";
import { ArrowRight, Ruler } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";
import { track } from "@/lib/analytics";

const styles = ["Blackwork", "Fine Line", "Botanical", "Ornamental", "Illustrative"];
const sizes = ["Small (< 3\")", "Medium (3–6\")", "Large (6–10\")", "Full sleeve / back"];
const placements = ["Arm", "Forearm", "Hand", "Chest", "Back", "Leg", "Other"];

function estimateRange(size: string) {
  const min = parseInt(siteConfig.pricing.minimum.replace(/\D/g, ""), 10) || 250;
  const rate = parseInt(siteConfig.pricing.hourly.replace(/\D/g, ""), 10) || 220;
  const hours = size.startsWith("Small") ? [1, 2] : size.startsWith("Medium") ? [2, 4] : size.startsWith("Large") ? [4, 7] : [8, 14];
  const low = Math.max(min, hours[0] * rate);
  const high = hours[1] * rate;
  return `$${low.toLocaleString()} – $${high.toLocaleString()}`;
}

export function HeroBookingWidget({ onSubmit }: { onSubmit: () => void }) {
  const [style, setStyle] = useState<string>("Blackwork");
  const [size, setSize] = useState<string>("Medium (3–6\")");
  const [placement, setPlacement] = useState<string>("Forearm");
  const range = estimateRange(size);

  const handle = () => {
    track("hero_widget_submit", { style, size, placement });
    try {
      sessionStorage.setItem("wss_prefill", JSON.stringify({ style, size, placement }));
    } catch {}
    onSubmit();
  };

  return (
    <div className="glass p-6 md:p-7 relative overflow-hidden">
      <div className="absolute -top-24 -right-20 w-64 h-64 bg-signal/20 blur-3xl rounded-full pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="section-label !mb-1">Quick Intake</div>
            <h3 className="font-display text-xl font-semibold text-bone">Get an instant estimate</h3>
          </div>
          <div className="w-10 h-10 rounded-full grid place-items-center border border-line bg-surface/50">
            <Ruler size={16} className="text-signal" />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-widest text-fadetext mb-2 block">Style</label>
            <div className="flex flex-wrap gap-1.5">
              {styles.map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`px-3 py-1.5 rounded-full text-xs transition ${style === s ? "bg-signal text-ink font-semibold" : "border border-line text-fadetext hover:text-bone hover:border-bone/40"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-fadetext mb-2 block">Size</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="field text-sm"
            >
              {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-fadetext mb-2 block">Placement</label>
            <div className="flex flex-wrap gap-1.5">
              {placements.map((p) => (
                <button
                  key={p}
                  onClick={() => setPlacement(p)}
                  className={`px-3 py-1.5 rounded-full text-xs transition ${placement === p ? "bg-bone text-ink font-semibold" : "border border-line text-fadetext hover:text-bone hover:border-bone/40"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-line/60 flex items-end justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-fadetext mb-1">Estimated range</div>
              <div className="font-display text-2xl md:text-3xl font-bold text-bone">{range}</div>
              <div className="text-[11px] text-fadetext mt-1">Final quote after consultation</div>
            </div>
            <button
              onClick={handle}
              className="bg-signal text-ink font-semibold px-5 py-3 rounded-full flex items-center gap-2 hover:brightness-110 transition emboss text-sm whitespace-nowrap"
            >
              Continue <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
