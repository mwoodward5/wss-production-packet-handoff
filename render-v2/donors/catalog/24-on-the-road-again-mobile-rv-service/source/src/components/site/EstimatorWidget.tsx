/**
 * Original compact RV widget shell, adapted to an explicit email draft.
 * No network submission or delivery claim; the visitor sends from their mail app.
 */
import { useState } from "react";
import { CLIENT, SERVICES } from "@/config";

const SERVICE_OPTS = SERVICES.map(s=>s.name);
const RV_OPTS = ["Motorhome house systems","Travel trailer","Fifth wheel","Toy hauler","Camper","Not sure"];
const TIMING_OPTS = ["Soon","This week","This month","Seasonal prep","Planning ahead"];

function buildMailto(data: Record<string, FormDataEntryValue>) {
  const lines = [
    `Name: ${data.name || ""}`,
    `Phone: ${data.phone || ""}`,
    `Email: ${data.email || ""}`,
    `City: ${data.city || ""}`,
    `Service needed: ${data.serviceNeeded || data.service || ""}`,
    `RV type: ${data.rvType || ""}`,
    `Preferred timing: ${data.timing || ""}`,
    "",
    `${data.message || ""}`,
  ];
  const body = encodeURIComponent(lines.join("\n"));
  const subject = encodeURIComponent(`Scheduled service request — ${data.name || "RV owner"}`);
  return `mailto:${CLIENT.email}?subject=${subject}&body=${body}`;
}

export function EstimatorWidget({ variant = "rail" }: { variant?: "rail" | "inline" }) {
  const [mailtoHref, setMailtoHref] = useState("");
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(CLIENT.email)setMailtoHref(buildMailto(Object.fromEntries(new FormData(e.currentTarget).entries())));
  }

  const shell =
    variant === "rail"
      ? "rounded-2xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 text-white shadow-2xl"
      : "rounded-2xl border border-border bg-card p-6";

  const labelCls = variant === "rail" ? "text-[11px] uppercase tracking-widest text-white/70" : "text-[11px] uppercase tracking-widest text-muted-foreground";
  const inputCls =
    variant === "rail"
      ? "w-full rounded-lg border border-white/25 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/50 outline-none focus:border-white/60"
      : "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

  return (
    <form onSubmit={onSubmit} className={shell}>
      <div className={variant === "rail" ? "text-xs uppercase tracking-widest text-white/70" : "text-xs uppercase tracking-widest text-muted-foreground"}>
        Best next step for your RV
      </div>
      <h3 className={variant === "rail" ? "mt-1 font-serif text-xl font-semibold text-white" : "mt-1 font-serif text-xl font-semibold"}>
        Request scheduled service
      </h3>

      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className={labelCls}>Service needed</span>
          <select name="serviceNeeded" required className={inputCls + " mt-1"}>
            <option value="">Choose…</option>
            {SERVICE_OPTS.map((o) => <option key={o} className="text-foreground">{o}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>RV type</span>
            <select name="rvType" required className={inputCls + " mt-1"}>
              <option value="">Choose…</option>
              {RV_OPTS.map((o) => <option key={o} className="text-foreground">{o}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>City</span>
            <input
              name="city"
              type="text"
              required
              autoComplete="address-level2"
              placeholder="City where the RV is located"
              className={inputCls + " mt-1"}
            />
          </label>
        </div>
        <label className="block">
          <span className={labelCls}>Preferred timing</span>
          <select name="timing" required className={inputCls + " mt-1"}>
            <option value="">Choose…</option>
            {TIMING_OPTS.map((o) => <option key={o} className="text-foreground">{o}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <input name="name" required placeholder="Name" className={inputCls} />
          <input name="phone" required type="tel" placeholder="Phone" className={inputCls} />
        </div>
        <input name="email" required type="email" placeholder="Email" className={inputCls} />
      </div>

      <button
        type="submit"
        disabled={!CLIENT.email}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold disabled:opacity-60"
      >
        Prepare email draft
      </button>
      <p className="mt-3 text-xs">This form prepares an email draft. Nothing is sent here. You can also <a className="underline" href={`tel:${CLIENT.phoneE164}`}>call {CLIENT.phone}</a>.</p>
      {mailtoHref && <a className="underline block mt-3" href={mailtoHref}>Open email draft</a>}
    </form>
  );
}
