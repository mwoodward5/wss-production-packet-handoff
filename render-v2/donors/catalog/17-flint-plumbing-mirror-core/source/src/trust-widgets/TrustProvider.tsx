import * as React from "react";
import { blankTrustConfig, type TrustConfig, type WidgetId } from "./trust.config";
import { themeToCssVars, type TrustTheme } from "./theme";

interface Ctx { config: TrustConfig }
const TrustCtx = React.createContext<Ctx>({ config: blankTrustConfig });

export function useTrust(): TrustConfig {
  return React.useContext(TrustCtx).config;
}

/** True when the widget is allowed to mount for this vertical. */
export function useWidgetAllowed(id: WidgetId): boolean {
  const cfg = useTrust();
  return !cfg.widgetProfile?.suppressed?.includes(id);
}

export function TrustProvider({
  config,
  theme,
  className,
  children,
}: {
  config: TrustConfig;
  theme?: Partial<TrustTheme>;
  className?: string;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => ({ config }), [config]);
  const style = React.useMemo(
    () => (theme ? (themeToCssVars(theme) as React.CSSProperties) : undefined),
    [theme]
  );
  return (
    <TrustCtx.Provider value={value}>
      <div className={["tw-root", className].filter(Boolean).join(" ")} style={style}>
        {children}
      </div>
    </TrustCtx.Provider>
  );
}

/** Guard used by every widget: suppressed by profile OR no data => null. */
export function Gate({
  id,
  when,
  children,
}: {
  id: WidgetId;
  when: boolean;
  children: React.ReactNode;
}) {
  const allowed = useWidgetAllowed(id);
  if (!allowed || !when) return null;
  return <>{children}</>;
}
