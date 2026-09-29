/**
 * FEATURES.FLAGS.TS — On The Road Again uses a 3-page plan.
 */
export const FEATURES = {
  chatWidget: false,
  heyGenAvatar: false,
  googleMapsSdk: false,
  placesLiveCard: false,
  weatherWidget: false,
  galleryLightbox: false,
  reviewsPage: false,
  galleryPage: false,
  blogPage: false,
  themeToggle: true,
  mobileCallBar: true,
  verticalWidget: false,
  exifGpsInjection: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
export function isEnabled(flag: FeatureFlag): boolean { return FEATURES[flag] === true }
