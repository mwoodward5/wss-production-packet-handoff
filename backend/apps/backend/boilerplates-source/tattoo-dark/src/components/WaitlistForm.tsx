import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [style, setStyle] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.match(/.+@.+\..+/)) {
      toast.error("Valid email required.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("waitlist_subscribers")
      .insert({ email, style_preference: style || null });
    setBusy(false);
    if (error) {
      toast.error("Couldn't save. Try again.");
      return;
    }
    track("waitlist_join", {});
    setDone(true);
    toast.success("You're on the waitlist.");
  };

  if (done)
    return (
      <div className="glass p-6 text-center">
        <p className="text-bone font-semibold mb-1">You're on the list.</p>
        <p className="text-xs text-fadetext">
          {siteConfig.artistName.split(" ")[0]} emails cancellation openings first-come, first-served — usually with 24–48 hours notice.
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} className="glass p-6 grid gap-3">
      <div className="section-label">Cancellation Waitlist</div>
      <h3 className="text-xl font-display font-bold">Get last-minute openings.</h3>
      <p className="text-xs text-fadetext">
        When a client cancels inside 72 hours, the waitlist gets first shot — usually 24–48 hours notice.
      </p>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="field"
      />
      <input
        value={style}
        onChange={(e) => setStyle(e.target.value)}
        placeholder="Style you want (optional)"
        className="field"
      />
      <button
        disabled={busy}
        className="bg-signal text-ink font-semibold py-2.5 rounded-full text-sm emboss disabled:opacity-60"
      >
        {busy ? "Adding…" : "Join waitlist"}
      </button>
    </form>
  );
}
