import * as React from "react";
/** SSR-safe: false during server render and first paint, true afterwards. */
export function useHydrated(): boolean {
  const [h, setH] = React.useState(false);
  React.useEffect(() => setH(true), []);
  return h;
}
