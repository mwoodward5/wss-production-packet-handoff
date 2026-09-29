import { createFileRoute, notFound } from '@tanstack/react-router';
import { PRIVACY_POLICY } from '@/lib/legal';
import { LegalDocument } from '@/components/site/LegalDocument';
import { routeHead } from '@/lib/wss-route-head';
export const Route = createFileRoute('/privacy-policy')({
  beforeLoad: () => { if (!PRIVACY_POLICY) throw notFound(); },
  head: () => routeHead('Privacy Policy'),
  component: () => PRIVACY_POLICY ? <LegalDocument doc={PRIVACY_POLICY} /> : null,
});
