export const FEATURES = {
  chatWidget: false,
  heyGenAvatar: false,
  googleMapsSdk: false,
  placesLiveCard: false,
  weatherWidget: false,
  galleryLightbox: true,
  reviewsPage: false,
  galleryPage: false,
  blogPage: false,
  themeToggle: false,
  mobileCallBar: true,
  verticalWidget: false,
  exifGpsInjection: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
export function isEnabled(flag: FeatureFlag): boolean { return FEATURES[flag] === true; }
