import { BINDING, CLIENT } from '@/lib/site';
export const CC_ASSETS = {
  logo: CLIENT.identity.logoOnDark,
  heroBg: CLIENT.hero.poster,
  // No service association exists in CSD media: keep the native slot empty.
  service: {} as Record<string, string | undefined>,
  gallery: BINDING.gallery,
};
