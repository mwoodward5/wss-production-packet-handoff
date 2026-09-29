import { useState } from "react";
import { RouteLink } from "@/components/site/RouteLink";
import { business } from "@/data/business";
import { MessageSquare, Sparkles } from "lucide-react";

type Pos = "side" | "back" | "stomach" | "combo";
type Firm = "plush" | "medium" | "firm";
type Size = "twin" | "full" | "queen" | "king";

export function MattressMatchQuiz() {
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState<Pos | null>(null);
  const [firm, setFirm] = useState<Firm | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  const result = pos && firm && size ? {label: firm} : null;
  const smsBody = result
    ? encodeURIComponent(`Hi ${business.name} — looking for a ${size} ${result.label.toLowerCase()} mattress (${pos} sleeper, ${firm} feel). What's in today?`)
    : "";

  const Btn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
        active ? "border-brand bg-brand/10 text-foreground" : "border-border bg-background hover:border-brand/50"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="card-elevate p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-brand" />
        <p className="eyebrow !text-brand !tracking-[0.18em]">Mattress Match</p>
      </div>
      <h3 className="mt-2 text-2xl font-bold">Find your bed in 3 quick taps.</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Share your sleep preferences with the showroom.
      </p>

      <div className="mt-5 flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-brand" : "bg-foreground/10"}`} />
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {step === 0 && (
          <div>
            <p className="text-sm font-semibold">How do you sleep?</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["side", "back", "stomach", "combo"] as Pos[]).map((v) => (
                <Btn key={v} active={pos === v} onClick={() => { setPos(v); setStep(1); }}>
                  {v[0].toUpperCase() + v.slice(1)}
                </Btn>
              ))}
            </div>
          </div>
        )}
        {step === 1 && (
          <div>
            <p className="text-sm font-semibold">Preferred feel?</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(["plush", "medium", "firm"] as Firm[]).map((v) => (
                <Btn key={v} active={firm === v} onClick={() => { setFirm(v); setStep(2); }}>
                  {v[0].toUpperCase() + v.slice(1)}
                </Btn>
              ))}
            </div>
          </div>
        )}
        {step === 2 && (
          <div>
            <p className="text-sm font-semibold">What size?</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["twin", "full", "queen", "king"] as Size[]).map((v) => (
                <Btn key={v} active={size === v} onClick={() => { setSize(v); setStep(3); }}>
                  {v[0].toUpperCase() + v.slice(1)}
                </Btn>
              ))}
            </div>
          </div>
        )}
        {step === 3 && result && (
          <div className="rounded-xl bg-brand/10 border border-brand/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">Your preferences</p>
            <p className="mt-1 text-xl font-extrabold">{size?.toUpperCase()} · {result.label}</p>
            <p className="mt-1 text-sm text-foreground/80">
              For a {pos} sleeper who likes a {firm} feel.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`sms:${business.telephone}?body=${smsBody}`}
                data-event="check_inventory"
                className="inline-flex items-center gap-1.5 rounded-full btn-glow px-4 py-2 text-sm font-semibold"
              >
                <MessageSquare className="h-4 w-4" /> Text us this pick
              </a>
              <button
                type="button"
                onClick={() => { setStep(0); setPos(null); setFirm(null); setSize(null); }}
                className="rounded-full border border-foreground/15 px-4 py-2 text-sm font-semibold"
              >
                Start over
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
