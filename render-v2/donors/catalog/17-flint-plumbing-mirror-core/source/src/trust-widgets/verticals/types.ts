import type { TrustConfig, WidgetProfile } from "../trust.config";

/**
 * A vertical preset carries only trade-shaped defaults: schema type, copy labels,
 * and the widget profile. It never carries fake business data.
 */
export interface VerticalPreset {
  key: string;
  schemaType: string;
  category: string;
  labels: TrustConfig["labels"];
  widgetProfile: WidgetProfile;
  /** suggested (unpriced) service names to start from — safe to delete */
  suggestedServices: string[];
  /** questions worth answering for voice/AI search in this trade */
  suggestedVoiceQuestions: string[];
}

/** Merge a preset onto a real business config. Business data always wins. */
export function applyVertical(config: TrustConfig, preset: VerticalPreset): TrustConfig {
  return {
    ...config,
    business: {
      ...config.business,
      schemaType: config.business.schemaType && config.business.schemaType !== "LocalBusiness"
        ? config.business.schemaType
        : preset.schemaType,
      category: config.business.category || preset.category,
    },
    labels: { ...preset.labels, ...config.labels },
    widgetProfile: config.widgetProfile?.promoted?.length ? config.widgetProfile : preset.widgetProfile,
  };
}
