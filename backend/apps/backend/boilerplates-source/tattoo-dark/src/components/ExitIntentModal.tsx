import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readUtm } from "@/lib/utm";
import { track } from "@/lib/analytics";
import { siteConfig } from "@/config/siteConfig";

const SESSION_KEY = "wss_exit_shown";

export function ExitIntentModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Desktop only — most exit intent on mobile is noise.
    if (window.innerWidth < 900) return;

    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) {
        sessionStorage.setItem(SESSION_KEY, "1");
        setOpen(true);
      }
    };
    // Delay attach so it doesn't fire on immediate scroll-to-top.
    const t = setTimeout(() => document.addEventListener("mouseleave", onLeave), 6000);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.match(/.+@.+\..+/)) {
      toast.error("Enter a valid email.");
      return;
    }
    setBusy(true);
    const utm = readUtm();
    const { error } = await supabase.from("email_captures").insert({
      email,
      source: "exit_intent",
      utm_source: utm.utm_source ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_campaign: utm.utm_campaign ?? null,
      metadata: { referrer: utm.referrer ?? null, landing_path: utm.landing_path ?? null },
    });
    setBusy(false);
    if (error) {
      toast.error("Something went wrong. Try again.");
      return;
    }
    track("exit_intent_capture", { email_domain: email.split("@")[1] });
    setDone(true);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4">
      <div className="glass max-w-md w-full p-8 relative">
        <button
          className="absolute top-4 right-4 text-fadetext hover:text-bone"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <X size={18} />
        </button>
        {done ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-signal/20 text-signal grid place-items-center mx-auto mb-4">
              <Download size={20} />
            </div>
            <h3 className="text-xl font-bold mb-2">Guide on its way.</h3>
            <p className="text-sm text-fadetext">
              Check your inbox for the {siteConfig.studioName} tattoo prep + aftercare guide.
            </p>
          </div>
        ) : (
          <>
            <div className="section-label mb-3">Before you go</div>
            <h3 className="text-2xl font-display font-bold mb-2 leading-tight">
              Get the tattoo prep & aftercare guide.
            </h3>
            <p className="text-sm text-fadetext mb-5">
              Everything {siteConfig.artistName.split(" ")[0]} wishes every new client knew — how to prep the week before, day-of, and heal it right. Free PDF, no follow-up spam.
            </p>
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
                {busy ? "Sending…" : "Send me the guide"}
              </button>
              <p className="text-[11px] text-fadetext text-center">
                One email. No newsletter drip. Unsubscribe with one click.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
