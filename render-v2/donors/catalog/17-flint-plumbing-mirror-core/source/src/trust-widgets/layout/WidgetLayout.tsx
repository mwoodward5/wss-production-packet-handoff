import * as React from "react";
import { useTrust } from "../TrustProvider";
import type { WidgetId } from "../trust.config";
import { WIDGET_REGISTRY } from "./registry";
import { Section } from "../components/primitives";

/**
 * Layout engine.
 * - renders `promoted` widgets in priority slots
 * - renders `available` widgets only when explicitly listed via `include`
 * - never mounts anything in `suppressed`
 * Widgets with no data still render null, so empty config = empty page.
 */
export function WidgetLayout({
  slots = "promoted",
  include,
  exclude = [],
  headings = true,
}: {
  slots?: "promoted" | "all";
  include?: WidgetId[];
  exclude?: WidgetId[];
  headings?: boolean;
}) {
  const cfg = useTrust();
  const profile = cfg.widgetProfile;
  const base = slots === "all" ? [...profile.promoted, ...profile.available] : profile.promoted;
  const ids = (include?.length ? include : base)
    .filter((id) => !profile.suppressed.includes(id))
    .filter((id) => !exclude.includes(id));

  return (
    <>
      {ids.map((id) => {
        const meta = WIDGET_REGISTRY[id];
        if (!meta) return null;
        const { Component } = meta;
        if (meta.overlay) return <Component key={id} />;
        return (
          <Section key={id} title={headings && meta.title ? meta.title : undefined}>
            <Component />
          </Section>
        );
      })}
    </>
  );
}

/** Render one widget by id, respecting suppression. */
export function Widget({ id }: { id: WidgetId }) {
  const cfg = useTrust();
  if (cfg.widgetProfile.suppressed.includes(id)) return null;
  const meta = WIDGET_REGISTRY[id];
  if (!meta) return null;
  const { Component } = meta;
  return <Component />;
}
