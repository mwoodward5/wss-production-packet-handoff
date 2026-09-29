import * as React from "react";
import type { HoursEntry, TrustConfig } from "../trust.config";
import { useHydrated } from "./useHydrated";

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

export interface OpenState {
  known: boolean;
  open: boolean;
  /** "Closes 6:00 PM" | "Opens Tue 9:00 AM" */
  detail: string;
  todays?: HoursEntry;
}

function fmt(t: string): string {
  const parts = t.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m ?? 0).padStart(2, "0")} ${ampm}`;
}

export function computeOpenState(cfg: TrustConfig, now = new Date()): OpenState {
  if (cfg.hours?.open24) return { known: true, open: true, detail: "Open 24 hours" };
  const weekly = cfg.hours?.weekly ?? [];
  if (!weekly.length) return { known: false, open: false, detail: "" };

  const todayName = DAYS[now.getDay()];
  const today = weekly.find((h) => h.day === todayName);
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (t: string) => { const p = t.split(":").map(Number); return (p[0] ?? 0) * 60 + (p[1] ?? 0); };

  if (today?.open && today?.close) {
    const o = toMin(today.open), c = toMin(today.close);
    if (mins >= o && mins < c) return { known: true, open: true, detail: `Closes ${fmt(today.close)}`, todays: today };
    if (mins < o) return { known: true, open: false, detail: `Opens ${fmt(today.open)}`, todays: today };
  }
  for (let i = 1; i <= 7; i++) {
    const d = weekly.find((h) => h.day === DAYS[(now.getDay() + i) % 7]);
    if (d?.open) return { known: true, open: false, detail: `Opens ${d.day.slice(0, 3)} ${fmt(d.open)}`, todays: today };
  }
  return { known: true, open: false, detail: "Closed", todays: today };
}

/** Client-only so SSR never emits a wrong "Open now". */
export function useOpenNow(cfg: TrustConfig): OpenState {
  const hydrated = useHydrated();
  const [state, setState] = React.useState<OpenState>({ known: false, open: false, detail: "" });
  React.useEffect(() => {
    const tick = () => setState(computeOpenState(cfg));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [cfg]);
  return hydrated ? state : { known: false, open: false, detail: "" };
}
