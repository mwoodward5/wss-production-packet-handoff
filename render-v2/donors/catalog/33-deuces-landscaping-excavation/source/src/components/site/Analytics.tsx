/**
 * Analytics — minimal, gated on SEO config. Add GA4/GTM/Clarity if needed.
 */
import { SEO } from "@/config";

export function Analytics() {
  if (!SEO.ga4Id) return null;
  return (
    <>
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${SEO.ga4Id}`} />
      <script dangerouslySetInnerHTML={{ __html: `
        window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date()); gtag('config', '${SEO.ga4Id}');
      `}} />
    </>
  );
}
