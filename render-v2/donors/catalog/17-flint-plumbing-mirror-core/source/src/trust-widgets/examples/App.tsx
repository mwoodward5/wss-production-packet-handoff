/**
 * Minimal mount example. Works in any React 19 app (Vite, Next, TanStack Start,
 * Remix, Astro islands). No Tailwind required — the CSS is self-contained.
 */
import * as React from "react";
import "../trust-widgets.css";
import { TrustProvider } from "../TrustProvider";
import { WidgetLayout, Widget } from "../layout/WidgetLayout";
import { plumbingExampleConfig } from "./plumbing.config";

export default function App() {
  return (
    <TrustProvider config={plumbingExampleConfig} >
      {/* Always-on SEO + overlay widgets */}
      <Widget id="SeoProofBlock" />
      <Widget id="SpeakableSchema" />
      <Widget id="EmergencyCTABand" />

      <main>
        <h1>{plumbingExampleConfig.business.name}</h1>

        {/* Hand-placed widgets */}
        <Widget id="StarSummaryBar" />
        <Widget id="ServiceAreaBanner" />

        {/* Or let the layout engine render everything the vertical promotes */}
        <WidgetLayout slots="promoted" exclude={["SeoProofBlock", "SpeakableSchema", "EmergencyCTABand", "StarSummaryBar", "ServiceAreaBanner"]} />
      </main>

      <Widget id="BookNowSticky" />
    </TrustProvider>
  );
}
