import { useState } from "react";
import { RouteLink } from "@/components/site/RouteLink";
import { business } from "@/data/business";
import { CreditCard } from "lucide-react";

export function FinancingEstimator() {
  const [amt, setAmt] = useState(1200);
  const down = 40;
  const remaining = Math.max(0, amt - down);
  const monthly = Math.ceil(remaining / 3);

  return (
    <div className="card-elevate p-6">
      <div className="flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-brand" />
        <p className="eyebrow !text-brand !tracking-[0.18em]">Financing Estimator</p>
      </div>
      <h3 className="mt-2 text-2xl font-bold">$40 down. 0% for 90 days.</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Slide to your purchase amount and see what 90-day same-as-cash looks like.
      </p>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Purchase</span>
          <span className="text-2xl font-extrabold">${amt.toLocaleString()}</span>
        </div>
        <input
          type="range"
          min={200}
          max={5000}
          step={50}
          value={amt}
          onChange={(e) => setAmt(Number(e.target.value))}
          className="mt-2 w-full accent-[color:var(--brand)]"
          aria-label="Purchase amount"
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>$200</span><span>$5,000</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-brand/10 border border-brand/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Today</p>
          <p className="mt-1 text-lg font-extrabold">${down}</p>
        </div>
        <div className="rounded-xl bg-foreground/5 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Then 3×</p>
          <p className="mt-1 text-lg font-extrabold">${monthly.toLocaleString()}</p>
        </div>
        <div className="rounded-xl bg-foreground/5 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Interest</p>
          <p className="mt-1 text-lg font-extrabold">0%</p>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        Estimate via {business.financing.provider}. {business.financing.disclaimer}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <RouteLink
          to="/mattress-and-furniture-financing-rhode-island"
          data-event="click_financing"
          className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background"
        >
          See full financing options
        </RouteLink>
        <a
          href={`tel:${business.telephone}`}
          data-event="click_call"
          className="rounded-full border border-foreground/15 px-4 py-2 text-sm font-semibold"
        >
          Call to apply
        </a>
      </div>
    </div>
  );
}
