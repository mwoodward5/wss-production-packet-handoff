import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { siteConfig } from "@/config/siteConfig";

function useCountdown(target: string) {
  const [remaining, setRemaining] = useState(() => new Date(target).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(target).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  const clamp = Math.max(0, remaining);
  const days = Math.floor(clamp / 86_400_000);
  const hours = Math.floor((clamp / 3_600_000) % 24);
  const minutes = Math.floor((clamp / 60_000) % 60);
  const seconds = Math.floor((clamp / 1000) % 60);
  return { days, hours, minutes, seconds };
}

export function FlashDropForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const { days, hours, minutes, seconds } = useCountdown(siteConfig.nextFlashDropAt);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.match(/.+@.+\..+/)) return toast.error("Valid email required.");
    setBusy(true);
    const { error } = await supabase
      .from("flash_drop_subscribers")
      .insert({ email, source: "flash_page" });
    setBusy(false);
    if (error && !error.message.includes("duplicate")) {
      toast.error("Couldn't save. Try again.");
      return;
    }
    track("flash_drop_signup", {});
    setDone(true);
    toast.success("You'll get flash 24 hours early.");
  };

  return (
    <div className="glass p-8 grid md:grid-cols-2 gap-8 items-center">
      <div>
        <div className="section-label">Next Flash Drop</div>
        <h3 className="text-2xl font-display font-bold mb-3">
          Get flash <span className="italic text-signal">24 hours early.</span>
        </h3>
        <p className="text-sm text-fadetext mb-5">
          New flash sheet posts every Tuesday at noon Central. Subscribers see it 24 hours before Instagram.
        </p>
        <div className="grid grid-cols-4 gap-2 max-w-sm">
          {[
            ["Days", days], ["Hours", hours], ["Min", minutes], ["Sec", seconds],
          ].map(([l, v]) => (
            <div key={l as string} className="text-center border border-line rounded-lg py-3">
              <div className="text-2xl font-display font-bold tabular-nums">{String(v).padStart(2, "0")}</div>
              <div className="text-[10px] uppercase tracking-widest text-fadetext mt-1">{l}</div>
            </div>
          ))}
        </div>
      </div>
      {done ? (
        <div className="text-center">
          <p className="text-bone font-semibold mb-1">On the list.</p>
          <p className="text-xs text-fadetext">Watch your inbox Tuesday morning.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="field"
          />
          <button
            disabled={busy}
            className="bg-signal text-ink font-semibold py-3 rounded-full emboss disabled:opacity-60"
          >
            {busy ? "…" : "Get flash early"}
          </button>
          <p className="text-[11px] text-fadetext text-center">Unsubscribe with one click.</p>
        </form>
      )}
    </div>
  );
}
